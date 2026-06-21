import { Server as HTTPServer } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { logger } from '../lib/logger';
import { AuthUser } from '../types/express';
import { authenticateWSHandshake } from './ws.auth';
import { ClientAction } from './ws.events';
import * as Rooms from './ws.rooms';

let connectionCount = 0;
export const getWsConnectionCount = () => connectionCount;

export function initWebSocketServer(httpServer: HTTPServer): WebSocketServer {
	const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

	Rooms.initRedisSub();

	wss.on('connection', (socket: WebSocket, req) => {
		let user: AuthUser;

		// ── 1. Auth ───────────────────────────────────────────────────
		try {
			user = authenticateWSHandshake(req);
		} catch (err: any) {
			socket.send(JSON.stringify({
				event: 'error',
				timestamp: new Date().toISOString(),
				payload: { code: 401, message: err.message },
			}));
			socket.close(1008, 'Unauthorized');
			return;
		}

		connectionCount++;

		// ── 2. Heartbeat (closes socket if no ping in 90s) ────────────
		let heartbeatTimer: NodeJS.Timeout;
		const resetHeartbeat = () => {
			clearTimeout(heartbeatTimer);
			heartbeatTimer = setTimeout(() => socket.terminate(), 90_000);
		};
		resetHeartbeat();

		// ── 3. Message handler ────────────────────────────────────────
		socket.on('message', async (rawData) => {
			let msg: ClientAction;
			try {
				msg = JSON.parse(rawData.toString());
			} catch {
				return; // ignore malformed messages silently
			}

			switch (msg.action) {
				case 'join':
					await Rooms.joinRoom(socket, user, msg.collectionId, msg.lastSeq);
					break;
				case 'leave':
					await Rooms.leaveRoom(socket, user, msg.collectionId);
					break;
				case 'ping':
					resetHeartbeat();
					socket.send(JSON.stringify({
						event: 'pong',
						timestamp: new Date().toISOString(),
						payload: {},
					}));
					break;
				case 'viewing':
					await Rooms.broadcastViewing(
						socket,
						user,
						msg.collectionId,
						msg.documentId
					);
					break;
			}
		});

		// ── 4. Cleanup on disconnect ──────────────────────────────────
		socket.on('close', async () => {
			clearTimeout(heartbeatTimer);
			connectionCount--;
			await Rooms.leaveAllRooms(socket, user);
		});

		socket.on('error', (err) => {
			logger.error({ err, userId: user?.id }, 'WS socket error');
		});
	});

	logger.info({ path: '/ws' }, 'WebSocket server initialized');
	return wss;
}
