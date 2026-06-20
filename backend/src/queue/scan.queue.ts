import { Queue } from 'bullmq';
import { redis } from '../redis/client';

export interface ScanJobData {
	collectionId: string;
	userId: string;
	mode: 'full' | 'targeted';
	docIdA?: string;
	docIdB?: string;
}

export const scanQueue = new Queue<ScanJobData>('scan-queue', {
	connection: redis,
	defaultJobOptions: {
		attempts: 1,
		removeOnComplete: 10,
		removeOnFail: 20,
	},
});
