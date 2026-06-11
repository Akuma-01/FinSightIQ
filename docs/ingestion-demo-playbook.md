# FinSightIQ Live Demo Runbook: Asynchronous RBI PDF Ingestion Pipeline

This playbook details the end-to-end process for verifying the asynchronous, event-driven data ingestion pipeline using a live regulatory document from the Reserve Bank of India (RBI). It is fully synchronized with the project's PostgreSQL database schema, BullMQ background worker loops, and real-time WebSocket messaging layer.

---

## Step 1: Start Infrastructure Containers

Launch the decoupled stateful core storage and message broker instances in detached mode.

```bash
docker compose up -d postgres redis
```

**Why:** PostgreSQL handles relational structures (`users`, `collections`, `documents`, `chunks`, `ws_events`). Redis powers both asynchronous background job states via BullMQ and multi-instance WebSocket pub/sub scaling.

**Verification:** Run `docker ps` to verify that both `finsightiq-postgres` and `finsightiq-redis` display an active, healthy status.

---

## Step 2: Prepare Backend Runtime Environment

Compile the source code and apply database migrations to ensure your system schema is up to date.

```bash
cd backend
npm run migrate
npm run build
```

**Why:** `npm run migrate` runs structural SQL files to create core tables. `npm run build` verifies that your TypeScript codebase compiles cleanly with no static typing issues.

---

## Step 3: Initialize the Local Embedding Provider

Ensure that your local embedding provider is configured and listening for tensor extraction requests.

```bash
ollama pull nomic-embed-text
ollama serve
```

**Why:** After the PDF text layer is split into discrete chunks, each chunk is passed to the embedding service to compute a 768-dimensional coordinate vector matching the `VECTOR(768)` constraint in your schema.

> **Note:** Keep this running in an isolated terminal node. Your `.env` file must map `EMBEDDING_PROVIDER=ollama` and `OLLAMA_BASE_URL=http://localhost:11434`.

---

## Step 4: Boot Backend Server Processes

Launch the main execution script to spin up the primary network instances.

```bash
npm run dev:raw
```

**Why:** This initializes the core Express API, the HTTP upgrade handler for WebSockets, and activates the standalone BullMQ worker consumers (`ingest.worker.ts`, `edgar.worker.ts`).

**Verification:** Run a health query in a separate terminal:

```bash
curl http://127.0.0.1:4000/health
```

**Expected JSON Response:**

```json
{
  "status": "ok",
  "db": "ok",
  "redis": "ok",
  "ingest_worker": "idle",
  "edgar_worker": "idle"
}
```

---

## Step 5: Acquire Live RBI Regulatory Document

Download a valid, text-layered, multi-page Master Direction document directly from the live RBI archive page.

```bash
curl -L "https://rbidocs.rbi.org.in/rdocs/notification/PDFs/NT659345C515D1A6498FB2250162B0A9D21A.PDF" -o /tmp/rbi-demo.pdf
```

Validate document integrity and magic header bytes before ingestion:

```bash
file /tmp/rbi-demo.pdf
head -c 4 /tmp/rbi-demo.pdf
```

**Expected Output:** `%PDF`

> **Risk Warning:** If header bytes are missing or corrupt, your parsing middleware will reject the file upload. Ensure you use a verified text-based PDF. If an image-only scan is selected, `pdf-parse` will return fewer than 200 characters and your ingestion worker will flag an extraction error.

---

## Step 6: Provision Analyst User Identity

Register a new analyst account in your access registry to test RBAC logic.

```bash
curl -X POST http://127.0.0.1:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "rbi-demo@example.com",
    "password": "Password123!",
    "displayName": "RBI Demo User",
    "role": "analyst"
  }'
```

---

## Step 7: Authenticate Session and Lock Environment Token

Log in to generate an active JWT session.

```bash
curl -X POST http://127.0.0.1:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "rbi-demo@example.com",
    "password": "Password123!"
  }'
```

Export the returned token into your active terminal shell environment variables:

```bash
export TOKEN="PASTE_RETURNED_ACCESS_TOKEN_STRING_HERE"
```

---

## Step 8: Provision an Isolated Document Collection Space

Create a new compliance collection workspace locked to the `section_aware` processing strategy.

```bash
curl -X POST http://127.0.0.1:4000/api/collections \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "RBI Demo Collection",
    "chunkingStrategy": "section_aware"
  }'
```

Freeze the returned collection UUID into your terminal environment:

```bash
export COLLECTION_ID="PASTE_RETURNED_COLLECTION_UUID_HERE"
```

---

## Step 9: Establish Real-Time WebSocket Connection Node

Open a new, separate terminal window to act as your client interface. Re-export your token and spin up a real-time WebSocket connection client:

```bash
export TOKEN="PASTE_THE_SAME_ACCESS_TOKEN_HERE"
npx wscat -c "ws://127.0.0.1:4000/ws?token=$TOKEN"
```

Once the initial handshake is successfully authorized by `ws.auth.ts`, push a structured JSON client action payload to attach to your real-time collection space:

```json
{"action":"join","collectionId":"PASTE_ACTUAL_COLLECTION_UUID_HERE"}
```

**Expected Inbound Event State:** The server will instantly push a state synchronization frame containing the current space context:

```json
{
  "event": "room:state",
  "payload": {
    "activeUsers": [
      {"userId": "...","displayName": "RBI Demo User","role": "analyst"}
    ],
    "recentEvents": []
  }
}
```

---

## Step 10: Inject PDF Binary Streams into Ingestion Gateway

Return to your primary API terminal and execute a multi-part form data upload to your collection document endpoint.

```bash
curl -i -X POST "http://127.0.0.1:4000/api/collections/$COLLECTION_ID/documents" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/rbi-demo.pdf;type=application/pdf"
```

**Expected Response:** The gateway immediately passes back an HTTP `202 Accepted` code with active job IDs, leaving the user interface unblocked.

```json
{
  "documentId": "78caac66-f550-4657-a2a6-84721af13146",
  "jobId": "165a92ff-a920-41bc-8b8f-562192308878",
  "status": "processing",
  "filename": "rbi-demo.pdf"
}
```

Freeze these tracking tokens into your execution shell:

```bash
export DOCUMENT_ID="PASTE_RETURNED_DOCUMENT_UUID_HERE"
export JOB_ID="PASTE_RETURNED_JOB_UUID_HERE"
```

---

## Step 11: Monitor Database and Background Queue Transitions

Query the relational state-tracking tables inside your PostgreSQL container to verify that your data layer mirrors the real-time background queue states.

```bash
docker exec finsightiq-postgres psql -U finsight -d finsightiq -c "
SELECT id, filename, status FROM documents WHERE id = '$DOCUMENT_ID';
"

docker exec finsightiq-postgres psql -U finsight -d finsightiq -c "
SELECT id, status, attempt_number, failure_reason FROM document_ingestion_jobs WHERE id = '$JOB_ID';
"
```

**Expected Final State (after several seconds):** `documents.status` transitions to `'ready'`, and `document_ingestion_jobs.status` transitions to `'completed'`.

---

## Step 12: Validate Deep Chunk and Schema Vector Insertions

Verify that the `pdf-parse` string extractor successfully handed text payloads down to the factory chunkers, saving valid text vectors to the database rows.

```bash
docker exec finsightiq-postgres psql -U finsight -d finsightiq -c "
SELECT COUNT(*) AS chunk_count FROM chunks WHERE document_id = '$DOCUMENT_ID';
"
```

Run a structural inspection query to verify your text-splitting boundaries and confirm that your section-matching regex correctly parsed titles into their respective `section_label` attributes:

```bash
docker exec finsightiq-postgres psql -U finsight -d finsightiq -c "
SELECT chunk_index, section_label, LEFT(chunk_text, 100) AS text_preview, chunking_strategy 
FROM chunks 
WHERE document_id = '$DOCUMENT_ID' 
ORDER BY chunk_index ASC LIMIT 5;
"
```

---

## Step 13: Intercept Real-Time System Updates

Look at your secondary active `wscat` connection terminal. The moment the background worker finishes computing embeddings and commits the transactions, verify that a `document:ready` broadcast hits your client listener node:

```json
{
  "event": "document:ready",
  "timestamp": "2026-06-10T14:02:00.000Z",
  "payload": {
    "documentId": "78caac66-f550-4657-a2a6-84721af13146",
    "filename": "rbi-demo.pdf",
    "chunkCount": 6
  }
}
```

---

## Step 14: Audit the Persistent Event Ledger

Query the historical message table inside PostgreSQL to prove that all cross-server notifications are assigned sequential `seq` values for drop recovery compliance.

```bash
docker exec finsightiq-postgres psql -U finsight -d finsightiq -c "
SELECT seq, event_type, LEFT(payload::text, 120) AS payload_preview 
FROM ws_events 
WHERE collection_id = '$COLLECTION_ID' 
ORDER BY seq ASC;
"
```

**Expected Rows:** You should see recorded entries for `presence:join` and `document:ready` bound to sequential `seq` values.
