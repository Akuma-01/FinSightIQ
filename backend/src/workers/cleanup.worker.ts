import { Worker } from 'bullmq';
import { db } from '../db/pool';
import { logger } from '../lib/logger';
import { redis } from '../redis/client';
import { pruneEmptyUploadDirectories } from '../services/storage.service';

let _status: 'active' | 'idle' = 'idle';
export const getCleanupWorkerStatus = () => _status;

export function startCleanupWorker(): void {
	const removedUploadDirectories = pruneEmptyUploadDirectories();
	if (removedUploadDirectories > 0) {
		logger.info(
			{ removedUploadDirectories },
			'Pruned empty upload directories'
		);
	}

	const worker = new Worker(
		'cleanup-queue',
		async (job) => {
			if (job.name !== 'purge-ws-events') return;

			_status = 'active';
			try {

				const result = await db.query(`
          DELETE FROM ws_events
          WHERE id IN (
            SELECT id
            FROM (
              SELECT id,
                     ROW_NUMBER() OVER (
                       PARTITION BY collection_id
                       ORDER BY seq DESC
                     ) AS rn
              FROM ws_events
            ) ranked
            WHERE rn > 1000
          )
				`);
				const removedUploadDirectories = pruneEmptyUploadDirectories();
				logger.info(
					{
						rowCount: result.rowCount ?? 0,
						removedUploadDirectories,
					},
					'Cleanup completed'
				);
			} finally {
				_status = 'idle';
			}
		},
		{ connection: redis }
	);

	worker.on('failed', (job, err) => {
		logger.error({ err, jobId: job?.id }, 'Cleanup worker failed');
		_status = 'idle';
	});

	logger.info('Cleanup worker started');
}
