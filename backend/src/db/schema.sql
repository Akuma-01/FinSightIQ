CREATE EXTENSION IF NOT EXISTS vector;

-- Users
CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL
                   CHECK (role IN ('admin','analyst','compliance_officer','researcher')),
  display_name   TEXT NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Refresh tokens
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Document collections
CREATE TABLE IF NOT EXISTS collections (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  description        TEXT,
  created_by         UUID NOT NULL REFERENCES users(id),
  chunking_strategy  TEXT NOT NULL DEFAULT 'sentence'
                       CHECK (chunking_strategy IN
                         ('fixed_256','fixed_512','sentence','section_aware')),
  embedding_model    TEXT NOT NULL DEFAULT 'nomic-embed-text'
                       CONSTRAINT chk_collections_embedding_model
                       CHECK (embedding_model IN ('nomic-embed-text')),
  archived           BOOLEAN DEFAULT FALSE,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE collections ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE;
ALTER TABLE collections ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'collections' AND column_name = 'is_archived'
  ) THEN
    EXECUTE 'UPDATE collections SET archived = is_archived WHERE archived IS DISTINCT FROM is_archived';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_collections_created_by ON collections(created_by);

-- Documents
CREATE TABLE IF NOT EXISTS documents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id      UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  uploaded_by        UUID REFERENCES users(id),
  filename           TEXT NOT NULL,
  original_name      TEXT NOT NULL,
  mime_type          TEXT NOT NULL,
  size_bytes         BIGINT NOT NULL,
  doc_type           TEXT NOT NULL
                       CHECK (doc_type IN
                         ('regulatory_circular','internal_policy','earnings_filing',
                          'loan_policy','product_policy','contract','other')),
  source             TEXT,
  source_identifier  TEXT,
  effective_date     DATE,
  storage_key        TEXT,
  local_path         TEXT,
  raw_text           TEXT,
  status             TEXT NOT NULL DEFAULT 'processing'
                       CHECK (status IN ('processing','ready','failed')),
  failure_reason     TEXT,
  page_count         INT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE documents ADD COLUMN IF NOT EXISTS original_name TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS mime_type TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS size_bytes BIGINT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
UPDATE documents SET original_name = filename WHERE original_name IS NULL;
UPDATE documents SET mime_type = 'application/octet-stream' WHERE mime_type IS NULL;
UPDATE documents SET size_bytes = 0 WHERE size_bytes IS NULL;

CREATE INDEX IF NOT EXISTS idx_documents_collection_id ON documents(collection_id);
CREATE INDEX IF NOT EXISTS idx_documents_source        ON documents(source);
CREATE INDEX IF NOT EXISTS idx_documents_status        ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_doc_type      ON documents(doc_type);

-- Document ingestion jobs: durable DB state mirrors BullMQ work.
CREATE TABLE IF NOT EXISTS document_ingestion_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  collection_id   UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  bullmq_job_id   TEXT,
  status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','running','completed','failed')),
  attempt_number  INT NOT NULL DEFAULT 0,
  failure_reason  TEXT,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE document_ingestion_jobs ADD COLUMN IF NOT EXISTS collection_id UUID REFERENCES collections(id) ON DELETE CASCADE;
ALTER TABLE document_ingestion_jobs ADD COLUMN IF NOT EXISTS attempt_number INT NOT NULL DEFAULT 0;
ALTER TABLE document_ingestion_jobs ADD COLUMN IF NOT EXISTS failure_reason TEXT;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'document_ingestion_jobs' AND column_name = 'attempt'
  ) THEN
    EXECUTE 'UPDATE document_ingestion_jobs SET attempt_number = attempt';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'document_ingestion_jobs' AND column_name = 'error'
  ) THEN
    EXECUTE 'UPDATE document_ingestion_jobs SET failure_reason = error WHERE failure_reason IS NULL';
  END IF;
END $$;
UPDATE document_ingestion_jobs dij
SET collection_id = d.collection_id
FROM documents d
WHERE dij.document_id = d.id AND dij.collection_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_document_id   ON document_ingestion_jobs(document_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_collection_id ON document_ingestion_jobs(collection_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status        ON document_ingestion_jobs(status);

-- Chunks + embeddings
CREATE TABLE IF NOT EXISTS chunks (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id        UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  collection_id      UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  chunk_index        INT NOT NULL,
  chunk_text         TEXT NOT NULL,
  section_label      TEXT,
  embedding          VECTOR(768),
  chunk_text_tsv     TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', chunk_text)) STORED,
  chunking_strategy  TEXT NOT NULL
                       CHECK (chunking_strategy IN
                         ('fixed_256','fixed_512','sentence','section_aware')),
  token_count        INT,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE chunks ADD COLUMN IF NOT EXISTS chunk_text_tsv TSVECTOR
  GENERATED ALWAYS AS (to_tsvector('english', chunk_text)) STORED;

CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_chunks_collection_strategy ON chunks(collection_id, chunking_strategy);
CREATE INDEX IF NOT EXISTS idx_chunks_document_id         ON chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_fts                 ON chunks USING GIN(chunk_text_tsv);

-- Prompt templates
CREATE TABLE IF NOT EXISTS prompt_templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task         TEXT NOT NULL
                 CHECK (task IN
                   ('detect_contradictions_financial','summarize_document',
                    'summarize_collection','semantic_search','classify_severity',
                    'extract_references','stale_check','benchmark')),
  version      INT NOT NULL,
  body         TEXT NOT NULL,
  description  TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (task, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_templates_active_task
  ON prompt_templates(task) WHERE is_active = TRUE;

-- Collection members
CREATE TABLE IF NOT EXISTS collection_members (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id  UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_role    TEXT NOT NULL DEFAULT 'viewer'
                   CHECK (access_role IN ('owner','editor','viewer')),
  added_by       UUID REFERENCES users(id),
  added_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (collection_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_collection_members_collection ON collection_members(collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_members_user       ON collection_members(user_id);

-- Contradictions
CREATE TABLE IF NOT EXISTS contradictions (
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

CREATE INDEX IF NOT EXISTS idx_contradictions_collection_id ON contradictions(collection_id);
CREATE INDEX IF NOT EXISTS idx_contradictions_severity      ON contradictions(severity);
CREATE INDEX IF NOT EXISTS idx_contradictions_resolved      ON contradictions(is_resolved);
CREATE INDEX IF NOT EXISTS idx_contradictions_type          ON contradictions(contradiction_type);
CREATE INDEX IF NOT EXISTS idx_contradictions_dedup         ON contradictions(collection_id, doc_a_id, doc_b_id);

-- Stale references
CREATE TABLE IF NOT EXISTS stale_references (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id            UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  collection_id          UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  referenced_identifier  TEXT NOT NULL,
  referenced_body        TEXT NOT NULL,
  current_identifier     TEXT,
  section                TEXT,
  is_resolved            BOOLEAN DEFAULT FALSE,
  resolved_by            UUID REFERENCES users(id),
  resolved_at            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stale_refs_document_id   ON stale_references(document_id);
CREATE INDEX IF NOT EXISTS idx_stale_refs_collection_id ON stale_references(collection_id);

-- Annotations
CREATE TABLE IF NOT EXISTS annotations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id      UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  collection_id    UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  created_by       UUID NOT NULL REFERENCES users(id),
  chunk_id         UUID REFERENCES chunks(id),
  body             TEXT NOT NULL,
  annotation_type  TEXT DEFAULT 'comment'
                     CHECK (annotation_type IN ('comment','flag','question')),
  is_resolved      BOOLEAN DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_annotations_document_id   ON annotations(document_id);
CREATE INDEX IF NOT EXISTS idx_annotations_collection_id ON annotations(collection_id);

-- WebSocket events
CREATE TABLE IF NOT EXISTS ws_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id  UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  seq            BIGINT NOT NULL,
  event_type     TEXT NOT NULL,
  payload        JSONB NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ws_events_collection_seq ON ws_events(collection_id, seq);
CREATE INDEX IF NOT EXISTS idx_ws_events_created_at     ON ws_events(created_at);

-- LLM logs
CREATE TABLE IF NOT EXISTS llm_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES users(id),
  endpoint            TEXT NOT NULL,
  task                TEXT NOT NULL,
  prompt_version_id   UUID REFERENCES prompt_templates(id),
  prompt              TEXT NOT NULL,
  response            TEXT NOT NULL,
  response_truncated  BOOLEAN DEFAULT FALSE,
  model               TEXT NOT NULL,
  prompt_tokens       INT,
  completion_tokens   INT,
  latency_ms          INT,
  finish_reason       TEXT CHECK (finish_reason IN ('stop','length','error')),
  error               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_logs_model           ON llm_logs(model);
CREATE INDEX IF NOT EXISTS idx_llm_logs_task            ON llm_logs(task);
CREATE INDEX IF NOT EXISTS idx_llm_logs_prompt_version  ON llm_logs(prompt_version_id);
CREATE INDEX IF NOT EXISTS idx_llm_logs_created_at      ON llm_logs(created_at);

-- Benchmark runs
CREATE TABLE IF NOT EXISTS benchmark_runs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_by             UUID REFERENCES users(id),
  benchmark_type     TEXT NOT NULL
                       CHECK (benchmark_type IN
                         ('chunking_strategy','model_comparison',
                          'hallucination','prompt_sensitivity')),
  prompt_version_id  UUID REFERENCES prompt_templates(id),
  parameters         JSONB NOT NULL,
  metrics            JSONB NOT NULL DEFAULT '{}',
  total_samples      INT,
  notes              TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_benchmark_runs_type            ON benchmark_runs(benchmark_type);
CREATE INDEX IF NOT EXISTS idx_benchmark_runs_date            ON benchmark_runs(created_at);
CREATE INDEX IF NOT EXISTS idx_benchmark_runs_prompt_version  ON benchmark_runs(prompt_version_id);

-- Ground-truth labels used by the Phase 4 benchmark runners.
CREATE TABLE IF NOT EXISTS ground_truth_pairs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_a_filename      TEXT NOT NULL,
  doc_b_filename      TEXT NOT NULL,
  doc_a_id            UUID REFERENCES documents(id),
  doc_b_id            UUID REFERENCES documents(id),
  contradiction_type  TEXT,
  severity            TEXT,
  claim_a_snippet     TEXT,
  claim_b_snippet     TEXT,
  section_a           TEXT,
  section_b           TEXT,
  is_contradiction    BOOLEAN NOT NULL,
  labeler_note        TEXT,
  prompt_version_id   UUID REFERENCES prompt_templates(id),
  imported_at         TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_ground_truth_pair
    UNIQUE (doc_a_filename, doc_b_filename, contradiction_type, section_a, section_b, is_contradiction)
);

-- Upgrade databases created before the uniqueness constraint was introduced.
DELETE FROM ground_truth_pairs older
USING ground_truth_pairs newer
WHERE older.ctid < newer.ctid
  AND older.doc_a_filename = newer.doc_a_filename
  AND older.doc_b_filename = newer.doc_b_filename
  AND older.contradiction_type IS NOT DISTINCT FROM newer.contradiction_type
  AND older.section_a IS NOT DISTINCT FROM newer.section_a
  AND older.section_b IS NOT DISTINCT FROM newer.section_b
  AND older.is_contradiction = newer.is_contradiction;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uq_ground_truth_pair'
      AND conrelid = 'ground_truth_pairs'::regclass
      AND pg_get_constraintdef(oid) NOT LIKE '%contradiction_type%'
  ) THEN
    ALTER TABLE ground_truth_pairs DROP CONSTRAINT uq_ground_truth_pair;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_ground_truth_pair'
  ) THEN
    ALTER TABLE ground_truth_pairs
      ADD CONSTRAINT uq_ground_truth_pair
      UNIQUE (doc_a_filename, doc_b_filename, contradiction_type, section_a, section_b, is_contradiction);
  END IF;
END $$;

DO $$
BEGIN
  ALTER TABLE collection_members DROP CONSTRAINT IF EXISTS collection_members_access_role_check;
  UPDATE collection_members SET access_role = 'viewer' WHERE access_role = 'member';
  ALTER TABLE collection_members ALTER COLUMN access_role SET DEFAULT 'viewer';
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'collection_members_access_role_phase2_check'
  ) THEN
    ALTER TABLE collection_members
      ADD CONSTRAINT collection_members_access_role_phase2_check
      CHECK (access_role IN ('owner','editor','viewer'));
  END IF;
END $$;
