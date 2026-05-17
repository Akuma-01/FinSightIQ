import { NextFunction, Request, Response } from 'express';
import { db } from '../db/pool';

/**
 * Reads collectionId from req.params.id or req.params.collectionId.
 * Admins bypass the check (same rule as the REST spec).
 * All other roles: must have a row in collection_members.
 */

export async function requireCollectionMember(
	req: Request,
	res: Response,
	next: NextFunction
) {
	if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
	if (req.user.role === 'admin') return next();

	const collectionId = req.params.id ?? req.params.collectionId;
	if (!collectionId) return res.status(400).json({ error: 'Missing collectionId' });

	try {
		const result = await db.query(
			`SELECT 1 FROM collection_members
			WHERE collection_id = $1 AND user_id = $2`,
			[collectionId, req.user.id]
		);
		if (result.rows.length === 0) {
			return res.status(403.)
		}
	} catch (err) {
		console.error('requireCollectionMember DB error:', err);
		res.status(500).json({ error: 'Internal error checking collection membership' });
	}
}

