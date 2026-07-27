'use client';

import { AppShell } from '@/components/layout/AppShell';
import { Spinner } from '@/components/ui/Spinner';
import { useAuth } from '@/context/AuthContext';
import { collections as collectionsAPI } from '@/lib/api';
import type { Collection } from '@/types/api';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

export default function WelcomePage() {
	const { token, user, loading: authLoading } = useAuth();
	const router = useRouter();
	const [collections, setCollections] = useState<Collection[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		if (authLoading) return;
		if (!token) {
			router.replace('/login');
			return;
		}

		let cancelled = false;
		collectionsAPI.list(token)
			.then(({ collections: items }) => {
				if (!cancelled) setCollections(items.filter((item) => !item.archived));
			})
			.catch(() => {
				if (!cancelled) setCollections([]);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});

		return () => { cancelled = true; };
	}, [authLoading, router, token]);

	const walkthroughCollection = useMemo(
		() => collections.find((collection) => collection.documentCount >= 2) ?? collections[0],
		[collections]
	);
	const canCreate = user?.role === 'admin' || user?.role === 'analyst';

	if (authLoading || loading) {
		return <main className="flex min-h-screen items-center justify-center bg-slate-950"><Spinner className="text-blue-300" /></main>;
	}
	if (!token) return null;

	return (
		<AppShell title="See your next compliance risk" eyebrow="FinSightIQ overview" description="Start with the outcome: identify a conflict, verify the evidence, then decide what to do next.">
			<section className="mt-8 overflow-hidden rounded-3xl border border-blue-400/30 bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,.22),transparent_25rem),rgba(15,23,42,.88)] p-6 shadow-lg shadow-blue-950/20 sm:p-8">
				<p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-200">A three-minute walkthrough</p>
				<h2 className="mt-3 max-w-2xl text-2xl font-bold tracking-tight text-white">Understand the value before you manage the documents.</h2>
				<p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">FinSightIQ compares the rules your team relies on, explains what changed, and links every insight to the underlying evidence.</p>
				<div className="mt-6 grid gap-3 md:grid-cols-3">
					{[['1', 'Review a risk', 'See the most important issue first.'], ['2', 'Verify the evidence', 'Read the two source statements side by side.'], ['3', 'Take action', 'Ask a question or mark the issue for review.']].map(([number, title, copy]) => (
						<div key={number} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
							<span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-500 text-xs font-bold text-white">{number}</span>
							<h3 className="mt-3 text-sm font-bold text-white">{title}</h3>
							<p className="mt-1 text-xs leading-5 text-slate-300">{copy}</p>
						</div>
					))}
				</div>
				<div className="mt-7 flex flex-wrap gap-3">
					{walkthroughCollection ? (
						<Link href={`/collections/${walkthroughCollection.id}?tour=1`} className="rounded-full bg-blue-500 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-950/30 hover:bg-blue-400">Start the walkthrough</Link>
					) : canCreate ? (
						<Link href="/collections" className="rounded-full bg-blue-500 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-950/30 hover:bg-blue-400">Create a workspace</Link>
					) : (
						<Link href="/collections" className="rounded-full bg-blue-500 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-950/30 hover:bg-blue-400">View workspaces</Link>
					)}
					<Link href="/collections" className="rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-bold text-white hover:bg-white/10">Go to workspaces</Link>
				</div>
				{!walkthroughCollection && <p className="mt-4 text-xs text-blue-100/80">Add at least two documents to a workspace to unlock the guided walkthrough.</p>}
			</section>

			<section className="mt-6 grid gap-4 md:grid-cols-2">
				<div className="rounded-3xl border border-slate-700 bg-slate-900/85 p-6 shadow-lg shadow-slate-950/20">
					<h2 className="text-base font-bold text-white">What you will get</h2>
					<p className="mt-2 text-sm leading-6 text-slate-300">A prioritized view of inconsistent rules, outdated references, and changes that need a human decision.</p>
				</div>
				<div className="rounded-3xl border border-slate-700 bg-slate-900/85 p-6 shadow-lg shadow-slate-950/20">
					<h2 className="text-base font-bold text-white">Your evidence stays visible</h2>
					<p className="mt-2 text-sm leading-6 text-slate-300">Every finding links back to the relevant passages, so reviewers can validate it without trusting a black box.</p>
				</div>
			</section>
		</AppShell>
	);
}
