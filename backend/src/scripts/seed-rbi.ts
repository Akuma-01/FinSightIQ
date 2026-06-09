import axios from 'axios';
import * as cheerio from 'cheerio';
import { PDFParse } from 'pdf-parse';
import { db } from '../db/pool';
import { logger } from '../lib/logger';
import { ingestQueue } from '../queue/ingest.queue';
import { redis } from '../redis/client';
import { saveFile } from '../services/storage.service';

const COLLECTION_ID = process.env.SEED_COLLECTION_ID
	?? (() => { throw new Error('SEED_COLLECTION_ID required'); })();
const DRY_RUN = process.argv.includes('--dry-run');
const DELAY_MS = 1_000;
const SCANNED_THRESHOLD = 200;

const RBI_INDEX_URL = 'https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx';

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function extractPdfText(buffer: Buffer): Promise<string> {
	const parser = new PDFParse({ data: buffer });
	try {
		const parsed = await parser.getText();
		return parsed.text;
	} finally {
		await parser.destroy();
	}
}

async function main() {
	logger.info({ dryRun: DRY_RUN }, 'seed-rbi starting');

	const colResult = await db.query(
		'SELECT chunking_strategy FROM collections WHERE id = $1',
		[COLLECTION_ID]
	);
	if (!colResult.rows[0]) throw new Error('Collection not found');
	const strategy = colResult.rows[0].chunking_strategy;

	const { data: html } = await axios.get(RBI_INDEX_URL, {
		headers: { 'User-Agent': 'FinSightIQ research/1.0 contact@example.com' },
		timeout: 20_000,
	});

	const $ = cheerio.load(html);
	const rows: { name: string; date: string; href: string }[] = [];

	// RBI table structure: Direction Name | Date | PDF link
	$('table tr').each((_, tr) => {
		const cells = $(tr).find('td');
		if (cells.length < 2) return;
		const name = $(cells[0]).text().trim();
		const date = $(cells[1]).text().trim();
		const href = $(cells[0]).find('a').attr('href') ?? $(cells[2]).find('a').attr('href') ?? '';
		if (name && href) rows.push({ name, date, href });
	});

	logger.info({ count: rows.length }, 'Parsed RBI Master Direction rows');

	let enqueued = 0;
	let skippedScanned = 0;

	for (const row of rows) {
		const pdfUrl = row.href.startsWith('http')
			? row.href
			: `https://www.rbi.org.in${row.href}`;

		if (DRY_RUN) {
			logger.info({ name: row.name, pdfUrl }, '[DRY RUN] would process');
			continue;
		}

		try {
			const { data: pdfBuffer } = await axios.get(pdfUrl, {
				responseType: 'arraybuffer',
				headers: { 'User-Agent': 'FinSightIQ research/1.0 contact@example.com' },
				timeout: 30_000,
			});

			const buf = Buffer.from(pdfBuffer);

			const parsedText = await extractPdfText(buf).catch(() => '');
			if (parsedText.trim().length < SCANNED_THRESHOLD) {
				logger.warn(
					{ name: row.name, charCount: parsedText.trim().length },
					'WARN: possible scanned PDF — marking failed, skipping ingestion'
				);
				skippedScanned++;

				await db.query(
					`INSERT INTO documents
             (collection_id, filename, original_name, mime_type, size_bytes,
              local_path, storage_key, status, doc_type, source,
              source_identifier, effective_date, uploaded_by, failure_reason)
           VALUES ($1,$2,$2,'application/pdf',$3,'','','failed',
                   'regulatory_circular','RBI',$4,$5,'seed-rbi','scanned_pdf_no_text')`,
					[COLLECTION_ID, row.name.substring(0, 255), buf.length, row.name, row.date || null]
				);
				await sleep(DELAY_MS);
				continue;
			}

			const filename = `RBI_${row.name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 100)}.pdf`;
			const stored = await saveFile(buf, filename, 'application/pdf');

			const { rows: docRows } = await db.query(
				`INSERT INTO documents
           (collection_id, filename, original_name, mime_type, size_bytes,
            local_path, storage_key, status, doc_type, source,
            source_identifier, effective_date, uploaded_by)
         VALUES ($1,$2,$2,'application/pdf',$3,$4,$5,'processing',
                 'regulatory_circular','RBI',$6,$7,'seed-rbi')
         RETURNING id`,
				[COLLECTION_ID, filename, buf.length, stored.localPath, stored.storageKey,
					row.name.substring(0, 255), row.date || null]
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
			logger.info({ name: row.name, documentId }, 'RBI direction queued');
		} catch (err) {
			logger.error({ err, name: row.name }, 'Failed to download RBI direction — skipping');
		}

		await sleep(DELAY_MS);
	}

	logger.info({ enqueued, skippedScanned }, 'seed-rbi complete');
	await db.end();
	await redis.quit();
}

main().catch(err => { logger.error(err); process.exit(1); });
