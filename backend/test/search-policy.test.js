const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

require('../node_modules/dotenv').config({ path: path.join(__dirname, '../.env') });
const search = require('../dist/services/search.service');

test('RAG limits match the acceptance contract', () => {
	assert.equal(search.RAG_VECTOR_LIMIT, 3);
	assert.equal(search.RAG_KEYWORD_LIMIT, 2);
	assert.equal(search.RAG_FINAL_LIMIT_PER_DOCUMENT, 5);
});

test('CAR remains vector-only', () => {
	assert.equal(search.shouldUseKeywordSearch('CAR'), false);
	assert.equal(search.shouldUseKeywordSearch('capital adequacy'), true);
});
