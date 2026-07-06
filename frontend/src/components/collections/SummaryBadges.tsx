import { cn } from '@/lib/cn';
import { theme } from '@/lib/theme';
import type { CollectionSummary } from '@/types/api';

export function SummaryBadges({ summary }: { summary: CollectionSummary }) {
	const badge = 'rounded-full border px-2 py-0.5 text-xs font-medium';

	if (summary.unresolved === 0 && summary.stale === 0) {
		return (
			<span className={cn(badge, theme.badge.emerald)}>
				✓ All clear
			</span>
		);
	}

	return (
		<div className="flex flex-wrap gap-2">
			{summary.critical > 0 && (
				<span className={cn(badge, theme.badge.red)}>
					{summary.critical} critical
				</span>
			)}
			{summary.moderate > 0 && (
				<span className={cn(badge, theme.badge.amber)}>
					{summary.moderate} moderate
				</span>
			)}
			{summary.minor > 0 && (
				<span className={cn(badge, theme.badge.blue)}>
					{summary.minor} minor
				</span>
			)}
			{summary.stale > 0 && (
				<span className={cn(badge, theme.badge.yellow)}>
					{summary.stale} stale refs
				</span>
			)}
		</div>
	);
}
