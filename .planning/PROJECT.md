# LLM Wiki — Phase 0 Completion & Production Hardening

## What This Is

LLM Wiki 是一个企业级多租户 SaaS 知识库产品。用户上传原始资料（文本/URL），LLM 自动提取实体并构建互相链接的 Wiki 知识库，支持语义+全文混合搜索、RAG 对话式查询、知识图谱可视化。基于 Karpathy 的 LLM Wiki 方法论，从"个人文件夹 + CLI"升级为"多租户 Web 产品"。

## Core Value

用户上传资料后，LLM 自动构建高质量、互相链接的 Wiki 知识库，知识不断复利积累。

## Requirements

### Validated

- ✓ Docker 开发环境 (PostgreSQL+pgvector + PgBouncer + Redis + MinIO) — existing
- ✓ Monorepo 脚手架 (api/ + web/ + packages/shared/) — existing
- ✓ Drizzle Schema 基本表结构 (auth, workspace, source, wiki, chat, system) — existing
- ✓ Better Auth 集成 (email/password + organization plugin) — existing
- ✓ LLM 抽象层 (Provider Router + generateObject/Zod + AES-256 加密) — existing
- ✓ LLM 韧性 (熔断 + 超时 + Token 预扣/修正 + 成本追踪) — existing
- ✓ Extract Pipeline (chunker → embedding → LLM extract → slugify → merge) — existing
- ✓ Wiki 构建 (extractions → hybrid index lookup → create/update/flag → link validation) — existing
- ✓ 搜索引擎 (pgvector cosine + FTS ts_rank + RRF 合并) — existing
- ✓ WebSocket 基础设施 (鉴权 + workspace 房间 + Redis Pub/Sub + useWs hook + 重连) — existing
- ✓ 前端框架 (React 19 + Vite 6 + Router + Layout + AuthGuard + Dashboard) — existing
- ✓ Activity Log + Pino 日志 + Worker 心跳 — existing
- ✓ Source 管理 (文本/URL 输入 + SSRF 防护 + content_hash 去重 + ingest_state 进度) — existing
- ✓ 并发控制 (CAS + lock_version + 2 次重试 + tenant Redis 并发限制) — existing
- ✓ Chat 对话 (conversations + messages + streaming SSE) — existing
- ✓ Graph View (react-force-graph-2d 知识图谱) — existing
- ✓ Bull Board 队列仪表盘 — existing
- ✓ 数据库索引 (HNSW + GIN FTS + trigram) — Phase 0 Completion
- ✓ Lint Worker (孤立页面 + 断裂链接检测) — Phase 0 Completion
- ✓ MinIO 文件上传集成 — Phase 0 Completion
- ✓ 生产环境配置 (CORS/Auth 环境变量化 + 密钥校验) — Phase 0 Completion
- ✓ Docker 容器化 (API + Worker + Web) — Phase 0 Completion
- ✓ Wiki 版本历史 UI — Phase 0 Completion
- ✓ 批次串行执行 — Phase 0 Completion
- ✓ Health Check 增强 (DB + Redis + Worker) — Phase 0 Completion

### Active

- [ ] 文件解析 (PDF/DOCX/HTML) — 扩展文件上传支持
- [ ] 多 LLM Provider + Fallback — Claude/DeepSeek/自定义端点
- [ ] API 多层限流 — 全局/租户级/端点级
- [ ] Wiki 页面版本 diff 查看 — 前后对比
- [ ] Source 撤销 — 删除 Source 后受影响页面标记 flagged
- [ ] Wiki 页面 Redis 缓存 — 读多写少场景优化
- [ ] 查询结果 Redis 缓存 — 相同问题直接返回
- [ ] Embedding 模型迁移工具 — 双列方案

### Out of Scope

- SSO/SAML — Phase 2 范围
- 开放 API + API Key 管理 + Scalar 文档 — Phase 2 范围
- 私有化部署 Helm Chart — Phase 2 范围
- 计费系统 — Phase 2 范围
- 团队协作 (评论/审批流) — Phase 2 范围
- 测试基础设施 — 单独规划

## Context

### 现有代码库状态

项目已完成约 80% 的 Phase 0 功能。核心的 Ingest Pipeline (Extract → Build Wiki) 和搜索引擎已实现。前端有 9 个页面视图。双进程架构 (API Server + Worker) 已就位。

### 关键技术决策已确定

- 后端: Hono + TypeScript + ESM
- 数据库: PostgreSQL 16 + pgvector + pg_trgm + Drizzle ORM
- 队列: BullMQ + Redis 7
- 认证: better-auth (email/password + organization)
- LLM: Vercel AI SDK + OpenAI (默认 gpt-4o-mini)
- 前端: React 19 + Vite 6 + Tailwind CSS 4 + Zustand

### 已知问题

- 两套 Organization/Member 表 (better-auth 的 + 应用层的) 存在冗余风险
- 向量搜索无 HNSW 索引，规模增大后性能将严重退化
- FTS 无 GIN 索引，全表扫描
- Lint 和 Query 队列已定义但无 Worker 实现
- MinIO SDK 未实际集成
- CORS 和 Auth baseURL 硬编码 localhost

## Constraints

- **Tech Stack**: 全 TypeScript + ESM-only — 已确定，不可变更
- **Package Manager**: pnpm — 禁止 npm
- **Docker**: docker compose — 禁止 docker-compose
- **Node.js**: >= 20
- **Database**: PostgreSQL 16 + pgvector — 不引入外部向量数据库

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 全 TypeScript monorepo | 前后端共享类型，一人可维护全栈 | ✓ Good |
| Hono 替代 Express/Fastify | 性能好 + API 设计现代 + 内置 OpenAPI | ✓ Good |
| pgvector 替代 Pinecone/Weaviate | 统一数据库减少复杂度 | ✓ Good |
| better-auth 替代自建 JWT | 内置组织模型省开发时间 | ⚠️ Revisit — 双表冗余需解决 |
| BullMQ 做任务队列 | Node.js 生态最成熟 + 支持 Job Group | ✓ Good |
| generateObject + Zod | 结构化输出可靠性高 | ✓ Good |
| Redis 双角色 (队列+缓存+状态) | 减少运维组件 | ✓ Good |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-14 after v0.2.0 milestone start*
