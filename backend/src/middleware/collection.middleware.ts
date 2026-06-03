import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
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
	if (!req.user) {
		next(new AppError(401, 'Unauthenticated'));
		return;
	}
	if (req.user.role === 'admin') return next();

	const collectionIdParam = req.params.id ?? req.params.collectionId;
	const parsedCollectionId = z.string().uuid().safeParse(collectionIdParam);
	if (!parsedCollectionId.success) {
		next(new AppError(400, 'Invalid collectionId'));
		return;
	}
	const collectionId = parsedCollectionId.data;

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
