import { Queue } from 'bullmq';
import { redis } from '../redis/client';

export interface IngestJobData {
	documentId: string;
	collectionId: string;
	jobId: string;
	storageKey: string;
	chunkingStrategy: 'fixed_256' | 'fixed_512' | 'sentence' | 'section_aware';
}

export const ingestQueue = new Queue<IngestJobData>('ingest-queue', {
	connection: redis,
	defaultJobOptions: {
		attempts: 3,
		backoff: {
			type: 'exponential',
			delay: 5_000,
		},
		removeOnComplete: 20,
		removeOnFail: 50,
	},
});
