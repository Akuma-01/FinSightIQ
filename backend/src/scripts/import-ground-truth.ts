import { readFileSync } from 'fs';
import Papa from 'papaparse';
import { config } from '../config';
import { db } from '../db/pool';
import { logger } from '../lib/logger';
import { redis } from '../redis/client';

const INPUT_FILE = process.env.GROUND_TRUTH_FILE
	?? `${config.GROUND_TRUTH_DIR}/labeled_pairs.csv`;
const DRY_RUN = process.argv.includes('--dry-run');

interface LabeledRow {
	doc_a_filename: string;
	doc_b_filename: string;
	contradiction_type: string;
	severity: string;
	claim_a_snippet: string;
	claim_b_snippet: string;
	section_a: string;
	section_b: string;
	is_contradiction: string;
	labeler_note: string;
}

async function main() {
	const csv = readFileSync(INPUT_FILE, 'utf8');
	const { data } = Papa.parse<LabeledRow>(csv, { header: true, skipEmptyLines: true });

	const labeled = data.filter(r => r.is_contradiction === 'true');
	const negatives = data.filter(r => r.is_contradiction === 'false');

	logger.info({ total: data.length, positives: labeled.length, negatives: negatives.length },
		'Parsed ground truth CSV');

	if (DRY_RUN) {
		logger.info('[DRY RUN] No DB writes made');
		await db.end();
		await redis.quit();
		return;
	}

	await db.query(`
    CREATE TABLE IF NOT EXISTS ground_truth_pairs (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      doc_a_filename      TEXT NOT NULL,
      doc_b_filename      TEXT NOT NULL,
      doc_a_id            UUID REFERENCES documents(id),
      doc_b_id            UUID REFERENCES documents(id),
      contradiction_type  TEXT,
      severity            TEXT,
      claim_a_snippet     TEXT,
      claim_b_snippet     TEXT,
      section_a           TEXT,
      section_b           TEXT,
      is_contradiction    BOOLEAN NOT NULL,
      labeler_note        TEXT,
      prompt_version_id   UUID REFERENCES prompt_templates(id),
      imported_at         TIMESTAMPTZ DEFAULT NOW()
    )
  `);

	const { rows: docs } = await db.query(
		'SELECT id, filename FROM documents WHERE status = $1',
		['ready']
	);
	const filenameToId = new Map(docs.map(d => [d.filename, d.id]));

	const { rows: promptRows } = await db.query(
		`SELECT id FROM prompt_templates
     WHERE task = 'detect_contradictions_financial' AND is_active = TRUE
     ORDER BY version DESC LIMIT 1`
	);
	const promptVersionId = promptRows[0]?.id ?? null;

	let imported = 0;
	let skipped = 0;

	for (const row of data) {
		const docAId = filenameToId.get(row.doc_a_filename);
		const docBId = filenameToId.get(row.doc_b_filename);

		if (!docAId || !docBId) {
			logger.warn({ a: row.doc_a_filename, b: row.doc_b_filename },
				'Document not found in DB — skipping row');
			skipped++;
			continue;
		}

		await db.query(
			`INSERT INTO ground_truth_pairs
         (doc_a_filename, doc_b_filename, doc_a_id, doc_b_id,
          contradiction_type, severity, claim_a_snippet, claim_b_snippet,
          section_a, section_b, is_contradiction, labeler_note, prompt_version_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT DO NOTHING`,
			[
				row.doc_a_filename, row.doc_b_filename, docAId, docBId,
				row.contradiction_type || null,
				row.severity || null,
				row.claim_a_snippet || null,
				row.claim_b_snippet || null,
				row.section_a || null,
				row.section_b || null,
				row.is_contradiction === 'true',
				row.labeler_note || null,
				promptVersionId,
			]
		);
		imported++;
	}

	logger.info({ imported, skipped }, 'Ground truth import complete');
	await db.end();
	await redis.quit();
}

main().catch(err => { logger.error(err); process.exit(1); });
