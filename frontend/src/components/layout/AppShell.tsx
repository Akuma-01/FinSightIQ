'use client';

import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/cn';
import { roleLabel } from '@/lib/labels';
import { theme } from '@/lib/theme';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export function AppShell({
	children,
	title,
	description,
	eyebrow,
	backHref,
	backLabel = 'Back',
	actions,
	maxWidth = 'max-w-6xl',
}: {
	children: React.ReactNode;
	title: string;
	description?: string;
	eyebrow?: string;
	backHref?: string;
	backLabel?: string;
	actions?: React.ReactNode;
	maxWidth?: string;
}) {
	const { user, logout } = useAuth();
	const router = useRouter();

	return (
		<main className={cn('min-h-screen', theme.appBg)}>
			<header className={cn('sticky top-0 z-30 border-b', theme.surface.header)}>
				<div className={`mx-auto flex ${maxWidth} items-center justify-between gap-4 px-4 py-3`}>
					<Link href="/collections" className="flex items-center gap-3">
						<div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-500 text-sm font-black text-white shadow-sm shadow-blue-950/40">FI</div>
						<div>
							<p className="text-sm font-bold tracking-tight text-white">FinSightIQ</p>
							<p className="text-xs text-slate-300">Regulatory intelligence workspace</p>
						</div>
					</Link>

					<nav className="hidden items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1 md:flex">
						<Link href="/collections" className="rounded-full px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10">
							Collections
						</Link>
						{user?.role === 'admin' && (
							<Link href="/admin" className="rounded-full px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10">
								Admin
							</Link>
						)}
					</nav>

					<div className="flex items-center gap-2">
						<div className="hidden text-right sm:block">
							<p className="max-w-40 truncate text-xs font-semibold text-slate-100">{user?.displayName ?? user?.email}</p>
							<p className="text-[11px] text-slate-400">{roleLabel(user?.role)}</p>
						</div>
						<button
							type="button"
							onClick={async () => {
								await logout();
								router.replace('/login');
							}}
							className={cn('rounded-full px-3 py-1.5 text-xs font-semibold', theme.button.secondary)}
						>
							Logout
						</button>
					</div>
				</div>
			</header>

			<section className={`mx-auto ${maxWidth} px-4 py-8`}>
				{backHref && (
					<Link href={backHref} className={cn('text-sm font-semibold', theme.text.link)}>
						← {backLabel}
					</Link>
				)}

				<div className="mt-5 flex flex-wrap items-end justify-between gap-4">
					<div>
						{eyebrow && (
							<p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-blue-300">{eyebrow}</p>
						)}
						<h1 className={cn('text-3xl font-bold tracking-tight', theme.text.primary)}>{title}</h1>
						{description && <p className={cn('mt-2 max-w-2xl text-sm leading-6', theme.text.secondary)}>{description}</p>}
					</div>
					{actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
				</div>

				{children}
			</section>
		</main>
	);
}
