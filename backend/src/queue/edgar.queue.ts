import { Queue } from 'bullmq';
import { redis } from '../redis/client';

export interface EdgarJobData {
	ticker: string;
	filingType: '10-K' | '10-Q' | '8-K';
	year: number;
	collectionId: string;
	requestedBy: string;
	cacheKey: string;  // used for 24h dedup in Redis
}

export const edgarQueue = new Queue<EdgarJobData>('edgar-queue', {
	connection: redis,
	defaultJobOptions: {
		attempts: 3,
		backoff: { type: 'exponential', delay: 10_000 },
		removeOnComplete: 10,
		removeOnFail: 20,
	},
});
