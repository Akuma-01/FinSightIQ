import type { ContradictionType, Role } from '@/types/api';

export function humanize(value: string | null | undefined): string {
	if (!value) return '—';
	return value
		.replace(/_/g, ' ')
		.replace(/\b\w/g, (char) => char.toUpperCase());
}

const CONTRADICTION_TYPE_LABELS: Record<ContradictionType, string> = {
	policy_conflict: 'Conflicting policy',
	regulatory_breach: 'Regulatory breach',
	numerical_discrepancy: 'Conflicting numbers',
	stale_reference: 'Outdated reference',
	definitional_conflict: 'Conflicting definition',
};

export function contradictionTypeLabel(type: string | null | undefined): string {
	if (!type) return '—';
	return CONTRADICTION_TYPE_LABELS[type as ContradictionType] ?? humanize(type);
}

const ROLE_LABELS: Record<Role, string> = {
	admin: 'Admin',
	analyst: 'Analyst',
	compliance_officer: 'Compliance officer',
	researcher: 'Researcher',
};

export function roleLabel(role: string | null | undefined): string {
	if (!role) return '—';
	return ROLE_LABELS[role as Role] ?? humanize(role);
}

const CHUNKING_STRATEGY_LABELS: Record<string, string> = {
	section_aware: 'Section aware',
	sentence: 'Sentence',
	fixed_512: 'Fixed · 512 tokens',
	fixed_256: 'Fixed · 256 tokens',
};

export function chunkingStrategyLabel(value: string | null | undefined): string {
	if (!value) return '—';
	return CHUNKING_STRATEGY_LABELS[value] ?? humanize(value);
}

const BENCHMARK_TYPE_LABELS: Record<string, string> = {
	chunking_strategy: 'Chunking strategy',
	model_comparison: 'Model comparison',
	hallucination: 'Hallucination',
	prompt_sensitivity: 'Prompt sensitivity',
};

export function benchmarkTypeLabel(value: string | null | undefined): string {
	if (!value) return '—';
	return BENCHMARK_TYPE_LABELS[value] ?? humanize(value);
}

/** Options for the (now advanced-only) chunking strategy selector. */
export const CHUNKING_STRATEGY_OPTIONS = [
	'section_aware',
	'sentence',
	'fixed_512',
	'fixed_256',
] as const;
