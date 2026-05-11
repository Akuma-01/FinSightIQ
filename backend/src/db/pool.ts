import dotenv from "dotenv";
import { Pool } from 'pg';

dotenv.config({ path: "../.env" });

export const db = new Pool({
	connectionString: process.env.DATABASE_URL,
	max: 20,
	idleTimeoutMillis: 30_000,
	connectionTimeoutMillis: 2_000,
});

db.on('error', (err) => {
	console.error('Unexpected pg pool error', err);
	process.exit(1);;
});
