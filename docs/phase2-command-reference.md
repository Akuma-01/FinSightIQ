# Phase 2 Command Reference

Reusable commands for running and verifying the Phase 2 ingestion, EDGAR, and seed workflows.

Run commands from the project root unless a step says otherwise:

```bash
cd /home/akuma/projects/FinSightIQ
```

## Start Runtime

Start Postgres and Redis:

```bash
docker compose up -d postgres redis
```

Start the backend:

```bash
cd backend
npm run migrate
npm run build
npm run dev:raw
```

Keep the backend terminal open.

Check health:

```bash
curl http://127.0.0.1:4000/health
```

## Smoke Tests

Full Phase 2 smoke test:

```bash
RUN_ALL=1 PDF_PATH="/mnt/c/Users/anura/OneDrive/Desktop/2025KYC.pdf" ./scripts/phase2-ingestion-smoke.sh
```

Fast full check without re-uploading the PDF:

```bash
SKIP_UPLOAD=1 RUN_ALL=1 ./scripts/phase2-ingestion-smoke.sh
```

PDF upload and ingestion only:

```bash
PDF_PATH="/mnt/c/Users/anura/OneDrive/Desktop/2025KYC.pdf" ./scripts/phase2-ingestion-smoke.sh
```

EDGAR only:

```bash
SKIP_UPLOAD=1 RUN_EDGAR=1 ./scripts/phase2-ingestion-smoke.sh
```

Seed dry-runs only:

```bash
SKIP_UPLOAD=1 RUN_SEED_DRY_RUNS=1 ./scripts/phase2-ingestion-smoke.sh
```

EDGAR rate limit only:

```bash
SKIP_UPLOAD=1 RUN_EDGAR_RATE_LIMIT=1 ./scripts/phase2-ingestion-smoke.sh
```

## Collection ID

List recent collections:

```bash
docker exec finsightiq-postgres psql -U finsight -d finsightiq -c "
SELECT id, name, created_at
FROM collections
ORDER BY created_at DESC
LIMIT 5;
"
```

Export a collection id:

```bash
export SEED_COLLECTION_ID="PASTE_COLLECTION_ID_HERE"
```

## EDGAR Seed

Create a ticker file:

```bash
cat > /tmp/tickers.csv <<'EOF'
AAPL
MSFT
EOF
```

Dry-run:

```bash
cd /home/akuma/projects/FinSightIQ/backend
SEED_COLLECTION_ID="$SEED_COLLECTION_ID" TICKER_FILE=/tmp/tickers.csv npm run seed:edgar -- --dry-run
```

Real run:

```bash
SEED_COLLECTION_ID="$SEED_COLLECTION_ID" TICKER_FILE=/tmp/tickers.csv npm run seed:edgar
```

## RBI Seed

Dry-run:

```bash
cd /home/akuma/projects/FinSightIQ/backend
SEED_COLLECTION_ID="$SEED_COLLECTION_ID" npm run seed:rbi -- --dry-run
```

Safe real test with one document:

```bash
SEED_COLLECTION_ID="$SEED_COLLECTION_ID" MAX_DOCS=1 npm run seed:rbi
```

Small real batch:

```bash
SEED_COLLECTION_ID="$SEED_COLLECTION_ID" MAX_DOCS=3 npm run seed:rbi
```

Avoid running the full RBI seed casually. The RBI index can contain hundreds of rows, and local Ollama embedding can take a long time.

## SEBI Seed

Dry-run:

```bash
cd /home/akuma/projects/FinSightIQ/backend
SEED_COLLECTION_ID="$SEED_COLLECTION_ID" MAX_PAGES=1 npm run seed:sebi -- --dry-run
```

Real run:

```bash
SEED_COLLECTION_ID="$SEED_COLLECTION_ID" MAX_PAGES=1 npm run seed:sebi
```

Current note: SEBI dry-run reached the site but parsed zero rows during testing, so the selector may need future adjustment.

## Verification Queries

Documents:

```bash
docker exec finsightiq-postgres psql -U finsight -d finsightiq -c "
SELECT id, filename, source, doc_type, status, created_at
FROM documents
ORDER BY created_at DESC
LIMIT 10;
"
```

Jobs:

```bash
docker exec finsightiq-postgres psql -U finsight -d finsightiq -c "
SELECT id, document_id, status, attempt_number, failure_reason, completed_at
FROM document_ingestion_jobs
ORDER BY created_at DESC
LIMIT 10;
"
```

Chunks and embeddings:

```bash
docker exec finsightiq-postgres psql -U finsight -d finsightiq -c "
SELECT document_id,
       COUNT(*) AS chunks,
       COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS chunks_with_vectors
FROM chunks
GROUP BY document_id
ORDER BY chunks DESC
LIMIT 10;
"
```

WebSocket events:

```bash
docker exec finsightiq-postgres psql -U finsight -d finsightiq -c "
SELECT event_type, payload, created_at
FROM ws_events
ORDER BY created_at DESC
LIMIT 10;
"
```

EDGAR cache:

```bash
redis-cli -u redis://localhost:6379 TTL "edgar:AAPL:10-K:2023"
```

## Cleanup

Delete all collections and related DB rows:

```bash
docker exec finsightiq-postgres psql -U finsight -d finsightiq -c "
DELETE FROM collections;
"
```

Clear local upload files after raw SQL deletion:

```bash
find backend/uploads -mindepth 1 -maxdepth 1 -type d -exec rm -rf {} +
```

Verify clean DB state:

```bash
docker exec finsightiq-postgres psql -U finsight -d finsightiq -c "
SELECT 'collections' AS table_name, COUNT(*) FROM collections
UNION ALL SELECT 'documents', COUNT(*) FROM documents
UNION ALL SELECT 'chunks', COUNT(*) FROM chunks
UNION ALL SELECT 'collection_members', COUNT(*) FROM collection_members
UNION ALL SELECT 'document_ingestion_jobs', COUNT(*) FROM document_ingestion_jobs
UNION ALL SELECT 'ws_events', COUNT(*) FROM ws_events;
"
```

Verify uploads are empty:

```bash
find backend/uploads -mindepth 1 -maxdepth 2 -print
```
