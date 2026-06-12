import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { db } from '../db/pool';
import { logger } from '../lib/logger';
import { edgarQueue } from '../queue/edgar.queue';
import { redis, redisSub } from '../redis/client';

const COLLECTION_ID = process.env.SEED_COLLECTION_ID ?? (() => { throw new Error('SEED_COLLECTION_ID required'); })();
const YEAR = parseInt(process.env.SEED_YEAR ?? '2024', 10);
const DRY_RUN = process.argv.includes('--dry-run');
const TICKER_FILE = process.env.TICKER_FILE ?? './tickers.csv';

async function main() {
	logger.info({ dryRun: DRY_RUN, year: YEAR, collectionId: COLLECTION_ID }, 'seed-edgar starting');

	const tickers: string[] = [];
	const rl = createInterface({ input: createReadStream(TICKER_FILE) });
	for await (const line of rl) {
		const ticker = line.trim().toUpperCase();
		if (ticker && !ticker.startsWith('#')) tickers.push(ticker);
	}

	logger.info({ count: tickers.length }, `Loaded tickers`);

	for (const ticker of tickers) {
		for (const filingType of ['10-K', '10-Q'] as const) {
			const cacheKey = `edgar:${ticker}:${filingType}:${YEAR}`;

			if (DRY_RUN) {
				logger.info({ ticker, filingType, year: YEAR }, '[DRY RUN] would enqueue');
				continue;
			}

			if (await redis.exists(cacheKey)) {
				logger.info({ ticker, filingType }, 'Already cached — skipping');
				continue;
			}

			await edgarQueue.add('fetch-edgar', {
				ticker, filingType, year: YEAR,
				collectionId: COLLECTION_ID,
				requestedBy: 'seed-script',
				cacheKey,
			});

			logger.info({ ticker, filingType }, 'Queued');

			await new Promise(r => setTimeout(r, 200));
		}
	}

	await db.end();
	await redis.quit();
	await redisSub.quit();
	logger.info('seed-edgar complete');
}

main().catch(err => { logger.error(err); process.exit(1); });
