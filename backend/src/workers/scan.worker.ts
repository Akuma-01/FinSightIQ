import { Job, Worker } from 'bullmq';
import { logger } from '../lib/logger';
import { ScanJobData } from '../queue/scan.queue';
import { redis } from '../redis/client';
import {
	scanCollection,
	scanDocumentPairTargeted,
} from '../services/contradiction.service';

let activeJobs = 0;
export const getScanWorkerStatus = (): 'active' | 'idle' => activeJobs > 0 ? 'active' : 'idle';

export function startScanWorker(): void {
	const worker = new Worker<ScanJobData>(
		'scan-queue',
		async (job: Job<ScanJobData>) => {
			activeJobs++;
			try {
				const { collectionId, userId, mode, docIdA, docIdB } = job.data;

				if (mode === 'targeted') {
					if (!docIdA || !docIdB) {
						throw new Error('Targeted scan requires docIdA and docIdB');
					}
					await scanDocumentPairTargeted(docIdA, docIdB, collectionId, userId);
					return;
				}

				await scanCollection(collectionId, userId);
			} finally {
				activeJobs--;
			}
		},
		{ connection: redis, concurrency: 2 }
	);

	worker.on('failed', (job, err) => {
		logger.error({ jobId: job?.id, err }, 'Scan worker job failed');
	});

	logger.info('Scan worker started');
}
