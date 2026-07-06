'use client';

import { useAuth } from '@/context/AuthContext';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:4000';

type Handler = (payload: unknown) => void;
type WSMessage = { event: string; seq?: number; timestamp?: string; payload: unknown };

export type WSStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

interface WebSocketContextValue {
	status: WSStatus;
	on: (event: string, handler: Handler) => () => void;
	send: (data: object) => void;
	joinRoom: (collectionId: string) => void;
	leaveRoom: (collectionId: string) => void;
	viewing: (collectionId: string, documentId: string) => void;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
	const { token } = useAuth();
	const ws = useRef<WebSocket | null>(null);
	const handlers = useRef<Map<string, Set<Handler>>>(new Map());
	const lastSeqRef = useRef<number>(0);
	const retryCount = useRef(0);
	const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const shouldReconnect = useRef(true);
	const tokenRef = useRef<string | null>(token);
	const connectRef = useRef<() => void>(() => {});

	const [status, setStatus] = useState<WSStatus>('disconnected');

	useEffect(() => {
		tokenRef.current = token;
	}, [token]);

	const connect = useCallback(() => {
		const currentToken = tokenRef.current;
		if (!currentToken) return;

		clearTimeout(retryTimer.current ?? undefined);
		shouldReconnect.current = true;
		setStatus(retryCount.current > 0 ? 'reconnecting' : 'connecting');

		// Browser WebSocket handshakes cannot include custom Authorization headers.
		// Keep access-token TTL short and avoid logging query strings in production proxies.
		const socket = new WebSocket(`${WS_URL}/ws?token=${encodeURIComponent(currentToken)}`);
		ws.current = socket;

		socket.onopen = () => {
			retryCount.current = 0;
			setStatus('connected');
		};

		socket.onmessage = (event) => {
			try {
				const message = JSON.parse(event.data) as WSMessage;
				if (message.seq) lastSeqRef.current = Math.max(lastSeqRef.current, message.seq);
				handlers.current.get(message.event)?.forEach((handler) => handler(message.payload));
				handlers.current.get('*')?.forEach((handler) => handler(message));
			} catch {
				// Ignore malformed WebSocket payloads.
			}
		};

		socket.onclose = (event) => {
			if (ws.current === socket) ws.current = null;
			setStatus('disconnected');
			if (!shouldReconnect.current || event.code === 1008) return;

			const delay = Math.min(1000 * 2 ** retryCount.current, 30_000);
			retryCount.current++;
			retryTimer.current = setTimeout(() => connectRef.current(), delay);
		};

		socket.onerror = () => {
			socket.close();
		};
	}, []);

	useEffect(() => {
		connectRef.current = connect;
	}, [connect]);

	useEffect(() => {
		if (!token) {
			shouldReconnect.current = false;
			clearTimeout(retryTimer.current ?? undefined);
			ws.current?.close(1000, 'Logged out');
			ws.current = null;
			return;
		}

		shouldReconnect.current = true;
		if (!ws.current || ws.current.readyState === WebSocket.CLOSED) {
			connect();
		}
	}, [connect, token]);

	useEffect(() => {
		return () => {
			shouldReconnect.current = false;
			clearTimeout(retryTimer.current ?? undefined);
			ws.current?.close(1000, 'App unmounted');
		};
	}, []);

	const on = useCallback((event: string, handler: Handler) => {
		if (!handlers.current.has(event)) handlers.current.set(event, new Set());
		handlers.current.get(event)!.add(handler);
		return () => handlers.current.get(event)?.delete(handler);
	}, []);

	const send = useCallback((data: object) => {
		if (ws.current?.readyState === WebSocket.OPEN) {
			ws.current.send(JSON.stringify(data));
		}
	}, []);

	const joinRoom = useCallback((collectionId: string) => {
		send({ action: 'join', collectionId, lastSeq: lastSeqRef.current });
	}, [send]);

	const leaveRoom = useCallback((collectionId: string) => {
		send({ action: 'leave', collectionId });
	}, [send]);

	const viewing = useCallback((collectionId: string, documentId: string) => {
		send({ action: 'viewing', collectionId, documentId });
	}, [send]);

	useEffect(() => {
		const interval = setInterval(() => send({ action: 'ping' }), 30_000);
		return () => clearInterval(interval);
	}, [send]);

	return (
		<WebSocketContext.Provider value={{ status, on, send, joinRoom, leaveRoom, viewing }}>
			{children}
		</WebSocketContext.Provider>
	);
}

export function useSharedWebSocket() {
	const context = useContext(WebSocketContext);
	if (!context) throw new Error('useSharedWebSocket must be used inside WebSocketProvider');
	return context;
}
