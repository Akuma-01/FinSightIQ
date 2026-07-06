import { cn } from '@/lib/cn';

export function Spinner({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
	return (
		<span
			className={cn(
				'inline-block animate-spin rounded-full border-2 border-current border-r-transparent align-[-0.125em]',
				size === 'sm' && 'h-4 w-4',
				size === 'md' && 'h-6 w-6',
				size === 'lg' && 'h-8 w-8',
				className
			)}
			aria-label="Loading"
		/>
	);
}
