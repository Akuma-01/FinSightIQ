import dotenv from "dotenv";
import { Pool } from 'pg';
import { logger } from '../lib/logger';

dotenv.config({ path: "../.env" });

export const db = new Pool({
	connectionString: process.env.DATABASE_URL,
	max: 20,
	idleTimeoutMillis: 30_000,
	connectionTimeoutMillis: 2_000,
});

db.on('error', (err) => {
	logger.error({ err }, 'Unexpected pg pool error');
	process.exit(1);;
});
