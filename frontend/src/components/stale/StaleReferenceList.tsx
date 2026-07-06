'use client';

import { ai } from '@/lib/api';
import type { StaleReference } from '@/types/api';
import { useState } from 'react';
import toast from 'react-hot-toast';

type Props = {
	refs: StaleReference[];
	token: string;
	canResolve: boolean;
	onResolved?: (id: string) => void;
};

export function StaleReferenceList({ refs, token, canResolve, onResolved }: Props) {
	const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());

	async function resolveRef(id: string) {
		try {
			await ai.resolveStale(token, id);
			setResolvedIds((current) => new Set([...current, id]));
			onResolved?.(id);
			toast.success('Stale reference marked as resolved');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not resolve stale reference');
		}
	}

	if (refs.length === 0) {
		return (
			<div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/50 p-6 text-center text-sm text-slate-400">
				No stale references detected.
			</div>
		);
	}

	return (
		<div className="space-y-3">
			{refs.map((ref) => {
				const resolved = ref.isResolved || resolvedIds.has(ref.id);
				return (
					<article
						key={ref.id}
						className={`rounded-2xl border border-amber-700/70 bg-amber-950/55 p-4 shadow-sm shadow-amber-950/20 ${resolved ? 'opacity-60' : ''}`}
					>
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div>
								<p className="text-sm font-semibold text-amber-100">{ref.referencedIdentifier || 'Referenced rule'}</p>
								<p className="mt-1 text-xs text-slate-400">{ref.documentName}</p>
							</div>
							{resolved && (
								<span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-200 ring-1 ring-emerald-400/30">
									Resolved
								</span>
							)}
						</div>

						<p className="mt-3 text-sm leading-6 text-slate-200">{ref.referencedBody}</p>
						{ref.currentIdentifier && (
							<p className="mt-3 text-xs font-medium text-amber-200">
								Current version: {ref.currentIdentifier}
							</p>
						)}

						{canResolve && !resolved && (
							<button
								type="button"
								onClick={() => resolveRef(ref.id)}
								className="mt-3 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
							>
								Mark as resolved
							</button>
						)}
					</article>
				);
			})}
		</div>
	);
}
