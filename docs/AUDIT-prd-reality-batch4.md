# AUDIT · PRD 实现状态对账 · 第 4/5 批（22 份）

| 项 | 值 |
|---|---|
| 日期 | 2026-08-07 |
| 范围 | `ls docs/PRD-*.md \| sed -n '67,88p'` 得到的 22 份 |
| 性质 | **只读审计**。本文件是本次唯一写入物，不改任何代码/其他文档 |
| 方法 | ① 先读 PRD 自己的 AS-IS 节（现状/已有资产/缺口表）② 每条判断带 `file:line` ③ 区分「没接线 / 接了线没数据 / 接了线接错地方」④ 只有 test 引用 = 已排练非已实现 ⑤ 跨语言/跨命名再搜一轮 |

## 0. 本次审计自身的工具自证（铁律 0.5 #5）

下结论前先自证工具没骗我，两条实测记录：

1. **`git grep -- 'apps/*/src'` 恒 0**：pathspec 的 `*` 不跨 `/`。本文所有检索改用 `rg` + 显式目录列表。
2. **`rg -rn "pattern"` 会把每个命中打印成字面 `n`** —— `-r` 是 ripgrep 的 `--replace`，`-rn` 被解析为 `--replace=n`。
   本次审计**真实踩中一次**：查 `LlmEmptyResponseError` 时输出全成了 `class n extends Error` / `readonly code = "n"`，
   差点据此判「错误类名被混淆/未实现」。改用 `rg -n` 后结论完全改写（实为完整实现）。
   **判据：报异常结果前，先拿一个你确定存在的符号跑同一条命令。**

---

## 1. 逐份对账

### PRD-inference-process-enhancement.md
- **它要做什么**：把 QOS 的线性 SSE 时间线升级为 10 节点非线性编排 DAG（par/conv/aux/fb 边）+ 逐节点 IPO 抽屉，横切挂到 ≥5 个推演入口。
- **PRD 自称的 AS-IS**：§2 现状与缺口表（L36-44）自评：10 节点编排 DAG ◐（只有线性 `Timeline.tsx`）· 逐节点 IPO ◐ · 缺口标红 ✅（GapReport 7 码已在）· 跨周期反馈边 ❌ · 型号收敛网络 ✅（`PmDag`）· 横切挂载 ❌（仅 QueryDock）· A5 FDE 节点图 ✅。
- **实测现状**：
  - **组件在**：`apps/frontend-shell/src/components/InferenceProcessDag.tsx`（177 行）+ `InferenceProcessPanel.tsx`（20 行）。
  - **横切挂载 6 处，超额达标**：`views/RiskBoardView.tsx:419` · `views/plan/OrderChainView.tsx:400` · `views/sim/PlanGenerateView.tsx:414` · `views/sim/ProjectSimView.tsx:512`（`mode="model-network"`）· `views/sim/PlanAuditView.tsx:179` · `components/QueryDock/TaskRun.tsx:46`。
  - **par/conv/aux/fb 四类边全在**：`InferenceProcessDag.tsx:30-37`，含跨周期反馈 `{from:10,to:2,t:"fb"}` / `{from:10,to:4,t:"fb"}`（PRD 标 ❌ 的那条**已补上**）。
  - **后端投影端点在**：`apps/agentcore/src/server.ts:455` `GET /api/v1/queries/:taskId/trace` → `projectTrace(task, plan, toolCalls)` + `deriveTraceGap(task)`；契约 `packages/contracts/src/qos.ts:611` `InferenceTraceSchema`。
- **结论**：**◐部分 · 且 ⚠PRD 自身陈述与现状不符（反向）** —— PRD 说 ❌ 的（fb 边、横切挂载）已做；PRD 的 DoD 核心（"取真实轨迹、前端零写死步骤"）**没做到**。三半缺口：
  1. **后端 trace 端点是孤儿（接了线接错地方）**：`server.ts:455` 有生产路由，但**前端零消费方** —— `rg -n "trace" apps/frontend-shell/src/api/endpoints.ts` 只命中 sim tick（:549）与 ops fallback（:780），无 `/queries/*/trace`。跨命名再搜一轮（`轨迹`/`溯源`/`provenance`）亦无。消费方只有 `apps/agentcore/test/trace-endpoint.test.ts` ⇒ **只有 test 引用 = 已排练，不是已接线**。
  2. **前端节点内容写死（违 PRD §7 "前端零写死步骤"）**：`InferenceProcessDag.tsx:18-29` 的 `NODES` 是字面量数组，IPO 文案（"resolve_slice 召回子图"/"capacity_rollup/forecast 聚合"/"evaluate_rules C01–C33"）全部硬编码。组件自注释（:11）辩称"结构 config，非业务常数"，但 IPO 三段是业务内容，非拓扑。
  3. **5/6 挂载点是"接了线没数据"**：5 个推演视图一律传字面 `solved`（如 `PlanAuditView.tsx:179` `<InferenceProcessPanel testId="inference-audit" solved />`），`InferenceProcessPanel.tsx:10` 默认 `solved = true`、`gapNode = null` ⇒ 走 `InferenceProcessDag.tsx:90` 的 `{ reached: solved ? 10 : 0, gapNode: gapNodeProp ?? null }` ⇒ **无论实际跑成什么样，10 个节点恒为 done、缺口恒不标红**。只有 `TaskRun.tsx:46` 传了真 `state`，走 `deriveStatus()`（:48-61）真派生。
- **最小 WO 建议**：`WO-IPE-TRACE-WIRING`。🚦范围边界：`apps/frontend-shell/src/api/endpoints.ts`（加 `fetchInferenceTrace`）· `apps/frontend-shell/src/components/InferenceProcessDag.tsx` + `InferenceProcessPanel.tsx`（改吃 `InferenceTrace`，NODES/IPO 由服务端投影下发）· 5 个挂载视图各传 `taskId`。**头号判据（SEAM）**：跑一条真实推演，断言 DAG 节点状态随 `projectTrace` 变（而非恒 10/done），且缺口节点红取自 `deriveTraceGap`。

---

### PRD-live-traceable-data.md
- **它要做什么**：合成数据不再直落对象，改走"合成源 Connection → RawDataset/RawRow → 物化对象（origin 记 rawDatasetId/rowIdx）"，并加全链 lineage 反查（对象级 + 任务级）。
- **PRD 自称的 AS-IS**：§2 表（L42-47）：C-1 合成直写对象无 backref（`synthetic/service.ts:159,201,502-504`）· C-2 真链路在但合成不走 · C-3 无 lineage 反查端点（"grep 无 `/lineage`"）· C-4 Task 是否留求解器入参对象 refs **待确认**。
- **实测现状**：
  - **P1 已实现（生产路径）**：`apps/datacore/src/synthetic/service.ts:662-663` `ensureSyntheticConnection` + `ensureSourceConnections`；:669-680 每类型幂等 upsert `RawDataset` + `rawRows.replace`；:693-703 物化对象 `origin: { ...origin, sourceConnId, rawDatasetId: ds.id, rawRowIdx: idx }`。**这段在 `chainMode=false` 的生产路径上也跑**（:688 的 `if (chainMode)` 只跳过②物化，①原始表无条件产出）。
  - **P2 半实现**：`GET /a/v1/lineage/object/:type/:id` 真在 —— `apps/datacore/src/app.ts:2496-2523`，经 `ontology.getObject` 做 READ 鉴权/行级过滤（R3/A6），回 `{object, source{connection,rawDataset,rawRowIdx,rawRow}, derivations, snapshotVersion}`。
    **`GET /a/v1/lineage/task/:taskId` 完全不存在** —— `rg -n "lineage/task|taskLineage|lineageTask" apps packages` = **0 命中**（datacore/agentcore/frontend/contracts 全查）。C-4「Task 留入参对象 refs」亦未落。
  - **P3 只接了 1/3 挂载点（接了线没数据）**：`apps/frontend-shell/src/api/endpoints.ts:477-478` 有 `fetchObjectLineage`；唯一消费方 `components/Provenance.tsx:55`，且其查询 `enabled: open && hasLineage`，`hasLineage = Boolean(objectType && objectId)`（:52）。**全仓只有一处传 objectType+objectId**：`views/LedgerView.tsx:94`。PRD §3.3 点名的"推演结果块 / 驾驶舱 KPI 溯源"实际走的是 `Provenance` 的**作者标注模式**（`src`/`formula` 字面量，如 `views/BaseOutlookPanel.tsx:158` `src="base_capacity_outlook 求解器" formula="缺口 = 需求 − 供给 …"`）⇒ 这些悬浮溯源**根本不发 lineage 请求**，展示的是写死的公式串。
  - **⚠ 附带发现（与本 PRD 的确定性主张相关）**：`viaModelingChain` 生产实参恒 `false`（`apps/datacore/src/seed.ts:128`），传 `true` 的只有 `apps/datacore/test/datamode-provenance.test.ts:49` 与 `demo-chain-provenance.test.ts:19,79` ⇒ 建模链那条 provenance 路径**生产从不走**（CLAUDE.md 已登记为 `G-SEED-PROVENANCE-BACKFILL-UNASSERTED`，此处复核仍成立）。注意：**这不影响 P1 判绿** —— A 路（`!chainMode`）自己就产 RawDataset + backref。
- **结论**：**◐部分**。P1 ✅（生产真跑）· P2 ◐（对象级 ✅ / 任务级 ❌ 没接线）· P3 ◐（端点接了，但 6 个 `Provenance` 挂载点里 5 个是作者标注模式，不触发 lineage）。
- **最小 WO 建议**：
  - `WO-LINEAGE-TASK`（P2 补口）。🚦范围边界：`apps/datacore/src/app.ts`（加 `/a/v1/lineage/task/:taskId`）· `apps/agentcore/src/router/orchestrator.ts`（Task 留 solver 入参对象 refs，C-4）· 双仓储 `repo/pg.ts`+`repo/memory.ts` 若需列。SEAM 判据：一次真推演 → task lineage → 入参对象集 → 各自 object lineage → RawRow。
  - `WO-PROV-OBJECT-MODE`（P3 补口，轻）。🚦范围边界：`views/BaseOutlookPanel.tsx` · `views/capacity/*.tsx` —— 给已有 `Provenance` 补 objectType/objectId，让悬浮真取活数据（现只有 `LedgerView.tsx:94` 一处）。

---

### PRD-llm-agent-empty-response-guard.md
- **它要做什么**：修 `INTERNAL_ERROR · Cannot read properties of undefined (reading 'usage')` —— 给 agent loop 与 anthropic 适配器加空响应护栏，收敛为 R7 结构化信封。
- **PRD 自称的 AS-IS**：§2 表（L37-43）：`loop.ts:473` 无判空裸崩 · `anthropic.ts:129/158/175/194/228` 5 处无 `?.` 护栏 · `openai.ts:208-249` ✅ 已护栏 · `providers.ts:275 toFallback` ✅ 正确 re-throw。
- **实测现状**：
  - **FIX.1 已做**：`packages/llm-adapters/src/types.ts:176-181` `export class LlmEmptyResponseError extends Error { readonly code = "LLM_EMPTY_RESPONSE" }`；`apps/agentcore/src/agent/loop.ts:820-822` `if (!response || !response.usage) throw new LlmEmptyResponseError(...)`，护栏就在 `:823 totalInput += response.usage.inputTokens` 之前。
  - **FIX.2 已做**：`packages/llm-adapters/src/types.ts:188-193` `requireUsage(resp, model)` 抽成公共校验；`anthropic.ts:131 / :182 / :219 / :254` 四处调用，覆盖 classify / agent(messages.create) / compose / parse 全部读 usage 的路径（PRD 数的"5 处"是 5 个**读取行**，实为 4 个**调用点**，每点后跟 input/output 两行读取 —— 数目差异不是缺口）。另 `toolloop.ts:25` 补了 content 判空。
  - **R7 信封映射已做（生产路径，非仅 test）**：`apps/agentcore/src/router/orchestrator.ts:2743-2746` `failFromError` 取 `err.code` 否则回落 `INTERNAL_ERROR` → `failTask`（:2748）→ `:2795 error: { code, message }` + `:2798 events.emit(taskId, "task.failed", …)`。`:2787` 还把原始成因原文落进答案 markdown（不概括）。
  - 回归测试：`apps/agentcore/test/empty-response-guard.test.ts:32-49`（requireUsage 三态 + runAgentLoop 两态）。
- **结论**：**✅已实现**（FIX.1 + FIX.2 + 信封映射三段齐，且都在生产调用路径上，非只有 test）。
- **备注**：PRD §7 最后一条"配好 agent 用途 Kimi 绑定后推演正常完成"**不在本 PRD 范围**（PRD 自己在 L81 声明为根因侧、需有效 key），故不计入缺口。

---

### PRD-maturity-master-plan.md
- **它要做什么**：不是特性 PRD，是**路线图主纲** —— 定义 8 条成熟度轴的 L0–L5 判据、当前档位、14 个达标 Epic（E1–E14）与相序。
- **PRD 自称的 AS-IS**：§4「当前档位（证据支撑）」L60-72：M1 L1–L2 · M2 **L0–L1**（无数据集级转换引擎）· M3 L2 · M4 **L1**（"真实适配器在，但 **478 测试 LLM 全 mock**，无评测套件落地"）· M5 L2 · M6 L2 · M7 L2–L3 · M8 L1–L2 · **加权 ≈ L1.6（约 32%）**。§1 表 L33 另称"**8/21 求解器实现**"。
- **实测现状**：
  - **⚠ §1「8/21 求解器」严重过期**：`apps/datacore/src/solvers/service.ts:49` `SOLVER_KEYS` 实测 **59 个**（脚本计数，非目测）。且 `:58` 的注释原文写着 `// 20 场景目录 §2 新增 13（成熟度 E6a）` —— **代码自己标注它就是本 PRD 的 E6**。`apps/datacore/test/catalog.test.ts:55` 的金值断言写"40"（含 DS.2 cockpit_kpi），也已落后于 59。⇒ **E6「13 求解器补全」早已完成且被超额**，PRD §5 仍把它列为未启动 Epic（量级 M）。
  - **⚠ §4 M4「478 测试」过期**：实测 `apps/datacore/test/*.test.ts` **236 个文件**、`apps/agentcore/test/*.test.ts` **150 个文件**（文件数，非用例数；用例数只会更多）。
  - **M1 判据未变**：`apps/datacore/src/connectors/registry.ts:21` 注释仍写 file/rest_api/mock_erp/mock_crm；:128/:134 注册 `mock_erp`/`mock_crm`；:329 `connector type '…' is registered but has no adapter implementation yet`。另有 `file_upload`（`connectors/service.ts:303`）与 `prototype_html`（:325）。**E1 三类生产连接器（DB-CDC/OData-SAP/REST 分页鉴权）未见** ⇒ M1 判据仍成立。
  - **§7 验收口径未落**：PRD 要求"每季度 VLE FULL profile 出成熟度报告首页 / 8 轴雷达"。`rg -in "maturity|成熟度|8 轴|axis" apps/datacore/src/vle.ts apps/datacore/src/vle-oracle.ts` = **0 命中** ⇒ VLE 在，但**没有 8 轴成熟度报告**这个东西 ⇒ 裁决 #29「成熟度以 VLE 报告为唯一验收口径」目前**无实现载体**。
- **结论**：**⚠PRD 自身陈述与现状不符**（AS-IS 已过期，方向是"低估了现状"）。作为路线图它未被回写维护：E6 已完成、求解器数已 59、测试规模已翻倍，而 §4 档位表与 §5 Epic 表都还停在旧快照。M2/M8 的判断（无转换引擎、无 HA/压测）未见反证，仍可信。
- **最小 WO 建议**：`WO-MATURITY-REFRESH`（轻，纯文档）。🚦范围边界：只改 `docs/PRD-maturity-master-plan.md` §1/§4/§5 三张表 —— 用 `SOLVER_KEYS`(59) / 测试文件数 / `catalog.test.ts` 金值刷新档位证据，E6 标 ✅ 完成。**另建议**：§7 的 8 轴成熟度报告若真要作为唯一验收口径，需单独一张 WO 在 `apps/datacore/src/vle.ts` 落报告生成，否则该裁决是空条款。

---

### PRD-multi-intent-L2-L3-coupled-solving.md
- **它要做什么**：L2 = LLM 产 solver 计划做真分解（补关键词漏的意图）；L3 = 把耦合链映射成一次 `portfolio_optimize` 守恒解（转拨→产能→延误→外协真传导），复用 `portfolio.ts` 不新造 solver。
- **PRD 自称的 AS-IS**：§1 表 L29-31 自评 L1 ✅已交付 / L2 🔜本 PRD P1 / L3 🔜本 PRD P2；§2 现状锚点 L39-42 列 `portfolio.ts:13-21` 联合守恒引擎已在、`router/multi-route.ts` 的 `runParallelRoutes`+`solverDepGraph` 已在。
- **实测现状**：
  - **L2 已实现并接线**：`apps/agentcore/src/router/l2-decompose.ts`（`buildL2Prompt`/`parseSolverPlan`/`validateSolverPlan`/`buildSlotBag`/`deterministicSlotFloor`/`mergeSlotFloor`），生产 import 在 `router/orchestrator.ts:76`，调用点 `orchestrator.ts:1125`（`model="llm-l2-decompose"` → 复用 `runParallelRoutes`，与 PRD §3 "不另建后半"一致）。
  - **L3 已实现并接线**：`apps/agentcore/src/router/l3-coupled.ts`（`isCombinationAsk` / `runL3CoupledPath`），生产 import `orchestrator.ts:77`，升格判在 `orchestrator.ts:941-951`：`l3CoupledEnabled(opts.enabledFeatures) && coupledPairs.length > 0 && …` → `runL3CoupledPath(...)` → `:968-972` 落 `answer`/`multiIntentPlan` + `events.emit(taskId, "answer.final", …)`；失败/关门回落 L1（:980 `runParallelRoutes`，零回归，符合 §5.5）。
  - **门（entitlement）**：`apps/datacore/src/features.ts:148-149` 两键均 `defaultOn: false`，且 :173-174 进 `QOS_DARK_LAUNCH_FEATURES`（`test/dark-feature-default-off.test.ts:52-53` 断言 all-on 也保持关）。
  - **⚠ L2 与 L3 的开关状态不对称（关键区分）**：`apps/datacore/src/seed.ts:70` `"qos.multi-intent-l3-coupled": true` —— demo 租户 DEMO_LIGHTUP **点亮了 L3**（同块 :68 还点亮 `qos.deterministic-multi-domain`，注释明说"两门缺一不可"）。**而 `qos.multi-intent-l2-decompose` 不在 DEMO_LIGHTUP 里** ⇒ L2 在任何生产租户上都是关的，只有测试显式开（`apps/agentcore/test/l2-decompose-seam.test.ts:117,169`）。
  - SEAM 测试两条都在：`apps/agentcore/test/l3-coupled-seam.test.ts:50,76,128` · `l2-decompose-seam.test.ts`。
- **结论**：**◐部分** —— 代码两层都**已实现且已接线**（非死代码）。缺口是**门态**：
  - **L3 = 接了线、门开了**（demo 租户实跑）⇒ 实质 ✅。
  - **L2 = 接了线、门没开、无生产实参**（"接了线没数据"形态）：生产 `enabledFeatures` 集合里恒无该键 ⇒ `l2DecomposeEnabled` 恒 false ⇒ 分支从未进入。**测试验的是生产没走的那条路**（同 CLAUDE.md 铁律 0.5 #6 的形态）。
- **最小 WO 建议**：`WO-L2-LIGHTUP`（极轻）。🚦范围边界：只改 `apps/datacore/src/seed.ts`（DEMO_LIGHTUP 加 `"qos.multi-intent-l2-decompose": true`）+ 补一条 demo 租户实测断言。**前置**：先按 §5.3 SEAM-L2-补漏亲手跑一条 novel 措辞问句，确认开门后不劫持既有 ②/⑤ 路由再点亮（PRD §5.5 要求 flag 全关时逐字节零回归，反向也要验）。

---
