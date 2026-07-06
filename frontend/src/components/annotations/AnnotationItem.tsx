'use client';

import { annotations as annotationsAPI } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { Annotation, Role } from '@/types/api';
import { useState } from 'react';
import toast from 'react-hot-toast';

const TYPE_STYLE = {
	comment: 'bg-slate-700/60 text-slate-100 ring-1 ring-slate-500/30',
	flag: 'bg-red-500/15 text-red-200 ring-1 ring-red-400/30',
	question: 'bg-blue-500/15 text-blue-200 ring-1 ring-blue-400/30',
} as const;

export function AnnotationItem({
	annotation,
	token,
	collectionId,
	documentId,
	currentUserId,
	userRole,
}: {
	annotation: Annotation;
	token: string;
	collectionId: string;
	documentId: string;
	currentUserId: string;
	userRole: Role;
}) {
	const [editing, setEditing] = useState(false);
	const [body, setBody] = useState(annotation.body);
	const [busy, setBusy] = useState(false);

	const canEditBody = userRole === 'admin' || annotation.createdBy === currentUserId;
	const canResolve = userRole === 'admin' || userRole === 'compliance_officer' || annotation.createdBy === currentUserId;
	const canDelete = userRole === 'admin' || annotation.createdBy === currentUserId;

	async function saveBody() {
		setBusy(true);
		try {
			await annotationsAPI.update(token, collectionId, documentId, annotation.id, { body });
			setEditing(false);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not update annotation');
		} finally {
			setBusy(false);
		}
	}

	async function resolve() {
		setBusy(true);
		try {
			await annotationsAPI.update(token, collectionId, documentId, annotation.id, { isResolved: true });
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not resolve annotation');
		} finally {
			setBusy(false);
		}
	}

	async function remove() {
		setBusy(true);
		try {
			await annotationsAPI.remove(token, collectionId, documentId, annotation.id);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not delete annotation');
			setBusy(false);
		}
	}

	return (
		<article className={cn('rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-sm shadow-slate-950/30', annotation.isResolved && 'opacity-60')}>
			<div className="flex items-start justify-between gap-2">
				<div>
					<span className={cn('rounded-full px-2 py-0.5 text-xs font-bold', TYPE_STYLE[annotation.annotationType])}>
						{annotation.annotationType}
					</span>
					<p className="mt-2 text-xs text-slate-400">
						{annotation.authorName || 'Unknown'} · {annotation.createdAt ? new Date(annotation.createdAt).toLocaleString() : ''}
					</p>
				</div>
				{annotation.isResolved && (
					<span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-200 ring-1 ring-emerald-400/30">Resolved</span>
				)}
			</div>

			{editing ? (
				<div className="mt-3 space-y-2">
					<textarea
						value={body}
						onChange={(event) => setBody(event.target.value)}
						className="h-24 w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
					/>
					<div className="flex justify-end gap-2">
						<button onClick={() => { setEditing(false); setBody(annotation.body); }} className="text-xs font-medium text-slate-400">
							Cancel
						</button>
						<button onClick={saveBody} disabled={busy || !body.trim()} className="text-xs font-semibold text-blue-300 disabled:opacity-50">
							Save
						</button>
					</div>
				</div>
			) : (
				<p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-200">{annotation.body}</p>
			)}

			<div className="mt-3 flex flex-wrap gap-3 text-xs">
				{canEditBody && !editing && (
					<button disabled={busy} onClick={() => setEditing(true)} className="font-bold text-blue-300 disabled:opacity-50">
						Edit
					</button>
				)}
				{canResolve && !annotation.isResolved && (
					<button disabled={busy} onClick={resolve} className="font-bold text-emerald-300 disabled:opacity-50">
						Resolve
					</button>
				)}
				{canDelete && (
					<button disabled={busy} onClick={remove} className="font-bold text-red-300 disabled:opacity-50">
						Delete
					</button>
				)}
			</div>
		</article>
	);
}
