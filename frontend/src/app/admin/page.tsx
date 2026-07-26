'use client';

import { AppShell } from '@/components/layout/AppShell';
import { Spinner } from '@/components/ui/Spinner';
import { useAuth } from '@/context/AuthContext';
import { health, users as usersAPI, type AdminUser } from '@/lib/api';
import { roleLabel } from '@/lib/labels';
import type { HealthStatus, Role } from '@/types/api';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

const ASSIGNABLE_ROLES: Role[] = ['analyst', 'compliance_officer', 'researcher', 'admin'];

function statusClass(value: unknown) {
	if (value === 'ok' || value === 'idle') return 'text-emerald-100 bg-emerald-950/70 border-emerald-700/70';
	if (value === 'active') return 'text-blue-100 bg-blue-950/70 border-blue-700/70';
	if (typeof value === 'number') return 'text-slate-100 bg-slate-900/90 border-slate-700';
	return 'text-red-100 bg-red-950/70 border-red-700/70';
}

export default function AdminPage() {
	const { token, user, loading: authLoading } = useAuth();
	const router = useRouter();
	const [data, setData] = useState<HealthStatus | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [pollError, setPollError] = useState(false);
	const [lastChecked, setLastChecked] = useState<string>('');
	const [teamUsers, setTeamUsers] = useState<AdminUser[]>([]);
	const [teamLoading, setTeamLoading] = useState(true);
	const [teamError, setTeamError] = useState('');
	const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
	const isRestricted = !authLoading && Boolean(token) && user?.role !== 'admin';

	async function refreshHealth() {
		setError('');
		try {
			const result = await health.check();
			setData(result);
			setPollError(false);
			setLastChecked(new Date().toLocaleTimeString());
		} catch (err) {
			setPollError(true);
			setError(err instanceof Error ? err.message : 'Could not load health status');
		} finally {
			setLoading(false);
		}
	}

	async function loadTeam() {
		if (!token) return;
		setTeamError('');
		try {
			const { users: list } = await usersAPI.list(token);
			setTeamUsers(list);
		} catch (err) {
			setTeamError(err instanceof Error ? err.message : 'Could not load team');
		} finally {
			setTeamLoading(false);
		}
	}

	async function changeRole(targetUserId: string, role: Role) {
		if (!token) return;
		setUpdatingUserId(targetUserId);
		try {
			const { user: updated } = await usersAPI.updateRole(token, targetUserId, role);
			setTeamUsers((current) => current.map((item) => item.id === updated.id ? updated : item));
			toast.success(`${updated.displayName} is now ${roleLabel(updated.role)}`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not update role');
		} finally {
			setUpdatingUserId(null);
		}
	}

	useEffect(() => {
		if (authLoading) return;
		if (!token) {
			router.replace('/login');
			return;
		}
		if (user?.role !== 'admin') {
			return;
		}

		let cancelled = false;
		async function poll() {
			if (cancelled) return;
			await refreshHealth();
		}
		async function loadTeamOnce() {
			if (cancelled) return;
			await loadTeam();
		}

		void poll();
		void loadTeamOnce();
		const interval = setInterval(poll, 10_000);
		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, [authLoading, router, token, user?.role]);

	if (isRestricted) {
		return (
			<main className="min-h-screen bg-slate-950 p-8">
				<p className="text-sm text-slate-300">Admin panel is restricted to admin users.</p>
			</main>
		);
	}

	if (authLoading || loading) {
		return (
			<main className="flex min-h-screen items-center justify-center bg-slate-950">
				<Spinner className="text-blue-300" />
			</main>
		);
	}

	if (!token) return null;

	const cards = [
		['API status', data?.status],
		['Database', data?.db],
		['Redis', data?.redis],
		['Cleanup worker', data?.cleanup_worker],
		['Ingest worker', data?.ingest_worker],
		['EDGAR worker', data?.edgar_worker],
		['Scan worker', data?.scan_worker],
		['Benchmark worker', data?.benchmark_worker],
		['WebSocket clients', data?.ws_connections ?? 0],
	] as const;

	return (
		<AppShell
			title="Admin panel"
			eyebrow="Operations"
			description={`Live backend health, worker status, and WebSocket count.${lastChecked ? ` Last checked ${lastChecked}.` : ''}`}
			backHref="/collections"
			backLabel="Back to collections"
			actions={(
				<>
					{pollError && data && (
						<span className="rounded-full border border-red-400/40 bg-red-500/15 px-3 py-1 text-xs font-bold text-red-200">
							Health data may be stale
						</span>
					)}
					<button
						type="button"
						onClick={refreshHealth}
						className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-white/15"
					>
						Refresh
					</button>
				</>
			)}
		>

			{error && (
				<div className="mt-6 rounded-lg border border-red-400/40 bg-red-500/15 px-4 py-3 text-sm text-red-200">
					{error}
				</div>
			)}

			<div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{cards.map(([label, value]) => (
					<div key={label} className={`rounded-3xl border p-5 shadow-sm ${statusClass(value)}`}>
						<p className="text-xs font-medium uppercase tracking-wide opacity-70">{label}</p>
						<p className="mt-2 text-xl font-semibold">{String(value ?? 'unknown')}</p>
					</div>
				))}
			</div>

			<div className="mt-10">
				<h2 className="text-sm font-bold text-white">Team</h2>
				<p className="mt-1 text-sm text-slate-400">
					Everyone signs up as an analyst. Change someone&apos;s role here to grant compliance,
					research, or admin access.
				</p>

				{teamError && (
					<div className="mt-4 rounded-lg border border-red-400/40 bg-red-500/15 px-4 py-3 text-sm text-red-200">
						{teamError}
					</div>
				)}

				<div className="mt-4 overflow-hidden rounded-2xl border border-slate-700">
					<div className="grid grid-cols-[1fr_180px] gap-3 border-b border-slate-700 bg-slate-950/70 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-400 sm:grid-cols-[1fr_220px_180px]">
						<span>User</span>
						<span className="hidden sm:block">Joined</span>
						<span>Role</span>
					</div>

					{teamLoading ? (
						<p className="px-4 py-5 text-sm text-slate-400">Loading team…</p>
					) : teamUsers.length === 0 ? (
						<p className="px-4 py-5 text-sm text-slate-400">No users yet.</p>
					) : (
						<ul className="divide-y divide-slate-800">
							{teamUsers.map((teamUser) => (
								<li
									key={teamUser.id}
									className="grid grid-cols-[1fr_180px] items-center gap-3 px-4 py-3 text-sm sm:grid-cols-[1fr_220px_180px]"
								>
									<div className="min-w-0">
										<p className="truncate font-semibold text-slate-100">{teamUser.displayName}</p>
										<p className="truncate text-xs text-slate-500">{teamUser.email}</p>
									</div>
									<span className="hidden text-slate-400 sm:block">
										{teamUser.createdAt ? new Date(teamUser.createdAt).toLocaleDateString() : '—'}
									</span>
									<select
										value={teamUser.role}
										onChange={(event) => changeRole(teamUser.id, event.target.value as Role)}
										disabled={updatingUserId === teamUser.id || teamUser.id === user?.id}
										title={teamUser.id === user?.id ? "You can't change your own role here" : undefined}
										className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50"
									>
										{ASSIGNABLE_ROLES.map((role) => (
											<option key={role} value={role}>{roleLabel(role)}</option>
										))}
									</select>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</AppShell>
	);
}
