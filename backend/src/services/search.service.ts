import { config } from '../config';
import { db } from '../db/pool';
import { llmCall } from '../lib/llm/llm.client';
import { buildPrompt } from '../lib/llm/prompt.builder';
import { embedTexts } from './embedding.service';

export interface SearchResult {
	answer: string;
	sources: { chunkId: string; documentName: string; chunkIndex: number; snippet: string }[];
	tokensUsed: { prompt: number; completion: number; total: number };
	latencyMs: number;
}

export async function semanticSearch(
	collectionId: string,
	query: string,
	userId: string
): Promise<SearchResult> {
	const startMs = Date.now();
	const safeQuery = query.trim().slice(0, 500);
	const useKeyword = safeQuery.split(/\s+/).filter(word => word.length >= 3).length >= 2;

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
			`WITH vector_leg AS (
       SELECT c.id, c.chunk_text, c.chunk_index, d.filename,
              1 - (c.embedding <=> $1::vector) AS vector_score, 0 AS keyword_score
       FROM chunks c
       JOIN documents d ON d.id = c.document_id
       WHERE c.collection_id = $2
         AND 1 - (c.embedding <=> $1::vector) >= $3
       ORDER BY c.embedding <=> $1::vector LIMIT 8
     ),
     keyword_leg AS (
       SELECT c.id, c.chunk_text, c.chunk_index, d.filename,
              0 AS vector_score,
              ts_rank(c.chunk_text_tsv, plainto_tsquery('english', $4)) AS keyword_score
       FROM chunks c
       JOIN documents d ON d.id = c.document_id
       WHERE c.collection_id = $2
         AND chunk_text_tsv @@ plainto_tsquery('english', $4)
       ORDER BY keyword_score DESC LIMIT 4
     ),
     combined AS (
       SELECT id, chunk_text, chunk_index, filename,
              MAX(vector_score) + MAX(keyword_score) AS combined_score
       FROM (SELECT * FROM vector_leg UNION ALL SELECT * FROM keyword_leg) merged
       GROUP BY id, chunk_text, chunk_index, filename
     )
     SELECT id, chunk_text, chunk_index, filename
     FROM combined ORDER BY combined_score DESC LIMIT 8`,
			[vectorStr, collectionId, config.RAG_SIMILARITY_THRESHOLD, safeQuery]
		);
		chunks = rows;
	} else {
		const { rows } = await db.query(
			`SELECT c.id, c.chunk_text, c.chunk_index, d.filename
	     FROM chunks c
	     JOIN documents d ON d.id = c.document_id
	     WHERE c.collection_id = $1
	       AND 1 - (c.embedding <=> $2::vector) >= $3
	     ORDER BY c.embedding <=> $2::vector
	     LIMIT 8`,
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

	const response = await llmCall({
		task: 'semantic_search',
		messages: [{ role: 'user', content: body }],
		userId,
		promptVersionId,
		maxTokens: 512,
	});

	return {
		answer: response.content,
		sources: chunks.map(c => ({
			chunkId: c.id,
			documentName: c.filename,
			chunkIndex: c.chunk_index,
			snippet: c.chunk_text.slice(0, 200),
		})),
		tokensUsed: response.tokensUsed,
		latencyMs: Date.now() - startMs,
	};
}
