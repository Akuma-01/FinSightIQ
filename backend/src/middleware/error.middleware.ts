import { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { config } from "../config";
import { logger } from "../lib/logger";

// ─── AppError ───────────────────────────────────────────────────────────────
export class AppError extends Error {
	constructor(
		public readonly statusCode: number,
		message: string,
		public readonly isOperational = true
	) {
		super(message);
		this.name = 'AppError';
		Error.captureStackTrace(this, this.constructor);
	}
}

// ─── asyncHandler ───────────────────────────────────────────────────────────
export function asyncHandler(fn: RequestHandler): RequestHandler {
	return (req: Request, res: Response, next: NextFunction): void => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

// ─── 404 Handler ────────────────────────────────────────────────────────────
export function notFound(req: Request, _res: Response, next: NextFunction): void {
	next(new AppError(404, `Route not found: ${req.method} ${req.path}`));
}

// ─── Global Error Handler ───────────────────────────────────────────────────
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {

	// ── 1. Zod validation errors ────────────────────────────────────────────
	if (err instanceof ZodError) {
		res.status(400).json({
			error: 'Validation error',
			code: 400,
			details: err.flatten().fieldErrors,
			requestId: req.requestId,
		});
		return;
	}

	// ── 2. Known operational errors (AppError) ───────────────────────────────
	if (err instanceof AppError && err.isOperational) {
		logger.warn(
			{ requestId: req.requestId, statusCode: err.statusCode },
			err.message
		);
		res.status(err.statusCode).json({
			error: err.message,
			code: err.statusCode,
			requestId: req.requestId,
		});
		return;
	}

	// ── 3. Unexpected / programming errors ──────────────────────────────────
	// Log the full stack — do NOT expose details to the client.
	logger.error(
		{ err, requestId: req.requestId },
		'Unhandled error'
	);

	res.status(500).json({
		error: 'An unexpected error occurred',
		code: 500,
		requestId: req.requestId,
		// Only include stack in development so it never reaches production clients
		...(config.NODE_ENV === 'development' && { stack: err.stack }),
	});
}
