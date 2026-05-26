import { Worker } from 'bullmq';
import { db } from '../db/pool';
import { redis } from '../redis/client';

let _status: 'active' | 'idle' = 'idle';
export const getCleanupWorkerStatus = () => _status;

export function startCleanupWorker(): void {
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
				console.info(`✓ ws_events purge: ${result.rowCount ?? 0} rows deleted`);
			} finally {
				_status = 'idle';
			}
		},
		{ connection: redis }
	);

	worker.on('failed', (job, err) => {
		console.error(`Cleanup worker failed [job=${job?.id}]:`, err.message);
		_status = 'idle';
	});

	console.info('✓ Cleanup worker started');
}
