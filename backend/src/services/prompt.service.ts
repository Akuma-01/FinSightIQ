import { db } from '../db/pool';
import { AppError } from '../middleware/error.middleware';

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
	const { rows: existing } = await db.query(
		'SELECT MAX(version) AS max_v FROM prompt_templates WHERE task = $1',
		[data.task]
	);
	const nextVersion = (existing[0]?.max_v ?? 0) + 1;

	const { rows } = await db.query(
		`INSERT INTO prompt_templates (task, version, body, description, is_active)
     VALUES ($1,$2,$3,$4,FALSE)
     RETURNING *`,
		[data.task, nextVersion, data.body, data.description]
	);
	return rows[0];
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
