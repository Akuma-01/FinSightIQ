import { readFileSync } from "fs";
import { join } from 'path';
import { db } from './pool';

async function migrate() {
	const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
	try {
		await db.query(sql);
		console.info('✓ Schema applied');
	} catch (err) {
		console.error('✗ Migration failed:', err);
		process.exit(1);
	} finally {
		await db.end();
	}
}

migrate();
