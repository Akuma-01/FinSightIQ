import { readFileSync } from "fs";
import { join } from 'path';
import { logger } from '../lib/logger';
import { db } from './pool';

async function migrate() {
	const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
	try {
		await db.query(sql);
		logger.info('Schema applied');
	} catch (err) {
		logger.error({ err }, 'Migration failed');
		process.exit(1);
	} finally {
		await db.end();
	}
}

migrate();
