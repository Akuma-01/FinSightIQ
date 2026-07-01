import type { Annotation, BenchmarkRun, Collection, Contradiction, Document, HealthStatus, ResearchMetrics, StaleReference, User } from '@/types/api';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

class APIError extends Error {
	constructor(public status: number, message: string) {
		super(message);
		this.name = 'APIError';
	}
}

let refreshCallback: (() => Promise<string | null>) | null = null;

export function registerRefreshCallback(fn: () => Promise<string | null>) {
	refreshCallback = fn;
}

type RawUser = {
	id: string;
	email: string;
	role: User['role'];
	displayName?: string;
	display_name?: string;
};

type RawCollection = {
	id: string;
	name: string;
	chunking_strategy?: string;
	chunkingStrategy?: string;
	archived?: boolean;
	document_count?: string | number;
	documentCount?: string | number;
	created_at?: string;
	createdAt?: string;
	access_role?: 'owner' | 'editor' | 'viewer';
	accessRole?: 'owner' | 'editor' | 'viewer';
};

type RawDocument = {
	id: string;
	filename: string;
	original_name?: string;
	originalName?: string;
	mime_type?: string;
	mimeType?: string;
	size_bytes?: string | number;
	sizeBytes?: string | number;
	status: Document['status'];
	doc_type?: string;
	docType?: string;
	source?: string;
	effective_date?: string | null;
	effectiveDate?: string | null;
	created_at?: string;
	createdAt?: string;
	raw_text?: string | null;
	rawText?: string | null;
	job_status?: string;
	jobStatus?: string;
	failure_reason?: string;
	failureReason?: string;
};

type RawAnnotation = {
	id: string;
	body: string;
	annotation_type?: Annotation['annotationType'];
	annotationType?: Annotation['annotationType'];
	is_resolved?: boolean;
	isResolved?: boolean;
	created_by?: string;
	createdBy?: string;
	author_name?: string;
	authorName?: string;
	chunk_id?: string;
	chunkId?: string;
	created_at?: string;
	createdAt?: string;
	updated_at?: string;
	updatedAt?: string;
};

type RawContradiction = {
	id: string;
	contradiction_type?: Contradiction['contradictionType'];
	contradictionType?: Contradiction['contradictionType'];
	type?: Contradiction['contradictionType'];
	severity: Contradiction['severity'];
	claim_a?: string;
	claimA?: string;
	claim_b?: string;
	claimB?: string;
	section_a?: string | null;
	sectionA?: string | null;
	section_b?: string | null;
	sectionB?: string | null;
	explanation: string;
	is_resolved?: boolean;
	isResolved?: boolean;
	resolved_by?: string;
	resolvedBy?: string;
	resolved_at?: string;
	resolvedAt?: string;
	doc_a_name?: string;
	docAName?: string;
	doc_b_name?: string;
	docBName?: string;
	doc_a_id?: string;
	docAId?: string;
	doc_b_id?: string;
	docBId?: string;
	docA?: { id: string; name: string };
	docB?: { id: string; name: string };
	created_at?: string;
	createdAt?: string;
};

type RawStaleReference = {
	id: string;
	document_id?: string;
	documentId?: string;
	document_name?: string;
	documentName?: string;
	referenced_identifier?: string;
	referencedIdentifier?: string;
	referenced_body?: string;
	referencedBody?: string;
	current_identifier?: string;
	currentIdentifier?: string;
	is_resolved?: boolean;
	isResolved?: boolean;
	created_at?: string;
	createdAt?: string;
};

type RawBenchmarkRun = {
	id: string;
	benchmark_type?: string;
	benchmarkType?: string;
	prompt_version_id?: string;
	promptVersionId?: string;
	prompt_version_number?: number;
	promptVersion?: number;
	version?: number;
	prompt_task?: string;
	promptTask?: string;
	task?: string;
	parameters?: Record<string, unknown>;
	metrics?: Record<string, unknown>;
	total_samples?: number;
	totalSamples?: number;
	notes?: string;
	created_at?: string;
	createdAt?: string;
};

function normalizeUser(user: RawUser): User {
	return {
		id: user.id,
		email: user.email,
		role: user.role,
		displayName: user.displayName ?? user.display_name ?? user.email,
	};
}

function normalizeCollection(collection: RawCollection): Collection {
	return {
		id: collection.id,
		name: collection.name,
		chunkingStrategy: collection.chunkingStrategy ?? collection.chunking_strategy ?? 'sentence',
		archived: Boolean(collection.archived),
		documentCount: Number(collection.documentCount ?? collection.document_count ?? 0),
		createdAt: collection.createdAt ?? collection.created_at ?? '',
		accessRole: collection.accessRole ?? collection.access_role,
	};
}

function normalizeDocument(document: RawDocument): Document {
	return {
		id: document.id,
		filename: document.filename,
		originalName: document.originalName ?? document.original_name,
		mimeType: document.mimeType ?? document.mime_type ?? '',
		sizeBytes: Number(document.sizeBytes ?? document.size_bytes ?? 0),
		status: document.status,
		docType: document.docType ?? document.doc_type ?? '',
		source: document.source ?? '',
		effectiveDate: document.effectiveDate ?? document.effective_date ?? null,
		createdAt: document.createdAt ?? document.created_at ?? '',
		rawText: document.rawText ?? document.raw_text,
		jobStatus: document.jobStatus ?? document.job_status,
		failureReason: document.failureReason ?? document.failure_reason,
	};
}

export function normalizeAnnotation(annotation: RawAnnotation): Annotation {
	return {
		id: annotation.id,
		body: annotation.body,
		annotationType: annotation.annotationType ?? annotation.annotation_type ?? 'comment',
		isResolved: Boolean(annotation.isResolved ?? annotation.is_resolved),
		createdBy: annotation.createdBy ?? annotation.created_by ?? '',
		authorName: annotation.authorName ?? annotation.author_name ?? 'Unknown',
		chunkId: annotation.chunkId ?? annotation.chunk_id,
		createdAt: annotation.createdAt ?? annotation.created_at ?? '',
		updatedAt: annotation.updatedAt ?? annotation.updated_at ?? '',
	};
}

export function normalizeContradiction(contradiction: RawContradiction): Contradiction {
	return {
		id: contradiction.id,
		contradictionType: contradiction.contradictionType ?? contradiction.contradiction_type ?? contradiction.type ?? 'policy_conflict',
		severity: contradiction.severity,
		claimA: contradiction.claimA ?? contradiction.claim_a ?? '',
		claimB: contradiction.claimB ?? contradiction.claim_b ?? '',
		sectionA: contradiction.sectionA ?? contradiction.section_a ?? null,
		sectionB: contradiction.sectionB ?? contradiction.section_b ?? null,
		explanation: contradiction.explanation,
		isResolved: Boolean(contradiction.isResolved ?? contradiction.is_resolved),
		resolvedBy: contradiction.resolvedBy ?? contradiction.resolved_by,
		resolvedAt: contradiction.resolvedAt ?? contradiction.resolved_at,
		docAName: contradiction.docAName ?? contradiction.doc_a_name ?? contradiction.docA?.name ?? 'Document A',
		docBName: contradiction.docBName ?? contradiction.doc_b_name ?? contradiction.docB?.name ?? 'Document B',
		docAId: contradiction.docAId ?? contradiction.doc_a_id ?? contradiction.docA?.id ?? '',
		docBId: contradiction.docBId ?? contradiction.doc_b_id ?? contradiction.docB?.id ?? '',
		createdAt: contradiction.createdAt ?? contradiction.created_at ?? '',
	};
}

function normalizeStaleReference(ref: RawStaleReference): StaleReference {
	return {
		id: ref.id,
		documentId: ref.documentId ?? ref.document_id ?? '',
		documentName: ref.documentName ?? ref.document_name ?? 'Document',
		referencedIdentifier: ref.referencedIdentifier ?? ref.referenced_identifier ?? '',
		referencedBody: ref.referencedBody ?? ref.referenced_body ?? '',
		currentIdentifier: ref.currentIdentifier ?? ref.current_identifier ?? '',
		isResolved: Boolean(ref.isResolved ?? ref.is_resolved),
		createdAt: ref.createdAt ?? ref.created_at ?? '',
	};
}

function normalizeBenchmarkRun(run: RawBenchmarkRun): BenchmarkRun {
	return {
		id: run.id,
		benchmarkType: run.benchmarkType ?? run.benchmark_type ?? '',
		promptVersionId: run.promptVersionId ?? run.prompt_version_id ?? '',
		promptVersion: run.promptVersion ?? run.prompt_version_number ?? run.version,
		promptTask: run.promptTask ?? run.prompt_task ?? run.task,
		parameters: run.parameters ?? {},
		metrics: run.metrics ?? {},
		totalSamples: Number(run.totalSamples ?? run.total_samples ?? 0),
		notes: run.notes ?? '',
		createdAt: run.createdAt ?? run.created_at ?? '',
	};
}

async function request<T>(
	path: string,
	options: RequestInit & { token?: string; _isRetry?: boolean } = {}
): Promise<T> {
	const { token, _isRetry, ...init } = options;

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		...(token ? { Authorization: `Bearer ${token}` } : {}),
		...(init.headers as Record<string, string> ?? {}),
	};

	const res = await fetch(`${BASE}${path}`, {
		...init,
		headers,
		credentials: 'include',
	});

	if (res.status === 401 && !_isRetry && refreshCallback && path !== '/api/auth/refresh') {
		const newToken = await refreshCallback();
		if (newToken) {
			return request<T>(path, { ...options, token: newToken, _isRetry: true });
		}
	}

	if (!res.ok) {
		const body = await res.json().catch(() => ({ error: 'Unknown error' }));
		throw new APIError(res.status, body.error ?? `HTTP ${res.status}`);
	}

	return res.json() as T;
}

async function fetchWithAuthRetry(
	url: string,
	options: RequestInit & { token: string; _isRetry?: boolean }
) {
	const { token, _isRetry, ...init } = options;
	const res = await fetch(url, {
		...init,
		headers: {
			Authorization: `Bearer ${token}`,
			...(init.headers as Record<string, string> ?? {}),
		},
		credentials: 'include',
	});

	if (res.status === 401 && !_isRetry && refreshCallback) {
		const newToken = await refreshCallback();
		if (newToken) {
			return fetchWithAuthRetry(url, { ...options, token: newToken, _isRetry: true });
		}
	}

	return res;
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export const auth = {
	login: (email: string, password: string) =>
		request<{ accessToken: string; user: RawUser }>
			('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
			.then((res) => ({ ...res, user: normalizeUser(res.user) })),

	register: (data: { email: string; password: string; displayName: string; role: string }) =>
		request<{ user: RawUser }>
			('/api/auth/register', { method: 'POST', body: JSON.stringify(data) })
			.then((res) => ({ user: normalizeUser(res.user) })),

	refresh: () =>
		request<{ accessToken: string }>('/api/auth/refresh', { method: 'POST' }),

	logout: () =>
		request('/api/auth/logout', { method: 'POST' }),

	me: (token: string) =>
		request<{ user: RawUser }>('/api/auth/me', { token })
			.then((res) => ({ user: normalizeUser(res.user) })),
};

// ─── Collections ──────────────────────────────────────────────────────────────

export const collections = {
	list: (token: string) =>
		request<{ collections: RawCollection[] }>('/api/collections', { token })
			.then((res) => ({ collections: res.collections.map(normalizeCollection) })),

	create: (token: string, data: { name: string; chunkingStrategy: string }) =>
		request<{ collection: RawCollection }>
			('/api/collections', { method: 'POST', token, body: JSON.stringify(data) })
			.then((res) => ({ collection: normalizeCollection(res.collection) })),

	summary: (token: string, id: string) =>
		request<import('../types/api').CollectionSummary>(`/api/collections/${id}/summary`, { token }),

	members: {
		list: (token: string, id: string) =>
			request<{ members: unknown[] }>(`/api/collections/${id}/members`, { token }),
		add: (token: string, id: string, data: { userId: string; accessRole: string }) =>
			request(`/api/collections/${id}/members`, { method: 'POST', token, body: JSON.stringify(data) }),
		remove: (token: string, id: string, uid: string) =>
			request(`/api/collections/${id}/members/${uid}`, { method: 'DELETE', token }),
	},
};

// ─── Documents ────────────────────────────────────────────────────────────────

export const documents = {
	list: (token: string, collectionId: string) =>
		request<{ documents: RawDocument[] }>
			(`/api/collections/${collectionId}/documents`, { token })
			.then((res) => ({ documents: res.documents.map(normalizeDocument) })),

	get: (token: string, collectionId: string, documentId: string) =>
		request<{ document: RawDocument }>
			(`/api/collections/${collectionId}/documents/${documentId}`, { token })
			.then((res) => ({ document: normalizeDocument(res.document) })),

	upload: async (token: string, collectionId: string, file: File) => {
		const form = new FormData();
		form.append('file', file);
		const res = await fetchWithAuthRetry(`${BASE}/api/collections/${collectionId}/documents`, {
			method: 'POST',
			token,
			body: form,
		});
		if (!res.ok) {
			const body = await res.json().catch(() => ({ error: 'Upload failed' }));
			throw new APIError(res.status, body.error);
		}
		return res.json();
	},

	retry: (token: string, documentId: string) =>
		request<{ documentId: string; jobId: string; status: string }>
			(`/api/documents/${documentId}/retry`, { method: 'POST', token }),
};

// ─── AI ───────────────────────────────────────────────────────────────────────

export const ai = {
	scan: (token: string, collectionId: string) =>
		request(`/api/ai/contradict/${collectionId}`, { method: 'POST', token }),

	scanTargeted: (token: string, data: { docIdA: string; docIdB: string; collectionId: string }) =>
		request('/api/ai/contradict/targeted', { method: 'POST', token, body: JSON.stringify(data) }),

	contradictions: (token: string, collectionId: string) =>
		request<{ contradictions: RawContradiction[] }>
			(`/api/ai/contradictions/${collectionId}`, { token })
			.then((res) => ({ contradictions: res.contradictions.map(normalizeContradiction) })),

	resolve: (token: string, id: string) =>
		request(`/api/ai/contradictions/${id}/resolve`, { method: 'PATCH', token }),

	stale: (token: string, collectionId: string) =>
		request<{ staleReferences: RawStaleReference[] }>
			(`/api/ai/stale/${collectionId}`, { token })
			.then((res) => ({ staleReferences: res.staleReferences.map(normalizeStaleReference) })),

	resolveStale: (token: string, id: string) =>
		request(`/api/ai/stale/${id}/resolve`, { method: 'PATCH', token }),

	search: (token: string, data: { collectionId: string; query: string }) =>
		request<{ answer: string; sources: unknown[] }>
			('/api/ai/search', { method: 'POST', token, body: JSON.stringify(data) }),

	summarizeDocument: (token: string, documentId: string) =>
		request<{ summary: string }>
			(`/api/ai/summarize/document/${documentId}`, { method: 'POST', token }),

	summarizeCollection: (token: string, collectionId: string) =>
		request<{ summary: string; documentCount?: number; tokensUsed?: unknown }>
			(`/api/ai/summarize/collection/${collectionId}`, { method: 'POST', token }),
};

// ─── EDGAR ────────────────────────────────────────────────────────────────────

export const edgar = {
	fetch: (token: string, data: { ticker: string; filingType: string; year: number; collectionId: string }) =>
		request('/api/edgar/fetch', { method: 'POST', token, body: JSON.stringify(data) }),
};

// ─── Annotations ──────────────────────────────────────────────────────────────

export const annotations = {
	list: (token: string, collectionId: string, documentId: string) =>
		request<{ annotations: RawAnnotation[] }>
			(`/api/collections/${collectionId}/documents/${documentId}/annotations`, { token })
			.then((res) => ({ annotations: res.annotations.map(normalizeAnnotation) })),

	create: (token: string, collectionId: string, documentId: string, data: { body: string; annotationType: string; chunkId?: string }) =>
		request<{ annotation: RawAnnotation }>
			(`/api/collections/${collectionId}/documents/${documentId}/annotations`,
				{ method: 'POST', token, body: JSON.stringify(data) })
			.then((res) => ({ annotation: normalizeAnnotation(res.annotation) })),

	update: (token: string, collectionId: string, documentId: string, id: string, data: { body?: string; isResolved?: boolean }) =>
		request<{ annotation: RawAnnotation }>
			(`/api/collections/${collectionId}/documents/${documentId}/annotations/${id}`,
				{ method: 'PATCH', token, body: JSON.stringify(data) })
			.then((res) => ({ annotation: normalizeAnnotation(res.annotation) })),

	remove: (token: string, collectionId: string, documentId: string, id: string) =>
		request(`/api/collections/${collectionId}/documents/${documentId}/annotations/${id}`,
			{ method: 'DELETE', token }),
};

// ─── Research ─────────────────────────────────────────────────────────────────

export const research = {
	metrics: (token: string) =>
		request<ResearchMetrics>
			('/api/research/metrics', { token }),

	history: (token: string, options: { type?: string; limit?: number } = {}) => {
		const params = new URLSearchParams();
		if (options.type) params.set('type', options.type);
		if (options.limit) params.set('limit', String(options.limit));
		const suffix = params.toString() ? `?${params.toString()}` : '';
		return request<{ runs: RawBenchmarkRun[] }>
			(`/api/research/benchmark/history${suffix}`, { token })
			.then((res) => ({ runs: res.runs.map(normalizeBenchmarkRun) }));
	},

	exportJson: (token: string, options: { limit?: number; includeRaw?: boolean; benchmarkType?: string } = {}) => {
		const params = new URLSearchParams({ format: 'json' });
		if (options.limit) params.set('limit', String(options.limit));
		if (options.includeRaw) params.set('includeRaw', 'true');
		if (options.benchmarkType) params.set('benchmarkType', options.benchmarkType);
		return request<{
			benchmarkRuns: RawBenchmarkRun[];
			benchmarkRunCount: number;
			groundTruthPairs: unknown[];
			llmLogs: unknown[] | string;
			note: string;
		}>(`/api/research/export?${params.toString()}`, { token });
	},

	exportCsv: async (token: string, options: { benchmarkType?: string } = {}) => {
		const params = new URLSearchParams({ format: 'csv' });
		if (options.benchmarkType) params.set('benchmarkType', options.benchmarkType);
		const res = await fetchWithAuthRetry(`${BASE}/api/research/export?${params.toString()}`, {
			token,
		});
		if (!res.ok) {
			const body = await res.json().catch(() => ({ error: 'Export failed' }));
			throw new APIError(res.status, body.error ?? 'Export failed');
		}
		return res.blob();
	},
};

// ─── Health ───────────────────────────────────────────────────────────────────

export const health = {
	check: () => request<HealthStatus>('/health'),
};

export { APIError };
