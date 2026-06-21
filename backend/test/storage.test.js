const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

require('../node_modules/dotenv').config({ path: path.join(__dirname, '../.env') });
const storage = require('../dist/services/storage.service');

test('deleteFile removes the file and its empty UUID directory', async () => {
	const originalUploadDir = process.env.UPLOAD_DIR;
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'finsightiq-storage-'));

	// storage.service reads config once, so mutate its parsed config for this isolated test.
	const { config } = require('../dist/config');
	config.UPLOAD_DIR = tempRoot;

	try {
		const stored = await storage.saveFile(
			Buffer.from('storage test'),
			'test.txt',
			'text/plain'
		);
		const parent = path.dirname(stored.localPath);
		assert.equal(fs.existsSync(stored.localPath), true);

		storage.deleteFile(stored.storageKey);

		assert.equal(fs.existsSync(stored.localPath), false);
		assert.equal(fs.existsSync(parent), false);
	} finally {
		require('../dist/config').config.UPLOAD_DIR = originalUploadDir ?? './uploads';
		fs.rmSync(tempRoot, { recursive: true, force: true });
	}
});

test('getAbsolutePath rejects storage-key traversal', () => {
	assert.throws(
		() => storage.getAbsolutePath('../../outside.txt'),
		/Path traversal detected/
	);
});

test('pruneEmptyUploadDirectories removes only empty upload directories', () => {
	const { config } = require('../dist/config');
	const originalUploadDir = config.UPLOAD_DIR;
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'finsightiq-prune-'));
	const emptyDirectory = path.join(tempRoot, 'empty');
	const occupiedDirectory = path.join(tempRoot, 'occupied');

	fs.mkdirSync(emptyDirectory);
	fs.mkdirSync(occupiedDirectory);
	fs.writeFileSync(path.join(occupiedDirectory, 'document.pdf'), 'content');
	config.UPLOAD_DIR = tempRoot;

	try {
		assert.equal(storage.pruneEmptyUploadDirectories(), 1);
		assert.equal(fs.existsSync(emptyDirectory), false);
		assert.equal(fs.existsSync(occupiedDirectory), true);
	} finally {
		config.UPLOAD_DIR = originalUploadDir;
		fs.rmSync(tempRoot, { recursive: true, force: true });
	}
});
