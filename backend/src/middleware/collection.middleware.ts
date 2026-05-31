import { NextFunction, Request, Response } from 'express';
import { db } from '../db/pool';
import { logger } from '../lib/logger';
import { AppError } from './error.middleware';

/**
 * Reads collectionId from req.params.id or req.params.collectionId.
 * Admins bypass the check (same rule as the REST spec).
 * All other roles: must have a row in collection_members.
 */

export async function requireCollectionMember(
	req: Request,
	_res: Response,
	next: NextFunction
) {
	if (!req.user) throw new AppError(401, 'Unauthenticated');
	if (req.user.role === 'admin') return next();

	const collectionId = req.params.id ?? req.params.collectionId;
	if (!collectionId) throw new AppError(400, 'Missing collectionId');

	try {
		const result = await db.query(
			`SELECT 1 FROM collection_members
			WHERE collection_id = $1 AND user_id = $2`,
			[collectionId, req.user.id]
		);
		if (result.rows.length === 0) {
			next(new AppError(403, 'You are not a member of this collection'));
			return;
		}
		next();
	} catch (err) {
		logger.error({ err, collectionId, requestId: req.requestId, userId: req.user.id }, 'requireCollectionMember DB error');
		next(err);
	}
}
