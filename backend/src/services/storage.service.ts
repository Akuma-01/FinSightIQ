import { randomUUID } from 'crypto';
import {
	createWriteStream,
	mkdirSync,
	readdirSync,
	rmdirSync,
	unlinkSync,
} from 'fs';
import { basename, dirname, join, resolve } from 'path';
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
	const uploadRoot = resolve(config.UPLOAD_DIR);
	const absolutePath = resolve(uploadRoot, storageKey);
	if (absolutePath !== uploadRoot && !absolutePath.startsWith(`${uploadRoot}/`)) {
		throw new Error('Path traversal detected: storage key escapes UPLOAD_DIR');
	}
	return absolutePath;
}

export function deleteFile(storageKey: string): void {
	if (!storageKey) return;
	const absPath = getAbsolutePath(storageKey);
	try {
		unlinkSync(absPath);
		rmdirSync(dirname(absPath));
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === 'ENOENT' || code === 'ENOTEMPTY') return;
		logger.warn({ err, storageKey }, 'Failed to delete file from local disk');
	}
}

export function pruneEmptyUploadDirectories(): number {
	const uploadRoot = resolve(config.UPLOAD_DIR);
	let removed = 0;

	try {
		for (const entry of readdirSync(uploadRoot, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;

			try {
				rmdirSync(join(uploadRoot, entry.name));
				removed++;
			} catch (err) {
				const code = (err as NodeJS.ErrnoException).code;
				if (code !== 'ENOENT' && code !== 'ENOTEMPTY') {
					logger.warn({ err, directory: entry.name }, 'Failed to prune upload directory');
				}
			}
		}
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
	}

	return removed;
}
