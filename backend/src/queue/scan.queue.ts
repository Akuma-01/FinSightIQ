import { Queue } from 'bullmq';
import { redis } from '../redis/client';

type ScanUserRole = 'admin' | 'analyst' | 'compliance_officer' | 'researcher';

export interface ScanJobData {
	collectionId: string;
	userId: string;
	userRole: ScanUserRole;
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
