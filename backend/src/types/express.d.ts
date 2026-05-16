export interface AuthUser {
	id: string;
	role: 'admin' | 'analyst' | 'compliance_officer' | 'researcher';
	email: string;
}

declare global {
	namespace Express {
		interface Request {
			user?: AuthUser;
		}
	}
}
