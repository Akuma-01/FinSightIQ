'use client';

import { collections as collectionsAPI } from '@/lib/api';
import { roleLabel } from '@/lib/labels';
import type { CollectionMember } from '@/types/api';
import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';

type AccessRole = CollectionMember['accessRole'];

const ACCESS_ROLES: AccessRole[] = ['viewer', 'editor', 'owner'];

export function ManageMembersModal({
	token,
	collectionId,
	onClose,
}: {
	token: string;
	collectionId: string;
	onClose: () => void;
}) {
	const [members, setMembers] = useState<CollectionMember[]>([]);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [userId, setUserId] = useState('');
	const [accessRole, setAccessRole] = useState<AccessRole>('viewer');
	const [error, setError] = useState('');

	const loadMembers = useCallback(async () => {
		setLoading(true);
		setError('');
		try {
			const result = await collectionsAPI.members.list(token, collectionId);
			setMembers(result.members);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Could not load members');
		} finally {
			setLoading(false);
		}
	}, [collectionId, token]);

	useEffect(() => {
		const timer = window.setTimeout(() => {
			void loadMembers();
		}, 0);
		return () => window.clearTimeout(timer);
	}, [loadMembers]);

	async function addMember() {
		const cleanUserId = userId.trim();
		if (!cleanUserId) return;

		setBusy(true);
		setError('');
		try {
			await collectionsAPI.members.add(token, collectionId, {
				userId: cleanUserId,
				accessRole,
			});
			setUserId('');
			toast.success('Member added');
			await loadMembers();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Could not add member');
		} finally {
			setBusy(false);
		}
	}

	async function removeMember(member: CollectionMember) {
		setBusy(true);
		setError('');
		try {
			await collectionsAPI.members.remove(token, collectionId, member.id);
			setMembers((current) => current.filter((item) => item.id !== member.id));
			toast.success(`Removed ${member.email}`);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Could not remove member');
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
			<div className="w-full max-w-3xl rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-2xl shadow-slate-950/50">
				<div className="flex items-start justify-between gap-4">
					<div>
						<h2 className="text-lg font-bold text-white">Manage collection members</h2>
						<p className="mt-1 text-sm text-slate-400">
							Add registered users by user ID and assign their collection access role.
						</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="rounded-full px-3 py-1 text-sm font-bold text-slate-300 hover:bg-white/10"
					>
						✕
					</button>
				</div>

				<div className="mt-5 rounded-2xl border border-slate-700 bg-slate-950/60 p-4">
					<label className="block text-xs font-bold uppercase tracking-wide text-slate-400">
						User ID
						<input
							value={userId}
							onChange={(event) => setUserId(event.target.value)}
							placeholder="Paste registered user's UUID"
							className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
						/>
					</label>

					<div className="mt-3 flex flex-wrap items-end gap-3">
						<label className="block text-xs font-bold uppercase tracking-wide text-slate-400">
							Access role
							<select
								value={accessRole}
								onChange={(event) => setAccessRole(event.target.value as AccessRole)}
								className="mt-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
							>
								{ACCESS_ROLES.map((role) => (
									<option key={role} value={role}>{role}</option>
								))}
							</select>
						</label>

						<button
							type="button"
							onClick={addMember}
							disabled={busy || !userId.trim()}
							className="rounded-full bg-blue-500 px-5 py-2 text-sm font-bold text-white shadow-lg shadow-blue-950/30 hover:bg-blue-400 disabled:opacity-50"
						>
							{busy ? 'Saving…' : 'Add / update member'}
						</button>
					</div>

					<p className="mt-3 text-xs leading-5 text-slate-500">
						Prototype note: user lookup/search is not implemented yet, so this UI uses the registered user UUID.
						In production this would be an email search or invite flow.
					</p>
				</div>

				{error && (
					<div className="mt-4 rounded-xl border border-red-400/40 bg-red-500/15 px-4 py-3 text-sm text-red-200">
						{error}
					</div>
				)}

				<div className="mt-5 overflow-hidden rounded-2xl border border-slate-700">
					<div className="grid grid-cols-[1fr_120px_120px_90px] gap-3 border-b border-slate-700 bg-slate-950/70 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-400">
						<span>User</span>
						<span>System role</span>
						<span>Access</span>
						<span className="text-right">Action</span>
					</div>

					{loading ? (
						<p className="px-4 py-5 text-sm text-slate-400">Loading members…</p>
					) : members.length === 0 ? (
						<p className="px-4 py-5 text-sm text-slate-400">No members found.</p>
					) : (
						<ul className="max-h-80 divide-y divide-slate-800 overflow-y-auto">
							{members.map((member) => (
								<li key={member.id} className="grid grid-cols-[1fr_120px_120px_90px] gap-3 px-4 py-3 text-sm">
									<div className="min-w-0">
										<p className="truncate font-semibold text-slate-100">{member.displayName || member.email}</p>
										<p className="truncate text-xs text-slate-500">{member.email}</p>
										<p className="truncate text-[11px] text-slate-600">{member.id}</p>
									</div>
									<span className="text-slate-300">{roleLabel(member.role)}</span>
									<span className="text-blue-200">{member.accessRole}</span>
									<div className="text-right">
										<button
											type="button"
											onClick={() => removeMember(member)}
											disabled={busy}
											className="rounded-lg border border-red-400/40 px-3 py-1 text-xs font-bold text-red-200 hover:bg-red-500/15 disabled:opacity-50"
										>
											Remove
										</button>
									</div>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</div>
	);
}
