import cookieParser from 'cookie-parser';
import cors from 'cors';
import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';

import { db } from './db/pool';
import { logger } from './lib/logger';
import { errorHandler, notFound } from './middleware/error.middleware';
import { requestId } from './middleware/requestId.middleware';
import { scheduleCleanupJob } from './queue/cleanup.queue';
import { redis } from './redis/client';
import authRoutes from './routes/auth.routes';
import healthRoutes from './routes/health.routes';
import { initWebSocketServer } from './websocket/ws.server';
import { startCleanupWorker } from './workers/cleanup.worker';

async function bootstrap() {
	const app = express();

	// ── Middleware ──────────────────────────────────────────────────
	app.use(cors({
		origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000',
		credentials: true, // required for httpOnly refresh token cookie
	}));
	app.use(requestId);
	app.use(express.json());
	app.use(cookieParser());

	// ── Routes ─────────────────────────────────────────────────────
	app.use('/api/auth', authRoutes);
	app.use(healthRoutes); // /health — no /api prefix intentional
	app.use(notFound);
	app.use(errorHandler);

	// ── HTTP Server ─────────────────────────────────────────────────
	const PORT = parseInt(process.env.PORT ?? '4000', 10);
	const httpServer = createServer(app);

	// ── WebSocket ──────────────────────────────────────────────────
	initWebSocketServer(httpServer);

	// ── Workers ────────────────────────────────────────────────────
	startCleanupWorker();
	await scheduleCleanupJob();

	// ── Listen ─────────────────────────────────────────────────────
	httpServer.listen(PORT, () => {
		logger.info({ port: PORT, url: `http://localhost:${PORT}` }, 'FinSightIQ backend started');
		logger.info({ port: PORT, url: `ws://localhost:${PORT}/ws` }, 'WebSocket endpoint available');
	});

	// ── Graceful shutdown ──────────────────────────────────────────
	const shutdown = async (signal: string) => {
		logger.info({ signal }, 'Shutdown signal received');
		httpServer.close();
		await db.end();
		await redis.quit();
		process.exit(0);
	};

	process.on('SIGTERM', () => shutdown('SIGTERM'));
	process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
	logger.error({ err }, 'Failed to start');
	process.exit(1);
});
