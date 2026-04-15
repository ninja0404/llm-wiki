# LLM Wiki

Agent-native compiled knowledge vault for enterprise teams.

Upload raw documents — LLM automatically extracts entities, claims, and relations to build an interlinked Wiki knowledge base with hybrid search, interactive graph visualization, and an MCP-compatible agent interface.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌───────────────┐
│  Next.js 15  │────▶│ Platform API │────▶│  PostgreSQL   │
│   :3000      │     │   :8000      │     │  pgvector     │
└─────────────┘     └──────┬───────┘     │  pgroonga     │
                           │              └───────────────┘
                    ┌──────┴───────┐
                    │   Compiler   │     ┌───────────────┐
                    │   Worker     │────▶│    MinIO       │
                    └──────────────┘     └───────────────┘
                    ┌──────────────┐     ┌───────────────┐
                    │ MCP Service  │     │    Redis       │
                    │   :8080      │     └───────────────┘
                    └──────────────┘
                    ┌──────────────┐
                    │  Converter   │
                    │   :8090      │
                    └──────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11+ / FastAPI / asyncpg |
| Database | PostgreSQL 18 + pgvector + pgroonga |
| Storage | MinIO (S3-compatible) |
| Queue | Redis (List-based) |
| LLM | OpenAI / Anthropic / DeepSeek / SiliconFlow (configurable per workspace) |
| Embedding | Configurable per workspace (1024-dim vectors) |
| Frontend | Next.js 15 / React 19 / Tailwind CSS v4 / shadcn/ui |
| MCP | FastMCP (Streamable HTTP) |

## Quick Start

```bash
# 1. Start infrastructure
docker compose up -d

# 2. Check dependencies
python3 scripts/check_local_stack.py

# 3. Initialize database
python3 scripts/init_local_db.py

# 4. Install Python dependencies
pip install -e ".[dev]"

# 5. Install frontend dependencies
cd web && bun install && cd ..

# 6. Start all services
python3 scripts/dev_stack.py

# Or start individually:
# uvicorn services.platform_api.app.main:app --reload --host 0.0.0.0 --port 8000
# python -m services.compiler_worker.app.main
# uvicorn services.mcp_service.app.main:app --reload --host 0.0.0.0 --port 8080
# cd web && bun dev
```

Open http://localhost:3000, register an account, then configure LLM/embedding providers in Settings.

## Features

### Source Ingestion
Upload PDF, DOCX, XLSX, CSV, Markdown, or HTML. The compiler worker automatically:
1. Parses documents into pages and blocks
2. Generates embeddings for semantic search
3. Extracts entities, claims, and relations via LLM
4. Creates interlinked Wiki pages with citations

### Hybrid Search
Combines pgroonga full-text search, pgvector semantic search, and knowledge graph connectivity boost. Configurable per workspace via `search_rules`.

### Knowledge Graph
Interactive force-directed visualization of entities, claims, relations, citations, and document references. Supports filtering, focus document mode, and node inspection with drill-down.

### MCP Agent Interface
AI agents connect via the Model Context Protocol with workspace-scoped tokens:
- **Endpoint**: `http://localhost:8080/mcp`
- **Tools**: search, read, create, replace, append, delete, lint, guide
- **Scopes**: read / write / admin

### Workspace Settings
All runtime configuration (LLM provider, model, API key, embedding config, compiler rules, search rules) is stored per-workspace in the database — not in environment variables.

## Testing

```bash
pytest tests/unit tests/integration
```

## Environment Variables

See `.env.example`. Only infrastructure connection details and embedding dimensions are configured via env. Provider/model selection is done per-workspace in the Settings page.

---

# LLM Wiki

面向企业团队的 Agent 原生编译型知识库。

上传原始文档 — LLM 自动提取实体、声明和关系，构建互相链接的 Wiki 知识库，支持混合搜索、交互式图谱可视化和 MCP 兼容的 Agent 接口。

## 架构

```
┌─────────────┐     ┌──────────────┐     ┌───────────────┐
│  Next.js 15  │────▶│ Platform API │────▶│  PostgreSQL   │
│   :3000      │     │   :8000      │     │  pgvector     │
└─────────────┘     └──────┬───────┘     │  pgroonga     │
                           │              └───────────────┘
                    ┌──────┴───────┐
                    │   编译 Worker │     ┌───────────────┐
                    │              │────▶│    MinIO       │
                    └──────────────┘     └───────────────┘
                    ┌──────────────┐     ┌───────────────┐
                    │ MCP 服务     │     │    Redis       │
                    │   :8080      │     └───────────────┘
                    └──────────────┘
                    ┌──────────────┐
                    │ 转换服务     │
                    │   :8090      │
                    └──────────────┘
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Python 3.11+ / FastAPI / asyncpg |
| 数据库 | PostgreSQL 18 + pgvector + pgroonga |
| 对象存储 | MinIO (S3 兼容) |
| 队列 | Redis（List 模式） |
| LLM | OpenAI / Anthropic / DeepSeek / SiliconFlow（按 Workspace 配置） |
| Embedding | 按 Workspace 配置（1024 维向量） |
| 前端 | Next.js 15 / React 19 / Tailwind CSS v4 / shadcn/ui |
| MCP 协议 | FastMCP (Streamable HTTP) |

## 快速开始

```bash
# 1. 启动基础设施
docker compose up -d

# 2. 检查依赖
python3 scripts/check_local_stack.py

# 3. 初始化数据库
python3 scripts/init_local_db.py

# 4. 安装 Python 依赖
pip install -e ".[dev]"

# 5. 安装前端依赖
cd web && bun install && cd ..

# 6. 启动所有服务
python3 scripts/dev_stack.py
```

打开 http://localhost:3000，注册账号，然后在 Settings 页面配置 LLM/Embedding 提供商。

## 功能

### 文档摄入
上传 PDF/DOCX/XLSX/CSV/Markdown/HTML。编译 Worker 自动执行：
1. 解析文档为 pages 和 blocks
2. 生成 embedding 向量用于语义搜索
3. 通过 LLM 提取实体、声明和关系
4. 创建带引用溯源的互相链接 Wiki 页面

### 混合搜索
结合 pgroonga 全文搜索 + pgvector 语义搜索 + 知识图谱权重加成。通过 `search_rules` 按 Workspace 配置。

### 知识图谱
交互式力导向图可视化，展示实体、声明、关系、引用和文档引用。支持过滤、焦点文档模式和节点详情查看。

### MCP Agent 接口
AI Agent 通过 MCP 协议连接，使用 Workspace 级别的 Token：
- **Endpoint**: `http://localhost:8080/mcp`
- **工具**: search / read / create / replace / append / delete / lint / guide
- **权限**: read / write / admin

### Workspace 设置
所有运行时配置（LLM 提供商、模型、API Key、Embedding 配置、编译规则、搜索规则）按 Workspace 存储在数据库中，不依赖环境变量。

## 测试

```bash
pytest tests/unit tests/integration
```

## 环境变量

参见 `.env.example`。仅基础设施连接信息通过环境变量配置。Provider/Model 选择在 Settings 页面按 Workspace 配置。
