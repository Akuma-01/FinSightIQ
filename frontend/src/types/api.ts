export type Role = 'admin' | 'analyst' | 'compliance_officer' | 'researcher';

export interface User {
	id: string;
	email: string;
	role: Role;
	displayName?: string;
}

export interface Collection {
	id: string;
	name: string;
	chunkingStrategy: string;
	archived: boolean;
	documentCount: number;
	createdAt: string;
	accessRole?: 'owner' | 'editor' | 'viewer';
}

export interface CollectionSummary {
	critical: number;
	moderate: number;
	minor: number;
	unresolved: number;
	total: number;
	stale: number;
}

export interface Document {
	id: string;
	filename: string;
	originalName?: string;
	mimeType: string;
	sizeBytes: number;
	status: 'processing' | 'ready' | 'failed';
	docType: string;
	source: string;
	effectiveDate: string | null;
	createdAt: string;
	rawText?: string | null;
	jobStatus?: string;
	failureReason?: string;
}

export type ContradictionType =
	| 'policy_conflict'
	| 'regulatory_breach'
	| 'numerical_discrepancy'
	| 'stale_reference'
	| 'definitional_conflict';

export interface Contradiction {
	id: string;
	contradictionType: ContradictionType;
	severity: 'critical' | 'moderate' | 'minor';
	claimA: string;
	claimB: string;
	sectionA: string | null;
	sectionB: string | null;
	explanation: string;
	isResolved: boolean;
	resolvedBy?: string;
	resolvedAt?: string;
	docAName: string;
	docBName: string;
	docAId: string;
	docBId: string;
	createdAt: string;
}

export interface Annotation {
	id: string;
	body: string;
	annotationType: 'comment' | 'flag' | 'question';
	isResolved: boolean;
	createdBy: string;
	authorName: string;
	chunkId?: string;
	createdAt: string;
	updatedAt: string;
}

export interface StaleReference {
	id: string;
	documentId: string;
	documentName: string;
	referencedIdentifier: string;
	referencedBody: string;
	currentIdentifier: string;
	isResolved: boolean;
	createdAt: string;
}

export interface BenchmarkRun {
	id: string;
	benchmarkType: string;
	promptVersionId: string;
	promptVersion?: number;
	promptTask?: string;
	parameters: Record<string, unknown>;
	metrics: Record<string, unknown>;
	totalSamples: number;
	notes: string;
	createdAt: string;
}

export interface ResearchMetrics {
	latestF1ByModel: Record<string, number>;
	benchmarkRunCount: number;
	recentLogStats: {
		task: string;
		model: string;
		avg_latency_ms?: number;
		avgLatencyMs?: number;
		avg_prompt_tokens?: number;
		avgPromptTokens?: number;
		avg_completion_tokens?: number;
		avgCompletionTokens?: number;
		call_count?: string | number;
		callCount?: string | number;
		error_count?: string | number;
		errorCount?: string | number;
	}[];
	chunkingResults: {
		strategy: string;
		f1: number;
		created_at?: string;
		createdAt?: string;
	}[];
}

export interface HealthStatus {
	status: string;
	db?: string;
	redis?: string;
	cleanup_worker?: string;
	ingest_worker?: string;
	edgar_worker?: string;
	scan_worker?: string;
	benchmark_worker?: string;
	ws_connections: number;
}
