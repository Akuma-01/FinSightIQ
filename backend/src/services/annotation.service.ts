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
	patch: { body?: string; isResolved?: boolean },
	userId: string,
	userRole: string
) {
	const { rows: existing } = await db.query(
		'SELECT id, created_by, collection_id, is_resolved FROM annotations WHERE id = $1',
		[id]
	);
	if (!existing[0]) throw new AppError(404, 'Annotation not found');

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

export async function deleteAnnotation(id: string, userId: string, userRole: string) {
	const condition = userRole === 'admin'
		? 'id = $1'
		: 'id = $1 AND created_by = $2';
	const params = userRole === 'admin' ? [id] : [id, userId];

	const { rows } = await db.query(
		`DELETE FROM annotations WHERE ${condition} RETURNING id, collection_id`,
		params
	);
	if (!rows[0]) throw new AppError(404, 'Annotation not found or not owned by you');

	await broadcastToRoom(rows[0].collection_id, 'annotation:deleted', { annotationId: id });
}

export async function listAnnotations(documentId: string) {
	const { rows } = await db.query(
		`SELECT a.*, u.display_name AS author_name
     FROM annotations a JOIN users u ON u.id = a.created_by
     WHERE a.document_id = $1 ORDER BY a.created_at`,
		[documentId]
	);
	return rows;
}
