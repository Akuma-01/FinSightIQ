import { readFileSync, statSync } from 'fs';
import Papa from 'papaparse';
import { config } from '../config';
import { db } from '../db/pool';
import { logger } from '../lib/logger';
import { redis } from '../redis/client';

const INPUT_FILE = process.env.GROUND_TRUTH_FILE
	?? `${config.GROUND_TRUTH_DIR}/labeled_pairs.csv`;
const DRY_RUN = process.argv.includes('--dry-run');
const MAX_CSV_SIZE_MB = 50;

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
	const sizeMB = statSync(INPUT_FILE).size / (1024 * 1024);
	if (sizeMB > MAX_CSV_SIZE_MB) {
		throw new Error(`CSV file exceeds ${MAX_CSV_SIZE_MB}MB limit: ${INPUT_FILE}`);
	}
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
		  imported_at         TIMESTAMPTZ DEFAULT NOW(),
		  CONSTRAINT uq_ground_truth_pair
			UNIQUE (doc_a_filename, doc_b_filename, contradiction_type, section_a, section_b, is_contradiction)
    )
  `);

	// Existing databases may have been initialized before the constraint was added.
	// Keep the oldest row for each duplicate key so the migration can be applied safely.
	await db.query(`
		DELETE FROM ground_truth_pairs older
		USING ground_truth_pairs newer
		WHERE older.ctid < newer.ctid
		  AND older.doc_a_filename = newer.doc_a_filename
		  AND older.doc_b_filename = newer.doc_b_filename
		  AND older.contradiction_type IS NOT DISTINCT FROM newer.contradiction_type
		  AND older.section_a IS NOT DISTINCT FROM newer.section_a
		  AND older.section_b IS NOT DISTINCT FROM newer.section_b
		  AND older.is_contradiction = newer.is_contradiction
	`);
	await db.query(`
		DO $$
		BEGIN
			IF EXISTS (
				SELECT 1
				FROM pg_constraint
				WHERE conname = 'uq_ground_truth_pair'
				  AND conrelid = 'ground_truth_pairs'::regclass
				  AND pg_get_constraintdef(oid) NOT LIKE '%contradiction_type%'
			) THEN
				ALTER TABLE ground_truth_pairs DROP CONSTRAINT uq_ground_truth_pair;
			END IF;

			IF NOT EXISTS (
				SELECT 1 FROM pg_constraint WHERE conname = 'uq_ground_truth_pair'
			) THEN
				ALTER TABLE ground_truth_pairs
					ADD CONSTRAINT uq_ground_truth_pair
					UNIQUE (doc_a_filename, doc_b_filename, contradiction_type, section_a, section_b, is_contradiction);
			END IF;
		END $$;
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

		const result = await db.query(
			`INSERT INTO ground_truth_pairs
         (doc_a_filename, doc_b_filename, doc_a_id, doc_b_id,
          contradiction_type, severity, claim_a_snippet, claim_b_snippet,
          section_a, section_b, is_contradiction, labeler_note, prompt_version_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
			ON CONFLICT ON CONSTRAINT uq_ground_truth_pair DO NOTHING`,
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
		if (result.rowCount) imported++;
		else {
			skipped++;
			logger.debug({ a: row.doc_a_filename, b: row.doc_b_filename }, 'Duplicate ground-truth row skipped');
		}
	}

	logger.info({ imported, skipped }, 'Ground truth import complete');
	await db.end();
	await redis.quit();
}

main().catch(err => { logger.error(err); process.exit(1); });
