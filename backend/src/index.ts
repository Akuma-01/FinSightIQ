import cookieParser from 'cookie-parser';
import cors from 'cors';
import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';

import { db } from './db/pool';
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
	app.use(express.json());
	app.use(cookieParser());

	// ── Routes ─────────────────────────────────────────────────────
	app.use('/api/auth', authRoutes);
	app.use(healthRoutes); // /health — no /api prefix intentional

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
		console.info(`✓ FinSightIQ backend  →  http://localhost:${PORT}`);
		console.info(`✓ WebSocket          →  ws://localhost:${PORT}/ws`);
	});

	// ── Graceful shutdown ──────────────────────────────────────────
	const shutdown = async (signal: string) => {
		console.info(`${signal} received — shutting down`);
		httpServer.close();
		await db.end();
		await redis.quit();
		process.exit(0);
	};

	process.on('SIGTERM', () => shutdown('SIGTERM'));
	process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
	console.error('Failed to start:', err);
	process.exit(1);
});
