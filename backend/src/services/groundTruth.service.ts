// backend/src/services/groundTruth.service.ts

import { z } from 'zod';
import { config } from '../config';
import { db } from '../db/pool';
import { llmCall } from '../lib/llm/llm.client';
import { ModelConfig } from '../lib/llm/model.router';
import { buildPrompt } from '../lib/llm/prompt.builder';
import { logger } from '../lib/logger';
import { computeF1, saveBenchmarkRun } from './benchmark.service';

const ContradictionsOutputSchema = z.object({
	contradictions: z.array(z.object({
		contradiction_type: z.string(),
		severity: z.string(),
		claim_a: z.string(),
		claim_b: z.string(),
		section_a: z.string().nullable().optional(),
		section_b: z.string().nullable().optional(),
		explanation: z.string(),
	})),
});

const ContradictionArrayOutputSchema = z.array(z.object({
	contradiction_type: z.string().optional(),
	type: z.string().optional(),
	severity: z.string().optional(),
	claim_a: z.string().optional(),
	claimA: z.string().optional(),
	claim_b: z.string().optional(),
	claimB: z.string().optional(),
	section_a: z.string().nullable().optional(),
	sectionA: z.string().nullable().optional(),
	section_b: z.string().nullable().optional(),
	sectionB: z.string().nullable().optional(),
	explanation: z.string().optional(),
	reason: z.string().optional(),
}));

interface GroundTruthPair {
	docAId: string;
	docBId: string;
	docAFilename: string;
	docBFilename: string;
	contradictionType: string | null;
	isContradiction: boolean;
}

interface PairDetectionResult {
	types: string[];
	failed: boolean;
	error?: string;
}

interface ModelBenchmarkTarget {
	modelLabel: 'heavy' | 'mid' | 'fast';
	model: string;
	skippedDuplicateLabels: string[];
}

const BENCHMARK_RATE_LIMIT_RETRY_DELAYS_MS = [5_000, 15_000, 30_000];
const BENCHMARK_BATCH_DELAY_MS = 5_000;
const BENCHMARK_MAX_CONSECUTIVE_RATE_LIMIT_FAILURES = 3;

export async function loadGroundTruth(): Promise<GroundTruthPair[]> {
	const { rows } = await db.query(
		`SELECT doc_a_id AS "docAId", doc_b_id AS "docBId",
            doc_a_filename AS "docAFilename", doc_b_filename AS "docBFilename",
            contradiction_type AS "contradictionType",
            is_contradiction AS "isContradiction"
     FROM ground_truth_pairs ORDER BY imported_at`
	);
	return rows;
}

async function runPairsConcurrent<T extends PairDetectionResult>(
	pairs: GroundTruthPair[],
	concurrency: number,
	fn: (pair: GroundTruthPair) => Promise<T>
): Promise<{ results: T[]; aborted: boolean; abortReason?: string }> {
	const results: T[] = [];
	let consecutiveRateLimitFailures = 0;

	for (let index = 0; index < pairs.length; index += concurrency) {
		const batch = pairs.slice(index, index + concurrency);
		const settled = await Promise.allSettled(batch.map(fn));
		for (const result of settled) {
			if (result.status === 'fulfilled') {
				results.push(result.value);
				if (result.value.failed && result.value.error?.includes('429')) {
					consecutiveRateLimitFailures++;
				} else if (!result.value.failed) {
					consecutiveRateLimitFailures = 0;
				}
			} else {
				consecutiveRateLimitFailures++;
				logger.warn({ err: result.reason }, 'Pair detection failed — skipping');
			}
		}

		if (consecutiveRateLimitFailures >= BENCHMARK_MAX_CONSECUTIVE_RATE_LIMIT_FAILURES) {
			const abortReason = `Aborted after ${consecutiveRateLimitFailures} consecutive 429/rate-limit pair failures`;
			logger.error({ abortReason }, 'Benchmark model run aborted by rate-limit circuit breaker');
			return { results, aborted: true, abortReason };
		}

		if (index + concurrency < pairs.length) {
			await new Promise(resolve => setTimeout(resolve, BENCHMARK_BATCH_DELAY_MS));
		}
	}
	return { results, aborted: false };
}

function getBenchmarkConcurrency(): number {
	return Math.max(1, Math.min(config.BENCHMARK_CONCURRENCY, 5));
}

function getUniqueBenchmarkModels(): ModelBenchmarkTarget[] {
	const targets: ModelBenchmarkTarget[] = [];
	const seen = new Map<string, ModelBenchmarkTarget>();

	for (const [modelLabel, modelKey] of [
		['heavy', 'heavy'],
		['mid', 'mid'],
		['fast', 'fast'],
	] as const) {
		const model = ModelConfig[modelKey];
		const existing = seen.get(model);
		if (existing) {
			existing.skippedDuplicateLabels.push(modelLabel);
			logger.warn(
				{ model, modelLabel, originalLabel: existing.modelLabel },
				'Skipping duplicate benchmark model label'
			);
			continue;
		}
		const target: ModelBenchmarkTarget = { modelLabel, model, skippedDuplicateLabels: [] };
		seen.set(model, target);
		targets.push(target);
	}

	return targets;
}

function countFailed(results: PairDetectionResult[]) {
	const failedPairs = results.filter(result => result.failed);
	return {
		failedPairCount: failedPairs.length,
		failedPairErrors: failedPairs.reduce<Record<string, number>>((acc, result) => {
			const key = result.error ?? 'unknown_error';
			acc[key] = (acc[key] ?? 0) + 1;
			return acc;
		}, {}),
	};
}

async function detectForPair(
	docAId: string,
	docBId: string,
	docAName: string,
	docBName: string,
	modelOverride: string,
	promptVersionId: string,
	userId: string
): Promise<PairDetectionResult> {

	const { rows: chunksA } = await db.query(
		`SELECT chunk_text, chunk_index FROM chunks WHERE document_id = $1 ORDER BY chunk_index LIMIT 5`,
		[docAId]
	);
	const { rows: chunksB } = await db.query(
		`SELECT chunk_text, chunk_index FROM chunks WHERE document_id = $1 ORDER BY chunk_index LIMIT 5`,
		[docBId]
	);

	if (!chunksA.length || !chunksB.length) return { types: [], failed: false };

	const contextA = chunksA.map(c => `[§${c.chunk_index}] ${c.chunk_text}`).join('\n\n');
	const contextB = chunksB.map(c => `[§${c.chunk_index}] ${c.chunk_text}`).join('\n\n');

	const { body } = await buildPrompt('detect_contradictions_financial', {
		doc_a_name: docAName,
		doc_b_name: docBName,
		chunks_a: contextA,
		chunks_b: contextB,
	});

	for (let attempt = 0; attempt <= BENCHMARK_RATE_LIMIT_RETRY_DELAYS_MS.length; attempt++) {
		const response = await llmCall({
			task: 'detect_contradictions_financial',
			messages: [{ role: 'user', content: body }],
			userId,
			promptVersionId,
			modelOverride,
			maxTokens: 2_048,
			temperature: 0.1,
		});

		if (response.finishReason === 'error') {
			const isRateLimited = response.error?.includes('429') ?? false;
			const delay = BENCHMARK_RATE_LIMIT_RETRY_DELAYS_MS[attempt];
			if (isRateLimited && delay) {
				logger.warn(
					{ modelOverride, attempt: attempt + 1, delay, error: response.error },
					'Benchmark pair hit rate limit — backing off'
				);
				await new Promise(resolve => setTimeout(resolve, delay));
				continue;
			}

			return { types: [], failed: true, error: response.error ?? 'llm_error' };
		}

		if (!response.structured) {
			return { types: [], failed: true, error: 'missing_structured_response' };
		}

		const normalized = normalizeContradictionOutput(response.structured);
		const parsed = ContradictionsOutputSchema.safeParse(normalized);
		if (!parsed.success) {
			return { types: [], failed: true, error: 'invalid_structured_response' };
		}

		return { types: parsed.data.contradictions.map(c => c.contradiction_type), failed: false };
	}

	return { types: [], failed: true, error: 'rate_limit_retries_exhausted' };
}

function normalizeContradictionOutput(raw: unknown): unknown {
	if (Array.isArray(raw)) {
		return { contradictions: normalizeContradictionArray(raw) };
	}

	if (raw && typeof raw === 'object' && 'contradictions' in raw) {
		const contradictions = (raw as { contradictions: unknown }).contradictions;
		if (Array.isArray(contradictions)) {
			return { contradictions: normalizeContradictionArray(contradictions) };
		}
	}

	return raw;
}

function normalizeContradictionArray(raw: unknown[]): unknown[] {
	const parsed = ContradictionArrayOutputSchema.safeParse(raw);
	if (!parsed.success) return raw;

	return parsed.data.map(item => ({
		contradiction_type: item.contradiction_type ?? item.type ?? 'unknown',
		severity: item.severity ?? 'moderate',
		claim_a: item.claim_a ?? item.claimA ?? '',
		claim_b: item.claim_b ?? item.claimB ?? '',
		section_a: item.section_a ?? item.sectionA ?? null,
		section_b: item.section_b ?? item.sectionB ?? null,
		explanation: item.explanation ?? item.reason ?? '',
	}));
}


export async function runModelComparisonBenchmark(userId: string): Promise<void> {
	const pairs = await loadGroundTruth();
	if (!pairs.length) throw new Error('No ground truth pairs found — run import:ground-truth first');

	const positivePairs = pairs.filter(p => p.isContradiction);
	logger.info({ total: pairs.length, positives: positivePairs.length }, 'Starting model comparison benchmark');

	const { rows: pvRows } = await db.query(
		`SELECT id FROM prompt_templates
     WHERE task = 'detect_contradictions_financial' AND is_active = TRUE
     ORDER BY version DESC LIMIT 1`
	);
	const promptVersionId = pvRows[0]?.id;
	if (!promptVersionId) throw new Error('No active prompt for detect_contradictions_financial');

	const groundTruthLabels = positivePairs.map(p => ({
		docAId: p.docAId,
		docBId: p.docBId,
		contradictionType: p.contradictionType ?? 'unknown',
	}));

	const modelTargets = getUniqueBenchmarkModels();
	logger.info(
		{ configuredModels: modelTargets.map(target => target.model), configuredTargetCount: modelTargets.length },
		'Resolved unique benchmark models'
	);

	for (const { modelLabel, model, skippedDuplicateLabels } of modelTargets) {
		logger.info({ model, modelLabel }, 'Running benchmark for model');
		const probe = await llmCall({
			task: 'classify_severity',
			messages: [{ role: 'user', content: 'Test probe. Reply: ok' }],
			userId,
			promptVersionId,
			modelOverride: model,
			maxTokens: 10,
		});
		if (probe.finishReason === 'error') {
			logger.error({ model, error: probe.error }, 'Model probe failed — skipping benchmark model');
			continue;
		}

		const pairRun = await runPairsConcurrent(pairs, getBenchmarkConcurrency(), async pair => {
			const result = await detectForPair(
				pair.docAId, pair.docBId,
				pair.docAFilename, pair.docBFilename,
				model, promptVersionId, userId
			);
			return {
				...result,
				detected: result.types.map(contradictionType => ({
					docAId: pair.docAId, docBId: pair.docBId, contradictionType,
				})),
			};
		});
		const pairResults = pairRun.results;
		const detected = pairResults.flatMap(result => result.detected);
		const failureStats = countFailed(pairResults);

		const metrics = computeF1(groundTruthLabels, detected);

		await saveBenchmarkRun({
			runBy: userId,
			benchmarkType: 'model_comparison',
			promptVersionId,
			parameters: {
				model,
				modelLabel,
				k: 5,
				thresholdUsed: 0,
				benchmarkConcurrency: getBenchmarkConcurrency(),
				skippedDuplicateLabels,
			},
			metrics: {
				...metrics,
				model,
				evaluatedPairs: pairs.length,
				benchmarkAborted: pairRun.aborted,
				abortReason: pairRun.abortReason,
				...failureStats,
			},
			totalSamples: pairs.length,
			notes: `Model comparison: ${model} on ${pairs.length} labeled pairs`,
		});

		logger.info({ model, f1: metrics.f1, precision: metrics.precision, recall: metrics.recall },
			'Model benchmark complete');
	}
}

export async function runChunkingStrategyBenchmark(
	collectionIds: Record<string, string>,
	userId: string
): Promise<void> {
	const pairs = await loadGroundTruth();
	const positivePairs = pairs.filter(p => p.isContradiction);

	const { rows: pvRows } = await db.query(
		`SELECT id FROM prompt_templates
     WHERE task = 'detect_contradictions_financial' AND is_active = TRUE
     ORDER BY version DESC LIMIT 1`
	);
	const promptVersionId = pvRows[0]?.id;
	if (!promptVersionId) throw new Error('No active prompt');

	const groundTruthLabels = positivePairs.map(p => ({
		docAId: p.docAId, docBId: p.docBId, contradictionType: p.contradictionType ?? 'unknown',
	}));

	for (const [strategy, collectionId] of Object.entries(collectionIds)) {
		logger.info({ strategy, collectionId }, 'Running chunking benchmark for strategy');


		const { rows: collDocs } = await db.query(
			'SELECT id, filename FROM documents WHERE collection_id = $1 AND status = $2',
			[collectionId, 'ready']
		);
		const filenameToId = new Map(collDocs.map(d => [d.filename, d.id]));

		const eligiblePairs = pairs.filter(pair =>
			filenameToId.has(pair.docAFilename) && filenameToId.has(pair.docBFilename)
		);
		const pairRun = await runPairsConcurrent(eligiblePairs, getBenchmarkConcurrency(), async pair => {
			const resolvedAId = filenameToId.get(pair.docAFilename);
			const resolvedBId = filenameToId.get(pair.docBFilename);
			if (!resolvedAId || !resolvedBId) {
				return { types: [], failed: false, detected: [] };
			}

			const result = await detectForPair(
				resolvedAId, resolvedBId,
				pair.docAFilename, pair.docBFilename,
				ModelConfig.heavy, promptVersionId, userId
			);
			return {
				...result,
				detected: result.types.map(contradictionType => ({
					docAId: pair.docAId, docBId: pair.docBId, contradictionType,
				})),
			};
		});
		const pairResults = pairRun.results;
		const detected = pairResults.flatMap(result => result.detected);
		const failureStats = countFailed(pairResults);

		const metrics = computeF1(groundTruthLabels, detected);

		await saveBenchmarkRun({
			runBy: userId,
			benchmarkType: 'chunking_strategy',
			promptVersionId,
			parameters: {
				strategy,
				collectionId,
				model: ModelConfig.heavy,
				benchmarkConcurrency: getBenchmarkConcurrency(),
			},
			metrics: {
				...metrics,
				strategy,
				evaluatedPairs: eligiblePairs.length,
				benchmarkAborted: pairRun.aborted,
				abortReason: pairRun.abortReason,
				...failureStats,
			},
			totalSamples: pairs.length,
			notes: `Chunking strategy benchmark: ${strategy}`,
		});

		logger.info({ strategy, f1: metrics.f1 }, 'Chunking benchmark complete');
	}
}


export async function runPromptSensitivityBenchmark(userId: string): Promise<void> {
	const pairs = await loadGroundTruth();
	const positivePairs = pairs.filter(p => p.isContradiction);


	const { rows: allVersions } = await db.query(
		`SELECT id, version FROM prompt_templates
     WHERE task = 'detect_contradictions_financial'
     ORDER BY version ASC`
	);

	if (allVersions.length < 2) {
		logger.warn('Prompt sensitivity benchmark requires at least 2 prompt versions — create more with POST /llm/prompts');
		return;
	}

	const groundTruthLabels = positivePairs.map(p => ({
		docAId: p.docAId, docBId: p.docBId, contradictionType: p.contradictionType ?? 'unknown',
	}));

	const f1ByVersion: Record<string, number> = {};
	const failedPairsByVersion: Record<string, number> = {};
	const failedPairErrorsByVersion: Record<string, Record<string, number>> = {};

	for (const pv of allVersions) {
		logger.info({ version: pv.version }, 'Running prompt sensitivity benchmark for version');

		const pairRun = await runPairsConcurrent(pairs, getBenchmarkConcurrency(), async pair => {
			const result = await detectForPair(
				pair.docAId, pair.docBId,
				pair.docAFilename, pair.docBFilename,
				ModelConfig.heavy, pv.id, userId
			);
			return {
				...result,
				detected: result.types.map(contradictionType => ({
					docAId: pair.docAId, docBId: pair.docBId, contradictionType,
				})),
			};
		});
		const pairResults = pairRun.results;
		const detected = pairResults.flatMap(result => result.detected);
		const failureStats = countFailed(pairResults);

		const metrics = computeF1(groundTruthLabels, detected);
		f1ByVersion[`v${pv.version}`] = metrics.f1;
		failedPairsByVersion[`v${pv.version}`] = failureStats.failedPairCount;
		failedPairErrorsByVersion[`v${pv.version}`] = failureStats.failedPairErrors;
		if (pairRun.aborted) {
			failedPairErrorsByVersion[`v${pv.version}`].benchmarkAborted = 1;
		}

		logger.info({ version: pv.version, f1: metrics.f1, ...failureStats }, 'Version benchmark result');
	}

	const f1Values = Object.values(f1ByVersion);
	const delta = Math.max(...f1Values) - Math.min(...f1Values);


	const activeVersion = allVersions[allVersions.length - 1];

	await saveBenchmarkRun({
		runBy: userId,
		benchmarkType: 'prompt_sensitivity',
		promptVersionId: activeVersion.id,
		parameters: { versionsCompared: allVersions.map(v => v.version), model: ModelConfig.heavy },
		metrics: { f1ByVersion, delta, failedPairsByVersion, failedPairErrorsByVersion },
		totalSamples: pairs.length,
		notes: `Prompt sensitivity across ${allVersions.length} versions`,
	});

	logger.info({ f1ByVersion, delta }, 'Prompt sensitivity benchmark complete');
}

/**
 * Hallucination benchmark.
 * Runs the LLM on NEGATIVE pairs (is_contradiction = false).
 * Any detection on a negative pair is a hallucination (false positive).
 */
export async function runHallucinationBenchmark(userId: string): Promise<void> {
	const allPairs = await loadGroundTruth();
	const negativePairs = allPairs.filter(p => !p.isContradiction);

	logger.info({ negativeCount: negativePairs.length }, 'Running hallucination benchmark');

	const { rows: pvRows } = await db.query(
		`SELECT id FROM prompt_templates
     WHERE task = 'detect_contradictions_financial' AND is_active = TRUE
     ORDER BY version DESC LIMIT 1`
	);
	const promptVersionId = pvRows[0]?.id;
	if (!promptVersionId) throw new Error('No active prompt');

	const f1PerModel: Record<string, number> = {};
	let totalSamples = negativePairs.length;

	const failedPairsByModel: Record<string, number> = {};
	const abortedByModel: Record<string, boolean> = {};
	const abortReasonByModel: Record<string, string | undefined> = {};

	for (const { model } of getUniqueBenchmarkModels()) {
		const pairRun = await runPairsConcurrent(negativePairs, getBenchmarkConcurrency(), async pair => {
			return detectForPair(
				pair.docAId, pair.docBId,
				pair.docAFilename, pair.docBFilename,
				model, promptVersionId, userId
			);
		});
		const detections = pairRun.results;
		const hallucinationCount = detections.filter(result => result.types.length > 0).length;
		const failureStats = countFailed(detections);
		failedPairsByModel[model] = failureStats.failedPairCount + (pairRun.aborted ? 1 : 0);
		abortedByModel[model] = pairRun.aborted;
		abortReasonByModel[model] = pairRun.abortReason;

		const fpr = negativePairs.length > 0 ? hallucinationCount / negativePairs.length : 0;
		f1PerModel[model] = Math.round((1 - fpr) * 10000) / 10000;

		logger.info({ model, hallucinationCount, fpr, ...failureStats }, 'Hallucination result');
	}

	await saveBenchmarkRun({
		runBy: userId,
		benchmarkType: 'hallucination',
		promptVersionId,
		parameters: { negativeCount: negativePairs.length, benchmarkConcurrency: getBenchmarkConcurrency() },
		metrics: { f1_per_model: f1PerModel, failedPairsByModel, abortedByModel, abortReasonByModel, total_samples: totalSamples },
		totalSamples,
		notes: 'Hallucination (false positive rate on negative pairs)',
	});
}
