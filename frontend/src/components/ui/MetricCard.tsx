import { cn } from '@/lib/cn';
import { theme } from '@/lib/theme';

export function MetricCard({
	label,
	value,
	tone = 'slate',
	helper,
}: {
	label: string;
	value: string | number;
	tone?: 'slate' | 'blue' | 'green' | 'red' | 'amber';
	helper?: string;
}) {
	return (
		<div className={cn('rounded-2xl border p-5 shadow-lg shadow-slate-950/20', theme.metric[tone])}>
			<p className="text-xs font-bold uppercase tracking-wide opacity-70">{label}</p>
			<p className="mt-2 text-3xl font-bold tracking-tight">{value}</p>
			{helper && <p className="mt-2 text-xs opacity-70">{helper}</p>}
		</div>
	);
}
