-- Fact Knowledge Layer — initial schema
-- Run with: psql $DATABASE_URL -f 001_init_schema.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "vector";    -- pgvector

-- ─────────────────────────────────────────────
-- documents: one row per uploaded PDF
-- ─────────────────────────────────────────────
CREATE TABLE documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename          TEXT NOT NULL,
  file_path         TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'processing'
                       CHECK (status IN ('processing', 'done', 'failed')),
  total_chunks      INT,
  processed_chunks  INT NOT NULL DEFAULT 0,
  error             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- chunks: raw text sent to the LLM, kept for evidence tracing
-- ─────────────────────────────────────────────
CREATE TABLE chunks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index   INT NOT NULL,
  page_start    INT,
  page_end      INT,
  text          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX chunks_document_idx ON chunks (document_id);

-- ─────────────────────────────────────────────
-- facts: extracted claims, grounded in a chunk's quote
-- attributes is intentionally schemaless — the LLM's output shape
-- decides what fields exist (metric, unit, period, entity, etc.)
-- ─────────────────────────────────────────────
CREATE TABLE facts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_id      UUID NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  statement     TEXT NOT NULL,           -- normalized fact, e.g. "Annual revenue was $10M in FY2023"
  quote         TEXT NOT NULL,           -- verbatim evidence from the source chunk
  attributes    JSONB NOT NULL DEFAULT '{}',
  embedding     VECTOR(1536),            -- dimension must match your embedding model
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX facts_document_idx ON facts (document_id);
CREATE INDEX facts_chunk_idx ON facts (chunk_id);
CREATE INDEX facts_attributes_idx ON facts USING GIN (attributes);
-- HNSW index for fast approximate nearest-neighbor search on embeddings
CREATE INDEX facts_embedding_idx ON facts USING hnsw (embedding vector_cosine_ops);

-- ─────────────────────────────────────────────
-- fact_relationships: verdicts from comparing two facts
-- fact_a_id is always the lexicographically smaller UUID (enforced by app code
-- or the trigger below) so (A,B) and (B,A) never both get inserted.
-- ─────────────────────────────────────────────
CREATE TABLE fact_relationships (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fact_a_id           UUID NOT NULL REFERENCES facts(id) ON DELETE CASCADE,
  fact_b_id           UUID NOT NULL REFERENCES facts(id) ON DELETE CASCADE,
  relationship_type   TEXT NOT NULL
                         CHECK (relationship_type IN
                           ('corroborates', 'contradicts', 'contextual_explanation', 'unrelated')),
  confidence          FLOAT,
  explanation         TEXT NOT NULL,     -- LLM's reasoning, shown to the user
  similarity_score    FLOAT,             -- cosine similarity that triggered the comparison
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (fact_a_id, fact_b_id),
  CHECK (fact_a_id <> fact_b_id)
);

CREATE INDEX fact_relationships_a_idx ON fact_relationships (fact_a_id);
CREATE INDEX fact_relationships_b_idx ON fact_relationships (fact_b_id);

-- Enforce canonical ordering at the DB level, so app code can insert either order
CREATE OR REPLACE FUNCTION order_fact_relationship() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.fact_a_id > NEW.fact_b_id THEN
    NEW.fact_a_id := NEW.fact_a_id # NEW.fact_b_id;
    NEW.fact_b_id := NEW.fact_a_id # NEW.fact_b_id;
    NEW.fact_a_id := NEW.fact_a_id # NEW.fact_b_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Note: UUID doesn't support XOR (#) — swap via a temp variable instead.
DROP FUNCTION order_fact_relationship;

CREATE OR REPLACE FUNCTION order_fact_relationship() RETURNS TRIGGER AS $$
DECLARE
  tmp UUID;
BEGIN
  IF NEW.fact_a_id > NEW.fact_b_id THEN
    tmp := NEW.fact_a_id;
    NEW.fact_a_id := NEW.fact_b_id;
    NEW.fact_b_id := tmp;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fact_relationships_order
  BEFORE INSERT OR UPDATE ON fact_relationships
  FOR EACH ROW EXECUTE FUNCTION order_fact_relationship();

-- ─────────────────────────────────────────────
-- keep documents.updated_at fresh
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER documents_touch_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();