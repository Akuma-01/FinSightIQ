# FinSightIQ

Financial document intelligence for regulatory comparison, contradiction detection, research benchmarking, and real-time review workflows.

FinSightIQ ingests public financial/regulatory documents, extracts text, chunks and embeds them, runs hybrid retrieval and LLM-based analysis, broadcasts scan/annotation events over WebSocket, and exposes the workflow through a Next.js frontend.

## Current stack

- Backend: Express 5, TypeScript, PostgreSQL + pgvector, Redis, BullMQ, raw WebSocket
- Frontend: Next.js 16 App Router, React 19, Tailwind CSS, Recharts, Monaco editor
- AI: Groq or Ollama LLM provider routing; Ollama/Groq/Hugging Face embedding provider routing
- Storage: local uploads for development
- Research: manually labeled ground-truth pairs, benchmark runs, LLM audit logs, export endpoints

## Quick start

### 1. Configure backend

```bash
cd backend
cp .env.example .env
```

Set at minimum:

```env
JWT_SECRET=replace-with-a-long-random-secret
DATABASE_URL=postgresql://finsight:finsight@localhost:5433/finsightiq
REDIS_URL=redis://localhost:6379
LLM_PROVIDER=ollama
EMBEDDING_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
```

For Groq demos, set:

```env
LLM_PROVIDER=groq
GROQ_API_KEY=...
```

### 2. Start services

```bash
docker compose up -d postgres redis
```

If using Ollama locally:

```bash
ollama serve
ollama pull llama3.2:3b
```

### 3. Migrate and seed

```bash
cd backend
npm install
npm run migrate
npm run seed:prompts
```

### 4. Start backend

```bash
cd backend
npm run dev
```

Health check:

```bash
curl -fsS http://127.0.0.1:4000/health
```

### 5. Start frontend

```bash
cd frontend
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

## Full local Docker dev

After backend `.env` is configured:

```bash
docker compose up -d
```

Services:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:4000`
- PostgreSQL: localhost port `5433`
- Redis: localhost port `6379`

## Main demo workflow

1. Register/login as an analyst or admin.
2. Create a collection.
3. Upload two regulatory PDFs or use an existing seeded collection.
4. Wait until documents become `ready`.
5. Open collection → `Compare two documents`.
6. Select two documents and run targeted scan.
7. Watch `contradiction:new` events appear in real time.
8. Open `Contradictions` dashboard to filter, review, and resolve results.
9. Open a document viewer and create/update/delete annotations.
10. Open `Research` as admin/researcher to review benchmark metrics and export CSV.

## Useful scripts

Backend:

```bash
cd backend
npm run build
npm run test:e2e
```

Frontend:

```bash
cd frontend
npm run lint
npm run build
```

RBI live ingestion smoke:

```bash
SKIP_UPLOAD=1 \
RUN_RBI_LIVE=1 \
RUN_RBI_AI=1 \
RUN_RBI_CONTRADICTION=1 \
RBI_MAX_ENQUEUED=2 \
RBI_NAME_FILTER="Counterfeit Notes" \
WAIT_SECONDS=1800 \
COLLECTION_NAME="FinSightIQ RBI Live Demo" \
./scripts/phase2-ingestion-smoke.sh
```

## Research and benchmark data

See [RESEARCH.md](./RESEARCH.md) for:

- ground-truth construction
- benchmark run IDs
- F1/precision/recall results
- hallucination benchmark
- prompt sensitivity benchmark
- chunking strategy benchmark
- dataset-size and local-model caveats

Current results should be treated as pilot-scale research evidence, not production accuracy claims. The project is successful when the workflow is observable, auditable, and its limitations are measured clearly.

## Important caveats

- Groq free-tier limits can interrupt long benchmarks.
- Local `llama3.2:3b` is useful for development but has weaker structured JSON reliability than larger hosted models.
- Research metrics depend heavily on the manually labeled dataset size and quality.
- Cloud deployment/R2 migration require external credentials and are intentionally not committed.
