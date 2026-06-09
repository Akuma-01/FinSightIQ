import axios from 'axios';
import * as cheerio from 'cheerio';
import { db } from '../db/pool';
import { logger } from '../lib/logger';
import { ingestQueue } from '../queue/ingest.queue';
import { redis } from '../redis/client';
import { saveFile } from '../services/storage.service';

const COLLECTION_ID = process.env.SEED_COLLECTION_ID
	?? (() => { throw new Error('SEED_COLLECTION_ID required'); })();
const DRY_RUN = process.argv.includes('--dry-run');
const MAX_PAGES = parseInt(process.env.MAX_PAGES ?? '5', 10);
const DELAY_MS = 1_000; // 1 req/sec — avoid IP block

const SEBI_INDEX_URL =
	'https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=1&ssid=0&smid=0&pageno=';

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
	logger.info({ dryRun: DRY_RUN, maxPages: MAX_PAGES }, 'seed-sebi starting');

	const colResult = await db.query(
		'SELECT chunking_strategy FROM collections WHERE id = $1',
		[COLLECTION_ID]
	);
	if (!colResult.rows[0]) throw new Error('Collection not found');
	const strategy = colResult.rows[0].chunking_strategy;

	let enqueued = 0;

	for (let page = 1; page <= MAX_PAGES; page++) {
		const url = SEBI_INDEX_URL + page;
		logger.info({ page, url }, 'Fetching SEBI index page');

		const { data: html } = await axios.get(url, {
			headers: { 'User-Agent': 'FinSightIQ research/1.0 contact@example.com' },
			timeout: 15_000,
		});

		const $ = cheerio.load(html);
		const rows: { number: string; date: string; subject: string; href: string }[] = [];


		$('table.table tr').each((_, tr) => {
			const cells = $(tr).find('td');
			if (cells.length < 3) return;

			const number = $(cells[0]).text().trim();
			const date = $(cells[1]).text().trim();
			const subject = $(cells[2]).text().trim();
			const link = $(cells[2]).find('a').attr('href') ?? $(cells[3]).find('a').attr('href') ?? '';

			if (number && link) rows.push({ number, date, subject, href: link });
		});

		logger.info({ page, rowCount: rows.length }, 'Parsed circular rows');

		for (const row of rows) {
			const pdfUrl = row.href.startsWith('http')
				? row.href
				: `https://www.sebi.gov.in${row.href}`;

			if (DRY_RUN) {
				logger.info({ number: row.number, date: row.date, pdfUrl }, '[DRY RUN] would download + enqueue');
				continue;
			}

			try {
				logger.debug({ pdfUrl }, 'Downloading SEBI circular PDF');
				const { data: pdfBuffer } = await axios.get(pdfUrl, {
					responseType: 'arraybuffer',
					headers: { 'User-Agent': 'FinSightIQ research/1.0 contact@example.com' },
					timeout: 30_000,
				});

				const filename = `SEBI_${row.number.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
				const stored = await saveFile(Buffer.from(pdfBuffer), filename, 'application/pdf');

				const { rows: docRows } = await db.query(
					`INSERT INTO documents
             (collection_id, filename, original_name, mime_type, size_bytes,
              local_path, storage_key, status, doc_type, source,
              source_identifier, effective_date, uploaded_by)
           VALUES ($1,$2,$2,'application/pdf',$3,$4,$5,'processing',
                   'regulatory_circular','SEBI',$6,$7,'seed-sebi')
           RETURNING id`,
					[COLLECTION_ID, filename, stored.sizeBytes, stored.localPath, stored.storageKey,
						row.number, row.date || null]
				);
				const documentId = docRows[0].id;

				const jobRow = await db.query(
					`INSERT INTO document_ingestion_jobs (document_id, collection_id, status, attempt_number)
           VALUES ($1,$2,'queued',0) RETURNING id`,
					[documentId, COLLECTION_ID]
				);

				await ingestQueue.add('ingest-document', {
					documentId,
					collectionId: COLLECTION_ID,
					jobId: jobRow.rows[0].id,
					storageKey: stored.storageKey,
					localPath: stored.localPath,
					chunkingStrategy: strategy,
				});

				enqueued++;
				logger.info({ number: row.number, documentId }, 'Circular queued for ingestion');
			} catch (err) {
				logger.error({ err, number: row.number, pdfUrl }, 'Failed to download SEBI circular — skipping');
			}

			await sleep(DELAY_MS);
		}
	}

	logger.info({ enqueued }, 'seed-sebi complete');
	await db.end();
	await redis.quit();
}

main().catch(err => { logger.error(err); process.exit(1); });
