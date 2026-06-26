import { Queue } from 'bullmq';
import { redis } from '../redis/client';

export type BenchmarkType =
	| 'chunking_strategy'
	| 'model_comparison'
	| 'hallucination'
	| 'prompt_sensitivity';

export interface BenchmarkJobData {
	benchmarkType: BenchmarkType;
	userId: string;
	collectionIds?: Record<string, string>;
	notes?: string;
}

export const benchmarkQueue = new Queue<BenchmarkJobData>('benchmark-queue', {
	connection: redis,
	defaultJobOptions: {
		attempts: 1,
		removeOnComplete: 20,
		removeOnFail: 20,
	},
});
