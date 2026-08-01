const EDGAR_WWW_HOSTNAME = 'www.sec.gov';

function assertEdgarUrl(url: string): string {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`EDGAR: invalid URL: ${url}`);
	}

	if (parsed.protocol !== 'https:' || parsed.hostname !== EDGAR_WWW_HOSTNAME) {
		throw new Error(`EDGAR SSRF guard: expected ${EDGAR_WWW_HOSTNAME}, got: ${url}`);
	}
	return url;
}

export function buildPrimaryDocumentUrl(cik: string, accessionNumber: string, primaryDocument: string): string {
	const accDashed = accessionNumber.replace(/-/g, '');
	const cikNum = parseInt(cik, 10);
	const filename = primaryDocument.trim();
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:htm|html|txt)$/i.test(filename)) {
		throw new Error(`EDGAR: invalid primary document filename: ${primaryDocument}`);
	}
	return assertEdgarUrl(
		`https://www.sec.gov/Archives/edgar/data/${cikNum}/${accDashed}/${encodeURIComponent(filename)}`
	);
}

export function assertFilingHtml(html: string): void {
	const normalized = html.toLowerCase();
	const looksLikeSecHomepage = normalized.includes('<title>sec.gov | home')
		|| normalized.includes('we make markets work better')
		|| normalized.includes('sec homepage');
	if (looksLikeSecHomepage) {
		throw new Error('EDGAR returned the SEC homepage instead of the requested filing');
	}
	if (html.trim().length < 200) {
		throw new Error('EDGAR returned an unexpectedly short filing response');
	}
}
