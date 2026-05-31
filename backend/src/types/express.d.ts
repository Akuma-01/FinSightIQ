export interface AuthUser {
	id: string;
	role: 'admin' | 'analyst' | 'compliance_officer' | 'researcher';
	email: string;
}

declare global {
	namespace Express {
		interface Request {
			user?: AuthUser;
			// X-Request-Id is already in req.headers['x-request-id']; this alias
			// makes it accessible as req.requestId throughout the codebase.
			requestId?: string;
		}
	}
}
