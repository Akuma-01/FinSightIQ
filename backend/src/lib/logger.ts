import pino from 'pino';

export const logger = pino({
	level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
	transport: process.env.NODE_ENV === 'development'
		? {
			target: 'pino-pretty'
		}
		: undefined,
	base: {
		pid: process.pid,
		env: process.env.NODE_ENV,
	},
	timestamp: pino.stdTimeFunctions.isoTime,
	redact: {
		paths: ['password', 'password_hash', 'token', 'refreshToken', 'authorization'],
		censor: '[REDACTED]',
	},
});
