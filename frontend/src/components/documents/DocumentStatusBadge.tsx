import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { theme } from '@/lib/theme';
import type { Document } from '@/types/api';

const STATUS_STYLES = {
	processing: theme.badge.blue,
	ready: theme.badge.emerald,
	failed: theme.badge.red,
} as const;

export function DocumentStatusBadge({ status }: { status: Document['status'] }) {
	return (
		<span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium', STATUS_STYLES[status])}>
			{status === 'processing' && <Spinner size="sm" />}
			{status}
		</span>
	);
}
