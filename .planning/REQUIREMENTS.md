# Requirements: LLM Wiki Phase 0 Completion

**Defined:** 2026-04-14
**Core Value:** 用户上传资料后，LLM 自动构建高质量、互相链接的 Wiki 知识库

## v1 Requirements

### Database

- [ ] **DB-01**: PostgreSQL 创建 HNSW 向量索引用于 wiki_pages 和 source_chunks 的 embedding 列
- [ ] **DB-02**: PostgreSQL 创建 GIN 索引用于 wiki_pages 全文搜索 (tsvector)
- [ ] **DB-03**: PostgreSQL 创建 GIN trigram 索引用于 wiki_pages.title 的模糊匹配
- [ ] **DB-04**: Drizzle 迁移文件生成并可正常 apply (从 db:push 切换到 db:migrate)

### Search

- [ ] **SRCH-01**: 搜索引擎在 embedding IS NULL 时降级为纯 FTS 搜索不报错
- [ ] **SRCH-02**: 搜索 P95 延迟 < 500ms (1000 条 wiki 页面规模)

### Lint System

- [ ] **LINT-01**: Lint Worker 能检测孤立页面 (无入链的非根页面)
- [ ] **LINT-02**: Lint Worker 能检测断裂链接 ([[slug]] 目标不存在)
- [ ] **LINT-03**: Lint Worker 运行结果写入 activity_logs 并通过 WebSocket 推送

### File Upload

- [ ] **FILE-01**: 用户可上传文件作为 Source (MinIO SDK 集成)
- [ ] **FILE-02**: 文件类型的 Source 能正确读取 MinIO 中的内容进行 Ingest

### Production Config

- [ ] **PROD-01**: CORS origin 通过环境变量配置而非硬编码
- [ ] **PROD-02**: better-auth baseURL 和 trustedOrigins 通过环境变量配置
- [ ] **PROD-03**: 启动时校验 ENCRYPTION_KEY 非默认值 (生产环境)
- [ ] **PROD-04**: 启动时校验 BETTER_AUTH_SECRET 非默认值 (生产环境)

### Deployment

- [ ] **DEPL-01**: API 服务 Dockerfile (multi-stage build, < 200MB)
- [ ] **DEPL-02**: Worker 服务 Dockerfile (复用 API 基础镜像)
- [ ] **DEPL-03**: Web 前端 Dockerfile (Nginx 托管静态文件)
- [ ] **DEPL-04**: docker-compose.prod.yml 包含所有服务 (postgres + redis + minio + api + worker + web)

### Frontend

- [ ] **FE-01**: 引入 shadcn/ui 组件系统替换原始 Tailwind 组件
- [ ] **FE-02**: Wiki 页面版本历史查看 UI (版本列表 + content diff)
- [ ] **FE-03**: Source 失败批次重试按钮可用

### Pipeline

- [ ] **PIPE-01**: 同一 Source 的 extract-batch 按 batchIndex 顺序串行执行
- [ ] **PIPE-02**: Workspace systemPrompt 在 Chat RAG 上下文中生效

### Health

- [ ] **HLTH-01**: /health 端点验证 PostgreSQL 连接可用
- [ ] **HLTH-02**: /health 端点验证 Redis 连接可用
- [ ] **HLTH-03**: /health 返回 Worker 进程存活状态

## v2 Requirements

### Multi-Provider

- **MPROV-01**: 支持 Anthropic Claude 作为 LLM Provider
- **MPROV-02**: 主 Provider 熔断后自动 Fallback 到备用 Provider

### Caching

- **CACHE-01**: 查询结果 Redis 缓存 (hash(question + wiki_version) → answer)
- **CACHE-02**: Wiki 页面 Redis 读缓存 (write-through 失效)

### Observability

- **OBS-01**: OpenTelemetry 替代自建 trace_id
- **OBS-02**: Prometheus metrics 导出

### Data

- **DATA-01**: activity_logs 和 llm_invocations 按月分区
- **DATA-02**: Embedding 模型迁移工具 (双列方案)

## Out of Scope

| Feature | Reason |
|---------|--------|
| SSO/SAML | Phase 2 — 需验证 better-auth 支持度 |
| 开放 API + API Key 管理 | Phase 2 — 非核心功能 |
| 私有化 Helm Chart | Phase 2 — 先验证 docker compose 部署 |
| 计费系统 | Phase 2 — 先做内部使用 |
| 团队协作 (评论/审批流) | Phase 2 — 先完善单人体验 |
| 测试基础设施 (Vitest) | 暂缓 — 聚焦功能补齐 |
| Query 缓存 | v2 — 非阻塞性需求 |
| PDF/DOCX 解析 | Phase 1 — 先支持文本/URL/文件上传 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DB-01 | Phase 1 | Pending |
| DB-02 | Phase 1 | Pending |
| DB-03 | Phase 1 | Pending |
| DB-04 | Phase 1 | Pending |
| SRCH-01 | Phase 1 | Pending |
| SRCH-02 | Phase 1 | Pending |
| LINT-01 | Phase 2 | Pending |
| LINT-02 | Phase 2 | Pending |
| LINT-03 | Phase 2 | Pending |
| FILE-01 | Phase 3 | Pending |
| FILE-02 | Phase 3 | Pending |
| PROD-01 | Phase 4 | Pending |
| PROD-02 | Phase 4 | Pending |
| PROD-03 | Phase 4 | Pending |
| PROD-04 | Phase 4 | Pending |
| DEPL-01 | Phase 5 | Pending |
| DEPL-02 | Phase 5 | Pending |
| DEPL-03 | Phase 5 | Pending |
| DEPL-04 | Phase 5 | Pending |
| FE-01 | Phase 6 | Pending |
| FE-02 | Phase 6 | Pending |
| FE-03 | Phase 6 | Pending |
| PIPE-01 | Phase 7 | Pending |
| PIPE-02 | Phase 7 | Pending |
| HLTH-01 | Phase 4 | Pending |
| HLTH-02 | Phase 4 | Pending |
| HLTH-03 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 27 total
- Mapped to phases: 27
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-14*
*Last updated: 2026-04-14 after initial definition*
