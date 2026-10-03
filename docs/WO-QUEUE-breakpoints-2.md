# WO 队列 · 本体 §8 未闭断点 → 可派工单（WO-BREAKPOINT-TRIAGE-2 · 二次分诊 · 2026-08-18）

> **二次分诊的由来回一句话**：第一版（`docs/WO-QUEUE-breakpoints.md`，集成线 `2a1a412b` 时代）之后，
> WO-ONTO-STATUS-BACKFILL 给 95 个无标记编号补了状态标记，队列度量对象从 17 行变成 **38 行**
> （`grep -cE '🔴 *未修|◑ *部分闭合' docs/SYSTEM-ONTOLOGY.md`，集成线 `776b7d33e` 实测）。
> 本文只覆盖**增量**：第一批已转单的 13 个唯一编号不重复分析（一句带过并引用第一版），
> 重点是 backfill 新增的 26 行。**本文不改一行生产代码、不改本体、不改任何基线。**

## 本体引用与影响

- **触及断点**：§8 全部 38 行标记（26 个 backfill 新增编号 + 第一批 8 个仍有标记的编号）
- **触及链路**：§3 行动写回链 · 规则作用域链 · Skill 图编排链 · 门/棘轮体系（§7）
- **不变量**：R4（审批即生效）· R6（确定性）· R13（未审核态不谎报）
- **回写**：无（本单只出文档；§8 的状态订正列在《可派工单表》`WO-ONTO-S8-MERGE-GUARD` 里，由那单执行）

---

## 一 · 先自证工具：38 是什么数

队列脚本口径 = 整文件、整行、标记出现在**任何列**都算（含描述列里的引用与删除线文本）。
我的抽取口径 = 逐命中行取「编号列（第 2 列）+ 状态列（倒数第 2 列）的标记序列」。

**金丝雀 3/3（铁律 0.6：报组成分解前先自证工具）**：

| 样例 | 预期 | 实测 |
|---|---|---|
| L2308 `G-RULE-SCOPE-NO-CARRIER-C31`（已知必中） | 队列 grep 命中 = 1 | **1** ✅ |
| L2226 `G-ADOPT-SCHEME-NO-CARRIER`（状态列 ✅ 已修，已知必不中） | 队列 grep 命中 = 0 | **0** ✅ |
| L2330 `G-MOCK-PARAM-ARITY-SILENT-DROP`（✅ 已闭行，已知必不中） | 队列 grep 命中 = 0 | **0** ✅ |

**38 的组成分解**：

| 口径 | 数 |
|---|---|
| 含标记的**行**（= 脚本报的数） | **38** |
| 其中第一批 13 唯一编号占 | **12 行**（8 个唯一编号；另 5 个编号 `G-C08`/`G-IMPEDIMENT②`/`G-PROMPT-KEYS`/`G-PROVISIONAL`/`G-OEE` 已无任何标记，与第一版「已闭」结论一致） |
| 其中 backfill 新增标记占 | **26 行**（26 个唯一编号，含 1 行非表体的章节标题行 L2351 `G-ONTOLOGY-INVARIANT-ENFORCEMENT-UNDECIDED`） |
| 38 行里**状态列其实已是 ✅**、标记只是行内引用/删除线/过期描述残留的 | **4 行**（L2128 · L2224 · L2225 · L2229，见下「已闭未回写」） |
| 38 行里**同一编号还有第二个（第三个…）§8 行**的 | **11 行**（L2123 · L2128 · L2203 · L2224 · L2225 · L2229 · L2319 · L2321 · L2323 · L2328 · L2331） |

### ⚠️ 重复行残留核实（WO 派单要求「WO-ONTO-DEDUPE 已并，理论上应无重复——核实」）

**核实结论：dedupe 做了，但被后续 merge 逐次带了回来，且 dedupe 门今天就红在集成线上。**

- WO-ONTO-DEDUPE 提交 `c073fa23a` 自己的树里 `G-GATE-ROSTER-HANDCOPIED` / `G-ACTION-NOOP-EXEC` 各 **1 行**（dedupe 真做过）；
- 但它的收编 merge `98020d3a1` 里 `G-GATE-ROSTER-HANDCOPIED` 已变回 **2 行**——**冲突解决当场把旧行带回**；
- 之后 `28cc6f2ec`（roster-sweep-2 收编）→ 3 行，`776b7d33e`（adopt-scheme-carrier 收编）→ **4 行**（现状）。
- **机器早就在喊**：`node scripts/check-ontology-s8-dedupe.mjs` 在 `776b7d33e` 上 **RC=1**，逐条点名 12 个编号各占多行（编号行 201 · 唯一编号 181）；`node scripts/check-ontology-s8-status.mjs` 同 **RC=1**（L2125 / L2204 两行无标记——都是重复残留行）。两道门都在 `pnpm gates` 里，红着没人收。

形态（铁律 0.6 句式）：**「我用『dedupe 工单已收编』当作『§8 没有重复行』的证据，而前者并不度量后者 —— 收编的是那棵树，后来每次 merge 解冲突都在把旧行带回来。」**

---

## 二 · 逐条复核：backfill 新增 26 行「今天还成立吗」

判据不是读 §8 描述，是去代码里追调用链。证据列全部 file:line 级，否定结论附金丝雀。

| # | 行 | 断点 | 标记 | **今天** | 证据（追到调用点/条件为止） |
|---|---|---|---|---|---|
| N1 | L2123 | `G-PRD-DATA-UNGROUNDED` | ◑ | **仍成立** | 门 `scripts/check-prd-data-grounding.mjs` 与棘轮 `scripts/prd-data-grounding-baseline.json` 在位；基线 **7 条豁免全部 `kind:"待修"`**（逐条列出核对，非估算）⇒ 存量 burn-down 一条没动；80 份零数据前置清册 = `WO-PRD-FIELD-AUDIT` 有 handoff 分支（`8ed7727b6` · **2026-08-11 · 未并 · 已陈旧**）。⚠ 重复行 L2125（同编号、无标记）残留 |
| N2 | L2141 | `G-SLICE-REF-PRODUCER-EMPTY` | 🔴 | **仍成立** | `apps/agentcore/src/refs/report.ts:14` 的 `source.kind` 枚举仍是 `"agent"\|"workflow"\|"plan"\|"intent"`（**无 slice**），`:46` 唯一产出函数仍只产 `kind:"rule"`；`resource-projector.ts:142` 确有 `kind:"slice"` 但那是 B 侧内部资源图（`resource-registry.ts`），**不回写 DataCore `reported_refs`** ⇒ `governance.sliceReferences` 的 ①② 层恒空不变。⚠ 曾派 `WO-SLICE-REF-PRODUCER`（`5ebc6cf2f` · 2026-08-10 · 未并 · 已陈旧） |
| N3 | L2142 | `G-ACTIONTYPE-NO-TARGET` | 🔴 | **仍成立** | `apps/datacore/src/domain.ts` 的 `ActionTypeRecord` 无 `targetTypeKey`（金丝雀：同文件 `ActionTypeRecord` 命中；`targetTypeKey` 全仓命中在 `packages/contracts/src/sim.ts:46`——那是传导规则边，不是 ActionType） |
| N4 | L2144 | `G-SLICE-ROOT-ARGS-UNDISCOVERABLE` | 🔴 | **仍成立** | `apps/datacore/src/app.ts:4281-4294` `GET /a/v1/ontology/slices` 摘要投影仍只给 `sliceKey/version/rootType/hops/linkKeys/maxNodes/fixtures`，无 `requiredArgs`（逐字段读路由体） |
| N5 | L2145 | `G-DERIVSPEC-EMPTY` | 🔴 | **仍成立** | `DerivationSpec` 在 `apps/datacore/src/seed.ts` 与 `synthetic/*.ts`（10 文件）**0 命中**；金丝雀：同串在 `ontology-core.ts`/`app.ts`/`actions.ts`/`domain.ts`/`sim/certification.ts` 5 个 src 文件命中 ⇒ 是真零种子，不是工具坏。`app.ts:2416/3888/5955` 三处 `derivationSpecs.list(… ACTIVE)` 消费方在等 |
| N6 | L2147 | `G-SLICE16-TWO-VOCABS` | ◑ | **仍成立 · 等外部输入** | A 集 `packages/contracts/src/slice-layers.ts` `SLICE_LAYER_IDS` 在位（金丝雀 4 命中）；B 集 16 层名缺的输入是 **S7 原文档，不在仓里** —— 代码侧无动作可派，属「等仓主提供出处」 |
| N7 | L2148 | `G-SERIAL-GRAPH-EXECUTION` | 🔴 | **仍成立** | `apps/agentcore/src/workflow/executor.ts:104` 仍 `for (const step of input.steps)` 逐步串行；`router/multi-route.ts:210` `Promise.all` 扇出与 Coordinator 扇出（`orchestrator.ts` 多处）均在；`graph-runtime:check` 在 `package.json` **0 命中**（金丝雀：同文件 `gates` 键命中）⇒ 三套既有扇出零收编 + 门未建，PRD §9 W2 未落 |
| N8 | L2149 | `G-SKILL-GRAPH-NO-RENDER-CLOSURE` | 🔴 | **仍成立** | `packages/contracts/src/skill-graph.ts:22` 头注原文「R11…本切片不校验」在位；`render` 节点仍 NOT_IMPLEMENTED（`apps/agentcore/src/skill-orchestrator.ts:337` 注释「编译期 NOT_IMPLEMENTED 显式拒绝」）。前置 = render 节点实现（与 N7 同属 W2） |
| N9 | L2153 | `G-SECURITY-COLUMN-LEVEL` | ◑ | **仍成立** | 残口①抽查坐实：`solvers/service.ts:1658 (gapAttribution)` 第 2/8 行**直读** `this.repos.objects.listByType(...)`（Metric/Base），不经 `loadContext` ⇒ 列级投影管不到早返回求解器。残口②③④（系统态 loadContext / 时序列级 / 系统内部写）行内已诚实登记 |
| N10 | L2155 | `G-NO-INTERFACE` | ◑ | **仍成立** | 定义/发布门/查询三面已闭（`check-object-interface.mjs` 在 `pnpm gates`）；残口坐实：前端 `grep -rl 'ObjectInterface\|object-interfaces' apps/frontend-shell/src` = **0 文件**（管理台不存在）——金丝雀：同法 grep `DynamicLeverPanel` 前端命中 |
| N11 | L2162 | `G-7` | ◑ | **仍成立 · 等 PRD P5** | `packages/contracts/src/llm.ts:216` `LlmPurposeSchema` 仍 `z.enum([...])` 写死；枚举扩展是契约面决策，待 PRD P5 |
| N12 | L2203 | `G-CAPACITY-DEAD-BI` | ◑ | **仍成立（残留比描述小）** | `DynamicLeverPanel`（`RiskBoardView.tsx:1144`）与真 NL `CapacityLiveDialog`（`:31` import）已挂；**残留坐实**：正则假 NL `QaPanel` 仍并列挂载（`:1184` 使用 / `:1899` 定义，函数体 `/客户\|谁/.test(q)` 等正则分支原样）。⚠ 重复行 L2204（同编号、无标记）残留 |
| N13 | L2208 | `G-SIMSESSION-NO-BIZ-REUSE` | 🔴 | **仍成立** | 前端 `/sim/sessions` 消费方 = `views/sim/**` 6 文件（SandboxView/PerturbationTimeline/SandboxPlaysPanel/SimReadinessPanel/EdgeActivePanel/edgeActiveModel），业务推演页**零消费**（WhatIf/DisruptionRadius/OrderChain 的 `SimSession` 命中全在注释里，逐条看过）；`putSession` 状态写入全仓只有 `app.ts:1974` 的 `"RUNNING"`，契约枚举 `PAUSED/ENDED`（`packages/contracts/src/sim.ts:137`）**运行时零置位**（金丝雀：同文件 `DRAFT/RUNNING` 有置位） |
| N14 | L2210 | `G-AUDIT-TIMELINE-HASH-PROJECTION` | ◑ | **仍成立** | `solvers/risk.ts:216-248` `dataMode:"LIVE"\|"MOCK"` 披露机制在位；真逐日审计时序源未接（行内定性准确） |
| N15 | L2256 | `G-SOLVER-SCOPE-DEAF` | ◑ | **仍成立** | 最危险处已闭坐实：`risk.ts:573-575` 守卫已拆（`resolveBaseId` 抛 400，`args.base && args.factor` 双键守卫 0 命中）；状态列自报 **4/16 已闭、其余静默处仍开** —— 未发现反证，剩余 12 处是真欠账。⚠ `WO-SOLVER-SCOPE-FE` 有 handoff（`7b52d4f2f` · 2026-08-11 · 未并 · 已陈旧） |
| N16 | L2257 | `G-YIELD-SERIES-SOURCE-MISMATCH` | 🔴 | **仍成立** | `extended.ts:346 (yieldDiagnosis)` 仍吃对象层序列；`:1187` 注释原文「无 series → 返 EMPTY…真时序接入后再喂真 series」⇒ A8 `yield:process`（90 天日粒度）**仍未接入**，行内「照取证单接线会把 EMPTY 降级成假 LIVE」的警告今天照样成立 |
| N17 | L2289 | `G-UI-FIRSTLAYER-OVERLOAD` | ◑ | **仍成立** | 门 `scripts/check-ui-first-layer.mjs` 在位（D4/D5/D6 机制 grep 46 处命中）；残留 = 存量棘轮 burn-down（登记时 73% 页面 R-UI-2 不达标）+ R-UI-1 视线距离（渲染后几何量）未机检（行内诚实边界）。`WO-UI-LAYERING`（机制单）已并；**逐页降层的 burn-down 未派** |
| N18 | L2307 | `G-RULE-SCOPE-NAMESPACE-CONFUSION` | ◑ | **仍成立（本行无新增欠账）** | 机制在位：`rule-scope.ts:54` `rule.scope_unresolved` 事件 + `:108 (findUnknownScopeTypes)`；C26/C27/C28 已修，剩余开口就是 N19/N20 两条——本行是它们的父账，不重复派 |
| N19 | L2308 | `G-RULE-SCOPE-NO-CARRIER-C31` | 🔴 | **仍成立 · 等裁决** | `battery.ts:363` C31 表达式原样、`:3208` 注释「故意保持原样」在位；`Outsource` 承载类型仍零候选（`rule-scope.ts:71` 注释自陈不做模糊匹配）。修法「补建承载类型（动 94 类型金值）vs 退役 BLOCK 级合规规则」= 产品/治理取舍 |
| N20 | L2309 | `G-RULE-SCOPE-CATEGORY-ERROR-C10` | 🔴 | **仍成立 · 等裁决** | `battery.ts:390` C10 表达式原样、`:3223` 裁决注释在位；修法「给行动/场景要素另立作用域维度 vs 退役」= 本体结构裁决，**任何改名都是错的**（行内裁决仍有效） |
| N21 | L2310 | `G-GATE-RC1-MASQUERADE` | ◑ | **仍成立（残留=结构性诚实边界）** | 机制实测绿：`node scripts/check-gate-exit-discipline.mjs` **RC=0**，99 门有 RC=2 出口 + 顶层兜底；残留「静态 import 链接期失败堵不住」是 node 结构性限制，无可派动作（除非上「每门子进程化」这类大改，不值） |
| N22 | L2311 | `G-GATE-SCOPE-MISSES-SUBJECT` | ◑ | **仍成立** | 本门先行坐实：`check-dev-jargon-onscreen.mjs:660` `MIN_LOCALE_LITERALS = 1200` + `:746` 判负分支在位；残留 = **其余带扫描面的门没有「独立口径分母下界」这第二路信号** —— 这是可派的普查单 |
| N23 | L2312 | `G-RATCHET-NEWFILE-BLIND` | ◑ | **仍成立** | 本门先行坐实：`check-ui-first-layer.mjs` 头注 D5 全局守恒 / D6 `unlisted` 段在位；残留 = **其余 18 个基线写入方**（行内现算数）没有全局守恒 + 未登记文件落账 —— 可派的逐门改造单 |
| N24 | L2319 | `G-PROCESS-TICK-COVERAGE` | ◑ | **仍成立** | 9/65 → **29/65** 已坐实（状态列 + `DEMO_PROPAGATION_RULES` 13→35）；剩余 36 条分解 11（不该动）+7（零物化对象，补要动 94 金值）+18（有对象无入边）逐条枚举在案；`EquipmentOEE` 一条边 +5460 链路实例的判断**留给审核方否决**（行内原文）⇒ 部分可派、部分等裁决。⚠ 重复行 L2320/L2322 残留（内容已并，行未删） |
| N25 | L2333 | `G-DERIVED-FORMULA-UNVERIFIED` | ◑ | **仍成立（放大器已修）** | 门 `check-derived-recompute.mjs` 在 `pnpm gates`；**放大器已闭坐实**：`ontology.ts:78 (evalArithmetic)` 对未知标识符现在 `throw validationError("bad formula")`（第 8 行），不再静默返 0；残留 = 「公式本身对不对」（语义维）+ `DerivationSpec` 覆盖（= N5 同源） |
| N26 | L2351 | `G-ONTOLOGY-INVARIANT-ENFORCEMENT-UNDECIDED` | ◑ | **仍成立 · 等裁决** | 章节体三条开口逐条核对：① 阻断模式未裁（`ONTOLOGY_INVARIANT_ENFORCEMENT_MODE` 恒 `ANNOTATE_ONLY`，两个调用点已接好，裁完改一个常量）；② 容差/停用不落库（刻意，落库要答治理三问）；③ mock 守卫表是替身（彻底解 = DSL 下沉 contracts）。①② 都是仓主裁决 |

**分布（26 行）**：仍成立 24 · 已闭未回写 0 · 标错 0。其中「仍成立但**等裁决/等外部输入**」6 行（N6 · N11 · N19 · N20 · N26 · N24 的一部分），「残留是结构性边界、无可派」1 行（N21）。
backfill 的标注质量整体可信：26 行逐条追代码后**没有一行判「标错」**——标注人（WO-ONTO-STATUS-BACKFILL）每条都写了 2026-08-18 复核注，与我实测一致；有 3 行我补了它没写到位的证据（N9 残口①行号漂移后重新坐实 · N13 注释命中与真实消费方的区分 · N22/N23 残留的准确表述）。

---

## 三 · 第一批已转单条的现态抽查（批次01 落地核对）

第一版判「仍成立」的 8 条唯一编号 + 派出去的批次01，逐条对现态：

| 断点（第一版 #） | 批次01 工单 | **现态** | 证据 |
|---|---|---|---|
| `G-SEAM-GATE-METHOD-BLIND` 残乙（#2） | WO-BEFE-WILDCARD-CLAIM | **✅ 已收掉** | `check-backend-frontend-seam.mjs` 的 `pathMatches` 已重写为对称严格通配（「整段 `*` 只吃整段 `*` 或段内 glob，不吃字面段」），旧宽松语义隔离进 `pathMatchesLax` 且注释写明唯二合法用途；收编 merge `e3737e303` |
| `G-ACTION-NOOP-EXEC` + `G-ADOPT-SCHEME-NO-CARRIER`（#3 #4） | WO-ADOPT-SCHEME-CARRIER | **✅ 已收掉** | `apps/datacore/src/actions.ts:70` `采纳经营方案: "WIRED"`；`scheme_adoptions` 台账 + AOP 读端 + 接缝测试随 `776b7d33e` 并入（本单基线就是这个 merge） |
| `G-PLAN-CHANGE-NO-LEVER`（#5） | WO-PLAN-CHANGE-LEVER-MAP | **仍成立 · 在跑** | `app.ts:593-608` 第③分支仍对 order-chain 结论 / `coordinate_capacity` 诚实失败（读原文核对）；lever-map 在跑 ⇒ **不重复派** |
| `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` ①（#7） | WO-SKILL-REFGRAPH-WIRE | **✅ ①已收掉** | `extractRelations` 生产调用方 = `apps/agentcore/src/dril/resource-registry.ts:224`（src 内，组合式）；① 从待派表移除。②（dependsOn 覆盖）由 WO-SKILL-DEPENDSON-COVER **在跑**（dependson-cover）⇒ 不重复派 |
| `G-STEP-VOCAB-SPLIT-TWO-HOMES`（#9） | WO-STEP-VOCAB-UPLIFT | **✅ 代码已根治 · 但 §8 回写被 merge 冲掉（见下「抽查发现」#2）** | `ExtraToolStepSchema` 唯一出处在 `packages/contracts/src/skill-compile.ts:109-123`；agentcore `catalog/service.ts:27` 只 re-export（本地副本已删）；根治提交 `d0e977628` |
| `G-PROMPT-KEYS-CONFIG-ONLY`（#11） | WO-PROMPT-KEYS-WIRE + WO-PROMPT-KEY-LINT | **✅ 已收掉（4 键全接）** | `ruledocs.ts:210` / `modeling.ts:214` 改读 `promptTemplateOverride`；`orchestrator.ts:2245` `answer_compose` 接线；`skill-summary-review.ts` 第 4 键按治理裁决接成建议式。§8 L2278 状态列 = ✅（此行已不在 38 里，前后一致） |
| `G-GATE-ROSTER-HANDCOPIED`（#14） | WO-GATE-ROSTER-SWEEP-2 | **仍成立（债 13→7）· 可派第 3 刀** | `scripts/gate-roster-baseline.json` 现算：`criteria 48 · computed 19 · roster 7`，roster 7 处逐键列出（`check-boundary-singlesource.mjs:SEG_CONSUMERS/PLAN_GOAL_CONSUMERS` · `check-chain-scan-honesty.mjs:SCAN_TARGETS` · `check-deploy-governance.mjs:APPS` · `check-layout-legibility.mjs:PAGES` · `check-dev-jargon-onscreen.mjs:SCAN` · `check-typecheck-coverage.mjs:PACKAGES`） |
| `G-SPLITACCOUNT-PROMISE-ONLY`（#16） | WO-FACT-USAGE-REGISTRY（B-3 前置）· WO-GATE-B-BROWSER-HARNESS（B-1/B-4·U8） | **仍成立 · 子项均在跑** | `check-harness-ux-splitaccount.mjs` 在 `pnpm gates`（门 B 已建）；`layout-probe.mjs` 无 z-order/快照比对能力（grep `zOrder\|snapshot` 0 能力命中）⇒ harness 单仍在跑合理；B-2（3 面板 0 对位）仍**等裁决** |

### 抽查发现的问题（两条都够建机制的分量）

**#1 「已闭未回写」在 38 里占 4 行，全是 merge 解冲突带回来的旧行。**

| 行 | 编号 | 真态 | 证据 |
|---|---|---|---|
| L2128 | `G-SEAM-GATE-METHOD-BLIND` | ✅ 全闭（甲乙均闭） | 该 🔴 在**描述列**（「pathMatches 第 706 行仍是…」——行号与内容双过期）；同编号 L2132 状态列已是 ✅ |
| L2224 | `G-ADOPT-SCHEME-NO-CARRIER` | ✅ 已修 | 同编号 L2226 状态列 ✅（`b3e6ad3da` 回写）；本行 🔴 是旧行残留 |
| L2225 | `G-ACTION-NOOP-EXEC` | ✅ 全闭 | 状态列 🔴 原文「修执行器归后续 WO」——那个 WO 已并入；同编号 L2229 ✅ 全闭 |
| L2229 | `G-ACTION-NOOP-EXEC` | ✅ 全闭 | ◑ 命中在**删除线文本**里（`~~◑ 部分闭合（…10 型 WIRED…~~`），状态列实为 ✅——grep 不认删除线，与第一版「行文把标记带回来」同族 |

**#2 ✅→🔴 状态回滚第二例（第一次是 `G-OEE-DUAL-TRUTH`，这是第二次 ⇒ 按铁律 0.6 当场建机制）。**

`G-STEP-VOCAB-SPLIT-TWO-HOMES` 的回写提交 `a81062e29`（状态列改为「✅ 已修（WO-STEP-VOCAB-UPLIFT…）」）
**是 HEAD 的祖先**，但它之后的收编 merge `3ddd98dff`（refgraph-wire）解冲突时把该行**从 ✅ 改回 🔴**
（`git diff c08657446 3ddd98dff` 对该行 `-✅ 已修 / +🔴 未修` 实证；父提交 `c08657446` 里是 ✅）。
与 `G-OEE-DUAL-TRUTH` 的「回写在合并中丢失」逐字同形态：
**「我用『提交信息里写了已回写』当作『本体真被回写了』的证据，而前者并不度量后者。」**
`WO-ONTO-TRUNCATE-GUARD` 只防空 blob/行数腰斩，**不防状态回滚**；`ontology-s8-dedupe:check` 能抓住重复行但今天红着没人收。
⇒ 机制落进下表 `WO-ONTO-S8-MERGE-GUARD`：**「§8 状态只许前进」门**（merge 后任一编号状态从 ✅ 退回 🔴/◑、或唯一编号行数变多，即红）+ 把当前双红（dedupe / s8-status）收掉。

---

## 四 · 可派工单表

> 🚦范围边界 = 该 dev 本单的身份。**跨数据/引擎两半的一个 dev 整单做。**
> 批次01 在跑的单（lever-map · dependson-cover · browser-harness · fact-usage）**不重复派**。

### A · 无前置依赖（可立刻并行派）

| 单号 | 断点 | 三形态 | 🚦范围边界（只碰） | 验收判据（断言落在什么上） | 画像 |
|---|---|---|---|---|---|
| **WO-ONTO-S8-MERGE-GUARD** | 本单测出（✅→🔴 回滚第 2 例 + dedupe/status 双红无人收） | 没接线（这道门不存在） | `scripts/`（新门 + 接进 `pnpm gates`）· `docs/SYSTEM-ONTOLOGY.md` §8（**只做**：12 组重复行收口 + 4 行已闭未回写订正 + 2 行无标记补标） | ① 门判据：merge/提交后 §8 任一编号的行数 >1，或任一编号状态从 ✅ 退回 🔴/◑ ⇒ RC=1；金丝雀必须双向（喂 `3ddd98dff` 那次 `G-STEP-VOCAB` 回滚必判红；喂一次正常 ✅→✅ 演进必判绿），且与主逻辑共用同一份实现。② 存量：dedupe 门与 s8-status 门 RC=1→0，收口方式照 WO-ONTO-DEDUPE 口径（留信息最全款，独有内容并入，不丢字）。**验收落在门上**：跑一次正常本体增改必须绿 | **轻** |
| **WO-GATE-ROSTER-SWEEP-3** | `G-GATE-ROSTER-HANDCOPIED` 剩余 7 处 | 接了线接错地方 | `scripts/gate-roster-baseline.json` · 被点名的 7 个门脚本的扫描面常量 | 7 个 roster 键逐处要么改现算、要么同批加「名单 vs 现算」一致性断言；`roster` 债 7→N 且**只降不升**。验收不是门绿，是「往差集里造一处真违规，门必须点名到 file:line」 | **轻** |
| **WO-GATE-SCAN-SURFACE-CENSUS** | `G-GATE-SCOPE-MISSES-SUBJECT` 残留 | 接了线接错地方（射程无自证） | `scripts/` 下全部带扫描面常量的门（普查出来的清单本身也是交付物） | 逐门加「独立口径分母下界」（照 `MIN_LOCALE_LITERALS` 形态：扫描面抽出的总量 < 下界 ⇒ 报「工具坏了」RC=2 而不是 RC=0）；每门下界取值必须**现算过**并写进注释。验收：把某门扫描面改窄 ⇒ 该门必须 RC=2 报工具坏，不是变绿 | **轻** |
| **WO-RATCHET-CONSERVATION-SWEEP** | `G-RATCHET-NEWFILE-BLIND` 残留 18 个基线写入方 | 接了线接错地方（度量单位是文件不是内容） | `scripts/` 18 个基线写入方门 + 各自基线 json | 逐门加 D5 全局守恒 + D6 `unlisted` 落账（照 `check-ui-first-layer.mjs` 同一份判据形态）；验收双向：搬家沙盘（A→B 搬内容）必须**不变绿也不变红**，新文件堆内容不落账必须红 | **轻**（可拆 2 批派） |
| **WO-PRD-GROUNDING-BURNDOWN** | `G-PRD-DATA-UNGROUNDED` 存量 7 条 | 接了线接错地方（判据咬错半） | 基线点名的 5 份 PRD 的判据行文（`PRD-sandbox-redesign` ×2 · `PRD-simulation-sandbox` · `PRD-capacity-live-cockpit` ×2 · `PRD-capacity-inference-completion` · `PRD-lever-binding-drift`） | 7 条逐条：把判据改到「决定成败的那半」真存在的数据关系上，或把缺失的关系补建；每收一条从基线删除（key 锚内容 sha，文案一改豁免自动失效——**不许靠改文案洗白**，判据必须真的可失败）。棘轮只降不升 | **轻** |
| **WO-CAPLIVE-QAPANEL-RETIRE** | `G-CAPACITY-DEAD-BI` 残留 | 接了线接错地方（真假 NL 并列） | `apps/frontend-shell/src/views/RiskBoardView.tsx`（`:1184` 挂载点 + `:1899` `QaPanel` 定义）· 引用它的测试 | 摘掉正则假 NL `QaPanel` 或把它改路由到真 NL（`CapacityLiveDialog` 已在同屏）；判据落在「同屏不再有两个问答入口」+ 剥注释 grep `/客户\|谁/.test` 在该文件 0 命中。⚠ 先查测试咬不咬 QaPanel 文案，咬则同批改测试 | **轻** |

### B · 有前置依赖 / 同文件互斥（排序派）

| 单号 | 断点 | 前置/互斥 | 🚦范围边界 | 验收判据 | 画像 |
|---|---|---|---|---|---|
| **WO-SLICE-REF-REPORTER** | `G-SLICE-REF-PRODUCER-EMPTY` | 旧 handoff `5ebc6cf2f`（08-10）已陈旧，**从当前集成线重开** | `apps/agentcore/src/refs/report.ts`（产出 `kind:"slice"/"plan"` 引用）· `resource-projector.ts` 的 `resolve_slice` 边 → 上报路 · datacore `governance.sliceReferences` 消费端接缝测试 | 断言落在 **DataCore 那一端读得回**：发布一条带 `resolve_slice` 步的 workflow ⇒ `GET /a/v1/ontology/slices/:key/references` 十六层 ①② 不再恒空；变异反证：摘掉上报 ⇒ 当场红 | **中** |
| **WO-SLICE-REQUIRED-ARGS** | `G-SLICE-ROOT-ARGS-UNDISCOVERABLE` | 无 | `app.ts:4281` 摘要投影（加性 `requiredArgs[]`，从 `spec.root.selector` 抽 `{{args.X}}`）· 前端切片列表页徽标 | 契约 additive（缺省 = 逐字节不变）；断言落在「98 条切片里实测 4 条需参的全部带徽标、且不需参的不误标」（抽样种子现算） | **中** |
| **WO-ACTIONTYPE-TARGET-KEY** | `G-ACTIONTYPE-NO-TARGET` | 与 lever-map **同碰 `app.ts domainExecutor` 区域 ⇒ 不并行** | `packages/contracts`（additive `targetTypeKey?`）· `apps/datacore/src/domain.ts` · 94 类 `ObjectTypeDef.actions[]` 回填或显式不填的登记 | 二选一行内已裁过方向（加 `targetTypeKey`）；断言落在「给定一个 ActionType 能反查目标对象类型、且十六层 ⑮ 层取数不再恒空」；未回填的逐类型登记不许静默空 | **中** |
| **WO-DERIVSPEC-SEED** | `G-DERIVSPEC-EMPTY` ⊕ `G-DERIVED-FORMULA-UNVERIFIED` 残口② | 无（与 derived-recompute 门同族，一并做） | `apps/datacore/src/seed.ts`/`synthetic/`（补 `DerivationSpec` 种子）· `ontology.ts runDerivations` 读端对账 | 判据落在「`derivationSpecs.list(ACTIVE)` 三处消费点（`app.ts:2416/3888/5955`）拿到非空且与物化值对得上账」；金丝雀计数断言同批改。若裁定该表不作为证据来源，则改走「显式退役 + 消费点摘除」——两条路都留，dev 按种子可造性自证后选一并写明 why | **中** |
| **WO-AUDIT-TIMELINE-LIVESOURCE** | `G-AUDIT-TIMELINE-HASH-PROJECTION` 数据半 | 无 | `solvers/risk.ts auditTimeline` · A8 时序源（`tsPoints`）· 契约 `AuditTimelineOutputSchema`（additive） | 真时序接入后 `dataMode` 可从 MOCK 升 LIVE；判据落在「同一 kind 的 series 不再由 `hashString(kind)` 派生」（改 kind 名 ⇒ series 不变为红）；无真源的基地保持 MOCK 披露不许冒充 | **中** |
| **WO-YIELD-SERIES-TS-SOURCE** | `G-YIELD-SERIES-SOURCE-MISMATCH` | 无 | `solvers/extended.ts yieldDiagnosis` · A8 `yield:process` 时序（`synthetic/battery.ts` tsGenerators → `generateHistory` 落 `tsPoints`）· 聚合规格 | 判据落在「序列 ≥37 天的基地突变检测循环真进入」（种一个已知断点的时序 ⇒ `breakpoint` 非 undefined）；序列不足的基地保持 `dataMode:EMPTY` 诚实位——**不许把 EMPTY 降级成假 LIVE**（行内警告原样保留为验收） | **中** |
| **WO-SIMSESSION-BIZ-REUSE**（= PRD 里的 WO-LIVE-SCENARIO） | `G-SIMSESSION-NO-BIZ-REUSE` | 无 | `app.ts:1806-2212` SimSession 路由（补 PAUSED/ENDED 迁移）· 业务推演页（capacity/GlobalSim/ProjectSim 之一先接）· `views/sim/**` 不动 | ① PAUSED/ENDED 至少各有一条真实置位路径（迁移动作进路由，契约枚举不再是死值）；② 至少一个业务推演页的 solve-mode 真走 SimSession（接缝测：从该页发起 ⇒ `repos.sim.putSession` 被调）；不碰 `useLiveSolver` 同步路 | **中/重** |
| **WO-GRAPH-FANOUT-W2** | `G-SERIAL-GRAPH-EXECUTION` ⊕ `G-SKILL-GRAPH-NO-RENDER-CLOSURE` | 两条同属 PRD-skill-runtime-orchestrator §9 W2，**一个 dev 整单做** | `workflow/executor.ts`（串行 → 接 `GraphScheduler` 拓扑层）· `router/multi-route.ts` 与 Coordinator 扇出的收编或显式分工登记 · `skill-graph.ts` render 节点实现 + R11 可达性校验 · 新门 `graph-runtime:check` | ① render 节点实现后 `compileGraph` 强制「入口到 render 可达」，不可达 ⇒ 拒发并点名；② 门落在「无 render 收口的图编译不过」；③ 三处既有扇出逐处给「收编/保留并写明分工」的登记，不许默认并存 | **重**（agentcore 全量） |
| **WO-INTERFACE-ADMIN-UI** | `G-NO-INTERFACE` 残口① | 无 | `apps/frontend-shell/src/pages/admin/**`（新 Interface 管理台）· 对接 `object_interfaces` 的 CRUD/发布门反馈 | 判据落在「管理台能建/改/发一个 ObjectInterface 且不合规实现被 `assertInterfaceConformance` 拒时屏上点名到属性」；grep 自证：交付后 `ObjectInterface` 前端命中 >0 | **中** |
| **WO-INTERFACE-ACTIONTYPE-DEEPVAL** | `G-NO-INTERFACE` 残口② | 与 WO-ACTIONTYPE-TARGET-KEY 同碰 `domain.ts` ⇒ **串行** | `apps/datacore/src/ontology.ts publishVersion` 的 `assertInterfaceConformance` · ActionType 绑定深校验 | 判据落在「接口声明的 ActionType 未注册/签名不符 ⇒ 发布拒并点名」；变异反证：摘掉校验 ⇒ 红 | **中** |
| **WO-PROCESS-TICK-EDGES-3** | `G-PROCESS-TICK-COVERAGE` 剩余 18 条（有对象无入边） | 无；**不含** 7 条零物化（动 94 金值）与 EquipmentOEE 边（等裁决，见五） | `apps/datacore/src/seed.ts` `DEMO_PROPAGATION_RULES` · `process-tick-coverage.seam.test.ts` 计数断言 | 逐条枚举的 18 条按「真有因果才补」原则补入边；覆盖率 29/65→N 且 §B2 红线（D01/D02/D04 整域 `NOT_TICK_DRIVEN`）保持绿；每补一条写明业务因果 why，硬造边 = 退单 | **中** |
| **WO-COLUMN-SECURITY-SOLVER-SWEEP** | `G-SECURITY-COLUMN-LEVEL` 残口① | 重画像，与 datacore gate 串行 | `solvers/service.ts` 早返回 ~30 个求解器（`gapAttribution` 已坐实 `:1658` 直读）· `loadContext` 投影路 | 早返回求解器逐个改经 `loadContext`（列级投影生效）或登记「不读用户态属性」的豁免（逐条 why）；判据：给一个角色配 `denyRead: [Order.unitPrice]` ⇒ `gap_attribution` 输出不再含 unitPrice（今天含） | **重** |
| **WO-SOLVER-SCOPE-SWEEP-2** | `G-SOLVER-SCOPE-DEAF` 剩余 12 处静默 | 重画像；旧 handoff `WO-SOLVER-SCOPE-FE`（08-11）陈旧，从当前集成线重开 | `apps/datacore/src/solvers/**` 剩余静默处（照取证单 §2.2 的 16 处清单减 4 已闭） | 每处三选一：真消费 scope 实参 / 诚实兜底（`dataMode` 披露）/ 显式拒绝（400）；判据落在「只给 base 不给 factor 这类半参数输入不再静默扩域」，变异反证照 `risk_timeline` 那轮形态 | **重** |
| **WO-UI-LAYERING-BURNDOWN** | `G-UI-FIRSTLAYER-OVERLOAD` 存量 | 无（可与任何单并行，前端逐页） | `apps/frontend-shell/src/views/**`（按 `AUDIT-ui-first-layer-density.md` 最差页先降：`RiskBoardView` 227 块起）· `ui-first-layer` 基线 | 逐页降层：信息块只移不删（D4 守恒门守）；基线只降不升；每页收工时基线条目现算重写。⚠ 内容总量掉 ⇒ 门红，「删内容冒充分层」此路不通 | **中**（可拆 2-3 页/批） |
| **WO-PRD-FIELD-AUDIT-REOPEN** | `G-PRD-DATA-UNGROUNDED` 的 80 份清册 | 旧 handoff `8ed7727b6`（08-11）**陈旧 ⇒ 从当前集成线重开**，先 diff 旧分支有无可救内容 | `docs/` 全量 PRD（只读）· 产出 `docs/AUDIT-prd-field-audit.md` + 基线逐条 `kind` 标注 | 80 份「零数据前置讨论」逐份定性（真缺口/误报/覆盖不到三态）；产出并入 `prd-data-grounding-baseline.json`，每条带 why。**不许照描述猜**，逐份打开看过才算数 | **轻** |

### C · 等裁决（不可派，裁决点收敛成一句话）

| 断点 | 裁决点（一句话） | 裁决后即可派 |
|---|---|---|
| `G-SLICE16-TWO-VOCABS` | 仓主提供 B 集出处 S7 原文档（仓里没有，猜即造假） | 对账单 |
| `G-7` | LLM 用途枚举扩不扩、怎么扩（PRD P5） | 契约扩展单 |
| `G-RULE-SCOPE-NO-CARRIER-C31` | 补建 `Outsource` 承载类型（动 94 类型金值）**还是**退役这条 BLOCK 级外协质量门规则 | 二选一，裁完即派 |
| `G-RULE-SCOPE-CATEGORY-ERROR-C10` | 给行动/场景要素另立作用域维度（本体结构改动）**还是**退役该规则 | 同上 |
| `G-ONTOLOGY-INVARIANT-ENFORCEMENT-UNDECIDED` ① | 第三类边违反时拦什么：阻断发布 / 阻断采纳 / 只标红（今天恒 `ANNOTATE_ONLY`，改一个常量即生效） | 接线单（轻）+ 接缝测 |
| `G-ONTOLOGY-INVARIANT-ENFORCEMENT-UNDECIDED` ② | 容差/停用落不落库（落库须先答：谁能改/要不要会签/历史结论算不算数） | 治理设计单 |
| `G-PROCESS-TICK-COVERAGE` 尾巴 | EquipmentOEE 一条边 = +5460 链路实例（链路表翻倍）值不值；7 条零物化流程要动 94 类型金值动不动 | 裁完并进 WO-PROCESS-TICK-EDGES-3 |
| `G-SPLITACCOUNT-PROMISE-ONLY` B-2 | 3 个面板 0 个有对位实现，补不补（产品判断，第一版已列，仍在等） | 裁完定 |

---

## 五 · 「可立刻并行派」清单（调度方直接拿）

| 画像 | 可立刻派 | 单号 |
|---|---|---|
| **轻**（不设限） | **7 张** | `WO-ONTO-S8-MERGE-GUARD` · `WO-GATE-ROSTER-SWEEP-3` · `WO-GATE-SCAN-SURFACE-CENSUS` · `WO-RATCHET-CONSERVATION-SWEEP` · `WO-PRD-GROUNDING-BURNDOWN` · `WO-CAPLIVE-QAPANEL-RETIRE` · `WO-PRD-FIELD-AUDIT-REOPEN` |
| **中**（2–3 并发） | **先派 3 张**：`WO-SLICE-REF-REPORTER` · `WO-SLICE-REQUIRED-ARGS` · `WO-INTERFACE-ADMIN-UI`；其余中单靠前排 | `WO-ACTIONTYPE-TARGET-KEY`（等 lever-map 收）· `WO-DERIVSPEC-SEED` · `WO-AUDIT-TIMELINE-LIVESOURCE` · `WO-YIELD-SERIES-TS-SOURCE` · `WO-SIMSESSION-BIZ-REUSE` · `WO-PROCESS-TICK-EDGES-3` · `WO-UI-LAYERING-BURNDOWN` |
| **重**（≤1，gate 跑着为 0） | **0–1 张** | `WO-GRAPH-FANOUT-W2` · `WO-COLUMN-SECURITY-SOLVER-SWEEP` · `WO-SOLVER-SCOPE-SWEEP-2`（三张互斥排队） |

⚠ 并行约束：`WO-ONTO-S8-MERGE-GUARD` 改 `docs/SYSTEM-ONTOLOGY.md` 与任何本体回写单**串行**；
`WO-ACTIONTYPE-TARGET-KEY` 与在跑的 lever-map 同碰 `app.ts` 执行器区域，**等它收编再派**；
`WO-INTERFACE-ACTIONTYPE-DEEPVAL` 与 `WO-ACTIONTYPE-TARGET-KEY` 同碰 `domain.ts`，**串行**。

---

## 六 · 本单没做的 + 差什么

1. **没跑任何测试套件 / build**（轻画像铁规）。所有「仍成立」证据 = 读到调用点的条件 + 门脚本存在性/只读门实跑（dedupe、s8-status、gate-exit-discipline 三道只读门实跑了 RC），没有亲手把任何一条业务链跑一遍。
2. **§8 一个字没改**——4 行「已闭未回写」与 12 组重复行的收口全部留给 `WO-ONTO-S8-MERGE-GUARD`（本单若顺手改了，「状态只许前进」门就没有第一笔真账可守）。
3. **N15 的「4/16 已闭」只复核了最危险的 `risk_timeline` 一处**（坐实），其余 3 处（`kit_readiness` 等）照状态列描述采信、未逐个追代码——若 WO-SOLVER-SCOPE-SWEEP-2 开工，第一件事是把 16 处清单逐个重新定性，不许照抄。
4. **N24 的 29/65 与 36 条分解照状态列 + 种子计数采信**，`process-tick-coverage.seam.test.ts` 没实跑（重画像）。
5. **三道在跑单的内容边界没有核**（lever-map / dependson-cover / browser-harness / fact-usage 的工单原文没重读），「不重复派」的判断基于 §8 行内引用 + agent 名册；若某单实际范围小于其名，差额会漏——收编时对账即可发现，风险可接受。
6. **`G-GATE-RC1-MASQUERADE`（N21）我判「无可派」**：残留是 node 链接期结构性边界；若仓主认为该上「每门子进程化」，那是另一张平台级单，本单未列。
7. 两道只读门今天红在集成线上这件事（dedupe / s8-status），本单只记账与派单，**没有去查「为什么红着没人收」的调度层原因**——那超出断点分诊范围。
