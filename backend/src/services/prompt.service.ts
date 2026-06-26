import { db } from '../db/pool';
import { AppError } from '../middleware/error.middleware';

const KNOWN_TASKS = [
	'detect_contradictions_financial',
	'summarize_document',
	'summarize_collection',
	'semantic_search',
	'classify_severity',
	'extract_references',
	'stale_check',
] as const;

export async function listPrompts(task?: string) {
	const query = task
		? `SELECT * FROM prompt_templates WHERE task = $1 ORDER BY version DESC`
		: `SELECT * FROM prompt_templates ORDER BY task, version DESC`;
	const { rows } = await db.query(query, task ? [task] : []);
	return rows;
}

export async function getPrompt(id: string) {
	const { rows } = await db.query('SELECT * FROM prompt_templates WHERE id = $1', [id]);
	if (!rows[0]) throw new AppError(404, 'Prompt template not found');
	return rows[0];
}

export async function createPromptVersion(data: {
	task: string;
	body: string;
	description: string;
}) {
	if (!KNOWN_TASKS.includes(data.task as typeof KNOWN_TASKS[number])) {
		throw new AppError(400, `Unknown task: ${data.task}. Must be one of: ${KNOWN_TASKS.join(', ')}`);
	}

	const client = await db.connect();
	try {
		await client.query('BEGIN');
		// An advisory lock also protects the no-existing-rows case, which SELECT FOR UPDATE cannot lock.
		await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [data.task]);
		const { rows: existing } = await client.query(
			'SELECT COALESCE(MAX(version), 0) AS max_v FROM prompt_templates WHERE task = $1',
			[data.task]
		);
		const nextVersion = Number(existing[0].max_v) + 1;
		const { rows } = await client.query(
			`INSERT INTO prompt_templates (task, version, body, description, is_active)
       VALUES ($1,$2,$3,$4,FALSE)
       RETURNING *`,
			[data.task, nextVersion, data.body, data.description]
		);
		await client.query('COMMIT');
		return rows[0];
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}
}

export async function activatePrompt(id: string) {
	const { rows: target } = await db.query(
		'SELECT task FROM prompt_templates WHERE id = $1',
		[id]
	);
	if (!target[0]) throw new AppError(404, 'Prompt template not found');

	const client = await db.connect();
	try {
		await client.query('BEGIN');
		await client.query(
			'UPDATE prompt_templates SET is_active = FALSE WHERE task = $1',
			[target[0].task]
		);
		const { rows } = await client.query(
			'UPDATE prompt_templates SET is_active = TRUE WHERE id = $1 RETURNING *',
			[id]
		);
		await client.query('COMMIT');
		return rows[0];
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}
}
