'use client';

import { edgar } from '@/lib/api';
import { useState } from 'react';

const CURRENT_YEAR = new Date().getFullYear();
const TICKER_PATTERN = /^[A-Z0-9]{1,10}$/;

export function EdgarFetchModal({
	token,
	collectionId,
	onQueued,
	onClose,
}: {
	token: string;
	collectionId: string;
	onQueued: (payload: { ticker: string; filingType: string; year: number; jobId?: string | number }) => void;
	onClose: () => void;
}) {
	const [ticker, setTicker] = useState('');
	const [filingType, setFilingType] = useState<'10-K' | '10-Q' | '8-K'>('10-K');
	const [year, setYear] = useState(CURRENT_YEAR - 1);
	const [error, setError] = useState('');
	const [loading, setLoading] = useState(false);

	async function fetchFiling() {
		setError('');
		const cleanTicker = ticker.trim().toUpperCase();
		if (!TICKER_PATTERN.test(cleanTicker)) {
			setError('Ticker must be 1–10 uppercase letters/numbers, for example AAPL.');
			return;
		}

		setLoading(true);
		try {
			const result = await edgar.fetch(token, {
				ticker: cleanTicker,
				filingType,
				year,
				collectionId,
			}) as { ticker: string; filingType: string; year: number; jobId?: string | number };
			onQueued({ ticker: result.ticker, filingType: result.filingType, year: result.year, jobId: result.jobId });
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Could not queue EDGAR fetch');
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 backdrop-blur-sm">
			<div className="w-full max-w-sm rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
				<div className="flex items-center gap-3">
					<div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-500/15 text-xs font-black text-blue-200">SEC</div>
					<div>
						<h2 className="text-lg font-bold text-white">Fetch from EDGAR</h2>
						<p className="mt-1 text-sm text-slate-300">Queue a SEC filing for ingestion.</p>
					</div>
				</div>

				<label className="mt-5 block text-sm font-bold text-slate-200">
					Ticker
					<input
						value={ticker}
						onChange={(event) => setTicker(event.target.value.toUpperCase())}
						placeholder="AAPL"
						className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
					/>
				</label>

				<label className="mt-4 block text-sm font-bold text-slate-200">
					Filing type
					<select
						value={filingType}
						onChange={(event) => setFilingType(event.target.value as '10-K' | '10-Q' | '8-K')}
						className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
					>
						<option value="10-K">10-K annual report</option>
						<option value="10-Q">10-Q quarterly report</option>
						<option value="8-K">8-K current report</option>
					</select>
				</label>

				<label className="mt-4 block text-sm font-bold text-slate-200">
					Year
					<input
						type="number"
						min={1993}
						max={CURRENT_YEAR}
						value={year}
						onChange={(event) => setYear(Number(event.target.value))}
						className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
					/>
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
						type="button"
						onClick={fetchFiling}
						disabled={!ticker.trim() || loading}
						className="rounded-full bg-blue-500 px-5 py-2 text-sm font-bold text-white shadow-sm hover:bg-blue-400 disabled:opacity-50"
					>
						{loading ? 'Queueing…' : 'Queue fetch'}
					</button>
				</div>
			</div>
		</div>
	);
}
