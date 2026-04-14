---
phase: 2
name: "Lint Worker Implementation"
status: planned
---

# Plan: Lint Worker Implementation

## Goal

实现 Wiki 内容健康检查 Worker，自动检测孤立页面和断裂链接，结果写入 activity_logs 并通过 WebSocket 推送。

## Requirements Covered

- LINT-01: 检测孤立页面 (无入链的非根页面)
- LINT-02: 检测断裂链接 ([[slug]] 目标不存在)
- LINT-03: 运行结果写入 activity_logs 并通过 WebSocket 推送

## Read First

- `api/src/worker.ts` — 现有 Worker 架构
- `api/src/jobs/queues.ts` — lintQueue 已定义
- `api/src/db/schema/wiki.ts` — wiki_pages, wiki_links 表
- `api/src/db/schema/system.ts` — activity_logs 表
- `api/src/lib/ws.ts` — WebSocket publishMessage

## Acceptance Criteria

1. Lint Worker 注册在 `worker.ts` 中，消费 `lint` 队列
2. 检测孤立页面（published 状态 + 无入链 + 非第一个创建的页面）
3. 检测断裂链接（wiki_links 中 target_page_id 指向已删除/不存在的页面）
4. 检测 wiki 内容中 [[slug]] 语法指向不存在的 slug
5. 结果写入 activity_logs (action: 'lint_completed')
6. 结果通过 WebSocket 推送 (type: 'lint:completed')
7. lintQueue 可通过 API 触发或定时执行

## Tasks

### Task 1: 创建 Lint Job 处理器

**What:** 在 `api/src/ingest/` 同级创建 `api/src/lint/lint-job.ts`，实现 lint 检查逻辑

**Steps:**
1. 创建 `api/src/lint/lint-job.ts`
2. 实现 `processLintJob(data: { workspaceId: string })`:
   - 查询孤立页面: published 状态 + 不在 wiki_links.target_page_id 中的页面
   - 查询断裂链接: wiki_links 中 target_page_id 对应的 wiki_page 已被删除或不存在
   - 扫描 wiki 内容中的 `[[slug]]` 模式，验证 slug 是否存在
3. 返回 lint 结果对象:
   ```typescript
   interface LintResult {
     orphanPages: { id: string; title: string; slug: string }[];
     brokenLinks: { sourcePageId: string; sourceTitle: string; targetSlug: string }[];
     totalPagesScanned: number;
   }
   ```

**Files to create:**
- `api/src/lint/lint-job.ts`

---

### Task 2: 注册 Lint Worker

**What:** 在 `api/src/worker.ts` 中添加 lint Worker

**Steps:**
1. 导入 `processLintJob` 和 `lintQueue`
2. 创建 lint Worker:
   ```typescript
   const lintWorker = new Worker('lint', async (job) => {
     return processLintJob(job.data);
   }, { ...connection, concurrency: 1 });
   ```
3. 添加 completed/failed 事件处理
4. 在 `setupGracefulShutdown` 中注册 lintWorker
5. Job 完成后写 activity_log + WebSocket 推送

**Files to modify:**
- `api/src/worker.ts`

---

### Task 3: 添加 WebSocket 消息类型

**What:** 在 shared 包中添加 lint 相关的 WebSocket 消息类型

**Steps:**
1. 在 `packages/shared/src/ws-types.ts` 添加 `WsLintCompleted` 类型
2. 将其加入 `WsMessage` union type

**Files to modify:**
- `packages/shared/src/ws-types.ts`

---

### Task 4: 添加 Lint 触发 API

**What:** 创建 API 端点允许手动触发 lint

**Steps:**
1. 在 workspace-scoped routes 中添加 lint 触发端点
2. POST `/api/workspaces/:workspaceId/lint` — 入队 lint job
3. GET `/api/workspaces/:workspaceId/lint/results` — 查询最近的 lint activity_logs

**Files to create:**
- `api/src/routes/lint.ts`

**Files to modify:**
- `api/src/server.ts` (注册路由)

---

### Task 5: 验证并提交

**Verification:**
- Worker 启动时 lint Worker 注册成功
- 手动触发 lint 后能检测到孤立页面和断裂链接
- activity_logs 中有 lint_completed 记录
- WebSocket 收到 lint:completed 消息
