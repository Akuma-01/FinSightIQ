'use client';

import { ContradictionCard } from '@/components/contradictions/ContradictionCard';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { useAuth } from '@/context/AuthContext';
import { useCollectionRoom } from '@/hooks/useCollectionRoom';
import { ai, documents as documentsAPI } from '@/lib/api';
import type { Contradiction, Document } from '@/types/api';
import { useRouter } from 'next/navigation';
import { use, useCallback, useEffect, useMemo, useState } from 'react';

function samePair(contradiction: Contradiction, docAId: string, docBId: string) {
	return (
		(contradiction.docAId === docAId && contradiction.docBId === docBId) ||
		(contradiction.docAId === docBId && contradiction.docBId === docAId)
	);
}

export default function ComparePage({
	params,
}: {
	params: Promise<{ collectionId: string }>;
}) {
	const { collectionId } = use(params);
	const { token, loading: authLoading } = useAuth();
	const router = useRouter();
	const [documents, setDocuments] = useState<Document[]>([]);
	const [docA, setDocA] = useState('');
	const [docB, setDocB] = useState('');
	const [results, setResults] = useState<Contradiction[]>([]);
	const [loading, setLoading] = useState(true);
	const [scanning, setScanning] = useState(false);
	const [error, setError] = useState('');
	const [scanMessage, setScanMessage] = useState('');

	useEffect(() => {
		if (authLoading) return;
		if (!token) {
			router.replace('/login');
			return;
		}

		let cancelled = false;
		documentsAPI.list(token, collectionId)
			.then(({ documents }) => {
				if (!cancelled) setDocuments(documents.filter((doc) => doc.status === 'ready'));
			})
			.catch((err) => {
				if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load documents');
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, [authLoading, collectionId, router, token]);

	const onContradictionNew = useCallback((contradiction: Contradiction) => {
		setResults((current) => {
			if (current.some((item) => item.id === contradiction.id)) return current;
			if (!samePair(contradiction, docA, docB)) return current;
			return [contradiction, ...current];
		});
	}, [docA, docB]);

	const onScanStarted = useCallback(() => {
		setScanning(true);
		setScanMessage('Scanning selected pair…');
	}, []);

	const onScanComplete = useCallback(async () => {
		setScanning(false);
		setScanMessage('Scan complete.');
		if (!token || !docA || !docB) return;
		const { contradictions } = await ai.contradictions(token, collectionId);
		setResults(contradictions.filter((item) => samePair(item, docA, docB)));
	}, [collectionId, docA, docB, token]);

	const roomCallbacks = useMemo(() => ({
		onContradictionNew,
		onScanStarted,
		onScanComplete,
	}), [onContradictionNew, onScanComplete, onScanStarted]);

	const { wsStatus } = useCollectionRoom(token, collectionId, roomCallbacks);

	async function runCompare() {
		if (!token || !docA || !docB || docA === docB) return;
		setError('');
		setResults([]);
		setScanning(true);
		setScanMessage('Queueing targeted scan…');
		try {
			await ai.scanTargeted(token, { collectionId, docIdA: docA, docIdB: docB });
		} catch (err) {
			setScanning(false);
			setScanMessage('');
			setError(err instanceof Error ? err.message : 'Could not start targeted scan');
		}
	}

	if (authLoading || loading) {
		return (
			<main className="flex min-h-screen items-center justify-center bg-slate-950">
				<Spinner className="text-blue-300" />
			</main>
		);
	}

	if (!token) return null;

	const canRun = docA && docB && docA !== docB && wsStatus === 'connected' && !scanning;

	return (
		<AppShell
			title="Compare documents"
			eyebrow="Document review"
			description="Choose two available documents to check them for conflicting requirements."
			backHref={`/collections/${collectionId}`}
			backLabel="Back to collection"
		>
				<div className="mt-8 rounded-3xl border border-slate-700 bg-slate-900/85 p-6 shadow-lg shadow-slate-950/20">
					<div className="mb-5 flex items-center justify-between gap-3">
						<div>
							<h2 className="text-base font-bold text-white">Document pair</h2>
							<p className="mt-1 text-xs text-slate-400">Only documents that are ready to review are shown here.</p>
						</div>
						<span className={wsStatus === 'connected'
							? 'rounded-full border border-emerald-400/40 bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-200'
							: 'rounded-full border border-slate-600 bg-slate-800 px-3 py-1 text-xs font-bold text-slate-300'}
						>
							{wsStatus === 'connected' ? 'Ready to compare' : 'Connecting…'}
						</span>
					</div>
					<div className="grid gap-4 md:grid-cols-2">
						<label className="block text-sm font-bold text-slate-200">
							Document A
							<select
								value={docA}
								onChange={(event) => setDocA(event.target.value)}
								className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
							>
								<option value="">Select document…</option>
								{documents.map((doc) => (
									<option key={doc.id} value={doc.id}>{doc.filename}</option>
								))}
							</select>
						</label>

						<label className="block text-sm font-bold text-slate-200">
							Document B
							<select
								value={docB}
								onChange={(event) => setDocB(event.target.value)}
								className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
							>
								<option value="">Select document…</option>
								{documents.filter((doc) => doc.id !== docA).map((doc) => (
									<option key={doc.id} value={doc.id}>{doc.filename}</option>
								))}
							</select>
						</label>
					</div>

					<div className="mt-5 flex flex-wrap items-center gap-3">
						<button
							onClick={runCompare}
							disabled={!canRun}
							className="inline-flex items-center gap-2 rounded-full bg-blue-500 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-950/30 hover:bg-blue-400 disabled:opacity-50"
						>
							{scanning && <Spinner size="sm" />}
							{scanning ? 'Checking…' : 'Check for conflicts'}
						</button>
						{scanMessage && <span className="text-sm text-slate-300">{scanMessage}</span>}
						{wsStatus !== 'connected' && (
							<span className="text-sm text-amber-300">Connecting to live updates. Please try again in a moment.</span>
						)}
					</div>

					{documents.length < 2 && (
						<p className="mt-4 text-sm text-amber-300">
							This collection needs at least two ready documents before comparison is available.
						</p>
					)}

					{error && (
						<div className="mt-4 rounded-lg border border-red-400/40 bg-red-500/15 px-4 py-3 text-sm text-red-200">
							{error}
						</div>
					)}
				</div>

				<div className="mt-6 space-y-3">
					<div className="flex items-center justify-between">
						<h2 className="text-lg font-bold text-white">
							Results {results.length > 0 ? `(${results.length})` : ''}
						</h2>
					</div>

					{results.length > 0 ? (
						results.map((contradiction) => (
							<ContradictionCard key={contradiction.id} contradiction={contradiction} />
						))
					) : (
						<EmptyState
							title={scanning ? 'Checking the documents' : 'No findings yet'}
							description={scanning ? 'Findings will appear here as they are ready.' : 'Choose two documents and check them for conflicts.'}
						/>
					)}
				</div>
		</AppShell>
	);
}
