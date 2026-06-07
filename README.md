# FinSightIQ

FinSightIQ is a work-in-progress backend prototype for real-time financial document intelligence and regulatory contradiction detection. The target system, described in `FinSightIQ_SRS.md`, combines document ingestion, PostgreSQL + pgvector storage, BullMQ workers, WebSocket collaboration, and LLM-powered retrieval/contradiction workflows for financial compliance use cases.

The project is currently in active backend development. Core API infrastructure and data modeling are in place, while the full RAG/LLM research pipeline and frontend experience are still being built.

## Active Development

This repository is not production-ready yet. The current implementation is focused on proving the backend foundation: schema design, authentication, collections, document upload, ingestion queue wiring, health checks, rate limiting, and WebSocket room/presence behavior.

| Status | Area | Current State |
|---|---|---|
| [⚡ Done] | Relational schema design & PostgreSQL setup | Core tables are defined for users, refresh tokens, collections, documents, ingestion jobs, chunks, prompt templates, contradictions, stale references, annotations, WebSocket events, LLM logs, and benchmark runs. |
| [⚡ Done] | Express server foundation | Express 5 server, config validation, structured logging, request IDs, global error handling, auth routes, RBAC middleware, rate limiting, file upload middleware, and health checks are implemented. |
| [⚡ Done] | Authentication & authorization | JWT access tokens, refresh token rotation, role-based middleware, and collection membership checks are implemented. |
| [⚡ Done] | Collection and document APIs | Collection CRUD/member routes and document upload/list/delete/retry handlers are implemented with type-safe route parameter validation. |
| [⚡ Done] | WebSocket foundation | WebSocket auth, room joins/leaves, Redis pub/sub fan-out, presence state, ping/pong, and persisted WebSocket event replay support are implemented. |
| [🔄 In Progress] | Ingestion pipeline worker | BullMQ ingest queue and PDF/text parsing, chunking, embedding, chunk persistence, and document-ready/document-failed broadcasts are implemented, but worker startup and end-to-end ingestion still need full integration testing. |
| [🔄 In Progress] | Chunking and embedding | Fixed, sentence, and section-aware chunkers exist; embedding service supports provider routing/fallbacks, but retrieval quality testing is still pending. |
| [🔄 In Progress] | Operational resilience | Redis-backed rate limiting, cleanup worker, health reporting, and fail-open behavior are present; broader failure-mode tests are still ongoing. |
| [📅 Planned] | Custom LLM middleware routing | Prompt templates exist, but the model router, normalized LLM response layer, contradiction service, and LLM logging workflow still need implementation. |
| [📅 Planned] | Hybrid retrieval and semantic search | Database schema supports vector and full-text search, but production-grade hybrid retrieval, citation formatting, and benchmark validation are not complete yet. |
| [📅 Planned] | EDGAR integration | EDGAR files and configuration placeholders exist, but the controller, queue, and worker implementation are not complete. |
| [📅 Planned] | Research dashboard and evaluation | `RESEARCH.md` defines methodology, but benchmark runs, metric collection, and dashboard/reporting are not implemented yet. |
| [📅 Planned] | Frontend application | The SRS targets a Next.js frontend, but the current repository is backend-focused. |

## Current Backend Stack

- Node.js + TypeScript
- Express 5
- PostgreSQL + pgvector
- Redis + BullMQ
- `ws` WebSocket server
- Pino logging
- Zod validation
- Multer upload handling
- Local disk storage adapter

## Development Notes

The backend can be built with:

```bash
cd backend
npm run build
```

Local dependencies are defined in `docker-compose.yml`:

```bash
docker compose up -d postgres redis
```

When the backend is running, health is available at:

```bash
curl http://localhost:4000/health
```

See `FinSightIQ_SRS.md` for the full product requirements and `RESEARCH.md` for the evaluation methodology.
