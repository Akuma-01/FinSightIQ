import { Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/pool';
import { AppError, asyncHandler } from '../middleware/error.middleware';

const EventSchema = z.object({
	collectionId: z.uuid(),
	eventType: z.enum(['walkthrough_started', 'risk_viewed', 'evidence_opened', 'walkthrough_completed']),
});

export const track = asyncHandler(async (req: Request, res: Response) => {
	const parsed = EventSchema.safeParse(req.body);
	if (!parsed.success) throw new AppError(400, parsed.error.message);
	const { rows: collectionRows } = await db.query(
		'SELECT is_demo FROM collections WHERE id = $1',
		[parsed.data.collectionId]
	);
	if (!collectionRows[0]?.is_demo) throw new AppError(400, 'Onboarding events are only available for sample workspaces');
	await db.query(
		`INSERT INTO onboarding_events (user_id, collection_id, event_type)
		 VALUES ($1, $2, $3) ON CONFLICT (user_id, collection_id, event_type) DO NOTHING`,
		[req.user!.id, parsed.data.collectionId, parsed.data.eventType]
	);
	res.status(204).end();
});

export const metrics = asyncHandler(async (_req: Request, res: Response) => {
	const { rows } = await db.query(
		`SELECT event_type, COUNT(*)::int AS count
		 FROM onboarding_events GROUP BY event_type`
	);
	const counts = Object.fromEntries(rows.map((row) => [row.event_type, row.count]));
	res.json({
		walkthroughStarted: counts.walkthrough_started ?? 0,
		riskViewed: counts.risk_viewed ?? 0,
		evidenceOpened: counts.evidence_opened ?? 0,
		walkthroughCompleted: counts.walkthrough_completed ?? 0,
	});
});
