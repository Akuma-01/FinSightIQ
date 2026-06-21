import { z } from 'zod';
import { db } from '../db/pool';
import { AppError } from '../middleware/error.middleware';
import { broadcastToRoom } from '../websocket/ws.rooms';

export const AnnotationTypeEnum = z.enum(['comment', 'flag', 'question']);

export async function createAnnotation(data: {
	documentId: string;
	collectionId: string;
	createdBy: string;
	chunkId?: string;
	body: string;
	annotationType: string;
}) {
	const { rows: documentRows } = await db.query(
		'SELECT 1 FROM documents WHERE id = $1 AND collection_id = $2',
		[data.documentId, data.collectionId]
	);
	if (!documentRows.length) {
		throw new AppError(404, 'Document not found in this collection');
	}

	if (data.chunkId) {
		const { rows: chunkRows } = await db.query(
			`SELECT 1
			 FROM chunks
			 WHERE id = $1 AND document_id = $2 AND collection_id = $3`,
			[data.chunkId, data.documentId, data.collectionId]
		);
		if (!chunkRows.length) {
			throw new AppError(400, 'Chunk does not belong to this document and collection');
		}
	}

	const { rows } = await db.query(
		`INSERT INTO annotations
       (document_id, collection_id, created_by, chunk_id, body, annotation_type)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
		[
			data.documentId, data.collectionId, data.createdBy,
			data.chunkId ?? null, data.body, data.annotationType,
		]
	);

	await broadcastToRoom(data.collectionId, 'annotation:created', { annotation: rows[0] });
	return rows[0];
}

export async function updateAnnotation(
	id: string,
	collectionId: string,
	documentId: string,
	patch: { body?: string; isResolved?: boolean },
	userId: string,
	userRole: string
) {
	const { rows: existing } = await db.query(
		`SELECT id, created_by, collection_id, document_id, is_resolved
		 FROM annotations
		 WHERE id = $1`,
		[id]
	);
	if (!existing[0]) throw new AppError(404, 'Annotation not found');
	if (
		existing[0].collection_id !== collectionId
		|| existing[0].document_id !== documentId
	) {
		throw new AppError(403, 'Annotation does not belong to this document and collection');
	}

	const annotation = existing[0];
	if (patch.body !== undefined && userRole !== 'admin' && annotation.created_by !== userId) {
		throw new AppError(403, 'Only the annotation author or an admin can edit the body');
	}

	if (patch.isResolved !== undefined) {
		const canResolveAny = userRole === 'admin' || userRole === 'compliance_officer';
		if (!canResolveAny && annotation.created_by !== userId) {
			throw new AppError(
				403,
				'Only compliance officers or admins can resolve others\' annotations'
			);
		}
	}

	const fields: string[] = [];
	const values: unknown[] = [];
	let i = 1;

	if (patch.body !== undefined) { fields.push(`body = $${i++}`); values.push(patch.body); }
	if (patch.isResolved !== undefined) { fields.push(`is_resolved = $${i++}`); values.push(patch.isResolved); }
	if (!fields.length) throw new AppError(400, 'No fields to update');

	fields.push(`updated_at = NOW()`);
	values.push(id);

	const { rows } = await db.query(
		`UPDATE annotations SET ${fields.join(', ')}
     WHERE id = $${i} RETURNING *`,
		values
	);
	if (!rows[0]) throw new AppError(404, 'Annotation not found');

	await broadcastToRoom(rows[0].collection_id, 'annotation:updated', { annotation: rows[0] });
	return rows[0];
}

export async function deleteAnnotation(
	id: string,
	collectionId: string,
	documentId: string,
	userId: string,
	userRole: string
) {
	const { rows: existing } = await db.query(
		'SELECT created_by, collection_id, document_id FROM annotations WHERE id = $1',
		[id]
	);
	if (!existing[0]) throw new AppError(404, 'Annotation not found');
	if (
		existing[0].collection_id !== collectionId
		|| existing[0].document_id !== documentId
	) {
		throw new AppError(403, 'Annotation does not belong to this document and collection');
	}
	if (userRole !== 'admin' && existing[0].created_by !== userId) {
		throw new AppError(403, 'Only the annotation author or an admin can delete it');
	}

	const { rows } = await db.query(
		`DELETE FROM annotations WHERE id = $1 RETURNING id, collection_id`,
		[id]
	);
	if (!rows[0]) throw new AppError(404, 'Annotation not found');

	await broadcastToRoom(rows[0].collection_id, 'annotation:deleted', { annotationId: id });
}

export async function listAnnotations(documentId: string, collectionId: string) {
	const { rows } = await db.query(
		`SELECT a.*, u.display_name AS author_name
	     FROM annotations a JOIN users u ON u.id = a.created_by
	     WHERE a.document_id = $1 AND a.collection_id = $2
	     ORDER BY a.created_at`,
		[documentId, collectionId]
	);
	return rows;
}
