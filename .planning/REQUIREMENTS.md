# Requirements: LLM Wiki v0.2.0 — Productization

**Defined:** 2026-04-14
**Core Value:** 用户上传资料后，LLM 自动构建高质量、互相链接的 Wiki 知识库

## v1 Requirements

### File Parsing

- [ ] **FILE-01**: 用户上传 PDF 文件后系统自动提取文本内容进入 Ingest Pipeline
- [ ] **FILE-02**: 用户上传 DOCX 文件后系统自动提取文本内容进入 Ingest Pipeline
- [ ] **FILE-03**: 用户上传 HTML 文件后系统自动提取正文内容 (去除标签)

### Multi-Provider

- [ ] **MPROV-01**: 管理员可配置多个 LLM Provider (OpenAI/Anthropic/Custom)
- [ ] **MPROV-02**: 主 Provider 熔断后自动 Fallback 到备用 Provider
- [ ] **MPROV-03**: 租户可自带 API Key 并选择 Provider

### Rate Limiting

- [ ] **RATE-01**: API 全局请求速率限制 (Redis 滑动窗口)
- [ ] **RATE-02**: 租户级 API 调用限制 (per-organization)
- [ ] **RATE-03**: 端点级限制 (LLM 相关端点更严格)

### Version Diff

- [ ] **DIFF-01**: Wiki 页面版本列表可查看两个版本之间的 content diff

### Source Revocation

- [ ] **REVK-01**: 删除 Source 时，关联的 Wiki 页面标记为 flagged
- [ ] **REVK-02**: 前端 Flagged 队列展示受影响页面及操作选项 (确认/编辑/删除)

### Caching

- [ ] **CACHE-01**: Wiki 页面详情 Redis 缓存 (TTL + write-through 失效)
- [ ] **CACHE-02**: 查询结果 Redis 缓存 (hash(question + wiki_version) → answer, TTL 1h)
- [ ] **CACHE-03**: Redis 不可用时降级为直接查询 (cache-aside)

### Embedding Migration

- [ ] **EMB-01**: 支持新增 embedding_v2 列 (不同维度/模型)
- [ ] **EMB-02**: 后台任务异步用新模型重算旧数据的 embedding
- [ ] **EMB-03**: 搜索自动使用新列 (已迁移数据) + 标注未迁移数据

## v2 Requirements

### Observability

- **OBS-01**: OpenTelemetry 替代自建 trace_id
- **OBS-02**: Prometheus metrics 导出 (请求延迟、队列深度、Token 消耗率)

### Data Partitioning

- **PART-01**: activity_logs 按月分区
- **PART-02**: llm_invocations 按月分区

### Data Compliance

- **GDPR-01**: Workspace 数据导出 (GDPR Article 20)
- **GDPR-02**: 数据保留策略配置

## Out of Scope

| Feature | Reason |
|---------|--------|
| SSO/SAML | Phase 2 — 需验证 better-auth 支持度 |
| 开放 API + API Key 管理 | Phase 2 — 非核心 |
| Helm Chart | Phase 2 — 先验证 docker compose |
| 计费系统 | Phase 2 — 先做内部使用 |
| 全局知识图谱 (WebGL) | Phase 2 — ego graph 够用 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FILE-01 | Phase 1 | Pending |
| FILE-02 | Phase 1 | Pending |
| FILE-03 | Phase 1 | Pending |
| MPROV-01 | Phase 2 | Pending |
| MPROV-02 | Phase 2 | Pending |
| MPROV-03 | Phase 2 | Pending |
| RATE-01 | Phase 3 | Pending |
| RATE-02 | Phase 3 | Pending |
| RATE-03 | Phase 3 | Pending |
| DIFF-01 | Phase 4 | Pending |
| REVK-01 | Phase 4 | Pending |
| REVK-02 | Phase 4 | Pending |
| CACHE-01 | Phase 5 | Pending |
| CACHE-02 | Phase 5 | Pending |
| CACHE-03 | Phase 5 | Pending |
| EMB-01 | Phase 6 | Pending |
| EMB-02 | Phase 6 | Pending |
| EMB-03 | Phase 6 | Pending |

**Coverage:**
- v1 requirements: 18 total
- Mapped to phases: 18
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-14*
*Last updated: 2026-04-14 after v0.2.0 milestone start*
