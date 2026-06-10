import { randomUUID } from 'crypto';
import { createWriteStream, mkdirSync, unlinkSync } from 'fs';
import { basename, join, resolve } from 'path';
import { config } from '../config';
import { logger } from '../lib/logger';

export interface StoredFile {
	storageKey: string;
	localPath: string;
	originalName: string;
	mimeType: string;
	sizeBytes: number;
}

export function sanitizeFilename(raw: string): string {
	const base = basename(raw);
	const noControlChars = base.replace(/[\x00-\x1f\x7f]/g, '');
	const safe = noControlChars.replace(/[^a-zA-Z0-9._-]/g, '_');
	const noLeadingDot = safe.replace(/^\.+/, '');
	const truncated = noLeadingDot.slice(0, 200);
	return truncated || `upload_${randomUUID()}`;
}

export async function saveFile(
	buffer: Buffer,
	originalName: string,
	mimeType: string
): Promise<StoredFile> {
	const safeFilename = sanitizeFilename(originalName);
	const fileId = randomUUID();
	const subdir = join(config.UPLOAD_DIR, fileId);
	const absPath = join(subdir, safeFilename);
	const resolvedUploadDir = resolve(config.UPLOAD_DIR);
	const resolvedAbsPath = resolve(absPath);

	if (resolvedAbsPath !== resolvedUploadDir && !resolvedAbsPath.startsWith(`${resolvedUploadDir}/`)) {
		throw new Error('Path traversal detected: resolved path escapes UPLOAD_DIR');
	}

	mkdirSync(subdir, { recursive: true });

	await new Promise<void>((resolve, reject) => {
		const ws = createWriteStream(absPath);

		ws.once('error', reject);
		ws.once('finish', resolve);

		ws.end(buffer);
	});

	const storageKey = `${fileId}/${safeFilename}`;
	logger.debug({ storageKey, sizeBytes: buffer.length }, 'File saved to local disk');

	return {
		storageKey,
		localPath: absPath,
		originalName: safeFilename,
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
