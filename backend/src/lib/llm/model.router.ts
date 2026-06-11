import { config } from '../../config';


export const ModelConfig = {
	heavy: config.GROQ_MODEL_HEAVY,
	mid: config.GROQ_MODEL_MID,
	fast: config.GROQ_MODEL_FAST,
} as const;

export type ModelKey = keyof typeof ModelConfig;

export const TASK_MODEL_MAP: Record<string, ModelKey> = {
	detect_contradictions_financial: 'heavy',
	summarize_document: 'heavy',
	summarize_collection: 'mid',
	semantic_search: 'heavy',
	classify_severity: 'fast',
	extract_references: 'fast',
	stale_check: 'fast',
};
