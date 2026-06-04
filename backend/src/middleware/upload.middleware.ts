import multer from 'multer';
import { config } from '../config';
import { AppError } from './error.middleware';

const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'text/plain']);

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
