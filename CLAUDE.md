# CLAUDE.md — 全域数字化智能决策支撑系统

类 Palantir Foundry/AIP 的双系统决策平台 monorepo（pnpm workspace, Node ≥20, TS strict, zod 4）。

## ⛔ 铁律 0 · 先读系统本体（违反即返工）

**产出任何 PRD / 架构变更 / 跨模块改动，或回答"改 X 会影响什么 / 为什么这里断了"之前，必须先读本体。** 日常检索走**克隆索引** `docs/ontology/INDEX.md`（层 1「任务→切片」路由 → 只读对应切片，简洁高效）；`docs/SYSTEM-ONTOLOGY.md` 是**母体（唯一真相源 + 回写目标）**。改接线改母体、再跑 `pnpm ontology:slices` 同步切片（门 `ontology-slices:check` 守漂移·母体改而切片未重生成即红）。或调用 `/ontology` skill。

- 分析必须**沿链路走**（本体 §3），断点常在接缝而非模块内部；牢记"**绿测试 ≠ 能用**"。
- 任何 PRD / 架构文档**必须含《本体引用与影响》一节**：列出触及的对象类型 / 链路 / 事件 / 不变量(R1–R12) / 断点(G-1…G-8)。
- 若改动**新增或改变了链路 / 事件 / 对象类型 / 不变量 / 门禁 → 必须回写 `docs/SYSTEM-ONTOLOGY.md` 对应章节**（本体不回写即过期失效）。
- 命名**禁用外部产品名**（如 某参考的产品，是参考产品），用平台自有术语。

## ⛔ 铁律 0.4 · 真实测试·前端看真 UI 对照后端·不作假（违反即返工·详见 `/fde-delivery`）

**用户亲定（钉死）：一切以真实测试为原则；前端需真看到生成的 UI 内容，逐值对照后端比对；不图省事，以解决根因为原则；不做冒烟测试要做真实测试；不作假。**
- 断言"能用/满足需求"前必须**真起服务真跑真数据真看结果**，只跑单测/gates=冒烟≠真能用。
- 涉前端展示必须**真渲染看到 UI + 前端所见逐值对照后端真值**（真浏览器/真起前端），只 jsdom/只 mock≠看到真 UI。
- **绝不用合成/手绘/哈希/兜底值冒充真实数据源或真值**；无真数据→诚实空态/诚实静止 + 指明真值证在何处（KILL-MOCK-RED 同源红线）。

## 架构地图

```
packages/contracts      共享契约（zod schema）。禁止跨 app import 源码
packages/llm-adapters   共享 LLM 适配器层（增量 §1.2：Anthropic/OpenAI-compat/custom_http 留接口 + JSON-mode 降级）
apps/datacore           System A（Fastify, 端口 4001, 路由前缀 /a/v1）
                        A0 IAM(JWT RS256+JWKS) · A1 连接器 · A2 规则文档抽取 · A3 半自动建模
                        A4 本体/对象/求解器/派生 · A5 规则 DSL · A6 权限(行级过滤) · A7 合成数据
                        A8 时序+模拟时钟 · S1 求解器 · S1.8 S&OP · S2 Action 审批 · S4 知识库
apps/agentcore          System B（Fastify, 端口 4002, 路由 /api/v1 原生 + /b/v1 重写别名）
                        QOS 查询编排(分类→路径A工作流/路径B Agent→SSE) · B1 Agent · B2 Workflow
                        B3 MCP · B4 Skill · B5 场景入口 · 多 LLM 供应商路由
apps/frontend-shell     React 18 SPA（Vite, TanStack Query, zustand, MSW mock 模式）
docker-compose.yml      pg×2 + minio + datacore + agentcore + frontend + gateway(nginx:80)
deploy/nginx.conf       网关：/ →frontend, /a/v1→datacore, /b|api/v1→agentcore(SSE 不缓冲)
docs/                   PRD 全集（平台总纲 / QOS / 前端 / 增量 addendum），冲突时以总纲为准
DEPLOY.md               中文部署指南（docker compose + 域名 + 账号 + 模块导览 + 排查）
```

两系统松耦合：AgentCore 只经 DataCore 公开 REST（OBO 透传用户 JWT 或 X-Debug-User）访问数据；前端是两系统的汇合点（dual baseURL，部署态经网关同源）。

## 常用命令

```bash
pnpm install
pnpm -r build && pnpm -r test    # 4 包全绿是交付底线（datacore 69 / agentcore 66 / frontend 25+）
pnpm -r lint / typecheck

# 内存模式本地双服务（无需数据库）
PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 CREDENTIAL_KEY=<64hex> node apps/datacore/dist/server.js
PORT=4002 DATACORE_BASE_URL=http://127.0.0.1:4001 node apps/agentcore/dist/main.js

# pg 模式：设 DATABASE_URL 即自动选 pg 仓储并在启动时幂等迁移；手动迁移：
pnpm --filter datacore migrate && pnpm --filter agentcore migrate

# 容器整套（含前端+网关）
docker compose up --build        # 见 DEPLOY.md；登录 demo / admin / demo1234

# 前端 mock 模式（无后端）
VITE_MOCK=1 pnpm --filter frontend-shell dev
```

## 关键约定（违反即返工）

- **contracts-only-shared**：跨包只允许依赖 `@platform/contracts`；前端不得重定义契约已有类型。
- **tenant_id everywhere**：所有仓储读写、事件、缓存键都带 tenantId；跨租户访问一律 403/404。
- **Entitlement 先于 authz**：功能关闭 = 不存在 → 404 `FEATURE_NOT_FOUND`（见 datacore features.ts / agentcore features/gate.ts）。
- **no-secrets-echo**：凭据（连接器/MCP/LLM provider）AES-GCM 加密落库（CREDENTIAL_KEY），任何响应不回显明文，仅 credentialRef。
- **确定性种子**：合成数据同 (industry, scale, seed) 重跑字节级一致（seed 默认 42）；求解器同输入同参数版本同输出。测试不依赖网络/时钟随机性，LLM 一律 mock。
- **错误信封**：`{ error: { code, message, requestId } }` 两系统统一。
- **认证**：生产链路 Bearer JWT（DataCore 签发，AgentCore 经 JWKS 验签，claim `tid`/`sub`/`roles`）；开发链路 `X-Debug-User: tenantId:userId:role1|role2`（可 URI 编码，角色含 CJK）。refresh token 走 httpOnly cookie（Path=/a/v1/auth），body 透传向后兼容。
- **服务间凭证**：env `SERVICE_TOKEN`（两服务同值）→ A 的服务间路由（/a/v1/llm-providers/{id}/credential、/a/v1/references/report、provider/binding 读取）；用户 JWT 一律 403。B 对 A 资源缓存 TTL 60s + `{kind}.updated` 事件失效（钩子 POST /b/v1/internal/invalidate），传播 SLO ≤60s。
- **演示账号**：tenant `demo`，admin（admin+planner+catalog_admin）/ planner / base_manager:常州，密码均 demo1234；workspace 按角色返回不同导航/视图/主题。
- **仓储双实现**：memory（测试默认）与 pg（DATABASE_URL 触发，启动自动迁移）。新增表需同时改 migrations/*.sql + repo/pg.ts + repo/memory.ts + repo.ts 接口。

## 文档索引

- `docs/PRD-platform-foundry-aip.md` — 平台总纲（系统边界、A0–A8/B1–B7、验收 §12）
- `docs/PRD-query-orchestration-service.md` — QOS 详细规格（事件名 §8.2 一字不差）
- `docs/PRD-frontend.md` — 前端（路由表 §3、启动序列 §4.1、renderer 分发 §7、验收 §11）
- `docs/PRD-addendum-*.md` — 时序 A8 / Entitlement / 求解器增量
- `packages/contracts/src/workspace.ts` — `GET /a/v1/me/workspace` 响应契约（部署批次新增）
