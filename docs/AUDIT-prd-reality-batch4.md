# AUDIT · PRD 实现状态对账 · 第 4/5 批（22 份）

> ## ⚠️ 过期横幅（收编时补 · 2026-08-13 · WO-RECLAIM-DOCS）
>
> | 项 | 值 |
> |---|---|
> | 原基线 sha | `8e3e91a677c6c860daeff4d0826af263e5852972`（分支 `wave4`，2026-08-07） |
> | 距 canonical | **581 个提交**（canonical `9730a99f` @ 2026-08-13） |
> | 收编来源分支 | `claude/handoff-prd-audit-b4`（`dd3e87f9a5`）——**注意：不是 b1/b2** |
> | 本次复验范围 | **只抽查 3 条，其余一条都未复验** |
>
> ### ⚠️ 收编时订正了一条反向结论（这条比本文内容更要紧）
>
> `docs/AUDIT-branch-reconcile-2026-08-11.md` §4.2 写：
> 「`handoff-prd-audit-b4` ⊂ `b1`/`b2` —— b4 只缺 `AUDIT-prd-reality-batch4.md`，b1/b2 都带 ⇒ **b4 可删**」。
> **方向反了。** 2026-08-13 blob 级实测：
>
> ```
> b1:docs/AUDIT-prd-reality-batch4.md = 356aaf531a   96 行   （抢救落盘的中间态）
> b2:docs/AUDIT-prd-reality-batch4.md = 356aaf531a   96 行   （与 b1 全等）
> b4:docs/AUDIT-prd-reality-batch4.md = d8184661a1  444 行   （「全 22 份完」的完成版）
> comm -23 <(sort -u b2版) <(sort -u b4版) = 0 行   ⇒ 96 行版是 444 行版的真子集
> ```
>
> ⇒ 照审计「捞 b2、删 b4」会**丢 348 行**（22 份 PRD 里的 16 份判定全在被丢的那段）。
> 故本文取自 **b4**。形态（照铁律 0.6 句式）：「审计用『两条分支缺同一个文件名』当作『内容互为子集』的证据，
> 而**文件名相同不度量内容相同**。」
>
> **⛔ 本文全部 `file:line` 锚点对 `8e3e91a6` 有效，对今天的 canonical 不保证有效。**
>
> | # | 原文断言 | 2026-08-13 实测 | 判定 |
> |---|---|---|---|
> | B4-1 | `server.ts:455` `GET /api/v1/queries/:taskId/trace` 是**孤儿端点**，前端零消费方，只有 `trace-endpoint.test.ts` 咬它 | 端点仍在（行号漂到 **`:463`**）；全前端 `src` 里 `/queries/*/trace` **仍 0 个消费方**，唯一咬它的仍是同一个 test | 🔴 仍在·缺口未修 |
> | B4-2 | `InferenceProcessDag.tsx:18-29` `NODES` 是字面量数组；`:30-37` 含跨周期反馈边 `{from:10,to:2,t:"fb"}` | `NODES` 仍在 `:18` 且仍是字面量；fb 边仍在（行号漂到 `:36`） | 🔴 仍在·缺口未修 |
> | B4-3 | `GET /a/v1/lineage/object/:type/:id` 真在（`app.ts:2496`），但 P2 只半实现 | 端点仍在（行号漂到 **`app.ts:2879`**）；**前端已接上**：`apps/frontend-shell/src/api/endpoints.ts:534` 有真消费方 + `mocks/handlers.ts:1636` 有 mock | ◐ 端点在·**消费方半已补**（原文「零消费方」那半已不成立） |
>
> ⚠️ **B4-1 复验时我自己差点报错，照铁律 0.6 记账**：初查 `grep -cn 'trace' endpoints.ts` 得 **7**，
> 差点报「前端已接」。追一层逐条看命中原文：7 条是 1 条注释 + sim tick 的 `trace?` 字段 + `decision-trace`（**另一个端点**）
> + `promoteFallback(traceId)` —— **没有一条是 `/queries/*/trace`**。
> 形态：「我用『含字串 trace 的命中数』当作『该端点有消费方』的证据，而前者并不度量后者。」
> 金丝雀：同一条命令查 `decision-trace` 命中 3 处（工具正常，不是搜不到）。
>
> **未重测的部分**：本文 22 份 PRD 的其余全部判定与 WO 建议，本次一条都没有重跑。


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

### PRD-ontology-browser-field-coverage.md
- **它要做什么**：① A3 `suggest()` 从 LLM-only 升级为确定性映射管线优先；② **字段全建模 HARD 门**（每个导入 column 必须 MAPPED 或 WAIVED，否则拦发布）；③ 本体浏览器（域分组图谱 + 节点检视器）；④ CSV 导入模板下载。
- **PRD 自称的 AS-IS**：§2 表（L44-48）：C-1 `suggest()` 直接 `llm.parseStructured`（`modeling.ts:64,78-83`）LLM-only · C-2 闭包"反向-data"为 SOFT，**无字段建模覆盖维** · C-3 无"按域分组图谱 + 节点检视器"前端 · C-4 无 CSV 导入模板出口 · C-5 `refs.ts` 出向引用图未在检视器呈现。
- **实测现状**（⚠ 这份必须跨命名搜 —— 按 PRD 的字面名 `deterministicSuggest` / `本体浏览器` / `/a/v1/ontology/browser` 搜，**三个全是 0 命中**，会得出"整份没做"的错误结论）：
  - **P1 ✅ 但设计有偏差**：确定性管线落地为**独立方法 `derive()`** —— `apps/datacore/src/modeling.ts:171` `async derive(ctx, rawDatasetIds)`，:168-170 注释"确定性建模（无 LLM）：确定性映射管线直接产出草稿，构造上字段全建模 100% 覆盖…与 suggest（LLM 语义增强）互补"；管线本体在 `modeling.ts:77`。端点 `POST /a/v1/modeling/derive`（`app.ts:3377`），前端已接（`api/endpoints.ts:484 deriveModeling` ← `pages/admin/ModelingPage.tsx:161`）。
    **偏差**：PRD §3.1 要的是"`suggest()` 改为先确定性再 LLM 兜底"；实际是**并列两条路**——`suggest()`（`modeling.ts:201`）仍在 :210 直调 `llm.parseStructured(purpose:"modeling")`，未改造。功能上不缺（用户可选 derive），但"无 LLM 时 suggest 不可用"这条 C-1 缺口对 `suggest` 路径依然成立。
  - **P2 ◐ 门在但 fail-open（接了线接错地方）**：覆盖计算 ✅（`modeling.ts:123 computeFieldCoverage` + `:190 coverage()` + 端点 `app.ts:3383 GET /a/v1/modeling/drafts/:id/coverage`；契约 `packages/contracts/src/datacore.ts:346 FieldCoverageReportSchema`）。
    **但 HARD 门不 HARD**：`app.ts:3420-3421` 原文"requireFullCoverage（R12 字段全建模门）：未建模字段阻断发布（**默认关，保持向后兼容**）"，取值来自**请求体** `req.body.requireFullCoverage === true`；`modeling.ts:377 if (opts?.requireFullCoverage)` 才校验。
    追一层消费方：前端建模页**默认勾选**（`pages/admin/ModelingPage.tsx:217 useState(true)` → :246 `publishModelingDraft(draft.id, requireFullCoverage)`）⇒ **走 UI 发布时门是生效的**；但 `api/endpoints.ts:500 publishModelingDraft = (id, requireFullCoverage = false)` 的**默认参数是 false**，且任何直接 REST 调用（脚本/服务间/其他前端路径）不传即放行 ⇒ **门挂在请求体上而非不变量上，绕过零成本**。这与 PRD §3.2"存在 UNMAPPED → 拦发布"的 HARD 语义不符。
  - **`field_coverage.evaluated` 事件 ❌**：`rg -n "field_coverage" apps packages` = **0 命中**，§4 承诺的事件从未登记。
  - **`coverage:check` CI 门 ❌**：`scripts/` 下只有 `check-ontology-slice-coverage.mjs`（**另一件事** —— 切片覆盖，非字段建模覆盖；`apps/datacore/src/databuilder/slice-coverage.ts:20` 另有一个**同名不同物**的 `FieldCoverageReport` interface，与 contracts 那个不是一回事，勿混）。`package.json:19` 只注册了 `ontology-slice-coverage:check`。
  - **P3 CSV 模板 ✅**：`app.ts:2011` 返回 `content-disposition: attachment; filename="<typeKey>.template.csv"`（另 :2047/:2056 两处自定义列变体）。
  - **P4 本体浏览器 ✅（换了名字）**：不是新页，而是 `apps/frontend-shell/src/views/OntologyGraphView.tsx` —— `:247` 挂 `<Inspector>`，`:500 function Inspector`；检视器内含 **覆盖徽章**（`:468 fieldCoverage()` + `:525 data-testid="graph-coverage-badge"`，未满 amber）· 字段 schema（`:539 inspectorProps`）· 数据源（`:565 inspectorSources`）· 规则（`:578 inspectorRules`）。PRD §3.3 要的检视器信息架构基本齐。
- **结论**：**◐部分**。P1/P3/P4 ✅（P1 设计有偏差但功能在）；**P2 是真缺口** —— 门存在但 opt-in + fail-open，且配套的事件与 CI 门零实现 ⇒ PRD 反复强调的"R12 从 SOFT 升 HARD"**没有真正达成**。
- **最小 WO 建议**：`WO-FIELD-COVERAGE-HARD`。🚦范围边界：`apps/datacore/src/modeling.ts`（把 `requireFullCoverage` 从 opt-in 改为默认 true + 显式 `waive` 通道）· `apps/datacore/src/app.ts:3418-3421`（默认值翻转）· `apps/frontend-shell/src/api/endpoints.ts:500`（默认参数翻转）· 新 `scripts/check-field-coverage.mjs` + `package.json` 注册。**SEAM 判据**：构造一份含未映射列的草稿，**不传任何 body** 直接 POST publish → 必须 400 拦下（今天会 200 放行）。⚠ 这是**行为破坏性变更**，需先跑一遍看有多少既有租户草稿会被拦。

---

### PRD-optimize-whatif-conversational-wiring.md
- **它要做什么**：把结构化的优化 what-if 问句（"如果 f1 开设成本涨到 150，最优选址怎么变"）确定性路由到路径A直调既有 `optimize_whatif`（CP-SAT 重解），并让路径B agent 的导航图看得见它。**不新造求解器**，只做"对话 → 既有 solver"的路由 + 装配层，闭断点 `G-WHATIF-NL-UNREACHABLE`。
- **PRD 自称的 AS-IS**：§2.1 目标即隐含现状（G1 路由不可达 / G2 agent 看不见 / G3 无本体→基线装配器）；§2.2 明确非目标含"不改 `opt.whatif` 的 entitlement 语义（保持 defaultOn:false）"。
- **实测现状**：
  - **G1 路由 ✅ 已实现并接线**：`apps/agentcore/src/router/opt-whatif-route.ts`；orchestrator 挂点 `router/orchestrator.ts:692 if (optWhatifRouteEnabled(enabledFeatures))` → `:695 runOptWhatifRoute(...)`，实现体 `:1027`。`:686` 注释确认插点顺序（排在 L3 耦合检测之后）。
  - **G2 agent 可见 ✅**：`apps/agentcore/src/agent/navigation-slice.ts:146 optimize_whatif` 条目（含能力句 + `:144` 注释"outputShape 逐项镜像 DataCore `SOLVER_OUTPUT_SHAPES.optimize_whatif`"）；信号函数 `isOptWhatifSignal` 由 `navigation-slice.ts:3` 从 `router/opt-whatif-route.ts` 单源引入（无环）。
  - **G3 装配器 ✅**：`apps/datacore/src/solvers/opt-binding.ts`（299 行）—— `:52 groundBinding` / `:106 bindToSolverArgs`，即 PRD §2.1-G3 点名要复用的 DF.8 接地；`opt-whatif.ts`（205 行）。
  - **G4 接缝测 ✅ 存在**：`apps/agentcore/test/optimize-whatif-conversational-seam.test.ts` + `apps/datacore/test/opt-whatif.test.ts`（后者按 `apps/agentcore/src/mocks/clients.ts:598` 注释是"真本体绑定 × 真 CP-SAT 的数据装配×引擎接缝"）。
  - **⚠ 门态（本条必须追到 L2 模板层才对，只看 `defaultOn` 会判反）**：
    - `qos.opt-whatif-route`：`features.ts:145` defaultOn:false，**且 `features.ts:172` 在 `QOS_DARK_LAUNCH_FEATURES` 内**；`features.ts:283 templateFeatures` 对 battery 租户返回 `ALL_FEATURE_KEYS.filter(k => !QOS_DARK.has(k) && !PERF_DARK.has(k))` ⇒ **行业模板 all-on 也不会开它**；`seed.ts` DEMO_LIGHTUP 亦无此键 ⇒ **demo 上恒关**。
    - 底层 `opt.whatif`（`features.ts:92`）defaultOn:false，但 **不在** 两个 dark 集合里，而 `features.ts:158` 注释原文"产品分档特性（sim.* / opt.* 等）不在此列，**照常随模板开**" ⇒ **底层求解器在 demo 上其实是开的**。
    ⇒ 精确结论：**求解器可用，会话入口关着**。`G-WHATIF-NL-UNREACHABLE` 在代码层已具备闭合条件，但在 **demo 运行态上仍未闭合**。
- **结论**：**◐部分** —— G1–G4 四项代码全落地且在生产调用路径上（非死代码），缺的只是**点亮**。属"接了线没数据"（门恒关 → 分支从不进入），不是"没接线"。
- **最小 WO 建议**：`WO-OPTWHATIF-LIGHTUP`（极轻）。🚦范围边界：只改 `apps/datacore/src/seed.ts` DEMO_LIGHTUP 加 `"qos.opt-whatif-route": true` + 一条 demo 租户端到端断言。**前置**：先亲手跑 §2.1-G4 的 SEAM（断言非空 Δ目标 + 决策真切换），确认关门/开门两态都对再点亮。

---

### PRD-order-project-sim-1to1.md
- **它要做什么**：订单全链推演（order）1:1 复刻 —— 订单选择器 + 6 KPI + 统一结论（可接/提价接/不接）+ **11 节点业务建模链 DAG** + 三判明细表（交期/齐套/财务三闸 C15→C13→C18）+ 采纳→Action；型号面（model）已近 1:1，只补收敛标注。
- **PRD 自称的 AS-IS**：抬头一句话原文"**型号产能推演系统已 ~70% 到位**（`ProjectSimView` 1049 行，`capacity_forecast` 活算）；**订单全链推演是最大缺口**（`OrderChainView` 318 行，现为『问题归并 4 类』，缺订单选择器/6 KPI/统一结论/11 节点 DAG/三判明细表/C18 现金闸/采纳→Action）"。
- **实测现状**：
  - **`order_fullchain` 求解器 ✅ 已落地**：注册在 `apps/datacore/src/solvers/service.ts:88`（SOLVER_KEYS）· 目录描述 `catalog.ts:82`（"逐单三关联判（交期/齐套/财务三闸 C15→C13→C18）+ 统一结论 + 业务建模链 DAG"）· 输出形状 `service.ts:327` `["so","verdict","vc","kpis","judges","conds","dag","summary"]` · 实现体 `service.ts:3219+`。
  - **三判 ✅ 逐条对得上 PRD §1.3**：①交期判 `service.ts:3250` `deliveryJudge{p50,p90,verdict:"可达"|"紧张", ruleRefs:["C02","C03"]}` · ②齐套判 `:3257` `kitJudge{material,gapTon,eta,verdict:"齐套"|"缺料", ruleRefs:["C06","C16"]}` · ③财务判三闸 `:3264` `financeJudge{marginPct,floorPct,creditUsedRatio, ruleRefs:["C15","C13","C18"]}`。
  - **统一结论三色 ✅ 值与 PRD 完全一致**：`service.ts:3270-3272` `"不建议接"→#DD7E9E` / `` `提价${priceUpPct}%接`→#E8B54A `` / `"可接"→#62BE77`（PRD §1.2 要求的三个色值原样）。
  - **⚠ DAG 是 9 节点，PRD 要 11 节点**：`service.ts:3278-3290` 的 `nodes` 实测 **9 个** `N(...)` 调用（so + net/bom/eco/cred 四并 + jcap/jkit/jfin 三判 + vrd），边 9 条（`:3291-3293`）。PRD §1.4 反复称"11 节点"，但它自己列出的节点清单恰好也是 `so → {net·bom·eco·cred} → {jcap·jkit·jfin} → vrd` = **9 个**。⇒ **PRD 内部自相矛盾**（标题数与清单数不符），实现照清单做是对的。此处判为**PRD 文字瑕疵，非实现缺口**，但值得回写订正。
  - **C18 现金闸 ◐ 诚实降级**：`service.ts:3264` 注释原文"③ 财务判三闸：毛利率 vs 底线（C15）→ 信用占用（C13）→ 现金（**C18，订单无现金数据→按信用代理**）" ⇒ C18 挂了 ruleRef 但**没有真现金数据**，用信用占用代理。这是"接了线没数据"，且代码**诚实标注**了（未伪装）。真 C18 在别处有实算（`planviews.ts:61 rules.evaluate(ctx, ["C18","C23"])`）。
  - **前端 ✅**：`apps/frontend-shell/src/views/plan/OrderChainView.tsx` 已从 PRD 记的 318 行长到 **505 行**；`:159` 注释"ORD：订单全链推演（订单中心，order_fullchain 三判 + 统一结论 + 11 节点 DAG）。问题归并作超集保留在下方" · `:406` ORD 面板（订单选择器 → 6 KPI + 统一结论三色 + 三判明细）· `:470` DAG 渲染。旧的 4 类问题归并按 roadmap §0"系统超集保留"处置。
- **结论**：**✅已实现**（订单面主缺口已补齐）。两点小账：① DAG 节点数 9 vs PRD 标题的 11（PRD 自身笔误）；② C18 用信用代理、无真现金数据（代码已诚实标注）。
- **最小 WO 建议**（都很轻，可合一张）：`WO-ORDER-C18-CASH`。🚦范围边界：`apps/datacore/src/synthetic/battery.ts`（种现金/应收数据）+ `apps/datacore/src/solvers/service.ts:3264`（C18 改真算）+ 订正 `docs/PRD-order-project-sim-1to1.md` 的"11 节点"为 9 节点。

---

### PRD-plan-audit-1to1.md
- **它要做什么**：规划体检（audit）的**时序推演交互 1:1** —— 逐日圆点轴（d=1..90）+ 日期刻度 + 悬停日点详情 + 三档图例 + **每问题独立时序（9 种 kind）** + 顶部摘要（cur→peak·T+cross）+ 财务 KSF 图 + 问题级传播链。
- **PRD 自称的 AS-IS**：§2 表（L38-49）逐条 ❌/◐，并有一句关键自评（L49）："**逐日 dot 轴所需全部数值后端已具备**（`risk_timeline` series/events/crossDay/affectedOrders）—— 主缺口在**前端不消费 + plan_audit 无 kind 路由 + 无 KSF**"。
- **实测现状**：
  - **逐日圆点轴 ✅ 独立组件**：`apps/frontend-shell/src/components/DailyDotAxis.tsx`（106 行），`:7` 抬头逐项对上 PRD 的要求 —— "每日一圆点（三档色）+ 日期刻度（D+n）+ 三档图例 + 顶部摘要 + 悬停/点选日点详情"。实测：`:67` 日期刻度行 · `:72` `data-testid="…-legend"` 三档图例 · `:82` `data-testid="…-daytip"` 日点详情 · `:52` `T+{crossDay} 越线` 顶部摘要 · `:24-25` 消费 `crossDay`/`peak`。
  - **每问题独立 kind 路由 ✅ 后端 + 前端两半都在**：新求解器 `audit_timeline`（`apps/datacore/src/solvers/service.ts:94` SOLVER_KEYS · `:330` 输出形状 `["kind","series","stages","peak","crossDay","threshold","events","affectedOrders"]` · `:4199` invoke 分支）；契约 `packages/contracts/src/solvers.ts:345`（"每审计项按 kind 出 90 天逐日 series"）+ `:385 AuditKindSchema`（9 种）+ `:396 kind` 挂进 AuditItem（optional，向后兼容）。前端 `views/sim/PlanAuditView.tsx:322-326` **按 kind 分别 `runSolver("audit_timeline", { kind })`**（queryKey 含 kind），正是 PRD §2 行 5 要的"非共用一条曲线"。
  - **财务 KSF 图 ✅**：`apps/frontend-shell/src/components/KsfGraph.tsx`，`:9-11` 抬头"3 层有向图——待解决问题（越线 Metric）→ 关键成功要素 → 财务指标…+ 展开该问题的 audit_timeline 逐日圆点轴（联动）"；`:89` 问题时序联动复用 `DailyDotAxis`。挂载：`PlanAuditView.tsx:177 <KsfGraph />`。
  - **4 节点 stepper 保留为超集**：`PlanAuditView.tsx:330` 注释"4 节点传导链 stepper + 受影响订单弹窗：复用 risk_timeline（全局唯一 PropagationTimeline 实现）" ⇒ 旧的 `PropagationTimeline.tsx`（189 行，仍是 stepper）**没被删，改为并列**，符合 roadmap §0"系统超集保留"。
- **结论**：**✅已实现**（PRD §2 表里标 ❌ 的 6 项 —— 逐日轴/日期刻度/悬停详情/三档图例/每问题独立时序/KSF 图 —— 全部落地，且 PRD 判断的"后端数值已具备、缺前端消费"这一诊断被证明是准的）。
- **备注**：`docs` 未见"问题级 chain（因素→对象→指标/规则）"的独立实现锚点，PRD §2 行 8 原本就只标 ◐（后端有逐单 4 层根因链）—— 记为**未查清**（该行 PRD 未给明确 DoD，无法判定"够不够"）。

---

### PRD-plan-generate-1to1.md
- **它要做什么**：规划建议/方案生成（generate）1:1 —— 五目标面板 + 5 路径→3 方案 + **五维取舍矩阵与雷达图** + 外部信号敏感性 + 复用 audit 的逐日时序与 KSF 图 + **采纳本方案 → 下发年度情景规划台细化**。
- **PRD 自称的 AS-IS**：§2 表（L36-45）：五目标面板 ✅ · 5 路径→3 方案 ✅ · 雷达/五维矩阵 ◐"需核对" · 外部信号敏感性 ◐/❌ · 逐日时序 ❌（同 audit）· KSF 图 ❌（复用 audit）· 问题传播链 ◐ · **采纳→下发 AOP ◐/❌** · gen 预设 QA ◐。
- **实测现状**：
  - **雷达图 ✅**：`apps/frontend-shell/src/views/sim/RadarChart.tsx`，挂载 `views/sim/PlanGenerateView.tsx:13`（import）+ `:322 <RadarChart scores={s.scores} color={color} size={180} testId={`radar-${s.no}`} />`。
  - **外部信号敏感性 ✅**：`PlanGenerateView.tsx:348` 注释"PRD-IND §2.3-6：外部信号敏感性（`s.extSensitivity` 5×3）"，数据来自方案对象而非前端写死。
  - **KSF 图 ✅ 复用**：`PlanGenerateView.tsx:15` import + `:411-412 <KsfGraph testId="gen-ksf-graph" />`，注释明写"audit/generate 共用同一组件"（符合 §3.1"零重复造"）。
  - **⚠ 采纳→Action：接了线，但接到一个「已知不写真值」的动作类型上** —— 这是本条最重要的发现：
    `PlanGenerateView.tsx:116 adoptScheme()` → `:121 actionTypeKey: "采纳经营方案"`，payload 带方案快照 + 目标面板值（:122-130）。
    追一层到 A 侧：`apps/datacore/src/actions.ts:59` `采纳经营方案: "NOT_IMPLEMENTED"`，且 :50-58 的注释**逐字承认这是欠账**：「尚未接执行器：审批通过后**不写任何真值**（**欠账**，非『设计上无副作用』）…载荷里带着方案与目标，却**一个字节都不落**，正是欠账形态」。`decision/kernel.ts:142` 亦复述"`采纳经营方案` 同样 NOT_IMPLEMENTED"。
    ⇒ 用户点"采纳本方案"→ 生成草稿 → 审批链走完 → **真值零变更**。这正是 `G-ACTION-NOOP-EXEC`（绿状态 ≠ 生效）的活体，且它**同时是本文 `PRD-ontology-7elements` 条里那 1 个 `NOT_IMPLEMENTED`**（`ACTION_WIRING` = 9 WIRED + 1 NOT_IMPLEMENTED，那个 1 就是它）。两份 PRD 在此处交汇。
    另注：PRD §2 要的是"采纳 → **下发年度情景规划台(AOP)细化**"这条 cross-link，实测 `PlanGenerateView.tsx` 内无跳 AOP 的路由动作 ⇒ 该半也未落。
  - 按钮受门控：`PlanGenerateView.tsx:80 useFeature("act.adopt-to-draft")`（关则不显示，未裸奔）。
- **结论**：**◐部分**。渲染层（雷达/五维/敏感性/KSF/时序复用）✅ 全落地；**采纳链是真缺口** —— 前端按钮 + 草稿 + 审批链齐备，末端执行器为空（"接了线接错地方"：接到一个已声明未实现的 ActionType），且 cross-link 到 AOP 未做。
- **最小 WO 建议**：`WO-ADOPT-SCHEME-EXECUTOR`。🚦范围边界：`apps/datacore/src/actions.ts`（`采纳经营方案` 从 NOT_IMPLEMENTED 接执行器）+ `apps/datacore/src/mapping.ts` 或 `decision/kernel.ts`（派发写回）+ `apps/frontend-shell/src/views/sim/PlanGenerateView.tsx`（采纳后跳 AOP）。**⚠ 硬约束（已定·勿改）**：`actions.ts:57` 记录了业务裁定"采纳一个方案**不得覆盖全局经营目标基线**（PLAN_GOAL_TARGETS）——『目标不能改』"，写回范围必须绕开目标基线。**SEAM 判据**：采纳 → 审批 → 断言**真值确有字节变更**（今天为零），且 `PLAN_GOAL_TARGETS` 未被改动。

---

### PRD-platform-foundry-aip.md
- **它要做什么**：**平台总纲** —— 定义两系统边界、A0–A8 / B1–B7 全部模块契约、§12 的 20 条端到端验收用例。
- **PRD 自称的 AS-IS**：无现状节（它是从零起草的规格，非增量）。§0.5 定"完成标准 = §12 验收用例全部通过 + docker compose 一键起 + lint/test 通过"。
- **实测现状**（按 §12 的 20 条逐条找生产锚点；**只做"实现存在性"抽查，不等于跑通验收**）：
  - 全部关键错误码/状态量在生产 src 中均有实现（`rg` 计数为**命中文件数**，已排除 test）：`DATACORE_UNAVAILABLE`(5) · `sourceQuote`(9) · `AGENT_SCOPE_VIOLATION`(4) · `NESTING_DEPTH_EXCEEDED`(2) · `WORKFLOW_ONLY`(6) · `load_skill`(11) · `MAP_TO_EXISTING`(5)。
  - **RD2 防幻觉门实装**：`apps/datacore/src/ruledocs.ts:219` `if (!segment.text.includes(cand.sourceQuote) || cand.sourceQuote.trim() === "")` → 丢弃候选（:18/:90 注释说明服务端子串校验），正是 §12-RD2 要的行为。
  - **SY3 新行业模板**：`apps/datacore/src/synthetic/service.ts:136/150` 按 `industryKey` 查模板、缺则 `industryTemplates.put` 落库。
  - 对应测试文件齐：`datacore/test/{ruledocs,synthetic,modeling,authz,connectors,modeling-wire}.test.ts` · `agentcore/test/{runtime-workflow,workflow-mcp,skill-*}.test.ts`。
  - 架构落位与 CLAUDE.md 架构地图一致（datacore 236 个测试文件 / agentcore 150 个）。
- **结论**：**✅已实现（模块层面）**，但**§12 的 20 条验收我无法逐条判定通过与否** —— 判据是"跑起来的行为"（compose 起服务、停掉一侧、注入 Mock LLM），不在静态代码里。
- **诚实标注（未查清 + 卡在哪）**：§12 的 P1/AU2/B3/B5/D1/D2 六条属**运行时行为断言**，需真起两服务 + 注入 Mock 才能验；本次为只读代码审计，**未跑**。要判绿必须 FDE 亲手跑一遍（CLAUDE.md「绿测试≠能用」）。本条不给 WO —— 先跑再说，跑出红点再立单。

---

### PRD-prototype-intake-databuilder.md
- **它要做什么**：把"上传 HTML 原型 → 抽数据表/关系 → 喂数据构建发动机 → 字段不符弹人确认"做成可重复正门。两块绿地：`prototype-intake`（解析）+ `schema-reconcile`（对账 HITL，类比 `MergeCandidate`）。
- **PRD 自称的 AS-IS**：§2 有"现状与缺口（file:line / 证据）"节；核心主张是"其余复用既有数据构建发动机（comprehend→BuildPlan→closure→publish R4 + GapReport），只补两块绿地"。
- **实测现状**：
  - **① intake 解析器 ✅**：`apps/datacore/src/databuilder/prototype-intake.ts`（153 行）；端点三个 —— `app.ts:3840 POST /a/v1/databuilder/intake` · `:3859 /intake/import` · `:3872 /intake/objectify`。
  - **② schema-reconcile HITL ✅ 全链**：候选落库 `app.ts:3851 repos.reconcileCandidates.put` · 队列 `:3883 GET /a/v1/databuilder/reconcile-candidates` · 人确认 `:3890 POST …/:id/resolve`；**双仓储都改了**（`repo/memory.ts:472` + `repo/pg.ts:773 PgStore(pool,"reconcile_candidates")`），符合 CLAUDE.md「新增表四处同改」。
  - **事件 ✅ 两条都登记进单一来源**：`app.ts:3854 outbox.emit(…, "prototype.intake_recorded", …)` → `apps/agentcore/src/event-subscriptions.ts:91`（IN_SESSION，invalidates intake-preview/reconcile-queue）；`app.ts:3898 "schema_reconcile.resolved"` → `event-subscriptions.ts:93`。
    ⚠ **命名与 PRD 不符**：PRD §0 写的是 `schema_reconcile.candidate_created`（候选**创建**时发），实装是 `schema_reconcile.resolved`（候选**解决**时发）—— 语义不同（一个是"有活要干"通知，一个是"活干完了"失效）。PRD 承诺的"候选待人确认 → NOTIFY 通知"这个方向**没有事件**。
  - **前端 ✅**：`apps/frontend-shell/src/pages/admin/PrototypeIntakePage.tsx`；已登记 `adminRegistry.ts:62`（roles admin/data_admin）且已归「建模与图谱」组（`ShellLayout.tsx:47`），f61 门覆盖。
  - **⚠ CLI 对等（R15）❌ 未做**：PRD §0 门禁明写"`prototype-intake`/`schema-reconcile` **必有** CLI 命令（`import --prototype`/`reconcile`）"。实测 `rg -n "prototype|reconcile" scripts/platform-cli.mjs` = **0 命中**。
- **结论**：**◐部分**（主体 ✅，两处小缺口：候选创建事件未发 + CLI 对等未做）。
- **最小 WO 建议**：`WO-INTAKE-CLI-EVENT`（轻）。🚦范围边界：`scripts/platform-cli.mjs`（加 `import --prototype` / `reconcile` 两命令）+ `apps/datacore/src/app.ts:3851` 附近（候选创建时补发 `schema_reconcile.candidate_created`）+ `apps/agentcore/src/event-subscriptions.ts`（登记新事件，注意会改 `ontology:check` 的事件计数，需同步回写本体 §4）。

---

### PRD-qos-cross-domain-unified.md
- **它要做什么**：统一版跨域编排 = **②确定性多路**（跨域题逐域映射 solver 并行秒答）+ **⑤LLM 多意图兜底** + **Coordinator 降级**（不再抢 solver 可解的题）。取代 `PRD-deterministic-cross-domain` + `PRD-multi-intent-orchestration` + 两份 WO。
- **PRD 自称的 AS-IS**：§2 四条缺口（**已逐条真跑核对**）：①Coordinator 门在 `orchestrator.ts:478` 于 `domainResolve(:488)` **之前**开火，Q2 三关键词共现被它先抢 → 3 角色 agent 烧 300s 无结论 · ②确定性层只有单域 · ③两 handoff 分支各建一份后半 → 冲突 · ④`domain-resolver.ts:31-37 DOMAIN_FAMILIES` 只有 5 域，**根本不含 Q2 的域**（良率/有效产出/长协/订单延误/外协加班）。
- **实测现状**（PRD 四条缺口逐条已闭）：
  - **缺口① Coordinator 降级 ✅ 且照 PRD 指定的"同一机制"做**：`apps/agentcore/src/router/coordinator.ts:115-117` 注释原文"WO-QOS-CROSS-DOMAIN-UNIFIED · Coordinator 降级（Q2 修复·关键）—— 与 S01 `isCapacityFeasibilityQuery` 同一机制…返 undefined **让位②确定性多路**"，判据用 `selectDeterministicMultiRoute` 本身（:8 从 `domain-resolver.js` import `domainResolveMulti`）。**没有 fork 第三张关键词表**，正是 PRD §2 末尾警告的那个坑被躲开了。
  - **重排序 ✅**：`router/orchestrator.ts:660-664` 注释逐字复述 Q2 铁证并说明"**先试 ②**"，② 排在 Coordinator 之前。
  - **缺口② 多域分解 ✅**：`router/multi-route.ts:65 selectDeterministicMultiRoute`（:9-10 抬头说明"排在 LLM classify 之前"）。
  - **缺口③ 共享后半 ✅ 只建一次**：`multi-route.ts:190,198` —— `routeSource` 区分 ②(`deterministic-multi-domain`)/⑤(`llm-multi-intent`)，注释明写"**装配/并行逻辑完全一致**"，一份 `runParallelRoutes` 被 ②/⑤/L2/L3 四路共用。
  - **缺口④ 扩域 ✅ 且是扩单一真值源、非 fork**：`router/domain-resolver.ts:314-316` 注释承认"ceo-route 的 5 硬域族根本不含 Q2 的域"，:338-340 说明素材复用 `coordinator.ts ROLE_KEYWORDS`、**但绑金库真名 solver**；实测新增域族 `:372 yield→yield_diagnosis` · `:376 lta→lta_gap` · `:378 affected→affected_orders` · `:379 外协/加班→outsourcing_split` —— 正是 Q2 那四个域。
  - **⚠ 门态（本 PRD 是本批唯一"门真开了"的）**：`qos.deterministic-multi-domain`（`features.ts:128`/`agentcore registry.ts:128`，defaultOn:false，在 `QOS_DARK_LAUNCH_FEATURES` 内）**被 DEMO_LIGHTUP 显式点亮** —— `apps/datacore/src/seed.ts:68 "qos.deterministic-multi-domain": true`，且 :66-67 注释说明它与 L3 门"两门缺一不可"。⇒ **demo 租户上 ② 是真跑的**。
- **结论**：**✅已实现**（四条缺口全闭，且门在 demo 上开着 —— 这是本批 22 份里少数"代码在 + 门开 + 有 SEAM"三者齐备的）。
- **备注**：本条与本文 `PRD-multi-intent-orchestration` 条**必须合读**：那份 PRD 的 ⑤ 路（`qos.multi-intent-orchestration`）门仍关；开着的是这份 PRD 的 ② 路。把两者混为一谈就会把"多意图并行已上线"这句话说错一半。

---

### PRD-quarter-rolling-1to1.md
- **它要做什么**：季度滚动看板 1:1 —— PRD 自评是"**全 19 视图里离 1:1 最近的一个**"，缺口不在结构而在**精确值与事件文案**：靠**调生成器种子**让管线实算出 HTML 的 6 季精确 dem/sup，并补 2 处小项（段头副标注、事件文案对齐）。
- **PRD 自称的 AS-IS**：§2 表（L44-51）：需求/供给双条 + 缺口三档 ✅（`QuarterlyRollingView.tsx:62`）· 事件+规则深链 ✅ · 6 季精确 dem/sup ◐（管线实算但值未必=HTML）· **枣庄储能线 CAPEX 项目 ◐**（现种子为合肥四期/盐城二期）· C08 外协上限引用 ◐ · 长协偏差 ✅（`ltaDeviation:350`）· 行尾跳风险 ✅ 超集 · **段头副标注 ❌**。
- **实测现状**：
  - **段头副标注 ✅ 已补**：`apps/frontend-shell/src/views/plan/QuarterlyRollingView.tsx:61` 注释"PRD-quarter-rolling §3-①：段头副标注（产能增量项目同年度基准情景，溯源同源）"。
  - **长协偏差表 ✅ 在**：`QuarterlyRollingView.tsx:121 data.ltaDeviation.map(...)`。
  - **⚠ 主工作量（种子对齐）❌ 未做**：PRD §3.1 自称"生成器种子对齐（**主工作量**，R14/R6）"。实测 `rg -n "枣庄" apps packages` = **0 命中**（"枣庄"只出现在 `docs/PRD-quarter-rolling-1to1.md` 自己里，:9/:12/:18/:26 等）⇒ **"枣庄储能线"CAPEX 项目种子从未落进合成器**。既然该项目是 6 季供给曲线的组成项（PRD §0 链路：`Σ已批准项目爬坡(枣庄)`），**6 季精确值 1:1 也就无从谈起**。
  - 视图本体 156 行，结构完整。
- **结论**：**◐部分** —— 结构/交互早已 ✅（PRD 自己也这么说），两处小项做了一处（段头副标 ✅）；**PRD 自己点名的"主工作量"整块没动**（种子未对齐 → 精确值不 1:1）。属"没接线"（种子数据根本不存在）。
- **最小 WO 建议**：`WO-QUARTER-SEED-ALIGN`。🚦范围边界：`apps/datacore/src/synthetic/battery.ts`（加"枣庄储能线"CapexProject 种子：2027-Q3 投产 +22 万套/季 · ramp 60→90 · CAPEX 14 亿）+ `apps/datacore/src/solvers/types.ts` 的 planview 参数（`weeklyWan`/`growthYoY`/`rollingCorrPct[6]` 整定）+ 该季事件挂 C08 深链。**SEAM 判据**：R6 —— 同 seed 重跑，6 季 `dem/sup` 逐字节等于 PRD §2 表列的 HTML 值（382/376…452/448），且**不是前端写死**（`debattery:check` 不超基线）。

---

### PRD-query-orchestration-service.md
- **它要做什么**：QOS 详细规格 —— 查询编排（分类 → 路径A 工作流 / 路径B Agent → SSE 流式答案），含 §8.2 的 SSE 事件名（CLAUDE.md 要求"一字不差"）与 §12 的 19 条验收。
- **PRD 自称的 AS-IS**：无现状节（原始规格文档）。
- **实测现状**：
  - **§8.2 九个事件名 100% 落在生产 src**（逐个 `rg -c` 于 `apps/agentcore/src`，均 ≥1 命中文件）：`task.accepted`(2) · `routing.completed`(1) · `clarification.required`(1) · `step.started`(3) · `step.completed`(6) · `answer.final`(3) · `action_draft.created`(2) · `task.failed`(4) · `task.cancelled`(3)。**且 CLI 也逐个消费**（`scripts/platform-cli.mjs:222-244` 的 switch 分支逐条对应）⇒ 事件契约是真跨端一致的，不是单侧声明。
  - **§12 验收关键量全部实装**（命中文件数，已排除 test）：`unverifiedNumerics`(15) · `VERIFIED_WORKFLOW`(14) · `AGENT_EXPLORATORY`(14) · `FallbackTrace`(7) · `Last-Event-ID`(3, D1 断线重连) · `Idempotency-Key`(5, D2) · `PLAN_VALIDATION_ERROR`(5, E2) · `qos_classifier_errors_total`(1, C2) · `qos_agent_budget_exhausted_total`(1, B3)。
  - **⚠ 跨命名一例**：`BudgetGuard` 这个 PRD 用词 `rg` = **0 命中**，差点判为未实现；再搜一轮才找到 —— 实装名是 `apps/agentcore/src/tools/budget.ts`（模块名而非类名），指标 `apps/agentcore/src/metrics.ts:89 qos_agent_budget_exhausted_total` 确在。**按 PRD 字面词搜就会误判。**
  - **事件单一来源有门守**：`scripts/check-system-ontology.mjs:5` 注释"数据流事件失效图（§4）—— `event-subscriptions.ts` 的事件集 **必须 =** 本体 §4 记录的事件集"，:28/:38 做集合对拍 ⇒ 事件名漂移会被 `ontology:check` 拦。
- **结论**：**✅已实现（契约与实现存在性层面）**。事件名一字不差、验收量全部有生产锚点、且有防漂移门。
- **诚实标注（未查清）**：与平台总纲同理，§12 的 19 条里 B3/B4/B5/C1/C2/D1/D2 等**行为断言**需注入 Mock LLM / 真起服务才能判定"是否真通过"，本次未跑。存在实现 ≠ 行为正确（「绿测试≠能用」）。

---

### PRD-reference-views-1to1-roadmap.md
- **它要做什么**：**索引/总纲**（非特性 PRD）—— 把 HTML 参考原型的 19 个视图盘清、定优先级、登记横切决定，并逐个引出子 PRD。它自己的交付物就是"子 PRD 队列齐全 + 横切决定固化"。
- **PRD 自称的 AS-IS**：§4 状态节自称"✅ 已出子 PRD（**全 7 份齐**）… ⬜ 待写：无（业务视图 1:1 子 PRD 队列已全部产出）"。
- **实测现状**：
  - **7 份子 PRD 文件全部存在**（逐个 `test -f` 实测）：`PRD-aop-annual-scenario-1to1.md` ✅ · `PRD-sop-balance-1to1.md` ✅ · `PRD-quarter-rolling-1to1.md` ✅ · `PRD-plan-audit-1to1.md` ✅ · `PRD-plan-generate-1to1.md` ✅ · `PRD-order-project-sim-1to1.md` ✅ · `PRD-inference-process-enhancement.md` ✅。
  - **§0 的横切决定已被下游实现遵守**（交叉验证，非仅看文档）：
    - "story/model 不做独立导航，融入推演入口" → 实测 `ShellLayout.tsx:38`「推演」组只有 `project-sim/global-sim/risk/order-chain/decision-play`，**无 story/model 独立项**；model 以 `mode="model-network"` 子模式融入（`ProjectSimView.tsx:512`）。✅
    - "generate = plan-generate 同一视图" → `views/sim/PlanGenerateView.tsx` 单一实现。✅
    - "图谱族坍缩进 OntologyGraphView，不逐个复刻" → `ShellLayout.tsx:52-56` 八视角是同一页的 collapsed 子组。✅
- **结论**：**✅已实现**（作为索引文档，其交付物齐全，且横切决定在代码里被真实遵守）。
- **备注**：本条判绿只说明"索引与决定成立"，**不代表 7 个子视图都 1:1 了** —— 逐个子 PRD 的实况见本文各自条目（本批覆盖了 quarter/audit/generate/order/inference 五份，aop 与 sop 不在本批范围）。

---

### PRD-rules-as-references.md
- **它要做什么**：**规则即引用** —— 所有推演入口的规则判定从"可编辑的一等规则库"按引用读取，改一条规则即所有入口行为随之变化；消灭"引用了但库里没定义"和"规则闸 fail-open 空过"。
- **PRD 自称的 AS-IS**：§0（实测证据）：① 求解器不读规则（`SolverContext` 不带 `rules`）② 规则逻辑写死在代码（C09 在 `capacity.ts:189-197`）③ **28 个被引用 vs 15 个被定义 → 13 个引用无定义**（`C01 C02 C04 C06 C09 C10 C11 C15 C16 C21 C22 C24 C25`）④ 前端显示"（当前库中未找到定义）"、`evaluate_rules` 遇未定义 fail-open ⑤ 全入口汇到 `POST /a/v1/solvers/:key/invoke`。
- **实测现状**（这份实现得很深，P1–P4 四期都有痕迹）：
  - **①② 求解器读规则 ✅**：`apps/datacore/src/solvers/types.ts:296-300` —— `rules?: Record<string, {key,name,expression,severity,params}>` + `ruleSetVersion?: string`，注释逐字对应 PRD §2.2/§4；:225 说明"params/rules/ruleSetVersion 便宜且共享 → 永远加载（不裁）"。
  - **ruleRefs 升为真引用 ✅**：`SOLVER_RULE_REFS` 在 contracts（`solvers/service.ts:11` import）；`service.ts:4342-4343` 每次 invoke 跑 `evaluateRuleRefs` → 有结果就挂 `out.evaluatedRules`；:4351 逐条按规则引擎评估。
  - **③ 13 个未定义规则 ✅ 全部补齐**：逐个在 `apps/datacore/src/synthetic/battery.ts` 计数，13 个码**全部 ≥2 处命中**（C01/C02/C04/C06/C09/C10/C11/C15/C16/C21/C22/C24/C25）。
  - **P4 数值维（最难的一半）✅**：`apps/datacore/src/rules.ts:100-125 projectRuleParams` —— 规则发布时把命名阈值**投影进** `solver_params`，注释 :104-107 精准指出"P1/P2 之后仍缺的那一半：求解器**算数**用的系数仍读 solver_params 里自己那份同值字面量…于是**改规则种子只改了个没人读的诱饵，推演分毫不动**"。投影后才真正做到"改规则→输出真的变"。
  - **诚实边界 ✅ 没有假装**：`solvers/service.ts:4508-4517` 明确列出 **6 个求解器**（risk_timeline / affected_orders / maintenance_stagger / mitigation_select / quarterly_gap / yield_diagnosis）其声明的规则码所需字段在输出口径中不存在 → 整体 `NOT_APPLICABLE`，注释写"**不伪造尺度凑 PASS（红线 RL5）**"。这是正确处置（诚实缺口而非假绿），但也意味着**这几个求解器的 ruleRefs 今天不产生任何闸门效果**。
  - **⚠ 两道门写了、但一道都没挂上（本条最重要的发现）**：PRD §2.5 要求两个门 —— `rule-closure:check`（引用⊆已定义）与 `no-hardcoded-rules:check`（阈值必须源自 rule.params）。
    脚本**确实存在**：`scripts/check-rule-closure.mjs` + `scripts/check-no-hardcoded-rules.mjs`。
    但**没有任何流水线调用它们**：不在 `package.json:32 "gates"` 的 23 条链里 · 无 npm alias · 不在 `scripts/gate.sh` · 不在 `.github/workflows/gates.yml`。
    **不是我 grep 出来的推断 —— 仓库自己的台账就是这么记的**：`scripts/gate-ledger.json` 里两条各自写着
    `"alias": null, "binding": "NONE", "provenRed": {"kind":"NEVER", ...}, "disposition": "WIRE"`
    （对照 `check-action-wiring.mjs` 是 `"binding": "GATES_CHAIN"` + 有 alias + `provenRed.kind="MUTATION"`）。
    ⇒ **典型"没接线"**：门造好了、从未跑过、从未红过，`disposition` 字段自己写着"该接线"。PRD §1.3 的北极星"零规则闸空过"因此**没有任何东西在守**，回潮零成本。
- **结论**：**◐部分** —— 主体（P1–P4 四期 + 13 条规则补齐 + 诚实 NOT_APPLICABLE）**实现得相当扎实**，是本批质量最高的实现之一；**唯一但关键的缺口是两道门未接线**，等于北极星②③（零未定义引用 / 零规则闸空过）**没有守门人**。
- **最小 WO 建议**：`WO-RULE-GATES-WIRE`（**极轻，投产比在本批最高** —— 门已写好，只差挂上）。🚦范围边界：只改 `package.json`（加 `rule-closure:check` / `no-hardcoded-rules:check` 两个 alias，并把两条脚本追加进 `"gates"` 链）+ `scripts/gate-ledger.json`（`binding` 从 `NONE` 改 `GATES_CHAIN`、补 alias）。**SEAM 判据**：接线后**先跑一遍看是不是红的** —— 若直接绿，须按 `provenRed` 纪律做一次故障注入（删一条规则定义 / 在求解器里硬编码一个阈值），确认门**真的会红**，否则接了个哑门（`provenRed.kind` 才能从 `NEVER` 改掉）。

---

## 2. 汇总表

| # | PRD | 结论 | 一句话 |
|---|---|---|---|
| 1 | inference-process-enhancement | ◐ **⚠不符** | 组件+6 挂载点在，但 trace 端点无前端消费方、节点 IPO 写死、5/6 挂载点恒传 `solved` |
| 2 | live-traceable-data | ◐ | P1 ✅ 生产真跑；`lineage/task` 端点不存在；`Provenance` 6 处挂载只 1 处真取活数据 |
| 3 | llm-agent-empty-response-guard | ✅ | FIX.1+FIX.2+R7 信封三段齐，全在生产路径 |
| 4 | maturity-master-plan | **⚠不符** | AS-IS 过期：求解器 8/21 → 实测 **59**；E6 已完成；VLE 无 8 轴成熟度报告 |
| 5 | multi-intent-L2-L3-coupled | ◐ | L2/L3 代码全在且接线；**L3 门 demo 已开**，**L2 门恒关**（只有 test 开） |
| 6 | multi-intent-orchestration | ◐ | ⑤ 路代码全在，门在生产恒关（勿与已开的 ② 路混淆） |
| 7 | nav-ia-reorg | ✅ | N1/N2/N3 齐，NAV_GROUPS 覆盖 ADMIN_PAGES **40/40**，另有 f61 防漂移门 |
| 8 | ontoflow-data-builder（v1） | ◐ | 已被 v2 取代；②③ 做了，①④（画布/准备度）没做 |
| 9 | ontoflow-v2-unified-modeling | ◐ | 契约 100% + 后端 6/9 端点；**前端画布零实现**，8 个端点唯一消费方是 test |
| 10 | ontology-7elements | ✅文档 / ⚠零执行 | 唯一 AS-IS 零偏差的文档；**P0/P1/P1/P2 四项建议至今零动工**（逐条复验仍成立） |
| 11 | ontology-browser-field-coverage | ◐ | P1/P3/P4 ✅（换名实现）；**R12 HARD 门实为 opt-in fail-open**，事件与 CI 门零实现 |
| 12 | optimize-whatif-conversational-wiring | ◐ | G1–G4 全落地且接线；会话门在 demo 恒关（底层 `opt.whatif` 反而是开的） |
| 13 | order-project-sim-1to1 | ✅ | `order_fullchain` 三判+三色+DAG 全在；DAG 9 节点（PRD 标题写 11 = 自身笔误）；C18 用信用代理 |
| 14 | plan-audit-1to1 | ✅ | PRD 标 ❌ 的 6 项全落地（DailyDotAxis / audit_timeline kind 路由 / KsfGraph） |
| 15 | plan-generate-1to1 | ◐ | 渲染层全 ✅；**采纳按钮接到 `采纳经营方案`，而它是 `NOT_IMPLEMENTED`** —— 批准写零字节 |
| 16 | platform-foundry-aip | ✅模块 / 未查清验收 | 模块与错误码全有生产锚点；§12 六条运行时断言**本次未跑** |
| 17 | prototype-intake-databuilder | ◐ | 主体 ✅（含双仓储+前端页）；候选创建事件未发、CLI 对等（R15）未做 |
| 18 | qos-cross-domain-unified | ✅ | 四条缺口全闭、无 fork 第三张表、**门在 demo 真开** —— 本批质量最高 |
| 19 | quarter-rolling-1to1 | ◐ | 段头副标 ✅；**PRD 自称的"主工作量"种子对齐整块没动**（"枣庄"全仓 0 命中） |
| 20 | query-orchestration-service | ✅契约 / 未查清行为 | 9 个事件名一字不差且 CLI 同步消费；验收行为断言未跑 |
| 21 | reference-views-1to1-roadmap | ✅ | 7 份子 PRD 齐；§0 横切决定在代码里被真实遵守 |
| 22 | rules-as-references | ◐ | P1–P4 实现扎实；**两道门写了从没挂上**（仓库自己的 gate-ledger 记 `binding:NONE`/`disposition:WIRE`） |

**计**：✅ 8 · ◐ 12 · ❌ 0 · 其中带 ⚠「PRD 陈述与现状不符」2 份（#1 #4），另 #10 是"文档对、执行零"。

### ⚠ 「PRD 自身断言了一件可核实的事、而事实相反」清单（最高价值）

| PRD | PRD 断言 | 事实 | 证据 |
|---|---|---|---|
| inference-process-enhancement | §2 表：跨周期反馈边 ❌、横切挂载 ❌（仅 QueryDock） | **两者都已做** | `InferenceProcessDag.tsx:36` fb 边 ×2；6 处挂载 |
| inference-process-enhancement | §7 DoD：「IPO 取真实 QOS 轨迹」「前端零写死步骤」 | **节点与 IPO 全是字面量；5/6 挂载点恒传 `solved`** | `InferenceProcessDag.tsx:18-29`、`:90`、`PlanAuditView.tsx:179` |
| maturity-master-plan | §1「8/21 求解器实现」；§5 E6「13 求解器补全」列为未启动 | **实测 59 个**；代码注释自己标着「成熟度 E6a」 | `solvers/service.ts:49`（脚本计数 59）、`:58` |
| maturity-master-plan | §4「478 测试 LLM 全 mock」 | 测试规模已翻倍（datacore **236** / agentcore **150** 个测试文件） | `ls apps/*/test/*.test.ts` |
| order-project-sim-1to1 | §1.4「**11 节点**业务建模链 DAG」 | 实为 **9 节点**；PRD 自己列的节点清单也只有 9 个（自相矛盾） | `solvers/service.ts:3278-3290` |
| prototype-intake-databuilder | §0 事件 `schema_reconcile.candidate_created` | 实装是 `schema_reconcile.resolved`（语义相反：完成 vs 待办） | `app.ts:3898`、`event-subscriptions.ts:93` |
| ontology-browser-field-coverage | §3.2「HARD 门：存在 UNMAPPED → 拦发布」 | 门取自**请求体**，默认 false，不传即放行 | `app.ts:3420-3421`、`endpoints.ts:500` |
| rules-as-references | §2.5 两道门 `rule-closure:check`/`no-hardcoded-rules:check` | 脚本在、**一道都没挂进任何流水线**（仓库台账自记 `binding:NONE`） | `scripts/gate-ledger.json`、`package.json:32` |

---

## 3. 补做建议（按投入产出排序）

> 排序判据 = （有活消费方 / 今天就在退化）÷ 工作量。前 4 条都是**小时级**改动。

| 序 | WO | 量级 | 为什么排这里 | 🚦范围边界 |
|---|---|---|---|---|
| 1 | `WO-RULE-GATES-WIRE` | **XS**（改 2 个文件） | 门**已经写好了**，只差挂上。不挂 = 北极星"零规则闸空过"无人守、回潮零成本。仓库自己的台账写着 `disposition: WIRE` | `package.json`（2 个 alias + 追加进 `gates` 链）· `scripts/gate-ledger.json`（binding 改 GATES_CHAIN）。**接线后必须先跑一遍看是否红**，直接绿则做故障注入证明不是哑门 |
| 2 | `WO-SOLVER-OUTPUT-SHAPE` | **XS**（3 处小改） | **2 个活消费方今天在 demo 上跑**（agent 首轮 prompt + 治理台关系图），门 `qos.dril-routing` demo 已开 ⇒ **此刻正在退化**。A 侧已经返回了，只是 B 侧 map 漏抄一行 | `agentcore/src/tools/clients.ts` · `tools/datacore-http.ts:373-383` · `dril/resource-projector.ts:52`。建议与 ④-b（`reads`）**同一 dev 整单** |
| 3 | `WO-L2-LIGHTUP` / `WO-OPTWHATIF-LIGHTUP` | **XS**（各改 seed 1 行） | 代码全在、SEAM 全绿、只差点亮。**但前置是亲手跑 SEAM**（L2 验不劫持既有路由；whatif 验 Δ 非空+决策真切换），确认了再开 | 各只改 `apps/datacore/src/seed.ts` DEMO_LIGHTUP + 一条 demo 租户断言 |
| 4 | `WO-ACTION-IMPACT-READOUT` | **S** | 审批人今天**批准前看不到会写什么**（`ActionsPage.tsx` 只渲染 payload）。PRD 已论证"先接出口再补声明"，先补声明只会把死代码从 1 条扩到 9 条 | `datacore/src/app.ts`（`GET /a/v1/action-types/:key/impact` + POST body 补 `effects`）· `scripts/check-action-wiring.mjs`（加 effects 断言） |
| 5 | `WO-ADOPT-SCHEME-EXECUTOR` | **S–M** | 用户点"采纳本方案"→ 审批链走完 → **真值零字节变更**（`G-ACTION-NOOP-EXEC` 活体，且是全仓最后 1 个 `NOT_IMPLEMENTED`）。UI 已在跑，欺骗性最强 | `datacore/src/actions.ts` · `mapping.ts`/`decision/kernel.ts` · `PlanGenerateView.tsx`。**硬约束**：`actions.ts:57` 已定"不得覆盖 `PLAN_GOAL_TARGETS`" |
| 6 | `WO-IPE-TRACE-WIRING` | **M** | 5 个推演视图的"推演过程"面板**恒显示全绿 10 节点**，与实际运行无关 —— 这是会误导决策者的假绿，且后端投影端点已白造 | `frontend-shell/src/api/endpoints.ts` · `components/InferenceProcessDag.tsx`+`InferenceProcessPanel.tsx` · 5 个挂载视图传 `taskId` |
| 7 | `WO-FIELD-COVERAGE-HARD` | **M**（破坏性） | R12 从 SOFT 升 HARD 是这份 PRD 的核心，今天等于没升。**但翻默认值是行为破坏性变更**，需先评估存量草稿被拦的规模 | `datacore/src/modeling.ts` · `app.ts:3418-3421` · `frontend-shell/src/api/endpoints.ts:500` · 新 `scripts/check-field-coverage.mjs` |
| 8 | `WO-SOLVER-ROWLEVEL` | **M**（17 处调用方） | 补齐一个**已声明的不变量**（R2/A6）而非新造能力：`base_manager` REST 面受限、求解器面不受限，两面不一致 | `datacore/src/solvers/service.ts:4007` + 17 处调用方 + `ontology.ts` 正门 |
| 9 | `WO-LINEAGE-TASK` + `WO-PROV-OBJECT-MODE` | **M** | "结果→入参对象→原始行"这条溯源链断在任务级；前端 6 个悬浮溯源里 5 个展示的是写死公式串 | `datacore/src/app.ts`（lineage/task）· `agentcore/src/router/orchestrator.ts`（Task 留入参 refs）· `views/BaseOutlookPanel.tsx`+`views/capacity/*.tsx` |
| 10 | `WO-QUARTER-SEED-ALIGN` | **M** | PRD 自称的"主工作量"整块没动，1:1 无从谈起。纯种子整定，风险低但要反复对数 | `datacore/src/synthetic/battery.ts`（枣庄 CapexProject 种子）· `solvers/types.ts` planview 参数 |
| 11 | `WO-ONTOFLOW-CANVAS` | **L** | 后端 6 个端点已白造（唯一消费方是 test）。价值高但工作量大，且**必须一个 dev 整单**（跨前后端两半） | `frontend-shell/src/pages/admin/`（新画布页）· `api/endpoints.ts` · `adminRegistry.ts`+`ShellLayout.tsx`（否则 f61 门红）· `mocks/handlers.ts` |
| 12 | `WO-MATURITY-REFRESH` + PRD 订正 | **XS**（纯文档） | 不改代码但防止下一个人被过期数字误导（求解器 8/21 → 59；E6 已完成；order DAG 11 → 9 节点） | 只改 `docs/PRD-maturity-master-plan.md` §1/§4/§5 三表 + `docs/PRD-order-project-sim-1to1.md` 节点数 |

**并行/串行提示**
- 1/2/3/12 四条**文件边界互不重叠**，可四个 dev 全并行。
- 4 与 5 都碰 `datacore/src/actions.ts` → **串行或同单**。
- 7 与 9 都碰 `frontend-shell/src/api/endpoints.ts` → 注意冲突。
- 2 的 ④-a 与 ④-b **必须同一 dev 整单**（同一条 DRIL 链路两半，拆开必然只接一半 —— CLAUDE.md 记录的老炸点）。
- 11 跨前后端两半，**一个 dev 整单**，不得拆给两人。

---

## 4. 本次审计未查清的项（不猜，一律列出）

| 项 | 卡在哪 |
|---|---|
| `PRD-platform-foundry-aip` §12 的 P1/AU2/B3/B5/D1/D2 | 属**运行时行为断言**（起两服务、停一侧、注入 Mock LLM），静态代码判不了。需 FDE 亲手跑 |
| `PRD-query-orchestration-service` §12 的 B3/B4/B5/C1/C2/D1/D2 | 同上。实现存在性已确认，行为正确性未验 |
| `PRD-nav-ia-reorg` §7 的"各角色亲手点一遍 + 截图留证" | 人工验收项，判据不在代码里（N1–N3 的代码实现已判绿） |
| `PRD-plan-audit-1to1` §2 行 8「问题级传播链 因素→对象→指标/规则」 | PRD 该行原本只标 ◐ 且未给明确 DoD，无法判定"够不够" |
| 各 1:1 PRD 的「数据值 100% 对齐 HTML」 | 除 quarter（已确认种子缺失）外，其余视图的精确数值是否 == HTML，需真跑比对，本次未跑 |
