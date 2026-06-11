import { db } from '../../db/pool';
import { AppError } from '../../middleware/error.middleware';

export async function buildPrompt(
	task: string,
	variables: Record<string, string>
): Promise<{ body: string; promptVersionId: string }> {
	const { rows } = await db.query(
		`SELECT id, body FROM prompt_templates
     WHERE task = $1 AND is_active = TRUE
     ORDER BY version DESC LIMIT 1`,
		[task]
	);

	if (!rows[0]) throw new AppError(500, `No active prompt template found for task: ${task}`);

	let body = rows[0].body as string;

	for (const [key, value] of Object.entries(variables)) {
		body = body.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
	}

	const remaining = body.match(/\{\{[^}]+\}\}/g);
	if (remaining) {
		throw new AppError(500, `Unfilled prompt variables: ${remaining.join(', ')}`);
	}

	return { body, promptVersionId: rows[0].id as string };
}
