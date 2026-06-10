import multer from 'multer';
import { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { AppError } from './error.middleware';

const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'text/plain']);
const MAGIC_BYTES: Record<string, Buffer> = {
	'application/pdf': Buffer.from([0x25, 0x50, 0x44, 0x46]),
};

function verifyMagicBytes(buffer: Buffer, mimetype: string): boolean {
	const magic = MAGIC_BYTES[mimetype];
	if (!magic) return true;
	return buffer.subarray(0, magic.length).equals(magic);
}

export const upload = multer({
	storage: multer.memoryStorage(),
	limits: {
		fileSize: config.MAX_FILE_SIZE_MB * 1024 * 1024,
		files: 1,
	},
	fileFilter: (_req, file, cb) => {
		if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
			cb(null, true);
		} else {
			cb(new AppError(415, `Unsupported file type: ${file.mimetype}. Only PDF and plain text allowed.`));
		}
	},
});

export function verifyFileIntegrity(req: Request, _res: Response, next: NextFunction): void {
	if (!req.file) {
		next();
		return;
	}

	if (!verifyMagicBytes(req.file.buffer, req.file.mimetype)) {
		next(new AppError(
			415,
			`File content does not match declared type: ${req.file.mimetype}. Rename attempts are not permitted.`
		));
		return;
	}

	next();
}
