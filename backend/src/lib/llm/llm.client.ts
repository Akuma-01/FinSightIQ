import axios, { AxiosError } from 'axios';
import { config } from '../../config';
import { db } from '../../db/pool';
import { logger } from '../logger';
import { ModelConfig, TASK_MODEL_MAP } from './model.router';

export type FinSightTask =
	| 'detect_contradictions_financial'
	| 'summarize_document'
	| 'summarize_collection'
	| 'semantic_search'
	| 'classify_severity'
	| 'extract_references'
	| 'stale_check';

export interface LLMCallOptions {
	task: FinSightTask;
	messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
	userId?: string;
	promptVersionId?: string;
	modelOverride?: string;
	stream?: boolean;
	maxTokens?: number;
	temperature?: number;
}

export interface FinSightResponse {
	model: string;
	task: FinSightTask;
	content: string;
	structured?: Record<string, unknown>;
	promptVersionId: string;
	tokensUsed: { prompt: number; completion: number; total: number };
	latencyMs: number;
	finishReason: 'stop' | 'length' | 'error';
	error?: string;
}

const groq = axios.create({
	baseURL: config.GROQ_BASE_URL,
	headers: {
		Authorization: `Bearer ${config.GROQ_API_KEY}`,
		'Content-Type': 'application/json',
	},
	timeout: 120_000,
});

async function sleep(ms: number) {
	return new Promise(r => setTimeout(r, ms));
}

export async function llmCall(opts: LLMCallOptions): Promise<FinSightResponse> {
	const modelKey = TASK_MODEL_MAP[opts.task] ?? 'heavy';
	const model = opts.modelOverride ?? ModelConfig[modelKey];
	const startMs = Date.now();

	let lastError: string | undefined;
	let attempt = 0;

	while (attempt < config.LLM_MAX_RETRIES) {
		try {
			const { data } = await groq.post('/chat/completions', {
				model,
				messages: opts.messages,
				max_tokens: opts.maxTokens ?? 1_024,
				temperature: opts.temperature ?? 0.1,
				stream: false,
			});

			const choice = data.choices[0];
			const content = choice.message.content as string;
			const latency = Date.now() - startMs;

			const response: FinSightResponse = {
				model,
				task: opts.task,
				content,
				promptVersionId: opts.promptVersionId ?? '',
				tokensUsed: {
					prompt: data.usage.prompt_tokens,
					completion: data.usage.completion_tokens,
					total: data.usage.total_tokens,
				},
				latencyMs: latency,
				finishReason: choice.finish_reason === 'stop' ? 'stop' : 'length',
			};

			// Try to parse JSON for structured tasks
			if (isStructuredTask(opts.task)) {
				try {
					response.structured = JSON.parse(content);
				} catch {
					logger.warn({ task: opts.task, contentSnippet: content.slice(0, 200) },
						'LLM returned non-JSON for structured task');
				}
			}

			await logLLMCall(opts, response, model);
			return response;

		} catch (err) {
			attempt++;
			const isRateLimit = (err as AxiosError)?.response?.status === 429;
			const delay = config.LLM_RETRY_DELAY_MS * Math.pow(2, attempt - 1);

			lastError = (err as Error).message;
			logger.warn(
				{ attempt, task: opts.task, isRateLimit, delay },
				`LLM call failed — retrying in ${delay}ms`
			);

			if (attempt < config.LLM_MAX_RETRIES) await sleep(delay);
		}
	}


	const errorResponse: FinSightResponse = {
		model,
		task: opts.task,
		content: '',
		promptVersionId: opts.promptVersionId ?? '',
		tokensUsed: { prompt: 0, completion: 0, total: 0 },
		latencyMs: Date.now() - startMs,
		finishReason: 'error',
		error: lastError,
	};

	await logLLMCall(opts, errorResponse, model);
	return errorResponse;
}

function isStructuredTask(task: FinSightTask): boolean {
	return ['detect_contradictions_financial', 'extract_references', 'stale_check'].includes(task);
}

async function logLLMCall(
	opts: LLMCallOptions,
	response: FinSightResponse,
	model: string
): Promise<void> {
	try {
		const userContent = opts.messages.find(m => m.role === 'user')?.content ?? '';
		const fullResponse = response.content;

		const truncated = fullResponse.length > 4_000;
		const storedResp = truncated ? fullResponse.slice(0, 4_000) : fullResponse;

		await db.query(
			`INSERT INTO llm_logs
         (user_id, endpoint, task, prompt_version_id, prompt, response,
          response_truncated, model, prompt_tokens, completion_tokens,
          latency_ms, finish_reason, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
			[
				opts.userId ?? null,
				opts.task,
				opts.task,
				opts.promptVersionId ?? null,
				userContent.slice(0, 8_000),
				storedResp,
				truncated,
				model,
				response.tokensUsed.prompt,
				response.tokensUsed.completion,
				response.latencyMs,
				response.finishReason,
				response.error ?? null,
			]
		);
	} catch (logErr) {
		logger.error({ logErr }, 'Failed to write to llm_logs');
	}
}
