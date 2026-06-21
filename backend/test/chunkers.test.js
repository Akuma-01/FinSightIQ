const assert = require('node:assert/strict');
const test = require('node:test');

const { chunk } = require('../dist/chunkers/chunker.factory');

test('fixed chunker creates ordered chunks with the selected strategy', () => {
  const chunks = chunk(
    Array.from({ length: 700 }, () => 'word').join(' '),
    'fixed_256',
    'test-document',
  );

  assert.ok(chunks.length >= 3);
  assert.deepEqual(
    chunks.map((chunk) => chunk.chunkIndex),
    chunks.map((_, index) => index),
  );
  assert.ok(chunks.every((chunk) => chunk.chunkingStrategy === 'fixed_256'));
});

test('sentence chunker preserves content and labels its strategy', () => {
  const text = 'First sentence. Second sentence. Third sentence.';
  const chunks = chunk(text, 'sentence', 'test-document');

  assert.ok(chunks.length >= 1);
  assert.equal(chunks.map((result) => result.text).join(' '), text);
  assert.ok(chunks.every((result) => result.chunkingStrategy === 'sentence'));
});

test('section-aware chunker uses headings when enough sections exist', () => {
  const text = [
    'SECTION 1 CAPITAL',
    'Capital requirements apply.',
    'SECTION 2 KYC',
    'KYC requirements apply.',
    'SECTION 3 RECORDS',
    'Record retention applies.',
  ].join('\n');

  const chunks = chunk(text, 'section_aware', 'test-document');

  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((result) => result.chunkingStrategy === 'section_aware'));
});

test('section-aware chunker falls back for documents without enough headings', () => {
  const chunks = chunk(
    'This is ordinary prose. It has no regulatory section structure.',
    'section_aware',
    'test-document',
  );

  assert.ok(chunks.length >= 1);
  assert.ok(chunks.every((result) => result.chunkingStrategy === 'sentence'));
});
