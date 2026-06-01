import { Pool } from 'pg';
import { config } from '../config';
import { logger } from '../lib/logger';

export const db = new Pool({
	connectionString: config.DATABASE_URL,
	max: 20,
	idleTimeoutMillis: 30_000,
	connectionTimeoutMillis: 10_000,
});

db.on('error', (err) => {
	logger.error({ err }, 'Unexpected pg pool error — shutting down');
	process.exit(1);;
});
