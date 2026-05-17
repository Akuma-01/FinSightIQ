import { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../services/auth.service';

export function verifyJWT(req: Request, res: Response, next: NextFunction) {
	const authHeader = req.headers.authorization;
	if (!authHeader?.startsWith('Bearer ')) {
		return res.status(401).json({ error: 'Missing or malformed Authorization header' });
	}

	const token = authHeader.slice(7);
	try {
		req.user = verifyAccessToken(token);
		next();
	} catch {
		res.status(401).json({ error: 'Invalid or expired token' });
	}
}
