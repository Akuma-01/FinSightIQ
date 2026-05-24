
import { db } from '../db/pool';

function seqName(collectionId: string): string {
	return `ws_seq_${collectionId.replace(/-/g, '_')}`;
}

export async function createCollectionSequence(collectionId: string): Promise<void> {
	await db.query(`CREATE SEQUENCE IF NOT EXISTS "${seqName(collectionId)}"`);
}

export async function dropCollectionSequence(collectionId: string): Promise<void> {
	await db.query(`DROP SEQUENCE IF EXISTS "${seqName(collectionId)}"`);
}
