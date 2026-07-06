import { cn } from '@/lib/cn';
import { theme } from '@/lib/theme';

export function EmptyState({
	title,
	description,
	action,
}: {
	title: string;
	description: string;
	action?: React.ReactNode;
}) {
	return (
		<div className={cn('rounded-3xl border p-10 text-center', theme.surface.empty)}>
			<div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/15 text-xl text-blue-200">◇</div>
			<h3 className={cn('mt-4 text-base font-semibold', theme.text.primary)}>{title}</h3>
			<p className={cn('mx-auto mt-2 max-w-md text-sm leading-6', theme.text.secondary)}>{description}</p>
			{action && <div className="mt-5">{action}</div>}
		</div>
	);
}
