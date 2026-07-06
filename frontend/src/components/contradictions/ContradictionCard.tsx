import { cn } from '@/lib/cn';
import { theme } from '@/lib/theme';
import type { Contradiction } from '@/types/api';
import { useState } from 'react';
import toast from 'react-hot-toast';

const SEVERITY_STYLE = {
	critical: theme.severity.card.critical,
	moderate: theme.severity.card.moderate,
	minor: theme.severity.card.minor,
} as const;

const SEVERITY_BADGE = {
	critical: theme.severity.badge.critical,
	moderate: theme.severity.badge.moderate,
	minor: theme.severity.badge.minor,
} as const;

type Props = {
	contradiction: Contradiction;
	canResolve?: boolean;
	onResolve?: (id: string) => Promise<void> | void;
};

export function ContradictionCard({ contradiction, canResolve = false, onResolve }: Props) {
	const [resolving, setResolving] = useState(false);
	const [resolved, setResolved] = useState(contradiction.isResolved);

	async function handleResolve() {
		if (!onResolve) return;
		setResolving(true);
		try {
			await onResolve(contradiction.id);
			setResolved(true);
			toast.success('Contradiction marked as resolved');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not resolve contradiction');
		} finally {
			setResolving(false);
		}
	}

	return (
		<article className={cn('rounded-3xl border p-5 shadow-sm backdrop-blur-sm', SEVERITY_STYLE[contradiction.severity], resolved && 'opacity-60')}>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex flex-wrap items-center gap-2">
					<span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', SEVERITY_BADGE[contradiction.severity])}>
						{contradiction.severity}
					</span>
					<span className="text-xs font-medium text-slate-300">
						{contradiction.contradictionType.replace(/_/g, ' ')}
					</span>
				</div>
				{resolved && (
					<span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-200 ring-1 ring-emerald-400/30">
						Resolved
					</span>
				)}
			</div>

			<div className="mt-4 grid gap-3 md:grid-cols-2">
				<div className="rounded-2xl border border-white/10 bg-slate-950/55 p-4 shadow-sm shadow-slate-950/30">
					<p className="truncate text-xs font-semibold text-slate-300">{contradiction.docAName}</p>
					{contradiction.sectionA && <p className="mt-1 text-xs text-slate-500">§ {contradiction.sectionA}</p>}
					<p className="mt-2 text-sm leading-6 text-slate-100">{contradiction.claimA}</p>
				</div>
				<div className="rounded-2xl border border-white/10 bg-slate-950/55 p-4 shadow-sm shadow-slate-950/30">
					<p className="truncate text-xs font-semibold text-slate-300">{contradiction.docBName}</p>
					{contradiction.sectionB && <p className="mt-1 text-xs text-slate-500">§ {contradiction.sectionB}</p>}
					<p className="mt-2 text-sm leading-6 text-slate-100">{contradiction.claimB}</p>
				</div>
			</div>

			<p className="mt-3 text-sm leading-6 text-slate-200">{contradiction.explanation}</p>

			{canResolve && !resolved && (
				<button
					type="button"
					onClick={handleResolve}
					disabled={resolving}
					className="mt-4 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
				>
					{resolving ? 'Resolving…' : 'Mark as resolved'}
				</button>
			)}
		</article>
	);
}
