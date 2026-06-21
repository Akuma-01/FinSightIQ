import axios from 'axios';
import { config } from '../config';
import { db } from '../db/pool';
import {
	parseSebiListingRows,
	parseSebiPdfUrl,
} from '../lib/regulatory/sebi.parser';
import { logger } from '../lib/logger';
import { ingestQueue } from '../queue/ingest.queue';
import { redis, redisSub } from '../redis/client';
import { saveFile } from '../services/storage.service';

const COLLECTION_ID = process.env.SEED_COLLECTION_ID
	?? (() => { throw new Error('SEED_COLLECTION_ID required'); })();
const DRY_RUN = process.argv.includes('--dry-run');
const MAX_PAGES = parseInt(process.env.MAX_PAGES ?? '5', 10);
const DELAY_MS = 1_000; // 1 req/sec — avoid IP block
const MAX_DOCS = process.env.MAX_DOCS ? parseInt(process.env.MAX_DOCS, 10) : null;

const SEBI_INDEX_URL =
	'https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=1&ssid=0&smid=0&pageno=';

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function assertHttpsUrl(url: string, context: string): string {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`${context}: invalid URL: ${url}`);
	}
	if (parsed.protocol !== 'https:') {
		throw new Error(`${context}: only HTTPS URLs are allowed, got: ${url}`);
	}
	return url;
}

async function main() {
	logger.info({ dryRun: DRY_RUN, maxPages: MAX_PAGES, maxDocs: MAX_DOCS }, 'seed-sebi starting');

	const colResult = await db.query(
		'SELECT chunking_strategy FROM collections WHERE id = $1',
		[COLLECTION_ID]
	);
	if (!colResult.rows[0]) throw new Error('Collection not found');
	const strategy = colResult.rows[0].chunking_strategy;

	let enqueued = 0;

	for (let page = 1; page <= MAX_PAGES; page++) {
		const url = assertHttpsUrl(SEBI_INDEX_URL + page, `SEBI index page ${page}`);
		logger.info({ page, url }, 'Fetching SEBI index page');

		const { data: html } = await axios.get(url, {
			headers: { 'User-Agent': config.EDGAR_USER_AGENT },
			timeout: 15_000,
		});

		const rows = parseSebiListingRows(html);

		logger.info({ page, rowCount: rows.length }, 'Parsed circular rows');

		for (const row of rows) {
			if (MAX_DOCS !== null && enqueued >= MAX_DOCS) break;

			if (DRY_RUN) {
				logger.info(
					{
						identifier: row.identifier,
						date: row.date,
						subject: row.subject,
						detailUrl: row.detailUrl,
					},
					'[DRY RUN] would resolve PDF + enqueue'
				);
				continue;
			}

			try {
				const { data: detailHtml } = await axios.get(
					assertHttpsUrl(row.detailUrl, `SEBI circular ${row.identifier}`),
					{
						headers: { 'User-Agent': config.EDGAR_USER_AGENT },
						timeout: 15_000,
					}
				);
				const pdfUrl = assertHttpsUrl(
					parseSebiPdfUrl(detailHtml, row.detailUrl),
					`SEBI circular ${row.identifier}`
				);
				logger.debug({ pdfUrl }, 'Downloading SEBI circular PDF');
				const { data: pdfBuffer } = await axios.get(pdfUrl, {
					responseType: 'arraybuffer',
					headers: { 'User-Agent': config.EDGAR_USER_AGENT },
					timeout: 30_000,
				});

				const buffer = Buffer.from(pdfBuffer);
				if (buffer.subarray(0, 4).toString('utf8') !== '%PDF') {
					throw new Error(`Downloaded SEBI content is not a PDF: ${pdfUrl}`);
				}

				const filename = `SEBI_${row.identifier.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
				const stored = await saveFile(buffer, filename, 'application/pdf');

				const { rows: docRows } = await db.query(
					`INSERT INTO documents
             (collection_id, filename, original_name, mime_type, size_bytes,
              local_path, storage_key, status, doc_type, source,
              source_identifier, effective_date, uploaded_by)
           VALUES ($1,$2,$2,'application/pdf',$3,$4,$5,'processing',
                   'regulatory_circular','SEBI',$6,$7,NULL)
           RETURNING id`,
					[COLLECTION_ID, filename, stored.sizeBytes, stored.localPath, stored.storageKey,
						row.identifier, row.date]
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
					chunkingStrategy: strategy,
				});

				enqueued++;
				logger.info(
					{
						identifier: row.identifier,
						subject: row.subject,
						detailUrl: row.detailUrl,
						pdfUrl,
						documentId,
					},
					'Circular queued for ingestion'
				);
			} catch (err) {
				logger.error(
					{ err, identifier: row.identifier, detailUrl: row.detailUrl },
					'Failed to download SEBI circular — skipping'
				);
			}

			await sleep(DELAY_MS);
		}
	}

	logger.info({ enqueued }, 'seed-sebi complete');
	await db.end();
	await redis.quit();
	await redisSub.quit();
}

main().catch(err => { logger.error(err); process.exit(1); });
