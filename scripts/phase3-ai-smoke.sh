#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_URL="${BASE_URL:-http://127.0.0.1:4000}"
REDIS_URL="${REDIS_URL:-$(grep -E '^REDIS_URL=' "$ROOT_DIR/backend/.env" 2>/dev/null | head -1 | cut -d= -f2-)}"
REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
WAIT_SECONDS="${WAIT_SECONDS:-900}"
PASSWORD="${PASSWORD:-Password123!}"
CHUNKING_STRATEGY="${CHUNKING_STRATEGY:-sentence}"
RUN_RATE_LIMITS="${RUN_RATE_LIMITS:-0}"
REQUIRE_CONTRADICTION="${REQUIRE_CONTRADICTION:-0}"
CLEANUP="${CLEANUP:-0}"
CHECK_WEBSOCKET="${CHECK_WEBSOCKET:-1}"
SKIP_LLM_PREFLIGHT="${SKIP_LLM_PREFLIGHT:-0}"
STAMP="$(date +%s)"
ANALYST_EMAIL="${ANALYST_EMAIL:-phase3-analyst-${STAMP}@example.test}"
COMPLIANCE_EMAIL="${COMPLIANCE_EMAIL:-phase3-compliance-${STAMP}@example.test}"
ADMIN_EMAIL="${ADMIN_EMAIL:-phase3-admin-${STAMP}@example.test}"
COLLECTION_NAME="${COLLECTION_NAME:-Phase 3 Automated Smoke ${STAMP}}"
STATE_FILE="${STATE_FILE:-/tmp/finsightiq-phase3.env}"
WS_LOG="${WS_LOG:-/tmp/finsightiq-phase3-ws-${STAMP}.jsonl}"
DOC_A_PATH="/tmp/finsightiq-phase3-policy-a-${STAMP}.txt"
DOC_B_PATH="/tmp/finsightiq-phase3-policy-b-${STAMP}.txt"
OBSERVER_PID=""
COLLECTION_ID=""
DOCUMENT_A=""
DOCUMENT_B=""
JOB_A=""
JOB_B=""
SCAN_JOB_ID=""
TARGETED_JOB_ID=""
CONTRADICTION_ID=""
ANNOTATION_ID=""
ANALYST_ID=""
COMPLIANCE_ID=""
ADMIN_ID=""
ANALYST_TOKEN=""
COMPLIANCE_TOKEN=""
ADMIN_TOKEN=""

log() {
	printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"
}

warn() {
	printf '\n[WARN] %s\n' "$*" >&2
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

json_count() {
	node -e '
const fs = require("fs");
const value = JSON.parse(fs.readFileSync(0, "utf8"));
const path = process.argv[1].split(".");
let current = value;
for (const key of path) current = current?.[key];
process.stdout.write(String(Array.isArray(current) ? current.length : 0));
' "$1"
}

psql_scalar() {
	docker exec finsightiq-postgres psql -U finsight -d finsightiq -tAc "$1" | tr -d '\r'
}

redis_command() {
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
	local row=""
	local document_status=""
	local job_status=""
	local failure_reason=""
	local chunk_count="0"
	local vector_count="0"

	while (( SECONDS < deadline )); do
		row="$(psql_scalar "
SELECT d.status || '|' || j.status || '|' || COALESCE(j.failure_reason, '') || '|' ||
       (SELECT COUNT(*) FROM chunks WHERE document_id = d.id) || '|' ||
       (SELECT COUNT(*) FROM chunks WHERE document_id = d.id AND embedding IS NOT NULL)
FROM documents d
JOIN document_ingestion_jobs j ON j.id = '$job_id'
WHERE d.id = '$document_id';
")"
		IFS='|' read -r document_status job_status failure_reason chunk_count vector_count <<< "$row"
		printf '%s document=%s job=%s chunks=%s vectors=%s failure=%s\n' \
			"$label" "$document_status" "$job_status" "$chunk_count" "$vector_count" "$failure_reason"

		if [[ "$document_status" == "ready" || "$document_status" == "failed" ]]; then
			break
		fi
		sleep 2
	done

	[[ "$document_status" == "ready" ]] \
		|| fail "$label did not become ready. document=$document_status job=$job_status failure=$failure_reason"
	[[ "$job_status" == "completed" ]] \
		|| fail "$label ingestion job did not complete. status=$job_status"
	(( chunk_count > 0 )) || fail "$label inserted no chunks"
	(( vector_count == chunk_count )) || fail "$label has chunks without embeddings"
}

wait_for_event_count() {
	local event_type="$1"
	local minimum="$2"
	local deadline=$((SECONDS + WAIT_SECONDS))
	local count=0

	while (( SECONDS < deadline )); do
		count="$(psql_scalar "
SELECT COUNT(*)
FROM ws_events
WHERE collection_id = '$COLLECTION_ID'
  AND event_type = '$event_type';
")"
		if (( count >= minimum )); then
			return
		fi
		sleep 1
	done

	fail "Timed out waiting for $event_type event count >= $minimum"
}

register_user() {
	local email="$1"
	local display_name="$2"
	local role="$3"

	curl -fsS -X POST "$BASE_URL/api/auth/register" \
		-H 'Content-Type: application/json' \
		-d "{\"email\":\"$email\",\"password\":\"$PASSWORD\",\"displayName\":\"$display_name\",\"role\":\"$role\"}"
}

login_user() {
	local email="$1"

	curl -fsS -X POST "$BASE_URL/api/auth/login" \
		-H 'Content-Type: application/json' \
		-d "{\"email\":\"$email\",\"password\":\"$PASSWORD\"}"
}

stop_observer() {
	if [[ -n "$OBSERVER_PID" ]] && kill -0 "$OBSERVER_PID" 2>/dev/null; then
		kill "$OBSERVER_PID" 2>/dev/null || true
		wait "$OBSERVER_PID" 2>/dev/null || true
	fi
}

write_state() {
	umask 077
	cat > "$STATE_FILE" <<EOF
BASE_URL=$BASE_URL
COLLECTION_ID=$COLLECTION_ID
DOCUMENT_A=$DOCUMENT_A
DOCUMENT_B=$DOCUMENT_B
JOB_A=$JOB_A
JOB_B=$JOB_B
SCAN_JOB_ID=$SCAN_JOB_ID
TARGETED_JOB_ID=$TARGETED_JOB_ID
CONTRADICTION_ID=$CONTRADICTION_ID
ANNOTATION_ID=$ANNOTATION_ID
ANALYST_ID=$ANALYST_ID
COMPLIANCE_ID=$COMPLIANCE_ID
ADMIN_ID=$ADMIN_ID
ANALYST_EMAIL=$ANALYST_EMAIL
COMPLIANCE_EMAIL=$COMPLIANCE_EMAIL
ADMIN_EMAIL=$ADMIN_EMAIL
ANALYST_TOKEN=$ANALYST_TOKEN
COMPLIANCE_TOKEN=$COMPLIANCE_TOKEN
ADMIN_TOKEN=$ADMIN_TOKEN
WS_LOG=$WS_LOG
EOF
}

cleanup_temp_files() {
	if [[ -n "$COLLECTION_ID" ]]; then
		write_state
	fi
	stop_observer
	rm -f "$DOC_A_PATH" "$DOC_B_PATH"
}

trap cleanup_temp_files EXIT

need_cmd curl
need_cmd docker
need_cmd node

log "Checking Docker containers"
docker ps --format '{{.Names}} {{.Status}}' | grep -q '^finsightiq-postgres ' \
	|| fail "finsightiq-postgres is not running. Run: docker compose up -d postgres redis"
docker ps --format '{{.Names}} {{.Status}}' | grep -q '^finsightiq-redis ' \
	|| fail "finsightiq-redis is not running. Run: docker compose up -d postgres redis"

log "Checking backend health at $BASE_URL"
health="$(curl -fsS "$BASE_URL/health")" \
	|| fail "Backend is not reachable. Start it with: cd backend && npm run dev:raw"
printf '%s\n' "$health"
[[ "$(printf '%s' "$health" | json_get db)" == "ok" ]] || fail "Database health is not ok"
[[ "$(printf '%s' "$health" | json_get redis)" == "ok" ]] || fail "Redis health is not ok"

log "Checking prompt templates"
prompt_count="$(psql_scalar "SELECT COUNT(*) FROM prompt_templates WHERE is_active = TRUE;")"
(( prompt_count >= 7 )) \
	|| fail "Expected 7 active prompt templates, found $prompt_count. Run: cd backend && npm run seed:prompts"

log "Checking that a Groq API key is configured"
if ! grep -Eq '^GROQ_API_KEY=.+$' "$ROOT_DIR/backend/.env" 2>/dev/null; then
	fail "GROQ_API_KEY is missing from backend/.env. Phase 3 generated AI responses require it."
fi

if [[ "$SKIP_LLM_PREFLIGHT" != "1" ]]; then
	log "Checking Groq connectivity before creating test data"
	GROQ_API_KEY_VALUE="$(grep -E '^GROQ_API_KEY=' "$ROOT_DIR/backend/.env" | head -1 | cut -d= -f2-)"
	GROQ_BASE_URL_VALUE="$(
		grep -E '^GROQ_BASE_URL=' "$ROOT_DIR/backend/.env" 2>/dev/null \
			| head -1 \
			| cut -d= -f2- \
			|| true
	)"
	GROQ_BASE_URL_VALUE="${GROQ_BASE_URL_VALUE:-https://api.groq.com/openai/v1}"
	GROQ_MODEL_VALUE="$(
		grep -E '^GROQ_MODEL_FAST=' "$ROOT_DIR/backend/.env" 2>/dev/null \
			| head -1 \
			| cut -d= -f2- \
			|| true
	)"
	GROQ_MODEL_VALUE="${GROQ_MODEL_VALUE:-llama-3.1-8b-instant}"

	preflight_code="$(
		curl -sS --max-time 30 \
			-o /tmp/finsightiq-phase3-groq-preflight.json \
			-w '%{http_code}' \
			-X POST "${GROQ_BASE_URL_VALUE%/}/chat/completions" \
			-H "Authorization: Bearer $GROQ_API_KEY_VALUE" \
			-H 'Content-Type: application/json' \
			-d "{\"model\":\"$GROQ_MODEL_VALUE\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with OK\"}],\"max_tokens\":4,\"temperature\":0}"
	)" || fail "Could not reach Groq within 30 seconds. Check network access or run with SKIP_LLM_PREFLIGHT=1."

	[[ "$preflight_code" == "200" ]] \
		|| fail "Groq preflight returned HTTP $preflight_code. See /tmp/finsightiq-phase3-groq-preflight.json"
fi

log "Creating deterministic Phase 3 text fixtures"
cat > "$DOC_A_PATH" <<'EOF'
Section 1 Capital Adequacy Requirements
The regulated institution shall maintain a capital adequacy ratio of at least fifteen percent at all times. The compliance team must review this ratio every month and must report any breach to the board within two business days.

Section 2 Customer Due Diligence
High-risk customer records shall be reviewed every two years. Medium-risk customer records shall be reviewed every eight years. Low-risk customer records shall be reviewed every ten years. All exceptions require documented approval from the compliance officer.

Section 3 Record Retention
Customer identification records must be preserved for at least five years after the business relationship ends. The institution shall maintain audit evidence and make it available to regulators on request.
EOF

cat > "$DOC_B_PATH" <<'EOF'
Section 1 Capital Adequacy Requirements
The regulated institution may operate with a capital adequacy ratio of ten percent when management approves an exception. The finance team only needs to review this ratio once per year, and reporting a breach to the board is optional.

Section 2 Customer Due Diligence
High-risk, medium-risk, and low-risk customer records shall all be reviewed every five years. Compliance officer approval is not required when operational teams document the reason for an exception.

Section 3 Record Retention
Customer identification records must be destroyed three years after the business relationship ends. Audit evidence may be deleted earlier when storage costs are considered excessive.
EOF

log "Registering disposable users"
register_user "$ANALYST_EMAIL" "Phase 3 Analyst" "analyst" >/tmp/finsightiq-phase3-register-analyst.json
register_user "$COMPLIANCE_EMAIL" "Phase 3 Compliance" "compliance_officer" >/tmp/finsightiq-phase3-register-compliance.json
register_user "$ADMIN_EMAIL" "Phase 3 Admin" "admin" >/tmp/finsightiq-phase3-register-admin.json

log "Logging in disposable users"
analyst_login="$(login_user "$ANALYST_EMAIL")"
compliance_login="$(login_user "$COMPLIANCE_EMAIL")"
admin_login="$(login_user "$ADMIN_EMAIL")"

ANALYST_TOKEN="$(printf '%s' "$analyst_login" | json_get accessToken)"
ANALYST_ID="$(printf '%s' "$analyst_login" | json_get user.id)"
COMPLIANCE_TOKEN="$(printf '%s' "$compliance_login" | json_get accessToken)"
COMPLIANCE_ID="$(printf '%s' "$compliance_login" | json_get user.id)"
ADMIN_TOKEN="$(printf '%s' "$admin_login" | json_get accessToken)"
ADMIN_ID="$(printf '%s' "$admin_login" | json_get user.id)"

log "Creating collection"
collection_body="$(
	curl -fsS -X POST "$BASE_URL/api/collections" \
		-H "Authorization: Bearer $ANALYST_TOKEN" \
		-H 'Content-Type: application/json' \
		-d "{\"name\":\"$COLLECTION_NAME\",\"chunkingStrategy\":\"$CHUNKING_STRATEGY\"}"
)"
COLLECTION_ID="$(printf '%s' "$collection_body" | json_get collection.id)"
log "Collection: $COLLECTION_ID"
write_state

log "Adding compliance officer to the collection"
curl -fsS -X POST "$BASE_URL/api/collections/$COLLECTION_ID/members" \
	-H "Authorization: Bearer $ADMIN_TOKEN" \
	-H 'Content-Type: application/json' \
	-d "{\"userId\":\"$COMPLIANCE_ID\",\"accessRole\":\"viewer\"}" \
	>/tmp/finsightiq-phase3-member.json

if [[ "$CHECK_WEBSOCKET" == "1" ]]; then
	log "Starting WebSocket event observer"
	: > "$WS_LOG"
	node "$ROOT_DIR/scripts/phase3-ws-observer.js" \
		"$BASE_URL" "$COMPLIANCE_TOKEN" "$COLLECTION_ID" "$WS_LOG" &
	OBSERVER_PID=$!

	deadline=$((SECONDS + 15))
	while (( SECONDS < deadline )); do
		if grep -q '"event":"room:state"' "$WS_LOG" 2>/dev/null; then
			break
		fi
		sleep 1
	done
	grep -q '"event":"room:state"' "$WS_LOG" \
		|| fail "WebSocket observer did not join the collection room"
fi

log "Uploading automatically generated document A"
upload_a="$(
	curl -fsS -X POST "$BASE_URL/api/collections/$COLLECTION_ID/documents" \
		-H "Authorization: Bearer $ANALYST_TOKEN" \
		-F "file=@$DOC_A_PATH;type=text/plain"
)"
DOCUMENT_A="$(printf '%s' "$upload_a" | json_get documentId)"
JOB_A="$(printf '%s' "$upload_a" | json_get jobId)"

log "Uploading automatically generated document B"
upload_b="$(
	curl -fsS -X POST "$BASE_URL/api/collections/$COLLECTION_ID/documents" \
		-H "Authorization: Bearer $ANALYST_TOKEN" \
		-F "file=@$DOC_B_PATH;type=text/plain"
)"
DOCUMENT_B="$(printf '%s' "$upload_b" | json_get documentId)"
JOB_B="$(printf '%s' "$upload_b" | json_get jobId)"
write_state

log "Waiting for both ingestion jobs"
wait_for_ready_document "$DOCUMENT_A" "$JOB_A" "document-a"
wait_for_ready_document "$DOCUMENT_B" "$JOB_B" "document-b"

log "Verifying processing and ready events"
processing_events="$(psql_scalar "
SELECT COUNT(*) FROM ws_events
WHERE collection_id = '$COLLECTION_ID' AND event_type = 'document:processing';
")"
ready_events="$(psql_scalar "
SELECT COUNT(*) FROM ws_events
WHERE collection_id = '$COLLECTION_ID' AND event_type = 'document:ready';
")"
(( processing_events >= 2 )) || fail "Expected at least 2 document:processing events"
(( ready_events >= 2 )) || fail "Expected at least 2 document:ready events"

log "Running semantic search"
search_body="$(
	curl -fsS -X POST "$BASE_URL/api/ai/search" \
		-H "Authorization: Bearer $ANALYST_TOKEN" \
		-H 'Content-Type: application/json' \
		-d "{\"collectionId\":\"$COLLECTION_ID\",\"query\":\"What capital adequacy, KYC review, and record retention requirements apply?\"}"
)" || fail "Semantic search request failed"
printf '%s\n' "$search_body" >/tmp/finsightiq-phase3-search.json
search_answer="$(printf '%s' "$search_body" | json_get answer)"
search_sources="$(printf '%s' "$search_body" | json_count sources)"
[[ -n "$search_answer" ]] || fail "Semantic search returned an empty answer. Check GROQ_API_KEY and backend logs."
(( search_sources > 0 )) || fail "Semantic search returned no sources"
printf 'answer=%s\nsources=%s\n' "$search_answer" "$search_sources"

log "Running document summary"
document_summary="$(
	curl -fsS -X POST "$BASE_URL/api/ai/summarize/document/$DOCUMENT_A" \
		-H "Authorization: Bearer $ANALYST_TOKEN"
)" || fail "Document summary failed. Check GROQ_API_KEY and backend logs."
printf '%s\n' "$document_summary" >/tmp/finsightiq-phase3-document-summary.json
[[ -n "$(printf '%s' "$document_summary" | json_get summary)" ]] \
	|| fail "Document summary was empty"

log "Running collection summary"
collection_summary="$(
	curl -fsS -X POST "$BASE_URL/api/ai/summarize/collection/$COLLECTION_ID" \
		-H "Authorization: Bearer $ANALYST_TOKEN"
)" || fail "Collection summary failed. Check GROQ_API_KEY and backend logs."
printf '%s\n' "$collection_summary" >/tmp/finsightiq-phase3-collection-summary.json
[[ "$(printf '%s' "$collection_summary" | json_get documentCount)" -ge 2 ]] \
	|| fail "Collection summary did not include both documents"

log "Queueing full contradiction scan"
scan_complete_before="$(psql_scalar "
SELECT COUNT(*) FROM ws_events
WHERE collection_id = '$COLLECTION_ID' AND event_type = 'scan:complete';
")"
scan_body="$(
	curl -fsS -X POST "$BASE_URL/api/ai/contradict/$COLLECTION_ID" \
		-H "Authorization: Bearer $ANALYST_TOKEN"
)" || fail "Contradiction scan request failed"
SCAN_JOB_ID="$(printf '%s' "$scan_body" | json_get jobId)"
write_state
log "Scan job: $SCAN_JOB_ID"
wait_for_event_count "scan:complete" "$((scan_complete_before + 1))"

log "Checking scan progress events"
scan_started="$(psql_scalar "
SELECT COUNT(*) FROM ws_events
WHERE collection_id = '$COLLECTION_ID' AND event_type = 'scan:started';
")"
scan_progress="$(psql_scalar "
SELECT COUNT(*) FROM ws_events
WHERE collection_id = '$COLLECTION_ID' AND event_type = 'scan:progress';
")"
(( scan_started > 0 )) || fail "No scan:started event persisted"
(( scan_progress > 0 )) || fail "No scan:progress event persisted"

log "Listing contradictions"
contradiction_body="$(
	curl -fsS "$BASE_URL/api/ai/contradictions/$COLLECTION_ID" \
		-H "Authorization: Bearer $ANALYST_TOKEN"
)"
printf '%s\n' "$contradiction_body" >/tmp/finsightiq-phase3-contradictions.json
CONTRADICTION_COUNT="$(printf '%s' "$contradiction_body" | json_count contradictions)"
CONTRADICTION_ID=""
printf 'contradictions=%s\n' "$CONTRADICTION_COUNT"

if (( CONTRADICTION_COUNT > 0 )); then
	CONTRADICTION_ID="$(printf '%s' "$contradiction_body" | json_get contradictions.0.id)"
	write_state
	log "Resolving first contradiction as compliance officer"
	resolved_body="$(
		curl -fsS -X PATCH "$BASE_URL/api/ai/contradictions/$CONTRADICTION_ID/resolve" \
			-H "Authorization: Bearer $COMPLIANCE_TOKEN"
	)"
	[[ "$(printf '%s' "$resolved_body" | json_get contradiction.is_resolved)" == "true" ]] \
		|| fail "Contradiction resolution did not set is_resolved=true"
elif [[ "$REQUIRE_CONTRADICTION" == "1" ]]; then
	fail "No contradiction was stored, but REQUIRE_CONTRADICTION=1"
else
	warn "The scan completed but stored no contradiction. Review the LLM response in llm_logs."
fi

log "Queueing targeted scan for the same pair"
targeted_complete_before="$(psql_scalar "
SELECT COUNT(*) FROM ws_events
WHERE collection_id = '$COLLECTION_ID' AND event_type = 'scan:complete';
")"
targeted_body="$(
	curl -fsS -X POST "$BASE_URL/api/ai/contradict/targeted" \
		-H "Authorization: Bearer $ANALYST_TOKEN" \
		-H 'Content-Type: application/json' \
		-d "{\"docIdA\":\"$DOCUMENT_A\",\"docIdB\":\"$DOCUMENT_B\",\"collectionId\":\"$COLLECTION_ID\"}"
)"
TARGETED_JOB_ID="$(printf '%s' "$targeted_body" | json_get jobId)"
write_state
log "Targeted scan job: $TARGETED_JOB_ID"
wait_for_event_count "scan:complete" "$((targeted_complete_before + 1))"

log "Creating annotation"
annotation_body="$(
	curl -fsS -X POST \
		"$BASE_URL/api/collections/$COLLECTION_ID/documents/$DOCUMENT_A/annotations" \
		-H "Authorization: Bearer $ANALYST_TOKEN" \
		-H 'Content-Type: application/json' \
		-d '{"body":"Automated Phase 3 review flag.","annotationType":"flag"}'
)"
ANNOTATION_ID="$(printf '%s' "$annotation_body" | json_get annotation.id)"
write_state

log "Updating annotation"
curl -fsS -X PATCH \
	"$BASE_URL/api/collections/$COLLECTION_ID/documents/$DOCUMENT_A/annotations/$ANNOTATION_ID" \
	-H "Authorization: Bearer $ANALYST_TOKEN" \
	-H 'Content-Type: application/json' \
	-d '{"body":"Automated Phase 3 review flag updated."}' \
	>/tmp/finsightiq-phase3-annotation-update.json

log "Resolving annotation as compliance officer"
annotation_resolved="$(
	curl -fsS -X PATCH \
		"$BASE_URL/api/collections/$COLLECTION_ID/documents/$DOCUMENT_A/annotations/$ANNOTATION_ID" \
		-H "Authorization: Bearer $COMPLIANCE_TOKEN" \
		-H 'Content-Type: application/json' \
		-d '{"isResolved":true}'
)"
[[ "$(printf '%s' "$annotation_resolved" | json_get annotation.is_resolved)" == "true" ]] \
	|| fail "Annotation resolution did not set is_resolved=true"

log "Deleting annotation as its owner"
curl -fsS -X DELETE \
	"$BASE_URL/api/collections/$COLLECTION_ID/documents/$DOCUMENT_A/annotations/$ANNOTATION_ID" \
	-H "Authorization: Bearer $ANALYST_TOKEN" \
	>/tmp/finsightiq-phase3-annotation-delete.json

log "Checking stale-reference endpoint"
stale_body="$(
	curl -fsS "$BASE_URL/api/ai/stale/$COLLECTION_ID" \
		-H "Authorization: Bearer $ANALYST_TOKEN"
)"
STALE_COUNT="$(printf '%s' "$stale_body" | json_count staleReferences)"
printf 'stale_references=%s\n' "$STALE_COUNT"

log "Checking collection risk summary"
risk_summary="$(
	curl -fsS "$BASE_URL/api/collections/$COLLECTION_ID/summary" \
		-H "Authorization: Bearer $ANALYST_TOKEN"
)"
printf '%s\n' "$risk_summary"

log "Checking LLM audit logs"
llm_log_count="$(psql_scalar "
SELECT COUNT(*)
FROM llm_logs
WHERE user_id = '$ANALYST_ID';
")"
(( llm_log_count > 0 )) || fail "No LLM audit logs were written for the analyst"

log "Checking annotation WebSocket events"
annotation_created="$(psql_scalar "
SELECT COUNT(*) FROM ws_events
WHERE collection_id = '$COLLECTION_ID' AND event_type = 'annotation:created';
")"
annotation_updated="$(psql_scalar "
SELECT COUNT(*) FROM ws_events
WHERE collection_id = '$COLLECTION_ID' AND event_type = 'annotation:updated';
")"
annotation_deleted="$(psql_scalar "
SELECT COUNT(*) FROM ws_events
WHERE collection_id = '$COLLECTION_ID' AND event_type = 'annotation:deleted';
")"
(( annotation_created > 0 )) || fail "No annotation:created event"
(( annotation_updated >= 2 )) || fail "Expected annotation update and resolution events"
(( annotation_deleted > 0 )) || fail "No annotation:deleted event"

if [[ "$CHECK_WEBSOCKET" == "1" ]]; then
	log "Checking that events reached a connected WebSocket client"
	sleep 1
	for event in \
		'document:processing' \
		'document:ready' \
		'scan:started' \
		'scan:progress' \
		'scan:complete' \
		'annotation:created' \
		'annotation:updated' \
		'annotation:deleted'; do
		grep -q "\"event\":\"$event\"" "$WS_LOG" \
			|| fail "WebSocket observer did not receive $event"
	done

	if (( CONTRADICTION_COUNT > 0 )); then
		grep -q '"event":"contradiction:new"' "$WS_LOG" \
			|| fail "Contradiction was stored but observer did not receive contradiction:new"
	fi
fi

if [[ "$RUN_RATE_LIMITS" == "1" ]]; then
	log "Checking Phase 3 rate limits"
	redis_command SET "rl:contradict:$ANALYST_ID" 20 EX 3600 >/dev/null
	redis_command SET "rl:search:$ANALYST_ID" 60 EX 3600 >/dev/null
	redis_command SET "rl:summarize:$ANALYST_ID" 30 EX 3600 >/dev/null

	contradict_code="$(
		curl -sS -o /tmp/finsightiq-phase3-rate-contradict.json -w '%{http_code}' \
			-X POST "$BASE_URL/api/ai/contradict/$COLLECTION_ID" \
			-H "Authorization: Bearer $ANALYST_TOKEN"
	)"
	search_code="$(
		curl -sS -o /tmp/finsightiq-phase3-rate-search.json -w '%{http_code}' \
			-X POST "$BASE_URL/api/ai/search" \
			-H "Authorization: Bearer $ANALYST_TOKEN" \
			-H 'Content-Type: application/json' \
			-d "{\"collectionId\":\"$COLLECTION_ID\",\"query\":\"capital requirements\"}"
	)"
	summarize_code="$(
		curl -sS -o /tmp/finsightiq-phase3-rate-summary.json -w '%{http_code}' \
			-X POST "$BASE_URL/api/ai/summarize/document/$DOCUMENT_A" \
			-H "Authorization: Bearer $ANALYST_TOKEN"
	)"

	[[ "$contradict_code" == "429" ]] || fail "Expected contradiction rate limit 429, got $contradict_code"
	[[ "$search_code" == "429" ]] || fail "Expected search rate limit 429, got $search_code"
	[[ "$summarize_code" == "429" ]] || fail "Expected summarize rate limit 429, got $summarize_code"

	redis_command DEL \
		"rl:contradict:$ANALYST_ID" \
		"rl:search:$ANALYST_ID" \
		"rl:summarize:$ANALYST_ID" >/dev/null
fi

log "Writing generated IDs and tokens to $STATE_FILE"
write_state

if [[ "$CLEANUP" == "1" ]]; then
	log "Cleaning up collection and disposable users"
	curl -fsS -X DELETE "$BASE_URL/api/collections/$COLLECTION_ID" \
		-H "Authorization: Bearer $ADMIN_TOKEN" >/dev/null
	docker exec finsightiq-postgres psql -U finsight -d finsightiq -v ON_ERROR_STOP=1 -c "
DELETE FROM llm_logs
WHERE user_id IN ('$ANALYST_ID', '$COMPLIANCE_ID', '$ADMIN_ID')
   OR prompt LIKE '%The regulated institution shall maintain a capital adequacy ratio%'
   OR prompt LIKE '%The regulated institution may operate with a capital adequacy ratio%';
DELETE FROM users
WHERE id IN ('$ANALYST_ID', '$COMPLIANCE_ID', '$ADMIN_ID');
" >/dev/null
	log "Cleanup complete"
fi

log "Phase 3 automated smoke test passed"
printf '\nCollection:       %s\n' "$COLLECTION_ID"
printf 'Document A:      %s\n' "$DOCUMENT_A"
printf 'Document B:      %s\n' "$DOCUMENT_B"
printf 'Contradictions:  %s\n' "$CONTRADICTION_COUNT"
printf 'Stale refs:      %s\n' "$STALE_COUNT"
printf 'LLM logs:        %s\n' "$llm_log_count"
printf 'State file:      %s\n' "$STATE_FILE"
printf 'WebSocket log:   %s\n' "$WS_LOG"
