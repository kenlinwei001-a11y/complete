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

### PRD-multi-intent-orchestration.md
- **它要做什么**：L1 独立多意图 —— 分类器吐出的多个高置信候选（槽可填·无冲突·独立）→ 并行 solver → **零 LLM 确定性块装配**；耦合对诚实标"未链式传导·见 L3"。
- **PRD 自称的 AS-IS**：§2（L50-54）：`orchestrator.ts` 分类后取 top-1 → 单 solver；实测 Q1 只跑 `outsourcing_q`、候选压根不含 `capacity_forecast`；Moonshot 置信度分散 → 触发 `AWAITING_CLARIFICATION` 把多意图逼成单选。缺口 ①无多候选并行 ②澄清抢在多意图之前 ③Q1 本身是耦合的。
- **实测现状**：
  - **判定层已实现**：`apps/agentcore/src/router/multi-route.ts`（315 行）导出 `selectMultiIntent` / `detectCoupledPairs` / `runParallelRoutes` / `selectDeterministicMultiRoute`，生产 import `router/orchestrator.ts:73`。
  - **排序铁律（判定先于 clarification）已落**：`orchestrator.ts:800` 注释原文"接同一份 `runParallelRoutes`…并行·确定性块装配·不反问。未命中 → null → 照走下方 τ 决策/澄清（byte-compat）"，即 §3.2.7 要求的插点。
  - **契约已落**：`packages/contracts/src/qos.ts:250-267` `MultiIntentPlanSchema{selectedIntents, parallelResults, coupledPairs, synthesisMode}`，:507 与 :647 两处挂进 trace（additive optional，与 §4 一致）。
  - **env 阈值已落**：`orchestrator.ts:1086-1087` `QOS_MULTI_INTENT_TAU_MID ?? 0.8` / `QOS_MULTI_INTENT_MAX_INTENTS ?? 4`（与 §4 默认值一致）。
  - **门**：`apps/datacore/src/features.ts:141` + `apps/agentcore/src/features/registry.ts:132` 双注册，均 `defaultOn: false`；`features.ts:171` 进 `QOS_DARK_LAUNCH_FEATURES`。
  - **⚠ 门态**：`qos.multi-intent-orchestration` **不在** `apps/datacore/src/seed.ts` 的 `DEMO_LIGHTUP`（:58-79）里 ⇒ demo 及任何生产租户上恒关。开它的只有测试（`apps/agentcore/test/qos-cross-domain-seam.test.ts:234` · `slot-harvest-floor.seam.test.ts:219`）。
  - **注意别误判**：`orchestrator.ts:286 return set.has("qos.multi-intent-orchestration")` 守的是 **⑤ LLM 多候选** 这一路。同一份 `runParallelRoutes` 后半另有 **② 确定性多域** 入口（`qos.deterministic-multi-domain`），**那一路 demo 是开的**（`seed.ts:68`）—— 见本文 `PRD-qos-cross-domain-unified` 条。两路不是一回事，混为一谈就会把本 PRD 误判成"已上线"。
- **结论**：**◐部分** —— 代码全实现且接线（`runParallelRoutes` 是 ②/⑤/L2/L3 四路共用后半，绝非死代码），但**本 PRD 自己那条 ⑤ 路的门在生产恒关**（"接了线没数据"形态：`l lmMultiIntentEnabled` 恒 false，分支从未进入）。§7 的 SEAM-1..5 只在测试实参下验过。
- **最小 WO 建议**：`WO-MULTI-INTENT-LIGHTUP`。🚦范围边界：`apps/datacore/src/seed.ts`（DEMO_LIGHTUP 加键）+ 一条 demo 租户 SEAM。**前置**：先按 §7.2 SEAM-2 亲手跑 Q1，确认耦合诚实标真出现（这是 PRD 自定的头号判据），再点亮；否则开门即等于把"假综合"放进 demo。

---

### PRD-nav-ia-reorg.md
- **它要做什么**：左侧导航从"业务/管理两堆 + admin 32 项扁平"改为**按业务域统一分组**，图谱并入建模组、补回 meta；并修字号倒挂（父 11px < 子 13px）。
- **PRD 自称的 AS-IS**：§2 表（L38-43）：`ShellLayout.tsx:28 BUSINESS_NAV_GROUPS` 已分 5 组 · `:185+ adminPages.map()` 扁平 32 项 · 图谱与本体分家 · 字号 section-title 10.5 < navGroupHeader 11 < navItem 13（**父<子倒挂**）· `meta` 未归任何组。
- **实测现状**：
  - **N1 已实现**：`apps/frontend-shell/src/pages/ShellLayout.tsx:35` `export const NAV_GROUPS`，view/admin 合一套域分组；:71 注释确认"空组隐藏；NAV_GROUPS 未覆盖的项落「其它」组不丢；复用 NavGroup 折叠记忆"。
  - **覆盖率 40/40（脚本对拍，非目测）**：NAV_GROUPS 的 admin 键集合 == `adminRegistry.ts` 的 `ADMIN_PAGES` 键集合，双向差集均为空。（ADMIN_PAGES 已从 PRD 记的 32 长到 **40**，仍全覆盖。）
  - **N2 已实现**：`ShellLayout.tsx:43-50`「建模与图谱」组含 `{kind:"view", key:"graph"}` + modeling/object-types/domains/slices/slice-library/merge/boundary/prototype-intake；图谱八视角另立 `collapsed: true` 的「图谱体系」子组（:52-56），与 §3.2"仍可作该组内二级…按既有 collapsed 折叠"一致。
  - **meta 已补回且分歧已定音**：`ShellLayout.tsx:62` 注释记录 adminRegistry(建模) 与 ShellLayout(平台与系统) 的分歧按「平台与系统」定案并同步改了 `adminRegistry.ADMIN_NAV_GROUPS`（防两处分组源漂移）；meta 落在 :65「平台与系统」组。
  - **N3 已实现**：`ShellLayout.module.css:113-114` `.navGroupHeader { font-size: 13px }`（注释原文"组头字号 ≥ 叶项（navItem 13px），消除父小于子的层级倒挂"）· `.navItem` 13px（:131）· `global.css:172-174` `.section-title` 10.5→**12px**。且 `ShellLayout.tsx` 已不再使用 `section-title`（§9 的默认裁决"取消"被采纳）。
  - **有结构守卫门**：`apps/frontend-shell/test/f61.admin-nav-groups.test.tsx:12-19` 断言每个 `ADMIN_PAGES` 都进某组、**不存在 `other` 兜底组**、组序与 `ADMIN_NAV_GROUPS` 一致；:37-40 渲染断言「数据接入」「建模与图谱」组真出现在 DOM。
- **结论**：**✅已实现**（N1/N2/N3 三期齐，且加了 PRD 未要求的防漂移门）。
- **备注**：§7 的"FDE 亲手跑各角色截图留证"属人工验收，本审计无法从代码判定 —— 记为**未查清（判据不在代码里）**，不影响 N1–N3 的实现判绿。

---

### PRD-ontoflow-data-builder.md（v1）
- **它要做什么**：仿 OntoFlow 做「数据选择→源表→数据处理→子图建模→本体库」可视化流水线画布，补 ProcessingSpec 聚合/失效/脱敏、Excel 解析、准备度评分。
- **PRD 自称的 AS-IS**：§0（L14）"后端『数据→本体』主干能力大半已有，但是批量 + 1:1 映射 + 表单驱动；缺 ①可视化画布编辑器 ②数据处理层（实体聚合/分组/事件溯源/失效/脱敏/行动绑定）③Excel 解析 ④准备度评分"；§0.1 有逐阶段「复用↔新增」速查表。
- **⚠ 重要前提**：本 PRD **已被 v2 取代** —— `docs/PRD-ontoflow-v2-unified-modeling.md:3` 原文"取代并扩展 `PRD-ontoflow-data-builder.md`(v1，仅数据先行)"。故 v1 的端点命名（`/a/v1/pipelines`）本就不该按字面对账。
- **实测现状**（按 v1 的四项缺口逐条）：
  - **③ Excel 解析 ✅**：`apps/datacore/src/connectors/parsers.ts:1-9` `import xlsx from "node-xlsx"` + `export function parseXlsx(buf)`，抬头注释标"G-6：xlsx 经 node-xlsx 解析"，且明说复用与 csv/json 相同的行数组出口。
  - **② 数据处理层 ✅（且已接生产线）**：`apps/datacore/src/pipeline/processing.ts:66 runProcessing(rows, spec)`；生产调用方两处 —— `apps/datacore/src/app.ts:478` 与 `pipeline/service.ts:115`（非仅 test）。契约 `packages/contracts/src/pipeline.ts:39 ProcessingSpecSchema` + `:17 WfAggFnSchema`（Last/First/Sum/Max/Min/Avg/Count，比 PRD 要的多一个 First）+ `:31 MaskRuleSchema`（脱敏）+ `:52 StateVarDefSchema`（状态变量）。
  - **④ 准备度评分 ❌ 没接线**：`apps/datacore/src/pipeline/` 下只有 `processing.ts` / `service.ts` / `subgraph.ts`，**无 `readiness.ts`**；`WorkflowService` 方法清单（service.ts:22/27/33/41/64/103/120/136）= list/get/create/update/validate/preview/promote/publish，**无 readiness**。（`app.ts:1570` 的 readiness 是**另一件事** —— 推演沙盘准备度认证 `SPEC-sandbox-readiness-certification.md`，别混。跨命名核对过。）
  - **① 可视化画布编辑器 ❌ 没接线**：见下条 v2。
  - `/a/v1/pipelines` 端点全仓 0 命中（已按 v2 更名为 `/a/v1/ontology-workflows`）。
- **结论**：**◐部分**（按 v1 的四缺口：②③ 已做，①④ 未做）。**不建议单独为 v1 派单** —— 它已被 v2 取代，缺口在 v2 条目下统一给 WO。

---

### PRD-ontoflow-v2-unified-modeling.md
- **它要做什么**：把「数据先行」与「图谱先行」统一成**一套数据模型 + 一张画布**（`OntologyWorkflow` + `EntityNode` 三配置 + 节点级 `storageMode` STATIC↔ONTOLOGY + `promote`），发布后 scaffold 生成应用功能。
- **PRD 自称的 AS-IS**：无独立"现状"节；§3「模块关联 —— 实现 agent 必须复用这些接缝」列了要复用的现有模块；§0 声明它取代 v1。
- **实测现状**：
  - **契约 100% 落地**：`packages/contracts/src/pipeline.ts` 全套 —— `WfStorageModeSchema:10`（STATIC/ONTOLOGY）· `WfEntryModeSchema:13`（DATA_FIRST/GRAPH_FIRST）· `ProcessingSpecSchema:39` · `StateVarDefSchema:52` · `FnDefSchema:61` · `EntityNodeSchema:100` · `LinkNodeSchema:109` · `OntologySinkNodeSchema:121` · `WfNodeSchema:127`（discriminatedUnion）· `OntologyWorkflowSchema:140`；`packages/contracts/src/index.ts:62 export * from "./pipeline.js"` ⇒ 跨包可见（合 §2 要求）。
  - **后端端点 6/9**：`apps/datacore/src/app.ts:2225` GET 列 · :2226 POST 建 · :2231 GET 取 · :2232 PUT 改 · :2236 validate · :2237 preview · :2241 `nodes/:nodeId/promote` · :2245 publish。
    **缺 3 个**：`POST …/:id/readiness`（0 命中）· `POST …/:id/scaffold`（0 命中，§8.1「生成应用功能」整段未落）· `POST /a/v1/connections/:id/upload`（0 命中）。
  - **服务层同构**：`apps/datacore/src/pipeline/service.ts` 的 `WorkflowService` 八个方法与上述端点一一对应；`subgraph.ts` 的 `buildTypeDefs/buildLinkDefs/buildSliceSpec` 被 `service.ts:7` 消费（§3 要求的"复用 modeling/ontology-core 不另起炉灶"这一半有落）。
  - **⚠ 前端画布 ❌ 完全没做（没接线）** —— 这是本 PRD 的核心目标（§1.1.1「一张可视化画布」、§7「前端新增」）：
    `rg -n "ontology-workflows|OntologyWorkflow|PipelineCanvas" apps/frontend-shell/src` = **0 命中**。跨命名再搜一轮（`OntoFlow` / `画布` / `canvas` / `工作流`）：命中的全是别的东西 —— `views/OntologyGraphView.tsx`（**只读**力导向图，v1 §0.1 自己标注过"只读"）、`ChainLineMapView`/`PhysicalTopologyView`（推演拓扑）、`pages/admin/ModelingPage.tsx`（A3 表单式建模）。`endpoints.ts:790-815` 的 `fetchWorkflows` 走的是 **`/b/v1/workflows`（AgentCore B2 工作流编排）**，与 `/a/v1/ontology-workflows` **同名不同物**，切勿混为一等。
    ⇒ 8 个后端端点的**唯一消费方是 `apps/datacore/test/workflow.test.ts`**（抬头 :3 自述"P1：OntoFlow 本体建模工作流 CRUD + 校验"）⇒ **只有 test 引用 = 已排练，不是已实现**。
- **结论**：**◐部分（后端半边在，前端半边零）**。这正是 CLAUDE.md SEAM-GATE 警告的形态：两半拆开做，只做了一半，且做完的那半没有任何生产消费方。
- **最小 WO 建议**（按投入产出排两张，**不要拆给两个 dev** —— 跨前后端两半须一 dev 整单，见 CLAUDE.md LOOP ③）：
  - `WO-ONTOFLOW-CANVAS`（大，核心）。🚦范围边界：`apps/frontend-shell/src/pages/admin/`（新 OntoFlow 画布页）+ `src/api/endpoints.ts`（8 个 `/a/v1/ontology-workflows` 调用）+ `src/pages/adminRegistry.ts` + `ShellLayout.tsx NAV_GROUPS`（新页入组，否则 f61 门红）+ `src/mocks/handlers.ts`。**SEAM 判据**：`VITE_MOCK=0` 真后端，画布建一条 GRAPH_FIRST 工作流 → PUT → validate → preview → promote → publish → `GET /a/v1/ontology/types` 见新类型。
  - `WO-ONTOFLOW-READINESS-SCAFFOLD`（中，可后置）。🚦范围边界：`apps/datacore/src/pipeline/readiness.ts`（新）+ `pipeline/service.ts` 加 `readiness`/`scaffold` 方法 + `app.ts` 两个路由。注意 `scaffold` 须复用既有 `databuilder/scaffold-manifest.ts`，别造第二套。

---

### PRD-ontology-7elements.md
- **它要做什么**：**这本身是一份审计 PRD**（L2 原文"本单是 PRD，不改实现。产出只有这一份 markdown。落地另单"）—— 对本体七要素的四个缺口（①Interface ②Security 列级 ③Action 回写声明 ④Function 本体签名）做取证复核 + 价值排序 + 最小落地建议。
- **PRD 自称的 AS-IS**：§0.1 四项状态表（基准 commit `c0b7ee0d`）+ §0.2 诚实排序：`P0 ④-a` / `P1 ④-b` / `P1 ③` / `P2 ②-a` / 押后 `②-b ①-a ①-b` / 独立 `①-c`。
- **实测现状（在今天的 HEAD 上逐条复验，**四条 AS-IS 全部原样成立**）**：
  - **④-a `outputShape` 接缝丢弃 —— 仍在丢**：A 侧确实返回了（`apps/datacore/src/app.ts:2700` `return { solvers: items.map((it) => ({ ...it, outputShape: SOLVER_OUTPUT_SHAPES[it.key] ?? [] })) }`，权威表 `solvers/service.ts:258`）；B 侧 `apps/agentcore/src/tools/datacore-http.ts:373-383` 的 map **仍逐字段列举 7 个（key/name/description/argHints/domain/answersQuestions/tags），无 `outputShape`**，返回类型（:363）亦无。`dril/resource-projector.ts:52 projectSolvers` 不填 `outputSpec`。终点 `dril/resource-router.ts:79-82` 读 `outputSpec?.shape` ⇒ 恒 undefined ⇒ 恒返 `{ key: k }`。**PRD 指出的"反讽"仍在原地**：同一个 map 的 :371 注释写着"勿在接缝丢弃"。
  - **④-b `reads` —— 仍无权威数据**：A 侧 `catalog.ts`/`solvers/service.ts` 无 `reads`/`inputSpec.objectTypes`（0 命中）；B 侧手抄镜像 `apps/agentcore/src/agent/navigation-slice.ts` 的 `reads:` 实测 **20 条**（PRD 记 19 → 两日后 +1，正印证 PRD 说的"无门守其增长"）；`SOLVER_KEYS` 实测 59 ⇒ 覆盖率 20/59 = 34%。
  - **③ Action 回写声明 —— 读出口仍零生产调用方**：`apps/datacore/src/actions.ts:454 describeImpact` 的调用方在 `apps/datacore/src` 内**只有它自己**（:456 调 `describeActionImpact`），无端点；`app.ts:3138/3139` 只有 `GET/POST /a/v1/action-types`，**无 `/impact`**。POST 的 body zod（`app.ts:3143-3149`）仍只收 `{key,name,paramsSchema,checkRules,approvalChain}`，**仍不含 `effects`**。数据面 `BUILTIN_ACTION_EFFECTS` 实测**仍只有 1 个键 `plan_change`**，而 `ACTION_WIRING` = **9 WIRED + 1 NOT_IMPLEMENTED** ⇒ 9 个真写真值的动作里 8 个无声明。门面 `scripts/check-action-wiring.mjs` 的 `effects` 命中数 **仍为 0**。
  - **②-a 求解器路径行级洞 —— 签名未改**：`apps/datacore/src/solvers/service.ts:4007-4011` `async loadContext(tenantId: string, visibleOrders?: ObjectInstance[], opts?: {...})` —— **仍只收 tenantId，不收 AuthCtx**；:4018-4019 `loadCore` 仍直连 `this.repos.objects.listByType(tenantId, t)`。调用点 **17 处**（planviews ×4 · calibration ×3 · sop ×3 · simclock ×1 · solvers/service 自身 ×5 含 :4237 · :4312），**只有 `:4312` 一处传 `visibleOrders`**。与 PRD §3.3 的清单逐处对得上（行号有位移，结构不变）。
- **结论**：**✅已实现（作为文档交付物）** + **⚠ 四项后续建议全部未落地**。PRD 本身准确可信 —— 它是本批 22 份里唯一一份我逐条复验后**AS-IS 零偏差**的文档，含它自我更正的那 6 处（§10）。缺的是执行：`P0/P1/P1/P2` 四档**至今零动工**。
- **最小 WO 建议**（直接抄 PRD §8「🚦落地单的范围边界」，此处只给排序理由）：
  1. `WO-SOLVER-OUTPUT-SHAPE`（**P0，最高投产比**）。🚦范围边界：`apps/agentcore/src/tools/clients.ts` + `tools/datacore-http.ts` + `dril/resource-projector.ts` 三文件。**3 处小改、2 个 demo 上在跑的活消费方**（`orchestrator.ts:332` agent 首轮 prompt · `server.ts:871` 治理台关系图），且门 `qos.dril-routing` 在 demo 是**开的**（`seed.ts:65`）⇒ 今天就在退化。建议与 ④-b 同一 dev 整单（PRD §6 明说拆开必然只接一半）。
  2. `WO-ACTION-IMPACT-READOUT`（P1）。🚦范围边界：`apps/datacore/src/app.ts`（加 `GET /a/v1/action-types/:key/impact` + POST body 补 `effects`）+ `scripts/check-action-wiring.mjs`（加 effects 断言）。**先接出口再补 8 条声明**（PRD §4.4 的理由我复核后同意：先补声明只会把死代码从 1 条扩到 9 条）。
  3. `WO-SOLVER-ROWLEVEL`（P2）。🚦范围边界：`apps/datacore/src/solvers/service.ts` + 17 处调用方 + `ontology.ts` 正门。这是**补齐一个已声明的不变量（R2/A6）**，不是新造能力。
  4. `②-b 列级 / ①-a 七字段 / ①-b Interface` —— **复核后同意押后**：今天零消费方，做了就是死契约（正是 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 形态）。

---
