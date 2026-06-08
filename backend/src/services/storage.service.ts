import { randomUUID } from 'crypto';
import { createWriteStream, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { config } from '../config';
import { logger } from '../lib/logger';

export interface StoredFile {
	storageKey: string;
	localPath: string;
	originalName: string;
	mimeType: string;
	sizeBytes: number;
}

export async function saveFile(
	buffer: Buffer,
	originalName: string,
	mimeType: string
): Promise<StoredFile> {
	const fileId = randomUUID();
	const subdir = join(config.UPLOAD_DIR, fileId);
	const absPath = join(subdir, originalName);

	mkdirSync(subdir, { recursive: true });

	await new Promise<void>((resolve, reject) => {
		const ws = createWriteStream(absPath);

		ws.once('error', reject);
		ws.once('finish', resolve);

		ws.end(buffer);
	});

	const storageKey = `${fileId}/${originalName}`;
	logger.debug({ storageKey, sizeBytes: buffer.length }, 'File saved to local disk');

	return {
		storageKey,
		localPath: absPath,
		originalName,
		mimeType,
		sizeBytes: buffer.length,
	};
}

export function getAbsolutePath(storageKey: string): string {
	return join(config.UPLOAD_DIR, storageKey);
}

export function deleteFile(storageKey: string): void {
	try {
		unlinkSync(join(config.UPLOAD_DIR, storageKey));
	} catch (err) {
		logger.warn({ err, storageKey }, 'Failed to delete file from local disk');
	}
}
