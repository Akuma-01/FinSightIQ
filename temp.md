# FinSightIQ — Complete Current Workflow

## 1. Prerequisites

```bash
node --version
npm --version
docker --version
docker compose version
curl --version
```

For local Ollama embeddings:

```bash
ollama serve
```

In another terminal:

```bash
ollama pull nomic-embed-text
curl -fsS http://127.0.0.1:11434/api/tags
```

## 2. Configure the Backend

```bash
cd /home/akuma/projects/FinSightIQ/backend

test -f .env || cp .env.example .env
```

Required values in `backend/.env` when the backend runs directly on the host:

```dotenv
DATABASE_URL=postgresql://finsight:finsight@localhost:5433/finsightiq
REDIS_URL=redis://localhost:6379

JWT_SECRET=replace-with-a-random-string-at-least-32-characters-long
JWT_EXPIRES_IN=1h
REFRESH_TOKEN_EXPIRES_DAYS=7

GROQ_API_KEY=your-groq-api-key
GROQ_BASE_URL=https://api.groq.com/openai/v1
GROQ_MODEL_HEAVY=llama-3.3-70b-versatile
GROQ_MODEL_MID=llama-3.1-8b-instant
GROQ_MODEL_FAST=llama-3.1-8b-instant

EMBEDDING_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
HUGGINGFACE_API_KEY=

EDGAR_USER_AGENT=FinSightIQ/1.0 your-real-email@domain.com

UPLOAD_DIR=./uploads
FRONTEND_ORIGIN=http://localhost:3000
PORT=4000
NODE_ENV=development
```

Install dependencies:

```bash
cd /home/akuma/projects/FinSightIQ/backend
npm install
```

## 3. Start PostgreSQL and Redis

```bash
cd /home/akuma/projects/FinSightIQ

docker compose up -d postgres redis
docker ps --format 'table {{.Names}}\t{{.Status}}'
```

## 4. Initialize the Database

The database was cleaned, so prompt templates must be seeded before using AI features.

```bash
cd /home/akuma/projects/FinSightIQ/backend

npm run migrate
npm run seed:prompts
npm run build
```

Verify prompt templates:

```bash
docker exec finsightiq-postgres \
  psql -U finsight -d finsightiq -c "
SELECT task, version, is_active
FROM prompt_templates
ORDER BY task, version;
"
```

## 5. Start the Backend

Keep this terminal running:

```bash
cd /home/akuma/projects/FinSightIQ/backend
npm run dev:raw
```

## 6. Health Check

Run in another terminal:

```bash
cd /home/akuma/projects/FinSightIQ

curl -fsS http://127.0.0.1:4000/health
docker ps --format 'table {{.Names}}\t{{.Status}}'
curl -fsS http://127.0.0.1:11434/api/tags
```

Expected backend health fields:

```text
status=ok
db=ok
redis=ok
cleanup_worker=idle
ingest_worker=idle
edgar_worker=idle
scan_worker=idle
```

---

# Real RBI Source Workflow

## 7. Run the Complete Real RBI Demo

This command:

- creates a disposable analyst and collection;
- downloads two related PDFs using direct links from the RBI index;
- validates each downloaded file as a PDF;
- stores and ingests both documents;
- extracts text and creates chunks;
- creates 768-dimensional embeddings;
- runs semantic search;
- runs document and collection summaries;
- runs a targeted contradiction scan;
- checks stale references;
- records WebSocket events and LLM audit logs.

```bash
cd /home/akuma/projects/FinSightIQ
set -o pipefail

SKIP_UPLOAD=1 \
RUN_RBI_LIVE=1 \
RUN_RBI_AI=1 \
RUN_RBI_CONTRADICTION=1 \
RBI_MAX_ENQUEUED=2 \
RBI_NAME_FILTER="Counterfeit Notes" \
WAIT_SECONDS=1800 \
COLLECTION_NAME="FinSightIQ RBI Live Demo" \
./scripts/phase2-ingestion-smoke.sh \
| tee /tmp/finsightiq-rbi-demo.log
```

Do not set `RBI_REQUIRE_CONTRADICTION=1` for the normal demo. Two real RBI documents may legitimately contain no contradiction.

## 8. Load the Generated RBI IDs

```bash
export RBI_USER_ID="$(
  sed -n 's/^USER_ID=//p' /tmp/finsightiq-rbi-demo.log | tail -1
)"

export RBI_COLLECTION_ID="$(
  sed -n 's/^COLLECTION_ID=//p' /tmp/finsightiq-rbi-demo.log | tail -1
)"

export RBI_DOCUMENT_A="$(
  sed -n 's/^RBI_DOCUMENT_A=//p' /tmp/finsightiq-rbi-demo.log | tail -1
)"

export RBI_DOCUMENT_B="$(
  sed -n 's/^RBI_DOCUMENT_B=//p' /tmp/finsightiq-rbi-demo.log | tail -1
)"

printf 'User: %s\nCollection: %s\nDocument A: %s\nDocument B: %s\n' \
  "$RBI_USER_ID" \
  "$RBI_COLLECTION_ID" \
  "$RBI_DOCUMENT_A" \
  "$RBI_DOCUMENT_B"
```

## 9. Show the Official RBI URLs

```bash
grep -E 'RBI direction queued|detailUrl|pdfUrl' \
  /tmp/finsightiq-seed-rbi-live.log
```

## 10. Verify RBI Ingestion, Chunks, and Embeddings

```bash
docker exec finsightiq-postgres \
  psql -U finsight -d finsightiq -c "
SELECT d.filename,
       d.source,
       d.source_identifier,
       d.effective_date,
       d.status AS document_status,
       j.status AS job_status,
       COUNT(c.id) AS chunks,
       COUNT(c.embedding) AS vectors,
       MIN(vector_dims(c.embedding)) AS dimensions
FROM documents d
JOIN document_ingestion_jobs j ON j.document_id = d.id
LEFT JOIN chunks c ON c.document_id = d.id
WHERE d.collection_id = '$RBI_COLLECTION_ID'
GROUP BY d.id,
         d.filename,
         d.source,
         d.source_identifier,
         d.effective_date,
         d.status,
         j.status
ORDER BY d.created_at;
"
```

#### RBI_AI_QUERY="${RBI_AI_QUERY:-What are the main requirements, eligibility rules, operational duties, and
  compliance obligations in this RBI direction?}"
  
## 11. Show the RBI Semantic Search Result

```bash
node -e '
const data = require("/tmp/finsightiq-rbi-search.json");

console.log("\nSEARCH ANSWER\n");
console.log(data.answer);

console.log("\nRETRIEVED SOURCES\n");
console.table(data.sources.map(source => ({
  document: source.documentName,
  chunk: source.chunkIndex,
  text: source.snippet
})));
'
```

## 12. Show the RBI Summaries

```bash
node -e '
const documentSummary =
  require("/tmp/finsightiq-rbi-document-summary.json");
const collectionSummary =
  require("/tmp/finsightiq-rbi-collection-summary.json");

console.log("\nDOCUMENT SUMMARY\n");
console.log(documentSummary.summary);
console.log("Tokens:", documentSummary.tokensUsed);

console.log("\nCOLLECTION SUMMARY\n");
console.log(collectionSummary.summary);
console.log("Documents:", collectionSummary.documentCount);
console.log("Tokens:", collectionSummary.tokensUsed);
'
```

## 13. Show Complete RBI Contradiction Details

```bash
node -e '
const data =
  require("/tmp/finsightiq-rbi-contradictions.json");

if (!data.contradictions.length) {
  console.log(
    "The scan completed successfully and found no contradiction."
  );
}

for (const [index, item] of data.contradictions.entries()) {
  console.log(`\n========== CONFLICT ${index + 1} ==========`);
  console.log(`Type: ${item.contradiction_type}`);
  console.log(`Severity: ${item.severity}`);
  console.log(`Document A: ${item.doc_a_name}`);
  console.log(`Section A: ${item.section_a || "Not specified"}`);
  console.log(`Claim A: ${item.claim_a}`);
  console.log(`Document B: ${item.doc_b_name}`);
  console.log(`Section B: ${item.section_b || "Not specified"}`);
  console.log(`Claim B: ${item.claim_b}`);
  console.log(`Explanation: ${item.explanation}`);
  console.log(`Resolved: ${item.is_resolved}`);
}
'
```

## 14. Show RBI Stale References

```bash
node -e '
const data =
  require("/tmp/finsightiq-rbi-stale-references.json");
console.table(data.staleReferences || []);
'
```

## 15. Show RBI WebSocket Events

```bash
docker exec finsightiq-postgres \
  psql -U finsight -d finsightiq -c "
SELECT seq,
       event_type,
       payload,
       created_at
FROM ws_events
WHERE collection_id = '$RBI_COLLECTION_ID'
ORDER BY seq;
"
```

## 16. Show RBI LLM Audit Logs

```bash
docker exec finsightiq-postgres \
  psql -U finsight -d finsightiq -c "
SELECT task,
       model,
       finish_reason,
       prompt_tokens,
       completion_tokens,
       latency_ms,
       error,
       created_at
FROM llm_logs
WHERE user_id = '$RBI_USER_ID'
ORDER BY created_at;
"
```

---

# Real SEBI Source Workflow

## 17. Check the Current SEBI Listing Without Writing Data

Use the RBI demo collection or another existing collection:

```bash
cd /home/akuma/projects/FinSightIQ/backend

SEED_COLLECTION_ID="$RBI_COLLECTION_ID" \
MAX_PAGES=1 \
npm run seed:sebi -- --dry-run
```

The output must contain:

```text
Parsed circular rows
[DRY RUN] would resolve PDF + enqueue
```

## 18. Ingest One Current SEBI PDF

```bash
cd /home/akuma/projects/FinSightIQ/backend

SEED_COLLECTION_ID="$RBI_COLLECTION_ID" \
MAX_PAGES=1 \
MAX_DOCS=1 \
npm run seed:sebi
```

## 19. Verify SEBI Ingestion

```bash
docker exec finsightiq-postgres \
  psql -U finsight -d finsightiq -c "
SELECT d.id,
       d.filename,
       d.source,
       d.source_identifier,
       d.effective_date,
       d.status AS document_status,
       j.status AS job_status,
       COUNT(c.id) AS chunks,
       COUNT(c.embedding) AS vectors
FROM documents d
JOIN document_ingestion_jobs j ON j.document_id = d.id
LEFT JOIN chunks c ON c.document_id = d.id
WHERE d.collection_id = '$RBI_COLLECTION_ID'
  AND d.source = 'SEBI'
GROUP BY d.id, j.status
ORDER BY d.created_at DESC;
"
```

---

# Deterministic Complete Phase 3 Workflow

## 20. Run the Full Deterministic AI Smoke Test

Use this workflow to guarantee that contradictions exist. It creates two controlled policy documents with deliberately conflicting rules.

```bash
cd /home/akuma/projects/FinSightIQ

RUN_RATE_LIMITS=1 \
CLEANUP=1 \
WAIT_SECONDS=1200 \
./scripts/phase3-ai-smoke.sh
```

This validates:

- user registration and authentication;
- analyst, compliance officer, and administrator roles;
- collection membership;
- document ingestion;
- chunks and embeddings;
- WebSocket room events;
- hybrid semantic and keyword search;
- document summarization;
- collection map-reduce summarization;
- asynchronous contradiction scans;
- targeted contradiction scans;
- contradiction resolution;
- annotations and WebSocket synchronization;
- stale-reference endpoint;
- collection risk summary;
- LLM audit logs;
- AI endpoint rate limits;
- cleanup.

## 21. Keep Smoke-Test Data for Inspection

```bash
cd /home/akuma/projects/FinSightIQ

RUN_RATE_LIMITS=1 \
CLEANUP=0 \
WAIT_SECONDS=1200 \
./scripts/phase3-ai-smoke.sh
```

Load the generated state:

```bash
set -a
source /tmp/finsightiq-phase3.env
set +a

printf 'Collection: %s\nDocument A: %s\nDocument B: %s\n' \
  "$COLLECTION_ID" \
  "$DOCUMENT_A" \
  "$DOCUMENT_B"
```

## 22. Show Deterministic Search and Conflict Results

```bash
node -e '
const search =
  require("/tmp/finsightiq-phase3-search.json");
const contradictions =
  require("/tmp/finsightiq-phase3-contradictions.json");

console.log("\nSEARCH ANSWER\n");
console.log(search.answer);

console.log("\nSEARCH SOURCES\n");
console.table(search.sources.map(source => ({
  document: source.documentName,
  chunk: source.chunkIndex,
  text: source.snippet
})));

for (const [index, item] of
  contradictions.contradictions.entries()) {
  console.log(`\n========== CONFLICT ${index + 1} ==========`);
  console.log(`Type: ${item.contradiction_type}`);
  console.log(`Severity: ${item.severity}`);
  console.log(`Document A: ${item.doc_a_name}`);
  console.log(`Claim A: ${item.claim_a}`);
  console.log(`Document B: ${item.doc_b_name}`);
  console.log(`Claim B: ${item.claim_b}`);
  console.log(`Explanation: ${item.explanation}`);
  console.log(`Resolved: ${item.is_resolved}`);
}
'
```

## 23. Show Deterministic WebSocket Events

```bash
node -e '
const fs = require("fs");
const file = process.env.WS_LOG;

for (const line of fs.readFileSync(file, "utf8").trim().split("\n")) {
  const event = JSON.parse(line);
  console.log(
    event.event,
    event.seq ?? "",
    JSON.stringify(event.payload ?? {})
  );
}
'
```

## 24. Delete Data Kept by the Deterministic Smoke Test

```bash
curl -fsS -X DELETE \
  "http://127.0.0.1:4000/api/collections/$COLLECTION_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

# EDGAR Workflow

## 25. Run an EDGAR Fetch Check

The `EDGAR_USER_AGENT` in `backend/.env` must contain real contact information.

```bash
cd /home/akuma/projects/FinSightIQ

SKIP_UPLOAD=1 \
RUN_EDGAR=1 \
EDGAR_TICKER=AAPL \
EDGAR_FILING_TYPE=10-K \
EDGAR_YEAR=2023 \
WAIT_SECONDS=1200 \
COLLECTION_NAME="FinSightIQ EDGAR Demo" \
./scripts/phase2-ingestion-smoke.sh
```

## 26. Check RBI, SEBI, and EDGAR Parsers Without Ingestion

```bash
cd /home/akuma/projects/FinSightIQ

SKIP_UPLOAD=1 \
RUN_SEED_DRY_RUNS=1 \
WAIT_SECONDS=1200 \
COLLECTION_NAME="FinSightIQ Source Parser Check" \
./scripts/phase2-ingestion-smoke.sh
```

---

# Test Workflow

## 27. Run Build and Conventional Unit Tests

```bash
cd /home/akuma/projects/FinSightIQ/backend
npm test
```

This covers:

- RBI direct-PDF parsing;
- SEBI listing and PDF parsing;
- date normalization;
- storage deletion and directory cleanup;
- path traversal rejection;
- fixed, sentence, and section-aware chunking;
- RAG 3/2/5 limits;
- vector-only handling for the query `CAR`.

## 28. Run the Full Phase 3 Acceptance Suite

The backend, PostgreSQL, Redis, Ollama, prompt templates, and Groq configuration must be available.

```bash
cd /home/akuma/projects/FinSightIQ/backend

RUN_EMBEDDING_FALLBACK=1 \
WAIT_SECONDS=1200 \
npm run test:phase3-acceptance
```

This checks:

- exact RAG retrieval limits;
- safe short and malicious-looking search queries;
- `presence:viewing`;
- failed-document retry route;
- annotation ownership and collection validation;
- missed WebSocket event replay;
- six-document parallel summarization;
- scan lock conflict;
- Redis centroid caching;
- exactly nine progress events for 45 pairs;
- stale-reference storage and broadcast;
- Groq → Hugging Face → Ollama embedding fallback.

## 29. Run Every Automated Test

```bash
cd /home/akuma/projects/FinSightIQ/backend

RUN_EMBEDDING_FALLBACK=1 \
WAIT_SECONDS=1200 \
npm run test:all
```

---

# Project Status Queries

## 30. Show All Collections and Documents

```bash
docker exec finsightiq-postgres \
  psql -U finsight -d finsightiq -c "
SELECT c.name AS collection,
       d.filename,
       d.source,
       d.status,
       d.created_at
FROM collections c
LEFT JOIN documents d ON d.collection_id = c.id
ORDER BY c.created_at, d.created_at;
"
```

## 31. Show Ingestion Jobs

```bash
docker exec finsightiq-postgres \
  psql -U finsight -d finsightiq -c "
SELECT d.filename,
       j.status,
       j.attempt_number,
       j.failure_reason,
       j.started_at,
       j.completed_at
FROM document_ingestion_jobs j
JOIN documents d ON d.id = j.document_id
ORDER BY j.created_at DESC;
"
```

## 32. Show AI Result Counts

```bash
docker exec finsightiq-postgres \
  psql -U finsight -d finsightiq -c "
SELECT
  (SELECT COUNT(*) FROM users) AS users,
  (SELECT COUNT(*) FROM collections) AS collections,
  (SELECT COUNT(*) FROM documents) AS documents,
  (SELECT COUNT(*) FROM chunks) AS chunks,
  (SELECT COUNT(*) FROM contradictions) AS contradictions,
  (SELECT COUNT(*) FROM stale_references) AS stale_references,
  (SELECT COUNT(*) FROM annotations) AS annotations,
  (SELECT COUNT(*) FROM llm_logs) AS llm_logs,
  (SELECT COUNT(*) FROM ws_events) AS ws_events;
"
```

## 33. Show Failed Documents

```bash
docker exec finsightiq-postgres \
  psql -U finsight -d finsightiq -c "
SELECT d.id,
       d.filename,
       d.status,
       j.status AS job_status,
       j.failure_reason
FROM documents d
JOIN document_ingestion_jobs j ON j.document_id = d.id
WHERE d.status = 'failed'
   OR j.status = 'failed'
ORDER BY j.created_at DESC;
"
```

---

# Clean Shutdown and Reset

## 34. Stop the Backend

In the backend terminal:

```text
Ctrl+C
```

## 35. Stop PostgreSQL and Redis

```bash
cd /home/akuma/projects/FinSightIQ
docker compose stop postgres redis
```

## 36. Optional Complete Data Reset

This permanently removes all application records while preserving the schema and migration history.

```bash
cd /home/akuma/projects/FinSightIQ
docker compose up -d postgres redis

docker exec finsightiq-postgres \
  psql -v ON_ERROR_STOP=1 -U finsight -d finsightiq -c "
TRUNCATE TABLE
  annotations,
  benchmark_runs,
  chunks,
  collection_members,
  collections,
  contradictions,
  document_ingestion_jobs,
  documents,
  llm_logs,
  prompt_templates,
  refresh_tokens,
  stale_references,
  users
RESTART IDENTITY CASCADE;
"

docker exec finsightiq-redis redis-cli FLUSHALL
find backend/uploads -mindepth 1 -delete
```

After a complete reset:

```bash
cd /home/akuma/projects/FinSightIQ/backend
npm run seed:prompts
```

Verify the reset:

```bash
docker exec finsightiq-postgres \
  psql -U finsight -d finsightiq -c "
SELECT
  (SELECT COUNT(*) FROM users) AS users,
  (SELECT COUNT(*) FROM collections) AS collections,
  (SELECT COUNT(*) FROM documents) AS documents,
  (SELECT COUNT(*) FROM chunks) AS chunks,
  (SELECT COUNT(*) FROM prompt_templates) AS prompts;
"

docker exec finsightiq-redis redis-cli DBSIZE
find backend/uploads -mindepth 1 -print
```

Expected reset result:

```text
users=0
collections=0
documents=0
chunks=0
prompts>0
Redis DB size=0
No output from the uploads find command
```
