import { Router } from 'express';
import { verifyJWT } from '../middleware/auth.middleware';
import { AppError, asyncHandler } from '../middleware/error.middleware';
import { uploadRateLimit } from '../middleware/rateLimit.middleware';
import { cleanupQueue } from '../queue/cleanup.queue';

const router = Router();

router.use((_req, _res, next) => {
	if (process.env.NODE_ENV === 'production') {
		next(new AppError(404, 'Route not found'));
		return;
	}

	next();
});

router.get('/test-upload', verifyJWT, uploadRateLimit, asyncHandler(async (req, res) => {
	res.json({
		ok: true,
		requestId: req.requestId,
		userId: req.user?.id,
	});
}));

router.post('/test-cleanup', verifyJWT, asyncHandler(async (req, res) => {
	const job = await cleanupQueue.add('purge-ws-events', {}, {
		removeOnComplete: 10,
		removeOnFail: 5,
	});

	res.status(202).json({
		enqueued: true,
		jobId: job.id,
		requestId: req.requestId,
	});
}));

export default router;
