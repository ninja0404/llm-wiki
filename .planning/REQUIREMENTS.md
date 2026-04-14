# Requirements: LLM Wiki v0.3.0 — Enterprise

**Defined:** 2026-04-14
**Core Value:** 用户上传资料后，LLM 自动构建高质量、互相链接的 Wiki 知识库

## v1 Requirements

### Open API

- [ ] **API-01**: 用户可在设置中创建/撤销 API Key (AES-256 加密存储)
- [ ] **API-02**: API Key 支持权限 scope (read/write/admin)
- [ ] **API-03**: Scalar 自动生成 OpenAPI 文档 + Try It 调试界面

### SSO

- [ ] **SSO-01**: 支持 SAML SSO 登录 (通过 better-auth 插件或替代方案)
- [ ] **SSO-02**: 组织管理员可配置 SSO Provider

### Graph

- [ ] **GRAPH-01**: 全局知识图谱使用 WebGL 渲染 (sigma.js)
- [ ] **GRAPH-02**: 支持 1000+ 节点流畅交互

### Deployment

- [ ] **HELM-01**: Helm Chart 包含所有服务 (postgres + redis + minio + api + worker + web)
- [ ] **HELM-02**: values.yaml 支持关键配置参数化

### Billing

- [ ] **BILL-01**: 订阅计划管理 (Free/Pro/Enterprise tier)
- [ ] **BILL-02**: 按用量计费 (Token 消耗 + 存储)
- [ ] **BILL-03**: Stripe 支付集成

### Export

- [ ] **EXPT-01**: Wiki 导出为 Markdown ZIP 文件
- [ ] **EXPT-02**: Wiki 导出为 PDF 文件

### Collaboration

- [ ] **COLLAB-01**: 用户可在 Wiki 页面添加评论
- [ ] **COLLAB-02**: 评论支持 @提及其他用户
- [ ] **COLLAB-03**: Wiki 编辑审批流 (editor 编辑 → admin 审批)

### Observability

- [ ] **OBS-01**: OpenTelemetry tracing 替代自建 trace_id
- [ ] **OBS-02**: Prometheus metrics 端点 (请求延迟/队列深度/Token 消耗率)
- [ ] **OBS-03**: Grafana 运营仪表盘模板

## Out of Scope

| Feature | Reason |
|---------|--------|
| 移动端 App | Web-first 策略 |
| 实时协同编辑 | 复杂度高, 先做评论+审批 |
| 视频/音频处理 | 超出文本知识库范畴 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| API-01 | Phase 1 | Pending |
| API-02 | Phase 1 | Pending |
| API-03 | Phase 1 | Pending |
| SSO-01 | Phase 2 | Pending |
| SSO-02 | Phase 2 | Pending |
| GRAPH-01 | Phase 3 | Pending |
| GRAPH-02 | Phase 3 | Pending |
| HELM-01 | Phase 4 | Pending |
| HELM-02 | Phase 4 | Pending |
| BILL-01 | Phase 5 | Pending |
| BILL-02 | Phase 5 | Pending |
| BILL-03 | Phase 5 | Pending |
| EXPT-01 | Phase 6 | Pending |
| EXPT-02 | Phase 6 | Pending |
| COLLAB-01 | Phase 7 | Pending |
| COLLAB-02 | Phase 7 | Pending |
| COLLAB-03 | Phase 7 | Pending |
| OBS-01 | Phase 8 | Pending |
| OBS-02 | Phase 8 | Pending |
| OBS-03 | Phase 8 | Pending |

**Coverage:**
- v1 requirements: 20 total
- Mapped to phases: 20
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-14*
