export type WSEventType =
	| 'document:processing'
	| 'document:ready'
	| 'document:failed'
	| 'contradiction:new'
	| 'scan:started'
	| 'scan:complete'
	| 'annotation:created'
	| 'annotation:updated'
	| 'annotation:deleted'
	| 'stale_reference:new'
	| 'presence:join'
	| 'presence:leave'
	| 'room:state'
	| 'error'
	| 'pong';

export interface WSMessage {
	event: WSEventType;
	seq?: number;   // set by server on broadcast; absent on client→server messages
	timestamp: string;   // ISO 8601
	payload: unknown;
}

// Client → Server action union
export type ClientAction =
	| { action: 'join'; collectionId: string; lastSeq?: number }
	| { action: 'leave'; collectionId: string }
	| { action: 'ping' }
	| { action: 'viewing'; collectionId: string; documentId: string };
