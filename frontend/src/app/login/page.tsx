'use client';

import { useAuth } from '@/context/AuthContext';
import { APIError } from '@/lib/api';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function LoginPage() {
	const { login } = useAuth();
	const router = useRouter();
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [error, setError] = useState('');
	const [loading, setLoading] = useState(false);

	async function submit(event: React.FormEvent) {
		event.preventDefault();
		setError('');
		setLoading(true);
		try {
			await login(email, password);
			router.replace('/collections');
		} catch (err) {
			setError(err instanceof APIError ? err.message : 'Login failed');
		} finally {
			setLoading(false);
		}
	}

	return (
		<main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_left,#1d4ed8,transparent_32rem),radial-gradient(circle_at_bottom_right,#312e81,transparent_30rem),linear-gradient(135deg,#0f172a,#111827)] px-4">
			<section className="grid w-full max-w-5xl overflow-hidden rounded-3xl border border-white/10 bg-slate-950/70 shadow-2xl shadow-slate-950/60 backdrop-blur-xl md:grid-cols-[1.1fr_0.9fr]">
				<div className="hidden bg-slate-950 p-10 text-white md:block">
					<div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-sm font-black text-slate-950">FI</div>
					<h1 className="mt-10 text-4xl font-black tracking-tight">Financial document intelligence, in real time.</h1>
					<p className="mt-4 max-w-md text-sm leading-6 text-slate-300">
						Ingest regulatory PDFs, search obligations, summarize documents, and detect contradictions with live WebSocket updates.
					</p>
					<div className="mt-10 grid gap-3 text-sm">
						<div className="rounded-2xl border border-white/10 bg-white/5 p-4">RBI / SEBI / SEC document workflows</div>
						<div className="rounded-2xl border border-white/10 bg-white/5 p-4">RAG search, summaries, contradictions</div>
						<div className="rounded-2xl border border-white/10 bg-white/5 p-4">Research benchmarks and audit logs</div>
					</div>
				</div>

				<div className="bg-slate-900/80 p-8 md:p-10">
					<h1 className="text-2xl font-bold text-white">Welcome back</h1>
					<p className="mt-1 text-sm text-slate-300">Sign in to continue to FinSightIQ.</p>

					<form onSubmit={submit} className="mt-6 space-y-4">
					<input
						type="email"
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						placeholder="Email"
						className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
						required
					/>
					<input
						type="password"
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						placeholder="Password"
						className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
						required
					/>

					{error && <p className="text-sm text-red-600">{error}</p>}

					<button
						type="submit"
						disabled={loading}
						className="w-full rounded-xl bg-blue-500 py-2 text-sm font-bold text-white hover:bg-blue-400 disabled:opacity-50"
					>
						{loading ? 'Signing in…' : 'Sign in'}
					</button>
				</form>

					<p className="mt-5 text-center text-sm text-slate-300">
					No account?{' '}
					<Link href="/register" className="font-medium text-blue-600 hover:underline">
						Register
					</Link>
				</p>
				</div>
			</section>
		</main>
	);
}
