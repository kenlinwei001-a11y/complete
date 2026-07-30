# CLAUDE.md — 全域数字化智能决策支撑系统

类 Palantir Foundry/AIP 的双系统决策平台 monorepo（pnpm workspace, Node ≥20, TS strict, zod 4）。

## ⛔ 铁律 0 · 先读系统本体（违反即返工）

**产出任何 PRD / 架构变更 / 跨模块改动，或回答"改 X 会影响什么 / 为什么这里断了"之前，必须先完整阅读 `docs/SYSTEM-ONTOLOGY.md`（平台自我元模型 = 系统接线单一来源），或调用 `/ontology` skill。**

- 分析必须**沿链路走**（本体 §3），断点常在接缝而非模块内部；牢记"**绿测试 ≠ 能用**"。
- 任何 PRD / 架构文档**必须含《本体引用与影响》一节**：列出触及的对象类型 / 链路 / 事件 / 不变量(R1–R12) / 断点(G-1…G-8)。
- 若改动**新增或改变了链路 / 事件 / 对象类型 / 不变量 / 门禁 → 必须回写 `docs/SYSTEM-ONTOLOGY.md` 对应章节**（本体不回写即过期失效）。
- 命名**禁用外部产品名**（如 某参考的产品，是参考产品），用平台自有术语。

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

- **并行优先 · 不逼用户单选（违反即返工）**：多条**相互独立**的工作线（复审 A ＋ 派 dev 做 B ＋ 出文档 C）能并行就**全部并行推进**——审核方自己就是并行调度器（派后台 dev ⊕ 自己开工 ⊕ 发产物同时进行），边做边报、不等许可。**绝不**把独立工作摆成"选一个"逼用户单选：用户的时间不该花在裁剪我本可同时做的事上，默认答案永远是"都做"而非"选一个"。**只有**当选项真互斥（同一文件冲突改法 / 二者取一的架构决策）、或用户优先级真会改变"做什么"时，才用 `AskUserQuestion`。（唯一并发红线：`datacore` 勿并发多 vitest gate，见下 LOOP 纪律——串行化 gate，但派活/复审/出文档等其余工作线照并行。）
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
- **接缝门 SEAM-GATE**：凡「数据+引擎两半」或「A+B 两系统」拆开做的特性，交付必须含一条**驱动接缝的组合测试**——在 merge/集成态断言端到端行为，而非只测各半 unit。例：metric-aware 须测 `gap_attribution(market_share)→cf-competitor-price`（数据种绑定 × 引擎路由，任一半漏即红）。**审核方复验头号判据 = 接缝驱动通，非各半绿**；「绿测试≠能用·断在接缝」的老坑靠此门堵死。
- **门必须显式捕获退出码（违反即事故·已真实发生）**：交付门一律走 `bash scripts/gate.sh`。**禁止** `cmd | tail -n; echo "EXIT=$?"` —— `$?` 取的是管道末端 `tail` 的退出码（恒 0），曾据此把一个 **agentcore 编译失败**的 commit 判为"BUILD 通过"并入正线，直到部署方 build 失败才暴露（错误原文当时就在日志里，被假绿盖过）。失败时须打印 `error TS|FAIL|AssertionError` 原文，不许只 tail 几行把错误挤掉。
- **LOOP 派发/复验纪律**：功能拆成 WO（工单）派 dev。① **每张 WO = 一条 handoff 分支**（dev 建 → push `claude/handoff-<wo>`，不碰正线）。② **审核方隔离复验**：worktree 独立 checkout → **组合四包 gate**（`pnpm -r build && pnpm -r --workspace-concurrency=1 test`·datacore 勿并发多 vitest）→ cherry-pick 上 canonical → push。**头号判据 = 接缝驱动通（SEAM-GATE）+ 四包全绿 + 亲手真跑（绿测试≠能用）**，退则给精确 file:line + 最小修路径。③ **一 WO 一 fresh dedicated dev·靠文件边界不靠身份**：每张 WO 顶部写 **🚦范围边界**（只碰哪些文件/包）——这就是该 dev 本单的"身份"，无需追问"哪个 dev 是哪个"。**跨数据/引擎两半的特性必须一个 dev 整单做（拆两半用不同机制不对接 = metric-aware 反复炸的根）。** ④ 金值/注册即更（新增 solver/对象类型 → 同步 golden 计数·demo-chain/catalog/ontology-core），漏金值即退。

## 文档索引

- `docs/PRD-platform-foundry-aip.md` — 平台总纲（系统边界、A0–A8/B1–B7、验收 §12）
- `docs/PRD-query-orchestration-service.md` — QOS 详细规格（事件名 §8.2 一字不差）
- `docs/PRD-frontend.md` — 前端（路由表 §3、启动序列 §4.1、renderer 分发 §7、验收 §11）
- `docs/PRD-addendum-*.md` — 时序 A8 / Entitlement / 求解器增量
- `packages/contracts/src/workspace.ts` — `GET /a/v1/me/workspace` 响应契约（部署批次新增）
