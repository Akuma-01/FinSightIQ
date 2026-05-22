import WebSocket from 'ws';
import { db } from '../db/pool';
import { redis, redisSub } from '../redis/client';
import { AuthUser } from '../types/express';
import { WSEventType, WSMessage } from './ws.events';
import * as Presence from './ws.presence';

// collectionId → Set of local sockets on THIS process instance
const localRooms = new Map<string, Set<WebSocket>>();

/** Called once on startup — forwards Redis pub/sub messages to local sockets */
export function initRedisSub(): void {
	redisSub.on('message', (channel: string, raw: string) => {
		const collectionId = channel.replace('collection:', '');
		const sockets = localRooms.get(collectionId);
		if (!sockets) return;
		for (const socket of sockets) {
			if (socket.readyState === WebSocket.OPEN) socket.send(raw);
		}
	});
}

/** Join a room. Performs membership check for non-admins. */
export async function joinRoom(
	socket: WebSocket,
	user: AuthUser,
	collectionId: string,
	lastSeq?: number
): Promise<void> {
	// Membership check — mirrors REST requireCollectionMember
	if (user.role !== 'admin') {
		const { rows } = await db.query(
			'SELECT 1 FROM collection_members WHERE collection_id = $1 AND user_id = $2',
			[collectionId, user.id]
		);
		if (rows.length === 0) {
			socket.send(JSON.stringify({
				event: 'error',
				timestamp: new Date().toISOString(),
				payload: { code: 403, message: 'Not a member of this collection' },
			} satisfies Omit<WSMessage, 'seq'>));
			return;
		}
	}

	// Add to local room
	if (!localRooms.has(collectionId)) localRooms.set(collectionId, new Set());
	localRooms.get(collectionId)!.add(socket);

	// Subscribe to Redis channel (idempotent)
	await redisSub.subscribe(`collection:${collectionId}`);

	// Resolve display name
	const { rows } = await db.query(
		'SELECT display_name FROM users WHERE id = $1',
		[user.id]
	);
	const displayName = rows[0]?.display_name ?? user.email;

	Presence.add(collectionId, { userId: user.id, displayName, role: user.role });

	// Send room:state to the joining client (current presence + any missed events)
	const activeUsers = Presence.get(collectionId);
	const recentEvents: unknown[] = [];

	if (lastSeq !== undefined) {
		const missed = await db.query(
			`SELECT seq, event_type, payload, created_at
       FROM ws_events
       WHERE collection_id = $1 AND seq > $2
       ORDER BY seq ASC LIMIT 100`,
			[collectionId, lastSeq]
		);
		recentEvents.push(...missed.rows);
	}

	socket.send(JSON.stringify({
		event: 'room:state',
		timestamp: new Date().toISOString(),
		payload: { activeUsers, recentEvents },
	}));

	// Broadcast presence:join to everyone else
	await broadcastToRoom(collectionId, 'presence:join', { userId: user.id, displayName, role: user.role });
}

export async function leaveRoom(
	socket: WebSocket,
	user: AuthUser,
	collectionId: string
): Promise<void> {
	localRooms.get(collectionId)?.delete(socket);
	Presence.remove(collectionId, user.id);

	if (!localRooms.get(collectionId)?.size) {
		localRooms.delete(collectionId);
		await redisSub.unsubscribe(`collection:${collectionId}`);
	}

	await broadcastToRoom(collectionId, 'presence:leave', { userId: user.id });
}

export async function leaveAllRooms(socket: WebSocket, user: AuthUser): Promise<void> {
	const affected = Presence.removeFromAll(user.id);
	for (const collectionId of affected) {
		localRooms.get(collectionId)?.delete(socket);
		await broadcastToRoom(collectionId, 'presence:leave', { userId: user.id });
	}
}

/**
 * Publish a broadcast to a collection room via Redis.
 * Also persists the event to ws_events using the per-collection PostgreSQL sequence.
 * Both the local sockets AND all other process instances receive the message via Redis sub.
 */
export async function broadcastToRoom(
	collectionId: string,
	event: WSEventType,
	payload: unknown
): Promise<void> {
	let seq = 0;

	try {
		// nextval() is atomic — no two concurrent callers get the same value
		const seqName = `ws_seq_${collectionId.replace(/-/g, '_')}`;
		const { rows } = await db.query(
			`SELECT nextval('"${seqName}"') AS seq`
		);
		seq = Number(rows[0].seq);

		await db.query(
			`INSERT INTO ws_events (collection_id, seq, event_type, payload)
       VALUES ($1, $2, $3, $4)`,
			[collectionId, seq, event, JSON.stringify(payload)]
		);
	} catch {
		// Sequence may not exist if collection was just created in the same request —
		// broadcast proceeds without persisting seq. This is safe; reconnect replay
		// will simply not include this event.
	}

	const message = JSON.stringify({
		event,
		seq,
		timestamp: new Date().toISOString(),
		payload,
	} satisfies WSMessage);

	await redis.publish(`collection:${collectionId}`, message);
}
