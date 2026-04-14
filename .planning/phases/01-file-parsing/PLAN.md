---
phase: 1
name: "File Parsing (PDF/DOCX/HTML)"
status: planned
---

# Plan: File Parsing (PDF/DOCX/HTML)

## Goal

扩展文件上传支持，使用户可以上传 PDF、DOCX、HTML 文件，系统自动提取文本内容进入 Ingest Pipeline。

## Requirements Covered

- FILE-01: PDF 文件文本提取
- FILE-02: DOCX 文件文本提取
- FILE-03: HTML 文件正文提取

## Read First

- `api/src/routes/sources.ts` — 现有文件上传端点 (POST /file)
- `api/src/lib/storage.ts` — MinIO 存储工具
- `api/src/ingest/extract-job.ts` — Extract pipeline 入口
- `api/src/ingest/chunker.ts` — 文本分块器
- `api/package.json` — 现有依赖

## Acceptance Criteria

1. PDF 文件上传后 rawContent 正确填充为提取的纯文本
2. DOCX 文件上传后 rawContent 正确填充
3. HTML 文件上传后去除标签，只保留正文文本
4. 不支持的文件类型返回 422 错误提示
5. 文件解析失败时返回清晰的错误信息

## Tasks

### Task 1: 安装文件解析依赖

**What:** 安装 PDF、DOCX、HTML 解析库

**Steps:**
1. `pnpm add pdf-parse mammoth` — PDF 和 DOCX 解析
2. `pnpm add -D @types/pdf-parse` — 类型定义
3. HTML 使用内置正则去标签 (无需额外依赖)

**Files to modify:**
- `api/package.json`

---

### Task 2: 创建文件解析模块

**What:** 创建 `api/src/ingest/file-parser.ts`，根据文件类型调用不同解析器

**Steps:**
1. 创建 `parseFile(buffer: Buffer, mimeType: string): Promise<string>` 函数
2. PDF: 使用 `pdf-parse` 提取文本
3. DOCX: 使用 `mammoth` 提取纯文本 (extractRawText)
4. HTML: 去除标签 + 解码 HTML entities + 保留段落结构
5. 不支持的类型抛出 `UnsupportedFileTypeError`

**Files to create:**
- `api/src/ingest/file-parser.ts`

---

### Task 3: 修改文件上传路由

**What:** 更新 `POST /file` 端点使用 file-parser 替代直接 UTF-8 解码

**Steps:**
1. 导入 `parseFile` 函数
2. 根据 `file.type` 或文件扩展名确定 MIME 类型
3. 调用 `parseFile(buffer, mimeType)` 获取文本
4. 不支持的文件类型返回 422

**Files to modify:**
- `api/src/routes/sources.ts`

---

### Task 4: 验证并提交

**Verification:**
- 上传 .pdf 文件提取出可读文本
- 上传 .docx 文件提取出可读文本
- 上传 .html 文件去除标签保留正文
- 上传 .jpg 等不支持类型返回 422
