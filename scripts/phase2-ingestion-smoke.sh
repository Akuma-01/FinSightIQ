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
RUN_RBI_LIVE="${RUN_RBI_LIVE:-0}"
RUN_RBI_AI="${RUN_RBI_AI:-0}"
RUN_RBI_CONTRADICTION="${RUN_RBI_CONTRADICTION:-0}"
RBI_MAX_ENQUEUED="${RBI_MAX_ENQUEUED:-1}"
RBI_NAME_FILTER="${RBI_NAME_FILTER:-}"
RBI_REQUIRE_CONTRADICTION="${RBI_REQUIRE_CONTRADICTION:-0}"
RBI_AI_QUERY="${RBI_AI_QUERY:-What are the main requirements, eligibility rules, operational duties, and compliance obligations in this RBI direction?}"
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
	RUN_RBI_LIVE=1
	RUN_RBI_AI=1
	RUN_RBI_CONTRADICTION=1
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

[[ "$RBI_MAX_ENQUEUED" =~ ^[1-9][0-9]*$ ]] \
	|| fail "RBI_MAX_ENQUEUED must be a positive integer"

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
RBI_DOCUMENT_ID=""
RBI_JOB_ID=""
RBI_DOCUMENT_A=""
RBI_DOCUMENT_B=""
RBI_CONTRADICTION_COUNT="0"
RBI_SCAN_JOB_ID=""

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

if [[ "$RUN_RBI_LIVE" == "1" ]]; then
	log "Running live RBI official-source ingestion"
	rbi_doc_count_before="$(psql_scalar "
SELECT COUNT(*)
FROM documents d
JOIN document_ingestion_jobs j ON j.document_id = d.id
WHERE d.collection_id = '$COLLECTION_ID'
  AND d.source = 'RBI'
  AND d.doc_type = 'regulatory_circular';
")"

	cd "$ROOT_DIR/backend"
	SEED_COLLECTION_ID="$COLLECTION_ID" \
	MAX_ENQUEUED="$RBI_MAX_ENQUEUED" \
	RBI_NAME_FILTER="$RBI_NAME_FILTER" \
	npm run seed:rbi \
		| tee /tmp/finsightiq-seed-rbi-live.log
	cd "$ROOT_DIR"

	grep -q 'RBI direction queued' /tmp/finsightiq-seed-rbi-live.log \
		|| fail "Live RBI seed did not queue a document from the official RBI website"

	log "Waiting for live RBI document row"
	deadline=$((SECONDS + WAIT_SECONDS))
	while (( SECONDS < deadline )); do
		rbi_rows="$(psql_scalar "
SELECT d.id || '|' || dij.id
FROM documents d
JOIN document_ingestion_jobs dij ON dij.document_id = d.id
WHERE d.collection_id = '$COLLECTION_ID'
  AND d.source = 'RBI'
  AND d.doc_type = 'regulatory_circular'
ORDER BY d.created_at;
")"
		rbi_row_count="$(printf '%s\n' "$rbi_rows" | sed '/^$/d' | wc -l | tr -d ' ')"
		(( rbi_row_count >= RBI_MAX_ENQUEUED )) && break
		sleep 2
	done

	(( rbi_row_count >= RBI_MAX_ENQUEUED )) \
		|| fail "Expected $RBI_MAX_ENQUEUED live RBI document rows, found $rbi_row_count"

	rbi_doc_count_after="$(psql_scalar "
SELECT COUNT(*)
FROM documents d
JOIN document_ingestion_jobs j ON j.document_id = d.id
WHERE d.collection_id = '$COLLECTION_ID'
  AND d.source = 'RBI'
  AND d.doc_type = 'regulatory_circular';
")"
	expected_rbi_count=$((rbi_doc_count_before + RBI_MAX_ENQUEUED))
	[[ "$rbi_doc_count_after" == "$expected_rbi_count" ]] \
		|| fail "Expected $RBI_MAX_ENQUEUED new RBI document(s). before=$rbi_doc_count_before after=$rbi_doc_count_after"

	rbi_index=0
	while IFS='|' read -r current_rbi_document_id current_rbi_job_id; do
		[[ -n "$current_rbi_document_id" ]] || continue
		rbi_index=$((rbi_index + 1))
		[[ "$rbi_index" -eq 1 ]] && {
			RBI_DOCUMENT_A="$current_rbi_document_id"
			RBI_DOCUMENT_ID="$current_rbi_document_id"
			RBI_JOB_ID="$current_rbi_job_id"
		}
		[[ "$rbi_index" -eq 2 ]] && RBI_DOCUMENT_B="$current_rbi_document_id"

		log "Waiting for RBI ingestion result $rbi_index/$RBI_MAX_ENQUEUED"
		wait_for_ready_document "$current_rbi_document_id" "$current_rbi_job_id" "rbi-$rbi_index"

		rbi_ready_events="$(psql_scalar "
SELECT COUNT(*)
FROM ws_events
WHERE collection_id = '$COLLECTION_ID'
  AND event_type = 'document:ready'
  AND payload->>'documentId' = '$current_rbi_document_id';
")"
		(( rbi_ready_events > 0 )) \
			|| fail "No document:ready event found for RBI document $current_rbi_document_id"
	done <<< "$rbi_rows"

	log "Checking RBI source metadata"
	rbi_metadata="$(psql_scalar "
SELECT source || '|' || doc_type || '|' || COALESCE(source_identifier, '') || '|' ||
       COALESCE(effective_date::text, '') || '|' || COALESCE(storage_key, '')
FROM documents
WHERE id = '$RBI_DOCUMENT_ID';
")"
	IFS='|' read -r rbi_source rbi_doc_type rbi_source_identifier rbi_effective_date rbi_storage_key <<< "$rbi_metadata"
	[[ "$rbi_source" == "RBI" ]] || fail "Expected RBI source, got $rbi_source"
	[[ "$rbi_doc_type" == "regulatory_circular" ]] \
		|| fail "Expected regulatory_circular doc_type, got $rbi_doc_type"
	[[ -n "$rbi_source_identifier" ]] || fail "RBI document has no source identifier"
	[[ -n "$rbi_storage_key" ]] || fail "RBI document has no stored official PDF"

	log "RBI source title: $rbi_source_identifier"
	[[ -z "$rbi_effective_date" ]] || log "RBI effective date: $rbi_effective_date"

	log "Live RBI official-source ingestion passed"
fi

if [[ "$RUN_RBI_AI" == "1" ]]; then
	[[ "$RUN_RBI_LIVE" == "1" ]] \
		|| fail "RUN_RBI_AI=1 requires RUN_RBI_LIVE=1"
	[[ -n "$RBI_DOCUMENT_ID" ]] || fail "RBI AI checks require an ingested RBI document"

	log "Running semantic search against the live RBI document"
	rbi_search_body="$(
		curl -fsS -X POST "$BASE_URL/api/ai/search" \
			-H "Authorization: Bearer $TOKEN" \
			-H 'Content-Type: application/json' \
			-d "$(node -e '
const collectionId = process.argv[1];
const query = process.argv[2];
process.stdout.write(JSON.stringify({ collectionId, query }));
' "$COLLECTION_ID" "$RBI_AI_QUERY")"
	)" || fail "RBI semantic search failed. Check Groq configuration and backend logs."
	printf '%s\n' "$rbi_search_body" >/tmp/finsightiq-rbi-search.json
	rbi_search_answer="$(printf '%s' "$rbi_search_body" | json_get answer)" \
		|| fail "RBI search response did not contain an answer"
	[[ -n "$rbi_search_answer" ]] || fail "RBI semantic search returned an empty answer"

	rbi_search_sources="$(node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(0, "utf8"));
process.stdout.write(String(Array.isArray(data.sources) ? data.sources.length : 0));
' <<< "$rbi_search_body")"
	(( rbi_search_sources > 0 )) || fail "RBI semantic search returned no sources"
	printf 'rbi_search_sources=%s\n' "$rbi_search_sources"

	log "Summarizing the live RBI document"
	rbi_document_summary="$(
		curl -fsS -X POST "$BASE_URL/api/ai/summarize/document/$RBI_DOCUMENT_ID" \
			-H "Authorization: Bearer $TOKEN"
	)" || fail "RBI document summary failed. Check Groq configuration and backend logs."
	printf '%s\n' "$rbi_document_summary" >/tmp/finsightiq-rbi-document-summary.json
	[[ -n "$(printf '%s' "$rbi_document_summary" | json_get summary)" ]] \
		|| fail "RBI document summary was empty"

	log "Summarizing the RBI collection"
	rbi_collection_summary="$(
		curl -fsS -X POST "$BASE_URL/api/ai/summarize/collection/$COLLECTION_ID" \
			-H "Authorization: Bearer $TOKEN"
	)" || fail "RBI collection summary failed. Check Groq configuration and backend logs."
	printf '%s\n' "$rbi_collection_summary" >/tmp/finsightiq-rbi-collection-summary.json
	[[ "$(printf '%s' "$rbi_collection_summary" | json_get documentCount)" -ge 1 ]] \
		|| fail "RBI collection summary did not include the ingested document"

	log "Checking stale-reference results for the RBI collection"
	rbi_stale_body="$(
		curl -fsS "$BASE_URL/api/ai/stale/$COLLECTION_ID" \
			-H "Authorization: Bearer $TOKEN"
	)" || fail "RBI stale-reference request failed"
	printf '%s\n' "$rbi_stale_body" >/tmp/finsightiq-rbi-stale-references.json

	log "Checking LLM audit logs for RBI AI operations"
	rbi_llm_log_count="$(psql_scalar "
SELECT COUNT(*)
FROM llm_logs
WHERE user_id = '$USER_ID'
  AND task IN ('semantic_search', 'summarize_document', 'summarize_collection');
")"
	(( rbi_llm_log_count >= 3 )) \
		|| fail "Expected RBI search and summary audit logs, found $rbi_llm_log_count"

	log "Live RBI Phase 3 AI checks passed"
fi

if [[ "$RUN_RBI_CONTRADICTION" == "1" ]]; then
	[[ "$RUN_RBI_LIVE" == "1" ]] \
		|| fail "RUN_RBI_CONTRADICTION=1 requires RUN_RBI_LIVE=1"
	[[ "$RBI_MAX_ENQUEUED" -ge 2 ]] \
		|| fail "RUN_RBI_CONTRADICTION=1 requires RBI_MAX_ENQUEUED=2 or greater"
	[[ -n "$RBI_DOCUMENT_A" && -n "$RBI_DOCUMENT_B" ]] \
		|| fail "RBI contradiction scan requires two ready RBI documents"

	log "Queueing targeted contradiction scan for two live RBI documents"
	rbi_scan_complete_before="$(psql_scalar "
SELECT COUNT(*)
FROM ws_events
WHERE collection_id = '$COLLECTION_ID'
  AND event_type = 'scan:complete';
")"
	rbi_scan_body="$(
		curl -fsS -X POST "$BASE_URL/api/ai/contradict/targeted" \
			-H "Authorization: Bearer $TOKEN" \
			-H 'Content-Type: application/json' \
			-d "{\"docIdA\":\"$RBI_DOCUMENT_A\",\"docIdB\":\"$RBI_DOCUMENT_B\",\"collectionId\":\"$COLLECTION_ID\"}"
	)" || fail "RBI targeted contradiction scan request failed"
	RBI_SCAN_JOB_ID="$(printf '%s' "$rbi_scan_body" | json_get jobId)" \
		|| fail "RBI contradiction response did not contain jobId"

	log "Waiting for RBI contradiction scan"
	deadline=$((SECONDS + WAIT_SECONDS))
	rbi_scan_complete_after="$rbi_scan_complete_before"
	while (( SECONDS < deadline )); do
		rbi_scan_complete_after="$(psql_scalar "
SELECT COUNT(*)
FROM ws_events
WHERE collection_id = '$COLLECTION_ID'
  AND event_type = 'scan:complete';
")"
		if (( rbi_scan_complete_after > rbi_scan_complete_before )); then
			break
		fi
		sleep 2
	done
	(( rbi_scan_complete_after > rbi_scan_complete_before )) \
		|| fail "Timed out waiting for RBI contradiction scan"

	rbi_contradictions="$(
		curl -fsS "$BASE_URL/api/ai/contradictions/$COLLECTION_ID" \
			-H "Authorization: Bearer $TOKEN"
	)" || fail "Could not list RBI contradictions"
	printf '%s\n' "$rbi_contradictions" >/tmp/finsightiq-rbi-contradictions.json
	RBI_CONTRADICTION_COUNT="$(node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(0, "utf8"));
process.stdout.write(String(Array.isArray(data.contradictions) ? data.contradictions.length : 0));
' <<< "$rbi_contradictions")"
	printf 'rbi_contradictions=%s\n' "$RBI_CONTRADICTION_COUNT"

	if (( RBI_CONTRADICTION_COUNT == 0 )) && [[ "$RBI_REQUIRE_CONTRADICTION" == "1" ]]; then
		fail "The two live RBI documents produced no stored contradiction"
	fi

	log "Live RBI contradiction scan passed"
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
	grep -q 'Parsed circular rows' /tmp/finsightiq-seed-sebi-dry-run.log \
		|| fail "seed:sebi dry-run did not parse the listing page"
	grep -q 'would resolve PDF + enqueue' /tmp/finsightiq-seed-sebi-dry-run.log \
		|| fail "seed:sebi dry-run found no circular rows"

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
printf 'USER_ID=%s\nCOLLECTION_ID=%s\nDOCUMENT_ID=%s\nJOB_ID=%s\nRBI_DOCUMENT_ID=%s\nRBI_JOB_ID=%s\nRBI_DOCUMENT_A=%s\nRBI_DOCUMENT_B=%s\nRBI_SCAN_JOB_ID=%s\nRBI_CONTRADICTION_COUNT=%s\n' \
	"$USER_ID" "$COLLECTION_ID" "$DOCUMENT_ID" "$JOB_ID" "$RBI_DOCUMENT_ID" "$RBI_JOB_ID" \
	"$RBI_DOCUMENT_A" "$RBI_DOCUMENT_B" "$RBI_SCAN_JOB_ID" "$RBI_CONTRADICTION_COUNT"
