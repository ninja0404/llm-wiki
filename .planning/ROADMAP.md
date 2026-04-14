---
milestone: "v0.3.0 Enterprise"
version: "0.3.0"
---

# Roadmap: LLM Wiki v0.3.0 — Enterprise

## Milestone: v0.3.0 Enterprise

### Phase 1: Open API + API Key Management
**Goal:** 开放 API 体系，支持 API Key 管理和 Scalar 文档
**Requirements:** API-01, API-02, API-03
**UI hint:** yes

### Phase 2: SSO/SAML Authentication
**Goal:** 企业级 SSO 登录支持
**Requirements:** SSO-01, SSO-02
**UI hint:** yes

### Phase 3: Global Knowledge Graph (WebGL)
**Goal:** 全局知识图谱 WebGL 渲染，支持 1000+ 节点
**Requirements:** GRAPH-01, GRAPH-02
**UI hint:** yes

### Phase 4: Helm Chart Deployment
**Goal:** Kubernetes 部署包
**Requirements:** HELM-01, HELM-02
**UI hint:** no

### Phase 5: Billing System
**Goal:** 订阅 + 用量计费 + Stripe 集成
**Requirements:** BILL-01, BILL-02, BILL-03
**UI hint:** yes

### Phase 6: Export (PDF/Markdown)
**Goal:** Wiki 内容导出功能
**Requirements:** EXPT-01, EXPT-02
**UI hint:** yes

### Phase 7: Team Collaboration
**Goal:** 评论 + @提及 + 审批流
**Requirements:** COLLAB-01, COLLAB-02, COLLAB-03
**UI hint:** yes

### Phase 8: Observability
**Goal:** OpenTelemetry + Prometheus + Grafana
**Requirements:** OBS-01, OBS-02, OBS-03
**UI hint:** no

---

### Phase 9: Gap Closure — v0.1.0/v0.2.0 Production Readiness

**Goal:** 补全 v0.1.0 和 v0.2.0 中的高优先级缺失，使其达到生产可用

**Requirements:** GAP-01, GAP-02, GAP-03, GAP-04, GAP-05

**Success criteria:**
1. shadcn/ui 初始化并替换核心组件 (Button, Card, Dialog, Input)
2. SourcesView 前端支持文件拖拽上传
3. Wiki 页面更新时 Redis 缓存正确失效
4. Embedding 迁移 Job 注册到 Worker 并可执行
5. Workspace LLM 配置 CRUD API 可用
6. Lint Worker 有 cron 定时执行配置

**UI hint:** yes
