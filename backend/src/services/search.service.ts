import { config } from '../config';
import { db } from '../db/pool';
import { llmCall } from '../lib/llm/llm.client';
import { logger } from '../lib/logger';
import { buildPrompt } from '../lib/llm/prompt.builder';
import { embedTexts } from './embedding.service';

export interface SearchResult {
	answer: string;
	sources: { chunkId: string; documentName: string; chunkIndex: number; snippet: string }[];
	tokensUsed: { prompt: number; completion: number; total: number };
	latencyMs: number;
}

export const RAG_VECTOR_LIMIT = 3;
export const RAG_KEYWORD_LIMIT = 2;
export const RAG_FINAL_LIMIT_PER_DOCUMENT = 5;
const RAG_LLM_TIMEOUT_MS = 25_000;

export function shouldUseKeywordSearch(query: string): boolean {
	const keywordTerms = query.match(/[a-zA-Z0-9]+/g) ?? [];
	return keywordTerms.filter(word => word.length > 3).length >= 2;
}

function extractiveFallbackAnswer(
	query: string,
	chunks: { chunk_text: string; chunk_index: number; filename: string }[]
) {
	const excerpts = chunks.slice(0, 4).map((chunk, index) => {
		const clean = chunk.chunk_text.replace(/\s+/g, ' ').trim().slice(0, 450);
		return `${index + 1}. ${chunk.filename} §${chunk.chunk_index}: ${clean}`;
	});

	return [
		`The semantic search found ${chunks.length} relevant source chunk(s) for: "${query}".`,
		'The local LLM answer generation did not finish quickly enough, so this response is an extractive fallback from the retrieved pgvector/BM25 sources:',
		'',
		...excerpts,
	].join('\n');
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
	});

	try {
		return await Promise.race([promise, timeout]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

export async function semanticSearch(
	collectionId: string,
	query: string,
	userId: string
): Promise<SearchResult> {
	const startMs = Date.now();
	const safeQuery = query.trim().slice(0, 500);
	const useKeyword = shouldUseKeywordSearch(safeQuery);

	const [queryVector] = await embedTexts([safeQuery]);
	const vectorStr = `[${queryVector.join(',')}]`;

	let chunks: {
		id: string;
		chunk_text: string;
		chunk_index: number;
		filename: string;
	}[];

	if (useKeyword) {
		const { rows } = await db.query(
			`WITH collection_docs AS (
       SELECT id, filename
       FROM documents
       WHERE collection_id = $2 AND status = 'ready'
     ),
     vector_leg AS (
       SELECT d.id AS document_id, d.filename,
              ranked.id, ranked.chunk_text, ranked.chunk_index,
              ranked.vector_score, 0::real AS keyword_score
       FROM collection_docs d
       CROSS JOIN LATERAL (
         SELECT c.id, c.chunk_text, c.chunk_index,
                1 - (c.embedding <=> $1::vector) AS vector_score
         FROM chunks c
         WHERE c.document_id = d.id
           AND 1 - (c.embedding <=> $1::vector) >= $3
         ORDER BY c.embedding <=> $1::vector
        LIMIT ${RAG_VECTOR_LIMIT}
       ) ranked
     ),
     keyword_leg AS (
       SELECT d.id AS document_id, d.filename,
              ranked.id, ranked.chunk_text, ranked.chunk_index,
              0::real AS vector_score, ranked.keyword_score
       FROM collection_docs d
       CROSS JOIN LATERAL (
         SELECT c.id, c.chunk_text, c.chunk_index,
                ts_rank(c.chunk_text_tsv, plainto_tsquery('english', $4)) AS keyword_score
         FROM chunks c
         WHERE c.document_id = d.id
           AND c.chunk_text_tsv @@ plainto_tsquery('english', $4)
         ORDER BY keyword_score DESC
        LIMIT ${RAG_KEYWORD_LIMIT}
       ) ranked
     ),
     combined AS (
       SELECT document_id, id, chunk_text, chunk_index, filename,
              MAX(vector_score) + MAX(keyword_score) AS combined_score
       FROM (SELECT * FROM vector_leg UNION ALL SELECT * FROM keyword_leg) merged
       GROUP BY document_id, id, chunk_text, chunk_index, filename
     ),
     ranked AS (
       SELECT *,
              ROW_NUMBER() OVER (
                PARTITION BY document_id
                ORDER BY combined_score DESC, chunk_index ASC
              ) AS document_rank
       FROM combined
     )
     SELECT id, chunk_text, chunk_index, filename
     FROM ranked
      WHERE document_rank <= ${RAG_FINAL_LIMIT_PER_DOCUMENT}
     ORDER BY filename, document_rank`,
			[vectorStr, collectionId, config.RAG_SIMILARITY_THRESHOLD, safeQuery]
		);
		chunks = rows;
	} else {
		const { rows } = await db.query(
			`SELECT d.filename,
              ranked.id,
              ranked.chunk_text,
              ranked.chunk_index
	     FROM documents d
	     CROSS JOIN LATERAL (
	       SELECT c.id, c.chunk_text, c.chunk_index
	       FROM chunks c
	       WHERE c.document_id = d.id
	         AND 1 - (c.embedding <=> $2::vector) >= $3
	       ORDER BY c.embedding <=> $2::vector
      LIMIT ${RAG_FINAL_LIMIT_PER_DOCUMENT}
	     ) ranked
	     WHERE d.collection_id = $1
	       AND d.status = 'ready'
	     ORDER BY d.filename, ranked.chunk_index`,
			[collectionId, vectorStr, config.RAG_SIMILARITY_THRESHOLD]
		);
		chunks = rows;
	}

	if (!chunks.length) {
		return {
			answer: 'No relevant content found in this collection for your query.',
			sources: [],
			tokensUsed: { prompt: 0, completion: 0, total: 0 },
			latencyMs: Date.now() - startMs,
		};
	}

	const context = chunks
		.map((c, i) => `[${i + 1}] ${c.filename} §${c.chunk_index}:\n${c.chunk_text}`)
		.join('\n\n---\n\n');

	const { body, promptVersionId } = await buildPrompt('semantic_search', {
		query: safeQuery,
		chunks: context,
	});

	const response = await withTimeout(
		llmCall({
			task: 'semantic_search',
			messages: [{ role: 'user', content: body }],
			userId,
			promptVersionId,
			maxTokens: 512,
		}),
		RAG_LLM_TIMEOUT_MS,
		'Semantic search LLM answer'
	).catch((err) => {
		logger.warn({ err, collectionId, userId }, 'Semantic search LLM fallback activated');
		return null;
	});

	return {
		answer: response?.content || extractiveFallbackAnswer(safeQuery, chunks),
		sources: chunks.map(c => ({
			chunkId: c.id,
			documentName: c.filename,
			chunkIndex: c.chunk_index,
			snippet: c.chunk_text.slice(0, 200),
		})),
		tokensUsed: response?.tokensUsed ?? { prompt: 0, completion: 0, total: 0 },
		latencyMs: Date.now() - startMs,
	};
}
