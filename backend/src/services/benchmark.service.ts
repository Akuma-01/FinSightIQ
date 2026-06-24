import { db } from '../db/pool';

// ─── Metric types ────────────────────────────────────────────────────────────

export interface RetrievalMetrics {
	precisionAtK: number;
	recallAtK: number;
	mrr: number;
	k: number;
	queryCount: number;
}

export interface ContradictionMetrics {
	f1: number;
	precision: number;
	recall: number;
	tp: number;
	fp: number;
	fn: number;
	totalPairs: number;
}

export interface PreFilterMetrics {
	totalPairs: number;
	passedFilter: number;
	discardedPairs: number;
	efficiency: number;
}

export function computeF1(
	groundTruth: { docAId: string; docBId: string; contradictionType: string }[],
	detected: { docAId: string; docBId: string; contradictionType: string }[]
): ContradictionMetrics {
	const gtSet = new Set(groundTruth.map(g => `${g.docAId}|${g.docBId}|${g.contradictionType}`));
	const detSet = new Set(detected.map(d => `${d.docAId}|${d.docBId}|${d.contradictionType}`));

	const gtSymSet = new Set([
		...groundTruth.map(g => `${g.docAId}|${g.docBId}|${g.contradictionType}`),
		...groundTruth.map(g => `${g.docBId}|${g.docAId}|${g.contradictionType}`),
	]);

	let tp = 0, fp = 0, fn = 0;

	for (const d of detSet) {
		if (gtSymSet.has(d)) tp++;
		else fp++;
	}
	for (const g of gtSet) {
		const [a, b, t] = g.split('|');
		if (!detSet.has(g) && !detSet.has(`${b}|${a}|${t}`)) fn++;
	}

	const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
	const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
	const f1 = precision + recall > 0
		? 2 * precision * recall / (precision + recall) : 0;

	return {
		f1: round(f1), precision: round(precision), recall: round(recall),
		tp, fp, fn, totalPairs: groundTruth.length,
	};
}

// ─── Precision@k / Recall@k / MRR ────────────────────────────────────────────

export function computeRetrievalMetrics(
	queries: {
		queryText: string;
		relevantChunkIds: string[];
		retrievedChunkIds: string[];
	}[],
	k: number
): RetrievalMetrics {
	if (!queries.length) return { precisionAtK: 0, recallAtK: 0, mrr: 0, k, queryCount: 0 };

	let totalPrecision = 0;
	let totalRecall = 0;
	let totalRR = 0;

	for (const q of queries) {
		const topK = q.retrievedChunkIds.slice(0, k);
		const relevant = new Set(q.relevantChunkIds);
		const hits = topK.filter(id => relevant.has(id));

		const precision = hits.length / k;
		const recall = relevant.size > 0 ? hits.length / relevant.size : 0;

		totalPrecision += precision;
		totalRecall += recall;

		// MRR: reciprocal rank of the first relevant result
		const firstHitRank = topK.findIndex(id => relevant.has(id));
		totalRR += firstHitRank >= 0 ? 1 / (firstHitRank + 1) : 0;
	}

	return {
		precisionAtK: round(totalPrecision / queries.length),
		recallAtK: round(totalRecall / queries.length),
		mrr: round(totalRR / queries.length),
		k,
		queryCount: queries.length,
	};
}

export async function computePreFilterMetrics(
	collectionId: string,
	threshold: number
): Promise<PreFilterMetrics> {
	const { rows: docs } = await db.query(
		`SELECT id FROM documents WHERE collection_id = $1 AND status = 'ready'`,
		[collectionId]
	);

	const n = docs.length;
	const totalPairs = (n * (n - 1)) / 2;
	if (totalPairs === 0) return { totalPairs: 0, passedFilter: 0, discardedPairs: 0, efficiency: 0 };

	const { rows } = await db.query(
		`WITH centroids AS (
       SELECT document_id,
              (SELECT AVG(embedding::float[]) FROM chunks WHERE document_id = c.document_id)
              AS centroid
       FROM chunks c
       GROUP BY document_id
     ),
     pairs AS (
       SELECT a.document_id AS doc_a, b.document_id AS doc_b
       FROM centroids a, centroids b
       WHERE a.document_id < b.document_id
         AND a.document_id IN (SELECT id FROM documents WHERE collection_id = $1)
         AND b.document_id IN (SELECT id FROM documents WHERE collection_id = $1)
     )
     SELECT COUNT(*) AS passed
     FROM pairs p
     JOIN centroids ca ON ca.document_id = p.doc_a
     JOIN centroids cb ON cb.document_id = p.doc_b`,
		[collectionId]
	);

	const passed = parseInt(rows[0]?.passed ?? '0', 10);
	const discarded = totalPairs - passed;

	return {
		totalPairs,
		passedFilter: passed,
		discardedPairs: discarded,
		efficiency: round(discarded / totalPairs),
	};
}

function round(n: number, decimals = 4): number {
	return Math.round(n * 10 ** decimals) / 10 ** decimals;
}

// ─── Persist benchmark run ───────────────────────────────────────────────────
export async function saveBenchmarkRun(data: {
	runBy: string;
	benchmarkType: 'chunking_strategy' | 'model_comparison' | 'hallucination' | 'prompt_sensitivity';
	promptVersionId: string;
	parameters: Record<string, unknown>;
	metrics: Record<string, unknown>;
	totalSamples: number;
	notes?: string;
}) {
	const { rows } = await db.query(
		`INSERT INTO benchmark_runs
       (run_by, benchmark_type, prompt_version_id, parameters, metrics, total_samples, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
		[
			data.runBy, data.benchmarkType, data.promptVersionId,
			JSON.stringify(data.parameters), JSON.stringify(data.metrics),
			data.totalSamples, data.notes ?? null,
		]
	);
	return rows[0];
}
