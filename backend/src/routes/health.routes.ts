import { Request, Response, Router } from 'express';
import { db } from '../db/pool';
import { redis } from '../redis/client';
import { getWsConnectionCount } from '../websocket/ws.server';
import { getCleanupWorkerStatus } from '../workers/cleanup.worker';

const router = Router();

router.get('/health', async (_req: Request, res: Response) => {
	let dbStatus = 'unreachable';
	let redisStatus = 'unreachable';

	try {
		await db.query('SELECT 1');
		dbStatus = 'ok';
	} catch { /* status stays unreachable */ }

	try {
		await redis.ping();
		redisStatus = 'ok';
	} catch { /* status stays unreachable */ }

	const overallStatus = dbStatus === 'ok' && redisStatus === 'ok' ? 'ok' : 'degraded';

	res.status(overallStatus === 'ok' ? 200 : 503).json({
		status: overallStatus,
		timestamp: new Date().toISOString(),
		db: dbStatus,
		redis: redisStatus,
		cleanup_worker: getCleanupWorkerStatus(),
		ws_connections: getWsConnectionCount(),
	});
});

export default router;
