-- Embedding model migration support (dual-column approach)
-- New columns for v2 embeddings with potentially different dimensions/model

ALTER TABLE wiki_pages ADD COLUMN IF NOT EXISTS embedding_v2 vector(1536);
ALTER TABLE wiki_pages ADD COLUMN IF NOT EXISTS embedding_v2_model text;

ALTER TABLE source_chunks ADD COLUMN IF NOT EXISTS embedding_v2 vector(1536);
ALTER TABLE source_chunks ADD COLUMN IF NOT EXISTS embedding_v2_model text;

-- Migration status tracking
ALTER TABLE wiki_pages ADD COLUMN IF NOT EXISTS embedding_migrated boolean DEFAULT false;
ALTER TABLE source_chunks ADD COLUMN IF NOT EXISTS embedding_migrated boolean DEFAULT false;

-- HNSW index on new columns (once populated, search uses these)
CREATE INDEX IF NOT EXISTS wiki_pages_embedding_v2_hnsw_idx
ON wiki_pages USING hnsw (embedding_v2 vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS source_chunks_embedding_v2_hnsw_idx
ON source_chunks USING hnsw (embedding_v2 vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
