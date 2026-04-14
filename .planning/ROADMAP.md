---
milestone: "v0.2.0 Productization"
version: "0.2.0"
---

# Roadmap: LLM Wiki v0.2.0 — Productization

## Milestone: v0.2.0 Productization

### Phase 1: File Parsing (PDF/DOCX/HTML)

**Goal:** 扩展文件上传支持，用户可上传 PDF/DOCX/HTML 文件自动提取文本

**Requirements:** FILE-01, FILE-02, FILE-03

**Success criteria:**
1. PDF 文件上传后内容正确提取并进入 Ingest Pipeline
2. DOCX 文件上传后内容正确提取
3. HTML 文件上传后去标签提取正文

**UI hint:** no

---

### Phase 2: Multi-Provider LLM + Fallback

**Goal:** 支持多 LLM Provider 配置和自动 Fallback

**Requirements:** MPROV-01, MPROV-02, MPROV-03

**Success criteria:**
1. 管理员可配置 OpenAI/Anthropic/Custom 多个 Provider
2. 主 Provider 熔断后自动切换到备用 Provider
3. 租户可自带 API Key 并选择偏好 Provider

**UI hint:** yes

---

### Phase 3: API Rate Limiting

**Goal:** 实现多层 API 速率限制，防止滥用

**Requirements:** RATE-01, RATE-02, RATE-03

**Success criteria:**
1. 全局速率限制生效 (Redis 滑动窗口)
2. 租户级限制独立计数
3. LLM 相关端点有更严格的限制

**UI hint:** no

---

### Phase 4: Version Diff + Source Revocation

**Goal:** Wiki 版本 diff 查看和 Source 撤销功能

**Requirements:** DIFF-01, REVK-01, REVK-02

**Success criteria:**
1. 可查看两个版本之间的 content diff
2. 删除 Source 时关联页面标记为 flagged
3. Flagged 队列 UI 可操作 (确认/编辑/删除)

**UI hint:** yes

---

### Phase 5: Redis Caching Layer

**Goal:** 引入 Redis 缓存层优化读性能

**Requirements:** CACHE-01, CACHE-02, CACHE-03

**Success criteria:**
1. Wiki 页面详情有 Redis 缓存 (TTL + write-through)
2. 查询结果缓存命中率 > 0 (相同问题重复查询)
3. Redis 不可用时自动降级为直接查询

**UI hint:** no

---

### Phase 6: Embedding Model Migration

**Goal:** 支持 Embedding 模型平滑迁移

**Requirements:** EMB-01, EMB-02, EMB-03

**Depends on:** Phase 5 (缓存层需先就位)

**Success criteria:**
1. 新增 embedding_v2 列不影响现有搜索
2. 后台任务异步重算旧数据 embedding
3. 搜索自动使用新列，标注未迁移状态

**UI hint:** no
