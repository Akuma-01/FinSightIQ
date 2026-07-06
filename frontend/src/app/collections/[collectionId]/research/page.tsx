'use client';

import { AppShell } from '@/components/layout/AppShell';
import { MetricCard } from '@/components/ui/MetricCard';
import { F1Chart } from '@/components/research/F1Chart';
import { PromptVersionTimeline } from '@/components/research/PromptVersionTimeline';
import { Spinner } from '@/components/ui/Spinner';
import { useAuth } from '@/context/AuthContext';
import { research } from '@/lib/api';
import type { BenchmarkRun, ResearchMetrics } from '@/types/api';
import { useRouter } from 'next/navigation';
import { use, useEffect, useState } from 'react';
import toast from 'react-hot-toast';

export default function ResearchPage({
	params,
}: {
	params: Promise<{ collectionId: string }>;
}) {
	const { collectionId } = use(params);
	const { token, user, loading: authLoading } = useAuth();
	const router = useRouter();
	const [metrics, setMetrics] = useState<ResearchMetrics | null>(null);
	const [runs, setRuns] = useState<BenchmarkRun[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const isRestricted = !authLoading && Boolean(token) && Boolean(user) && !['admin', 'researcher'].includes(user?.role ?? '');

	useEffect(() => {
		if (authLoading) return;
		if (!token) {
			router.replace('/login');
			return;
		}
		if (user && !['admin', 'researcher'].includes(user.role)) {
			return;
		}

		let cancelled = false;
		Promise.all([
			research.metrics(token),
			research.history(token, { limit: 25 }),
		])
			.then(([metricsResult, historyResult]) => {
				if (cancelled) return;
				setMetrics(metricsResult);
				setRuns(historyResult.runs);
			})
			.catch((err) => {
				if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load research metrics');
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, [authLoading, router, token, user]);

	async function downloadCsv() {
		if (!token) return;
		try {
			const blob = await research.exportCsv(token);
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = `finsightiq-benchmarks-${Date.now()}.csv`;
			document.body.appendChild(link);
			link.click();
			link.remove();
			URL.revokeObjectURL(url);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not export CSV');
		}
	}

	if (isRestricted) {
		return (
			<main className="min-h-screen bg-slate-950 p-8">
				<p className="text-sm text-slate-300">Research dashboard is restricted to admin and researcher roles.</p>
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

	return (
		<AppShell
			title="Research dashboard"
			eyebrow="Evaluation"
			description="Benchmark quality, prompt versions, and exportable evaluation data."
			backHref={`/collections/${collectionId}`}
			backLabel="Back to collection"
			maxWidth="max-w-7xl"
			actions={(
					<button
						type="button"
						onClick={downloadCsv}
						className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-bold text-white hover:bg-white/15"
					>
						Export CSV
					</button>
			)}
		>

				{error && (
					<div className="mt-6 rounded-lg border border-red-400/40 bg-red-500/15 px-4 py-3 text-sm text-red-200">
						{error}
					</div>
				)}

				<div className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
					<section className="rounded-3xl border border-slate-700 bg-slate-900/85 p-6 shadow-lg shadow-slate-950/20">
						<h2 className="text-base font-bold text-white">Latest F1 by model</h2>
						<div className="mt-4">
							<F1Chart data={metrics?.latestF1ByModel ?? {}} />
						</div>
					</section>

					<aside className="space-y-4">
						<MetricCard label="Benchmark runs" value={metrics?.benchmarkRunCount ?? 0} tone="blue" helper="Total stored evaluations" />
						<div className="rounded-3xl border border-slate-700 bg-slate-900/85 p-5 shadow-lg shadow-slate-950/20">
							<p className="text-xs font-bold uppercase tracking-wide text-slate-400">Chunking results</p>
							<ul className="mt-3 space-y-2 text-sm">
								{(metrics?.chunkingResults ?? []).map((result) => (
									<li key={result.strategy} className="flex justify-between gap-3">
										<span className="text-slate-300">{result.strategy}</span>
										<span className="font-semibold text-white">{Number(result.f1).toFixed(4)}</span>
									</li>
								))}
							</ul>
						</div>
					</aside>
				</div>

				<section className="mt-6 rounded-3xl border border-slate-700 bg-slate-900/85 p-6 shadow-lg shadow-slate-950/20">
					<h2 className="text-base font-bold text-white">Benchmark timeline</h2>
					<div className="mt-4">
						<PromptVersionTimeline runs={runs} />
					</div>
				</section>

				<section className="mt-6 rounded-3xl border border-slate-700 bg-slate-900/85 p-6 shadow-lg shadow-slate-950/20">
					<h2 className="text-base font-bold text-white">Recent LLM audit stats</h2>
					<div className="mt-4 overflow-x-auto">
						<table className="w-full text-left text-sm">
							<thead className="border-b border-slate-700 text-xs text-slate-400">
								<tr>
									<th className="whitespace-nowrap py-2 pr-4">Task</th>
									<th className="whitespace-nowrap py-2 pr-4">Model</th>
									<th className="whitespace-nowrap py-2 pr-4">Calls</th>
									<th className="whitespace-nowrap py-2 pr-4">Errors</th>
									<th className="whitespace-nowrap py-2 pr-4">Avg latency</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-800">
								{(metrics?.recentLogStats ?? []).map((row) => {
									const callCount = Number(row.callCount ?? row.call_count ?? 0);
									const errorCount = Number(row.errorCount ?? row.error_count ?? 0);
									const latency = Number(row.avgLatencyMs ?? row.avg_latency_ms ?? 0);
									return (
										<tr key={`${row.task}-${row.model}`}>
											<td className="whitespace-nowrap py-2 pr-4 text-slate-100">{row.task}</td>
											<td className="whitespace-nowrap py-2 pr-4 text-slate-300">{row.model}</td>
											<td className="whitespace-nowrap py-2 pr-4 text-slate-300">{callCount}</td>
											<td className={errorCount > 0 ? 'whitespace-nowrap py-2 pr-4 font-semibold text-red-300' : 'whitespace-nowrap py-2 pr-4 text-slate-300'}>
												{errorCount}
											</td>
											<td className="whitespace-nowrap py-2 pr-4 text-slate-300">{latency ? `${latency} ms` : '—'}</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				</section>
		</AppShell>
	);
}
