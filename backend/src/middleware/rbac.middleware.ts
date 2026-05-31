import { NextFunction, Request, Response } from 'express';
import { AuthUser } from '../types/express';
import { AppError } from './error.middleware';

type Role = AuthUser['role'];

/**
 * requireRole('admin', 'analyst') passes if req.user has ANY of the listed roles.
 * Always attach verifyJWT before this in the middleware chain.
*/

export function requireRole(...roles: Role[]) {
	return (req: Request, _res: Response, next: NextFunction): void => {
		if (!req.user) {
			next(new AppError(401, 'Unauthenticated'));
			return;
		}
		if (!roles.includes(req.user.role)) {
			next(new AppError(403, `Forbidden — required role(s): ${roles.join(', ')}. Your role: ${req.user.role}`));
			return;
		}
		next();
	};
}

export const adminOnly = requireRole('admin');
export const canUpload = requireRole('admin', 'analyst');
export const canResolve = requireRole('admin', 'compliance_officer');
export const researchAccess = requireRole('admin', 'researcher');
export const allRoles = requireRole('admin', 'analyst', 'compliance_officer', 'researcher');
