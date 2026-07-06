'use client';

import { AppShell } from '@/components/layout/AppShell';
import { Spinner } from '@/components/ui/Spinner';
import { useAuth } from '@/context/AuthContext';
import { health } from '@/lib/api';
import type { HealthStatus } from '@/types/api';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

function statusClass(value: unknown) {
	if (value === 'ok' || value === 'idle') return 'text-emerald-100 bg-emerald-950/70 border-emerald-700/70';
	if (value === 'active') return 'text-blue-100 bg-blue-950/70 border-blue-700/70';
	if (typeof value === 'number') return 'text-slate-100 bg-slate-900/90 border-slate-700';
	return 'text-red-100 bg-red-950/70 border-red-700/70';
}

export default function AdminPage() {
	const { token, user, loading: authLoading } = useAuth();
	const router = useRouter();
	const [data, setData] = useState<HealthStatus | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [pollError, setPollError] = useState(false);
	const [lastChecked, setLastChecked] = useState<string>('');
	const isRestricted = !authLoading && Boolean(token) && user?.role !== 'admin';

	async function refreshHealth() {
		setError('');
		try {
			const result = await health.check();
			setData(result);
			setPollError(false);
			setLastChecked(new Date().toLocaleTimeString());
		} catch (err) {
			setPollError(true);
			setError(err instanceof Error ? err.message : 'Could not load health status');
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		if (authLoading) return;
		if (!token) {
			router.replace('/login');
			return;
		}
		if (user?.role !== 'admin') {
			return;
		}

		let cancelled = false;
		async function poll() {
			if (cancelled) return;
			await refreshHealth();
		}

		void poll();
		const interval = setInterval(poll, 10_000);
		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, [authLoading, router, token, user?.role]);

	if (isRestricted) {
		return (
			<main className="min-h-screen bg-slate-950 p-8">
				<p className="text-sm text-slate-300">Admin panel is restricted to admin users.</p>
			</main>
		);
	}

	if (authLoading || loading) {
		return (
			<main className="flex min-h-screen items-center justify-center bg-slate-950">
				<Spinner className="text-blue-300" />
			</main>
		);
	}

	if (!token) return null;

	const cards = [
		['API status', data?.status],
		['Database', data?.db],
		['Redis', data?.redis],
		['Cleanup worker', data?.cleanup_worker],
		['Ingest worker', data?.ingest_worker],
		['EDGAR worker', data?.edgar_worker],
		['Scan worker', data?.scan_worker],
		['Benchmark worker', data?.benchmark_worker],
		['WebSocket clients', data?.ws_connections ?? 0],
	] as const;

	return (
		<AppShell
			title="Admin panel"
			eyebrow="Operations"
			description={`Live backend health, worker status, and WebSocket count.${lastChecked ? ` Last checked ${lastChecked}.` : ''}`}
			backHref="/collections"
			backLabel="Back to collections"
			actions={(
				<>
					{pollError && data && (
						<span className="rounded-full border border-red-400/40 bg-red-500/15 px-3 py-1 text-xs font-bold text-red-200">
							Health data may be stale
						</span>
					)}
					<button
						type="button"
						onClick={refreshHealth}
						className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-white/15"
					>
						Refresh
					</button>
				</>
			)}
		>

				{error && (
					<div className="mt-6 rounded-lg border border-red-400/40 bg-red-500/15 px-4 py-3 text-sm text-red-200">
						{error}
					</div>
				)}

				<div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{cards.map(([label, value]) => (
						<div key={label} className={`rounded-3xl border p-5 shadow-sm ${statusClass(value)}`}>
							<p className="text-xs font-medium uppercase tracking-wide opacity-70">{label}</p>
							<p className="mt-2 text-xl font-semibold">{String(value ?? 'unknown')}</p>
						</div>
					))}
				</div>
		</AppShell>
	);
}
