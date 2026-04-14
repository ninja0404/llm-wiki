-- HNSW vector index on wiki_pages.embedding (cosine distance)
CREATE INDEX IF NOT EXISTS wiki_pages_embedding_hnsw_idx
ON wiki_pages USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- HNSW vector index on source_chunks.embedding (cosine distance)
CREATE INDEX IF NOT EXISTS source_chunks_embedding_hnsw_idx
ON source_chunks USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- GIN FTS index on wiki_pages (title + content)
CREATE INDEX IF NOT EXISTS wiki_pages_fts_idx
ON wiki_pages USING gin (
  to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, ''))
);

-- GIN trigram index on wiki_pages.title (for pg_trgm fuzzy matching)
CREATE INDEX IF NOT EXISTS wiki_pages_title_trgm_idx
ON wiki_pages USING gin (title gin_trgm_ops);
