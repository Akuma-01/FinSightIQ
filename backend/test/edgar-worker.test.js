const assert = require('node:assert/strict');
const test = require('node:test');

const { assertFilingHtml, buildPrimaryDocumentUrl } = require('../dist/lib/edgar-filing');

test('EDGAR primary-document URL uses the SEC-designated filename', () => {
	assert.equal(
		buildPrimaryDocumentUrl('0000320193', '0000320193-25-000079', 'aapl-20250927.htm'),
		'https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm'
	);
});

test('EDGAR primary-document URL rejects paths and non-filing names', () => {
	assert.throws(
		() => buildPrimaryDocumentUrl('0000320193', '0000320193-25-000079', '../index.htm'),
		/invalid primary document filename/
	);
});

test('EDGAR rejects the SEC homepage instead of storing it as a filing', () => {
	assert.throws(
		() => assertFilingHtml('<html><title>SEC.gov | Home</title><p>We make markets work better.</p></html>'),
		/SEC homepage/
	);
});
