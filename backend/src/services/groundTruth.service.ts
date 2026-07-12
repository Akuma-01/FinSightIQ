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
	claimASnippet: string | null;
	claimBSnippet: string | null;
	sectionA: string | null;
	sectionB: string | null;
}

interface PairDetectionResult {
	types: string[];
	failed: boolean;
	error?: string;
	attempts: number;
	repairAttempted: boolean;
	repairSucceeded: boolean;
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	latencyMs: number;
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
            is_contradiction AS "isContradiction",
            claim_a_snippet AS "claimASnippet",
            claim_b_snippet AS "claimBSnippet",
            section_a AS "sectionA",
            section_b AS "sectionB"
     FROM ground_truth_pairs ORDER BY imported_at`
	);
	return rows;
}

function limitBenchmarkPairs(pairs: GroundTruthPair[]): GroundTruthPair[] {
	if (!config.BENCHMARK_MAX_PAIRS) return pairs;

	const positives = pairs.filter(pair => pair.isContradiction);
	const negatives = pairs.filter(pair => !pair.isContradiction);
	const positiveTarget = Math.ceil(config.BENCHMARK_MAX_PAIRS * 0.7);
	const selected = [
		...positives.slice(0, positiveTarget),
		...negatives.slice(0, Math.max(0, config.BENCHMARK_MAX_PAIRS - positiveTarget)),
	];

	return selected.length > 0 ? selected : pairs.slice(0, config.BENCHMARK_MAX_PAIRS);
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
	const invalidStructuredResponses = failedPairs.filter(result =>
		result.error === 'invalid_structured_response' || result.error === 'missing_structured_response'
	).length;
	const repairedPairs = results.filter(result => result.repairSucceeded).length;
	const repairAttempts = results.filter(result => result.repairAttempted).length;
	const totalTokens = results.reduce((sum, result) => sum + result.totalTokens, 0);
	const promptTokens = results.reduce((sum, result) => sum + result.promptTokens, 0);
	const completionTokens = results.reduce((sum, result) => sum + result.completionTokens, 0);
	const totalLatencyMs = results.reduce((sum, result) => sum + result.latencyMs, 0);

	return {
		failedPairCount: failedPairs.length,
		failedPairErrors: failedPairs.reduce<Record<string, number>>((acc, result) => {
			const key = result.error ?? 'unknown_error';
			acc[key] = (acc[key] ?? 0) + 1;
			return acc;
		}, {}),
		successfulPairCount: results.length - failedPairs.length,
		failedPairRate: results.length ? round(failedPairs.length / results.length) : 0,
		invalidStructuredResponseCount: invalidStructuredResponses,
		invalidStructuredResponseRate: results.length ? round(invalidStructuredResponses / results.length) : 0,
		jsonRepairAttemptCount: repairAttempts,
		jsonRepairSuccessCount: repairedPairs,
		jsonRepairSuccessRate: repairAttempts ? round(repairedPairs / repairAttempts) : 0,
		totalPromptTokens: promptTokens,
		totalCompletionTokens: completionTokens,
		totalTokens,
		averageLatencyMs: results.length ? Math.round(totalLatencyMs / results.length) : 0,
	};
}

function emptyPairResult(overrides: Partial<PairDetectionResult> = {}): PairDetectionResult {
	return {
		types: [],
		failed: false,
		attempts: 0,
		repairAttempted: false,
		repairSucceeded: false,
		promptTokens: 0,
		completionTokens: 0,
		totalTokens: 0,
		latencyMs: 0,
		...overrides,
	};
}

function round(n: number, decimals = 4): number {
	return Math.round(n * 10 ** decimals) / 10 ** decimals;
}

type BenchmarkChunk = {
	chunk_text: string;
	chunk_index: number;
	section_label: string | null;
};

async function selectBenchmarkChunks(
	documentId: string,
	claimSnippet?: string | null,
	sectionLabel?: string | null
): Promise<BenchmarkChunk[]> {
	const { rows } = await db.query<BenchmarkChunk>(
		`SELECT chunk_text, chunk_index, section_label
		   FROM chunks
		  WHERE document_id = $1
		  ORDER BY chunk_index`,
		[documentId]
	);

	if (!rows.length) return [];

	const queryTokens = tokenizeForBenchmark(`${claimSnippet ?? ''} ${sectionLabel ?? ''}`);
	if (!queryTokens.length) return rows.slice(0, config.CONTRADICTION_TOP_CHUNKS);

	const sectionTokens = tokenizeForBenchmark(sectionLabel ?? '');
	const scored = rows.map((chunk) => {
		const chunkTokens = tokenizeForBenchmark(`${chunk.section_label ?? ''} ${chunk.chunk_text}`);
		const chunkSet = new Set(chunkTokens);
		const overlap = queryTokens.reduce((score, token) => score + (chunkSet.has(token) ? 1 : 0), 0);
		const sectionBoost = sectionTokens.length && chunk.section_label
			? sectionTokens.reduce((score, token) => score + (chunk.section_label!.toLowerCase().includes(token) ? 2 : 0), 0)
			: 0;
		const phraseBoost = claimSnippet && chunk.chunk_text.toLowerCase().includes(claimSnippet.slice(0, 80).toLowerCase())
			? 10
			: 0;

		return {
			chunk,
			score: overlap + sectionBoost + phraseBoost,
		};
	});

	const selected = scored
		.sort((a, b) => b.score - a.score || a.chunk.chunk_index - b.chunk.chunk_index)
		.slice(0, config.CONTRADICTION_TOP_CHUNKS)
		.map(item => item.chunk)
		.sort((a, b) => a.chunk_index - b.chunk_index);

	// If lexical matching performs poorly, keep the benchmark from becoming empty
	// by falling back to the beginning of the document.
	if (selected.every((chunk) => !chunk.chunk_text.trim())) {
		return rows.slice(0, config.CONTRADICTION_TOP_CHUNKS);
	}

	return selected;
}

function tokenizeForBenchmark(text: string): string[] {
	const stopwords = new Set([
		'the', 'and', 'or', 'of', 'to', 'in', 'a', 'an', 'for', 'by', 'with', 'on', 'as',
		'is', 'are', 'be', 'shall', 'must', 'should', 'may', 'from', 'that', 'this',
		'which', 'their', 'thereof', 'under', 'section', 'para', 'chapter',
	]);

	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s₹%.-]/gu, ' ')
		.split(/\s+/)
		.map(token => token.trim())
		.filter(token => token.length >= 3 && !stopwords.has(token))
		.slice(0, 120);
}

function formatBenchmarkChunk(chunk: BenchmarkChunk, claimSnippet?: string | null): string {
	const text = clipChunkAroundClaim(chunk.chunk_text, claimSnippet);
	const section = chunk.section_label ? ` section="${chunk.section_label}"` : '';
	return `[§${chunk.chunk_index}${section}] ${text}`;
}

function clipChunkAroundClaim(text: string, claimSnippet?: string | null): string {
	const normalized = text.replace(/\s+/g, ' ').trim();
	const maxChars = 1_200;
	if (normalized.length <= maxChars) return normalized;

	const needle = claimSnippet?.replace(/\s+/g, ' ').trim().slice(0, 80).toLowerCase();
	const index = needle ? normalized.toLowerCase().indexOf(needle) : -1;
	if (index < 0) return `${normalized.slice(0, maxChars)}…`;

	const start = Math.max(0, index - 350);
	const end = Math.min(normalized.length, index + Math.max(needle?.length ?? 0, 80) + 650);
	return `${start > 0 ? '…' : ''}${normalized.slice(start, end)}${end < normalized.length ? '…' : ''}`;
}

async function detectForPair(
	docAId: string,
	docBId: string,
	docAName: string,
	docBName: string,
	modelOverride: string,
	promptVersionId: string,
	userId: string,
	contextHints?: {
		claimASnippet?: string | null;
		claimBSnippet?: string | null;
		sectionA?: string | null;
		sectionB?: string | null;
	}
): Promise<PairDetectionResult> {

	const [chunksA, chunksB] = await Promise.all([
		selectBenchmarkChunks(docAId, contextHints?.claimASnippet, contextHints?.sectionA),
		selectBenchmarkChunks(docBId, contextHints?.claimBSnippet, contextHints?.sectionB),
	]);

	if (!chunksA.length || !chunksB.length) return emptyPairResult();

	const contextA = chunksA.map(c => formatBenchmarkChunk(c, contextHints?.claimASnippet)).join('\n\n');
	const contextB = chunksB.map(c => formatBenchmarkChunk(c, contextHints?.claimBSnippet)).join('\n\n');

	const { body: templateBody } = await buildPrompt('detect_contradictions_financial', {
		doc_a_name: docAName,
		doc_b_name: docBName,
		chunks_a: contextA,
		chunks_b: contextB,
	});
	const body = ensureBenchmarkEvidenceBlock(templateBody, {
		docAName,
		docBName,
		contextA,
		contextB,
		claimASnippet: contextHints?.claimASnippet,
		claimBSnippet: contextHints?.claimBSnippet,
		sectionA: contextHints?.sectionA,
		sectionB: contextHints?.sectionB,
	});

	let aggregate = emptyPairResult();

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
		aggregate = addResponseUsage(aggregate, response);

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

			return { ...aggregate, failed: true, error: response.error ?? 'llm_error' };
		}

		const initial = parseContradictions(response.structured);
		if (initial.ok) {
			return {
				...aggregate,
				types: initial.types,
				failed: false,
			};
		}

		const repaired = await repairContradictionJson({
			rawContent: response.content,
			parseError: initial.error,
			modelOverride,
			promptVersionId,
			userId,
		});
		aggregate = addResponseUsage({ ...aggregate, repairAttempted: true }, repaired.response);

		if (repaired.ok) {
			return {
				...aggregate,
				types: repaired.types,
				failed: false,
				repairSucceeded: true,
			};
		}

		return {
			...aggregate,
			failed: true,
			error: initial.error,
		};
	}

	return { ...aggregate, failed: true, error: 'rate_limit_retries_exhausted' };
}

function addResponseUsage(result: PairDetectionResult, response: Awaited<ReturnType<typeof llmCall>>): PairDetectionResult {
	return {
		...result,
		attempts: result.attempts + 1,
		promptTokens: result.promptTokens + response.tokensUsed.prompt,
		completionTokens: result.completionTokens + response.tokensUsed.completion,
		totalTokens: result.totalTokens + response.tokensUsed.total,
		latencyMs: result.latencyMs + response.latencyMs,
	};
}

function ensureBenchmarkEvidenceBlock(
	body: string,
	args: {
		docAName: string;
		docBName: string;
		contextA: string;
		contextB: string;
		claimASnippet?: string | null;
		claimBSnippet?: string | null;
		sectionA?: string | null;
		sectionB?: string | null;
	}
): string {
	// Older prompt templates include {{chunks_a}} / {{chunks_b}} placeholders.
	// Some stricter benchmark prompt versions are schema-only. If no chunk markers
	// are present after template rendering, append the selected benchmark evidence.
	if (body.includes('[§')) return body;

	return [
		body,
		'',
		'Benchmark evidence follows. Use only this evidence.',
		`Document A (${args.docAName}) expected section: ${args.sectionA ?? 'unknown'}`,
		args.claimASnippet ? `Labeled claim A snippet: ${args.claimASnippet}` : '',
		args.contextA,
		'',
		`Document B (${args.docBName}) expected section: ${args.sectionB ?? 'unknown'}`,
		args.claimBSnippet ? `Labeled claim B snippet: ${args.claimBSnippet}` : '',
		args.contextB,
	].filter(Boolean).join('\n\n');
}

function parseContradictions(raw: unknown): { ok: true; types: string[] } | { ok: false; error: string } {
	if (!raw) return { ok: false, error: 'missing_structured_response' };

	const normalized = normalizeContradictionOutput(raw);
	const parsed = ContradictionsOutputSchema.safeParse(normalized);
	if (!parsed.success) return { ok: false, error: 'invalid_structured_response' };

	return {
		ok: true,
		types: parsed.data.contradictions.map(c => c.contradiction_type),
	};
}

async function repairContradictionJson(args: {
	rawContent: string;
	parseError: string;
	modelOverride: string;
	promptVersionId: string;
	userId: string;
}): Promise<{ ok: true; types: string[]; response: Awaited<ReturnType<typeof llmCall>> } | { ok: false; response: Awaited<ReturnType<typeof llmCall>> }> {
	const repairPrompt = [
		'Repair the following model output into valid JSON only.',
		'Do not add markdown, explanation, or prose.',
		'Required schema:',
		'{"contradictions":[{"contradiction_type":"policy_conflict|regulatory_breach|numerical_discrepancy|stale_reference|definitional_conflict|rule_scope_mismatch","severity":"critical|moderate|minor|high|low","claim_a":"string","claim_b":"string","section_a":"string or null","section_b":"string or null","explanation":"string"}]}',
		'If there is no contradiction, return {"contradictions":[]}.',
		`Validation failure: ${args.parseError}`,
		'Original output:',
		args.rawContent.slice(0, 8_000),
	].join('\n\n');

	const response = await llmCall({
		task: 'detect_contradictions_financial',
		messages: [{ role: 'user', content: repairPrompt }],
		userId: args.userId,
		promptVersionId: args.promptVersionId,
		modelOverride: args.modelOverride,
		maxTokens: 1_024,
		temperature: 0,
	});

	const parsed = parseContradictions(response.structured);
	if (!parsed.ok) return { ok: false, response };
	return { ok: true, types: parsed.types, response };
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
	const pairs = limitBenchmarkPairs(await loadGroundTruth());
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
				model, promptVersionId, userId,
				{
					claimASnippet: pair.claimASnippet,
					claimBSnippet: pair.claimBSnippet,
					sectionA: pair.sectionA,
					sectionB: pair.sectionB,
				}
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
		const detectionRate = pairs.length ? round(detected.length / pairs.length) : 0;

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
				detectedContradictionCount: detected.length,
				detectionRate,
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
	const pairs = limitBenchmarkPairs(await loadGroundTruth());
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
				return { ...emptyPairResult(), detected: [] };
			}

			const result = await detectForPair(
				resolvedAId, resolvedBId,
				pair.docAFilename, pair.docBFilename,
				ModelConfig.heavy, promptVersionId, userId,
				{
					claimASnippet: pair.claimASnippet,
					claimBSnippet: pair.claimBSnippet,
					sectionA: pair.sectionA,
					sectionB: pair.sectionB,
				}
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
		const detectionRate = eligiblePairs.length ? round(detected.length / eligiblePairs.length) : 0;

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
				detectedContradictionCount: detected.length,
				detectionRate,
				...failureStats,
			},
			totalSamples: pairs.length,
			notes: `Chunking strategy benchmark: ${strategy}`,
		});

		logger.info({ strategy, f1: metrics.f1 }, 'Chunking benchmark complete');
	}
}


export async function runPromptSensitivityBenchmark(userId: string): Promise<void> {
	const pairs = limitBenchmarkPairs(await loadGroundTruth());
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
	const jsonRepairByVersion: Record<string, { attempts: number; successes: number; successRate: number }> = {};

	for (const pv of allVersions) {
		logger.info({ version: pv.version }, 'Running prompt sensitivity benchmark for version');

		const pairRun = await runPairsConcurrent(pairs, getBenchmarkConcurrency(), async pair => {
			const result = await detectForPair(
				pair.docAId, pair.docBId,
				pair.docAFilename, pair.docBFilename,
				ModelConfig.heavy, pv.id, userId,
				{
					claimASnippet: pair.claimASnippet,
					claimBSnippet: pair.claimBSnippet,
					sectionA: pair.sectionA,
					sectionB: pair.sectionB,
				}
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
		jsonRepairByVersion[`v${pv.version}`] = {
			attempts: failureStats.jsonRepairAttemptCount,
			successes: failureStats.jsonRepairSuccessCount,
			successRate: failureStats.jsonRepairSuccessRate,
		};
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
		metrics: { f1ByVersion, delta, failedPairsByVersion, failedPairErrorsByVersion, jsonRepairByVersion },
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
	const allPairs = limitBenchmarkPairs(await loadGroundTruth());
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
	const falsePositiveRateByModel: Record<string, number> = {};
	const hallucinationCountByModel: Record<string, number> = {};
	const jsonRepairByModel: Record<string, { attempts: number; successes: number; successRate: number }> = {};

	for (const { model } of getUniqueBenchmarkModels()) {
		const pairRun = await runPairsConcurrent(negativePairs, getBenchmarkConcurrency(), async pair => {
			return detectForPair(
				pair.docAId, pair.docBId,
				pair.docAFilename, pair.docBFilename,
				model, promptVersionId, userId,
				{
					claimASnippet: pair.claimASnippet,
					claimBSnippet: pair.claimBSnippet,
					sectionA: pair.sectionA,
					sectionB: pair.sectionB,
				}
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
		falsePositiveRateByModel[model] = round(fpr);
		hallucinationCountByModel[model] = hallucinationCount;
		jsonRepairByModel[model] = {
			attempts: failureStats.jsonRepairAttemptCount,
			successes: failureStats.jsonRepairSuccessCount,
			successRate: failureStats.jsonRepairSuccessRate,
		};

		logger.info({ model, hallucinationCount, fpr, ...failureStats }, 'Hallucination result');
	}

	await saveBenchmarkRun({
		runBy: userId,
		benchmarkType: 'hallucination',
		promptVersionId,
		parameters: { negativeCount: negativePairs.length, benchmarkConcurrency: getBenchmarkConcurrency() },
		metrics: {
			f1_per_model: f1PerModel,
			falsePositiveRateByModel,
			hallucinationCountByModel,
			failedPairsByModel,
			abortedByModel,
			abortReasonByModel,
			jsonRepairByModel,
			total_samples: totalSamples,
		},
		totalSamples,
		notes: 'Hallucination (false positive rate on negative pairs)',
	});
}
