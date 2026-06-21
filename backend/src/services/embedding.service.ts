import axios from 'axios';
import { config } from '../config';
import { logger } from '../lib/logger';
import { AppError } from '../middleware/error.middleware';

const BATCH_SIZE = config.EMBEDDING_BATCH_SIZE;

// ─── Provider adapters ────────────────────────────────────────────────────

async function embedWithGroq(texts: string[]): Promise<number[][]> {
	const response = await axios.post(
		'https://api.groq.com/openai/v1/embeddings',
		{ model: 'nomic-embed-text', input: texts },
		{
			headers: { Authorization: `Bearer ${config.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
			timeout: 30_000,
		}
	);
	return (response.data.data as { embedding: number[] }[]).map(d => d.embedding);
}

async function embedWithHuggingFace(texts: string[]): Promise<number[][]> {
	const response = await axios.post(
		'https://api-inference.huggingface.co/models/nomic-ai/nomic-embed-text-v1',
		{ inputs: texts },
		{
			headers: { Authorization: `Bearer ${config.HUGGINGFACE_API_KEY}` },
			timeout: 60_000,
		}
	);
	return response.data as number[][];
}

async function embedWithOllama(texts: string[]): Promise<number[][]> {
	const vectors: number[][] = [];
	for (const text of texts) {
		const response = await axios.post(`${config.OLLAMA_BASE_URL}/api/embeddings`, {
			model: 'nomic-embed-text',
			prompt: text,
		}, { timeout: 120_000 });
		vectors.push(response.data.embedding);
	}
	return vectors;
}

// ─── Provider selection ──────────────────────────────────────────────────────

async function embedBatch(texts: string[]): Promise<number[][]> {
	const provider = config.EMBEDDING_PROVIDER;

	const providers: {
		name: 'groq' | 'huggingface' | 'ollama';
		available: boolean;
		embed: () => Promise<number[][]>;
	}[] = provider === 'groq'
		? [
			{ name: 'groq', available: Boolean(config.GROQ_API_KEY), embed: () => embedWithGroq(texts) },
			{
				name: 'huggingface',
				available: Boolean(config.HUGGINGFACE_API_KEY),
				embed: () => embedWithHuggingFace(texts),
			},
			{ name: 'ollama', available: true, embed: () => embedWithOllama(texts) },
		]
		: provider === 'huggingface'
			? [
				{
					name: 'huggingface',
					available: Boolean(config.HUGGINGFACE_API_KEY),
					embed: () => embedWithHuggingFace(texts),
				},
				{ name: 'ollama', available: true, embed: () => embedWithOllama(texts) },
			]
			: [{ name: 'ollama', available: true, embed: () => embedWithOllama(texts) }];

	let lastError: unknown;
	for (const candidate of providers) {
		if (!candidate.available) {
			logger.warn(
				{ provider: candidate.name },
				'Embedding provider unavailable — trying next configured fallback'
			);
			continue;
		}

		try {
			return await candidate.embed();
		} catch (err) {
			lastError = err;
			logger.warn(
				{ err, provider: candidate.name },
				'Embedding provider failed — trying next configured fallback'
			);
		}
	}

	throw lastError ?? new AppError(500, 'No embedding provider is available');
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function embedTexts(texts: string[]): Promise<number[][]> {
	if (texts.length === 0) return [];

	const results: number[][] = [];

	for (let i = 0; i < texts.length; i += BATCH_SIZE) {
		const batch = texts.slice(i, i + BATCH_SIZE);
		logger.debug({ batchStart: i, batchSize: batch.length }, 'Embedding batch');
		const vectors = await embedBatch(batch);
		results.push(...vectors);
	}

	if (results.some(v => v.length !== 768)) {
		throw new AppError(500, 'Embedding provider returned unexpected dimension — expected 768');
	}

	return results;
}
