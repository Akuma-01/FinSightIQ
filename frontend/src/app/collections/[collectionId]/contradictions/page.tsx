'use client';

import { ContradictionCard } from '@/components/contradictions/ContradictionCard';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState } from '@/components/ui/EmptyState';
import { MetricCard } from '@/components/ui/MetricCard';
import { StaleReferenceList } from '@/components/stale/StaleReferenceList';
import { Spinner } from '@/components/ui/Spinner';
import { useAuth } from '@/context/AuthContext';
import { useCollectionRoom } from '@/hooks/useCollectionRoom';
import { ai } from '@/lib/api';
import type { Contradiction, StaleReference } from '@/types/api';
import { useRouter } from 'next/navigation';
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
	const [contradictions, setContradictions] = useState<Contradiction[]>([]);
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
			ai.contradictions(token, collectionId),
			ai.stale(token, collectionId),
		])
			.then(([contradictionResult, staleResult]) => {
				if (cancelled) return;
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
			title="Contradiction dashboard"
			eyebrow="Risk review"
			description={`${contradictions.length} total · ${unresolved} unresolved · WS ${wsStatus}`}
			backHref={`/collections/${collectionId}`}
			backLabel="Back to collection"
			maxWidth="max-w-7xl"
			actions={(
					<button
						type="button"
						onClick={startScan}
						disabled={scanning}
						className="rounded-full bg-blue-500 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-950/30 hover:bg-blue-400 disabled:opacity-50"
					>
						{scanning ? 'Scanning…' : 'Run full scan'}
					</button>
			)}
		>

				{error && (
					<div className="mt-6 rounded-lg border border-red-400/40 bg-red-500/15 px-4 py-3 text-sm text-red-200">
						{error}
					</div>
				)}

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

				<div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
					<section className="space-y-3">
						{filtered.length === 0 ? (
							<EmptyState title="No contradictions match this filter" description="Change the severity filter or run a scan to populate this dashboard." />
						) : (
							filtered.map((contradiction) => (
								<ContradictionCard
									key={contradiction.id}
									contradiction={contradiction}
									canResolve={canResolve}
									onResolve={resolveContradiction}
								/>
							))
						)}
					</section>

					<aside>
						<div className="rounded-3xl border border-slate-700 bg-slate-900/85 p-5 shadow-lg shadow-slate-950/20">
							<h2 className="mb-3 text-sm font-bold text-white">Stale references</h2>
							<StaleReferenceList
								refs={staleRefs}
								token={token}
								canResolve={canResolve}
								onResolved={(id) => setStaleRefs((current) => current.map((ref) => ref.id === id ? { ...ref, isResolved: true } : ref))}
							/>
						</div>
					</aside>
				</div>
		</AppShell>
	);
}
