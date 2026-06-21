export type WSEventType =
	| 'document:processing'
	| 'document:ready'
	| 'document:failed'
	| 'contradiction:new'
	| 'scan:started'
	| 'scan:progress'
	| 'scan:complete'
	| 'annotation:created'
	| 'annotation:updated'
	| 'annotation:deleted'
	| 'stale_reference:new'
	| 'presence:join'
	| 'presence:viewing'
	| 'presence:leave'
	| 'room:state'
	| 'error'
	| 'pong';

export interface WSMessage {
	event: WSEventType;
	seq?: number;
	timestamp: string;
	payload: unknown;
}

export type ClientAction =
	| { action: 'join'; collectionId: string; lastSeq?: number }
	| { action: 'leave'; collectionId: string }
	| { action: 'ping' }
	| { action: 'viewing'; collectionId: string; documentId: string };
