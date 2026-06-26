import { stringify } from 'csv-stringify';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { config } from '../config';
import { db } from '../db/pool';
import { logger } from '../lib/logger';
import { redis } from '../redis/client';

const COLLECTION_ID = process.env.SEED_COLLECTION_ID
	?? (() => { throw new Error('SEED_COLLECTION_ID env var required'); })();
const OUTPUT_FILE = `${config.GROUND_TRUTH_DIR}/candidate_pairs.csv`;

async function main() {
	mkdirSync(config.GROUND_TRUTH_DIR, { recursive: true });
	if (existsSync(OUTPUT_FILE) && !process.argv.includes('--overwrite')) {
		throw new Error(
			`Output file already exists: ${OUTPUT_FILE}. To discard existing labels and regenerate it, run npm run label:pairs:regenerate.`
		);
	}

	const { rows: docs } = await db.query(
		`SELECT id, filename, doc_type, source, effective_date
     FROM documents WHERE collection_id = $1 AND status = 'ready'
     ORDER BY source, effective_date`,
		[COLLECTION_ID]
	);

	logger.info({ docCount: docs.length }, 'Generating candidate pairs');

	const out = createWriteStream(OUTPUT_FILE);
	const csvStream = stringify({
		header: true, columns: [
			'doc_a_filename', 'doc_b_filename',
			'doc_a_source', 'doc_b_source',
			'doc_a_type', 'doc_b_type',
			'contradiction_type', 'severity',
			'claim_a_snippet', 'claim_b_snippet',
			'section_a', 'section_b',
			'is_contradiction', 'labeler_note',
		]
	});
	csvStream.pipe(out);

	let pairCount = 0;
	for (let i = 0; i < docs.length; i++) {
		for (let j = i + 1; j < docs.length; j++) {
			const a = docs[i];
			const b = docs[j];

			if (a.id === b.id) continue;

			const crossSource = a.source !== b.source;
			const sameSourceDifferentDate =
				a.source === b.source && a.effective_date !== b.effective_date;

			if (!crossSource && !sameSourceDifferentDate) continue;

			csvStream.write({
				doc_a_filename: a.filename,
				doc_b_filename: b.filename,
				doc_a_source: a.source,
				doc_b_source: b.source,
				doc_a_type: a.doc_type,
				doc_b_type: b.doc_type,
				contradiction_type: '',
				severity: '',
				claim_a_snippet: '',
				claim_b_snippet: '',
				section_a: '',
				section_b: '',
				is_contradiction: '',
				labeler_note: '',
			});
			pairCount++;
		}
	}

	csvStream.end();
	await new Promise(r => out.on('finish', r));
	logger.info({ pairCount, output: OUTPUT_FILE }, 'Candidate pairs written — label manually then run import:ground-truth');

	await db.end();
	await redis.quit();
}

main().catch(err => { logger.error(err); process.exit(1); });
