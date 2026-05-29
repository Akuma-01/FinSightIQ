import { NextFunction, Request, Response } from 'express';
import { redis } from '../redis/client';

interface RateLimitConfig {
	limit: number; // max requests in window
	windowSeconds: number; // window size in seconds
	label: string; // shown in 429 error message
}

function rateLimit(group: string, config: RateLimitConfig) {
	return async (req: Request, res: Response, next: NextFunction) => {
		if (!req.user) return next();

		const key = `rl:${group}:${req.user.id}`;
		const count = await redis.incr(key);

		// Set TTL on first request in this window
		if (count === 1) await redis.expire(key, config.windowSeconds);

		res.setHeader('X-RateLimit-Limit', config.limit);
		res.setHeader('X-RateLimit-Remaining', Math.max(0, config.limit - count));

		if (count > config.limit) {
			const ttl = await redis.ttl(key);
			return res.status(429).json({
				error: `Rate limit exceeded: ${config.label}`,
				retryAfter: ttl,
			});
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
