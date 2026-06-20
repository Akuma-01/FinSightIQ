import { db } from '../db/pool';
import { llmCall } from '../lib/llm/llm.client';
import { buildPrompt } from '../lib/llm/prompt.builder';
import { logger } from '../lib/logger';
import { AppError } from '../middleware/error.middleware';

interface SummaryDocument {
	id: string;
	filename: string;
}

async function summarizeWithConcurrency(
	docs: SummaryDocument[],
	userId: string,
	limit = 3
): Promise<string[]> {
	const results: string[] = [];
	let skipped = 0;

	for (let i = 0; i < docs.length; i += limit) {
		const batch = docs.slice(i, i + limit);
		const settled = await Promise.allSettled(
			batch.map(async doc => {
				const { summary } = await summarizeDocument(doc.id, userId);
				return `${doc.filename}:\n${summary}`;
			})
		);

		settled.forEach((result, index) => {
			if (result.status === 'fulfilled') {
				results.push(result.value);
				return;
			}

			skipped++;
			logger.warn(
				{ err: result.reason, documentId: batch[index]?.id },
				'Skipping document in collection summary'
			);
		});
	}

	if (skipped > 0) {
		logger.info(
			{ skipped, total: docs.length },
			'Collection summary: some documents skipped'
		);
	}

	return results;
}

/** Single document summary */
export async function summarizeDocument(documentId: string, userId: string) {
	const docResult = await db.query(
		'SELECT filename, doc_type, source, effective_date FROM documents WHERE id = $1',
		[documentId]
	);
	if (!docResult.rows[0]) throw new AppError(404, 'Document not found');
	const doc = docResult.rows[0];

	// Top 8 chunks by position (regulatory context is position-dependent)
	const { rows: chunks } = await db.query(
		`SELECT chunk_text FROM chunks WHERE document_id = $1 ORDER BY chunk_index LIMIT 8`,
		[documentId]
	);

	if (!chunks.length) throw new AppError(409, 'Document has no chunks — ingestion may still be running');

	let content = chunks.map(c => c.chunk_text).join('\n\n');
	if (content.length > 18_000) {
		content = content.slice(0, 18_000);
		logger.debug({ documentId }, 'Summary: content truncated to token budget');
	}

	const { body, promptVersionId } = await buildPrompt('summarize_document', {
		doc_name: `${doc.filename} (${doc.doc_type}, ${doc.source}${doc.effective_date ? ', ' + doc.effective_date : ''})`,
		content,
	});

	const response = await llmCall({
		task: 'summarize_document',
		messages: [{ role: 'user', content: body }],
		userId,
		promptVersionId,
		maxTokens: 512,
		temperature: 0.2,
	});

	if (response.finishReason === 'error') {
		throw new AppError(502, `Summarization failed: ${response.error}`);
	}

	return { summary: response.content, tokensUsed: response.tokensUsed };
}

/** Collection summary  */
export async function summarizeCollection(collectionId: string, userId: string) {
	const { rows: docs } = await db.query(
		`SELECT id, filename, doc_type FROM documents
     WHERE collection_id = $1 AND status = 'ready'
     ORDER BY effective_date DESC NULLS LAST`,
		[collectionId]
	);

	if (!docs.length) throw new AppError(409, 'No ready documents in this collection');

	const colResult = await db.query('SELECT name FROM collections WHERE id = $1', [collectionId]);
	const collectionName = colResult.rows[0]?.name ?? 'Unknown';

	const docSummaries = await summarizeWithConcurrency(docs, userId, 3);

	if (!docSummaries.length) throw new AppError(409, 'Could not summarize any documents');

	let summaries = docSummaries.join('\n\n---\n\n');
	if (summaries.length > 28_000) {
		while (summaries.length > 28_000 && docSummaries.length > 1) {
			docSummaries.pop();
			summaries = docSummaries.join('\n\n---\n\n');
		}
		logger.debug({ collectionId, docsIncluded: docSummaries.length }, 'Collection summary: trimmed to token budget');
	}

	const { body, promptVersionId } = await buildPrompt('summarize_collection', {
		collection_name: collectionName,
		summaries,
	});

	const response = await llmCall({
		task: 'summarize_collection',
		messages: [{ role: 'user', content: body }],
		userId,
		promptVersionId,
		maxTokens: 768,
		temperature: 0.2,
	});

	if (response.finishReason === 'error') {
		throw new AppError(502, `Collection summarization failed: ${response.error}`);
	}

	return {
		summary: response.content,
		documentCount: docSummaries.length,
		tokensUsed: response.tokensUsed,
	};
}
