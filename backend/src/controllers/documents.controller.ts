import { Request, Response } from 'express';
import { AppError, asyncHandler } from '../middleware/error.middleware';
import { uploadRateLimit } from '../middleware/rateLimit.middleware';
import { upload } from '../middleware/upload.middleware';
import * as DocumentsService from '../services/documents.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
	const documents = await DocumentsService.listDocuments(req.params.collectionId);
	res.json({ documents });
});

// Upload is a two-middleware chain: multer → handler
// multer errors (size, type) propagate to global error handler via next(err)
export const uploadOne = [
	uploadRateLimit,
	upload.single('file'),
	asyncHandler(async (req: Request, res: Response) => {
		if (!req.file) throw new AppError(400, 'No file uploaded');

		const result = await DocumentsService.uploadDocument(
			req.file.buffer,
			req.file.originalname,
			req.file.mimetype,
			req.params.collectionId,
			req.user!.id
		);
		res.status(202).json(result);
	}),
];

export const remove = asyncHandler(async (req: Request, res: Response) => {
	await DocumentsService.deleteDocument(req.params.documentId);
	res.json({ message: 'Document deleted' });
});

export const retry = asyncHandler(async (req: Request, res: Response) => {
	const result = await DocumentsService.retryIngestion(req.params.documentId, req.user!.id);
	res.json(result);
});
