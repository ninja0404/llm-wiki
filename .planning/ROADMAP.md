---
milestone: "Phase 0 Completion"
version: "0.1.0"
---

# Roadmap: LLM Wiki Phase 0 Completion

## Milestone: Phase 0 Completion (v0.1.0)

### Phase 1: Database Indexes & Search Hardening

**Goal:** 补全关键数据库索引，确保搜索性能达到 SLA 要求

**Requirements:** DB-01, DB-02, DB-03, DB-04, SRCH-01, SRCH-02

**Success criteria:**
1. HNSW 向量索引在 wiki_pages.embedding 和 source_chunks.embedding 上创建成功
2. GIN tsvector 索引和 trigram 索引创建成功
3. 搜索在 embedding IS NULL 时降级为纯 FTS 不报错
4. Drizzle 迁移文件生成并可通过 db:migrate 应用

**UI hint:** no

---

### Phase 2: Lint Worker Implementation

**Goal:** 实现 Wiki 内容健康检查 Worker，自动检测质量问题

**Requirements:** LINT-01, LINT-02, LINT-03

**Depends on:** Phase 1 (需要索引就位)

**Success criteria:**
1. Lint Worker 检测到无入链的孤立页面并记录 activity_log
2. Lint Worker 检测到指向不存在 slug 的断裂链接
3. Lint 结果通过 WebSocket 推送到前端

**UI hint:** no

---

### Phase 3: MinIO File Upload Integration

**Goal:** 完成文件类型 Source 的完整上传/下载/Ingest 链路

**Requirements:** FILE-01, FILE-02

**Success criteria:**
1. 用户可在 Sources 页面上传文件到 MinIO
2. 文件类型的 Source 能从 MinIO 读取内容并触发 Ingest Pipeline
3. 上传的文件 key 正确存储在 sources.file_key 字段

**UI hint:** yes

---

### Phase 4: Production Configuration & Health Check

**Goal:** 消除所有硬编码配置，增强健康检查，为部署做准备

**Requirements:** PROD-01, PROD-02, PROD-03, PROD-04, HLTH-01, HLTH-02, HLTH-03

**Success criteria:**
1. CORS origin、auth baseURL、trustedOrigins 全部通过环境变量配置
2. 生产环境启动时自动校验加密密钥和 auth secret 非默认值
3. /health 端点返回 DB + Redis 连接状态和 Worker 存活状态
4. 所有配置项在 .env.example 中有说明

**UI hint:** no

---

### Phase 5: Docker Containerization

**Goal:** 创建所有服务的 Dockerfile 和生产 docker-compose 配置

**Requirements:** DEPL-01, DEPL-02, DEPL-03, DEPL-04

**Depends on:** Phase 4 (需要环境变量化完成)

**Success criteria:**
1. API Dockerfile 使用 multi-stage build，镜像 < 200MB
2. Worker Dockerfile 复用 API 基础镜像
3. Web Dockerfile 使用 Nginx 托管 Vite build 产物
4. docker-compose.prod.yml 一键启动所有服务且全部健康

**UI hint:** no

---

### Phase 6: Frontend Polish

**Goal:** 引入 shadcn/ui 组件系统，增加版本历史和重试功能

**Requirements:** FE-01, FE-02, FE-03

**Depends on:** Phase 2 (Lint 结果需要在 UI 展示)

**Success criteria:**
1. shadcn/ui 核心组件 (Button, Card, Dialog, Input, Table) 替换原始 Tailwind
2. Wiki 页面有版本历史 tab，显示变更记录和 content diff
3. Sources 页面失败批次显示重试按钮且可用

**UI hint:** yes

---

### Phase 7: Pipeline Improvements

**Goal:** 补齐 Pipeline 的串行保证和 Chat 自定义 prompt

**Requirements:** PIPE-01, PIPE-02

**Success criteria:**
1. 同一 Source 的 extract-batch jobs 按 batchIndex 顺序执行
2. Chat RAG 使用 workspace.systemPrompt 作为 system message 的一部分
3. 后续批次能正确看到前面批次创建的 Wiki 页面

**UI hint:** no
