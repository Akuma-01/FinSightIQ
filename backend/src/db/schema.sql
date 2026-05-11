CREATE EXTENSION IF NOT EXISTS vector;

-- ─────────────────────────────────────────────
-- Users
-- ─────────────────────────────────────────────
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL
                  CHECK (role IN ('admin','analyst','compliance_officer','researcher')),
  display_name  TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- Refresh tokens
-- ─────────────────────────────────────────────
CREATE TABLE refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked    BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- Document Collections
-- chunking_strategy locked after first document added
-- embedding_model locked at collection creation — mixing providers corrupts similarity scores
-- ─────────────────────────────────────────────
CREATE TABLE collections (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  description         TEXT,
  created_by          UUID NOT NULL REFERENCES users(id),
  chunking_strategy   TEXT NOT NULL DEFAULT 'sentence'
                        CHECK (chunking_strategy IN
                          ('fixed_256','fixed_512','sentence','section_aware')),
  embedding_model     TEXT NOT NULL DEFAULT 'nomic-embed-text'
                        CONSTRAINT chk_collections_embedding_model
                        CHECK (embedding_model IN
                          ('nomic-embed-text')),
                        -- extend CHECK as new embedding models are supported
                        -- locked at creation: changing requires full re-embedding of all chunks
                        -- named constraint allows: ALTER TABLE collections
                        --   DROP CONSTRAINT chk_collections_embedding_model,
                        --   ADD CONSTRAINT chk_collections_embedding_model CHECK (...);
  is_archived         BOOLEAN DEFAULT FALSE,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_collections_created_by ON collections(created_by);

-- ─────────────────────────────────────────────
-- Documents
-- ─────────────────────────────────────────────
CREATE TABLE documents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id    UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  uploaded_by      UUID REFERENCES users(id),
  filename         TEXT NOT NULL,
  doc_type         TEXT NOT NULL
                     CHECK (doc_type IN
                       ('regulatory_circular','internal_policy','earnings_filing',
                        'loan_policy','product_policy','contract','other')),
  source           TEXT,                  -- 'SEC_EDGAR' | 'RBI' | 'SEBI' | 'manual'
  source_identifier TEXT,                 -- ticker, circular number, filing ID etc.
  effective_date   DATE,                  -- regulatory effective date if applicable
  storage_key      TEXT,                  -- NULL for MVP (local disk); populated in Phase 5 (R2)
  local_path       TEXT,                  -- used during MVP phases — path on local disk
  raw_text         TEXT,                  -- extracted plain text stored directly in DB for MVP
  status           TEXT NOT NULL DEFAULT 'processing'
                     CHECK (status IN ('processing','ready','failed')),
  failure_reason   TEXT,
  page_count       INT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_documents_collection_id ON documents(collection_id);
CREATE INDEX idx_documents_source        ON documents(source);
CREATE INDEX idx_documents_status        ON documents(status);
CREATE INDEX idx_documents_doc_type      ON documents(doc_type);

-- ─────────────────────────────────────────────
-- Document Ingestion Jobs (durable — survives Redis restarts)
-- ─────────────────────────────────────────────
CREATE TABLE document_ingestion_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  bullmq_job_id TEXT,
  status        TEXT NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','running','completed','failed')),
  attempt       INT NOT NULL DEFAULT 0,
  error         TEXT,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ingestion_jobs_document_id ON document_ingestion_jobs(document_id);
CREATE INDEX idx_ingestion_jobs_status      ON document_ingestion_jobs(status);

-- ─────────────────────────────────────────────
-- Chunks + Embeddings
-- VECTOR(768) = nomic-embed-text. NOT 1536 (OpenAI).
-- Switching models requires schema migration + full re-embedding.
-- ─────────────────────────────────────────────
CREATE TABLE chunks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id       UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  collection_id     UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  chunk_index       INT NOT NULL,
  chunk_text        TEXT NOT NULL,
  section_label     TEXT,                -- extracted section header if section-aware chunking
  embedding         VECTOR(768),
  chunking_strategy TEXT NOT NULL
                      CHECK (chunking_strategy IN
                        ('fixed_256','fixed_512','sentence','section_aware')),
  token_count       INT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- HNSW: no cold-start problem, works from 0 vectors
CREATE INDEX idx_chunks_embedding ON chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_chunks_collection_strategy ON chunks(collection_id, chunking_strategy);

-- BM25 full-text search index for hybrid retrieval keyword leg
-- Used to find chunks containing sparse regulatory terms (circular IDs, rates, dates)
ALTER TABLE chunks ADD COLUMN chunk_text_tsv TSVECTOR
  GENERATED ALWAYS AS (to_tsvector('english', chunk_text)) STORED;

CREATE INDEX idx_chunks_fts ON chunks USING GIN(chunk_text_tsv);

-- ─────────────────────────────────────────────
-- Prompt Templates (versioned per task)
-- ─────────────────────────────────────────────
CREATE TABLE prompt_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task        TEXT NOT NULL
                CHECK (task IN
                  ('detect_contradictions_financial','summarize_document',
                   'summarize_collection','semantic_search','classify_severity',
                   'extract_references','stale_check','benchmark')),
  version     INT NOT NULL,
  body        TEXT NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (task, version)
);

CREATE UNIQUE INDEX idx_prompt_templates_active_task
  ON prompt_templates(task) WHERE is_active = TRUE;

-- ─────────────────────────────────────────────
-- Collection Members (access control)
-- Analysts can only interact with collections they are members of.
-- Admins bypass this check at middleware level.
-- ─────────────────────────────────────────────
CREATE TABLE collection_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_role   TEXT NOT NULL DEFAULT 'member'
                  CHECK (access_role IN ('owner', 'member')),
  added_by      UUID REFERENCES users(id),
  added_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (collection_id, user_id)
);

CREATE INDEX idx_collection_members_collection ON collection_members(collection_id);
CREATE INDEX idx_collection_members_user       ON collection_members(user_id);

-- ─────────────────────────────────────────────
-- Contradictions
-- v2.0: Unique constraint relaxed to allow multiple contradictions of the same
-- TYPE between the same document pair, provided they occur in different sections.
-- v1.0 constraint (collection, doc_a, doc_b, type) would silently drop a second
-- policy_conflict in a different section of the same two documents.
-- Soft deduplication check in contradiction.service.ts handles exact-text duplicates.
-- ─────────────────────────────────────────────
CREATE TABLE contradictions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id       UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  doc_a_id            UUID NOT NULL REFERENCES documents(id),
  doc_b_id            UUID NOT NULL REFERENCES documents(id),
  contradiction_type  TEXT NOT NULL
                        CHECK (contradiction_type IN
                          ('policy_conflict','regulatory_breach',
                           'numerical_discrepancy','stale_reference',
                           'definitional_conflict')),
  severity            TEXT NOT NULL CHECK (severity IN ('critical','moderate','minor')),
  claim_a             TEXT NOT NULL,
  claim_b             TEXT NOT NULL,
  section_a           TEXT,
  section_b           TEXT,
  explanation         TEXT NOT NULL,
  model_used          TEXT NOT NULL,
  is_resolved         BOOLEAN DEFAULT FALSE,
  resolved_by         UUID REFERENCES users(id),
  resolved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT uq_contradiction_per_section
    UNIQUE (collection_id, doc_a_id, doc_b_id, contradiction_type, section_a, section_b)
);

CREATE INDEX idx_contradictions_collection_id ON contradictions(collection_id);
CREATE INDEX idx_contradictions_severity      ON contradictions(severity);
CREATE INDEX idx_contradictions_resolved      ON contradictions(is_resolved);
CREATE INDEX idx_contradictions_type          ON contradictions(contradiction_type);
-- Composite index serving the hot deduplication pre-insert check in §6.5 Step 2:
-- WHERE collection_id = $1 AND doc_a_id = $2 AND doc_b_id = $3 AND contradiction_type = $4
CREATE INDEX idx_contradictions_dedup
  ON contradictions(collection_id, doc_a_id, doc_b_id);

-- ─────────────────────────────────────────────
-- Stale References
-- ─────────────────────────────────────────────
CREATE TABLE stale_references (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id          UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  collection_id        UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  referenced_identifier TEXT NOT NULL,
  referenced_body      TEXT NOT NULL,
  current_identifier   TEXT,
  section              TEXT,
  is_resolved          BOOLEAN DEFAULT FALSE,
  resolved_by          UUID REFERENCES users(id),
  resolved_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_stale_refs_document_id   ON stale_references(document_id);
CREATE INDEX idx_stale_refs_collection_id ON stale_references(collection_id);

-- ─────────────────────────────────────────────
-- Annotations (collaborative)
-- ─────────────────────────────────────────────
CREATE TABLE annotations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  created_by    UUID NOT NULL REFERENCES users(id),
  chunk_id      UUID REFERENCES chunks(id),
  body          TEXT NOT NULL,
  annotation_type TEXT DEFAULT 'comment'
                    CHECK (annotation_type IN ('comment','flag','question')),
                    -- 'resolved' removed from enum — resolution is a state, not a type.
                    -- Use is_resolved to close an annotation regardless of its type.
  is_resolved   BOOLEAN DEFAULT FALSE,
                    -- Set TRUE when a compliance officer or admin closes the annotation.
                    -- Decoupled from annotation_type so a 'flag' or 'question' can be
                    -- resolved without changing its semantic classification.
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_annotations_document_id   ON annotations(document_id);
CREATE INDEX idx_annotations_collection_id ON annotations(collection_id);

-- ─────────────────────────────────────────────
-- WebSocket Events (for missed event replay on reconnect)
-- Older events purged: keep last 1000 per collection
-- ─────────────────────────────────────────────
CREATE TABLE ws_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  seq           BIGINT NOT NULL,
  event_type    TEXT NOT NULL,
  payload       JSONB NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ws_events_collection_seq ON ws_events(collection_id, seq);
CREATE INDEX idx_ws_events_created_at     ON ws_events(created_at);

-- ─────────────────────────────────────────────
-- LLM Logs
-- ─────────────────────────────────────────────
CREATE TABLE llm_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES users(id),
  endpoint            TEXT NOT NULL,
  task                TEXT NOT NULL,
  prompt_version_id   UUID REFERENCES prompt_templates(id),
  prompt              TEXT NOT NULL,
  response            TEXT NOT NULL,
  -- response is stored truncated to 4,000 characters to bound row size.
  -- Long contradiction JSON responses (70B model on dense regulatory pairs)
  -- can exceed 5KB. Truncation is logged via response_truncated flag.
  -- Full response is always available in the LLM call trace if needed.
  response_truncated  BOOLEAN DEFAULT FALSE,
  model               TEXT NOT NULL,
  prompt_tokens       INT,
  completion_tokens   INT,
  latency_ms          INT,
  finish_reason       TEXT CHECK (finish_reason IN ('stop','length','error')),
  error               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_llm_logs_model           ON llm_logs(model);
CREATE INDEX idx_llm_logs_task            ON llm_logs(task);
CREATE INDEX idx_llm_logs_prompt_version  ON llm_logs(prompt_version_id);
CREATE INDEX idx_llm_logs_created_at      ON llm_logs(created_at);

-- ─────────────────────────────────────────────
-- Benchmark Runs
-- ─────────────────────────────────────────────
CREATE TABLE benchmark_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_by           UUID REFERENCES users(id),
  benchmark_type   TEXT NOT NULL
                     CHECK (benchmark_type IN
                       ('chunking_strategy','model_comparison',
                        'hallucination','prompt_sensitivity')),
  prompt_version_id UUID REFERENCES prompt_templates(id),
  -- Direct FK column (not buried in parameters JSONB) so benchmark runs
  -- can be indexed and joined by prompt version without JSONB extraction.
  -- All benchmark_runs MUST set this field — enforced at service layer.
  parameters       JSONB NOT NULL,
  -- v2.0: Fixed columns (precision_at_k, recall_at_k, f1_score) replaced with
  -- JSONB metrics. Different benchmark_types have different valid metrics:
  --   chunking_strategy:  { precision_at_k, recall_at_k, mrr, k }
  --   model_comparison:   { f1, precision, recall, model, contradiction_type }
  --   hallucination:      { f1_per_model: { model_name: f1 }, total_samples }
  --   prompt_sensitivity: { f1_by_version: { version: f1 }, delta }
  -- This prevents mixing metric types in the same column across benchmark types.
  metrics          JSONB NOT NULL DEFAULT '{}',
  total_samples    INT,
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_benchmark_runs_type            ON benchmark_runs(benchmark_type);
CREATE INDEX idx_benchmark_runs_date            ON benchmark_runs(created_at);
CREATE INDEX idx_benchmark_runs_prompt_version  ON benchmark_runs(prompt_version_id);
