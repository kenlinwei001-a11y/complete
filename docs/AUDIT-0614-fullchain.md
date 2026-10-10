# 缺口审核 · 0614 构建 · 场景全链条（含 某参考的产品 v2 PRD 差距）

| 项 | 值 |
|---|---|
| 版本 | v1.0 · 状态 审核结论 · 日期 2026-06-15 |
| 对象 | `complete0614github` 全量构建（DataCore A `/a/v1` · AgentCore B `/api/v1`+`/b/v1` · frontend-shell） |
| 方法 | **基于场景的全链条追踪**（问句/数据/本体三类主链端到端走通），非按模块罗列；4 路并行只读审核 + 实测 `pnpm -r build && test` 地面真值；每条结论带 `file:line` 证据 |
| 基线对照 | 平台总纲 / QOS / 前端 PRD + 新上传 `PRD-某参考的产品-v2-unified-modeling`（统一本体建模工作流） |

---

## 0. 总判（一句话）

**代码是健康的，但"绿"掩盖了链条断裂。** `pnpm -r build` 全绿、`pnpm -r test` 退出码 0（datacore **255** 测试全过，agentcore/frontend/parity 全绿）——但测试只覆盖了 **4 个接好线的场景、且全在 mock 下**。真实场景全链（20 场景 / 跨服务 / 任意本体 / 自助闭合）有**系统性断点**。结论不是"哪个模块坏了"，而是"链条覆盖范围不足 + mock 藏住了真实断点"。

---

## 1. 实测地面真值

- `pnpm -r build`：5 包全部 built（contracts / llm-adapters / datacore / agentcore / frontend-shell）。
- `pnpm -r test`：退出码 0，无任何 FAIL。datacore **255 passed (39 files)**；agentcore / frontend / parity 全绿（PRD §10 DoD 写的 datacore 248 已增至 255）。
- 含义：**缺口不在"代码坏了"**，而在下面的链条覆盖与通用化。

---

## 2. 核心发现：一个场景的全链，断在哪

以"用户点场景卡 → 出答案"为主线逐段实测（✓ 通 / ◐ 半通 / ✗ 断）：

| 全链分段 | 状态 | 断点与证据 |
|---|---|---|
| ① 场景启动器（点卡片） | ✗ | **无 `scenarios` 启动器视图**；`SceneEntryConfig` 仅 `suggestedQuestions` chips，无 `presetContext/targetView/selectedObjects/slotPresets`（`packages/contracts/src/agentcore.ts:171-195`）。只有"建议问句"纯文本自动提交 |
| ② 注入预置上下文 | ✗ | presetContext 仅在 `GET /b/v1/scenarios` 下发（`apps/agentcore/src/server.ts:1367`），**不注入 QOS 管线**；catalog 的 slotPresets 键名（modelId/baseId）与种子意图槽位键名（model/base）**对不上**（`scenarios-catalog.ts:61-62`） |
| ③ 意图分类 | ◐ | 分类器机制 ✓ 正确（`router/orchestrator.ts:225,314-349`），但候选只来自**已发布意图**——种子只发布 **4 个意图**（`mocks/seed.ts:99-377`） |
| ④ 路径A 解析执行计划 | ◐ | `resolvePlanForIntent` ✓（`catalog/service.ts:83`，`orchestrator.ts:526`），但**只种 4 个 plan**。**16/20 场景无 IntentDefinition、无 ExecutionPlan** → 落路径B Agent 或"请换个问法"，**走不到自己声明的求解器** |
| ⑤ invoke_solver → DataCore | ◐ | 真实 HTTP 接好（`tools/datacore-http.ts:88-93`；`main.ts:42` 按 `DATACORE_BASE_URL` 选真实/mock）；DataCore 实现 19/20 求解器。**但** affected_orders 形状不匹配（见 §3） |
| ⑥ render_answer / SSE | ✓ | 步骤引擎 + 9 个规范 SSE 事件（task.accepted…task.cancelled）全接好正确（`workflow/executor.ts:76-289`、`api/sse.ts`）；答案 5 种 block 全分发（`frontend-shell/src/components/Answer/AnswerBlocks.tsx:21-44`） |

**结论：20 场景里只有 4 个（S01/S02/S03/S06）能端到端出答案，其余 16 个（S04/S05/S07–S20）在 ③④ 处断开。** 求解器在 DataCore 里**存在**（含 13 个 NEW，`solvers/extended.ts`），但 QOS 够不着——这是 0614 版真正的残留缺口：**求解器补齐了，意图→计划→求解器的 QOS 接线只覆盖 4 个场景。**

> 测试为何全绿？`apps/agentcore/test/scenarios.test.ts` 只断言 `GET /b/v1/scenarios` **列表**，从不 POST 触发问句真跑场景；所有链路测试用 `ScriptedLlmClient + createMockDataCore`（`apps/agentcore/test/helpers.ts:49-50`）。**真实跨服务 invoke_solver 路径零集成测试。**

---

## 3. 一个被 mock 藏住的真实 bug（S02，跨服务必现）

- 种子 plan 读 `{{steps.s1.output.data.rows}}` 与 `data.count`（`mocks/seed.ts:130-138`）；
- mock 的 affected_orders 正好返回 `rows`+`count`（`mocks/clients.ts:208-215`）→ 测试过；
- **真实 DataCore** 的 affected_orders 返回 `{affected[], total, problems[]}`——**无 rows / 无 count**（`apps/datacore/src/solvers/risk.ts:337`）；
- 模板引用解析到 `undefined` 抛 `TemplateResolutionError`（`util/template.ts:46`）→ **接真实 DataCore 时 S02 直接 FAIL（TEMPLATE_RESOLUTION_ERROR）**。

这是"绿测试 ≠ 能用"的实锤。修法：plan 改读 `data.affected`/`data.total`，或 DataCore 补 `rows`/`count` 别名（capacity_forecast.gapPct 已是此范式，`solvers/capacity.ts:336`）。

---

## 4. 四条全链各自的缺口

### 链A 问句→QOS→工作流→求解器→答案
机器（分类/路由/步骤引擎/SSE/Agent 循环）**✓ 完整正确**，mock 下全绿。缺口在**种子层**：16/20 场景无意图/计划接线；affected_orders 跨服务形状不匹配；无任何真实 DataCore 集成测试护栏。`sop_balance`(S18) 不是注册求解器（走 `/a/v1/sop/*` 端点），`POST /a/v1/solvers/sop_balance/invoke` 会 404——目录把它当 solver 标注是名实不符。

### 链B 数据→本体→对象→物化
数据先行**批量**链端到端 **✓**（连接器→`modeling.ts:64→207→314`→发布→物化→`runDerivations`，异常行入 `quarantine.ts`）。**单条表单创建无端点**（只 `/objects/query`、`/objects/aggregate`，单写只能走 Action 审批 `app.ts:309-320`）。**Excel 解析仍 TODO**（`connectors/registry.ts:172-173` 抛 `unsupported file format: xlsx`，无 xlsx 依赖）。

### 链C 发布本体→生成应用→推演（通用化）
**底座通用**（跟领域无关，任意本体可跑）：切片 `ontology-core.ts:534` executeSlice、派生 `ontology-core.ts:339` recompute、规则求值 `ruledsl.ts:459`、`/objects/aggregate`、通用合成实例化 `synthetic/service.ts:724`。
**应用层电池锁死**：视图布局硬编码 `Base.gwh`/`Order` 列（`seedViewConfigs` `synthetic/service.ts:840-1036`，扩展视图仅 `industry==="battery-manufacturing"` 才种 `:208`）；23 求解器全电池域（`solvers/service.ts:14-39` + `extended.ts`）；场景包/Agent 写死 `pkg_battery_manufacturing`（`service.ts:211,1022`）+"服务电池制造场景"提示词（`mocks/seed.ts:495`）；**通用 what-if `generic-inference.ts` 根本不存在**（唯一 what-if 在 `capacity.ts:178+` 绑死电池 rollup）；非电池模板规则 scope 被硬塞 `["Order"]`（`service.ts:196`）。
**新本体跑通追踪**：发布非电池本体 → 拿得到数据 + 切片/聚合/派生/规则求值，但**无可用视图、无场景入口、无 Agent、无推演**。

### 链D 前端闭合
**无场景启动器**（链①）。**自助配置死路（裁决#27）**：前端无创建 plan 的 UI（后端 `POST /catalog/packages/:id/plans` 有、前端没接）；意图绑定下拉只读 `fetchPlans`（`CatalogPage.tsx:217`），plans 只能种子（mock 静态 4 条 `fixtures.ts:507`）；**WorkflowsPage 连 workflow 都建不了**（无"+新建"，`saveWorkflow(null)` 从不调用）；SkillsPage 无创建。健康的有创建路径：AgentsPage/RulesPage/McpPage/意图本身。**某参考的产品 画布只读**（`OntologyGraphView.tsx` 仅力导拖拽+只读 Inspector，无增删改节点/边）。

---

## 5. 对照 某参考的产品 v2 PRD 的差距

PRD 要建的**全部是绿地**，逐项核验确认不存在：`/a/v1/ontology-workflows`（+validate/preview/promote/readiness/publish/scaffold）端点、`pipeline/{service,processing,subgraph,scaffold,readiness,generic-inference}.ts`、`packages/contracts/src/pipeline.ts`、`ObjectTypeDef` 的 storageMode/stateVariables/functions/actions/security、`ObjectOrigin.PIPELINE`、`ontology_workflows` 表、可编辑画布、`parseXlsx`——**一个都没有**。

### 5.1 修正后的「现状」表（核验 PRD 自评）

| 能力 | PRD 自评 | 核验结论 | 证据 |
|---|---|---|---|
| 图谱先行 直接建类型/链路 | ✓ | ✓ 属实 | `ontology.ts:119/142`，`POST /a/v1/ontology/object-types` `app.ts:859` |
| 数据源绑定到类型 | ✓ | ✓ 属实 | `ObjectTypeDef.sourceBindings` `domain.ts:251` |
| 派生 | ✓ | ✓ 属实 | `derivedProperties` + `runDerivations` `ontology.ts:486` |
| 数据先行管线 | ◐ 批量/表单 | **◐ 但仅批量** | 批量端到端；**无单条创建端点**。"表单"应删 |
| Excel 解析 | ✗ | ✗ 属实 | `registry.ts:172` |
| 数据处理（聚合/分组/失效/脱敏/行动） | ✗ 仅时序 | **⚠ 错→应 ◐** | **对象级聚合/分组已存在** `ontology.ts:27,454` + `app.ts:1025`，非"仅时序"；失效/脱敏/行动-as-processing 才是 ✗ |
| 状态变量（事件折叠+writeback） | ✗ | ✗ 属实 | 仅 temporal 历史 `ontology.ts:259` |
| 类型级 函数/行动/安全 | ✗ | ✗ 属实 | `ObjectTypeDef` 无；Action 是独立 S2 子系统 |
| storageMode 静态/本体 + promote | ✗ | ✗ 属实 | `domain.ts:242-258` 无 storageMode |
| 可编辑画布 | ✗ | ✗ 属实（只读） | `OntologyGraphView.tsx` |

**2 处 PRD 自评须修正**：① "数据处理 ✗ 仅时序" → **错**（对象级聚合已存在，应 ◐）；② "数据先行 ◐ 批量/表单" → **高估**（仅批量，无表单/单条创建）。

---

## 6. 优先级建议

分清两件事：**(甲) 让现有 20 场景真能跑** vs **(乙) 建 某参考的产品 v2 通用化平台**。建议先甲后乙。

**P0（甲·让场景跑通，工作量小、价值高）**
1. 补种剩余 16 场景的意图 + 执行计划（求解器 15/16 已在 DataCore 现成）。
2. 修 affected_orders 形状不匹配（plan 改读 `data.affected/total` 或 DataCore 补别名）。
3. 加真实跨服务集成冒烟（至少 S01/S02 打真实 DataCore），挡住 mock 漂移。

**P1（甲·闭合自助 + 启动器）**
4. 前端接 `createPlan`/`saveWorkflow(null)`/`saveSkill(null)`，消除裁决#27 死路。
5. 建 `scenarios` 启动器视图 + `SceneEntryConfig.presetContext` + sessionStore 注入动作，闭合"点卡→注入→自动推演"。

**P2（乙·某参考的产品 v2 + 通用化）**
6. 按 PRD 分期 P1–P6 建 画布 / ProcessingEngine / storageMode·promote / scaffold / **generic-inference**。其中"通用 what-if"底座（`recompute` 反向增量重算 `ontology-core.ts:339`）已具备，只差 Δ注入 + 前后对比包装——通用化性价比最高的切入点。

---

## 附录 · 关键证据锚点索引

- QOS 入口/路由/SSE：`apps/agentcore/src/router/orchestrator.ts`、`workflow/executor.ts`、`api/sse.ts`、`events.ts`
- 意图/计划绑定：`apps/agentcore/src/catalog/service.ts:83`、`mocks/seed.ts:99-377`
- 跨服务客户端/选型：`apps/agentcore/src/tools/datacore-http.ts:88`、`main.ts:42`、`mocks/clients.ts:166`
- 场景目录：`apps/agentcore/src/scenarios-catalog.ts:60-81`
- 求解器：`apps/datacore/src/solvers/service.ts:14`、`extended.ts`、`risk.ts:337`、`capacity.ts:178,336`
- 数据→本体：`connectors/registry.ts:172`、`modeling.ts:64/207/314`、`ontology.ts:119/142/486`、`quarantine.ts`
- 通用底座：`ontology-core.ts:339/534`、`ruledsl.ts:459`、`synthetic/service.ts:724/840`
- 前端闭合：`components/QueryDock/QueryDock.tsx`、`store/sessionStore.ts`、`pages/admin/CatalogPage.tsx:217`、`WorkflowsPage.tsx`、`views/OntologyGraphView.tsx`、`contracts/agentcore.ts:171`
