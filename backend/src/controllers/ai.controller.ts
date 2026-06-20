import { Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/pool';
import { AppError, asyncHandler } from '../middleware/error.middleware';
import { scanQueue } from '../queue/scan.queue';
import { redis } from '../redis/client';
import * as Contradiction from '../services/contradiction.service';
import * as Search from '../services/search.service';
import * as Stale from '../services/stale.service';
import * as Summarize from '../services/summarize.service';

function getUuidParam(req: Request, name: string): string {
	const parsed = z.uuid().safeParse(req.params[name]);
	if (!parsed.success) throw new AppError(400, `Invalid ${name}`);
	return parsed.data;
}

// ── Contradiction ────────────────────────────────────────────────────────────

export const scanCollection = asyncHandler(async (req: Request, res: Response) => {
	const collectionId = getUuidParam(req, 'collectionId');
	const { rows } = await db.query(
		`SELECT COUNT(*)::int AS ready_count
		 FROM documents
		 WHERE collection_id = $1 AND status = 'ready'`,
		[collectionId]
	);
	if (rows[0].ready_count < 2) {
		throw new AppError(409, 'Collection needs at least 2 ready documents to scan');
	}

	const lockKey = `scan:lock:${collectionId}`;
	const acquired = await redis.set(lockKey, req.user!.id, 'EX', 30 * 60, 'NX');
	if (!acquired) {
		throw new AppError(409, 'A scan is already running for this collection. Wait for it to complete.');
	}

	try {
		const job = await scanQueue.add('scan', {
			collectionId,
			userId: req.user!.id,
			mode: 'full',
		});

		res.status(202).json({
			jobId: job.id,
			message: 'Scan queued - results will arrive via WebSocket',
		});
	} catch (err) {
		await redis.del(lockKey);
		throw err;
	}
});

export const scanTargeted = asyncHandler(async (req: Request, res: Response) => {
	const schema = z.object({
		docIdA: z.uuid(),
		docIdB: z.uuid(),
		collectionId: z.uuid(),
	});
	const parsed = schema.safeParse(req.body);
	if (!parsed.success) throw new AppError(400, parsed.error.message);
	if (parsed.data.docIdA === parsed.data.docIdB) {
		throw new AppError(400, 'docIdA and docIdB must be different documents');
	}

	const job = await scanQueue.add('scan', {
		collectionId: parsed.data.collectionId,
		userId: req.user!.id,
		mode: 'targeted',
		docIdA: parsed.data.docIdA,
		docIdB: parsed.data.docIdB,
	});

	res.status(202).json({
		jobId: job.id,
		message: 'Targeted scan queued',
	});
});

export const listContradictions = asyncHandler(async (req: Request, res: Response) => {
	const collectionId = getUuidParam(req, 'collectionId');
	const rows = await Contradiction.listContradictions(collectionId);
	res.json({ contradictions: rows });
});

export const resolveContradiction = asyncHandler(async (req: Request, res: Response) => {
	const contradictionId = getUuidParam(req, 'id');
	const row = await Contradiction.resolveContradiction(
		contradictionId,
		req.user!.id,
		req.user!.role
	);
	res.json({ contradiction: row });
});

// ── Stale References ─────────────────────────────────────────────────────────

export const listStaleRefs = asyncHandler(async (req: Request, res: Response) => {
	const collectionId = getUuidParam(req, 'collectionId');
	const rows = await Stale.listStaleReferences(collectionId);
	res.json({ staleReferences: rows });
});

export const resolveStaleRef = asyncHandler(async (req: Request, res: Response) => {
	const staleReferenceId = getUuidParam(req, 'id');
	const row = await Stale.resolveStaleReference(
		staleReferenceId,
		req.user!.id,
		req.user!.role
	);
	res.json({ staleReference: row });
});

export const search = asyncHandler(async (req: Request, res: Response) => {
	const schema = z.object({
		collectionId: z.string().uuid(),
		query: z.string().min(1).max(500),
	});
	const parsed = schema.safeParse(req.body);
	if (!parsed.success) throw new AppError(400, parsed.error.message);

	const result = await Search.semanticSearch(parsed.data.collectionId, parsed.data.query, req.user!.id);
	res.json(result);
});

export const summarizeDocument = asyncHandler(async (req: Request, res: Response) => {
	const documentId = getUuidParam(req, 'documentId');
	const result = await Summarize.summarizeDocument(documentId, req.user!.id);
	res.json(result);
});

export const summarizeCollection = asyncHandler(async (req: Request, res: Response) => {
	const collectionId = getUuidParam(req, 'collectionId');
	const result = await Summarize.summarizeCollection(collectionId, req.user!.id);
	res.json(result);
});

export const collectionSummary = asyncHandler(async (req: Request, res: Response) => {
	const collectionId = getUuidParam(req, 'id');
	const { rows } = await db.query(
		`SELECT
       COUNT(*) FILTER (WHERE severity = 'critical' AND NOT is_resolved) AS critical,
       COUNT(*) FILTER (WHERE severity = 'moderate' AND NOT is_resolved) AS moderate,
       COUNT(*) FILTER (WHERE severity = 'minor'    AND NOT is_resolved) AS minor,
       COUNT(*) FILTER (WHERE NOT is_resolved)                           AS unresolved,
       COUNT(*)                                                           AS total
     FROM contradictions WHERE collection_id = $1`,
		[collectionId]
	);

	const staleResult = await db.query(
		'SELECT COUNT(*) FILTER (WHERE NOT is_resolved) AS stale FROM stale_references WHERE collection_id = $1',
		[collectionId]
	);

	res.json({
		critical: Number(rows[0].critical),
		moderate: Number(rows[0].moderate),
		minor: Number(rows[0].minor),
		unresolved: Number(rows[0].unresolved),
		total: Number(rows[0].total),
		stale: parseInt(staleResult.rows[0].stale, 10),
	});
});
