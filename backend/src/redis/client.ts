import Redis from 'ioredis';

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

redis.on('error', (err) => console.error('Redis error:', err));
redisSub.on('error', (err) => console.error('Redis sub error:', err));
