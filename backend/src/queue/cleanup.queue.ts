import { Queue } from 'bullmq';
import { redis } from '../redis/client';

export const cleanupQueue = new Queue('cleanup-queue', {
	connection: redis,
	defaultJobOptions: {
		removeOnComplete: 10,
		removeOnFail: 5,
	},
});

/**
 * Registers the repeating purge job.
 * Removes any existing repeat job first to avoid duplicates on server restart.
 */
export async function scheduleCleanupJob(): Promise<void> {
	const existing = await cleanupQueue.getRepeatableJobs();
	for (const job of existing) {
		if (job.name === 'purge-ws-events') {
			await cleanupQueue.removeRepeatableByKey(job.key);
		}
	}

	await cleanupQueue.add(
		'purge-ws-events',
		{},
		{ repeat: { every: 60 * 60 * 1000 } } // every 1 hour
	);
	console.info('✓ Cleanup job scheduled (hourly)');
}
