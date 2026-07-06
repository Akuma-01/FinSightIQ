/**
 * Shared visual tokens for FinSightIQ.
 *
 * Keep page/component styling semantic where possible. This avoids scattering
 * raw slate/blue/red Tailwind combinations across the app and makes future
 * theme changes much safer.
 */
export const theme = {
	appBg:
		'bg-[radial-gradient(circle_at_top_left,#1d4ed8,transparent_32rem),radial-gradient(circle_at_top_right,#312e81,transparent_30rem),linear-gradient(180deg,#0f172a,#111827_48%,#1e293b)]',

	text: {
		primary: 'text-white',
		secondary: 'text-slate-300',
		muted: 'text-slate-400',
		link: 'text-blue-200 hover:text-white hover:underline',
	},

	surface: {
		header: 'border-white/10 bg-slate-950/85 text-white shadow-2xl shadow-slate-950/20 backdrop-blur-xl',
		panel: 'border-slate-700 bg-slate-900/85 shadow-lg shadow-slate-950/20',
		panelStrong: 'border-slate-800 bg-slate-950 shadow-lg shadow-slate-950/30',
		empty: 'border-dashed border-slate-600 bg-slate-900/70 shadow-lg shadow-slate-950/20',
	},

	button: {
		primary: 'bg-blue-500 text-white shadow-lg shadow-blue-950/30 hover:bg-blue-400 disabled:opacity-50',
		secondary: 'border border-white/10 bg-white/10 text-white hover:bg-white/15 disabled:opacity-50',
		subtle: 'border border-slate-600 text-slate-200 hover:bg-white/10 disabled:opacity-50',
		dangerSubtle: 'border border-red-400/40 text-red-200 hover:bg-red-500/15 disabled:opacity-50',
	},

	input:
		'border-slate-700 bg-slate-950 text-slate-100 outline-none placeholder:text-slate-500 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20',

	alert: {
		error: 'border-red-400/40 bg-red-500/15 text-red-200',
		warning: 'border-amber-400/40 bg-amber-500/15 text-amber-200',
		info: 'border-blue-500/30 bg-blue-500/10 text-blue-100',
	},

	badge: {
		slate: 'border-slate-700 bg-slate-800 text-slate-300',
		blue: 'border-blue-400/40 bg-blue-500/15 text-blue-200',
		emerald: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200',
		red: 'border-red-400/40 bg-red-500/15 text-red-200',
		amber: 'border-amber-400/40 bg-amber-500/15 text-amber-200',
		yellow: 'border-yellow-400/40 bg-yellow-500/15 text-yellow-200',
		purple: 'border-purple-400/40 bg-purple-500/15 text-purple-200',
	},

	metric: {
		slate: 'text-slate-100 bg-slate-900/90 border-slate-700',
		blue: 'text-blue-100 bg-blue-950/80 border-blue-800',
		green: 'text-emerald-100 bg-emerald-950/70 border-emerald-800',
		red: 'text-red-100 bg-red-950/70 border-red-800',
		amber: 'text-amber-100 bg-amber-950/70 border-amber-800',
	},

	severity: {
		card: {
			critical: 'border-red-700/70 bg-red-950/70 shadow-red-950/20',
			moderate: 'border-amber-700/70 bg-amber-950/65 shadow-amber-950/20',
			minor: 'border-blue-700/70 bg-blue-950/65 shadow-blue-950/20',
		},
		badge: {
			critical: 'bg-red-500/15 text-red-200 ring-1 ring-red-400/30',
			moderate: 'bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/30',
			minor: 'bg-blue-500/15 text-blue-200 ring-1 ring-blue-400/30',
		},
	},
} as const;
