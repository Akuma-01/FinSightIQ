'use client';

import { APIError, auth } from '@/lib/api';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function RegisterPage() {
	const router = useRouter();
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [displayName, setDisplayName] = useState('');
	const [error, setError] = useState('');
	const [loading, setLoading] = useState(false);

	async function submit(event: React.FormEvent) {
		event.preventDefault();
		setError('');
		setLoading(true);
		try {
			// Every self-service signup starts as an analyst. Compliance-officer
			// and researcher access, and admin access, are granted later by an
			// admin from the admin panel — see /api/users.
			await auth.register({ email, password, displayName, role: 'analyst' });
			router.replace('/login');
		} catch (err) {
			setError(err instanceof APIError ? err.message : 'Registration failed');
		} finally {
			setLoading(false);
		}
	}

	return (
		<main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_left,#1d4ed8,transparent_32rem),radial-gradient(circle_at_bottom_right,#312e81,transparent_30rem),linear-gradient(135deg,#0f172a,#111827)] px-4">
			<section className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900/85 p-8 shadow-2xl shadow-slate-950/60 backdrop-blur-xl">
				<div className="mb-6 flex items-center gap-3">
					<div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-500 text-sm font-black text-white">FI</div>
					<div>
						<h1 className="text-2xl font-bold text-white">Create account</h1>
						<p className="mt-1 text-sm text-slate-300">Takes a minute — no setup decisions required.</p>
					</div>
				</div>

				<form onSubmit={submit} className="mt-6 space-y-4">
					<input
						value={displayName}
						onChange={(event) => setDisplayName(event.target.value)}
						placeholder="Display name"
						className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
						required
					/>
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
						minLength={8}
					/>

					{error && <p className="text-sm text-red-600">{error}</p>}

					<button
						type="submit"
						disabled={loading}
						className="w-full rounded-xl bg-blue-500 py-2 text-sm font-bold text-white hover:bg-blue-400 disabled:opacity-50"
					>
						{loading ? 'Creating…' : 'Create account'}
					</button>
				</form>

				<p className="mt-5 text-center text-sm text-slate-300">
					Already have an account?{' '}
					<Link href="/login" className="font-medium text-blue-600 hover:underline">
						Sign in
					</Link>
				</p>
			</section>
		</main>
	);
}
