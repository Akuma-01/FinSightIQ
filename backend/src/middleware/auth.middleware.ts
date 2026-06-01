import { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../services/auth.service';
import { AppError } from './error.middleware';

export function verifyJWT(req: Request, _res: Response, next: NextFunction): void {
	const authHeader = req.headers.authorization;
	if (!authHeader?.startsWith('Bearer ')) {
		return next(new AppError(401, 'Missing or malformed Authorization header'));
	}

	const token = authHeader.slice(7);
	try {
		req.user = verifyAccessToken(token);
		next();
	} catch {
		next(new AppError(401, 'Invalid or expired token'));
	}
}
