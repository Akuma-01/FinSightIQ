'use client';

import { AnnotationItem } from '@/components/annotations/AnnotationItem';
import { annotations as annotationsAPI } from '@/lib/api';
import type { Annotation, Role } from '@/types/api';
import { useState } from 'react';
import toast from 'react-hot-toast';

export function AnnotationSidebar({
	annotations,
	token,
	collectionId,
	documentId,
	currentUserId,
	userRole,
}: {
	annotations: Annotation[];
	token: string;
	collectionId: string;
	documentId: string;
	currentUserId: string;
	userRole: Role;
}) {
	const [body, setBody] = useState('');
	const [annotationType, setAnnotationType] = useState<'comment' | 'flag' | 'question'>('comment');
	const [busy, setBusy] = useState(false);

	async function create() {
		if (!body.trim()) return;
		setBusy(true);
		try {
			await annotationsAPI.create(token, collectionId, documentId, {
				body: body.trim(),
				annotationType,
			});
			setBody('');
			setAnnotationType('comment');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not create annotation');
		} finally {
			setBusy(false);
		}
	}

	return (
		<aside className="flex h-full flex-col bg-slate-950">
			<div className="border-b border-slate-800 bg-slate-900 p-5">
				<h2 className="font-bold text-white">Annotations</h2>
				<p className="mt-1 text-xs text-slate-400">Comments sync live across connected tabs.</p>
			</div>

			<div className="border-b border-slate-800 bg-slate-900 p-5">
				<select
					value={annotationType}
					onChange={(event) => setAnnotationType(event.target.value as 'comment' | 'flag' | 'question')}
					className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
				>
					<option value="comment">Comment</option>
					<option value="flag">Flag</option>
					<option value="question">Question</option>
				</select>
				<textarea
					value={body}
					onChange={(event) => setBody(event.target.value)}
					placeholder="Add an annotation…"
					className="mt-3 h-24 w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
				/>
				<button
					onClick={create}
					disabled={busy || !body.trim()}
					className="mt-3 w-full rounded-full bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
				>
					{busy ? 'Adding…' : 'Add annotation'}
				</button>
			</div>

			<div className="flex-1 space-y-3 overflow-y-auto p-4">
				{annotations.length === 0 ? (
					<p className="rounded-2xl border border-dashed border-slate-700 bg-slate-900 p-4 text-center text-sm text-slate-400">
						No annotations yet.
					</p>
				) : (
					annotations.map((annotation) => (
						<AnnotationItem
							key={annotation.id}
							annotation={annotation}
							token={token}
							collectionId={collectionId}
							documentId={documentId}
							currentUserId={currentUserId}
							userRole={userRole}
						/>
					))
				)}
			</div>
		</aside>
	);
}
