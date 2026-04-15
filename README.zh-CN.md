# LLM Wiki

面向企业团队的 Agent 原生编译型知识库。

上传原始文档 — LLM 自动提取实体、声明和关系，构建互相链接的 Wiki 知识库，支持混合搜索、交互式图谱可视化和 MCP 兼容的 Agent 接口。

[English](./README.md)

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
