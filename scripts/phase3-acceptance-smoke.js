#!/usr/bin/env node

const path = require('path');
const { performance } = require('perf_hooks');

require('../backend/node_modules/dotenv').config({
	path: path.join(__dirname, '../backend/.env'),
});

const { Pool } = require('../backend/node_modules/pg');
const Redis = require('../backend/node_modules/ioredis');
const WebSocket = require('../backend/node_modules/ws');

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:4000';
const WAIT_SECONDS = Number(process.env.WAIT_SECONDS ?? 900);
const RUN_EMBEDDING_FALLBACK = process.env.RUN_EMBEDDING_FALLBACK === '1';
const KEEP_DATA = process.env.KEEP_DATA === '1';
const STAMP = Date.now();
const PASSWORD = 'Password123!';

const db = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL);

const state = {
	collectionIds: [],
	userIds: [],
	adminToken: '',
};

function log(message) {
	console.log(`\n[acceptance] ${message}`);
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function api(pathname, options = {}) {
	const response = await fetch(`${BASE_URL}${pathname}`, {
		...options,
		headers: {
			...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
			...(options.json ? { 'Content-Type': 'application/json' } : {}),
			...(options.headers ?? {}),
		},
		body: options.json ? JSON.stringify(options.json) : options.body,
	});
	const text = await response.text();
	let body = {};
	if (text) {
		try {
			body = JSON.parse(text);
		} catch {
			body = { text };
		}
	}
	return { status: response.status, body, headers: response.headers };
}

async function register(email, displayName, role) {
	const response = await api('/api/auth/register', {
		method: 'POST',
		json: { email, password: PASSWORD, displayName, role },
	});
	assert(response.status === 201, `Register ${role} failed: ${JSON.stringify(response.body)}`);
	state.userIds.push(response.body.user.id);
	return response.body.user;
}

async function login(email) {
	const response = await api('/api/auth/login', {
		method: 'POST',
		json: { email, password: PASSWORD },
	});
	assert(response.status === 200, `Login failed: ${JSON.stringify(response.body)}`);
	return response.body;
}

async function createCollection(token, name) {
	const response = await api('/api/collections', {
		method: 'POST',
		token,
		json: { name, chunkingStrategy: 'sentence' },
	});
	assert(response.status === 201, `Collection creation failed: ${JSON.stringify(response.body)}`);
	state.collectionIds.push(response.body.collection.id);
	return response.body.collection.id;
}

async function addMember(adminToken, collectionId, userId, accessRole = 'viewer') {
	const response = await api(`/api/collections/${collectionId}/members`, {
		method: 'POST',
		token: adminToken,
		json: { userId, accessRole },
	});
	assert(response.status === 201, `Add member failed: ${JSON.stringify(response.body)}`);
}

async function uploadText(token, collectionId, filename, text) {
	const form = new FormData();
	form.append('file', new Blob([text], { type: 'text/plain' }), filename);
	const response = await api(`/api/collections/${collectionId}/documents`, {
		method: 'POST',
		token,
		body: form,
	});
	assert(response.status === 202, `Upload ${filename} failed: ${JSON.stringify(response.body)}`);
	return response.body;
}

async function waitReady(documentId, jobId) {
	const deadline = Date.now() + WAIT_SECONDS * 1000;
	while (Date.now() < deadline) {
		const { rows } = await db.query(
			`SELECT d.status AS document_status, j.status AS job_status,
			        j.failure_reason,
			        (SELECT COUNT(*)::int FROM chunks WHERE document_id = d.id) AS chunks,
			        (SELECT COUNT(*)::int FROM chunks
			         WHERE document_id = d.id AND embedding IS NOT NULL) AS vectors
			 FROM documents d
			 JOIN document_ingestion_jobs j ON j.id = $2
			 WHERE d.id = $1`,
			[documentId, jobId]
		);
		const row = rows[0];
		if (row?.document_status === 'ready') {
			assert(row.job_status === 'completed', `Job ${jobId} was not completed`);
			assert(row.chunks > 0 && row.chunks === row.vectors, `Embedding check failed for ${documentId}`);
			return;
		}
		if (row?.document_status === 'failed') {
			throw new Error(`Ingestion failed for ${documentId}: ${row.failure_reason}`);
		}
		await new Promise(resolve => setTimeout(resolve, 500));
	}
	throw new Error(`Timed out waiting for document ${documentId}`);
}

async function uploadAndWait(token, collectionId, filename, text) {
	const upload = await uploadText(token, collectionId, filename, text);
	await waitReady(upload.documentId, upload.jobId);
	return upload.documentId;
}

function connectRoom(token, collectionId, lastSeq) {
	return new Promise((resolve, reject) => {
		const wsUrl = BASE_URL.replace(/^http/, 'ws')
			+ `/ws?token=${encodeURIComponent(token)}`;
		const socket = new WebSocket(wsUrl);
		const timeout = setTimeout(() => reject(new Error('WebSocket room join timed out')), 10_000);

		socket.on('open', () => {
			const action = { action: 'join', collectionId };
			if (lastSeq !== undefined) action.lastSeq = lastSeq;
			socket.send(JSON.stringify(action));
		});
		socket.on('message', raw => {
			const message = JSON.parse(raw.toString());
			if (message.event === 'room:state') {
				clearTimeout(timeout);
				resolve({ socket, roomState: message });
			}
		});
		socket.on('error', reject);
	});
}

async function waitForScanComplete(socket) {
	return new Promise((resolve, reject) => {
		const events = [];
		const timeout = setTimeout(
			() => reject(new Error('Timed out waiting for scan:complete')),
			WAIT_SECONDS * 1000
		);
		const onMessage = raw => {
			const message = JSON.parse(raw.toString());
			events.push(message);
			if (message.event === 'scan:complete') {
				clearTimeout(timeout);
				socket.off('message', onMessage);
				resolve(events);
			}
		};
		socket.on('message', onMessage);
	});
}

async function verifySearchPresenceAndRetry({
	ownerToken,
	adminToken,
	collectionId,
	documentId,
}) {
	log('Checking RAG limits, short-query safety, presence:viewing, and retry route');

	const car = await api('/api/ai/search', {
		method: 'POST',
		token: ownerToken,
		json: { collectionId, query: 'CAR' },
	});
	assert(car.status === 200, `CAR search expected 200, got ${car.status}`);

	const sqlLike = await api('/api/ai/search', {
		method: 'POST',
		token: ownerToken,
		json: { collectionId, query: 'term1 & DROP TABLE' },
	});
	assert(sqlLike.status === 200, `SQL-like search expected 200, got ${sqlLike.status}`);

	const hybrid = await api('/api/ai/search', {
		method: 'POST',
		token: ownerToken,
		json: { collectionId, query: 'capital adequacy requirements' },
	});
	assert(hybrid.status === 200, `Hybrid search expected 200, got ${hybrid.status}`);
	const countsByDocument = new Map();
	for (const source of hybrid.body.sources ?? []) {
		countsByDocument.set(
			source.documentName,
			(countsByDocument.get(source.documentName) ?? 0) + 1
		);
	}
	assert(
		[...countsByDocument.values()].every(count => count <= 5),
		'Hybrid retrieval returned more than five sources for one document'
	);

	const room = await connectRoom(ownerToken, collectionId);
	const viewing = new Promise((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error('presence:viewing timed out')), 10_000);
		const onMessage = raw => {
			const message = JSON.parse(raw.toString());
			if (message.event === 'presence:viewing') {
				clearTimeout(timeout);
				room.socket.off('message', onMessage);
				resolve(message);
			}
		};
		room.socket.on('message', onMessage);
	});
	room.socket.send(JSON.stringify({ action: 'viewing', collectionId, documentId }));
	const viewingEvent = await viewing;
	assert(viewingEvent.payload.documentId === documentId, 'presence:viewing documentId mismatch');
	room.socket.close();

	const retry = await api(`/api/documents/${documentId}/retry`, {
		method: 'POST',
		token: adminToken,
	});
	assert(
		retry.status === 409 && /Only failed jobs/.test(retry.body.error ?? ''),
		`Retry alias did not reach failed-job validation: ${retry.status} ${JSON.stringify(retry.body)}`
	);
}

async function verifyAnnotationScope({
	adminToken,
	ownerToken,
	otherToken,
	complianceToken,
	ownerId,
	complianceId,
	collectionA,
	collectionB,
	documentA,
	documentB,
}) {
	log('Checking annotation collection/document ownership');
	await addMember(adminToken, collectionB, ownerId);
	await addMember(adminToken, collectionB, complianceId);

	const created = await api(
		`/api/collections/${collectionB}/documents/${documentB}/annotations`,
		{
			method: 'POST',
			token: otherToken,
			json: { body: 'Acceptance annotation', annotationType: 'flag' },
		}
	);
	assert(created.status === 201, `Annotation creation failed: ${JSON.stringify(created.body)}`);
	const annotationId = created.body.annotation.id;

	const crossCollection = await api(
		`/api/collections/${collectionA}/documents/${documentA}/annotations/${annotationId}`,
		{
			method: 'PATCH',
			token: complianceToken,
			json: { isResolved: true },
		}
	);
	assert(
		crossCollection.status === 403,
		`Cross-collection annotation update expected 403, got ${crossCollection.status}`
	);

	const bodyByOther = await api(
		`/api/collections/${collectionB}/documents/${documentB}/annotations/${annotationId}`,
		{
			method: 'PATCH',
			token: ownerToken,
			json: { body: 'Unauthorized edit' },
		}
	);
	assert(bodyByOther.status === 403, `Non-owner body edit expected 403, got ${bodyByOther.status}`);

	const resolveByOther = await api(
		`/api/collections/${collectionB}/documents/${documentB}/annotations/${annotationId}`,
		{
			method: 'PATCH',
			token: ownerToken,
			json: { isResolved: true },
		}
	);
	assert(resolveByOther.status === 403, `Analyst resolution expected 403, got ${resolveByOther.status}`);

	const resolveByCompliance = await api(
		`/api/collections/${collectionB}/documents/${documentB}/annotations/${annotationId}`,
		{
			method: 'PATCH',
			token: complianceToken,
			json: { isResolved: true },
		}
	);
	assert(resolveByCompliance.status === 200, 'Compliance officer could not resolve annotation');
}

async function verifyReconnectReplay(ownerToken, collectionId, documentId) {
	log('Checking missed-event replay');
	const first = await connectRoom(ownerToken, collectionId);
	const { rows } = await db.query(
		'SELECT COALESCE(MAX(seq), 0)::int AS seq FROM ws_events WHERE collection_id = $1',
		[collectionId]
	);
	const lastSeq = rows[0].seq;
	first.socket.close();
	await new Promise(resolve => setTimeout(resolve, 100));

	const created = await api(
		`/api/collections/${collectionId}/documents/${documentId}/annotations`,
		{
			method: 'POST',
			token: ownerToken,
			json: { body: 'Replay fixture', annotationType: 'comment' },
		}
	);
	assert(created.status === 201, 'Replay annotation creation failed');

	const replay = await connectRoom(ownerToken, collectionId, lastSeq);
	const recentEvents = replay.roomState.payload.recentEvents ?? [];
	assert(
		recentEvents.some(event =>
			event.event_type === 'annotation:created'
			&& event.payload?.annotation?.id === created.body.annotation.id
		),
		'Reconnect did not replay annotation:created'
	);
	replay.socket.close();
}

async function verifySixDocumentSummary(ownerToken, ownerId, collectionId) {
	log('Checking six-document map-reduce concurrency');
	const startedAt = new Date();
	const start = performance.now();
	const response = await api(`/api/ai/summarize/collection/${collectionId}`, {
		method: 'POST',
		token: ownerToken,
	});
	const elapsedMs = performance.now() - start;
	assert(response.status === 200, `Collection summary failed: ${JSON.stringify(response.body)}`);
	assert(response.body.documentCount === 6, `Expected 6 summarized documents, got ${response.body.documentCount}`);

	const { rows } = await db.query(
		`SELECT latency_ms
		 FROM llm_logs
		 WHERE user_id = $1
		   AND task = 'summarize_document'
		   AND created_at >= $2
		 ORDER BY created_at`,
		[ownerId, startedAt]
	);
	assert(rows.length === 6, `Expected 6 document-summary logs, found ${rows.length}`);
	const sequentialLatency = rows.reduce((sum, row) => sum + Number(row.latency_ms ?? 0), 0);
	assert(
		elapsedMs < sequentialLatency,
		`Collection summary did not show concurrency: elapsed=${elapsedMs.toFixed(0)}ms sum=${sequentialLatency}ms`
	);
	console.log({ elapsedMs: Math.round(elapsedMs), sequentialLatency });
}

async function verifyScanLockAndProgress(ownerToken, collectionId) {
	log('Checking scan lock conflict and 45-pair progress');
	const room = await connectRoom(ownerToken, collectionId);
	const completePromise = waitForScanComplete(room.socket);

	const first = await api(`/api/ai/contradict/${collectionId}`, {
		method: 'POST',
		token: ownerToken,
	});
	assert(first.status === 202, `First scan expected 202, got ${first.status}`);

	const lockKey = `scan:lock:${collectionId}`;
	const lockValue = await redis.get(lockKey);
	assert(lockValue, 'Scan lock was not present after queueing');

	const second = await api(`/api/ai/contradict/${collectionId}`, {
		method: 'POST',
		token: ownerToken,
	});
	assert(second.status === 409, `Concurrent scan expected 409, got ${second.status}`);

	const events = await completePromise;
	const progress = events.filter(event => event.event === 'scan:progress');
	assert(progress.length === 9, `Expected 9 progress events for 45 pairs, found ${progress.length}`);
	assert(
		progress.map(event => event.payload.pairsProcessed).join(',') === '5,10,15,20,25,30,35,40,45',
		`Unexpected progress sequence: ${progress.map(event => event.payload.pairsProcessed).join(',')}`
	);
	assert(
		progress.every(event =>
			event.payload.totalPairs === 45
			&& event.payload.percentComplete === Math.round((event.payload.pairsProcessed / 45) * 100)
		),
		'Progress payload totals or percentages are incorrect'
	);

	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline && await redis.get(lockKey)) {
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	assert(await redis.get(lockKey) === null, 'Scan lock was not removed after completion');
	room.socket.close();
}

async function verifyStaleReference({
	otherToken,
	otherId,
	collectionId,
}) {
	log('Checking stale-reference storage and broadcast');
	const oldDocumentId = await uploadAndWait(
		otherToken,
		collectionId,
		'legacy-rbi-policy.txt',
		`This policy explicitly relies on RBI Master Direction - Know Your Customer (KYC)
Direction, 2016, reference RBI/DBR/2015-16/18 dated February 25, 2016.
The cited RBI direction is the controlling regulatory authority for this policy.`
	);
	const currentDocumentId = await uploadAndWait(
		otherToken,
		collectionId,
		'current-rbi-direction.txt',
		`RBI Master Direction - Know Your Customer (KYC) Direction, 2025 replaces
earlier KYC instructions and is the current governing direction.`
	);

	await db.query(
		`UPDATE documents
		 SET source = 'RBI', source_identifier = $2, effective_date = $3
		 WHERE id = $1`,
		[oldDocumentId, 'RBI Master Direction - KYC Direction, 2016', '2016-02-25']
	);
	await db.query(
		`UPDATE documents
		 SET source = 'RBI', source_identifier = $2, effective_date = $3
		 WHERE id = $1`,
		[currentDocumentId, 'RBI Master Direction - KYC Direction, 2025', '2025-01-01']
	);

	const staleService = require('../backend/dist/services/stale.service');
	await staleService.detectStaleReferences(oldDocumentId, collectionId, otherId);

	const staleRows = await db.query(
		'SELECT id FROM stale_references WHERE document_id = $1 AND collection_id = $2',
		[oldDocumentId, collectionId]
	);
	assert(staleRows.rows.length > 0, 'Stale-reference fixture produced no stored result');

	const eventRows = await db.query(
		`SELECT 1 FROM ws_events
		 WHERE collection_id = $1
		   AND event_type = 'stale_reference:new'
		   AND payload->>'documentId' = $2`,
		[collectionId, oldDocumentId]
	);
	assert(eventRows.rows.length > 0, 'No stale_reference:new event was persisted');
}

async function verifyEmbeddingFallback() {
	if (!RUN_EMBEDDING_FALLBACK) return;
	log('Checking Groq → Hugging Face → Ollama embedding fallback');
	const { spawnSync } = require('child_process');
	const result = spawnSync(
		process.execPath,
		[
			'-e',
			`require('./backend/node_modules/dotenv').config({path:'./backend/.env'});
process.env.EMBEDDING_PROVIDER='groq';
process.env.GROQ_API_KEY='invalid';
process.env.HUGGINGFACE_API_KEY='invalid';
const {embedTexts}=require('./backend/dist/services/embedding.service');
embedTexts(['fallback acceptance test']).then(v=>{
  console.log(v[0].length);
  process.exit(v[0].length === 768 ? 0 : 1);
}).catch(e=>{console.error(e);process.exit(1)});`,
		],
		{
			cwd: path.join(__dirname, '..'),
			env: {
				...process.env,
				EMBEDDING_PROVIDER: 'groq',
				GROQ_API_KEY: 'invalid',
				HUGGINGFACE_API_KEY: 'invalid',
			},
			encoding: 'utf8',
			timeout: 120_000,
		}
	);
	assert(result.status === 0, `Embedding fallback failed: ${result.stderr || result.stdout}`);
	assert(result.stdout.trim().endsWith('768'), `Unexpected fallback output: ${result.stdout}`);
}

async function cleanup() {
	if (KEEP_DATA) return;
	for (const collectionId of state.collectionIds) {
		if (state.adminToken) {
			await api(`/api/collections/${collectionId}`, {
				method: 'DELETE',
				token: state.adminToken,
			}).catch(() => undefined);
		} else {
			await db.query('DELETE FROM collections WHERE id = $1', [collectionId]).catch(() => undefined);
		}
	}
	if (state.userIds.length) {
		await db.query(
			'DELETE FROM llm_logs WHERE user_id = ANY($1::uuid[])',
			[state.userIds]
		).catch(() => undefined);
		await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [state.userIds]).catch(() => undefined);
	}
}

async function main() {
	log('Checking backend health');
	const health = await api('/health');
	assert(health.status === 200 && health.body.db === 'ok' && health.body.redis === 'ok', 'Backend is not healthy');

	const analystEmail = `acceptance-owner-${STAMP}@example.test`;
	const otherEmail = `acceptance-other-${STAMP}@example.test`;
	const complianceEmail = `acceptance-compliance-${STAMP}@example.test`;
	const adminEmail = `acceptance-admin-${STAMP}@example.test`;

	const owner = await register(analystEmail, 'Acceptance Owner', 'analyst');
	const other = await register(otherEmail, 'Acceptance Other', 'analyst');
	const compliance = await register(complianceEmail, 'Acceptance Compliance', 'compliance_officer');
	await register(adminEmail, 'Acceptance Admin', 'admin');

	const ownerLogin = await login(analystEmail);
	const otherLogin = await login(otherEmail);
	const complianceLogin = await login(complianceEmail);
	const adminLogin = await login(adminEmail);
	state.adminToken = adminLogin.accessToken;

	const collectionA = await createCollection(ownerLogin.accessToken, `Acceptance A ${STAMP}`);
	const collectionB = await createCollection(otherLogin.accessToken, `Acceptance B ${STAMP}`);
	await addMember(adminLogin.accessToken, collectionA, compliance.id);

	const topics = [
		'Capital adequacy ratios and minimum regulatory capital requirements.',
		'Customer due diligence and identity verification procedures.',
		'Cybersecurity incident reporting and operational resilience.',
		'Liquidity coverage ratios and high quality liquid assets.',
		'Market risk limits and trading book controls.',
		'Consumer grievance handling and ombudsman escalation.',
		'Foreign exchange exposure and hedging controls.',
		'Loan classification and expected credit loss provisioning.',
		'Payment-system authentication and transaction monitoring.',
		'Record retention, audit trails, and regulatory reporting.',
	];

	const documentIds = [];
	for (let index = 0; index < 6; index++) {
		documentIds.push(await uploadAndWait(
			ownerLogin.accessToken,
			collectionA,
			`acceptance-${index + 1}.txt`,
			`${topics[index]} This acceptance fixture contains enough policy text for ingestion,
chunking, embeddings, summarization, and collection-level processing.`
		));
	}

	const documentB = await uploadAndWait(
		otherLogin.accessToken,
		collectionB,
		'annotation-scope.txt',
		'Annotation scope acceptance fixture for collection isolation and authorization checks.'
	);

	await verifySearchPresenceAndRetry({
		ownerToken: ownerLogin.accessToken,
		adminToken: adminLogin.accessToken,
		collectionId: collectionA,
		documentId: documentIds[0],
	});
	await verifyAnnotationScope({
		adminToken: adminLogin.accessToken,
		ownerToken: ownerLogin.accessToken,
		otherToken: otherLogin.accessToken,
		complianceToken: complianceLogin.accessToken,
		ownerId: owner.id,
		complianceId: compliance.id,
		collectionA,
		collectionB,
		documentA: documentIds[0],
		documentB,
	});
	await verifyReconnectReplay(ownerLogin.accessToken, collectionA, documentIds[0]);
	await verifySixDocumentSummary(ownerLogin.accessToken, owner.id, collectionA);

	for (let index = 6; index < 10; index++) {
		documentIds.push(await uploadAndWait(
			ownerLogin.accessToken,
			collectionA,
			`acceptance-${index + 1}.txt`,
			`${topics[index]} This acceptance fixture is intentionally distinct so the
45-pair scan exercises progress and lock handling without requiring every pair
to invoke an expensive contradiction analysis.`
		));
	}

	await verifyScanLockAndProgress(ownerLogin.accessToken, collectionA);
	await verifyStaleReference({
		otherToken: otherLogin.accessToken,
		otherId: other.id,
		collectionId: collectionB,
	});
	await verifyEmbeddingFallback();

	log('All Phase 3 acceptance checks passed');
}

main()
	.catch(error => {
		console.error(`\n[acceptance][FAIL] ${error.stack ?? error.message}`);
		process.exitCode = 1;
	})
	.finally(async () => {
		await cleanup();
		await db.end();
		await redis.quit();
		const backendDb = require('../backend/dist/db/pool').db;
		const backendRedis = require('../backend/dist/redis/client');
		await backendDb.end().catch(() => undefined);
		await backendRedis.redis.quit().catch(() => undefined);
		await backendRedis.redisSub.quit().catch(() => undefined);
	});
