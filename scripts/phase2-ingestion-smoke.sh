#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_URL="${BASE_URL:-http://127.0.0.1:4000}"
REDIS_URL="${REDIS_URL:-$(grep -E '^REDIS_URL=' "$ROOT_DIR/backend/.env" 2>/dev/null | head -1 | cut -d= -f2-)}"
REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
PDF_PATH="${PDF_PATH:-/mnt/c/Users/anura/OneDrive/Desktop/2025KYC.pdf}"
WAIT_SECONDS="${WAIT_SECONDS:-900}"
EMAIL="${EMAIL:-phase2-smoke-$(date +%s)@example.test}"
PASSWORD="${PASSWORD:-Password123!}"
COLLECTION_NAME="${COLLECTION_NAME:-Phase 2 Smoke Test}"
CHUNKING_STRATEGY="${CHUNKING_STRATEGY:-section_aware}"
RUN_EDGAR="${RUN_EDGAR:-0}"
RUN_SEED_DRY_RUNS="${RUN_SEED_DRY_RUNS:-0}"
RUN_EDGAR_RATE_LIMIT="${RUN_EDGAR_RATE_LIMIT:-0}"
RUN_ALL="${RUN_ALL:-0}"
SKIP_UPLOAD="${SKIP_UPLOAD:-0}"
EDGAR_TICKER="${EDGAR_TICKER:-AAPL}"
EDGAR_FILING_TYPE="${EDGAR_FILING_TYPE:-10-K}"
EDGAR_YEAR="${EDGAR_YEAR:-2023}"
EDGAR_CACHE_KEY="edgar:${EDGAR_TICKER}:${EDGAR_FILING_TYPE}:${EDGAR_YEAR}"

if [[ "$RUN_ALL" == "1" ]]; then
	RUN_EDGAR=1
	RUN_SEED_DRY_RUNS=1
	RUN_EDGAR_RATE_LIMIT=1
fi

log() {
	printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"
}

fail() {
	printf '\n[FAIL] %s\n' "$*" >&2
	exit 1
}

need_cmd() {
	command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

json_get() {
	node -e '
const fs = require("fs");
const path = process.argv[1].split(".");
let value = JSON.parse(fs.readFileSync(0, "utf8"));
for (const key of path) value = value?.[key];
if (value === undefined || value === null) process.exit(1);
process.stdout.write(String(value));
' "$1"
}

psql_scalar() {
	docker exec finsightiq-postgres psql -U finsight -d finsightiq -tAc "$1" | tr -d '\r'
}

redis_scalar() {
	if command -v redis-cli >/dev/null 2>&1; then
		redis-cli -u "$REDIS_URL" "$@"
	else
		docker exec finsightiq-redis redis-cli "$@"
	fi
}

wait_for_ready_document() {
	local document_id="$1"
	local job_id="$2"
	local label="$3"
	local deadline=$((SECONDS + WAIT_SECONDS))
	local document_status=""
	local job_status=""
	local failure_reason=""
	local chunk_count="0"
	local chunks_with_vectors="0"

	while (( SECONDS < deadline )); do
		row="$(psql_scalar "
SELECT d.status || '|' || j.status || '|' || COALESCE(j.failure_reason, '') || '|' ||
       (SELECT COUNT(*) FROM chunks WHERE document_id = d.id) || '|' ||
       (SELECT COUNT(*) FROM chunks WHERE document_id = d.id AND embedding IS NOT NULL)
FROM documents d
JOIN document_ingestion_jobs j ON j.id = '$job_id'
WHERE d.id = '$document_id';
")"
		IFS='|' read -r document_status job_status failure_reason chunk_count chunks_with_vectors <<< "$row"
		printf '%s document=%s job=%s chunks=%s vectors=%s failure=%s\n' \
			"$label" "$document_status" "$job_status" "$chunk_count" "$chunks_with_vectors" "$failure_reason"

		if [[ "$document_status" == "ready" || "$document_status" == "failed" ]]; then
			break
		fi
		sleep 3
	done

	[[ "$document_status" == "ready" ]] || fail "$label document did not become ready. status=$document_status job=$job_status failure=$failure_reason"
	[[ "$job_status" == "completed" ]] || fail "$label job did not complete. status=$job_status failure=$failure_reason"
	(( chunk_count > 0 )) || fail "$label inserted no chunks"
	(( chunks_with_vectors > 0 )) || fail "$label chunks have no embeddings"
}

need_cmd curl
need_cmd docker
need_cmd node

log "Checking Docker containers"
docker ps --format '{{.Names}} {{.Status}}' | grep -q '^finsightiq-postgres ' \
	|| fail "finsightiq-postgres is not running. Run: docker compose up -d postgres redis"
docker ps --format '{{.Names}} {{.Status}}' | grep -q '^finsightiq-redis ' \
	|| fail "finsightiq-redis is not running. Run: docker compose up -d postgres redis"

if [[ "$SKIP_UPLOAD" != "1" ]]; then
	log "Checking PDF path"
	[[ -f "$PDF_PATH" ]] || fail "PDF not found: $PDF_PATH"
	magic="$(head -c 4 "$PDF_PATH" || true)"
	[[ "$magic" == "%PDF" ]] || fail "File does not start with %PDF. Upload middleware will reject it: $PDF_PATH"
else
	log "Skipping PDF upload section"
fi

log "Checking backend health at $BASE_URL"
health="$(curl -fsS "$BASE_URL/health")" || fail "Backend is not reachable. Start it with: cd backend && npm run dev:raw"
printf '%s\n' "$health"
db_status="$(printf '%s' "$health" | json_get db)"
redis_status="$(printf '%s' "$health" | json_get redis)"
[[ "$db_status" == "ok" ]] || fail "Health check db is not ok: $db_status"
[[ "$redis_status" == "ok" ]] || fail "Health check redis is not ok: $redis_status"

log "Registering test analyst: $EMAIL"
register_body="$(
	curl -fsS -X POST "$BASE_URL/api/auth/register" \
		-H 'Content-Type: application/json' \
		-d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"displayName\":\"Phase 2 Smoke\",\"role\":\"analyst\"}"
)" || fail "User registration failed"
printf '%s\n' "$register_body"

log "Logging in"
login_body="$(
	curl -fsS -X POST "$BASE_URL/api/auth/login" \
		-H 'Content-Type: application/json' \
		-d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
)" || fail "Login failed"
TOKEN="$(printf '%s' "$login_body" | json_get accessToken)" || fail "Login response did not contain accessToken"
USER_ID="$(printf '%s' "$login_body" | json_get user.id)" || fail "Login response did not contain user.id"
log "Authenticated as user $USER_ID"

log "Creating collection"
collection_body="$(
	curl -fsS -X POST "$BASE_URL/api/collections" \
		-H "Authorization: Bearer $TOKEN" \
		-H 'Content-Type: application/json' \
		-d "{\"name\":\"$COLLECTION_NAME\",\"chunkingStrategy\":\"$CHUNKING_STRATEGY\"}"
)" || fail "Collection creation failed"
COLLECTION_ID="$(printf '%s' "$collection_body" | json_get collection.id)" || fail "Collection response did not contain collection.id"
log "Collection: $COLLECTION_ID"

DOCUMENT_ID=""
JOB_ID=""

if [[ "$SKIP_UPLOAD" != "1" ]]; then
	log "Uploading PDF"
	upload_body="$(
		curl -fsS -X POST "$BASE_URL/api/collections/$COLLECTION_ID/documents" \
			-H "Authorization: Bearer $TOKEN" \
			-F "file=@$PDF_PATH;type=application/pdf"
	)" || fail "PDF upload failed"
	printf '%s\n' "$upload_body"
	DOCUMENT_ID="$(printf '%s' "$upload_body" | json_get documentId)" || fail "Upload response did not contain documentId"
	JOB_ID="$(printf '%s' "$upload_body" | json_get jobId)" || fail "Upload response did not contain jobId"
	log "Document: $DOCUMENT_ID"
	log "Ingest job: $JOB_ID"

	log "Polling ingest result for up to ${WAIT_SECONDS}s"
	wait_for_ready_document "$DOCUMENT_ID" "$JOB_ID" "upload"

	log "Checking document:ready WebSocket event persistence"
	ready_events="$(psql_scalar "
SELECT COUNT(*)
FROM ws_events
WHERE collection_id = '$COLLECTION_ID'
  AND event_type = 'document:ready'
  AND payload->>'documentId' = '$DOCUMENT_ID';
")"
	(( ready_events > 0 )) || fail "No document:ready event found in ws_events"

	log "Upload + ingest + chunks + vectors + WebSocket event checks passed"
fi

if [[ "$RUN_EDGAR" == "1" ]]; then
	log "Running EDGAR fetch check"
	redis_scalar DEL "$EDGAR_CACHE_KEY" >/dev/null
	sec_doc_count_before="$(psql_scalar "
SELECT COUNT(*)
FROM documents
WHERE collection_id = '$COLLECTION_ID'
  AND source = 'SEC'
  AND doc_type = 'earnings_filing'
  AND source_identifier IS NOT NULL;
")"

	edgar_body="$(
		curl -fsS -X POST "$BASE_URL/api/edgar/fetch" \
			-H "Authorization: Bearer $TOKEN" \
			-H 'Content-Type: application/json' \
			-d "{\"ticker\":\"$EDGAR_TICKER\",\"filingType\":\"$EDGAR_FILING_TYPE\",\"year\":$EDGAR_YEAR,\"collectionId\":\"$COLLECTION_ID\"}"
	)" || fail "EDGAR fetch request failed"
	printf '%s\n' "$edgar_body"
	EDGAR_JOB_ID="$(printf '%s' "$edgar_body" | json_get jobId)" || fail "EDGAR response did not contain jobId"
	log "EDGAR queue job: $EDGAR_JOB_ID"

	log "Waiting for SEC document row"
	deadline=$((SECONDS + WAIT_SECONDS))
	sec_document_id=""
	sec_ingest_job_id=""
	while (( SECONDS < deadline )); do
		sec_row="$(psql_scalar "
SELECT d.id || '|' || dij.id
FROM documents d
JOIN document_ingestion_jobs dij ON dij.document_id = d.id
WHERE d.collection_id = '$COLLECTION_ID'
  AND source = 'SEC'
  AND doc_type = 'earnings_filing'
  AND source_identifier IS NOT NULL
ORDER BY d.created_at DESC
LIMIT 1;
")"
		IFS='|' read -r sec_document_id sec_ingest_job_id <<< "$sec_row"
		[[ -n "$sec_document_id" ]] && break
		sleep 3
	done
	[[ -n "$sec_document_id" ]] || fail "No SEC document row created by EDGAR worker"
	[[ -n "$sec_ingest_job_id" ]] || fail "No ingestion job row found for SEC document"

	log "Checking SEC document metadata"
	sec_metadata="$(psql_scalar "
SELECT source || '|' || doc_type || '|' || COALESCE(source_identifier, '') || '|' || COALESCE(effective_date::text, '')
FROM documents
WHERE id = '$sec_document_id';
")"
	IFS='|' read -r sec_source sec_doc_type sec_source_identifier sec_effective_date <<< "$sec_metadata"
	[[ "$sec_source" == "SEC" ]] || fail "Expected SEC source, got $sec_source"
	[[ "$sec_doc_type" == "earnings_filing" ]] || fail "Expected earnings_filing doc_type, got $sec_doc_type"
	[[ -n "$sec_source_identifier" ]] || fail "SEC document has no source_identifier"
	[[ -n "$sec_effective_date" ]] || fail "SEC document has no effective_date"

	log "Waiting for SEC ingestion result"
	wait_for_ready_document "$sec_document_id" "$sec_ingest_job_id" "edgar"

	log "Checking EDGAR document:ready event"
	edgar_ready_events="$(psql_scalar "
SELECT COUNT(*)
FROM ws_events
WHERE collection_id = '$COLLECTION_ID'
  AND event_type = 'document:ready'
  AND payload->>'documentId' = '$sec_document_id';
")"
	(( edgar_ready_events > 0 )) || fail "No document:ready event found for EDGAR document"

	ttl="$(redis_scalar TTL "$EDGAR_CACHE_KEY" | tr -d '\r')"
	[[ "$ttl" =~ ^-?[0-9]+$ && "$ttl" -gt 0 ]] || fail "EDGAR cache key missing or has no TTL"
	log "EDGAR cache TTL: $ttl"

	log "Fetching same EDGAR filing again to verify cache/no duplicate document row"
	curl -fsS -X POST "$BASE_URL/api/edgar/fetch" \
		-H "Authorization: Bearer $TOKEN" \
		-H 'Content-Type: application/json' \
		-d "{\"ticker\":\"$EDGAR_TICKER\",\"filingType\":\"$EDGAR_FILING_TYPE\",\"year\":$EDGAR_YEAR,\"collectionId\":\"$COLLECTION_ID\"}" >/tmp/finsightiq-edgar-cache-response.json \
		|| fail "Second EDGAR fetch request failed"
	sleep 3

	sec_doc_count_after="$(psql_scalar "
SELECT COUNT(*)
FROM documents
WHERE collection_id = '$COLLECTION_ID'
  AND source = 'SEC'
  AND doc_type = 'earnings_filing'
  AND source_identifier IS NOT NULL;
")"
	expected_sec_count=$((sec_doc_count_before + 1))
	[[ "$sec_doc_count_after" == "$expected_sec_count" ]] \
		|| fail "Expected cached EDGAR re-fetch to avoid duplicate documents. before=$sec_doc_count_before after=$sec_doc_count_after"
fi

if [[ "$RUN_EDGAR_RATE_LIMIT" == "1" ]]; then
	log "Running EDGAR rate-limit check. This intentionally sends 11 requests."
	redis_scalar DEL "rl:edgar:$USER_ID" >/dev/null
	for i in $(seq 1 11); do
		code="$(
			curl -sS -o /tmp/finsightiq-edgar-rate-limit.json -w '%{http_code}' \
				-X POST "$BASE_URL/api/edgar/fetch" \
				-H "Authorization: Bearer $TOKEN" \
				-H 'Content-Type: application/json' \
				-d "{\"ticker\":\"$EDGAR_TICKER\",\"filingType\":\"$EDGAR_FILING_TYPE\",\"year\":$EDGAR_YEAR,\"collectionId\":\"$COLLECTION_ID\"}"
		)"
		printf 'edgar_request=%s http=%s\n' "$i" "$code"
	done
	[[ "$code" == "429" ]] || fail "Expected 11th EDGAR request to return 429, got $code"
	redis_scalar DEL "rl:edgar:$USER_ID" >/dev/null
fi

if [[ "$RUN_SEED_DRY_RUNS" == "1" ]]; then
	log "Running seed dry-run checks"
	doc_count_before_seeds="$(psql_scalar "SELECT COUNT(*) FROM documents WHERE collection_id = '$COLLECTION_ID';")"
	chunk_count_before_seeds="$(psql_scalar "SELECT COUNT(*) FROM chunks WHERE collection_id = '$COLLECTION_ID';")"

	cd "$ROOT_DIR/backend"
	printf 'AAPL\nMSFT\n' > /tmp/finsightiq-smoke-tickers.csv
	SEED_COLLECTION_ID="$COLLECTION_ID" TICKER_FILE=/tmp/finsightiq-smoke-tickers.csv npm run seed:edgar -- --dry-run \
		| tee /tmp/finsightiq-seed-edgar-dry-run.log
	grep -q 'would enqueue' /tmp/finsightiq-seed-edgar-dry-run.log \
		|| fail "seed:edgar dry-run did not log 'would enqueue'"

	SEED_COLLECTION_ID="$COLLECTION_ID" MAX_PAGES=1 npm run seed:sebi -- --dry-run \
		| tee /tmp/finsightiq-seed-sebi-dry-run.log
	grep -Eq 'Parsed circular rows|would download \+ enqueue' /tmp/finsightiq-seed-sebi-dry-run.log \
		|| fail "seed:sebi dry-run did not log parsed rows or would-download output"

	SEED_COLLECTION_ID="$COLLECTION_ID" npm run seed:rbi -- --dry-run \
		| tee /tmp/finsightiq-seed-rbi-dry-run.log
	grep -Eq 'Parsed RBI Master Direction rows|would process' /tmp/finsightiq-seed-rbi-dry-run.log \
		|| fail "seed:rbi dry-run did not log parsed rows or would-process output"

	doc_count_after_seeds="$(psql_scalar "SELECT COUNT(*) FROM documents WHERE collection_id = '$COLLECTION_ID';")"
	chunk_count_after_seeds="$(psql_scalar "SELECT COUNT(*) FROM chunks WHERE collection_id = '$COLLECTION_ID';")"
	[[ "$doc_count_after_seeds" == "$doc_count_before_seeds" ]] \
		|| fail "Seed dry-runs wrote documents. before=$doc_count_before_seeds after=$doc_count_after_seeds"
	[[ "$chunk_count_after_seeds" == "$chunk_count_before_seeds" ]] \
		|| fail "Seed dry-runs wrote chunks. before=$chunk_count_before_seeds after=$chunk_count_after_seeds"
fi

log "Phase 2 smoke test complete"
printf 'COLLECTION_ID=%s\nDOCUMENT_ID=%s\nJOB_ID=%s\n' "$COLLECTION_ID" "$DOCUMENT_ID" "$JOB_ID"
