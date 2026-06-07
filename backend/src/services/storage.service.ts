import { randomUUID } from 'crypto';
import { createWriteStream, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { config } from '../config';
import { logger } from '../lib/logger';

// ─── Interface ───────────────────────────────────────────────────────────────
// Swap implementations here only when migrating to R2 in Phase 5.
// Nothing outside this file should know whether storage is local or remote.

export interface StoredFile {
	storageKey: string;  // opaque key — local: relative path; R2: object key
	localPath: string;  // absolute path for local access (null in R2 mode)
	originalName: string;
	mimeType: string;
	sizeBytes: number;
}

// ─── Local disk adapter ───────────────────────────────────────────────────────

/**
 * Saves a multer file to UPLOAD_DIR/<uuid>/<originalname>.
 * Returns a StoredFile with the storageKey (path relative to UPLOAD_DIR).
 */
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
		ws.write(buffer, (err) => {
			if (err) return reject(err);
			ws.end(resolve);
		});
		ws.on('error', reject);
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
		// Log but don't throw — file may already be gone
		logger.warn({ err, storageKey }, 'Failed to delete file from local disk');
	}
}
