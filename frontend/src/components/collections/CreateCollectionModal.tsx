'use client';

import { collections } from '@/lib/api';
import type { Collection } from '@/types/api';
import { useState } from 'react';

const STRATEGIES = [
	{ value: 'section_aware', label: 'Section aware' },
	{ value: 'sentence', label: 'Sentence' },
	{ value: 'fixed_512', label: 'Fixed 512' },
	{ value: 'fixed_256', label: 'Fixed 256' },
];

export function CreateCollectionModal({
	token,
	onCreated,
	onClose,
}: {
	token: string;
	onCreated: (collection: Collection) => void;
	onClose: () => void;
}) {
	const [name, setName] = useState('');
	const [chunkingStrategy, setChunkingStrategy] = useState('section_aware');
	const [error, setError] = useState('');
	const [loading, setLoading] = useState(false);

	async function submit(event: React.FormEvent) {
		event.preventDefault();
		setError('');
		setLoading(true);
		try {
			const { collection } = await collections.create(token, { name: name.trim(), chunkingStrategy });
			onCreated(collection);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Could not create collection');
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 backdrop-blur-sm">
			<form onSubmit={submit} className="w-full max-w-md rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
				<div className="flex items-center gap-3">
					<div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-200">＋</div>
					<div>
						<h2 className="text-lg font-bold text-white">Create collection</h2>
						<p className="mt-1 text-sm text-slate-300">Create a workspace for related regulatory documents.</p>
					</div>
				</div>

				<label className="mt-5 block text-sm font-bold text-slate-200">
					Name
					<input
						value={name}
						onChange={(event) => setName(event.target.value)}
						className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
						placeholder="RBI KYC comparison"
						required
					/>
				</label>

				<label className="mt-4 block text-sm font-bold text-slate-200">
					Chunking strategy
					<select
						value={chunkingStrategy}
						onChange={(event) => setChunkingStrategy(event.target.value)}
						className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
					>
						{STRATEGIES.map((strategy) => (
							<option key={strategy.value} value={strategy.value}>
								{strategy.label}
							</option>
						))}
					</select>
				</label>

				{error && <p className="mt-4 text-sm text-red-600">{error}</p>}

				<div className="mt-6 flex justify-end gap-3">
					<button
						type="button"
						onClick={onClose}
						className="rounded-full px-4 py-2 text-sm font-bold text-slate-300 hover:bg-white/10"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={loading || !name.trim()}
						className="rounded-full bg-blue-500 px-5 py-2 text-sm font-bold text-white shadow-sm hover:bg-blue-400 disabled:opacity-50"
					>
						{loading ? 'Creating…' : 'Create'}
					</button>
				</div>
			</form>
		</div>
	);
}
