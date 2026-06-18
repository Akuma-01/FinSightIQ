import { Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/pool';
import { AppError, asyncHandler } from '../middleware/error.middleware';
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
	const result = await Contradiction.scanCollection(collectionId, req.user!.id);
	res.json(result);
});

export const scanTargeted = asyncHandler(async (req: Request, res: Response) => {
	const schema = z.object({
		docIdA: z.uuid(),
		docIdB: z.uuid(),
		collectionId: z.uuid(),
	});
	const parsed = schema.safeParse(req.body);
	if (!parsed.success) throw new AppError(400, parsed.error.message);

	const result = await Contradiction.scanDocumentPairTargeted(
		parsed.data.docIdA, parsed.data.docIdB, parsed.data.collectionId, req.user!.id
	);
	res.json(result);
});

export const listContradictions = asyncHandler(async (req: Request, res: Response) => {
	const collectionId = getUuidParam(req, 'collectionId');
	const rows = await Contradiction.listContradictions(collectionId);
	res.json({ contradictions: rows });
});

export const resolveContradiction = asyncHandler(async (req: Request, res: Response) => {
	const contradictionId = getUuidParam(req, 'id');
	const row = await Contradiction.resolveContradiction(contradictionId, req.user!.id);
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
	const row = await Stale.resolveStaleReference(staleReferenceId, req.user!.id);
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
		...rows[0],
		stale: parseInt(staleResult.rows[0].stale, 10),
	});
});
