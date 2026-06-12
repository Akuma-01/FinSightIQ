import { Request, Response } from 'express';
import { z } from 'zod';
import { AppError, asyncHandler } from '../middleware/error.middleware';
import { edgarRateLimit } from '../middleware/rateLimit.middleware';
import { edgarQueue } from '../queue/edgar.queue';

const EdgarSchema = z.object({
	ticker: z.string().min(1).max(10).toUpperCase().refine(
		(t) => /^[A-Z0-9]{1,10}$/.test(t),
		{ message: 'Ticker must be 1-10 uppercase alphanumeric characters' }
	),
	filingType: z.enum(['10-K', '10-Q', '8-K']).default('10-K'),
	year: z.coerce.number().int().min(1993).max(new Date().getFullYear()),
	collectionId: z.uuid(),
});

export const fetchFiling = [
	edgarRateLimit,
	asyncHandler(async (req: Request, res: Response) => {
		const parsed = EdgarSchema.safeParse(req.body);
		if (!parsed.success) throw new AppError(400, parsed.error.message);

		const { ticker, filingType, year, collectionId } = parsed.data;
		const cacheKey = `edgar:${ticker}:${filingType}:${year}`;

		const job = await edgarQueue.add('fetch-edgar', {
			ticker,
			filingType,
			year,
			collectionId,
			requestedBy: req.user!.id,
			cacheKey,
		});

		res.status(202).json({
			jobId: job.id,
			ticker,
			filingType,
			year,
			status: 'queued',
			message: 'EDGAR filing fetch queued. document:ready WebSocket event will fire when ingestion completes.',
		});
	}),
];
