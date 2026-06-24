// backend/src/services/groundTruth.service.ts

import { z } from 'zod';
import { db } from '../db/pool';
import { llmCall } from '../lib/llm/llm.client';
import { ModelConfig } from '../lib/llm/model.router';
import { buildPrompt } from '../lib/llm/prompt.builder';
import { logger } from '../lib/logger';
import { computeF1, ContradictionMetrics, saveBenchmarkRun } from './benchmark.service';

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

interface GroundTruthPair {
	docAId: string;
	docBId: string;
	docAFilename: string;
	docBFilename: string;
	contradictionType: string | null;
	isContradiction: boolean;
}

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

async function detectForPair(
	docAId: string,
	docBId: string,
	docAName: string,
	docBName: string,
	modelOverride: string,
	promptVersionId: string,
	userId: string
): Promise<string[]> {

	const { rows: chunksA } = await db.query(
		`SELECT chunk_text, chunk_index FROM chunks WHERE document_id = $1 ORDER BY chunk_index LIMIT 5`,
		[docAId]
	);
	const { rows: chunksB } = await db.query(
		`SELECT chunk_text, chunk_index FROM chunks WHERE document_id = $1 ORDER BY chunk_index LIMIT 5`,
		[docBId]
	);

	if (!chunksA.length || !chunksB.length) return [];

	const contextA = chunksA.map(c => `[§${c.chunk_index}] ${c.chunk_text}`).join('\n\n');
	const contextB = chunksB.map(c => `[§${c.chunk_index}] ${c.chunk_text}`).join('\n\n');

	const { body } = await buildPrompt('detect_contradictions_financial', {
		doc_a_name: docAName,
		doc_b_name: docBName,
		chunks_a: contextA,
		chunks_b: contextB,
	});

	const response = await llmCall({
		task: 'detect_contradictions_financial',
		messages: [{ role: 'user', content: body }],
		userId,
		promptVersionId,
		maxTokens: 2_048,
		temperature: 0.1,
	});

	if (response.finishReason === 'error' || !response.structured) return [];

	const parsed = ContradictionsOutputSchema.safeParse(response.structured);
	if (!parsed.success) return [];

	return parsed.data.contradictions.map(c => c.contradiction_type);
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

	for (const [modelLabel, modelKey] of [
		['heavy', 'heavy'],
		['mid', 'mid'],
		['fast', 'fast'],
	] as const) {
		const model = ModelConfig[modelKey];
		logger.info({ model, modelLabel }, 'Running benchmark for model');

		const detected: { docAId: string; docBId: string; contradictionType: string }[] = [];

		for (const pair of pairs) {
			const types = await detectForPair(
				pair.docAId, pair.docBId,
				pair.docAFilename, pair.docBFilename,
				model, promptVersionId, userId
			);
			for (const t of types) {
				detected.push({ docAId: pair.docAId, docBId: pair.docBId, contradictionType: t });
			}
		}

		const metrics = computeF1(groundTruthLabels, detected);

		await saveBenchmarkRun({
			runBy: userId,
			benchmarkType: 'model_comparison',
			promptVersionId,
			parameters: { model, modelLabel, k: 5, thresholdUsed: 0 },
			metrics: { ...metrics, model },
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

		const detected: { docAId: string; docBId: string; contradictionType: string }[] = [];

		for (const pair of pairs) {
			const resolvedAId = filenameToId.get(pair.docAFilename);
			const resolvedBId = filenameToId.get(pair.docBFilename);
			if (!resolvedAId || !resolvedBId) continue;

			const types = await detectForPair(
				resolvedAId, resolvedBId,
				pair.docAFilename, pair.docBFilename,
				ModelConfig.heavy, promptVersionId, userId
			);
			for (const t of types) {
				detected.push({ docAId: pair.docAId, docBId: pair.docBId, contradictionType: t });
			}
		}

		const metrics = computeF1(groundTruthLabels, detected);

		await saveBenchmarkRun({
			runBy: userId,
			benchmarkType: 'chunking_strategy',
			promptVersionId,
			parameters: { strategy, collectionId, model: ModelConfig.heavy },
			metrics: { ...metrics, strategy },
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

	for (const pv of allVersions) {
		logger.info({ version: pv.version }, 'Running prompt sensitivity benchmark for version');

		const detected: { docAId: string; docBId: string; contradictionType: string }[] = [];

		for (const pair of pairs) {
			const types = await detectForPair(
				pair.docAId, pair.docBId,
				pair.docAFilename, pair.docBFilename,
				ModelConfig.heavy, pv.id, userId
			);
			for (const t of types) {
				detected.push({ docAId: pair.docAId, docBId: pair.docBId, contradictionType: t });
			}
		}

		const metrics = computeF1(groundTruthLabels, detected);
		f1ByVersion[`v${pv.version}`] = metrics.f1;

		logger.info({ version: pv.version, f1: metrics.f1 }, 'Version benchmark result');
	}

	const f1Values = Object.values(f1ByVersion);
	const delta = Math.max(...f1Values) - Math.min(...f1Values);


	const activeVersion = allVersions[allVersions.length - 1];

	await saveBenchmarkRun({
		runBy: userId,
		benchmarkType: 'prompt_sensitivity',
		promptVersionId: activeVersion.id,
		parameters: { versionsCompared: allVersions.map(v => v.version), model: ModelConfig.heavy },
		metrics: { f1ByVersion, delta },
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

	for (const [modelLabel, modelKey] of [['heavy', 'heavy'], ['mid', 'mid'], ['fast', 'fast']] as const) {
		const model = ModelConfig[modelKey];
		let hallucinationCount = 0;

		for (const pair of negativePairs) {
			const types = await detectForPair(
				pair.docAId, pair.docBId,
				pair.docAFilename, pair.docBFilename,
				model, promptVersionId, userId
			);
			if (types.length > 0) hallucinationCount++;
		}

		const fpr = negativePairs.length > 0 ? hallucinationCount / negativePairs.length : 0;
		f1PerModel[model] = Math.round((1 - fpr) * 10000) / 10000;

		logger.info({ model, hallucinationCount, fpr }, 'Hallucination result');
	}

	await saveBenchmarkRun({
		runBy: userId,
		benchmarkType: 'hallucination',
		promptVersionId,
		parameters: { negativeCount: negativePairs.length },
		metrics: { f1_per_model: f1PerModel, total_samples: totalSamples },
		totalSamples,
		notes: 'Hallucination (false positive rate on negative pairs)',
	});
}
