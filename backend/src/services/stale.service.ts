import { z } from 'zod';
import { db } from '../db/pool';
import { llmCall } from '../lib/llm/llm.client';
import { buildPrompt } from '../lib/llm/prompt.builder';
import { logger } from '../lib/logger';
import { AppError } from '../middleware/error.middleware';
import { broadcastToRoom } from '../websocket/ws.rooms';

// ─── Schema ──────────────────────────────────────────────────────────────────

const ReferenceItemsSchema = z.array(z.object({
	referenced_identifier: z.string().min(1).max(200).transform(s => s.trim()),
	referenced_body: z.string().min(1).max(100).transform(s => s.trim()),
	context: z.string().min(1).max(500).transform(s => s.trim()),
})).max(50);

const ReferencesOutputSchema = z.union([
	ReferenceItemsSchema,
	z.object({ references: ReferenceItemsSchema }),
]).transform(value => Array.isArray(value) ? value : value.references);

const StaleCheckOutputSchema = z.object({
	is_stale: z.boolean(),
	reason: z.string().max(800).transform(s => s.trim()),
});

export async function detectStaleReferences(
	documentId: string,
	collectionId: string,
	userId?: string
) {
	const log = logger.child({ documentId, collectionId });

	// Get first 20 chunks of the new document (enough for reference extraction)
	const { rows: chunks } = await db.query(
		`SELECT chunk_text FROM chunks
     WHERE document_id = $1 ORDER BY chunk_index LIMIT 20`,
		[documentId]
	);

	if (!chunks.length) return;

	const chunkText = chunks.map(c => c.chunk_text).join('\n\n').slice(0, 8_000);

	// Step 1 — Extract regulatory references
	const { body: extractBody, promptVersionId } = await buildPrompt('extract_references', {
		chunk_text: chunkText,
	});

	const extractResponse = await llmCall({
		task: 'extract_references',
		messages: [{ role: 'user', content: extractBody }],
		userId,
		promptVersionId,
		maxTokens: 512,
	});

	if (extractResponse.finishReason === 'error' || !extractResponse.structured) return;

	const parsedRefs = ReferencesOutputSchema.safeParse(extractResponse.structured);
	if (!parsedRefs.success) {
		log.warn({ zod: parsedRefs.error.flatten() }, 'Reference extraction output failed Zod validation');
		return;
	}

	for (const ref of parsedRefs.data) {
		const { rows: newer } = await db.query(
			`SELECT id, filename, source_identifier, effective_date
       FROM documents
       WHERE source = $1
         AND status = 'ready'
         AND id != $2
         AND collection_id = $3
         AND effective_date IS NOT NULL
         AND effective_date > (
           SELECT effective_date FROM documents WHERE id = $2
         )
       ORDER BY effective_date DESC
       LIMIT 1`,
			[ref.referenced_body, documentId, collectionId]
		);

		if (!newer.length) continue;

		const current = newer[0];

		const { body: staleBody, promptVersionId: stalePvid } = await buildPrompt('stale_check', {
			referenced_identifier: ref.referenced_identifier,
			referenced_body: ref.referenced_body,
			current_identifier: current.source_identifier ?? current.filename,
			current_date: current.effective_date ?? 'unknown',
		});

		const staleResponse = await llmCall({
			task: 'stale_check',
			messages: [{ role: 'user', content: staleBody }],
			userId,
			promptVersionId: stalePvid,
			maxTokens: 128,
		});

		if (staleResponse.finishReason === 'error' || !staleResponse.structured) continue;

		const staleCheck = StaleCheckOutputSchema.safeParse(staleResponse.structured);
		if (!staleCheck.success || !staleCheck.data.is_stale) continue;

		try {
			const { rows: inserted } = await db.query(
				`INSERT INTO stale_references
           (document_id, collection_id, referenced_identifier, referenced_body,
            current_identifier, section)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id`,
				[
					documentId, collectionId,
					ref.referenced_identifier, ref.referenced_body,
					current.source_identifier ?? current.filename,
					ref.context.slice(0, 200),
				]
			);

			if (inserted[0]) {
				await broadcastToRoom(collectionId, 'stale_reference:new', {
					id: inserted[0].id,
					documentId,
					referencedIdentifier: ref.referenced_identifier,
					referencedBody: ref.referenced_body,
					currentIdentifier: current.source_identifier ?? current.filename,
					reason: staleCheck.data.reason,
				});

				log.info({ refIdentifier: ref.referenced_identifier }, 'Stale reference detected and stored');
			}
		} catch (err) {
			log.error({ err, ref }, 'Failed to insert stale reference');
		}
	}
}

export async function listStaleReferences(collectionId: string) {
	const { rows } = await db.query(
		`SELECT sr.*, d.filename AS document_name
     FROM stale_references sr
     JOIN documents d ON d.id = sr.document_id
     WHERE sr.collection_id = $1
     ORDER BY sr.created_at DESC`,
		[collectionId]
	);
	return rows;
}

export async function resolveStaleReference(id: string, resolvedBy: string, userRole: string) {
	const { rows: staleRows } = await db.query(
		'SELECT id, collection_id, is_resolved FROM stale_references WHERE id = $1',
		[id]
	);
	if (!staleRows[0]) throw new AppError(404, 'Stale reference not found');
	if (staleRows[0].is_resolved) {
		throw new AppError(409, 'Stale reference is already resolved');
	}

	if (userRole !== 'admin') {
		const { rows: memberRows } = await db.query(
			'SELECT 1 FROM collection_members WHERE collection_id = $1 AND user_id = $2',
			[staleRows[0].collection_id, resolvedBy]
		);
		if (!memberRows.length) {
			throw new AppError(
				403,
				'You are not a member of the collection this stale reference belongs to'
			);
		}
	}

	const { rows } = await db.query(
		`UPDATE stale_references
     SET is_resolved = TRUE, resolved_by = $1, resolved_at = NOW()
     WHERE id = $2 RETURNING *`,
		[resolvedBy, id]
	);
	if (!rows[0]) throw new AppError(404, 'Stale reference not found');
	return rows[0];
}
