import { db } from '../pool';
import { logger } from '../../lib/logger';

const templates = [
	{
		task: 'detect_contradictions_financial',
		version: 1,
		description: 'v1 — initial financial contradiction detection prompt',
		body: `You are a financial regulatory compliance analyst. You are given two document excerpts.
Identify any contradictions between them.

Document A ({{doc_a_name}}):
{{chunks_a}}

Document B ({{doc_b_name}}):
{{chunks_b}}

Contradiction types:
- policy_conflict: internal policy directly contradicts a regulation
- regulatory_breach: document proposes an action prohibited by regulation
- numerical_discrepancy: same metric cited with different values
- stale_reference: document references a superseded regulatory version
- definitional_conflict: same term defined differently across documents

Return ONLY one valid JSON object. Do not use markdown fences. Do not explain outside JSON.
Return at most 3 contradictions. Only include contradictions supported by quoted text from both documents.
If no contradictions exist, return exactly:
{
  "contradictions": []
}

If contradictions exist, return this exact object shape:
{
  "contradictions": [
    {
      "contradiction_type": "<type>",
      "severity": "critical" | "moderate" | "minor",
      "claim_a": "<exact text from Document A>",
      "claim_b": "<exact text from Document B>",
      "section_a": "<section label in Document A, or null>",
      "section_b": "<section label in Document B, or null>",
      "explanation": "<1-2 sentences explaining the contradiction>"
    }
  ]
}
Valid JSON object only. No preamble.`,
	},
	{
		task: 'summarize_document',
		version: 1,
		description: 'v1 — single document summary',
		body: `You are a financial compliance analyst. Summarize the following document in 3-5 sentences.
Focus on: regulatory scope, key obligations or prohibitions, effective dates, issuing body.

Document ({{doc_name}}):
{{content}}

Plain text only. No bullet points.`,
	},
	{
		task: 'summarize_collection',
		version: 1,
		description: 'v1 — map-reduce collection summary',
		body: `You are summarizing a collection of financial regulatory documents.
Individual document summaries from collection "{{collection_name}}":

{{summaries}}

Write a 4-6 sentence executive summary covering: regulatory bodies involved, main compliance themes,
notable conflicts or gaps, and the time range if apparent.`,
	},
	{
		task: 'semantic_search',
		version: 1,
		description: 'v1 — RAG answer synthesis from retrieved chunks',
		body: `You are a financial compliance assistant. Answer the query using only the provided excerpts.
If the excerpts are insufficient, say exactly: "Insufficient context in the current collection."

Query: {{query}}

Excerpts:
{{chunks}}

Cite source document and section for each claim. 2-4 sentences.`,
	},
	{
		task: 'classify_severity',
		version: 1,
		description: 'v1 — severity classification for a detected contradiction',
		body: `Classify the severity of this financial regulatory contradiction.

Type: {{contradiction_type}}
Claim A: {{claim_a}}
Claim B: {{claim_b}}
Explanation: {{explanation}}

Severity levels:
- critical: direct regulatory breach, material discrepancy > 5%, or imminent legal risk
- moderate: policy misalignment requiring correction within 30 days
- minor: definitional inconsistency or outdated reference with no immediate legal impact

Respond with exactly one word: critical, moderate, or minor.`,
	},
	{
		task: 'extract_references',
		version: 1,
		description: 'v1 — extract regulatory references for stale reference detection',
		body: `Extract all regulatory document references from this text.
A reference is any mention of a circular, directive, master direction, act, or regulatory document
by name, number, or date.

Text:
{{chunk_text}}

Respond with a JSON array:
[{
  "referenced_identifier": "<circular number or unique ID>",
  "referenced_body": "<e.g. RBI, SEBI, SEC, FINRA>",
  "context": "<sentence containing the reference>"
}]

If none found: []
Valid JSON only.`,
	},
	{
		task: 'stale_check',
		version: 1,
		description: 'v1 — check if a referenced regulatory document is superseded',
		body: `Check whether this regulatory reference is current.

Referenced: {{referenced_identifier}} issued by {{referenced_body}}
Most recent in corpus: {{current_identifier}} dated {{current_date}}

Is the referenced document superseded?
Respond with JSON:
{
  "is_stale": true | false,
  "reason": "<one sentence>"
}
Valid JSON only.`,
	},
];

async function seed() {
	for (const t of templates) {
		await db.query(
			`INSERT INTO prompt_templates (task, version, body, description, is_active)
       VALUES ($1, $2, $3, $4, TRUE)
       ON CONFLICT (task, version) DO NOTHING`,
			[t.task, t.version, t.body, t.description]
		);
		logger.info({ task: t.task, version: t.version }, 'Prompt template seeded');
	}
	await db.end();
	logger.info('Prompt templates seeded');
}

seed().catch((err) => { logger.error({ err }, 'Prompt template seed failed'); process.exit(1); });
