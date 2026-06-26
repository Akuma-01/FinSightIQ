import { Job, Worker } from 'bullmq';
import { logger } from '../lib/logger';
import { BenchmarkJobData } from '../queue/benchmark.queue';
import { redis } from '../redis/client';
import * as GroundTruthService from '../services/groundTruth.service';

let activeJobs = 0;
export const getBenchmarkWorkerStatus = (): 'active' | 'idle' => activeJobs > 0 ? 'active' : 'idle';

export function startBenchmarkWorker(): void {
	const worker = new Worker<BenchmarkJobData>(
		'benchmark-queue',
		async (job: Job<BenchmarkJobData>) => {
			activeJobs++;
			const { benchmarkType, userId, collectionIds } = job.data;
			try {
				switch (benchmarkType) {
					case 'model_comparison':
						await GroundTruthService.runModelComparisonBenchmark(userId);
						break;
					case 'chunking_strategy':
						await GroundTruthService.runChunkingStrategyBenchmark(collectionIds ?? {}, userId);
						break;
					case 'hallucination':
						await GroundTruthService.runHallucinationBenchmark(userId);
						break;
					case 'prompt_sensitivity':
						await GroundTruthService.runPromptSensitivityBenchmark(userId);
						break;
				}
				logger.info({ benchmarkType, userId, jobId: job.id }, 'Benchmark completed');
			} finally {
				activeJobs--;
				await redis.del(`benchmark:lock:${benchmarkType}`).catch(() => undefined);
			}
		},
		{ connection: redis, concurrency: 1 }
	);

	worker.on('failed', (job, err) => {
		logger.error({ jobId: job?.id, err }, 'Benchmark worker job failed');
	});

	logger.info('Benchmark worker started');
}
