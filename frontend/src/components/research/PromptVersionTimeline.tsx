import { benchmarkTypeLabel } from '@/lib/labels';
import type { BenchmarkRun } from '@/types/api';

function formatNumber(value: unknown) {
	return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(4) : '—';
}

function formatRecord(record: unknown, formatter = formatNumber) {
	if (!record || typeof record !== 'object' || Array.isArray(record)) return '—';
	const entries = Object.entries(record as Record<string, unknown>);
	if (entries.length === 0) return '—';
	return entries
		.map(([key, value]) => `${key}: ${formatter(value)}`)
		.join(', ');
}

function metricSummary(run: BenchmarkRun) {
	const metrics = run.metrics ?? {};

	if (run.benchmarkType === 'prompt_sensitivity') {
		const f1ByVersion = metrics.f1ByVersion as Record<string, unknown> | undefined;
		const values = f1ByVersion && typeof f1ByVersion === 'object'
			? Object.entries(f1ByVersion)
				.filter(([, value]) => typeof value === 'number')
				.map(([version, value]) => ({ version, value: value as number }))
			: [];
		const best = values.sort((a, b) => b.value - a.value)[0];
		return {
			primaryLabel: best ? `Best ${best.version}` : 'Best F1',
			primaryValue: best ? formatNumber(best.value) : '—',
			secondaryLabel: 'Delta',
			secondaryValue: formatNumber(metrics.delta),
			detail: formatRecord(metrics.f1ByVersion),
		};
	}

	if (run.benchmarkType === 'hallucination') {
		return {
			primaryLabel: 'F1/model',
			primaryValue: formatRecord(metrics.f1_per_model),
			secondaryLabel: 'Failed pairs',
			secondaryValue: formatRecord(metrics.failedPairsByModel, (value) => String(value ?? '—')),
			detail: formatRecord(metrics.abortedByModel, (value) => value ? 'aborted' : 'ok'),
		};
	}

	if (run.benchmarkType === 'chunking_strategy') {
		return {
			primaryLabel: 'F1',
			primaryValue: formatNumber(metrics.f1),
			secondaryLabel: 'Strategy',
			secondaryValue: typeof metrics.strategy === 'string' ? metrics.strategy : '—',
			detail: `P ${formatNumber(metrics.precision)} · R ${formatNumber(metrics.recall)} · failed ${metrics.failedPairCount ?? 0}`,
		};
	}

	return {
		primaryLabel: 'F1',
		primaryValue: formatNumber(metrics.f1),
		secondaryLabel: 'Model',
		secondaryValue: typeof metrics.model === 'string' ? metrics.model : '—',
		detail: `P ${formatNumber(metrics.precision)} · R ${formatNumber(metrics.recall)} · failed ${metrics.failedPairCount ?? 0}`,
	};
}

export function PromptVersionTimeline({ runs }: { runs: BenchmarkRun[] }) {
	if (runs.length === 0) {
		return <p className="py-6 text-center text-sm text-slate-400">No benchmark runs recorded yet.</p>;
	}

	return (
		<div className="overflow-x-auto">
			<table className="w-full text-left text-sm">
				<thead className="border-b border-slate-700 text-xs text-slate-400">
					<tr>
						<th className="whitespace-nowrap py-2 pr-4">Type</th>
						<th className="whitespace-nowrap py-2 pr-4">Prompt</th>
						<th className="whitespace-nowrap py-2 pr-4">Primary metric</th>
						<th className="whitespace-nowrap py-2 pr-4">Secondary</th>
						<th className="whitespace-nowrap py-2 pr-4">Details</th>
						<th className="whitespace-nowrap py-2 pr-4">Samples</th>
						<th className="whitespace-nowrap py-2 pr-4">Date</th>
					</tr>
				</thead>
				<tbody className="divide-y divide-slate-800">
					{runs.map((run) => {
						const summary = metricSummary(run);
						return (
							<tr key={run.id}>
								<td className="whitespace-nowrap py-2 pr-4 text-slate-100">{benchmarkTypeLabel(run.benchmarkType)}</td>
								<td className="whitespace-nowrap py-2 pr-4 text-slate-300">
									{run.promptVersion ? `v${run.promptVersion}` : '—'}
								</td>
								<td className="min-w-44 py-2 pr-4">
									<p className="text-xs text-slate-500">{summary.primaryLabel}</p>
									<p className="font-medium text-white">{summary.primaryValue}</p>
								</td>
								<td className="min-w-36 py-2 pr-4">
									<p className="text-xs text-slate-500">{summary.secondaryLabel}</p>
									<p className="text-slate-300">{summary.secondaryValue}</p>
								</td>
								<td className="min-w-72 py-2 pr-4 text-slate-300">{summary.detail}</td>
								<td className="whitespace-nowrap py-2 pr-4 text-slate-300">{run.totalSamples}</td>
								<td className="whitespace-nowrap py-2 pr-4 text-xs text-slate-400">
									{run.createdAt ? new Date(run.createdAt).toLocaleString() : '—'}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}
