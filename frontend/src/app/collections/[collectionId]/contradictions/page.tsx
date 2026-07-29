'use client';

import { ContradictionCard } from '@/components/contradictions/ContradictionCard';
import { AppShell } from '@/components/layout/AppShell';
import { StaleReferenceList } from '@/components/stale/StaleReferenceList';
import { EmptyState } from '@/components/ui/EmptyState';
import { MetricCard } from '@/components/ui/MetricCard';
import { Spinner } from '@/components/ui/Spinner';
import { useAuth } from '@/context/AuthContext';
import { useCollectionRoom } from '@/hooks/useCollectionRoom';
import { ai, collections as collectionsAPI } from '@/lib/api';
import type { Collection, Contradiction, StaleReference } from '@/types/api';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { use, useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';

type SeverityFilter = 'all' | 'critical' | 'moderate' | 'minor';

export default function ContradictionsPage({
	params,
}: {
	params: Promise<{ collectionId: string }>;
}) {
	const { collectionId } = use(params);
	const { token, user, loading: authLoading } = useAuth();
	const router = useRouter();
	const searchParams = useSearchParams();
	const tourActive = searchParams.get('tour') === '1';
	const [contradictions, setContradictions] = useState<Contradiction[]>([]);
	const [collection, setCollection] = useState<Collection | null>(null);
	const [staleRefs, setStaleRefs] = useState<StaleReference[]>([]);
	const [severity, setSeverity] = useState<SeverityFilter>('all');
	const [loading, setLoading] = useState(true);
	const [scanning, setScanning] = useState(false);
	const [error, setError] = useState('');

	useEffect(() => {
		if (authLoading) return;
		if (!token) {
			router.replace('/login');
			return;
		}

		let cancelled = false;
		Promise.all([
			collectionsAPI.get(token, collectionId),
			ai.contradictions(token, collectionId),
			ai.stale(token, collectionId),
		])
			.then(([collectionResult, contradictionResult, staleResult]) => {
				if (cancelled) return;
				setCollection(collectionResult.collection);
				setContradictions(contradictionResult.contradictions);
				setStaleRefs(staleResult.staleReferences);
			})
			.catch((err) => {
				if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load contradictions');
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, [authLoading, collectionId, router, token]);

	const onContradictionNew = useCallback((contradiction: Contradiction) => {
		setContradictions((current) => current.some((item) => item.id === contradiction.id)
			? current
			: [contradiction, ...current]);
	}, []);

	const roomCallbacks = useMemo(() => ({
		onContradictionNew,
		onScanStarted: () => setScanning(true),
		onScanComplete: () => setScanning(false),
	}), [onContradictionNew]);

	const { wsStatus } = useCollectionRoom(token, collectionId, roomCallbacks);

	async function startScan() {
		if (!token) return;
		setScanning(true);
		try {
			await ai.scan(token, collectionId);
			toast.success('Collection scan queued');
		} catch (err) {
			setScanning(false);
			toast.error(err instanceof Error ? err.message : 'Could not start scan');
		}
	}

	async function resolveContradiction(id: string) {
		if (!token) return;
		await ai.resolve(token, id);
		setContradictions((current) => current.map((item) => item.id === id ? { ...item, isResolved: true } : item));
	}

	const canResolve = user?.role === 'admin' || user?.role === 'compliance_officer';
	const filtered = contradictions.filter((item) => severity === 'all' || item.severity === severity);
	const unresolved = contradictions.filter((item) => !item.isResolved).length;
	const critical = contradictions.filter((item) => item.severity === 'critical').length;
	const moderate = contradictions.filter((item) => item.severity === 'moderate').length;
	const minor = contradictions.filter((item) => item.severity === 'minor').length;
	const isDemo = Boolean(collection?.isDemo);

	if (authLoading || loading) {
		return (
			<main className="flex min-h-screen items-center justify-center bg-slate-950">
				<Spinner className="text-blue-300" />
			</main>
		);
	}

	if (!token) return null;

	return (
		<AppShell
			title="Risk review"
			eyebrow="Risk review"
			description={`${unresolved} open ${unresolved === 1 ? 'risk' : 'risks'} · Review each finding alongside its supporting evidence.`}
			backHref={`/collections/${collectionId}`}
			backLabel="Back to collection"
			maxWidth="max-w-7xl"
			actions={!collection?.isDemo && (
				<button
					type="button"
					onClick={startScan}
					disabled={scanning}
					className="rounded-full bg-blue-500 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-950/30 hover:bg-blue-400 disabled:opacity-50"
				>
					{scanning ? 'Checking…' : 'Check for conflicts'}
				</button>
			)}
		>

			{error && (
				<div className="mt-6 rounded-lg border border-red-400/40 bg-red-500/15 px-4 py-3 text-sm text-red-200">
					{error}
				</div>
			)}

			{tourActive && (
				<section className="mt-6 rounded-3xl border border-blue-400/30 bg-blue-500/10 p-6">
					<p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-200">Steps 2–3 of 3 · Verify, then decide</p>
					<h2 className="mt-2 text-lg font-bold text-white">Every risk is explained with its evidence.</h2>
					<p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">Read the two source statements side by side, then decide whether the finding needs review. Select either source name to read the original document.</p>
				</section>
			)}

			{!isDemo && (
				<>
					<div className="mt-8 grid gap-4 md:grid-cols-4">
						<MetricCard label="Critical" value={critical} tone="red" />
						<MetricCard label="Moderate" value={moderate} tone="amber" />
						<MetricCard label="Minor" value={minor} tone="blue" />
						<MetricCard label="Unresolved" value={unresolved} tone="slate" />
					</div>

					<div className="mt-6 flex flex-wrap gap-2">
						{(['all', 'critical', 'moderate', 'minor'] as const).map((option) => (
							<button
								key={option}
								type="button"
								onClick={() => setSeverity(option)}
								className={severity === option
									? 'rounded-full bg-gray-900 px-3 py-1 text-xs font-semibold text-white'
									: 'rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-200 ring-1 ring-slate-700 hover:bg-slate-700'}
							>
								{option}
							</button>
						))}
					</div>
				</>
			)}

			<div className={`mt-6 grid gap-6 ${isDemo ? 'max-w-4xl' : 'lg:grid-cols-[1fr_360px]'}`}>
				<section className="space-y-3">
					<div className="flex items-center justify-between">
						<h2 className="text-sm font-bold text-white">Findings</h2>
						{!isDemo && wsStatus === 'connected' && (
							<span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-300">
								<span className="relative flex h-2 w-2">
									<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
									<span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
								</span>
								Live updates enabled
							</span>
						)}
					</div>
					{filtered.length === 0 ? (
						<EmptyState title="No risks match this filter" description="Change the filter or check the workspace for conflicts to populate this view." />
					) : (
						filtered.map((contradiction) => (
							<ContradictionCard
								key={contradiction.id}
								contradiction={contradiction}
								canResolve={canResolve && !collection?.isDemo}
								onResolve={resolveContradiction}
								collectionId={collectionId}
							/>
						))
					)}
				</section>

				{!isDemo && <aside>
					<div className="rounded-3xl border border-slate-700 bg-slate-900/85 p-5 shadow-lg shadow-slate-950/20">
						<h2 className="mb-3 text-sm font-bold text-white">References that may need updating</h2>
						<StaleReferenceList
							refs={staleRefs}
							token={token}
							canResolve={canResolve}
							onResolved={(id) => setStaleRefs((current) => current.map((ref) => ref.id === id ? { ...ref, isResolved: true } : ref))}
						/>
					</div>
				</aside>}
			</div>

			{isDemo && (
				<section className="mt-6 max-w-4xl rounded-3xl border border-emerald-400/30 bg-emerald-500/10 p-6">
					<p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-200">Walkthrough complete</p>
					<h2 className="mt-2 text-lg font-bold text-white">You saw the complete decision path.</h2>
					<p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">FinSightIQ surfaced a material change, showed the two underlying statements, and made the compliance impact understandable without asking you to inspect the technical process.</p>
					<div className="mt-5 flex flex-wrap gap-3">
						<Link href="/collections" className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500">View your workspaces</Link>
						<Link href="/welcome" className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-bold text-white hover:bg-white/10">Restart overview</Link>
					</div>
				</section>
			)}
		</AppShell>
	);
}
