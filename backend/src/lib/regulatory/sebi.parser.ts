import * as cheerio from 'cheerio';

export interface SebiListingRow {
	identifier: string;
	date: string | null;
	subject: string;
	detailUrl: string;
}

export function parseRegulatoryDate(raw: string): string | null {
	const timestamp = Date.parse(raw.trim());
	if (Number.isNaN(timestamp)) return null;
	return new Date(timestamp).toISOString().slice(0, 10);
}

export function parseSebiListingRows(html: string): SebiListingRow[] {
	const $ = cheerio.load(html);
	const rows: SebiListingRow[] = [];

	$('#sample_1 tbody tr').each((_, tr) => {
		const cells = $(tr).find('td');
		if (cells.length < 2) return;

		const date = parseRegulatoryDate($(cells[0]).text());
		const anchor = $(cells[1]).find('a[href]').first();
		const subject = (anchor.attr('title') ?? anchor.text()).trim();
		const href = anchor.attr('href') ?? '';
		if (!subject || !href) return;

		const detailUrl = new URL(href, 'https://www.sebi.gov.in/').toString();
		const identifier = new URL(detailUrl).pathname.match(/_(\d+)\.html$/)?.[1]
			?? subject.slice(0, 200);

		rows.push({ identifier, date, subject, detailUrl });
	});

	return rows;
}

export function parseSebiPdfUrl(html: string, detailUrl: string): string {
	const $ = cheerio.load(html);
	const candidates = [
		...$('iframe[src]').map((_, node) => $(node).attr('src') ?? '').get(),
		...$('a[href]').map((_, node) => $(node).attr('href') ?? '').get(),
	];

	for (const candidate of candidates) {
		const decoded = candidate.replace(/&amp;/g, '&');
		const directPdf = decoded.match(/https:\/\/www\.sebi\.gov\.in\/sebi_data\/attachdocs\/[^"'&\s]+\.pdf/i)?.[0];
		if (directPdf) return directPdf;

		const resolved = new URL(decoded, detailUrl);
		const file = resolved.searchParams.get('file');
		if (file && /\.pdf(?:$|[?#])/i.test(file)) {
			return new URL(file, detailUrl).toString();
		}
		if (/\.pdf(?:$|[?#])/i.test(resolved.toString())) {
			return resolved.toString();
		}
	}

	throw new Error(`Could not find SEBI PDF attachment on detail page: ${detailUrl}`);
}
