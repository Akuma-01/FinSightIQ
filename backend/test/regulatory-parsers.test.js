const assert = require('node:assert/strict');
const test = require('node:test');

const {
	parseRbiDirectionRows,
} = require('../dist/lib/regulatory/rbi.parser');
const {
	parseRegulatoryDate,
	parseSebiListingRows,
	parseSebiPdfUrl,
} = require('../dist/lib/regulatory/sebi.parser');

test('RBI parser selects the direct PDF from the index row', () => {
	const rows = parseRbiDirectionRows(`
		<table><tr>
			<td><a href="BS_ViewMasDirections.aspx?id=13361">Counterfeit Notes</a></td>
			<td><a href="https://rbidocs.rbi.org.in/rdocs/notification/PDFs/REAL.PDF">626 kb</a></td>
		</tr></table>
	`);

	assert.equal(rows.length, 1);
	assert.equal(
		rows[0].detailUrl,
		'https://www.rbi.org.in/BS_ViewMasDirections.aspx?id=13361'
	);
	assert.equal(
		rows[0].pdfUrl,
		'https://rbidocs.rbi.org.in/rdocs/notification/PDFs/REAL.PDF'
	);
});

test('SEBI listing parser reads the current two-column table', () => {
	const rows = parseSebiListingRows(`
		<table id="sample_1"><tbody><tr>
			<td>Jun 19, 2026</td>
			<td><a href="/legal/circulars/jun-2026/test_102229.html"
				title="Test Circular">Test Circular</a></td>
		</tr></tbody></table>
	`);

	assert.deepEqual(rows, [{
		identifier: '102229',
		date: '2026-06-19',
		subject: 'Test Circular',
		detailUrl: 'https://www.sebi.gov.in/legal/circulars/jun-2026/test_102229.html',
	}]);
});

test('SEBI detail parser extracts iframe file URL', () => {
	const pdfUrl = parseSebiPdfUrl(
		`<iframe src="../../../web/?file=https://www.sebi.gov.in/sebi_data/attachdocs/jun-2026/123.pdf"></iframe>`,
		'https://www.sebi.gov.in/legal/circulars/jun-2026/test_102229.html'
	);
	assert.equal(
		pdfUrl,
		'https://www.sebi.gov.in/sebi_data/attachdocs/jun-2026/123.pdf'
	);
});

test('regulatory dates are normalized for PostgreSQL', () => {
	assert.equal(parseRegulatoryDate('Jun 19, 2026'), '2026-06-19');
	assert.equal(parseRegulatoryDate('not a date'), null);
});
