'use client';

import { DocumentStatusBadge } from '@/components/documents/DocumentStatusBadge';
import { EdgarFetchModal } from '@/components/documents/EdgarFetchModal';
import { UploadModal } from '@/components/documents/UploadModal';
import { ManageMembersModal } from '@/components/collections/ManageMembersModal';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { useAuth } from '@/context/AuthContext';
import { useCollectionRoom } from '@/hooks/useCollectionRoom';
import { ai, collections as collectionsAPI, documents as documentsAPI } from '@/lib/api';
import type { Collection, Document } from '@/types/api';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { use, useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';

export default function CollectionDetailPage({
	params,
}: {
	params: Promise<{ collectionId: string }>;
}) {
	const { collectionId } = use(params);
	const { token, user, loading: authLoading } = useAuth();
	const router = useRouter();
	const searchParams = useSearchParams();
	const tourActive = searchParams.get('tour') === '1';
	const [collection, setCollection] = useState<Collection | null>(null);
	const [documents, setDocuments] = useState<Document[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [showUpload, setShowUpload] = useState(false);
	const [showEdgar, setShowEdgar] = useState(false);
	const [showMembers, setShowMembers] = useState(false);
	const [query, setQuery] = useState('');
	const [searchAnswer, setSearchAnswer] = useState('');
	const [searchSources, setSearchSources] = useState<unknown[]>([]);
	const [searching, setSearching] = useState(false);
	const [collectionSummary, setCollectionSummary] = useState('');
	const [summarizing, setSummarizing] = useState(false);
	const [retryingId, setRetryingId] = useState<string | null>(null);
	const [documentPendingDeletion, setDocumentPendingDeletion] = useState<Document | null>(null);
	const [documentDeleteLoading, setDocumentDeleteLoading] = useState(false);
	const [archiveLoading, setArchiveLoading] = useState(false);
	const [deleteLoading, setDeleteLoading] = useState(false);
	const [deleteConfirmation, setDeleteConfirmation] = useState('');

	useEffect(() => {
		if (authLoading) return;
		if (!token) {
			router.replace('/login');
			return;
		}

		let cancelled = false;
		Promise.all([
			collectionsAPI.get(token, collectionId),
			documentsAPI.list(token, collectionId),
		])
			.then(([collectionResult, documentsResult]) => {
				if (!cancelled) {
					setCollection(collectionResult.collection);
					setDocuments(documentsResult.documents);
				}
			})
			.catch((err) => {
				if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load collection');
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, [authLoading, collectionId, router, token]);

	const upsertDocument = useCallback((patch: Partial<Document> & { id: string; filename: string }) => {
		setDocuments((current) => {
			const existing = current.find((doc) => doc.id === patch.id);
			if (existing) {
				return current.map((doc) => doc.id === patch.id ? { ...doc, ...patch } : doc);
			}

			const next: Document = {
				id: patch.id,
				filename: patch.filename,
				mimeType: patch.mimeType ?? '',
				sizeBytes: patch.sizeBytes ?? 0,
				status: patch.status ?? 'processing',
				docType: patch.docType ?? '',
				source: patch.source ?? 'manual',
				effectiveDate: patch.effectiveDate ?? null,
				createdAt: patch.createdAt ?? new Date().toISOString(),
				jobStatus: patch.jobStatus,
				failureReason: patch.failureReason,
			};

			return [next, ...current];
		});
	}, []);

	const roomCallbacks = useMemo(() => ({
		onDocumentProcessing: (payload: { documentId: string; filename: string }) => {
			upsertDocument({
				id: payload.documentId,
				filename: payload.filename,
				status: 'processing',
				jobStatus: 'running',
			});
		},
		onDocumentReady: (payload: { documentId: string; filename: string; chunkCount: number }) => {
			upsertDocument({
				id: payload.documentId,
				filename: payload.filename,
				status: 'ready',
				jobStatus: 'completed',
			});
		},
		onDocumentFailed: (payload: { documentId: string; filename: string; failureReason: string }) => {
			upsertDocument({
				id: payload.documentId,
				filename: payload.filename,
				status: 'failed',
				jobStatus: 'failed',
				failureReason: payload.failureReason,
			});
		},
	}), [upsertDocument]);

	useCollectionRoom(token, collectionId, roomCallbacks);

	if (authLoading || loading) {
		return (
			<main className="flex min-h-screen items-center justify-center bg-slate-950">
				<Spinner className="text-blue-300" />
			</main>
		);
	}

	if (!token) return null;

	const readyCount = documents.filter((doc) => doc.status === 'ready').length;
	const canUpload = (user?.role === 'admin' || user?.role === 'analyst') && !collection?.archived && !collection?.isDemo;
	const canRetry = user?.role === 'admin';
	const isAdmin = user?.role === 'admin';
	const canDelete = isAdmin && Boolean(collection?.name) && deleteConfirmation.trim() === collection?.name;

	async function runSearch() {
		if (!token || !query.trim()) return;
		const controller = new AbortController();
		const timeout = window.setTimeout(() => controller.abort(), 45_000);
		setSearching(true);
		setSearchAnswer('');
		setSearchSources([]);
		try {
			const result = await ai.search(token, { collectionId, query: query.trim() }, controller.signal);
			setSearchAnswer(result.answer);
			setSearchSources(result.sources ?? []);
		} catch (err) {
			const message = err instanceof DOMException && err.name === 'AbortError'
				? 'Search timed out after 45 seconds. Local Ollama may be busy; try again after scans finish or switch the demo to Groq.'
				: err instanceof Error ? err.message : 'Search failed';
			toast.error(message);
		} finally {
			window.clearTimeout(timeout);
			setSearching(false);
		}
	}

	async function summarizeCollection() {
		if (!token) return;
		setSummarizing(true);
		try {
			const result = await ai.summarizeCollection(token, collectionId);
			setCollectionSummary(result.summary);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Collection summary failed');
		} finally {
			setSummarizing(false);
		}
	}

	async function retryDocument(document: Document) {
		if (!token) return;
		setRetryingId(document.id);
		try {
			await documentsAPI.retry(token, document.id);
			upsertDocument({
				id: document.id,
				filename: document.filename,
				status: 'processing',
				jobStatus: 'queued',
				failureReason: undefined,
			});
			toast.success(`Retry queued: ${document.filename}`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not retry document');
		} finally {
			setRetryingId(null);
		}
	}

	async function deleteDocument() {
		if (!token || !documentPendingDeletion) return;
		setDocumentDeleteLoading(true);
		try {
			await documentsAPI.remove(token, collectionId, documentPendingDeletion.id);
			setDocuments((current) => current.filter((document) => document.id !== documentPendingDeletion.id));
			toast.success(`Deleted ${documentPendingDeletion.filename}`);
			setDocumentPendingDeletion(null);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not delete document');
		} finally {
			setDocumentDeleteLoading(false);
		}
	}

	async function toggleArchiveCollection() {
		if (!token || !collection) return;
		const nextArchived = !collection.archived;
		setArchiveLoading(true);
		try {
			const result = await collectionsAPI.update(token, collectionId, { archived: nextArchived });
			setCollection(result.collection);
			toast.success(nextArchived ? 'Collection archived' : 'Collection restored');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not update collection');
		} finally {
			setArchiveLoading(false);
		}
	}

	async function deleteCollection() {
		if (!token || !collection || !canDelete) return;
		setDeleteLoading(true);
		try {
			await collectionsAPI.remove(token, collectionId);
			toast.success('Collection deleted');
			router.replace('/collections');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not delete collection');
			setDeleteLoading(false);
		}
	}

	return (
		<AppShell
			title={collection?.name ?? 'Workspace'}
			eyebrow="Workspace"
			description={collection?.isDemo ? 'Read-only sample workspace · Follow the walkthrough to see a real finding and its evidence.' : collection?.archived ? 'This workspace is archived and available for review.' : 'Review risks, verify the evidence, and keep your documents in one place.'}
			backHref="/collections"
			backLabel="Back to collections"
			maxWidth="max-w-7xl"
			actions={(
				<>
					<Link
						href={`/collections/${collectionId}/contradictions${tourActive ? '?tour=1' : ''}`}
						className="rounded-full bg-blue-500 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-blue-950/30 hover:bg-blue-400"
					>
						Review risks
					</Link>
				</>
			)}
		>

				{error && (
					<div className="mt-6 rounded-lg border border-red-400/40 bg-red-500/15 px-4 py-3 text-sm text-red-200">
						{error}
					</div>
				)}

				{tourActive && (
					<section className="mt-8 rounded-3xl border border-blue-400/30 bg-blue-500/10 p-6">
						<p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-200">Step 1 of 3 · Start with the outcome</p>
						<h2 className="mt-2 text-lg font-bold text-white">See the most important risk first.</h2>
						<p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">FinSightIQ compares your documents, identifies conflicts, and keeps the evidence beside every finding. Open Risk review to see what needs attention.</p>
					</section>
				)}

				{collection?.isDemo ? (
					<section className="mt-6 rounded-3xl border border-blue-400/30 bg-blue-500/10 p-6">
						<p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-200">Read-only sample</p>
						<h2 className="mt-2 text-lg font-bold text-white">A material regulatory change is ready to review.</h2>
						<p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">This sample contains a critical change in capital requirements. Open Risk review to see the two source statements, the explanation, and the potential compliance impact.</p>
						<Link href={`/collections/${collectionId}/contradictions?tour=1`} className="mt-5 inline-flex rounded-full bg-blue-500 px-4 py-2 text-sm font-bold text-white hover:bg-blue-400">Open the sample risk</Link>
					</section>
				) : (
				<div className="mt-6 grid gap-4 lg:grid-cols-2">
					<section className="rounded-3xl border border-slate-700 bg-slate-900/85 p-6 shadow-lg shadow-slate-950/20">
						<h2 className="text-base font-bold text-white">Ask about these documents</h2>
						<p className="mt-1 text-xs text-slate-400">Get a clear answer grounded in the documents in this workspace.</p>
						<div className="mt-4 flex gap-2">
							<input
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === 'Enter') void runSearch();
								}}
								placeholder="Example: What are the main reporting obligations?"
								className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
							/>
							<button
								type="button"
								onClick={runSearch}
								disabled={searching || !query.trim()}
								className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-bold text-white hover:bg-blue-400 disabled:opacity-50"
							>
								{searching ? 'Finding answer…' : 'Ask'}
							</button>
						</div>
						{searchAnswer && (
							<div className="mt-4 rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4">
								<p className="whitespace-pre-wrap text-sm leading-6 text-slate-100">{searchAnswer}</p>
								<p className="mt-3 text-xs text-blue-200">Based on {searchSources.length} source {searchSources.length === 1 ? 'passage' : 'passages'}</p>
							</div>
						)}
					</section>

					<section className="rounded-3xl border border-slate-700 bg-slate-900/85 p-6 shadow-lg shadow-slate-950/20">
						<div className="flex items-start justify-between gap-3">
							<div>
						<h2 className="text-base font-bold text-white">Workspace briefing</h2>
						<p className="mt-1 text-xs text-slate-400">Get a concise overview before you begin your review.</p>
							</div>
							<button
								type="button"
								onClick={summarizeCollection}
								disabled={summarizing || readyCount === 0}
								className="rounded-xl border border-slate-600 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-white/10 disabled:opacity-50"
							>
								{summarizing ? 'Preparing…' : 'Create briefing'}
							</button>
						</div>
						{collectionSummary ? (
							<p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-100">{collectionSummary}</p>
						) : (
							<p className="mt-4 rounded-2xl border border-dashed border-slate-600 p-4 text-sm text-slate-400">
								Create a briefing to see a concise overview of this workspace.
							</p>
						)}
					</section>
				</div>
				)}

				<details className="mt-6 overflow-hidden rounded-3xl border border-slate-700 bg-slate-900/85 shadow-lg shadow-slate-950/20">
					<summary className="flex cursor-pointer items-center justify-between gap-4 px-4 py-4 text-sm font-bold text-white">
						<span>{collection?.isDemo ? 'Sample documents' : 'Documents and workspace tools'}</span>
						<span className="text-xs font-normal text-slate-400">{documents.length} documents · {collection?.isDemo ? 'Read the source material' : 'Manage uploads and comparisons'}</span>
					</summary>
					<div className="border-t border-slate-700">
						<div className="flex flex-wrap items-center gap-2 px-4 py-3">
							{canUpload && <button type="button" onClick={() => setShowUpload(true)} className="rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/15">Add documents</button>}
							{canUpload && <button type="button" onClick={() => setShowEdgar(true)} className="rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/15">Import SEC filing</button>}
							{!collection?.isDemo && <Link href={`/collections/${collectionId}/compare`} className="rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/15">Compare documents</Link>}
							{user?.role === 'admin' && <button type="button" onClick={() => setShowMembers(true)} className="rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/15">Manage access</button>}
						</div>

					{documents.length === 0 ? (
						<div className="p-5">
							<EmptyState
								title="No documents yet"
								description="Add PDFs or text files when you are ready to bring more documents into this workspace."
							/>
						</div>
					) : (
						<ul className="divide-y divide-slate-800">
							{documents.map((doc) => (
								<li key={doc.id} className="flex items-center justify-between gap-4 px-4 py-3">
									<div className="min-w-0">
										<Link
											href={`/collections/${collectionId}/documents/${doc.id}`}
											className="truncate text-sm font-semibold text-slate-100 hover:text-blue-200 hover:underline"
										>
											{doc.filename}
										</Link>
										<p className="mt-1 text-xs text-slate-400">
											{doc.source || 'manual'} · {doc.sizeBytes ? `${Math.round(doc.sizeBytes / 1024)} KB` : 'queued'}
											{doc.failureReason ? ` · ${doc.failureReason}` : ''}
										</p>
									</div>
									<div className="flex shrink-0 items-center gap-2">
										{canRetry && doc.status === 'failed' && (
											<button
												type="button"
												onClick={() => retryDocument(doc)}
												disabled={retryingId === doc.id}
												className="rounded-lg border border-red-400/40 px-3 py-1 text-xs font-semibold text-red-200 hover:bg-red-500/15 disabled:opacity-50"
											>
												{retryingId === doc.id ? 'Retrying…' : 'Retry'}
											</button>
										)}
										<DocumentStatusBadge status={doc.status} />
										{isAdmin && !collection?.isDemo && (
											<button
												type="button"
												onClick={() => setDocumentPendingDeletion(doc)}
												className="rounded-lg border border-red-400/40 px-3 py-1 text-xs font-semibold text-red-200 hover:bg-red-500/15"
											>
												Delete
											</button>
										)}
									</div>
								</li>
							))}
						</ul>
					)}
					</div>
				</details>
				{isAdmin && collection && !collection.isDemo && (
					<details className="mt-6 rounded-3xl border border-red-500/30 bg-red-950/30 shadow-lg shadow-red-950/10">
						<summary className="cursor-pointer px-6 py-4 text-sm font-bold text-red-100">Workspace administration</summary>
						<section className="border-t border-red-500/20 p-6">
						<div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
							<div>
								<p className="text-xs font-bold uppercase tracking-[0.22em] text-red-300">Danger zone</p>
								<h2 className="mt-2 text-base font-bold text-white">Collection lifecycle</h2>
								<p className="mt-2 max-w-2xl text-sm leading-6 text-red-100/80">
									Archive blocks new document uploads while keeping the collection available for review.
									Delete permanently removes the collection and cascades its documents, chunks, contradictions,
									annotations, stale references, members, and stored files.
								</p>
							</div>
							<button
								type="button"
								onClick={toggleArchiveCollection}
								disabled={archiveLoading}
								className="rounded-xl border border-amber-300/40 bg-amber-400/10 px-4 py-2 text-sm font-bold text-amber-100 hover:bg-amber-400/20 disabled:opacity-50"
							>
								{archiveLoading
									? 'Updating…'
									: collection.archived ? 'Restore collection' : 'Archive collection'}
							</button>
						</div>

						<div className="mt-5 rounded-2xl border border-red-400/30 bg-slate-950/70 p-4">
							<label htmlFor="delete-confirmation" className="text-sm font-semibold text-red-100">
								Type <span className="font-mono text-red-200">{collection.name}</span> to confirm deletion
							</label>
							<div className="mt-3 flex flex-col gap-3 sm:flex-row">
								<input
									id="delete-confirmation"
									value={deleteConfirmation}
									onChange={(event) => setDeleteConfirmation(event.target.value)}
									placeholder={collection.name}
									className="min-w-0 flex-1 rounded-xl border border-red-400/30 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-red-300 focus:ring-2 focus:ring-red-500/20"
								/>
								<button
									type="button"
									onClick={deleteCollection}
									disabled={!canDelete || deleteLoading}
									className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
								>
									{deleteLoading ? 'Deleting…' : 'Delete permanently'}
								</button>
							</div>
							<p className="mt-2 text-xs text-red-200/70">
								This action cannot be undone. Use archive if you only want to hide or freeze the workspace.
							</p>
						</div>
						</section>
					</details>
				)}
			{showUpload && (
				<UploadModal
					token={token}
					collectionId={collectionId}
					onQueued={(payload) => {
						upsertDocument({
							id: payload.documentId,
							filename: payload.filename,
							status: payload.status,
							jobStatus: 'queued',
						});
						toast.success(`Upload queued: ${payload.filename}`);
					}}
					onClose={() => setShowUpload(false)}
				/>
			)}

			{showEdgar && (
				<EdgarFetchModal
					token={token}
					collectionId={collectionId}
					onQueued={(payload) => {
						toast.success(`${payload.ticker} ${payload.filingType} ${payload.year} queued. It will appear when ingestion completes.`);
					}}
					onClose={() => setShowEdgar(false)}
				/>
			)}
			{showMembers && token && (
				<ManageMembersModal
					token={token}
					collectionId={collectionId}
					onClose={() => setShowMembers(false)}
				/>
			)}
			{documentPendingDeletion && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm">
					<section role="dialog" aria-modal="true" aria-labelledby="delete-document-title" className="w-full max-w-md rounded-3xl border border-red-500/30 bg-slate-900 p-6 shadow-2xl">
						<p className="text-xs font-bold uppercase tracking-[0.2em] text-red-300">Delete document</p>
						<h2 id="delete-document-title" className="mt-2 text-lg font-bold text-white">Remove this document?</h2>
						<p className="mt-3 text-sm leading-6 text-slate-300">
							<strong className="text-slate-100">{documentPendingDeletion.filename}</strong> and its extracted text, findings, annotations, and stored file will be permanently removed.
						</p>
						<div className="mt-6 flex justify-end gap-3">
							<button type="button" onClick={() => setDocumentPendingDeletion(null)} disabled={documentDeleteLoading} className="rounded-full px-4 py-2 text-sm font-bold text-slate-300 hover:bg-white/10 disabled:opacity-50">Cancel</button>
							<button type="button" onClick={deleteDocument} disabled={documentDeleteLoading} className="rounded-full bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-50">{documentDeleteLoading ? 'Deleting…' : 'Delete permanently'}</button>
						</div>
					</section>
				</div>
			)}
		</AppShell>
	);
}
