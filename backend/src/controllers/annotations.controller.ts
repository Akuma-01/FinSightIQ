import { Request, Response } from 'express';
import { z } from 'zod';
import { AppError, asyncHandler } from '../middleware/error.middleware';
import * as Annotations from '../services/annotation.service';

const CreateSchema = z.object({
	body: z.string().min(1).max(4_000),
	annotationType: z.enum(['comment', 'flag', 'question']).default('comment'),
	chunkId: z.uuid().optional(),
});

const UpdateSchema = z.object({
	body: z.string().min(1).max(4_000).optional(),
	isResolved: z.boolean().optional(),
});

function getUuidParam(req: Request, name: string): string {
	const parsed = z.uuid().safeParse(req.params[name]);
	if (!parsed.success) throw new AppError(400, `Invalid ${name}`);
	return parsed.data;
}

export const list = asyncHandler(async (req: Request, res: Response) => {
	const documentId = getUuidParam(req, 'documentId');
	const collectionId = getUuidParam(req, 'collectionId');
	const rows = await Annotations.listAnnotations(documentId, collectionId);
	res.json({ annotations: rows });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
	const parsed = CreateSchema.safeParse(req.body);
	if (!parsed.success) throw new AppError(400, parsed.error.message);

	const documentId = getUuidParam(req, 'documentId');
	const collectionId = getUuidParam(req, 'collectionId');
	const annotation = await Annotations.createAnnotation({
		documentId,
		collectionId,
		createdBy: req.user!.id,
		body: parsed.data.body,
		annotationType: parsed.data.annotationType,
		chunkId: parsed.data.chunkId,
	});
	res.status(201).json({ annotation });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
	const parsed = UpdateSchema.safeParse(req.body);
	if (!parsed.success) throw new AppError(400, parsed.error.message);

	const annotationId = getUuidParam(req, 'id');
	const collectionId = getUuidParam(req, 'collectionId');
	const documentId = getUuidParam(req, 'documentId');
	const annotation = await Annotations.updateAnnotation(
		annotationId,
		collectionId,
		documentId,
		parsed.data,
		req.user!.id,
		req.user!.role
	);
	res.json({ annotation });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
	const annotationId = getUuidParam(req, 'id');
	const collectionId = getUuidParam(req, 'collectionId');
	const documentId = getUuidParam(req, 'documentId');
	await Annotations.deleteAnnotation(
		annotationId,
		collectionId,
		documentId,
		req.user!.id,
		req.user!.role
	);
	res.json({ message: 'Annotation deleted' });
});
