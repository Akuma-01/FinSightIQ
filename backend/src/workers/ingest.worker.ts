import { Job, Worker } from 'bullmq';
import { readFile } from 'fs/promises';
import { PDFParse } from 'pdf-parse';
import { chunk, ChunkingStrategy } from '../chunkers/chunker.factory';
import { config } from '../config';
import { db } from '../db/pool';
import { logger } from '../lib/logger';
import { IngestJobData } from '../queue/ingest.queue';
import { redis } from '../redis/client';
import { embedTexts } from '../services/embedding.service';
import { detectStaleReferences } from '../services/stale.service';
import { getAbsolutePath } from '../services/storage.service';
import { broadcastToRoom } from '../websocket/ws.rooms';

let workerStatus: 'active' | 'idle' = 'idle';
export const getIngestWorkerStatus = () => workerStatus;

async function processIngestJob(job: Job<IngestJobData>): Promise<void> {
	const { documentId, collectionId, jobId, chunkingStrategy } = job.data;
	const log = logger.child({ documentId, collectionId, jobId });

	await db.query(
		`UPDATE document_ingestion_jobs
     SET status = 'running', started_at = NOW(), attempt_number = attempt_number + 1
     WHERE id = $1`,
		[jobId]
	);

	log.info('Reading file from disk');
	const resolvedPath = getAbsolutePath(job.data.storageKey);
	const fileBuffer = await readFile(resolvedPath);

	let rawText = '';
	const mimeResult = await db.query('SELECT mime_type FROM documents WHERE id = $1', [documentId]);
	const mimeType = mimeResult.rows[0]?.mime_type ?? '';

	if (mimeType === 'application/pdf') {
		const parser = new PDFParse({ data: fileBuffer });
		try {
			const parsed = await parser.getText();
			rawText = parsed.text;
		} catch (parseErr) {
			log.warn({ parseErr }, 'pdf-parse threw - likely corrupt or non-PDF content');
			await markFailed(jobId, documentId, 'pdf_parse_error');
			await broadcastToRoom(collectionId, 'document:failed', {
				documentId,
				filename: job.data.storageKey.split('/').pop(),
				failureReason: 'pdf_parse_error',
			});
			return;
		} finally {
			await parser.destroy();
		}

		if (rawText.trim().length < 200) {
			log.warn({ charCount: rawText.trim().length }, 'Possible scanned PDF — text too short');
			await markFailed(jobId, documentId, 'scanned_pdf_no_text');
			await broadcastToRoom(collectionId, 'document:failed', {
				documentId,
				filename: job.data.storageKey.split('/').pop(),
				failureReason: 'scanned_pdf_no_text',
			});
			return;
		}
	} else {
		rawText = fileBuffer.toString('utf8');
	}

	await db.query('UPDATE documents SET raw_text = $1 WHERE id = $2', [rawText, documentId]);

	log.info({ strategy: chunkingStrategy }, 'Chunking document');
	const chunks = chunk(rawText, chunkingStrategy as ChunkingStrategy, documentId);
	log.info({ chunkCount: chunks.length }, 'Chunking complete');

	log.info({ chunkCount: chunks.length }, 'Embedding chunks');
	const texts = chunks.map(c => c.text);
	const vectors = await embedTexts(texts);

	log.info('Inserting chunks to DB');
	const client = await db.connect();
	try {
		await client.query('BEGIN');

		await client.query('DELETE FROM chunks WHERE document_id = $1', [documentId]);

		for (let i = 0; i < chunks.length; i++) {
			const c = chunks[i];
			const vectorStr = `[${vectors[i].join(',')}]`;

			await client.query(
				`INSERT INTO chunks
           (document_id, collection_id, chunk_index, chunk_text, embedding,
            chunking_strategy, token_count)
         VALUES ($1, $2, $3, $4, $5::vector, $6, $7)`,
				[documentId, collectionId, c.chunkIndex, c.text, vectorStr,
					c.chunkingStrategy, c.tokenCount]
			);
		}

		await client.query('COMMIT');
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}

	await db.query(`UPDATE documents SET status = 'ready' WHERE id = $1`, [documentId]);
	await db.query(
		`UPDATE document_ingestion_jobs
     SET status = 'completed', completed_at = NOW()
     WHERE id = $1`,
		[jobId]
	);

	log.info({ chunkCount: chunks.length }, 'Ingestion complete');

	const docResult = await db.query(
		'SELECT filename, original_name FROM documents WHERE id = $1',
		[documentId]
	);
	await broadcastToRoom(collectionId, 'document:ready', {
		documentId,
		filename: docResult.rows[0]?.original_name ?? docResult.rows[0]?.filename,
		chunkCount: chunks.length,
	});

	await detectStaleReferences(documentId, collectionId, 'system').catch(err => {
		logger.error({ err, documentId }, 'Stale reference detection failed — non-fatal');
	});
}

async function markFailed(jobId: string, documentId: string, reason: string): Promise<void> {
	await db.query(
		`UPDATE document_ingestion_jobs
     SET status = 'failed', failure_reason = $1, completed_at = NOW()
     WHERE id = $2`,
		[reason, jobId]
	);
	await db.query(`UPDATE documents SET status = 'failed' WHERE id = $1`, [documentId]);
}

export function startIngestWorker(): void {
	const worker = new Worker<IngestJobData>(
		'ingest-queue',
		async (job) => {
			workerStatus = 'active';
			try {
				await processIngestJob(job);
			} catch (err) {

				const isLastAttempt = job.attemptsMade >= (job.opts.attempts ?? 3) - 1;
				if (isLastAttempt) {
					logger.error(
						{ err, documentId: job.data.documentId, attempt: job.attemptsMade },
						'Ingestion permanently failed'
					);
					await markFailed(job.data.jobId, job.data.documentId, (err as Error).message);
					await broadcastToRoom(job.data.collectionId, 'document:failed', {
						documentId: job.data.documentId,
						filename: job.data.storageKey.split('/').pop(),
						failureReason: (err as Error).message,
					});
				}
				throw err;
			} finally {
				workerStatus = 'idle';
			}
		},
		{
			connection: redis,
			concurrency: config.INGEST_CONCURRENCY,
		}
	);

	worker.on('failed', (job, err) => {
		logger.warn({ jobId: job?.id, attempt: job?.attemptsMade, err }, 'Ingest job attempt failed');
	});

	logger.info({ concurrency: config.INGEST_CONCURRENCY }, '✓ Ingest worker started');
}
