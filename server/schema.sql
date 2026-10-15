-- ============================================================
-- VidMind Schema — Hybrid RAG + LangGraph Checkpointer
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- 1. TRANSCRIPTS — main vector + FTS table
-- ============================================================
CREATE TABLE IF NOT EXISTS transcripts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content     TEXT NOT NULL,
  metadata    JSONB NOT NULL DEFAULT '{}',
  vector      vector(768),                        -- gemini-embedding-001
  fts_vector  tsvector GENERATED ALWAYS AS (
                to_tsvector('english', content)
              ) STORED,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- HNSW index for ANN cosine search
CREATE INDEX IF NOT EXISTS transcripts_vector_hnsw_idx
  ON transcripts
  USING hnsw (vector vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- GIN index for full-text search
CREATE INDEX IF NOT EXISTS transcripts_fts_gin_idx
  ON transcripts
  USING gin (fts_vector);

-- JSONB index for video_id filter pushdown
CREATE INDEX IF NOT EXISTS transcripts_video_id_idx
  ON transcripts
  USING btree ((metadata->>'video_id'));

-- ============================================================
-- 2. VIDEO CATALOG — deduplication & metadata store
-- ============================================================
CREATE TABLE IF NOT EXISTS videos (
  video_id    TEXT PRIMARY KEY,
  title       TEXT,
  url         TEXT NOT NULL,
  duration    INT,
  chunk_count INT NOT NULL DEFAULT 0,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata    JSONB NOT NULL DEFAULT '{}'
);

-- ============================================================
-- 3. TRIGGER — keep videos.chunk_count in sync
-- ============================================================
CREATE OR REPLACE FUNCTION sync_video_chunk_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO videos (video_id, url, chunk_count)
    VALUES (
      NEW.metadata->>'video_id',
      COALESCE(NEW.metadata->>'url', ''),
      1
    )
    ON CONFLICT (video_id) DO UPDATE
      SET chunk_count = videos.chunk_count + 1;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE videos
    SET chunk_count = GREATEST(chunk_count - 1, 0)
    WHERE video_id = OLD.metadata->>'video_id';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_chunk_count ON transcripts;
CREATE TRIGGER trg_sync_chunk_count
AFTER INSERT OR DELETE ON transcripts
FOR EACH ROW EXECUTE FUNCTION sync_video_chunk_count();

-- ============================================================
-- 4. HYBRID SEARCH FUNCTION — BM25 + cosine via RRF
-- ============================================================
CREATE OR REPLACE FUNCTION hybrid_search(
  query_text      TEXT,
  query_vector    vector(768),
  top_k           INT     DEFAULT 5,
  video_id_filter TEXT    DEFAULT NULL,
  rrf_k           INT     DEFAULT 60,
  vector_weight   FLOAT   DEFAULT 0.7,
  bm25_weight     FLOAT   DEFAULT 0.3
)
RETURNS TABLE (
  id        UUID,
  content   TEXT,
  metadata  JSONB,
  rrf_score FLOAT,
  vec_rank  INT,
  bm25_rank INT
)
LANGUAGE sql STABLE AS $$
  WITH
  vec_ranked AS (
    SELECT
      t.id,
      ROW_NUMBER() OVER (ORDER BY t.vector <=> query_vector) AS rank
    FROM transcripts t
    WHERE
      video_id_filter IS NULL
      OR t.metadata->>'video_id' = video_id_filter
    ORDER BY t.vector <=> query_vector
    LIMIT top_k * 3
  ),
  bm25_ranked AS (
    SELECT
      t.id,
      ROW_NUMBER() OVER (
        ORDER BY ts_rank_cd(t.fts_vector, plainto_tsquery('english', query_text)) DESC
      ) AS rank
    FROM transcripts t
    WHERE
      t.fts_vector @@ plainto_tsquery('english', query_text)
      AND (video_id_filter IS NULL OR t.metadata->>'video_id' = video_id_filter)
    ORDER BY ts_rank_cd(t.fts_vector, plainto_tsquery('english', query_text)) DESC
    LIMIT top_k * 3
  ),
  fused AS (
    SELECT
      COALESCE(v.id, b.id) AS id,
      (
        COALESCE(vector_weight * (1.0 / (rrf_k + v.rank)), 0) +
        COALESCE(bm25_weight  * (1.0 / (rrf_k + b.rank)), 0)
      ) AS rrf_score,
      v.rank::INT AS vec_rank,
      b.rank::INT AS bm25_rank
    FROM vec_ranked  v
    FULL OUTER JOIN bm25_ranked b ON v.id = b.id
  )
  SELECT
    t.id,
    t.content,
    t.metadata,
    f.rrf_score,
    f.vec_rank,
    f.bm25_rank
  FROM fused f
  JOIN transcripts t ON t.id = f.id
  ORDER BY f.rrf_score DESC
  LIMIT top_k;
$$;

-- ============================================================
-- 5. LANGGRAPH CHECKPOINTER TABLES (PostgresSaver)
-- ============================================================
CREATE TABLE IF NOT EXISTS checkpoints (
  thread_id             TEXT   NOT NULL,
  checkpoint_ns         TEXT   NOT NULL DEFAULT '',
  checkpoint_id         TEXT   NOT NULL,
  parent_checkpoint_id  TEXT,                      -- required by newer langgraph
  parent_id             TEXT,
  type                  TEXT,
  checkpoint            JSONB  NOT NULL,
  metadata              JSONB  NOT NULL DEFAULT '{}',
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

CREATE TABLE IF NOT EXISTS checkpoint_blobs (
  thread_id     TEXT   NOT NULL,
  checkpoint_ns TEXT   NOT NULL DEFAULT '',
  channel       TEXT   NOT NULL,
  version       TEXT   NOT NULL,
  type          TEXT   NOT NULL,
  blob          BYTEA,
  PRIMARY KEY (thread_id, checkpoint_ns, channel, version)
);

CREATE TABLE IF NOT EXISTS checkpoint_writes (
  thread_id     TEXT  NOT NULL,
  checkpoint_ns TEXT  NOT NULL DEFAULT '',
  checkpoint_id TEXT  NOT NULL,
  task_id       TEXT  NOT NULL,
  idx           INT   NOT NULL,
  channel       TEXT  NOT NULL,
  type          TEXT,
  blob          BYTEA,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);

-- ============================================================
-- 6. ANALYTICAL VIEWS
-- ============================================================
CREATE OR REPLACE VIEW video_retrieval_stats AS
SELECT
  metadata->>'video_id'   AS video_id,
  COUNT(*)                 AS total_chunks,
  MIN(created_at)          AS first_indexed,
  MAX(created_at)          AS last_indexed
FROM transcripts
GROUP BY metadata->>'video_id';

CREATE OR REPLACE VIEW thread_activity AS
SELECT
  thread_id,
  COUNT(*)               AS checkpoint_count,
  MIN((checkpoint->>'ts')::timestamptz) AS started_at,
  MAX((checkpoint->>'ts')::timestamptz) AS last_active
FROM checkpoints
GROUP BY thread_id
ORDER BY last_active DESC;