import * as cheerio from 'cheerio';

export interface RbiDirectionRow {
	name: string;
	date: string;
	detailUrl: string;
	pdfUrl: string;
}

const RBI_ORIGIN = 'https://www.rbi.org.in/';

function absoluteUrl(href: string): string {
	return new URL(href, RBI_ORIGIN).toString();
}

export function parseRbiDirectionRows(html: string): RbiDirectionRow[] {
	const $ = cheerio.load(html);
	const rows: RbiDirectionRow[] = [];

	$('table tr').each((_, tr) => {
		const cells = $(tr).find('td');
		if (cells.length < 2) return;

		const name = $(cells[0]).text().trim();
		const detailHref = $(cells[0]).find('a[href]').first().attr('href') ?? '';
		const pdfHref = cells
			.find('a[href]')
			.map((__, anchor) => $(anchor).attr('href') ?? '')
			.get()
			.find(href => /\.pdf(?:$|[?#])/i.test(href)) ?? '';

		if (!name || !detailHref || !pdfHref) return;

		const date = cells
			.map((__, cell) => $(cell).text().trim())
			.get()
			.find(text => !Number.isNaN(Date.parse(text))) ?? '';

		rows.push({
			name,
			date,
			detailUrl: absoluteUrl(detailHref),
			pdfUrl: absoluteUrl(pdfHref),
		});
	});

	return rows;
}
