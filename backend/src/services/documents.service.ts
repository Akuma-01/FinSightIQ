import { db } from '../db/pool';
import { logger } from '../lib/logger';
import { AppError } from '../middleware/error.middleware';
import { ingestQueue } from '../queue/ingest.queue';
import { broadcastToRoom } from '../websocket/ws.rooms';
import { deleteFile, sanitizeFilename, saveFile } from './storage.service';

export async function uploadDocument(
	buffer: Buffer,
	originalName: string,
	mimeType: string,
	collectionId: string,
	uploadedBy: string
) {
	const safeFilename = sanitizeFilename(originalName);

	// 1. Verify collection exists and is not archived
	const colResult = await db.query(
		'SELECT id, chunking_strategy, archived FROM collections WHERE id = $1',
		[collectionId]
	);
	if (!colResult.rows[0]) throw new AppError(404, 'Collection not found');
	if (colResult.rows[0].archived) throw new AppError(409, 'Collection is archived — cannot add documents');

	// 2. Save file to local disk (storage adapter)
	const stored = await saveFile(buffer, safeFilename, mimeType);
	const client = await db.connect();
	let document: { id: string };
	let jobId: string;

	try {
		await client.query('BEGIN');

		const { rows } = await client.query(
			`INSERT INTO documents
	       (collection_id, filename, original_name, mime_type, size_bytes,
	        local_path, storage_key, status, doc_type, source, uploaded_by)
	     VALUES ($1, $2, $3, $4, $5, $6, $7, 'processing', 'internal_policy', 'manual', $8)
	     RETURNING id, filename, status, created_at`,
			[
				collectionId,
				stored.originalName,
				stored.originalName,
				mimeType,
				stored.sizeBytes,
				stored.localPath,
				stored.storageKey,
				uploadedBy,
			]
		);
		document = rows[0];

		const jobRow = await client.query(
			`INSERT INTO document_ingestion_jobs
	       (document_id, collection_id, status, attempt_number)
	     VALUES ($1, $2, 'queued', 0)
	     RETURNING id`,
			[document.id, collectionId]
		);
		jobId = jobRow.rows[0].id;

		await client.query('COMMIT');
	} catch (err) {
		await client.query('ROLLBACK');
		deleteFile(stored.storageKey);
		logger.error({ err, storageKey: stored.storageKey }, 'Upload DB insert failed - orphaned file deleted');
		throw err;
	} finally {
		client.release();
	}

	await ingestQueue.add('ingest-document', {
		documentId: document.id,
		collectionId,
		jobId,
		storageKey: stored.storageKey,
		chunkingStrategy: colResult.rows[0].chunking_strategy,
	});

	await broadcastToRoom(collectionId, 'document:processing', {
		documentId: document.id,
		filename: stored.originalName,
	});

	logger.info({ documentId: document.id, collectionId, jobId }, 'Document upload queued');
	return { documentId: document.id, jobId, status: 'processing', filename: stored.originalName };
}

export async function listDocuments(collectionId: string) {
	const { rows } = await db.query(
		`SELECT d.id, d.filename, d.mime_type, d.size_bytes, d.status,
            d.doc_type, d.source, d.effective_date, d.created_at,
            dij.status AS job_status, dij.failure_reason, dij.attempt_number
     FROM documents d
     LEFT JOIN document_ingestion_jobs dij ON dij.document_id = d.id
     WHERE d.collection_id = $1
     ORDER BY d.created_at DESC`,
		[collectionId]
	);
	return rows;
}

export async function getDocument(documentId: string) {
	const { rows } = await db.query(
		'SELECT * FROM documents WHERE id = $1',
		[documentId]
	);
	if (!rows[0]) throw new AppError(404, 'Document not found');
	return rows[0];
}

export async function deleteDocument(documentId: string) {
	const { rows } = await db.query(
		'DELETE FROM documents WHERE id = $1 RETURNING storage_key',
		[documentId]
	);
	if (!rows[0]) throw new AppError(404, 'Document not found');
	deleteFile(rows[0].storage_key);
}

export async function retryIngestion(documentId: string, requestedBy: string) {
	// Only permanently failed jobs can be retried
	const { rows } = await db.query(
		`SELECT dij.id, dij.status, d.collection_id, d.local_path, d.storage_key,
            c.chunking_strategy
     FROM document_ingestion_jobs dij
     JOIN documents d ON d.id = dij.document_id
     JOIN collections c ON c.id = d.collection_id
     WHERE dij.document_id = $1`,
		[documentId]
	);
	if (!rows[0]) throw new AppError(404, 'Ingestion job not found');
	if (rows[0].status !== 'failed') throw new AppError(409, 'Only failed jobs can be retried');

	const { id: jobId, collection_id, storage_key, chunking_strategy } = rows[0];

	// Reset job status
	await db.query(
		`UPDATE document_ingestion_jobs
     SET status = 'queued', failure_reason = NULL, completed_at = NULL
     WHERE id = $1`,
		[jobId]
	);

	await db.query(
		`UPDATE documents SET status = 'processing' WHERE id = $1`,
		[documentId]
	);

	await ingestQueue.add('ingest-document', {
		documentId,
		collectionId: collection_id,
		jobId,
		storageKey: storage_key,
		chunkingStrategy: chunking_strategy,
	});

	logger.info({ documentId, jobId, requestedBy }, 'Ingestion job re-queued');
	return { documentId, jobId, status: 'processing' };
}
