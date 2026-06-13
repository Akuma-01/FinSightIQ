import { z } from 'zod';
import { config } from '../config';
import { db } from '../db/pool';
import { llmCall } from '../lib/llm/llm.client';
import { buildPrompt } from '../lib/llm/prompt.builder';
import { logger } from '../lib/logger';
import { AppError } from '../middleware/error.middleware';
import { broadcastToRoom } from '../websocket/ws.rooms';

// ─── Zod schema for LLM structured output validation ─────────────────────────
const ContradictionItemSchema = z.object({
	contradiction_type: z.enum([
		'policy_conflict', 'regulatory_breach', 'numerical_discrepancy',
		'stale_reference', 'definitional_conflict',
	]),
	severity: z.enum(['critical', 'moderate', 'minor']),
	claim_a: z.string().min(1),
	claim_b: z.string().min(1),
	section_a: z.string().nullable().optional(),
	section_b: z.string().nullable().optional(),
	explanation: z.string().min(1),
});

const ContradictionsOutputSchema = z.object({
	contradictions: z.array(ContradictionItemSchema),
});

// ─── Retrieval helpers ───────────────────────────────────────────────────────
async function retrieveChunksForDocument(
	documentId: string,
	queryVector: number[],
	topN: number
): Promise<{ id: string; chunk_text: string; chunk_index: number }[]> {
	const vectorStr = `[${queryVector.join(',')}]`;

	const triggerTerms = config.KEYWORD_TRIGGER_TERMS.split(' ').join(' | ');

	const { rows } = await db.query(
		`WITH vector_leg AS (
       SELECT id, chunk_text, chunk_index,
              1 - (embedding <=> $2::vector) AS vector_score,
              0 AS keyword_score
       FROM chunks WHERE document_id = $1
       ORDER BY embedding <=> $2::vector LIMIT $3
     ),
     keyword_leg AS (
       SELECT id, chunk_text, chunk_index,
              0 AS vector_score,
              ts_rank(chunk_text_tsv, to_tsquery('english', $4)) AS keyword_score
       FROM chunks
       WHERE document_id = $1
         AND chunk_text_tsv @@ to_tsquery('english', $4)
       ORDER BY keyword_score DESC LIMIT 2
     ),
     combined AS (
       SELECT id, chunk_text, chunk_index,
              MAX(vector_score) + MAX(keyword_score) AS combined_score
       FROM (SELECT * FROM vector_leg UNION ALL SELECT * FROM keyword_leg) merged
       GROUP BY id, chunk_text, chunk_index
     )
     SELECT id, chunk_text, chunk_index
     FROM combined
     ORDER BY combined_score DESC
     LIMIT $3`,
		[documentId, vectorStr, topN, triggerTerms]
	);

	return rows;
}

async function getDocumentCentroid(documentId: string): Promise<number[]> {
	const { rows } = await db.query(
		`SELECT AVG(embedding::float[]) AS centroid
     FROM chunks WHERE document_id = $1`,
		[documentId]
	);

	if (!rows[0]?.centroid) throw new AppError(404, `No chunks found for document ${documentId}`);
	return rows[0].centroid as number[];
}

function cosineSimilarity(a: number[], b: number[]): number {
	const dot = a.reduce((s, v, i) => s + v * b[i], 0);
	const magA = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
	const magB = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
	return magA && magB ? dot / (magA * magB) : 0;
}

// ─── Core scan logic ─────────────────────────────────────────────────────────
async function scanDocumentPair(
	docA: { id: string; filename: string; doc_type: string; source: string; effective_date: string | null },
	docB: { id: string; filename: string; doc_type: string; source: string; effective_date: string | null },
	collectionId: string,
	userId: string
): Promise<number> {
	const log = logger.child({ docAId: docA.id, docBId: docB.id, collectionId });

	const centroidA = await getDocumentCentroid(docA.id);
	const centroidB = await getDocumentCentroid(docB.id);
	const similarity = cosineSimilarity(centroidA, centroidB);

	if (similarity < config.CONTRADICTION_PREFILTER_THRESHOLD) {
		log.debug({ similarity }, 'Pre-filter: pair discarded (low similarity)');
		return 0;
	}

	const { rows: existing } = await db.query(
		`SELECT 1 FROM contradictions
     WHERE collection_id = $1 AND doc_a_id = $2 AND doc_b_id = $3 LIMIT 1`,
		[collectionId, docA.id, docB.id]
	);
	if (existing.length > 0) {
		log.debug('Dedup check: pair already scanned — skipping');
		return 0;
	}

	const chunksA = await retrieveChunksForDocument(
		docA.id, centroidB, config.CONTRADICTION_TOP_CHUNKS
	);
	const chunksB = await retrieveChunksForDocument(
		docB.id, centroidA, config.CONTRADICTION_TOP_CHUNKS
	);

	if (!chunksA.length || !chunksB.length) {
		log.warn('One or both documents have no chunks — skipping pair');
		return 0;
	}

	const contextA = chunksA.map(c => `[§${c.chunk_index}] ${c.chunk_text}`).join('\n\n');
	const contextB = chunksB.map(c => `[§${c.chunk_index}] ${c.chunk_text}`).join('\n\n');

	const { body, promptVersionId } = await buildPrompt('detect_contradictions_financial', {
		doc_a_name: `${docA.filename} (${docA.doc_type}, ${docA.source}${docA.effective_date ? ', ' + docA.effective_date : ''})`,
		doc_b_name: `${docB.filename} (${docB.doc_type}, ${docB.source}${docB.effective_date ? ', ' + docB.effective_date : ''})`,
		chunks_a: contextA,
		chunks_b: contextB,
	});

	const response = await llmCall({
		task: 'detect_contradictions_financial',
		messages: [{ role: 'user', content: body }],
		userId,
		promptVersionId,
		maxTokens: 2_048,
		temperature: 0.1,
	});

	if (response.finishReason === 'error' || !response.structured) {
		log.error({ error: response.error }, 'LLM call failed for contradiction scan');
		return 0;
	}

	const parsed = ContradictionsOutputSchema.safeParse(response.structured);
	if (!parsed.success) {
		log.warn({ zod: parsed.error.flatten() }, 'LLM output failed Zod validation — skipping');
		return 0;
	}

	let stored = 0;
	for (const c of parsed.data.contradictions) {
		try {
			const { rows } = await db.query(
				`INSERT INTO contradictions
           (collection_id, doc_a_id, doc_b_id, contradiction_type, severity,
            claim_a, claim_b, section_a, section_b, explanation, detected_by_model)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT ON CONSTRAINT uq_contradiction_per_section DO NOTHING
         RETURNING id`,
				[
					collectionId, docA.id, docB.id,
					c.contradiction_type, c.severity,
					c.claim_a, c.claim_b,
					c.section_a ?? null, c.section_b ?? null,
					c.explanation, response.model,
				]
			);

			if (rows[0]) {
				stored++;
				await broadcastToRoom(collectionId, 'contradiction:new', {
					id: rows[0].id,
					type: c.contradiction_type,
					severity: c.severity,
					claim_a: c.claim_a,
					claim_b: c.claim_b,
					section_a: c.section_a,
					section_b: c.section_b,
					explanation: c.explanation,
					docA: { id: docA.id, name: docA.filename },
					docB: { id: docB.id, name: docB.filename },
				});
			}
		} catch (err) {
			log.error({ err, contradictionType: c.contradiction_type }, 'Failed to insert contradiction');
		}
	}

	log.info({ similarity, stored }, 'Document pair scan complete');
	return stored;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function scanCollection(collectionId: string, userId: string) {
	const { rows: docs } = await db.query(
		`SELECT id, filename, doc_type, source, effective_date
     FROM documents WHERE collection_id = $1 AND status = 'ready'`,
		[collectionId]
	);

	if (docs.length < 2) throw new AppError(409, 'Collection needs at least 2 ready documents to scan');

	await broadcastToRoom(collectionId, 'scan:started', { collectionId, documentCount: docs.length });

	let totalStored = 0;

	for (let i = 0; i < docs.length; i++) {
		for (let j = i + 1; j < docs.length; j++) {
			totalStored += await scanDocumentPair(docs[i], docs[j], collectionId, userId);
		}
	}

	await broadcastToRoom(collectionId, 'scan:complete', { collectionId, newContradictions: totalStored });
	return { totalStored, documentCount: docs.length };
}

export async function scanDocumentPairTargeted(
	docIdA: string,
	docIdB: string,
	collectionId: string,
	userId: string
) {
	const { rows } = await db.query(
		`SELECT id, filename, doc_type, source, effective_date
     FROM documents WHERE id = ANY($1) AND status = 'ready'`,
		[[docIdA, docIdB]]
	);

	if (rows.length < 2) throw new AppError(404, 'One or both documents not found or not ready');

	const docA = rows.find(r => r.id === docIdA)!;
	const docB = rows.find(r => r.id === docIdB)!;

	await broadcastToRoom(collectionId, 'scan:started', { collectionId, documentCount: 2 });
	const stored = await scanDocumentPair(docA, docB, collectionId, userId);
	await broadcastToRoom(collectionId, 'scan:complete', { collectionId, newContradictions: stored });
	return { stored };
}

export async function listContradictions(collectionId: string) {
	const { rows } = await db.query(
		`SELECT ct.*, 
            da.filename AS doc_a_name, da.source AS doc_a_source,
            db.filename AS doc_b_name, db.source AS doc_b_source
     FROM contradictions ct
     JOIN documents da ON da.id = ct.doc_a_id
     JOIN documents db ON db.id = ct.doc_b_id
     WHERE ct.collection_id = $1
     ORDER BY ct.created_at DESC`,
		[collectionId]
	);
	return rows;
}

export async function resolveContradiction(id: string, resolvedBy: string) {
	const { rows } = await db.query(
		`UPDATE contradictions
     SET is_resolved = TRUE, resolved_by = $1, resolved_at = NOW()
     WHERE id = $2 RETURNING *`,
		[resolvedBy, id]
	);
	if (!rows[0]) throw new AppError(404, 'Contradiction not found');
	return rows[0];
}
