---
phase: 1
name: "Database Indexes & Search Hardening"
status: planned
---

# Plan: Database Indexes & Search Hardening

## Goal

补全关键数据库索引 (HNSW, GIN FTS, GIN trigram)，从 db:push 切换到 db:migrate 版本化迁移，搜索引擎增加 NULL embedding 降级。

## Requirements Covered

- DB-01: HNSW 向量索引
- DB-02: GIN FTS 索引
- DB-03: GIN trigram 索引
- DB-04: Drizzle 迁移切换
- SRCH-01: embedding IS NULL 降级
- SRCH-02: 搜索性能验证

## Read First

- `api/src/db/schema/source.ts` — vector custom type 定义
- `api/src/db/schema/wiki.ts` — wiki_pages 表定义
- `api/src/search/engine.ts` — 搜索引擎实现
- `api/drizzle.config.ts` — Drizzle Kit 配置
- `scripts/init-db.sql` — 数据库初始化 SQL

## Acceptance Criteria

1. `drizzle-kit generate` 成功生成迁移文件
2. `drizzle-kit migrate` 成功应用迁移
3. HNSW 索引在 wiki_pages.embedding 和 source_chunks.embedding 上存在
4. GIN tsvector 索引在 wiki_pages 上存在
5. GIN trigram 索引在 wiki_pages.title 上存在
6. 搜索在 wiki_pages 含 NULL embedding 行时不报错，降级为纯 FTS
7. 所有现有功能不受影响 (不回归)

## Tasks

### Task 1: 生成 Drizzle 初始迁移

**What:** 运行 `drizzle-kit generate` 从现有 schema 生成初始迁移文件

**Steps:**
1. 确保 `api/drizzle/` 目录不存在 (首次迁移)
2. 运行 `cd api && pnpm exec drizzle-kit generate`
3. 验证迁移 SQL 文件生成在 `api/drizzle/` 目录
4. 检查生成的 SQL 是否包含所有表定义

**Files to modify:**
- 无 (drizzle-kit 自动生成)

**Verification:**
- `api/drizzle/` 目录下有 `.sql` 迁移文件

---

### Task 2: 创建手写 SQL 迁移 — 索引

**What:** 创建手写 SQL 迁移文件，添加 pgvector HNSW 索引、GIN FTS 索引、GIN trigram 索引

**Steps:**
1. 在 `api/drizzle/` 目录创建新的 SQL 迁移文件
2. 添加以下索引:

```sql
-- HNSW 向量索引 (wiki_pages)
CREATE INDEX CONCURRENTLY IF NOT EXISTS wiki_pages_embedding_hnsw_idx
ON wiki_pages USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- HNSW 向量索引 (source_chunks)
CREATE INDEX CONCURRENTLY IF NOT EXISTS source_chunks_embedding_hnsw_idx
ON source_chunks USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- GIN FTS 索引 (wiki_pages)
CREATE INDEX CONCURRENTLY IF NOT EXISTS wiki_pages_fts_idx
ON wiki_pages USING gin (
  to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, ''))
);

-- GIN trigram 索引 (wiki_pages.title)
CREATE INDEX CONCURRENTLY IF NOT EXISTS wiki_pages_title_trgm_idx
ON wiki_pages USING gin (title gin_trgm_ops);
```

3. 创建 Drizzle Kit 自定义迁移 meta 条目使其可被 `drizzle-kit migrate` 识别

**Files to create:**
- `api/drizzle/XXXX_add_search_indexes.sql` (迁移文件)

**Verification:**
- 迁移文件语法正确
- `\d wiki_pages` 显示新索引
- `\d source_chunks` 显示 HNSW 索引

---

### Task 3: 搜索引擎 NULL embedding 降级

**What:** 修改 `api/src/search/engine.ts`，当向量搜索因无 embedding 失败时降级为纯 FTS

**Steps:**
1. 修改 `vectorSearch()` 函数:
   - 捕获 embedding 生成失败异常
   - 返回空数组而非抛出错误 (当前已处理)
2. 修改 `hybridSearch()` 函数:
   - 当 vectorResults 为空时，rrfMerge 仅使用 ftsResults
   - 结果中标注 matchType 为 'fts' 而非 'hybrid'
3. 验证当所有 wiki_pages.embedding 为 NULL 时:
   - fullTextSearch 正常执行
   - vectorSearch 返回空数组不报错
   - hybridSearch 返回纯 FTS 结果

**Files to modify:**
- `api/src/search/engine.ts`

**Verification:**
- 搜索在含 NULL embedding 行时不报错
- 返回结果的 matchType 正确反映实际搜索方式

---

### Task 4: 更新 package.json 脚本

**What:** 确保 db:migrate 脚本可用，标注 db:push 为 dev-only

**Steps:**
1. 验证 `api/package.json` 中 `db:migrate` 脚本存在: `"db:migrate": "drizzle-kit migrate"`
2. 添加注释或重命名 `db:push` 为 `db:push:dev` (可选)
3. 更新根 `package.json` 中的 `db:migrate` 代理脚本

**Files to modify:**
- `api/package.json` (可能无需修改，已有正确脚本)
- `package.json` (根级代理脚本)

**Verification:**
- `pnpm db:migrate` 在根目录可执行
- 迁移成功应用到数据库

---

### Task 5: 验证并提交

**What:** 端到端验证所有索引创建成功，搜索降级正常工作

**Steps:**
1. 启动 Docker 服务: `docker compose up -d`
2. 运行迁移: `cd api && pnpm exec drizzle-kit migrate`
3. 验证索引存在:
   ```sql
   SELECT indexname FROM pg_indexes WHERE tablename = 'wiki_pages';
   SELECT indexname FROM pg_indexes WHERE tablename = 'source_chunks';
   ```
4. 验证搜索引擎降级行为
5. 提交所有变更

**Verification:**
- 所有 5 个新索引在 pg_indexes 中可查
- 搜索 API 正常工作
