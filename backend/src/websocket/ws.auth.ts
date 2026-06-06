import { IncomingMessage } from 'http';
import { URL } from 'url';
import { verifyAccessToken } from '../services/auth.service';
import { AuthUser } from '../types/express';

export function authenticateWSHandshake(req: IncomingMessage): AuthUser {
	const url = new URL(req.url ?? '', `http://${req.headers.host}`);
	const token = url.searchParams.get('token');
	if (!token) throw new Error('Missing token');
	return verifyAccessToken(token);
}
