import pino from 'pino';
import { config } from '../config';

export const logger = pino({
	level: config.NODE_ENV === 'production' ? 'info' : 'debug',
	// In production: emit JSON. In dev: pino-pretty in the dev script handles formatting.
	transport: config.NODE_ENV === 'development'
		? undefined   // pino-pretty is applied by the shell pipe in `npm run dev`
		: undefined,  // plain JSON to stdout in production — forward to log aggregator
	base: {
		pid: process.pid,
		env: config.NODE_ENV,
	},
	timestamp: pino.stdTimeFunctions.isoTime,
	redact: {
		// Never log these values even if accidentally passed as context
		paths: ['password', 'password_hash', 'token', 'refreshToken', 'authorization'],
		censor: '[REDACTED]',
	},
});
