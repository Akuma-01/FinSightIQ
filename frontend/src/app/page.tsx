'use client';

import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function Home() {
	const { token, loading } = useAuth();
	const router = useRouter();

	// Signed-in visitors begin with a clear next step rather than landing in a
	// technical workspace with no context.
	useEffect(() => {
		if (loading || !token) return;
		router.replace('/welcome');
	}, [loading, router, token]);

	if (loading || token) {
		return (
			<main className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-slate-300">
				Loading FinSightIQ…
			</main>
		);
	}

	return (
		<main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#1d4ed8,transparent_32rem),radial-gradient(circle_at_bottom_right,#312e81,transparent_30rem),linear-gradient(135deg,#0f172a,#111827)]">
			<header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
				<div className="flex items-center gap-3">
					<div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-500 text-sm font-black text-white shadow-sm shadow-blue-950/40">FI</div>
					<span className="text-sm font-bold tracking-tight text-white">FinSightIQ</span>
				</div>
				<Link
					href="/login"
					className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15"
				>
					Sign in
				</Link>
			</header>

			<section className="mx-auto grid max-w-6xl gap-12 px-6 pb-20 pt-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
				<div>
					{/* What it does */}
					<h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">
						Regulatory documents contradict each other. Nobody notices until it&apos;s a compliance problem.
					</h1>
					{/* Who it's for */}
					<p className="mt-5 max-w-xl text-base leading-7 text-slate-300">
						FinSightIQ ingests RBI, SEBI, and SEC filings, then automatically finds where one document
						conflicts with another — so compliance and risk teams catch it before an auditor does.
					</p>

					<div className="mt-8 flex flex-wrap gap-3">
						<Link
							href="/register"
							className="rounded-full bg-blue-500 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-blue-950/30 hover:bg-blue-400"
						>
							Create free account
						</Link>
						<Link
							href="/login"
							className="rounded-full border border-white/10 bg-white/5 px-6 py-3 text-sm font-bold text-white hover:bg-white/10"
						>
							Sign in
						</Link>
					</div>

					<dl className="mt-10 grid gap-4 sm:grid-cols-3">
						<div className="rounded-2xl border border-white/10 bg-white/5 p-4">
							<dt className="text-xs font-bold uppercase tracking-wide text-blue-300">Ingest</dt>
							<dd className="mt-1 text-sm text-slate-300">Upload PDFs or pull straight from RBI, SEBI, and EDGAR</dd>
						</div>
						<div className="rounded-2xl border border-white/10 bg-white/5 p-4">
							<dt className="text-xs font-bold uppercase tracking-wide text-blue-300">Detect</dt>
							<dd className="mt-1 text-sm text-slate-300">AI compares documents and flags conflicts by severity</dd>
						</div>
						<div className="rounded-2xl border border-white/10 bg-white/5 p-4">
							<dt className="text-xs font-bold uppercase tracking-wide text-blue-300">Resolve</dt>
							<dd className="mt-1 text-sm text-slate-300">Review, resolve, and keep an audit trail as new updates land live</dd>
						</div>
					</dl>
				</div>

				{/* One real example — a preview of the actual contradiction card, so a
				    first-time visitor sees the real payoff screen before signing in. */}
				<div className="rounded-3xl border border-red-700/70 bg-red-950/70 p-5 shadow-2xl shadow-red-950/20">
					<p className="text-xs font-bold uppercase tracking-wide text-red-200/80">Example — what FinSightIQ catches</p>
					<div className="mt-3 flex flex-wrap items-center gap-2">
						<span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-200 ring-1 ring-red-400/30">
							critical
						</span>
						<span className="text-xs font-medium text-slate-300">Conflicting numbers</span>
					</div>
					<div className="mt-4 grid gap-3 sm:grid-cols-2">
						<div className="rounded-2xl border border-white/10 bg-slate-950/55 p-4">
							<p className="truncate text-xs font-semibold text-slate-300">Circular A · issued Mar 2024</p>
							<p className="mt-2 text-sm leading-6 text-slate-100">Minimum capital adequacy ratio: 9%.</p>
						</div>
						<div className="rounded-2xl border border-white/10 bg-slate-950/55 p-4">
							<p className="truncate text-xs font-semibold text-slate-300">Circular B · issued Nov 2024</p>
							<p className="mt-2 text-sm leading-6 text-slate-100">Minimum capital adequacy ratio: 11%.</p>
						</div>
					</div>
					<p className="mt-3 text-sm leading-6 text-slate-200">
						Circular B raises the requirement but never references Circular A — teams following the older
						document would be out of compliance without knowing it.
					</p>
					<p className="mt-4 text-xs text-slate-400">
						This is a real card from the contradiction dashboard, updating live as scans run.
					</p>
				</div>
			</section>
		</main>
	);
}
