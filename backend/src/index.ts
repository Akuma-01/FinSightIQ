import cookieParser from 'cookie-parser';
import cors from 'cors';
import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import { createServer } from 'http';
import pinoHttp from 'pino-http';
import { config } from './config';

import { mkdir } from 'fs/promises';

import { db } from './db/pool';
import { logger } from './lib/logger';
import { errorHandler, notFound } from './middleware/error.middleware';
import { requestId } from './middleware/requestId.middleware';
import { scheduleCleanupJob } from './queue/cleanup.queue';
import { redis } from './redis/client';
import aiRoutes from './routes/ai.routes';
import annotationsRoutes from './routes/annotations.routes';
import authRoutes from './routes/auth.routes';
import collectionsRoutes from './routes/collections.routes';
import documentActionsRoutes from './routes/document-actions.routes';
import documentsRoutes from './routes/documents.routes';
import edgarRoutes from './routes/edgar.routes';
import healthRoutes from './routes/health.routes';
import llmRoutes from './routes/llm.routes';
import researchRoutes from './routes/research.routes';
import testRoutes from './routes/test.routes';
import { initWebSocketServer } from './websocket/ws.server';
import { startCleanupWorker } from './workers/cleanup.worker';
import { startEdgarWorker } from './workers/edgar.worker';
import { startIngestWorker } from './workers/ingest.worker';
import { startScanWorker } from './workers/scan.worker';
import { startBenchmarkWorker } from './workers/benchmark.worker';

// ── Process-level safety net ────────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
	logger.fatal({ reason }, 'Unhandled promise rejection — shutting down');
	process.exit(1);
});

process.on('uncaughtException', (err) => {
	logger.fatal({ err }, 'Uncaught exception — shutting down');
	process.exit(1);
});

async function bootstrap() {
	mkdir(config.UPLOAD_DIR, { recursive: true });

	const app = express();

	// ── Security ───────────────────────────────────────────────────
	app.disable('x-powered-by');
	app.use(helmet({
		contentSecurityPolicy: false,
	}));

	// ── Request ID ──────────────────────────────────────────────────
	app.use(requestId);

	// ── HTTP request logging ───────────────────────────────────────
	app.use(pinoHttp({
		logger,
		customProps: (_req, res) => ({ requestId: res.getHeader('X-Request-Id') }),
		autoLogging: { ignore: (req) => req.url === '/health' },
	}));

	// ── Body parsing ──────────────────────────────────────────────
	app.use(cors({
		origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000',
		credentials: true,
	}));
	app.use(express.json({ limit: '1mb' })); // reject bodies > 1MB
	app.use(express.urlencoded({ extended: false, limit: '1mb' }));
	app.use(cookieParser());

	// ── Routes ────────────────────────────────────────────────────
	app.use('/api/auth', authRoutes);
	app.use('/api/collections', collectionsRoutes);
	app.use('/api/collections/:collectionId/documents', documentsRoutes);
	app.use('/api/documents', documentActionsRoutes);
	app.use('/api/edgar', edgarRoutes);
	app.use('/api', testRoutes);
	app.use(healthRoutes);

	app.use('/api/ai', aiRoutes);
	app.use(
		'/api/collections/:collectionId/documents/:documentId/annotations',
		annotationsRoutes
	);

	app.use('/llm', llmRoutes);
	app.use('/api/research', researchRoutes);

	// ── 404 + Error handlers (must be LAST) ───────────────────────
	app.use(notFound);
	app.use(errorHandler);

	// ── HTTP + WebSocket Server ───────────────────────────────────
	const httpServer = createServer(app);
	initWebSocketServer(httpServer);

	// ── Workers ──────────────────────────────────────────────────
	startCleanupWorker();
	startIngestWorker();
	startEdgarWorker();
	startScanWorker();
	startBenchmarkWorker();
	await scheduleCleanupJob();

	// ── Listen ───────────────────────────────────────────────────
	await new Promise<void>((resolve) => {
		httpServer.listen(config.PORT, resolve);
	});

	logger.info(`✓ Backend  → http://localhost:${config.PORT}`);
	logger.info(`✓ WS       → ws://localhost:${config.PORT}/ws`);

	// ── Graceful shutdown ─────────────────────────────────────────
	const shutdown = async (signal: string) => {
		logger.info(`${signal} received — shutting down gracefully`);

		await new Promise<void>((resolve) => httpServer.close(() => resolve()));
		await db.end();
		await redis.quit();
		logger.info('Shutdown complete');
		process.exit(0);
	};

	process.on('SIGTERM', () => shutdown('SIGTERM'));
	process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
	logger.fatal({ err }, 'Failed to start server');
	process.exit(1);
});
