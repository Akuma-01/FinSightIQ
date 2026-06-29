import { stringify as csvStringify } from 'csv-stringify';
import { Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/pool';
import { AppError, asyncHandler } from '../middleware/error.middleware';
import { BenchmarkType, benchmarkQueue } from '../queue/benchmark.queue';
import { redis } from '../redis/client';

const VALID_STRATEGIES = ['fixed_256', 'fixed_512', 'sentence', 'section_aware'] as const;
const BENCHMARK_TYPES = ['chunking_strategy', 'model_comparison', 'hallucination', 'prompt_sensitivity'] as const;

export const getMetrics = asyncHandler(async (_req: Request, res: Response) => {

	const { rows: f1Rows } = await db.query(
		`SELECT DISTINCT ON (metrics->>'model')
            metrics->>'model' AS model,
            (metrics->>'f1')::float AS f1,
            created_at
     FROM benchmark_runs
     WHERE benchmark_type = 'model_comparison'
       AND metrics->>'model' IS NOT NULL
     ORDER BY metrics->>'model', created_at DESC`
	);
	const latestF1: Record<string, number> = {};
	for (const row of f1Rows) {
		latestF1[row.model] = Number(row.f1);
	}

	const [{ rows: countRows }, { rows: chunkRows }] = await Promise.all([
		db.query('SELECT COUNT(*) AS total FROM benchmark_runs'),
		db.query(
			`SELECT DISTINCT ON (parameters->>'strategy')
              parameters->>'strategy' AS strategy,
              (metrics->>'f1')::float AS f1,
              created_at
       FROM benchmark_runs
       WHERE benchmark_type = 'chunking_strategy'
       ORDER BY parameters->>'strategy', created_at DESC`
		),
	]);

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
		benchmarkRunCount: Number(countRows[0].total),
		recentLogStats: logStats,
		chunkingResults: chunkRows,
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
		benchmarkType: z.enum(BENCHMARK_TYPES),
		// For chunking_strategy benchmark only:
		collectionIds: z.partialRecord(z.enum(VALID_STRATEGIES), z.string().uuid()).optional(),
		notes: z.string().max(500).optional(),
	});
	const parsed = schema.safeParse(req.body);
	if (!parsed.success) throw new AppError(400, parsed.error.message);

	const { benchmarkType, collectionIds } = parsed.data;
	if (benchmarkType === 'chunking_strategy') {
		const ids = Object.values(collectionIds ?? {});
		if (ids.length === 0) {
			throw new AppError(400, 'chunking_strategy benchmark requires at least one collectionId');
		}
		if (req.user!.role !== 'admin') {
			const { rows } = await db.query<{ collection_id: string }>(
				`SELECT collection_id FROM collection_members
         WHERE user_id = $1 AND collection_id = ANY($2::uuid[])`,
				[req.user!.id, ids]
			);
			const accessibleIds = new Set(rows.map(row => row.collection_id));
			const forbidden = ids.filter(id => !accessibleIds.has(id));
			if (forbidden.length) {
				throw new AppError(403, `Not a member of collection(s): ${forbidden.join(', ')}`);
			}
		}
	}

	const lockKey = `benchmark:lock:${benchmarkType}`;
	let acquired = await redis.call('SET', lockKey, req.user!.id, 'EX', 60 * 60 * 2, 'NX');
	if (!acquired) {
		const existingLockOwner = await redis.get(lockKey);
		if (existingLockOwner) {
			const [activeJobs, waitingJobs, delayedJobs] = await Promise.all([
				benchmarkQueue.getActiveCount(),
				benchmarkQueue.getWaitingCount(),
				benchmarkQueue.getDelayedCount(),
			]);
			if (activeJobs + waitingJobs + delayedJobs > 0) {
				throw new AppError(409, `A ${benchmarkType} benchmark is already running (${activeJobs} active, ${waitingJobs} waiting, ${delayedJobs} delayed)`);
			}

			await redis.del(lockKey);
			acquired = await redis.call('SET', lockKey, req.user!.id, 'EX', 60 * 60 * 2, 'NX');
		}

		// Defensive retry: if SET NX returned a falsy value but the key is absent,
		// avoid leaving benchmark submission blocked by an inconsistent client state.
		acquired = await redis.call('SET', lockKey, req.user!.id, 'EX', 60 * 60 * 2, 'NX');
		if (!acquired) {
			const lockOwnerAfterRetry = await redis.get(lockKey);
			if (lockOwnerAfterRetry && lockOwnerAfterRetry !== req.user!.id) {
				throw new AppError(409, `A ${benchmarkType} benchmark is already running (lock still present after stale-lock retry)`);
			}
		}
	}

	try {
		const job = await benchmarkQueue.add('run', {
			benchmarkType: benchmarkType as BenchmarkType,
			userId: req.user!.id,
			collectionIds,
			notes: parsed.data.notes,
		});
		res.status(202).json({
			jobId: job.id,
			message: `${benchmarkType} benchmark queued — check GET /api/research/benchmark/history for results`,
		});
	} catch (err) {
		await redis.del(lockKey);
		throw err;
	}

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
		benchmarkType: z.enum(BENCHMARK_TYPES).optional(),
		includeRaw: z.enum(['true', 'false']).default('false'),
		limit: z.coerce.number().int().min(1).max(10_000).default(1_000),
	});
	const q = schema.safeParse(req.query);
	if (!q.success) throw new AppError(400, q.error.message);

	// Load benchmark runs
	const { rows: runs } = await db.query(
		q.data.benchmarkType
			? `SELECT br.*, pt.version, pt.task
         FROM benchmark_runs br
         LEFT JOIN prompt_templates pt ON pt.id = br.prompt_version_id
         WHERE br.benchmark_type = $1 ORDER BY br.created_at DESC LIMIT $2`
			: `SELECT br.*, pt.version, pt.task
         FROM benchmark_runs br
         LEFT JOIN prompt_templates pt ON pt.id = br.prompt_version_id
		 ORDER BY br.created_at DESC LIMIT $1`,
		q.data.benchmarkType ? [q.data.benchmarkType, q.data.limit] : [q.data.limit]
	);

	let llmLogs: unknown[] = [];
	if (q.data.includeRaw === 'true') {
		const { rows: logs } = await db.query(
			`SELECT task, model, prompt_version_id, prompt_tokens, completion_tokens,
              latency_ms, finish_reason, created_at
	       FROM llm_logs ORDER BY created_at DESC LIMIT 5000`
		);
		llmLogs = logs;
	}

	const { rows: gtPairs } = await db.query(
		`SELECT doc_a_filename, doc_b_filename, contradiction_type,
            severity, is_contradiction, labeler_note, imported_at
     FROM ground_truth_pairs ORDER BY imported_at DESC LIMIT $1`,
		[q.data.limit]
	).catch(() => ({ rows: [] as unknown[] }));

	const exportPayload = {
		exportedAt: new Date().toISOString(),
		rowCap: q.data.limit,
		benchmarkRuns: runs,
		benchmarkRunCount: runs.length,
		groundTruthPairs: gtPairs,
		groundTruthPairsCapped: gtPairs.length === q.data.limit,
		llmLogs: q.data.includeRaw === 'true' ? llmLogs : 'omitted (use ?includeRaw=true)',
		llmLogsCapped: q.data.includeRaw === 'true' && llmLogs.length === 5_000,
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
