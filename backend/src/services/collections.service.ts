import { db } from '../db/pool';
import { logger } from '../lib/logger';
import { AppError } from '../middleware/error.middleware';
import { AuthUser } from '../types/express';

// ─── Sequence helpers ────────────────────────────────────────────────────────

function seqName(collectionId: string): string {
	return `ws_seq_${collectionId.replace(/-/g, '_')}`;
}

export async function createCollectionSequence(collectionId: string): Promise<void> {
	await db.query(`CREATE SEQUENCE IF NOT EXISTS "${seqName(collectionId)}"`);
}

export async function dropCollectionSequence(collectionId: string): Promise<void> {
	await db.query(`DROP SEQUENCE IF EXISTS "${seqName(collectionId)}"`);
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export async function createCollection(
	name: string,
	chunkingStrategy: 'fixed_256' | 'fixed_512' | 'sentence' | 'section_aware',
	createdBy: string
) {
	const client = await db.connect();
	try {
		await client.query('BEGIN');

		const { rows } = await client.query(
			`INSERT INTO collections (name, chunking_strategy, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, name, chunking_strategy, created_by, created_at`,
			[name, chunkingStrategy, createdBy]
		);
		const collection = rows[0];

		// Auto-add creator as member with 'owner' access_role
		await client.query(
			`INSERT INTO collection_members (collection_id, user_id, access_role)
       VALUES ($1, $2, 'owner')`,
			[collection.id, createdBy]
		);

		// Create per-collection WS sequence
		await client.query(`CREATE SEQUENCE IF NOT EXISTS "${seqName(collection.id)}"`);

		await client.query('COMMIT');
		logger.info({ collectionId: collection.id }, 'Collection created');
		return collection;
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}
}

export async function listCollections(user: AuthUser) {
	// Admins see all; others see only their member collections
	if (user.role === 'admin') {
		const { rows } = await db.query(
			`SELECT c.id, c.name, c.chunking_strategy, c.archived, c.created_at,
              COUNT(d.id) AS document_count
       FROM collections c
       LEFT JOIN documents d ON d.collection_id = c.id
       GROUP BY c.id ORDER BY c.created_at DESC`
		);
		return rows;
	}

	const { rows } = await db.query(
		`SELECT c.id, c.name, c.chunking_strategy, c.archived, c.created_at,
            cm.access_role, COUNT(d.id) AS document_count
     FROM collections c
     JOIN collection_members cm ON cm.collection_id = c.id AND cm.user_id = $1
     LEFT JOIN documents d ON d.collection_id = c.id
     GROUP BY c.id, cm.access_role ORDER BY c.created_at DESC`,
		[user.id]
	);
	return rows;
}

export async function getCollection(id: string) {
	const { rows } = await db.query(
		`SELECT c.*, COUNT(d.id) AS document_count
     FROM collections c
     LEFT JOIN documents d ON d.collection_id = c.id
     WHERE c.id = $1
     GROUP BY c.id`,
		[id]
	);
	if (!rows[0]) throw new AppError(404, 'Collection not found');
	return rows[0];
}

export async function updateCollection(id: string, patch: { name?: string; archived?: boolean }) {
	const fields: string[] = [];
	const values: unknown[] = [];
	let i = 1;

	if (patch.name !== undefined) { fields.push(`name = $${i++}`); values.push(patch.name); }
	if (patch.archived !== undefined) { fields.push(`archived = $${i++}`); values.push(patch.archived); }
	if (!fields.length) throw new AppError(400, 'No fields to update');

	values.push(id);
	const { rows } = await db.query(
		`UPDATE collections SET ${fields.join(', ')}, updated_at = NOW()
     WHERE id = $${i} RETURNING *`,
		values
	);
	if (!rows[0]) throw new AppError(404, 'Collection not found');
	return rows[0];
}

export async function deleteCollection(id: string) {
	const client = await db.connect();
	try {
		await client.query('BEGIN');
		const { rowCount } = await client.query('DELETE FROM collections WHERE id = $1', [id]);
		if (!rowCount) throw new AppError(404, 'Collection not found');
		await client.query(`DROP SEQUENCE IF EXISTS "${seqName(id)}"`);
		await client.query('COMMIT');
		logger.info({ collectionId: id }, 'Collection deleted');
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}
}

// ─── Membership ───────────────────────────────────────────────────────────────

export async function listMembers(collectionId: string) {
	const { rows } = await db.query(
		`SELECT u.id, u.email, u.display_name, u.role, cm.access_role, cm.created_at AS added_at
     FROM collection_members cm
     JOIN users u ON u.id = cm.user_id
     WHERE cm.collection_id = $1
     ORDER BY cm.created_at`,
		[collectionId]
	);
	return rows;
}

export async function addMember(collectionId: string, userId: string, accessRole: string) {
	const { rows } = await db.query(
		`INSERT INTO collection_members (collection_id, user_id, access_role)
     VALUES ($1, $2, $3)
     ON CONFLICT (collection_id, user_id) DO UPDATE SET access_role = $3
     RETURNING *`,
		[collectionId, userId, accessRole]
	);
	return rows[0];
}

export async function removeMember(collectionId: string, userId: string) {
	const { rowCount } = await db.query(
		'DELETE FROM collection_members WHERE collection_id = $1 AND user_id = $2',
		[collectionId, userId]
	);
	if (!rowCount) throw new AppError(404, 'Member not found in this collection');
}
