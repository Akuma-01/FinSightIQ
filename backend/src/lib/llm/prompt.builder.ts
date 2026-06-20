import { db } from '../../db/pool';
import { logger } from '../logger';
import { AppError } from '../../middleware/error.middleware';

interface CachedTemplate {
	id: string;
	body: string;
	cachedAt: number;
}

const promptCache = new Map<string, CachedTemplate>();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getActiveTemplate(task: string): Promise<{ id: string; body: string }> {
	const cached = promptCache.get(task);
	if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
		return { id: cached.id, body: cached.body };
	}

	const { rows } = await db.query(
		`SELECT id, body FROM prompt_templates
     WHERE task = $1 AND is_active = TRUE
     ORDER BY version DESC LIMIT 1`,
		[task]
	);

	if (!rows[0]) throw new AppError(500, `No active prompt template found for task: ${task}`);

	const entry: CachedTemplate = {
		id: rows[0].id,
		body: rows[0].body,
		cachedAt: Date.now(),
	};
	promptCache.set(task, entry);
	return { id: entry.id, body: entry.body };
}

export function invalidatePromptCache(task: string): void {
	promptCache.delete(task);
	logger.info({ task }, 'Prompt cache invalidated');
}

export async function buildPrompt(
	task: string,
	variables: Record<string, unknown>
): Promise<{ body: string; promptVersionId: string }> {
	const template = await getActiveTemplate(task);
	let body = template.body;

	for (const [key, rawValue] of Object.entries(variables)) {
		const safeValue = String(rawValue ?? '')
			.replace(/\{\{/g, '{ {')
			.replace(/\}\}/g, '} }');
		const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		body = body.replace(new RegExp(`\\{\\{${escapedKey}\\}\\}`, 'g'), safeValue);
	}

	const remaining = body.match(/\{\{[^}]+\}\}/g);
	if (remaining) {
		throw new AppError(500, `Unfilled prompt variables: ${remaining.join(', ')}`);
	}

	return { body, promptVersionId: template.id };
}
