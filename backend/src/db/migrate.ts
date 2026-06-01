import { readFileSync } from "fs";
import { join } from 'path';
import { logger } from '../lib/logger';
import { db } from './pool';

async function migrate() {
	const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
	const client = await db.connect();

	try {
		await client.query('BEGIN');
		await client.query(sql);
		await client.query('COMMIT');
		logger.info('✓ Schema migration applied');
	} catch (err) {
		await client.query('ROLLBACK');
		logger.error({ err }, '✗ Migration failed — rolled back');
		process.exit(1);
	} finally {
		client.release();
		await db.end();
	}
}

migrate();
