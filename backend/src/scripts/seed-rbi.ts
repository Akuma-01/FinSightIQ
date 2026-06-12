import axios from 'axios';
import * as cheerio from 'cheerio';
import { PDFParse } from 'pdf-parse';
import { db } from '../db/pool';
import { logger } from '../lib/logger';
import { ingestQueue } from '../queue/ingest.queue';
import { redis, redisSub } from '../redis/client';
import { saveFile } from '../services/storage.service';

const COLLECTION_ID = process.env.SEED_COLLECTION_ID
	?? (() => { throw new Error('SEED_COLLECTION_ID required'); })();
const DRY_RUN = process.argv.includes('--dry-run');
const DELAY_MS = 1_000;
const SCANNED_THRESHOLD = 200;
const MAX_DOCS = process.env.MAX_DOCS ? parseInt(process.env.MAX_DOCS, 10) : null;

const RBI_INDEX_URL = 'https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx';
const RBI_ORIGIN = 'https://www.rbi.org.in/';
const RBI_HEADERS = {
	'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
	'Accept': 'application/pdf,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
	'Accept-Language': 'en-US,en;q=0.9',
	'Connection': 'close',
	'Referer': RBI_ORIGIN,
};

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

async function extractPdfText(buffer: Buffer): Promise<string> {
	const parser = new PDFParse({ data: buffer });
	try {
		const parsed = await parser.getText();
		return parsed.text;
	} finally {
		await parser.destroy();
	}
}

function isPdfUrl(url: string): boolean {
	return /\.pdf(?:$|[?#])/i.test(url);
}

function isPdfBuffer(buffer: Buffer): boolean {
	return buffer.subarray(0, 4).toString('utf8') === '%PDF';
}

function parseRbiDate(raw: string): string | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;

	const parsed = Date.parse(trimmed);
	if (Number.isNaN(parsed)) return null;

	return new Date(parsed).toISOString().slice(0, 10);
}

async function resolveRbiPdfUrl(url: string, context: string): Promise<string> {
	const safeUrl = assertHttpsUrl(url, context);
	if (isPdfUrl(safeUrl)) return safeUrl;

	const { data: html } = await axios.get(safeUrl, {
		headers: RBI_HEADERS,
		timeout: 20_000,
		maxRedirects: 5,
		responseType: 'text',
	});

	const $ = cheerio.load(html);
	const pdfHref = $('a[href]').map((_, a) => $(a).attr('href') ?? '').get()
		.find((href) => isPdfUrl(href) || href.includes('rbidocs.rbi.org.in'));

	if (!pdfHref) {
		throw new Error(`${context}: could not find PDF link on RBI detail page: ${safeUrl}`);
	}

	return assertHttpsUrl(new URL(pdfHref, safeUrl).toString(), context);
}

async function main() {
	logger.info({ dryRun: DRY_RUN, maxDocs: MAX_DOCS }, 'seed-rbi starting');

	const colResult = await db.query(
		'SELECT chunking_strategy FROM collections WHERE id = $1',
		[COLLECTION_ID]
	);
	if (!colResult.rows[0]) throw new Error('Collection not found');
	const strategy = colResult.rows[0].chunking_strategy;

	const { data: html } = await axios.get(assertHttpsUrl(RBI_INDEX_URL, 'RBI index'), {
		headers: RBI_HEADERS,
		timeout: 20_000,
		maxRedirects: 5,
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

	for (const row of rows.slice(0, MAX_DOCS ?? rows.length)) {
		const rawUrl = new URL(row.href, RBI_ORIGIN).toString();

		if (DRY_RUN) {
			logger.info({ name: row.name, detailUrl: assertHttpsUrl(rawUrl, `RBI direction ${row.name}`) }, '[DRY RUN] would process');
			continue;
		}

		try {
			const pdfUrl = await resolveRbiPdfUrl(rawUrl, `RBI direction ${row.name}`);
			const effectiveDate = parseRbiDate(row.date);
			const { data: pdfBuffer } = await axios.get(pdfUrl, {
				responseType: 'arraybuffer',
				headers: RBI_HEADERS,
				timeout: 30_000,
				maxRedirects: 5,
			});

			const buf = Buffer.from(pdfBuffer);
			if (!isPdfBuffer(buf)) {
				throw new Error(`RBI direction ${row.name}: downloaded content is not a PDF: ${pdfUrl}`);
			}

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
                   'regulatory_circular','RBI',$4,$5,NULL,'scanned_pdf_no_text')`,
					[COLLECTION_ID, row.name.substring(0, 255), buf.length, row.name, effectiveDate]
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
                 'regulatory_circular','RBI',$6,$7,NULL)
         RETURNING id`,
				[COLLECTION_ID, filename, buf.length, stored.localPath, stored.storageKey,
					row.name.substring(0, 255), effectiveDate]
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
			logger.info({ name: row.name, documentId }, 'RBI direction queued');
		} catch (err) {
			logger.error({ err, name: row.name }, 'Failed to download RBI direction — skipping');
		}

		await sleep(DELAY_MS);
	}

	logger.info({ enqueued, skippedScanned }, 'seed-rbi complete');
	await db.end();
	await redis.quit();
	await redisSub.quit();
}

main().catch(err => { logger.error(err); process.exit(1); });
