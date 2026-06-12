# 本体驱动决策推演平台（DataCore + AgentCore）

类 Palantir Foundry/AIP 的双系统平台：**DataCore**（≈Foundry：连接器、本体、规则库、权限、合成数据）与 **AgentCore**（≈AIP：agent / workflow / MCP / skill / 场景编排 + QOS 查询路由）。两系统松耦合，AgentCore 仅通过 DataCore 公开 REST API（携带用户级 JWT，OBO）访问数据。

规格来源（两份 PRD 均在 `docs/`，冲突时以平台总纲为准）：

- `docs/PRD-platform-foundry-aip.md` — 平台总纲（系统边界、A0–A7 / B1–B7、权限模型、验收 §12）
- `docs/PRD-query-orchestration-service.md` — QOS（AgentCore B6）详细规格
- `docs/demo-推演系统.html` — 前端推演系统参考 demo（电池制造场景）

## 仓库结构

```
packages/contracts    共享契约（zod schema），双方唯一依赖
apps/datacore         System A：A0 IAM · A1 连接器 · A2 规则文档解析 · A3 半自动建模
                      A4 本体/求解器/派生 · A5 规则 DSL · A6 权限 · A7 合成数据
apps/agentcore        System B：QOS（路由/路径A/路径B/SSE）· B1 Agent 注册表
                      B2 Workflow 引擎 · B3 MCP · B4 Skill · B5 场景入口
docker-compose.yml    postgres-a/b + minio + datacore + agentcore
```

## 快速开始

```bash
pnpm install
pnpm -r build && pnpm -r test        # 85 个测试，无需网络/数据库（仓储有内存实现）

# 本地双服务联调（内存模式 + 演示种子数据）
PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 \
  CREDENTIAL_KEY=<64位hex> node apps/datacore/dist/server.js &
PORT=4002 DATACORE_BASE_URL=http://127.0.0.1:4001 node apps/agentcore/dist/main.js &

# 或容器方式（pg 持久化）
docker compose up --build
```

开发期鉴权：`X-Debug-User: <tenantId>:<userId>:<role1|role2>`；正式链路用 `POST /a/v1/auth/login`（演示账号 admin / planner / base_manager，密码 demo1234，租户 demo）。

LLM：CI 测试全部使用 Mock；真连冒烟 `pnpm --filter agentcore run smoke:llm`（需 `ANTHROPIC_API_KEY`）。分类默认 `claude-haiku-4-5`，编排/生成默认 `claude-opus-4-8`。

## 实现状态

- 两系统全部功能模块已实现并通过 85 项自动化测试（对应两份 PRD §12 的验收用例：QOS A1–E2 全部 + 平台 P1/CN/RD/OM/SY/AU/WF/SC/SK/MC）
- 联调冒烟已验证：双服务 readyz、行级权限过滤（planner 12 基地 vs base_manager 仅常州）、求解器确定性、DataCore 宕机时 AgentCore 如实上报
- 已知延后项：file_upload 的 XLSX 解析（CSV/JSON 已支持）、sap_erp 等 5 类连接器仅注册 configSchema（按 PRD"预留接口"定位）、连接器 cron 调度器、`apps/frontend-shell`（总纲标记可后置，demo HTML 为 UI 参考）
