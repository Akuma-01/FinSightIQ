'use client';

import { useSharedWebSocket } from '@/context/WebSocketContext';
import { normalizeAnnotation, normalizeContradiction } from '@/lib/api';
import { contradictionTypeLabel } from '@/lib/labels';
import type { Annotation, Contradiction } from '@/types/api';
import { useEffect, useRef } from 'react';
import toast from 'react-hot-toast';

const SEVERITY_ICON = {
	critical: '🔴',
	moderate: '🟡',
	minor: '🔵',
} as const;

type CollectionRoomCallbacks = {
	onDocumentProcessing?: (payload: { documentId: string; filename: string }) => void;
	onDocumentReady?: (payload: { documentId: string; filename: string; chunkCount: number }) => void;
	onDocumentFailed?: (payload: { documentId: string; filename: string; failureReason: string }) => void;
	onContradictionNew?: (payload: Contradiction) => void;
	onScanStarted?: (payload: unknown) => void;
	onScanProgress?: (payload: unknown) => void;
	onScanComplete?: (payload: { newContradictions?: number }) => void;
	onPresenceJoin?: (payload: { userId: string; displayName: string; role?: string }) => void;
	onPresenceViewing?: (payload: { userId: string; documentId: string }) => void;
	onPresenceLeave?: (payload: { userId: string }) => void;
	onRoomState?: (payload: unknown) => void;
	onAnnotationCreated?: (payload: { annotation: Annotation }) => void;
	onAnnotationUpdated?: (payload: { annotation: Annotation }) => void;
	onAnnotationDeleted?: (payload: { annotationId: string }) => void;
};

export function useCollectionRoom(
	token: string | null,
	collectionId: string | null,
	callbacks: CollectionRoomCallbacks = {}
) {
	const { status, joinRoom, leaveRoom, on, viewing } = useSharedWebSocket();

	const callbacksRef = useRef(callbacks);

	useEffect(() => {
		callbacksRef.current = callbacks;
	});

	useEffect(() => {
		if (!token || !collectionId || status !== 'connected') return;
		joinRoom(collectionId);
		return () => leaveRoom(collectionId);
	}, [collectionId, leaveRoom, joinRoom, status, token]);

	useEffect(() => {
		const offHandlers = [
			on('room:state', (payload) => callbacksRef.current.onRoomState?.(payload)),
			on('document:processing', (payload) => {
				const p = payload as { documentId: string; filename: string };
				callbacksRef.current.onDocumentProcessing?.(p);
			}),
			on('document:ready', (payload) => {
				const p = payload as { documentId: string; filename: string; chunkCount: number };
				toast.success(`Document ready: ${p.filename}`);
				callbacksRef.current.onDocumentReady?.(p);
			}),
			on('document:failed', (payload) => {
				const p = payload as { documentId: string; filename: string; failureReason: string };
				toast.error(`Ingestion failed: ${p.filename}`);
				callbacksRef.current.onDocumentFailed?.(p);
			}),
			on('contradiction:new', (payload) => {
				const c = normalizeContradiction(payload as Parameters<typeof normalizeContradiction>[0]);
				const icon = SEVERITY_ICON[c.severity] ?? '⚠️';
				toast(`${icon} ${contradictionTypeLabel(c.contradictionType)} detected`);
				callbacksRef.current.onContradictionNew?.(c);
			}),
			on('scan:started', (payload) => callbacksRef.current.onScanStarted?.(payload)),
			on('scan:progress', (payload) => callbacksRef.current.onScanProgress?.(payload)),
			on('scan:complete', (payload) => {
				const p = payload as { newContradictions?: number };
				toast.success(`Scan complete${typeof p.newContradictions === 'number' ? ` — ${p.newContradictions} new` : ''}`);
				callbacksRef.current.onScanComplete?.(p);
			}),
			on('presence:join', (payload) => callbacksRef.current.onPresenceJoin?.(payload as { userId: string; displayName: string; role?: string })),
			on('presence:viewing', (payload) => callbacksRef.current.onPresenceViewing?.(payload as { userId: string; documentId: string })),
			on('presence:leave', (payload) => callbacksRef.current.onPresenceLeave?.(payload as { userId: string })),
			on('annotation:created', (payload) => {
				const p = payload as { annotation: Parameters<typeof normalizeAnnotation>[0] };
				callbacksRef.current.onAnnotationCreated?.({ annotation: normalizeAnnotation(p.annotation) });
			}),
			on('annotation:updated', (payload) => {
				const p = payload as { annotation: Parameters<typeof normalizeAnnotation>[0] };
				callbacksRef.current.onAnnotationUpdated?.({ annotation: normalizeAnnotation(p.annotation) });
			}),
			on('annotation:deleted', (payload) => callbacksRef.current.onAnnotationDeleted?.(payload as { annotationId: string })),
		];

		return () => {
			for (const off of offHandlers) off();
		};
	}, [on]);

	return {
		wsStatus: status,
		sendViewing: viewing,
	};
}
