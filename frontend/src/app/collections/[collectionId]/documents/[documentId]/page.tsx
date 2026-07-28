'use client';

import { AnnotationSidebar } from '@/components/annotations/AnnotationSidebar';
import { Spinner } from '@/components/ui/Spinner';
import { useAuth } from '@/context/AuthContext';
import { useCollectionRoom } from '@/hooks/useCollectionRoom';
import { ai, annotations as annotationsAPI, documents as documentsAPI } from '@/lib/api';
import type { Annotation, Document } from '@/types/api';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useCallback, useEffect, useMemo, useState } from 'react';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
	ssr: false,
	loading: () => (
		<div className="flex h-full items-center justify-center bg-slate-950">
			<Spinner className="text-blue-300" />
		</div>
	),
});

type ActiveUser = { userId: string; displayName: string; role?: string; documentId?: string };

export default function DocumentViewerPage({
	params,
}: {
	params: Promise<{ collectionId: string; documentId: string }>;
}) {
	const { collectionId, documentId } = use(params);
	const { token, user, loading: authLoading } = useAuth();
	const router = useRouter();
	const [document, setDocument] = useState<Document | null>(null);
	const [annotations, setAnnotations] = useState<Annotation[]>([]);
	const [activeUsers, setActiveUsers] = useState<ActiveUser[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [summary, setSummary] = useState('');
	const [summarizing, setSummarizing] = useState(false);
	const [summaryError, setSummaryError] = useState('');

	useEffect(() => {
		if (authLoading) return;
		if (!token) {
			router.replace('/login');
			return;
		}

		let cancelled = false;
		Promise.all([
			documentsAPI.get(token, collectionId, documentId),
			annotationsAPI.list(token, collectionId, documentId),
		])
			.then(([documentResult, annotationResult]) => {
				if (cancelled) return;
				setDocument(documentResult.document);
				setAnnotations(annotationResult.annotations);
			})
			.catch((err) => {
				if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load document');
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, [authLoading, collectionId, documentId, router, token]);

	const onRoomState = useCallback((payload: unknown) => {
		const state = payload as { activeUsers?: ActiveUser[] };
		setActiveUsers((state.activeUsers ?? []).filter((activeUser) => activeUser.userId !== user?.id));
	}, [user?.id]);

	const onPresenceJoin = useCallback((payload: { userId: string; displayName: string; role?: string }) => {
		if (payload.userId === user?.id) return;
		setActiveUsers((current) => current.some((activeUser) => activeUser.userId === payload.userId)
			? current
			: [...current, payload]);
	}, [user?.id]);

	const onPresenceViewing = useCallback((payload: { userId: string; documentId: string }) => {
		setActiveUsers((current) => current.map((activeUser) => (
			activeUser.userId === payload.userId ? { ...activeUser, documentId: payload.documentId } : activeUser
		)));
	}, []);

	const onPresenceLeave = useCallback((payload: { userId: string }) => {
		setActiveUsers((current) => current.filter((activeUser) => activeUser.userId !== payload.userId));
	}, []);

	const onAnnotationCreated = useCallback((payload: { annotation: Annotation }) => {
		setAnnotations((current) => current.some((annotation) => annotation.id === payload.annotation.id)
			? current
			: [...current, payload.annotation]);
	}, []);

	const onAnnotationUpdated = useCallback((payload: { annotation: Annotation }) => {
		setAnnotations((current) => current.map((annotation) => (
			annotation.id === payload.annotation.id ? payload.annotation : annotation
		)));
	}, []);

	const onAnnotationDeleted = useCallback((payload: { annotationId: string }) => {
		setAnnotations((current) => current.filter((annotation) => annotation.id !== payload.annotationId));
	}, []);

	const roomCallbacks = useMemo(() => ({
		onRoomState,
		onPresenceJoin,
		onPresenceViewing,
		onPresenceLeave,
		onAnnotationCreated,
		onAnnotationUpdated,
		onAnnotationDeleted,
	}), [
		onAnnotationCreated,
		onAnnotationDeleted,
		onAnnotationUpdated,
		onPresenceJoin,
		onPresenceLeave,
		onPresenceViewing,
		onRoomState,
	]);

	const { wsStatus, sendViewing } = useCollectionRoom(token, collectionId, roomCallbacks);

	useEffect(() => {
		if (wsStatus === 'connected') sendViewing(collectionId, documentId);
	}, [collectionId, documentId, sendViewing, wsStatus]);

	async function summarizeDocument() {
		if (!token) return;
		setSummarizing(true);
		setSummaryError('');
		try {
			const result = await ai.summarizeDocument(token, documentId);
			setSummary(result.summary);
		} catch (err) {
			setSummaryError(err instanceof Error ? err.message : 'Could not summarize document');
		} finally {
			setSummarizing(false);
		}
	}

	if (authLoading || loading) {
		return (
			<main className="flex min-h-screen items-center justify-center bg-slate-950">
				<Spinner className="text-blue-300" />
			</main>
		);
	}

	if (!token || !user) return null;

	if (error) {
		return (
			<main className="min-h-screen bg-slate-950 p-8">
				<Link href={`/collections/${collectionId}`} className="text-sm font-medium text-blue-300 hover:underline">
					← Back to collection
				</Link>
				<div className="mt-6 rounded-lg border border-red-400/40 bg-red-500/15 px-4 py-3 text-sm text-red-200">
					{error}
				</div>
			</main>
		);
	}

	const rawText = document?.rawText?.trim()
		? document.rawText
		: '(This document is not ready to display yet. Please try again shortly.)';

	return (
		<main className="flex h-screen overflow-hidden bg-slate-950">
			<section className="flex min-w-0 flex-1 flex-col">
				<header className="border-b border-slate-800 bg-slate-900/95 px-5 py-4 shadow-sm shadow-slate-950/30 backdrop-blur-xl">
					<Link href={`/collections/${collectionId}/contradictions`} className="text-xs font-bold text-blue-300 hover:underline">
						← Back to risk review
					</Link>
					<div className="mt-2 flex flex-wrap items-center justify-between gap-3">
						<div className="min-w-0">
							<h1 className="truncate text-lg font-bold text-white">{document?.filename ?? 'Document'}</h1>
							<p className="mt-1 text-xs text-slate-400">
								{document?.source || 'Uploaded document'} · {document?.status === 'ready' ? 'Ready to review' : 'Preparing for review'}
							</p>
						</div>
						<div className="flex flex-wrap gap-2">
							<button
								type="button"
								onClick={summarizeDocument}
								disabled={summarizing || document?.status !== 'ready'}
								className="rounded-full border border-blue-400/40 bg-blue-500/15 px-3 py-1 text-xs font-bold text-blue-200 hover:bg-blue-500/25 disabled:opacity-50"
							>
								{summarizing ? 'Preparing…' : 'Create briefing'}
							</button>
							{activeUsers.length === 0 && (
								<span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-300">
									Only you viewing
								</span>
							)}
							{activeUsers
								.filter((activeUser) => !activeUser.documentId || activeUser.documentId === documentId)
								.map((activeUser) => (
									<span key={activeUser.userId} className="rounded-full border border-purple-400/40 bg-purple-500/15 px-2 py-0.5 text-xs font-bold text-purple-200">
										{activeUser.displayName}
									</span>
								))}
						</div>
					</div>
				</header>

				<div className="min-h-0 flex-1 border-t border-slate-800">
					{(summary || summaryError || summarizing) && (
						<section className="border-b border-slate-800 bg-slate-900/90 px-5 py-4">
							<div className="flex items-start justify-between gap-4">
								<div>
									<p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-300">Document briefing</p>
									<p className="mt-1 text-xs text-slate-400">
										A concise overview based on this document.
									</p>
								</div>
								{summary && (
									<button
										type="button"
										onClick={() => {
											setSummary('');
											setSummaryError('');
										}}
										className="rounded-full border border-slate-700 px-3 py-1 text-xs font-bold text-slate-300 hover:bg-white/10"
									>
										Hide
									</button>
								)}
							</div>
							{summarizing && <p className="mt-3 text-sm text-slate-300">Generating summary…</p>}
							{summaryError && (
								<p className="mt-3 rounded-xl border border-red-400/40 bg-red-500/15 px-3 py-2 text-sm text-red-200">
									{summaryError}
								</p>
							)}
							{summary && (
								<p className="mt-3 max-h-44 overflow-y-auto whitespace-pre-wrap rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4 text-sm leading-6 text-slate-100">
									{summary}
								</p>
							)}
						</section>
					)}
					<MonacoEditor
						height="100%"
						language="plaintext"
						value={rawText}
						options={{
							readOnly: true,
							wordWrap: 'on',
							minimap: { enabled: false },
							fontSize: 13,
							scrollBeyondLastLine: false,
						}}
					/>
				</div>
			</section>

			<section className="hidden w-96 border-l border-slate-800 bg-slate-950 md:block">
				<AnnotationSidebar
					annotations={annotations}
					token={token}
					collectionId={collectionId}
					documentId={documentId}
					currentUserId={user.id}
					userRole={user.role}
				/>
			</section>
		</main>
	);
}
