import { NextFunction, Request, Response } from 'express';
import { logger } from '../lib/logger';
import { redis } from '../redis/client';
import { AppError } from './error.middleware';

interface RateLimitConfig {
	limit: number;
	windowSeconds: number;
	label: string;
}

function rateLimit(group: string, config: RateLimitConfig) {
	return async (req: Request, res: Response, next: NextFunction) => {
		if (!req.user) return next();

		const key = `rl:${group}:${req.user.id}`;

		try {
			const pipeline = redis.pipeline();
			pipeline.incr(key);
			pipeline.expire(key, config.windowSeconds, 'NX');
			const results = await pipeline.exec();

			const count = (results?.[0]?.[1] as number) ?? 1;

			res.setHeader('X-RateLimit-Limit', config.limit);
			res.setHeader('X-RateLimit-Remaining', Math.max(0, config.limit - count));

			if (count > config.limit) {
				const ttl = await redis.ttl(key);
				res.setHeader('Retry-After', ttl);

				return next(new AppError(429, `Rate limit exceeded: ${config.label}`));
			}

		} catch (err) {
			logger.error({ err, key }, 'Rate limit Redis error - failing open');
		}

		next();
	};
}

// Pre-built limiters — one per row in SRS §5.3 rate limit matrix
export const uploadRateLimit = rateLimit('upload', { limit: 20, windowSeconds: 3600, label: '20 uploads per hour' });
export const edgarRateLimit = rateLimit('edgar', { limit: 10, windowSeconds: 3600, label: '10 EDGAR fetches per hour' });
export const contradictRateLimit = rateLimit('contradict', { limit: 20, windowSeconds: 3600, label: '20 scans per hour' });
export const searchRateLimit = rateLimit('search', { limit: 60, windowSeconds: 3600, label: '60 searches per hour' });
export const benchmarkRateLimit = rateLimit('benchmark', { limit: 10, windowSeconds: 3600, label: '10 benchmark runs per hour' });
export const summarizeRateLimit = rateLimit('summarize', { limit: 30, windowSeconds: 3600, label: '30 summarizations per hour' });
