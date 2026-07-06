import type { BenchmarkRun } from '@/types/api';

function metric(run: BenchmarkRun, key: string) {
	const value = run.metrics[key];
	return typeof value === 'number' ? value.toFixed(4) : '—';
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
						<th className="whitespace-nowrap py-2 pr-4">F1</th>
						<th className="whitespace-nowrap py-2 pr-4">Precision</th>
						<th className="whitespace-nowrap py-2 pr-4">Recall</th>
						<th className="whitespace-nowrap py-2 pr-4">Samples</th>
						<th className="whitespace-nowrap py-2 pr-4">Date</th>
					</tr>
				</thead>
				<tbody className="divide-y divide-slate-800">
					{runs.map((run) => (
						<tr key={run.id}>
							<td className="whitespace-nowrap py-2 pr-4 text-slate-100">{run.benchmarkType.replace(/_/g, ' ')}</td>
							<td className="whitespace-nowrap py-2 pr-4 text-slate-300">
								{run.promptVersion ? `v${run.promptVersion}` : '—'}
							</td>
							<td className="whitespace-nowrap py-2 pr-4 font-medium text-white">{metric(run, 'f1')}</td>
							<td className="whitespace-nowrap py-2 pr-4 text-slate-300">{metric(run, 'precision')}</td>
							<td className="whitespace-nowrap py-2 pr-4 text-slate-300">{metric(run, 'recall')}</td>
							<td className="whitespace-nowrap py-2 pr-4 text-slate-300">{run.totalSamples}</td>
							<td className="whitespace-nowrap py-2 pr-4 text-xs text-slate-400">
								{run.createdAt ? new Date(run.createdAt).toLocaleString() : '—'}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
