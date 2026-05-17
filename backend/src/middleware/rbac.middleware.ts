import { NextFunction, Request, Response } from 'express';
import { AuthUser } from '../types/express';

type Role = AuthUser['role'];

/**
 * requireRole('admin', 'analyst') passes if req.user has ANY of the listed roles.
 * Always attach verifyJWT before this in the middleware chain.
*/

export function requireRole(...roles: Role[]) {
	return (req: Request, res: Response, next: NextFunction) => {
		if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
		if (!roles.includes(req.user.role)) {
			return res.status(403).json({
				error: `Forbidden — required role(s): ${roles.join(', ')}. Your role: ${req.user.role}`,
			});
		}
		next();
	};
}

export const adminOnly = requireRole('admin');
export const canUpload = requireRole('admin', 'analyst');
export const canResolve = requireRole('admin', 'compliance_officer');
export const researchAccess = requireRole('admin', 'researcher');
export const allRoles = requireRole('admin', 'analyst', 'compliance_officer', 'researcher');
