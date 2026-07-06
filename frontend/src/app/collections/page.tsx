'use client';

import { CreateCollectionModal } from '@/components/collections/CreateCollectionModal';
import { SummaryBadges } from '@/components/collections/SummaryBadges';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { useAuth } from '@/context/AuthContext';
import { collections as collectionsAPI } from '@/lib/api';
import type { Collection, CollectionSummary } from '@/types/api';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function CollectionsPage() {
	const { token, user, loading: authLoading } = useAuth();
	const router = useRouter();
	const [collections, setCollections] = useState<Collection[]>([]);
	const [summaries, setSummaries] = useState<Record<string, CollectionSummary>>({});
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [showCreate, setShowCreate] = useState(false);

	useEffect(() => {
		if (authLoading) return;
		if (!token) {
			router.replace('/login');
			return;
		}

		let cancelled = false;

		collectionsAPI.list(token)
			.then(async ({ collections }) => {
				if (cancelled) return;
				setCollections(collections);

				const results = await Promise.all(
					collections.map(async (collection) => {
						try {
							const summary = await collectionsAPI.summary(token, collection.id);
							return [collection.id, summary] as const;
						} catch {
							return [collection.id, null] as const;
						}
					})
				);

				if (cancelled) return;
				const map: Record<string, CollectionSummary> = {};
				for (const [id, summary] of results) {
					if (summary) map[id] = summary;
				}
				setSummaries(map);
			})
			.catch((err) => {
				if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load collections');
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, [authLoading, router, token]);

	if (authLoading || loading) {
		return (
			<main className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300">
				<Spinner className="text-blue-300" />
			</main>
		);
	}

	if (!token) return null;

	const canCreate = user?.role === 'admin' || user?.role === 'analyst';

	return (
		<AppShell
			title="Collections"
			eyebrow="Workspace"
			description="Upload regulatory documents, run AI analysis, and review contradictions from one workspace."
			actions={canCreate && (
				<button
					onClick={() => setShowCreate(true)}
					className="rounded-full bg-blue-500 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-blue-950/30 hover:bg-blue-400"
				>
					+ New Collection
				</button>
			)}
		>
				{error && (
					<div className="mb-6 rounded-lg border border-red-400/40 bg-red-500/15 px-4 py-3 text-sm text-red-200">
						{error}
					</div>
				)}

				{collections.length === 0 ? (
					<EmptyState
						title="No collections yet"
						description={canCreate ? 'Create one to start ingesting RBI, SEBI, SEC, or local regulatory documents.' : 'Ask an admin or analyst to add you to a collection.'}
						action={canCreate && (
							<button
								onClick={() => setShowCreate(true)}
								className="rounded-full bg-blue-500 px-4 py-2 text-sm font-bold text-white hover:bg-blue-400"
							>
								Create collection
							</button>
						)}
					/>
				) : (
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
						{collections.map((collection) => (
							<Link
								key={collection.id}
								href={`/collections/${collection.id}`}
								className="group rounded-3xl border border-slate-700 bg-slate-900/85 p-5 shadow-lg shadow-slate-950/20 transition hover:-translate-y-0.5 hover:border-blue-500/60 hover:bg-slate-900"
							>
								<div className="flex items-start justify-between gap-3">
									<div>
										<h3 className="font-semibold text-white group-hover:text-blue-200">{collection.name}</h3>
										<p className="mt-1 text-xs text-slate-400">
											{collection.chunkingStrategy} · {collection.documentCount} docs
										</p>
									</div>
									{collection.archived && (
										<span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-300">
											Archived
										</span>
									)}
								</div>

								<div className="mt-4">
									{summaries[collection.id] ? (
										<SummaryBadges summary={summaries[collection.id]} />
									) : (
										<span className="text-xs text-slate-500">Summary unavailable</span>
									)}
								</div>
							</Link>
						))}
					</div>
				)}

			{showCreate && (
				<CreateCollectionModal
					token={token}
					onCreated={(collection) => {
						setCollections((current) => [collection, ...current]);
						setSummaries((current) => ({
							...current,
							[collection.id]: { critical: 0, moderate: 0, minor: 0, unresolved: 0, total: 0, stale: 0 },
						}));
						setShowCreate(false);
					}}
					onClose={() => setShowCreate(false)}
				/>
			)}
		</AppShell>
	);
}
