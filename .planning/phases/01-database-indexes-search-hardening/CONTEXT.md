# Phase 1 Context: Database Indexes & Search Hardening

## Phase Goal

补全关键数据库索引，确保搜索性能达到 SLA 要求，并从 db:push 切换到版本化迁移。

## Decisions

### HNSW 向量索引参数

**Decision:** 使用 pgvector 默认参数 `m=16, ef_construction=64`

**Rationale:** 中小规模 (万级页面) 下默认值性能足够，后期可通过 REINDEX 调整参数。避免过度优化。

**Implementation notes:**
- 需在 `wiki_pages.embedding` 和 `source_chunks.embedding` 两列上分别创建 HNSW 索引
- 使用 cosine distance operator `vector_cosine_ops`
- 索引创建为 SQL migration，不通过 Drizzle schema（Drizzle 不原生支持 pgvector 索引）

### 迁移策略

**Decision:** 完全切换到 `db:migrate`，废弃 `db:push`

**Rationale:** 生产环境必须使用版本化迁移管理 schema 变更。db:push 不记录历史，无法回滚。

**Implementation notes:**
- 运行 `drizzle-kit generate` 生成初始迁移文件
- 后续 schema 变更只通过 `drizzle-kit generate` + `drizzle-kit migrate`
- 手写 SQL migration 用于 pgvector HNSW 索引和 GIN 索引（Drizzle 不支持的索引类型）
- 保留 `db:push` 脚本但标注为 "dev-only, not for production"

### FTS 语言配置

**Decision:** 保持 `'english'` 分词器

**Rationale:** 当前产品面向英文内容场景。中文搜索需要额外的 zhparser 扩展和分语言索引，增加复杂度。后续可通过新增索引扩展。

**Implementation notes:**
- `to_tsvector('english', ...)` 和 `to_tsquery('english', ...)` 保持不变
- GIN 索引基于 english 分词器的 tsvector 计算列

## Existing Code Reference

### 当前搜索实现
- `api/src/search/engine.ts` — 混合搜索引擎，vector + FTS + RRF
- 向量搜索使用 `<=>` 余弦距离操作符，无索引 (全表扫描)
- FTS 使用 `to_tsvector`/`to_tsquery`，无 GIN 索引 (全表扫描)

### 当前 Schema
- `api/src/db/schema/source.ts` — 定义了 `vector` custom type (`vector(1536)`)
- `api/src/db/schema/wiki.ts` — `wiki_pages` 表包含 `embedding` 列
- `scripts/init-db.sql` — 已创建 `vector` 和 `pg_trgm` 扩展

### Drizzle 配置
- `api/drizzle.config.ts` — 迁移输出目录 `./drizzle`
- 当前无 `drizzle/` 迁移目录

## Scope Boundary

**In scope:**
- HNSW/GIN/trigram 索引创建
- Drizzle 迁移生成
- 搜索引擎 NULL embedding 降级

**Out of scope:**
- 中文搜索支持
- 搜索性能压测工具
- 搜索结果排序调优

## Deferred Ideas

(None)

---
*Created: 2026-04-14 during phase discussion*
