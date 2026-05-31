import Redis from 'ioredis';
import { logger } from '../lib/logger';

const redisOptions = {
	maxRetriesPerRequest: 3,
	retryStrategy(times: number) {
		return Math.min(times * 50, 2000);
	},
};

export const redis = new Redis(process.env.REDIS_URL!, redisOptions);
export const redisSub = new Redis(process.env.REDIS_URL!, redisOptions);

redis.on('connect', () => console.log('Redis connected'));
redisSub.on('connect', () => console.log('RedisSub connected'));

redis.on('error', (err) => logger.error({ err }, 'Redis error'));
redisSub.on('error', (err) => logger.error({ err }, 'Redis sub error'));
