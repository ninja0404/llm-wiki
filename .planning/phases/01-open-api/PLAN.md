---
phase: 1
name: "Open API + API Key Management"
status: planned
---

# Plan: Open API + API Key Management

## Goal

建立开放 API 体系：API Key 创建/撤销/权限管理、API Key 认证中间件、Scalar OpenAPI 文档。

## Requirements Covered

- API-01: API Key 创建/撤销 (AES-256 加密存储)
- API-02: API Key 权限 scope (read/write/admin)
- API-03: Scalar OpenAPI 文档 + Try It 调试

## Read First

- `api/src/lib/auth.ts` — 现有 better-auth 认证
- `api/src/lib/crypto.ts` — AES-256 加密工具
- `api/src/server.ts` — 路由和中间件注册
- `api/package.json` — 现有依赖

## Tasks

### Task 1: API Key 数据模型

**What:** 创建 `api_keys` 表 schema

**Schema:**
- id (uuid PK)
- organizationId (FK)
- name (text, 用户可读名称)
- keyHash (text, SHA-256 hash of the key)
- keyPrefix (text, 前 8 字符用于展示 "sk-abc1...") 
- scope (text enum: read/write/admin)
- lastUsedAt (timestamp)
- expiresAt (timestamp, nullable)
- createdAt (timestamp)
- revokedAt (timestamp, nullable)

**Files to create:**
- 在 `api/src/db/schema/` 中添加 api_keys 表

### Task 2: API Key 认证中间件

**What:** 创建可同时支持 Session 和 API Key 认证的中间件

**Steps:**
1. 检查 `Authorization: Bearer sk-xxx` 头
2. Hash key → 查询 api_keys 表 → 验证未撤销/未过期
3. 设置 userId 和 scope 到 context
4. 现有 session 认证作为 fallback

### Task 3: API Key CRUD 路由

**What:** 创建 API Key 管理端点

**Endpoints:**
- POST /api/api-keys — 创建 (返回完整 key 一次)
- GET /api/api-keys — 列表 (只显示 prefix)
- DELETE /api/api-keys/:id — 撤销

### Task 4: Scalar OpenAPI 文档

**What:** 集成 Scalar 作为 API 文档界面

**Steps:**
1. 安装 `@scalar/hono-api-reference`
2. 使用 `@hono/zod-openapi` 生成 OpenAPI spec
3. 挂载到 `/docs` 路由

### Task 5: 验证并提交
