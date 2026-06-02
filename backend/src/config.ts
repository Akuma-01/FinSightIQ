import { z } from 'zod';
import { logger } from './lib/logger';

const EnvSchema = z.object({
	// Database
	DATABASE_URL: z.url({
		message: 'DATABASE_URL must be a valid URL',
	}),

	// Redis
	REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

	// Auth
	JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
	JWT_EXPIRES_IN: z.string().default('1h'),
	REFRESH_TOKEN_EXPIRES_DAYS: z.coerce.number().int().min(1).default(7),

	// App
	PORT: z.coerce.number().int().min(1).max(65535).default(4000),
	NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
	FRONTEND_ORIGIN: z.url().default('http://localhost:3000'),

	// File storage
	UPLOAD_DIR: z.string().default('./uploads'),
	MAX_FILE_SIZE_MB: z.coerce.number().int().min(1).max(100).default(25),

	// EDGAR
	EDGAR_USER_AGENT: z.string().default('FinSightIQ contact@example.com'),
	EDGAR_CACHE_TTL_HOURS: z.coerce.number().int().min(1).default(24),

	// Ingest worker
	INGEST_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(3),
	EMBEDDING_BATCH_SIZE: z.coerce.number().int().min(1).max(32).default(16),

	// Section-aware chunking — LLM classify
	SECTION_HEADER_CLASSIFY: z.enum(['regex', 'llm']).default('regex'),

	// Embedding / LLM (optional in Phase 1 — will be required in Phase 2)
	GROQ_API_KEY: z.string().optional(),
	GROQ_MODEL_HEAVY: z.string().default('llama-3.1-70b-versatile'),
	GROQ_MODEL_MID: z.string().default('mixtral-8x7b-32768'),
	GROQ_MODEL_FAST: z.string().default('llama-3.1-8b-instant'),
	EMBEDDING_PROVIDER: z.enum(['groq', 'huggingface', 'ollama']).default('ollama'),
	OLLAMA_BASE_URL: z.url().default('http://localhost:11434'),
	HUGGINGFACE_API_KEY: z.string().optional(),

	RAG_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.55),
});


const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
	logger.error(
		{ errors: z.treeifyError(parsed.error) },
		'Invalid environment variables'
	);
	process.exit(1);
}

export const config = parsed.data;
