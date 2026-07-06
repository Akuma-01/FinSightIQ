'use client';

import { documents } from '@/lib/api';
import { useRef, useState } from 'react';

const MAX_SIZE_MB = Number.parseInt(process.env.NEXT_PUBLIC_MAX_FILE_SIZE_MB ?? '25', 10);
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

export function UploadModal({
	token,
	collectionId,
	onQueued,
	onClose,
}: {
	token: string;
	collectionId: string;
	onQueued: (payload: { documentId: string; filename: string; status: 'processing' }) => void;
	onClose: () => void;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [file, setFile] = useState<File | null>(null);
	const [error, setError] = useState('');
	const [loading, setLoading] = useState(false);

	function selectFile(nextFile: File | null) {
		setError('');
		if (!nextFile) {
			setFile(null);
			return;
		}
		if (!['application/pdf', 'text/plain'].includes(nextFile.type)) {
			setFile(null);
			setError('Unsupported file type. Upload a PDF or plain text file.');
			return;
		}
		if (nextFile.size > MAX_SIZE_BYTES) {
			setFile(null);
			setError(`File is ${(nextFile.size / 1024 / 1024).toFixed(1)} MB. Maximum size is ${MAX_SIZE_MB} MB.`);
			return;
		}
		setFile(nextFile);
	}

	async function upload() {
		if (!file) return;
		setError('');
		setLoading(true);
		try {
			const result = await documents.upload(token, collectionId, file) as {
				documentId: string;
				filename: string;
				status: 'processing';
			};
			onQueued(result);
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Upload failed');
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 backdrop-blur-sm">
			<div className="w-full max-w-md rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
				<div className="flex items-center gap-3">
					<div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-200">↑</div>
					<div>
						<h2 className="text-lg font-bold text-white">Upload document</h2>
						<p className="mt-1 text-sm text-slate-300">PDF or plain text. Maximum {MAX_SIZE_MB} MB.</p>
					</div>
				</div>

				<button
					type="button"
					onClick={() => inputRef.current?.click()}
					className="mt-5 w-full rounded-3xl border-2 border-dashed border-blue-500/40 bg-blue-500/10 p-8 text-center text-sm text-slate-300 hover:border-blue-400 hover:bg-blue-500/15"
				>
					{file ? (
						<span className="font-medium text-slate-100">
							{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
						</span>
					) : (
						'Click to select a document'
					)}
				</button>
				<input
					ref={inputRef}
					type="file"
					accept="application/pdf,text/plain,.pdf,.txt"
					className="hidden"
					onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
				/>

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
						type="button"
						onClick={upload}
						disabled={!file || loading}
						className="rounded-full bg-blue-500 px-5 py-2 text-sm font-bold text-white shadow-sm hover:bg-blue-400 disabled:opacity-50"
					>
						{loading ? 'Uploading…' : 'Upload'}
					</button>
				</div>
			</div>
		</div>
	);
}
