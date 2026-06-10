import { Request, Response } from 'express';
import { z } from 'zod';
import { AppError, asyncHandler } from '../middleware/error.middleware';
import { uploadRateLimit } from '../middleware/rateLimit.middleware';
import { upload, verifyFileIntegrity } from '../middleware/upload.middleware';
import * as DocumentsService from '../services/documents.service';

function getUuidParam(req: Request, name: string): string {
	const parsed = z.uuid().safeParse(req.params[name]);
	if (!parsed.success) throw new AppError(400, `Invalid ${name}`);
	return parsed.data;
}

export const list = asyncHandler(async (req: Request, res: Response) => {
	const collectionId = getUuidParam(req, 'collectionId');
	const documents = await DocumentsService.listDocuments(collectionId);
	res.json({ documents });
});

// Upload is a two-middleware chain: multer → handler
// multer errors (size, type) propagate to global error handler via next(err)
export const uploadOne = [
	uploadRateLimit,
	upload.single('file'),
	verifyFileIntegrity,
	asyncHandler(async (req: Request, res: Response) => {
		if (!req.file) throw new AppError(400, 'No file uploaded');

		const collectionId = getUuidParam(req, 'collectionId');
		const result = await DocumentsService.uploadDocument(
			req.file.buffer,
			req.file.originalname,
			req.file.mimetype,
			collectionId,
			req.user!.id
		);
		res.status(202).json(result);
	}),
];

export const remove = asyncHandler(async (req: Request, res: Response) => {
	const documentId = getUuidParam(req, 'documentId');
	await DocumentsService.deleteDocument(documentId);
	res.json({ message: 'Document deleted' });
});

export const retry = asyncHandler(async (req: Request, res: Response) => {
	const documentId = getUuidParam(req, 'documentId');
	const result = await DocumentsService.retryIngestion(documentId, req.user!.id);
	res.json(result);
});
