import Redis from 'ioredis';

const redisOptions = {
	maxRetriesPerRequest: 3,
	lazyConnect: false,
};

export const redis = new Redis(process.env.REDIS_URL!, redisOptions);
export const redisSub = new Redis(process.env.REDIS_URL!, redisOptions); // pub/sub only

redis.on('error', (err) => console.error('Redis error:', err));
redisSub.on('error', (err) => console.error('Redis sub error:', err));
