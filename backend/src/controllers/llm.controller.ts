import { Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/pool';
import { ModelConfig } from '../lib/llm/model.router';
import { AppError, asyncHandler } from '../middleware/error.middleware';
import * as PromptService from '../services/prompt.service';

export const getLogs = asyncHandler(async (req: Request, res: Response) => {
	const schema = z.object({
		task: z.string().optional(),
		model: z.string().optional(),
		promptVersionId: z.string().uuid().optional(),
		limit: z.coerce.number().int().min(1).max(500).default(100),
		offset: z.coerce.number().int().min(0).default(0),
	});
	const q = schema.safeParse(req.query);
	if (!q.success) throw new AppError(400, q.error.message);

	const conditions: string[] = [];
	const values: unknown[] = [];
	let i = 1;

	if (q.data.task) { conditions.push(`task = $${i++}`); values.push(q.data.task); }
	if (q.data.model) { conditions.push(`model = $${i++}`); values.push(q.data.model); }
	if (q.data.promptVersionId) { conditions.push(`prompt_version_id = $${i++}`); values.push(q.data.promptVersionId); }

	const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

	const { rows } = await db.query(
		`SELECT id, task, model, prompt_version_id, prompt_tokens, completion_tokens,
            latency_ms, finish_reason, error, response_truncated, created_at
     FROM llm_logs ${where}
     ORDER BY created_at DESC
     LIMIT $${i++} OFFSET $${i}`,
		[...values, q.data.limit, q.data.offset]
	);

	const { rows: countRows } = await db.query(
		`SELECT COUNT(*) AS total FROM llm_logs ${where}`,
		values
	);

	res.json({ logs: rows, total: parseInt(countRows[0].total, 10) });
});


export const getModels = asyncHandler(async (_req: Request, res: Response) => {
	res.json({ models: ModelConfig });
});

export const listPrompts = asyncHandler(async (req: Request, res: Response) => {
	const schema = z.object({
		task: z.string().optional(),
	});
	const q = schema.safeParse(req.query);
	if (!q.success) throw new AppError(400, q.error.message);

	const prompts = await PromptService.listPrompts(q.data.task);
	res.json({ prompts });
});

export const createPrompt = asyncHandler(async (req: Request, res: Response) => {
	const schema = z.object({
		task: z.string().min(1),
		body: z.string().min(10),
		description: z.string().min(1),
	});
	const parsed = schema.safeParse(req.body);
	if (!parsed.success) throw new AppError(400, parsed.error.message);

	const prompt = await PromptService.createPromptVersion(parsed.data);
	res.status(201).json({ prompt });
});

export const activatePrompt = asyncHandler(async (req: Request, res: Response) => {
	const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
	if (!params.success) throw new AppError(400, params.error.message);

	const prompt = await PromptService.activatePrompt(params.data.id);
	res.json({ prompt });
});
