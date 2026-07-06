'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export function F1Chart({ data }: { data: Record<string, number> }) {
	const rows = Object.entries(data).map(([model, f1]) => ({
		model: model.length > 22 ? `${model.slice(0, 19)}…` : model,
		f1: Number(f1 ?? 0),
	}));

	if (rows.length === 0) {
		return <p className="py-8 text-center text-sm text-slate-400">No model comparison data yet.</p>;
	}

	return (
		<ResponsiveContainer width="100%" height={240}>
			<BarChart data={rows} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
				<CartesianGrid strokeDasharray="3 3" stroke="#334155" />
				<XAxis dataKey="model" tick={{ fontSize: 11, fill: '#cbd5e1' }} axisLine={{ stroke: '#475569' }} tickLine={{ stroke: '#475569' }} />
				<YAxis domain={[0, 1]} tick={{ fontSize: 11, fill: '#cbd5e1' }} axisLine={{ stroke: '#475569' }} tickLine={{ stroke: '#475569' }} />
				<Tooltip formatter={(value) => typeof value === 'number' ? value.toFixed(4) : String(value ?? '—')} />
				<Bar dataKey="f1" fill="#2563eb" radius={[4, 4, 0, 0]} />
			</BarChart>
		</ResponsiveContainer>
	);
}
