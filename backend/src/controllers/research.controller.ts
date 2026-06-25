import { stringify as csvStringify } from 'csv-stringify';
import { Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/pool';
import { logger } from '../lib/logger';
import { AppError, asyncHandler } from '../middleware/error.middleware';
import * as GroundTruthService from '../services/groundTruth.service';

export const getMetrics = asyncHandler(async (_req: Request, res: Response) => {

	const { rows: runs } = await db.query(
		`SELECT benchmark_type, metrics, parameters, total_samples, created_at,
            prompt_version_id
     FROM benchmark_runs ORDER BY created_at DESC`
	);

	// Latest F1 per model(from model comparison runs)
	const modelRuns = runs.filter(r => r.benchmark_type === 'model_comparison');
	const latestF1: Record<string, number> = {};
	for (const run of modelRuns) {
		const model = (run.metrics as any).model;
		if (model && !latestF1[model]) latestF1[model] = (run.metrics as any).f1;
	}

	// Latest Precision@k (from chunkingstrategy runs)
	const chunkRuns = runs.filter(r => r.benchmark_type === 'chunking_strategy');

	const { rows: logStats } = await db.query(
		`SELECT task, model,
            AVG(latency_ms)::INT       AS avg_latency_ms,
            AVG(prompt_tokens)::INT    AS avg_prompt_tokens,
            AVG(completion_tokens)::INT AS avg_completion_tokens,
            COUNT(*)                   AS call_count,
            COUNT(*) FILTER (WHERE finish_reason = 'error') AS error_count
     FROM llm_logs
     WHERE created_at > NOW() - INTERVAL '7 days'
     GROUP BY task, model ORDER BY task, model`
	);

	res.json({
		latestF1ByModel: latestF1,
		benchmarkRunCount: runs.length,
		recentLogStats: logStats,
		chunkingResults: chunkRuns.map(r => ({
			strategy: (r.parameters as any).strategy,
			f1: (r.metrics as any).f1,
			date: r.created_at,
		})),
	});
});

export const getHallucination = asyncHandler(async (_req: Request, res: Response) => {
	const { rows } = await db.query(
		`SELECT metrics, parameters, total_samples, created_at
     FROM benchmark_runs WHERE benchmark_type = 'hallucination'
     ORDER BY created_at DESC LIMIT 10`
	);
	res.json({ hallucinationRuns: rows });
});

export const runBenchmark = asyncHandler(async (req: Request, res: Response) => {
	const schema = z.object({
		benchmarkType: z.enum(['chunking_strategy', 'model_comparison', 'hallucination', 'prompt_sensitivity']),
		// For chunking_strategy benchmark only:
		collectionIds: z.record(z.string(), z.string().uuid()).optional(),
		notes: z.string().optional(),
	});
	const parsed = schema.safeParse(req.body);
	if (!parsed.success) throw new AppError(400, parsed.error.message);

	const { benchmarkType, collectionIds } = parsed.data;


	res.status(202).json({
		message: `Benchmark '${benchmarkType}' started — check GET /api/research/benchmark/history for results`,
		benchmarkType,
	});

	setImmediate(async () => {
		try {
			switch (benchmarkType) {
				case 'model_comparison':
					await GroundTruthService.runModelComparisonBenchmark(req.user!.id);
					break;
				case 'chunking_strategy':
					if (!collectionIds || Object.keys(collectionIds).length === 0) {
						logger.error('chunking_strategy benchmark requires collectionIds map');
						return;
					}
					await GroundTruthService.runChunkingStrategyBenchmark(collectionIds, req.user!.id);
					break;
				case 'hallucination':
					await GroundTruthService.runHallucinationBenchmark(req.user!.id);
					break;
				case 'prompt_sensitivity':
					await GroundTruthService.runPromptSensitivityBenchmark(req.user!.id);
					break;
			}
			logger.info({ benchmarkType }, 'Benchmark run complete');
		} catch (err) {
			logger.error({ err, benchmarkType }, 'Benchmark run failed');
		}
	});
});

export const getBenchmarkHistory = asyncHandler(async (req: Request, res: Response) => {
	const schema = z.object({
		type: z.enum(['chunking_strategy', 'model_comparison', 'hallucination', 'prompt_sensitivity']).optional(),
		promptVersionId: z.string().uuid().optional(),
		limit: z.coerce.number().int().min(1).max(100).default(50),
	});
	const q = schema.safeParse(req.query);
	if (!q.success) throw new AppError(400, q.error.message);

	const conditions: string[] = [];
	const values: unknown[] = [];
	let i = 1;

	if (q.data.type) { conditions.push(`benchmark_type = $${i++}`); values.push(q.data.type); }
	if (q.data.promptVersionId) { conditions.push(`prompt_version_id = $${i++}`); values.push(q.data.promptVersionId); }

	const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

	const { rows } = await db.query(
		`SELECT br.*, pt.version AS prompt_version_number, pt.task AS prompt_task
     FROM benchmark_runs br
     LEFT JOIN prompt_templates pt ON pt.id = br.prompt_version_id
     ${where}
     ORDER BY br.created_at DESC LIMIT $${i}`,
		[...values, q.data.limit]
	);

	res.json({ runs: rows });
});



export const exportData = asyncHandler(async (req: Request, res: Response) => {
	const schema = z.object({
		format: z.enum(['csv', 'json']).default('json'),
		benchmarkType: z.enum(['chunking_strategy', 'model_comparison', 'hallucination', 'prompt_sensitivity']).optional(),
		includeRaw: z.enum(['true', 'false']).default('false'),
	});
	const q = schema.safeParse(req.query);
	if (!q.success) throw new AppError(400, q.error.message);

	// Load benchmark runs
	const { rows: runs } = await db.query(
		q.data.benchmarkType
			? `SELECT br.*, pt.version, pt.task
         FROM benchmark_runs br
         LEFT JOIN prompt_templates pt ON pt.id = br.prompt_version_id
         WHERE br.benchmark_type = $1 ORDER BY br.created_at`
			: `SELECT br.*, pt.version, pt.task
         FROM benchmark_runs br
         LEFT JOIN prompt_templates pt ON pt.id = br.prompt_version_id
         ORDER BY br.created_at`,
		q.data.benchmarkType ? [q.data.benchmarkType] : []
	);

	let llmLogs: unknown[] = [];
	if (q.data.includeRaw === 'true') {
		const { rows: logs } = await db.query(
			`SELECT task, model, prompt_version_id, prompt_tokens, completion_tokens,
              latency_ms, finish_reason, created_at
       FROM llm_logs ORDER BY created_at`
		);
		llmLogs = logs;
	}

	const { rows: gtPairs } = await db.query(
		`SELECT doc_a_filename, doc_b_filename, contradiction_type,
            severity, is_contradiction, labeler_note, imported_at
     FROM ground_truth_pairs ORDER BY imported_at`
	).catch(() => ({ rows: [] }));

	const exportPayload = {
		exportedAt: new Date().toISOString(),
		benchmarkRuns: runs,
		groundTruthPairs: gtPairs,
		llmLogs: q.data.includeRaw === 'true' ? llmLogs : 'omitted (use ?includeRaw=true)',
		note: 'Dataset size limitation applies — see RESEARCH.md §6 before generalizing results.',
	};

	if (q.data.format === 'json') {
		res.setHeader('Content-Type', 'application/json');
		res.setHeader('Content-Disposition', `attachment; filename="finsightiq_research_${Date.now()}.json"`);
		res.json(exportPayload);
		return;
	}

	// CSV — flatten benchmark
	res.setHeader('Content-Type', 'text/csv');
	res.setHeader('Content-Disposition', `attachment; filename="finsightiq_benchmarks_${Date.now()}.csv"`);

	const csvRows = runs.map(r => {
		const m = r.metrics as Record<string, unknown>;
		return {
			id: r.id,
			benchmark_type: r.benchmark_type,
			prompt_version: r.version ?? '',
			prompt_task: r.task ?? '',
			total_samples: r.total_samples,
			created_at: r.created_at,
			notes: r.notes ?? '',
			f1: m.f1 ?? '',
			precision: m.precision ?? '',
			recall: m.recall ?? '',
			tp: m.tp ?? '',
			fp: m.fp ?? '',
			fn: m.fn ?? '',
			model: m.model ?? '',
			strategy: m.strategy ?? '',
			precision_at_k: m.precisionAtK ?? '',
			recall_at_k: m.recallAtK ?? '',
			mrr: m.mrr ?? '',
			delta: m.delta ?? '',
		};
	});

	const csvStream = csvStringify(csvRows, { header: true });
	csvStream.pipe(res);
});
