# 工单派发总单（Work Order Dispatch Sheet）

> 版本：2026-07-25 · 用途：**产品负责人据此逐张派发给 dev**（大工单你发我写规格 → 你发 dev；审核方只做 跑门/复验/合并）。
> 每张工单自包含（背景 / 🚦文件边界 / 产出 / SEAM 门 / 依赖 / 验收），可直接整段粘贴给 dev。
> 详细设计见两份 PRD：`docs/PRD-agent-react-harness.md`（Harness）· `docs/PRD-decision-resource-intelligence-layer.md`（DRIL）。

---

## 0 · 派发纪律（每张工单都遵守）

1. **一张 WO = 一条 handoff 分支**（dev 建 `claude/handoff-<wo>`，不碰正线）。
2. **文件边界即身份**：每张 WO 顶部 🚦 只碰列出的文件；跨数据+引擎两半的特性**一个 dev 整单做**（拆两半接缝必炸）。
3. **SEAM 驱动接缝**：交付必须含一条驱动接缝的组合测（端到端断言真行为，非只测各半 unit）。「绿测试 ≠ 能用」。
4. **四包全绿是底线**：`pnpm -r build && pnpm -r --workspace-concurrency=1 test`（datacore 勿并发多 vitest，约 14min）。
5. **KILL-MOCK-RED**：不得用 mock 假口径掩盖真数据；无数据就诚实披露，不编造。
6. **金值/注册即更**：新增 solver/对象/资源 kind → 同步 golden 计数（catalog/chain:check/ontology-core）。

---

## 1 · 派发顺序与冲突矩阵

| 波次 | 可并行（文件不撞） | 说明 |
|---|---|---|
| **第一波（现在）** | `WO-DRIL-P1` + `WO-HARNESS-PROMPT` + `W5` | 三者文件域完全不重叠（contracts+agentcore/dril · agentcore/prompts+seed · frontend/global-sim+datacore/portfolio） |
| **第二波** | `WO-REFLECT-LOOP`（等 NL-ROBUST 急救落地后）+ `WO-DRIL-P2` | REFLECT 碰 loop.ts，避开 orchestrator（NL-ROBUST 在改） |
| **第三波** | `WO-DRIL-P3` → `WO-DRIL-P4`（顺序）+ `W6`→`W7`→`W9`（串行） | DRIL P3/P4 顺序；W6/W7/W9 都挤 global-sim/portfolio，**串行不并行** |

> ⚠ **W5/W6/W7/W9 都碰 global-sim / portfolio / 契约 → 必须串行**，硬并行会互相覆盖文件。

---

## 2 · 急救工单（最高优先·"人机对话能不能用"的命门）

### WO-0-NL-WIRING · 分类器接 LLM + 确定性兜底（急救）
> ⚠ **状态**：原由 NL-ROBUST agent 在做，**容器重启导致未提交工作丢失，需重新派发**。这是所有 NL 对话的前提——不做，绑了 LLM 也"点了没反应"。
- **目标**：让绑定的 LLM provider **真正驱动 classifier**（真实 Kimi 实测：分类命中→path-A→出真答案 P50 12.3GWh；不接→path-B→INTERNAL_ERROR）。
- **🚦边界**：`apps/agentcore/src/router/orchestrator.ts` · `apps/agentcore/src/router/domain-resolver.ts` · `apps/agentcore/src/llm/providers.ts` · test
- **产出**：① 意图理解环节真接 LLM（`QOS_CLASSIFIER_MODEL` 可指轻量模型）；② 确定性兜底——低置信/无 LLM 时走 domainResolve 正则 fail-safe，不落 path-B 洪泛报错；③ 降级诚实（答不了明说，不编）。
- **SEAM 门**（env-gated 真 LLM）：「4680-NCM 加 20% 六周能不能接」→ classify 命中 `capacity_feasibility` → path-A → COMPLETED 真答案；无 LLM 时不 INTERNAL_ERROR 而是确定性兜底或诚实降级。
- **依赖**：无。**最高优先，第一波先派这张**。

---

## 2.5 · Bug 修复 / 部署排查（你正在踩）

### BUG-GLOBAL-SOLVE · 全局联合求解「Failed to fetch」

**现象**：全局联合推演页点「发起联合求解」→ 求解失败：Failed to fetch。

**审核方定位（代码已核，非代码 bug）**：
- 前端 `发起联合求解` → `useLiveSolver("portfolio")` → `POST /a/v1/solvers/portfolio/invoke`（`endpoints.ts:185`）。
- 后端 datacore **有此路由**（`app.ts:2605 app.post("/a/v1/solvers/:solverKey/invoke")`），内存模式有 `InProcOptimizerClient` 贪心兜底出 FEASIBLE（`app.ts:321`）。
- 「Failed to fetch」是**浏览器网络级失败**（连接被拒/域名不可达/CORS），**不是** 404、**不是**求解器内部报错（那会返回 HTTP 500 带错误体）。

**结论 = 部署/运行态问题，不是代码**。排查顺序：
1. **datacore 后端没起 / 崩了**（最常见）：内存模式重启 datacore
   ```bash
   pnpm -r build   # 若改过代码，先重建 dist（你是内存模式，dist 不重建=旧口径）
   PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 CREDENTIAL_KEY=<64hex> SERVICE_TOKEN=svc \
     node apps/datacore/dist/server.js
   ```
2. **baseURL 不对**：前端 `api.a` 指向的 datacore 地址（端口/网关）与实际不符 → 部署态经网关同源，本机双服务需 dual baseURL 指对。
3. **健康自检**：`curl -s http://127.0.0.1:4001/a/v1/health` 应 200；再
   `curl -s -XPOST http://127.0.0.1:4001/a/v1/solvers/portfolio/invoke -H 'X-Debug-User: demo:admin:admin|planner' -H 'Content-Type: application/json' -d '{"args":{}}'` 应返回 FEASIBLE 方案。

**审核方待办**：本机真跑 `/a/v1/solvers/portfolio/invoke` 出 FEASIBLE 给你铁证（证代码无 bug）。**不需派 dev**（除非真跑发现隐藏 bug 才转 WO）。

---

## 3 · DRIL 层工单（详见 PRD-decision-resource-intelligence-layer §10）

### WO-DRIL-P1 · 契约 + Resource Registry 基础
- **目标**：把 6 类资源升级为统一 `IntelligenceResource`，建注册表，一次发现全量资源。
- **🚦边界**：`packages/contracts/src/intelligence-resource.ts`(新) · `apps/agentcore/src/dril/{resource-registry,resource-projector}.ts`(新) · `apps/agentcore/migrations/*`(新表) · `apps/agentcore/src/repo/*`(memory+pg 双实现)
- **产出**：基类 + per-kind schema（solver/slice/rule/skill/workflow/agent/mcp/intent）+ `RESOURCE_KINDS_EXTENDED` + 三表（`intelligence_resources`/`resource_relations`/`resource_quality_scores`，R9 四处同改）+ 启动全量投影 + `GET /b/v1/resources[/{kind}/{key}]`。
- **SEAM 门** `dril-registry:check`：启动后所有可发现资源能投影为合法 `IntelligenceResource`，无空描述资源。
- **依赖**：无（基础层）。**先派**。

### WO-DRIL-P2 · 五级标签 + 混合检索
- **目标**：问句 → 最相关资源的向量检索（不再 LLM 看描述自选）。
- **🚦边界**：`apps/agentcore/src/dril/{tag-taxonomy,search-engine}.ts`(新) · 标签回填脚本
- **产出**：`TieredTags`(L1-L5) + `DRIL_TAG_TAXONOMY` + 为现有 solver/slice/operation 回填 + `structured filter → embedding → ranking` 引擎 + `POST /b/v1/resources/search`（返 `scoreBreakdown`+`explanation`）。
- **SEAM 门** `dril-retrieval:check`：golden query set 预期资源进 top-3 ≥ 90%。
- **依赖**：P1。

### WO-DRIL-P3 · 图遍历 + 质量分（跨 A+B·一个 dev 整单）
- **目标**：关系图验证 + 运行时质量分回灌，接 Compose 路径。
- **🚦边界**：`apps/agentcore/src/dril/{relations,quality}.ts`(新) · `apps/agentcore/src/router/compile-plan.ts`(接) · `apps/agentcore/src/evals.ts`(parity 回灌钩子)
- **产出**：`resource_relations` 自动抽取（solver.reads→objectType、rule.scope、slice.includes、workflow.step）+ `graphDistance`(复用 datacore planSlice BFS·R6) + EWMA 质量分 + `ResourceRouter.buildResourcePackage` 接 `compileSolverPlan`。
- **SEAM 门** `dril-quality:check`：模拟调用后 quality 按 EWMA 更新，低质资源排名下降。
- **依赖**：P2。

### WO-DRIL-P4 · Router 接 Path-B + 治理 UI（跨 A+B·一个 dev 整单）
- **目标**：Path-B agent 用 DRIL 包替代盲扫；admin 治理页。
- **🚦边界**：`apps/agentcore/src/router/orchestrator.ts`(注入 DRIL 包·**须在 NL-ROBUST 落地后**) · `apps/agentcore/src/agent/tools/*`(discover 改查 Registry) · `apps/frontend-shell/src/pages/admin/ResourcesPage.tsx`(新页)
- **产出**：`runPathB` 注入 `drilContext` 到 system prompt + `discover` 优先查 Resource Registry + `/admin/resources`（列表/标签编辑/质量分/关系图）+ 六路由器（Ontology/Solver/Rule/Skill/Workflow/Agent）分 kind 出口。
- **SEAM 门** `dril-routing-seam`：NL query → DRIL 选对 solver+slice+rule → Compose/Agent 执行 → 答案可溯源（runAgentLoop ≤4 或 Compose 零 agent）。
- **依赖**：P3 + NL-ROBUST 急救。

---

## 4 · Harness 层工单（详见 PRD-agent-react-harness §9）

### WO-HARNESS-PROMPT · 七要素提示词重构（现在可派）
- **目标**：把每个 agent/workflow 提示词重构到企业级七要素标准。
- **🚦边界**：`apps/agentcore/src/agent/prompts.ts` · `apps/agentcore/src/mocks/seed.ts` · 波及的 ~13 test（禁碰 orchestrator/domain-resolver/任何 datacore/frontend）
- **产出**：
  - 共享核 `AGENT_SYSTEM_CORE` **叠加**四段：推理循环（Think→Act→Observe→**Reflect**）/ 错误恢复（分类恢复）/ 求解纪律（禁 LLM 直接算·必调 solver）/ 结果结构（结论·分析·证据·建议·风险五段）。
  - 每个 agent `systemPrompt` 从一句话重构为结构块：`【角色】【目标】【对象域】【对口能力】【交卷】`（对齐各 agent toolWhitelist/scopeDeclaration，语义不变只改结构）。
  - workflow step prompt 顺手结构化（不改 step 拓扑）。
- **硬约束**：prompt 全文**保留**测试锁定短语 `本题导航图`/`数字红线`/`写降级`/`能力边界`/`注入防护`/`[预算耗尽·诚实摘要]`；**只叠加不删改**；语义不弱化（§5.4.3）。
- **SEAM 门**：新增 `harness-elements.test.ts` 断七要素齐 + 旧 `lived-in`/`qos-b`/`qos-agent-slice-seam`/`agent-budget` 全绿。
- **依赖**：无。**第一波可派**。（完整叠加段全文见 PRD-agent-react-harness §3）

### WO-REFLECT-LOOP · 反思/重规划闭环（等 NL-ROBUST 后派）
- **目标**：循环收尾前显式复盘，失败复盘-重试，补齐「理解-计划-分解-执行-反思」闭环。
- **🚦边界**：`apps/agentcore/src/agent/loop.ts` · `apps/agentcore/src/agent/reflect.ts`(新) · test（禁碰 orchestrator——NL-ROBUST 在改）
- **产出**：收尾前挂 `reflectAnswer`（R6 复盘清单：答了吗/数字落地/工具静默失败/越 scope/口径一致 复用 crossValidate）+ 重规划有界（默认 ≤1 次）+ Solver-first 打回（排产优化题没调 solver 或数字未 ⟦ref⟧ → 打回）+ `AgentRunRecord.reflected/replanReason` + entitlement `agent.critic`(defaultOff)。
- **SEAM 门**（头号判据）：构造工具静默失败场景 → reflect 拦下并重规划（对比关闭时漏发半成品）；且**关 reflect / path-A 命中题字节兼容零回归**。
- **注意**：与 SOLVER-FIRST-GATE **同一 dev 整单做**（都改 reflect.ts+loop.ts）。
- **依赖**：NL-ROBUST 急救落地。

---

## 5 · 验收 backlog 工单（用户实测提出·都挤 global-sim/portfolio → 串行）

### W5 · 业务类型差异化 + 勾选筛选
- **目标**：乘用车（产能不足+销售预测虚高+提前交付）/ 商用车（产能空闲+订单波动大）/ 储能（产能 95% 稳）三类差异化推演 + 勾选筛选。
- **🚦边界**：`datacore/src/synthetic/battery.ts`(业务类型种子) · `datacore/src/solvers/portfolio.ts`(分型口径) · `contracts`(业务类型字段) · `frontend/views/sim/GlobalSimView.tsx`(筛选 UI) · mock
- **产出**：订单/客户带 `businessType`（乘用车/商用车/储能）种子差异化 + portfolio 按型分口径 + 前端勾选筛选（含"销售预测 >> 实际订单"与"需提前交付"场景可见）。
- **SEAM 门**：勾选储能 → 占用率≈95% 稳；勾选乘用车 → 现产能不足+预测虚高缺口（改筛选→输出真变）。

### W6 · 分批交付 per-order（G-VAR-1/2）
- **🚦边界**：`contracts`(per-order 分批开关+最终交付日期) · `datacore/src/solvers/portfolio.ts`(分批引擎) · `frontend GlobalSimView`(每订单开关+目标vs最终交期) · mock
- **产出**：每订单"分批交付"开关 + 最终交付日期 per-order + 目标交期 vs 最终交期推演。
- **SEAM 门**：某订单开分批 → 联合求解结果该单按期率/交期真变。

### W7 · 方法旋钮 + 客户卡 + 订单列（G-VAR-3/G-UI-2/3）
- **🚦边界**：`frontend GlobalSimView` + 多目标面板 · `contracts`(方法参数) · `datacore/src/solvers/{multi_objective,portfolio}.ts`
- **产出**：方法旋钮暴露（加权权重/ε上界/字典序优先级）+ 客户级影响卡 click→项目详情（去占位死按钮·数据与推演一致）+ 每订单补 基地+产线 列。
- **SEAM 门**：改权重 → 多目标最优真漂移；点客户卡 → 跳详情数据一致。

### W3 · 切片/切片库 admin 全量可编辑（部分已合，补剩余）
- **🚦边界**：`frontend/pages/admin/SliceInspector.tsx`+切片库页 · `datacore/src/ontology-governance.ts`
- **产出**：admin 账号下已有切片可配置编辑（内联图谱+推进契约已合 6719197d，补 admin 编辑闭环）。
- **SEAM 门**：admin 编辑切片 → 保存后真值变、非 admin 只读。

### W9 · windowDays 正口径 + UI 大白话
- **🚦边界**：`frontend GlobalSimView`(windowDays 标注) · `locales/zh.ts`(界面词)
- **产出**：窗口天数标注与实跑口径一致（现标 21 实跑需核）+ 界面黑话改大白话。
- **SEAM 门**：UI 标注的 windowDays == 引擎实际 windowDays。

---

## 6 · 附录：两份 PRD 索引

| PRD | 管什么 | 核心 |
|---|---|---|
| `docs/PRD-agent-react-harness.md` | Agent 怎么想/用好/验对 | 七要素 Harness + 理解-计划-分解-执行-反思闭环 + 三级路由（全模式仅在无预设 agent 兜底时启动）+ Solver-first 硬纪律 + Critic 反思 |
| `docs/PRD-decision-resource-intelligence-layer.md` | Agent 怎么选对资源 | 统一资源目录 + 独立向量检索（retrieve_knowledge）+ 资源 MCP 化 + 五级标签 + 质量分 + 六路由器（Ontology/Solver/Rule/Skill/Workflow/Agent Router） |

> 两份 PRD 在 DRIL §8「与 QOS 编排层集成」接缝：DRIL 选对资源 → 喂 Harness 的推理闭环。
