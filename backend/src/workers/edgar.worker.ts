import axios from 'axios';
import { Job, Worker } from 'bullmq';
import { config } from '../config';
import { db } from '../db/pool';
import { logger } from '../lib/logger';
import { EdgarJobData } from '../queue/edgar.queue';
import { ingestQueue } from '../queue/ingest.queue';
import { redis } from '../redis/client';
import { saveFile } from '../services/storage.service';

let workerStatus: 'active' | 'idle' = 'idle';
export const getEdgarWorkerStatus = () => workerStatus;

const EDGAR_HEADERS = {
	'User-Agent': config.EDGAR_USER_AGENT,
	'Accept': 'application/json',
};

/** Resolve ticker → CIK via SEC company search */
async function resolveCIK(ticker: string): Promise<string> {
	const url = `https://efts.sec.gov/LATEST/search-index?q="${ticker}"&dateRange=custom&startdt=2020-01-01&forms=${encodeURIComponent('10-K,10-Q')}`;
	const { data } = await axios.get(
		`https://www.sec.gov/cgi-bin/browse-edgar?company=&CIK=${ticker}&type=10-K&dateb=&owner=include&count=1&search_text=&action=getcompany&output=atom`,
		{ headers: EDGAR_HEADERS }
	);
	// Parse CIK from atom feed — look for <cik-number> element
	const match = data.match(/<cik-number>(\d+)<\/cik-number>/);
	if (!match) throw new Error(`CIK not found for ticker: ${ticker}`);
	return match[1].padStart(10, '0');
}

/** Get recent filings of a given type from EDGAR submissions API */
async function getFilingAccession(
	cik: string,
	filingType: string,
	year: number
): Promise<{ accessionNumber: string; filingDate: string } | null> {
	const { data } = await axios.get(
		`https://data.sec.gov/submissions/CIK${cik}.json`,
		{ headers: EDGAR_HEADERS }
	);

	const filings = data.filings?.recent;
	if (!filings) return null;

	for (let i = 0; i < filings.form.length; i++) {
		if (
			filings.form[i] === filingType &&
			filings.filingDate[i].startsWith(String(year))
		) {
			return {
				accessionNumber: filings.accessionNumber[i],
				filingDate: filings.filingDate[i],
			};
		}
	}
	return null;
}

/** Download the primary document text from a filing */
async function downloadFilingText(cik: string, accessionNumber: string): Promise<string> {
	const accDashed = accessionNumber.replace(/-/g, '');
	const indexUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/` +
		`${accDashed}/${accessionNumber}-index.htm`;

	// Fetch the index to find the primary document filename
	const { data: indexHtml } = await axios.get(indexUrl, { headers: EDGAR_HEADERS });

	// Look for the primary document (first .htm file linked)
	const primaryMatch = indexHtml.match(/href="([^"]+\.htm)"/i);
	if (!primaryMatch) throw new Error('Could not find primary document in filing index');

	const primaryUrl = `https://www.sec.gov${primaryMatch[1].startsWith('/') ? '' : '/Archives/edgar/data/' + parseInt(cik) + '/' + accDashed + '/'}${primaryMatch[1]}`;
	const { data: htmlText } = await axios.get(primaryUrl, {
		headers: { ...EDGAR_HEADERS, Accept: 'text/html' },
	});

	// Strip HTML tags for plain text extraction
	return htmlText
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/\s{2,}/g, ' ')
		.trim();
}

async function processEdgarJob(job: Job<EdgarJobData>): Promise<void> {
	const { ticker, filingType, year, collectionId, requestedBy, cacheKey } = job.data;
	const log = logger.child({ ticker, filingType, year, collectionId });

	// Check 24-hour cache
	const cached = await redis.get(cacheKey);
	if (cached) {
		log.info('EDGAR result served from cache');
		const { documentId } = JSON.parse(cached);
		return; // document was already ingested from a previous fetch
	}

	log.info('Fetching from EDGAR API');

	const cik = await resolveCIK(ticker);
	const filing = await getFilingAccession(cik, filingType, year);
	if (!filing) throw new Error(`No ${filingType} filing found for ${ticker} in ${year}`);

	const text = await downloadFilingText(cik, filing.accessionNumber);
	const filename = `${ticker}_${filingType}_${year}.txt`;

	// Save to local disk via storage adapter
	const stored = await saveFile(Buffer.from(text, 'utf8'), filename, 'text/plain');

	// Insert document row
	const colResult = await db.query(
		'SELECT chunking_strategy FROM collections WHERE id = $1',
		[collectionId]
	);
	if (!colResult.rows[0]) throw new Error('Collection not found');

	const { rows } = await db.query(
		`INSERT INTO documents
       (collection_id, filename, original_name, mime_type, size_bytes,
        local_path, storage_key, status, doc_type, source,
        source_identifier, effective_date, uploaded_by)
     VALUES ($1, $2, $3, 'text/plain', $4, $5, $6, 'processing',
             'earnings_filing', 'SEC', $7, $8, $9)
     RETURNING id`,
		[
			collectionId, filename, filename, Buffer.byteLength(text, 'utf8'),
			stored.localPath, stored.storageKey,
			filing.accessionNumber, filing.filingDate, requestedBy,
		]
	);
	const documentId = rows[0].id;

	// Insert ingestion job
	const jobRow = await db.query(
		`INSERT INTO document_ingestion_jobs (document_id, collection_id, status, attempt_number)
     VALUES ($1, $2, 'queued', 0) RETURNING id`,
		[documentId, collectionId]
	);
	const jobId = jobRow.rows[0].id;

	// Enqueue standard ingest job
	await ingestQueue.add('ingest-document', {
		documentId,
		collectionId,
		jobId,
		storageKey: stored.storageKey,
		localPath: stored.localPath,
		chunkingStrategy: colResult.rows[0].chunking_strategy,
	});

	// Cache for 24h to prevent duplicate fetches (SRS FR-50)
	const ttlSeconds = config.EDGAR_CACHE_TTL_HOURS * 3600;
	await redis.set(cacheKey, JSON.stringify({ documentId }), 'EX', ttlSeconds);

	log.info({ documentId, accessionNumber: filing.accessionNumber }, 'EDGAR filing queued for ingestion');
}

export function startEdgarWorker(): void {
	const worker = new Worker<EdgarJobData>(
		'edgar-queue',
		async (job) => {
			workerStatus = 'active';
			try {
				await processEdgarJob(job);
			} finally {
				workerStatus = 'idle';
			}
		},
		{ connection: redis, concurrency: 2 }
	);

	worker.on('failed', (job, err) => {
		logger.error({ jobId: job?.id, err }, 'EDGAR worker job failed');
		workerStatus = 'idle';
	});

	logger.info('✓ EDGAR worker started');
}
