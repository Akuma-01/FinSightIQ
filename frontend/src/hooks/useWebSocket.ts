'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:4000';

type Handler = (payload: unknown) => void;
type WSMessage = { event: string; seq?: number; timestamp?: string; payload: unknown };

export type WSStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export function useWebSocket(token: string | null) {
	const ws = useRef<WebSocket | null>(null);
	const handlers = useRef<Map<string, Set<Handler>>>(new Map());
	const lastSeqRef = useRef<number>(0);
	const retryCount = useRef(0);
	const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const shouldReconnect = useRef(true);
	const connectRef = useRef<() => void>(() => {});

	const [status, setStatus] = useState<WSStatus>('disconnected');

	const connect = useCallback(() => {
		if (!token) return;
		clearTimeout(retryTimer.current ?? undefined);
		shouldReconnect.current = true;

		setStatus(retryCount.current > 0 ? 'reconnecting' : 'connecting');

		const socket = new WebSocket(`${WS_URL}/ws?token=${encodeURIComponent(token)}`);
		ws.current = socket;

		socket.onopen = () => {
			retryCount.current = 0;
			setStatus('connected');
		};

		socket.onmessage = (e) => {
			try {
				const msg = JSON.parse(e.data) as WSMessage;
				if (msg.seq) lastSeqRef.current = Math.max(lastSeqRef.current, msg.seq);

				const eventHandlers = handlers.current.get(msg.event);
				eventHandlers?.forEach(h => h(msg.payload));

				// Fire wildcard handlers (e.g. for logging)
				handlers.current.get('*')?.forEach(h => h(msg));
			} catch { /* ignore parse errors */ }
		};

		socket.onclose = (e) => {
			setStatus('disconnected');
			if (!shouldReconnect.current || e.code === 1008) return; // auth failure — don't retry
			const delay = Math.min(1000 * 2 ** retryCount.current, 30_000);
			retryCount.current++;
			retryTimer.current = setTimeout(() => connectRef.current(), delay);
		};

		socket.onerror = () => {
			socket.close();
		};
	}, [token]);

	useEffect(() => {
		connectRef.current = connect;
	}, [connect]);

	useEffect(() => {
		connect();
		return () => {
			shouldReconnect.current = false;
			clearTimeout(retryTimer.current ?? undefined);
			ws.current?.close(1000, 'Component unmounted');
		};
	}, [connect]);

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

	const ping = useCallback(() => {
		send({ action: 'ping' });
	}, [send]);

	// Heartbeat — ping every 30s
	useEffect(() => {
		const interval = setInterval(ping, 30_000);
		return () => clearInterval(interval);
	}, [ping]);

	return { status, on, send, joinRoom, leaveRoom, viewing };
}
