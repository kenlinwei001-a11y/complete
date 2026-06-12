# 全域数字化智能决策支撑系统

类 Palantir Foundry/AIP 的本体驱动决策推演平台：**DataCore**（System A ≈ Foundry：连接器、本体、规则库、权限、合成数据、时序、求解器）+ **AgentCore**（System B ≈ AIP：agent / workflow / MCP / skill / 场景编排 + QOS 查询路由）+ **Workspace Shell 前端**（元数据驱动的业务视图与管理台，查询对话全链路可溯源）。两系统松耦合，AgentCore 仅通过 DataCore 公开 REST API（携带用户级 JWT，OBO）访问数据；前端是两系统的汇合点，部署态经 nginx 网关同源访问。

规格来源（均在 `docs/`，冲突时以平台总纲为准）：

- `docs/PRD-platform-foundry-aip.md` — 平台总纲（系统边界、A0–A8 / B1–B7、权限模型、验收 §12）
- `docs/PRD-query-orchestration-service.md` — QOS（AgentCore B6）详细规格
- `docs/PRD-frontend.md` — 前端 Workspace Shell + 决策工作台
- `docs/PRD-addendum-*.md` — 时序 A8 / Feature Entitlement / 求解器增量
- `docs/demo-推演系统.html` — 前端视觉与交互参考（电池制造场景）

## 仓库结构

```
packages/contracts    共享契约（zod schema），三方唯一依赖
apps/datacore         System A：A0 IAM · A1 连接器 · A2 规则文档解析 · A3 半自动建模
                      A4 本体/求解器/派生 · A5 规则 DSL · A6 权限 · A7 合成数据
                      A8 时序+模拟时钟 · S1.8 S&OP · S2 Action 审批 · S4 知识库
apps/agentcore        System B：QOS（路由/路径A/路径B/SSE）· B1 Agent 注册表
                      B2 Workflow 引擎 · B3 MCP · B4 Skill · B5 场景入口 · 多 LLM 供应商
apps/frontend-shell   React SPA：登录/Workspace、8 个业务视图渲染器、查询 Dock、全部管理台
docker-compose.yml    pg(pgvector)×2 + minio + datacore + agentcore + frontend + gateway(nginx)
deploy/nginx.conf     网关反代：/ → 前端，/a/v1 → DataCore，/b/v1 与 /api/v1 → AgentCore（SSE 不缓冲）
DEPLOY.md             一键部署指南（域名配置 / 账号 / 模块导览 / 故障排查）
```

## 一键部署（推荐）

```bash
docker compose up --build
# hosts 加一行：127.0.0.1 decision.local
# 浏览器打开 http://decision.local，登录 demo / admin / demo1234
```

详见 **[DEPLOY.md](./DEPLOY.md)**（先决条件、域名/HTTPS、可选真实 LLM 与向量配置、故障排查）。演示账号 admin（全角色）/ planner / base_manager（常州行级过滤），密码均 `demo1234` —— 三个账号导航、视图与主题各不相同（workspace 元数据驱动）。

## 开发模式

```bash
pnpm install
pnpm -r build && pnpm -r test        # 160 个测试，无需网络/数据库（仓储有内存实现，LLM 全 mock）

# 本地双服务联调（内存模式 + 演示种子数据）
PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 \
  CREDENTIAL_KEY=<64位hex> node apps/datacore/dist/server.js &
PORT=4002 DATACORE_BASE_URL=http://127.0.0.1:4001 node apps/agentcore/dist/main.js &

# pg 持久化：设 DATABASE_URL 即切 pg 仓储并自启幂等迁移；也可手动
pnpm --filter datacore migrate && pnpm --filter agentcore migrate

# 前端（mock 模式，无后端可完整演示）
VITE_MOCK=1 pnpm --filter frontend-shell dev
```

开发期鉴权：`X-Debug-User: <tenantId>:<userId>:<role1|role2>`；正式链路用 `POST /a/v1/auth/login`（refresh token 走 httpOnly cookie）。

LLM：CI 测试全部使用 Mock；真连冒烟 `pnpm --filter agentcore run smoke:llm`（需 `ANTHROPIC_API_KEY`）。分类默认 `claude-haiku-4-5`，编排/生成默认 `claude-opus-4-8`；亦可经 `/b/v1/llm/providers` 配 OpenAI 兼容供应商。

## 实现状态

- 三个包全部功能模块实现并通过自动化测试（QOS A1–E2 全部 + 平台 P1/CN/RD/OM/SY/AU/WF/SC/SK/MC + 前端 F1–F13）
- 真连闭环已验证（pg 持久化 + 网关域名访问）：登录/刷新 cookie、workspace 契约（按账号差异化导航/视图/主题）、对象分页查询、求解器、规则评估、本体图谱、时序聚合、连接器同步、合成数据六阶段、模拟时钟 tick、功能开通、Action 审批链、B 侧目录/注册表/LLM 供应商 CRUD、跨系统 OBO 工作流执行、SSE 经网关流式透传
- 已知延后项：file_upload 的 XLSX 解析（CSV/JSON 已支持）、sap_erp 等 5 类连接器仅注册 configSchema（按 PRD"预留接口"定位）
