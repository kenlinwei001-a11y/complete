# 审计 · 求解器算数，agent 只编排 · 2026-09-08 · base=f7f4a00d

> **被审的原则**（仓主 2026-09-08）：
> 「所有计算原则上使用**求解器**而不是 agent(LLM) 来计算，agent 只负责调动工具、本体、规则等等
> 输出结果，然后基于结果推演，形成多个方案和方案比对。」
>
> **可机器核查的判据**：凡打到用户屏上的每一个数，都必须能追到「某个求解器的输出」或「本体里的一个真值」。
> 任何由 agent(LLM) 自己算出来的数 = 红。

**本文只报不修**：一行产品源码未改，本体/台账记号未动。

---

## 金丝雀（两个都对才往下读）

| # | 量法 | 样例 | 期望 | 实测 |
|---|---|---|---|---|
| C1 正例 | `grep "llm.parseStructured\|llm.compose(\|llm.classify("` 于 `apps/datacore/src`（排除 `llm.ts`/`llmproviders.ts`） | 必中 | >0 | **5** |
| C1 正例 | 同上于 `apps/agentcore/src`（排除 `llm/` 目录） | 必中 | >0 | **8** |
| C2 反例 | 同一把量法于 `apps/datacore/src/solvers/**`，**排除** `llm-gen.ts` | 必不中 | 0 | **0** |
| C2 自证 | 同一把量法于 `apps/datacore/src/solvers/**`，**含** `llm-gen.ts` | 证明量法在这个目录里看得见 LLM | >0 | **1** |
| C3 消费方量法 | `capacity_forecast` / `chain_loss_attribution` / `supply_vulnerability` / `zzz_not_a_real_solver` 在求解器目录外的命中 | 前三非 0、末一为 0 | — | **239 / 80 / 3 / 0** |

C2 的两行合起来才有意义：单看「0 命中」分不出「求解器目录干净」与「量法在这个目录里瞎了」。
C3 末行是反向自证：不存在的 key 必须报 0，报了非 0 说明量法在乱匹配。

---

## 判定摘要

> **一句话**：**求解侧合规，编排侧有漏**——63 个求解器全部零 LLM、全部有消费方；
> 但 agent 写出来的**答案正文**里的数，今天**只标注、不阻断**，且**主路（QOS path-B）连"若阻断会拦下多少"这个计数都没记**；
> 判断「这个数是不是编的」的实现**同时存在三份**，两份不共用判据。

**求解器产的数 N = 63 个内置求解器 key**（+ LLM 生成的 PROVISIONAL 临时求解器，租户级不定数）
· **agent 可产数并上屏的路径 M = 10 条**（A 段：**默认无门可达 3 条** · 有条件可达 3 条 · 暗发关 3 条 · 无数据 1 条）
· **双来源冲突 K = 4 处**（C 段，全部为「无任何机制比对」，**不是**「实测数字对不上」——本单未起服务）

**一句最要害的话**：`util/numerics.ts` 里那段注释写着「原生路刻意不设此拦——只统计
`numericRedline{action:"would_block"}`，收不收紧是产品裁决」。
**实测这个统计打在 `engine.ts:runRegisteredAgent`（437–939 行）的出口上；
而 QOS 通用 path-B 走的是 `orchestrator.ts:runPathB` 直调 `runAgentLoop`，根本不经这个方法。**
（`runAgentLoop(` 全仓只有 **2** 个调用点：`engine.ts` 与 `router/orchestrator.ts`；
金丝雀：同一把量法看得见 `acceptFinalAnswer(` 的 2 处引用。）
⇒ **最容易出裸数的那条路，既不拦、也不计。**
形态照铁律 0.6 句式：
> **「我用『我在 engine 出口记了 would_block』当作『我知道主路有多少裸数』的证据，而前者并不度量后者。」**

「先拿数再定收不收紧」这个裁决所依据的那个数，在最需要它的那条路上恒为 0。

---

## A · 违反原则的位置（agent 自己算了数，且这个数上了屏）

⚠ **「严重度」与「今天可达吗」分成两列，不许合并** —— 合并就会犯本仓 `features.ts` 那条注释点名的病：
「**『我以为暗发了』和『它真的关着』是两个命题**」。缺陷本身有多重，与它今天会不会发生，是两个量。

| # | 路径（file:符号） | 这个数是什么 | 它怎么被算出来的 | 它上到屏上的哪里 | 严重度 | 今天可达吗（代码层判定） |
|---|---|---|---|---|---|---|
| A1 | `agent/loop.ts:acceptFinalAnswer` ← `router/orchestrator.ts:runPathB`（**直调** `runAgentLoop`） | final_answer 正文里的任意业务数字 | 模型自撰。`scanBlocks` 扫到裸数**只置 `unverifiedNumerics:true` + `metrics.unverifiedNumerics.inc`，仍 `ok:true`** | `answer.final` → `AnswerCard`，顶部琥珀条 + 正文原样显示 | **高** | ✅ **默认可达**：`outOfCatalog`（分类没命中意图）即无门直落 `runPathB` |
| A2 | 同 A1，**观测面** | ——（不是数，是"有多少这样的数"） | `numericRedline{path:"AGENT_NATIVE",action:"would_block"}` 打在 `engine.ts:runRegisteredAgent`（437–939）出口；**`runPathB` 不经该方法** | 不上屏，但它是「收不收紧」这个产品裁决的唯一依据 | **高** | ✅ **默认可达**（= A1 那条路每次都漏计） |
| A3 | `router/coordinator.ts:synthesize` | 各角色 agent 答文里的数字，逐字拼进汇总块 | 由各角色 agent 自撰；`synthesize` **硬写 `unverifiedNumerics:false` + `provenance:[]`**，不扫 | 多角色协调答案；**琥珀条被这行硬写关掉了** | **高** | ◑ 暗发关：`agent.coordinator` `defaultOn:false` 且在 `QOS_DARK_LAUNCH_FEATURES` |
| A4 | `router/execute-plan.ts:scanUnverified`（**私有**实现） | 组合路径「综合」步正文里的数字 | LLM `compose` 自撰；判据**另抄一份**（`/\d/` 全量，与 `util/numerics.ts:hasUnverifiedNumerics` 不是同一份实现）；只标不断 | 组合路径答案 | **中**（判据分裂 ⇒ 两路的数不可比） | ◑ 暗发关：`qos.compose-path` `defaultOn:false` |
| A5 | `agent/loop.ts:acceptFinalAnswer` 的 `opts.expectsSchema` 分支 | 结构化产出里**自由文本字段**（如 `AgentProposalDraft.rationale`）中的数字 | 模型自撰；该分支**提前 return**，`unverifiedNumerics` 硬写 `false`，`structured` 从不过 `scanBlocks` | 凡渲染 `structured` 的界面（方案卡的理由行） | **中** | ✅ 可达：workflow `invoke_agent` 带 `expectsSchema` 的步走这条；提案路另有暗发门 |
| A6 | `router/l2-decompose.ts:mergeSlotFloor` | 求解器**入参**（`demandDelta` / `weeks` 等 number 槽） | 确定性底座只填空白，**冲突时 LLM 赢**（注释原文）；LLM 抽的数直接成为 solver args | 屏上的数是 solver 算的（合规），但**前提是 LLM 给的，且无留痕对比** | **中** | ✅ **默认可达**：`orchestrator` 主链路两处调用（多意图选型 + `proceedWithIntent` 前） |
| A7 | `synthetic/service.ts:resolveTemplate` | 未知行业的整张 `IndustryTemplate`（含各类数值区间） | 非 `battery-manufacturing` 行业 → `llm.parseStructured(IndustryTemplateSchema)` **直接返回并落库使用**；记 `source:"LLM"` 但**无人工闸** | 该租户全部合成对象 → 求解器 → 屏上一切读数 | **中** | ◑ 仅非 battery 行业；demo 走硬编码 `BATTERY_TEMPLATE` 早返回 |
| A8 | `solvers/llm-gen.ts:generateSolverDraft` → `solvers/service.ts:generateProvisionalSolver` | 临时求解器**的公式本身** | LLM 写 `computeSource` → 冻结(hash+版本) → 接地校验(`checkGrounding`) → 沙箱跑通 → `PROVISIONAL/UNVERIFIED` | 输出强标 `__provisional{origin,status,trustLevel}`；写真值需人工晋升 `GOVERNED` | **低**（运行期确定性 + 强标 + 写闸；但公式作者是 LLM） | ✅ 可达：`SolverReviewPage.tsx` → `endpoints.ts` → `app.ts` → service，四层全通 |
| A9 | `agent/production-cognition.ts:llmRollingSummarizer`（经 `orchestrator.ts:makeLlmRollingSummarizer` 注入） | 折叠轮次的「前情摘要」里复述的关键数字 | LLM 复述；提示词写「只复述、不新造」，**无机器校验**；摘要回灌进后续推理上下文 | 不直接上屏，但**污染后续答案里的数** | **中** | ◑ 需 `llmSettings.providerAvailable("compose")` 为真；否则退确定性 `defaultRollingSummary` |
| A10 | `workflow/executor.ts` `case "llm_compose"` → `render_answer` 文本块 | 工作流综合文本里的数字 | LLM `compose`；`renderAnswer` **会**用共享 `scanBlocks` 扫（这点合规），但 `trustLevel` 仍是 `VERIFIED_WORKFLOW` | 绿色「已验证」徽标下的 LLM 散文 | **低** | ❌ **无数据**：已发布 workflow 定义零处用 `llm_compose`（见 D 段金丝雀） |

**M 的口径**：10 条路径中，**默认无门可达 3 条**（A1/A2/A6）· **有条件可达 3 条**（A5/A8，以及 A9 视 provider）·
**暗发关 3 条**（A3/A4/A7）· **无数据 1 条**（A10）。

### A 段最要害的两条，展开

**A1/A2 —— 「只报不断」在主路上退化成「不报也不断」**
`util/numerics.ts` 顶部那段注释是本仓少见的诚实自述，它说清了三件事：
① `provenancePolicy=required` 查的是 `provenance.length === 0`，**一条 provenance + 十个编造数字照过**，它不度量数字红线；
② dsh 路（`dsh-runtime/reassemble.ts`）**无条件阻断**，复用同一份 `scanBlocks`；
③ 原生路**刻意不拦**，先只统计 `would_block`，收不收紧是产品裁决。

前两条实测属实，第三条**只对经 `runRegisteredAgent` 的那几条路成立**。
实测 `runRegisteredAgent` 的调用方共 5 处（`propose-candidates` · `skill-probe` ·
`orchestrator` 的角色 agent 路 · `orchestrator` 的 Coordinator 扇出 · `engine` 的嵌套 `invoke_agent`）——
**通用自由探索 path-B 一处都不在里面**。它才是「真开放题」的落点，也是最容易出裸数的那条。

**A3 —— 硬写的诚实位**
`coordinator.synthesize` 把各角色 agent 的 `answerText` **逐字**拼进 markdown 块，
然后返回 `unverifiedNumerics: false`。这一位不是量出来的，是**断言**出来的。
性质比 A1 更差：A1 至少还亮琥珀条，A3 把琥珀条**关掉**了 ——
「没有未溯源数字」与「没人去看有没有」在屏上一模一样。
（今天此路暗发关，所以**严重度高、可达性低**；`agent.coordinator` 一旦翻开，这条立刻生效。）

**A6 —— 唯一一条「合规的数，可疑的前提」**
它和 A1–A5 不同类：屏上那个数**确实**是求解器算的，追得到出处。
问题在**入参**：`mergeSlotFloor` 的注释原文是
「底座只填空白，**冲突时 LLM 赢**（它有语义）」，
接线点是 `orchestrator.proceedWithIntent`（其自注：「**所有** path-A 绑定的必经之路」）。

⚠ 不许把这条说过头 —— `#108` 的**底座回落**是真的存在的（`slots.ts:fillSlots` 第 ①.c 段）：
LLM 给的值**校验不过**时（解析不到 / 不合法）会改用底座值。所以「LLM 全面压过确定性」是错的说法。
**真正的缺口窄得多，也因此更难看见**：对 `number` 槽（`demandDelta` / `weeks`），
LLM 给一个**合法但不对**的数（问句写「10%」而它抽成 `20`）会在第 ① 步直接通过，
底座回落**根本轮不到跑**；`noteResolution` 记的是**胜者**，不记「两个抽取器当时给的不是同一个值」。
⇒ 求解器忠实地算了一道**可能不是用户问的那道**题，而屏上一切看起来都可溯源。

判据一句话：**可溯源 ≠ 问对了题。**
（这也正是「对照实验」判据能抓、而三分法抓不到的那一格：链路通、数字有出处、值却错。）

---

## B · 求解器清单（合规的）

**63 个内置 `SOLVER_KEYS`，全部零 LLM**（金丝雀 C2 已证量法有效）。
`solvers/taxonomy.ts` 的 `SOLVER_CATEGORY_MAP` 实测也是 **63 条**（`Record<SolverKey,…>` 缺键即 `tsc` 红，
这是本仓「机器先说话」做对的一处）。
⚠ 该文件头注释仍写「59 条·一条不漏」—— **数字过期，机制没坏**（类型约束仍在守）。本单不改。

**消费方分布**（量法：solver key 字面串在 `apps/*/src` + `packages/contracts/src` 的命中，排除 `apps/datacore/src/solvers/`；金丝雀见 C3）：

| 消费方形态 | solver 数 | 说明 |
|---|---|---|
| 前端有固定消费方（`apps/frontend-shell/src` 非 `mocks/`） | **48** | 视图 / 卡片 / KPI 直读 |
| 仅 `mocks/`（msw fixture 里有、真前端没有） | **1** | `selection_optimize` |
| **前端零引用**，只在后端 + 求解器目录 | **14** | 见下 |
| 零消费方（含 catalog/mock 也没有） | **0** | ✅ 无死求解器 |
| 合计 | **63** | |

抽验（同一把量法）：`set_cover` → `views/OptimizeWhatifView.tsx` 4 处（真前端，非 mock）；
金丝雀 `capacity_forecast` → 前端非 mock **34** 处；`capacity_ledger` → 前端**全部** **0** 处。

前端零引用的 14 个：`capacity_ledger` · `cert_schedule` · `lta_gap` · `yield_diagnosis` ·
`maintenance_stagger` · `outsourcing_split` · `carbon_footprint` · `countermeasure_combo` ·
`supply_vulnerability` · `assignment_optimize` · `sequencing_optimize` · `packing_optimize` ·
`job_shop_schedule` · `ontology_query`。

**这不等于死代码**：它们全部登记在 `apps/datacore/src/catalog.ts`（求解器目录，带
`answersQuestions`/`tags`），agent 经 `discover` → `invoke_solver` 可达，
`apps/agentcore/src/mocks/solver-registry.ts` 头注释也自述「求解器全集 **63 条**·取自真实注册表返回」。
判定：**接了线，走 agent 编排路可达，无固定屏位**。

**求解器→屏的产地也各自自报**：`solvers/capacity.ts` 里白纸黑字 `agentInvolved: false`
（`sim-proposal.ts` 契约头注释引用的正是这一处），
`solvers/service.ts` 对临时求解器输出强标 `__provisional`。

---

## C · 双来源冲突

「同一个业务量，求解器有一份、agent 又自己算了一份」——本仓 **4 处结构性双来源**。
⚠ 「两者对得上吗」一列**不是实测数字比对**（本单画像=轻，未起服务）：
实测的是**有没有任何机制在比对**，答案一律是「没有」。

| # | 业务量 | 求解器那份 | agent 那份 | 两者对得上吗（实测的是"有没有人在比"） |
|---|---|---|---|---|
| C-1 | 组合路径每一步 solver 的**核心标量**（`thresholdQty` / `capWanP90` / `gap` / `mainBottleneck` …） | `execute-plan.ts:coreScalars` 从 solver 产物**直接取值**，确定性兜底路径原样内嵌 | LLM `compose` 综合时**复述**这些数进散文 | **无人比对。** LLM 成功时兜底不跑；`scanUnverified` 只判「有没有裸数」，**不判「这个数等不等于 `coreScalars` 里那个」** |
| C-2 | path-B 答案正文里每个标了 `⟦ref:N⟧` 的数 | `provenance[N]` 指向的那次 `invoke_solver` 审计产物 | 模型写在正文里的那个数字 | **无人比对。** `reflect.ts:refsWithinRange` 只校验 **N 落在 `[0,provenanceCount)`**；`⟦ref:3⟧` 后面跟任何数字都过 |
| C-3 | 多角色协调答案里的各域数字 | 各角色 agent 自己调的 solver 输出（有审计） | `coordinator.synthesize` 逐字拼进来的角色答文 | **无人比对，且诚实位被硬写为 false**（A3） |
| C-4 | 跨轮上下文里的「已确认关键事实」数字 | 原始 tool 结果（在 `repos.toolCalls` 审计里） | `llmRollingSummarizer` 蒸馏出的 180 字摘要里的复述值 | **无人比对。** 提示词写「只复述、不新造、不四舍五入编造」——**注释/提示词说的不度量真实**（铁律 1.5 判据四同源） |

**唯一一处结构性堵死双来源的地方**（正面样例，值得当模板）：
`packages/contracts/src/sim-proposal.ts` + `datacore/src/sim/agent-proposal.ts` +
`agentcore/src/sim/propose-candidates.ts` —— `AgentProposalDraft` 的 schema 里
**没有任何能当数值用的格**，agent 只能回 `leverIndex`/`valueIndex` 下标，
数值全在确定性侧产的 `ProposalMenu` 里，`resolveProposalToLevers` 是纯函数、下标越界即抛。
且「不许产数」不靠提示词，靠 `expectsSchema` 下发的 JSON-Schema —— **两条臂都 fail-closed 校验**。
⚠ 唯一残口就是 A5：`rationale` 是自由文本，`expectsSchema` 分支不扫。

---

## D · agent 调工具/本体/规则这条路的三态判定

**结论：这条路是真接了线的，不是「拿到一段文本自己凑数」。** 逐项：

| 能力 | 三态判定 | 证据（调用点 + 触发条件） |
|---|---|---|
| **调求解器** | ✅ **接了线，有数据，接对地方** | `tools/registry.ts` 声明 `invoke_solver` → `tools/executor.ts` `case "invoke_solver"` → `dataCore.solver.invoke` → `tools/datacore-http.ts` `POST /a/v1/solvers/{key}/invoke`（OBO 透传）。触发条件：模型选择该工具；且 system prompt 的【求解纪律】强制排产/优化/可行性类必须调 |
| **调规则** | ✅ **接了线，有数据** | `tools/executor.ts` `case "evaluate_rules"` → `dataCore.rules.evaluate(ctx, ruleIds \| "ALL_APPLICABLE", payload)` |
| **调本体（遍历/聚合）** | ✅ **接了线，接对地方** | `case "query_ontology"` → **复用** `solver.invoke(ctx,"ontology_query",…)`（零重写）；另有 `query_objects` / `get_object` / `aggregate_objects`（`aggregate_objects` 走 contracts 强校验、聚合下推） |
| **调本体元模型（自我认知）** | ✅ **接了线** | `query_system_ontology` / `get_breakpoint` / `impact_of` → `dataCore.ontology.queryMetaOntology` / `getMetaBreakpoint` / `metaImpact` |
| **求解纪律的硬闸（reflect）** | ◑ **接了线，默认关** | `reflect.ts:reflectAnswer` 判据④「排产/优化/可行性题未调过对口 solver ⇒ 不过关」是真的；但 `orchestrator.ts:reflectEnabled` = **`set==="ALL"` → false，仅显式含 `agent.critic` 才开**。关 ⇒ 求解纪律只剩 system prompt 那层软约束 |
| **数字红线的硬闸（阻断）** | ◑ **接了线，接错地方** | 无条件阻断只在 `dsh-runtime/reassemble.ts`（`NUMERIC_REDLINE_CODE`）；而 dsh 分叉条件是 `agent.kernel==="EXTERNAL" \|\| process.env.DSH_HARNESS==="1"`（`engine.ts`），实测 `config.ts` 里 `DSH_HARNESS: z.string().default("0")` ⇒ **默认走原生路，唯一会阻断的那条内核默认关着** |
| **交叉验证（答案 vs 知识图谱）** | ◑ **接了线，接错地方** | `workflow/executor.ts` 里 `deps.crossValidate` 真调 `dataCore.ontology.crossValidate`，但校验的是**切片对象的标量属性**；path-B / 组合路径的 `crossValidation` 一律硬写 `{claims:[],verdict:"NO_CLAIMS"}`（`orchestrator.ts` / `execute-plan.ts`）—— **答案里的数从来不进这条校验** |
| **agent 出方案 · 求解器出数（A→B 闭环）** | ◑ **接了线、无数据（暗发关）** | 路由 `POST /a/v1/sim/optimize-pareto/propose` → `httpProposerClient` → agentcore `POST /b/v1/sim/propose-candidates` → `proposeCandidates` 全线存在；但 `features.ts` 里 `sim.agent-proposals` = `defaultOn:false` **且列入 `INCOMPLETE_DATA_DARK_LAUNCH_FEATURES`**，前端零调用方（`grep "optimize-pareto/propose\|by-proposal" apps/frontend-shell/src` = **0**；金丝雀：同目录 `optimize-pareto` = **13** ⇒ 量法没瞎）。缺 `AGENTCORE_BASE_URL`+`SERVICE_TOKEN` 时落确定性兜底，回包明写 `agentInvolved:false` + 原因（`noAgentProvenance`）—— **这条诚实做得对** |
| **workflow `llm_compose` 步** | ◑ **接了线、无数据** | `workflow/executor.ts` `case "llm_compose"` 实现完整；但**全仓已发布 workflow 定义里零处使用**。金丝雀：同一把量法在 `apps/agentcore/src/mocks/seed.ts` 数到 `invoke_solver` **10** 处、`render_answer` **13** 处、`llm_compose` **0** 处 |
| **A18.2 LLM 生成临时求解器** | ✅ **接了线，有数据，全链可达** | `SolverReviewPage.tsx` → `endpoints.ts:generateProvisionalSolver` → `app.ts` → `solvers/service.ts:generateProvisionalSolver` → `llm-gen.ts:generateSolverDraft`（唯一 src 链，逐层追到底） |

**软约束这一层是到位的**（不能当硬闸，但不该抹杀）：
`agent/prompts.ts:AGENT_SYSTEM_CORE` 明写【数字红线】「每一个业务数字都必须来自本轮工具结果，
并用 ⟦ref:N⟧ 标注……禁止估算、推断或从记忆中给出数字」，
【求解纪律】「禁止你自己心算或估算，必须调对口 solver……你只负责把 solver 的结果解释成决策语言」。
`l2-decompose.ts` 的分解提示词更狠：「你**只做分解/选型**——绝不推理、绝不算数、绝不产生任何数字或参数值」，
且 `parseSolverPlan` **只保留 `solverKey`/`intentKey` 两个字符串字段，LLM 混进来的 args/数值一律不解析**
—— 这是 A 段之外的**正面样例**：把「不许产数」做成了解析器丢弃，而不是提示词祈使。

---

## E · 我发现但没改的问题

1. **第四态（接对了、跑通了、算错了）—— 铁律 1.5 那条边今天仍开着。**
   实测：`grep -c "bomUnit\|BOMDetail\|bomQty" apps/datacore/src/sim/propagation.ts` = **0**，
   同文件 `coefficient` = **8**。`coefficientRef` 在 `apps/datacore/src/seed.ts` 里**逐条为 `null`**
   （42 条传导边全部内联回落），`synthetic/battery.ts` 自己的注释也写着
   「本仓 42 条传导边的 `coefficientRef` 实测 0 条在用、全部回落内联，引用机制形同虚设」。
   ⇒ 「碳酸锂与铝箔各涨 15% 产生相同成本压力」这个对照实验今天仍会失败。
   **这不是 agent 的问题，是求解侧的问题**，但它同样违反「屏上的数要能追到真值」。

2. **数字红线的判据今天有三份实现，两份不共用。**
   ① `util/numerics.ts:hasUnverifiedNumerics`（剔 `⟦ref⟧` 句 + 剔 ISO 日期 + 单位白名单）——原生路 / dsh 路 / workflow 渲染共用；
   ② `execute-plan.ts:scanUnverified`（剔 `⟦…⟧` 后 `/\d/` 全量）——组合路径私有；
   ③ `coordinator.ts:synthesize` / `multi-route.ts` / `opt-whatif-route.ts` / `orchestrator.ts` 多处**硬写 `false`**，等于第三种「判据」。
   本仓 CLAUDE.md 铁律 0.6 已经写过同形态的账：「门脚本里的金丝雀必须与主逻辑共用同一份实现，
   不许各抄一份正则——抄了就是装饰品」。这里抄的不是金丝雀，是主判据本身，后果一样：
   **两路的 `unverifiedNumerics` 直接不可比，而 `metrics` 把它们记进同一个计数器。**

3. **`solvers/taxonomy.ts` 头注释写「59 条」，实测 `SOLVER_KEYS` 与 `SOLVER_CATEGORY_MAP` 均为 63 条。**
   机制没坏（`Record<SolverKey,…>` 缺键即红），只是注释数字过期。本单不改（禁令 1 · 记账类）。

4. **`frontend-shell/src/api/endpoints.ts` 与 `SolverReviewPage.tsx` 的注释里写死了
   `service.ts:599` / `:626` / `:545` 三个行号**，实测现为 `:894` / `:876` / `:840`。
   同一份注释自己还写着「📅 复验（2026-08-14 实测，数字有保质期）」——
   正是 CLAUDE.md 铁律 0.5 第 5 条那句「写死行号的引用天生带保质期」的又一实例。本单不改。

5. **`features.ts` 里 `sim.agent-proposals` 那段注释值得单独抄给下一个人看**：
   「初版只写了 `defaultOn:false` 就以为暗发了，实测 `POST /a/v1/sim/optimize-pareto/propose`
   对 demo 租户**返回 200 而不是 404** —— L2 模板『all on』把它无条件抬开了。
   **『我以为暗发了』和『它真的关着』是两个命题。**」
   ⇒ 凡本文里写「暗发·默认关」的门（`reflectEnabled` / `escalationEnabled` /
   `skillOnFreeQaEnabled` / `drilRoutingEnabled` / `reasoningTraceEnabled`），
   **本单只读到了代码里的 `defaultOn`，没有起服务实测某个租户的有效开关值**。
   这一条是我自己量法的边界，先写明，不留白。

---

## 附 · 本单没做的事（边界声明）

- **未起服务、未跑测试套件**（画像=轻）。所有结论来自静态追链 + 金丝雀自证量法。
  凡需要「真起 `SEED_DEMO=1` 后端 + 真前端」才能定的事（C 段四处双来源**实际数字**对不对、
  各 feature 在 demo 租户的**有效**开关值），本文一律标注为未实测，不猜。
- **未改一行产品源码**，未新增门 / 棘轮 / 基线 JSON（仓主禁令 3），
  未动 `SYSTEM-ONTOLOGY.md` / `REQUIREMENTS-TRACE.md` 的记号（禁令 1）。
- **「这条原则将来要不要做成门」不在本单裁决范围。** 若要做，A2 那个缺口
  （path-B 不经 engine 出口 ⇒ `would_block` 不计）是**第一件该先补的事**：
  没有那个数，「收不收紧」这个裁决就没有依据。
