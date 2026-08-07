# PRD 实现状态对账 · 第 1/5 批（22 份）

> **审计口径**：只读代码 + 只写本文件。每条判断必须有 `file:line` 证据；查不出来的诚实写「未查清 + 卡在哪」。
> **禁用判据**（本次事故的直接对策）：文件 mtime / 待办状态 / grep 一次的直接命中数 —— 三者都与"实现与否"是范畴错误。
> **必读判据**：先读 PRD 自己的 AS-IS / 现状 / 已有资产 节，它直接写明什么已在、什么是本 PRD 的真实增量。
>
> **本批覆盖**：`ls docs/PRD-*.md | sed -n '1,22p'` 的 22 份。
> 审计日期：2026-08-07 · 基线 HEAD `8e3e91a6`（分支 wave4）

---

## 0. 工具自证（铁律 0.5 #5，报 0 命中前先证明工具是对的）

本次审计全程用 `grep -rn <sym> apps/*/src packages/*/src`（**shell glob**，不是 `git grep` 的 pathspec —— 后者的 `*` 不跨 `/`，会恒匹配 0 个文件）。
对照符号 `probeMissingRefs` 跑通，返回 4 处命中（`apps/agentcore/src/resources.ts:11` 定义 + `server.ts:64/690/1008` 三处调用），
证明该 glob 形式在本仓可用。**下文任何「0 命中」结论均在此工具前提下成立。**

---

## 1. 逐份对账

### docs/PRD-1to1-README-HANDOFF.md
- **它要做什么**：一份**交付包索引 / 阅读顺序说明**（不是功能 PRD）——把「参考原型全视图 1:1 复刻」的 7 份子 PRD + 1 份横向底座（经营目标-指标-责任闭环 spine）串成阅读与实施顺序，并给出跨 PRD 归一表（防重复建模）与通用 DoD。
- **PRD 自称的 AS-IS**：无独立现状节。但 §2「基线分支说明（重要，已核验）」自称：开发分支 `claude/vigilant-knuth-b1nmxn` 的 `apps/`+`packages/` 与本批 PRD 锚点**字节一致（550=550 文件零差异）**；且该分支「原本没有这些 PRD」，需补两点（把 PRD 放进 `docs/`、用包内 `SYSTEM-ONTOLOGY.md` 覆盖以带上 R15）。
- **实测现状**：
  - 它索引的 8 份子 PRD **全部在仓**：`docs/PRD-reference-views-1to1-roadmap.md` / `PRD-goal-metric-owner-spine.md` / `PRD-aop-annual-scenario-1to1.md` / `PRD-sop-balance-1to1.md` / `PRD-quarter-rolling-1to1.md` / `PRD-plan-audit-1to1.md` / `PRD-plan-generate-1to1.md` / `PRD-order-project-sim-1to1.md` / `PRD-inference-process-enhancement.md`（`ls docs/PRD-*.md` 全表可见）。§2 要求的第 1 点（PRD 入 `docs/`）**已完成**。
  - §2 第 2 点（R15 不变量 + `cli-parity:check` 门）**已落地**：门脚本 `scripts/check-cli-parity.mjs:1-66`、棘轮基线 `scripts/cli-parity-baseline.json`。
  - §6 通用 DoD 里点名的门**都真有脚本**：`scripts/check-debattery.mjs`、`scripts/check-cli-parity.mjs`、`scripts/check-prd-ontology.mjs`、`scripts/check-ontology-anchors.mjs` 等（`ls scripts/*.mjs` 共 40+ 条 check-*）。
  - §5 归一表里点名的对象在码上可查：`plan_generate`（`apps/datacore/src/solvers/plan.ts`）、`audit_timeline`（下见 plan-generate 条目）、`order_fullchain`（见下）。
- **结论**：✅已实现（作为**索引文档**，其自身的两项交付要求都已满足；它索引的子 PRD 的实现状态各自单列，不在本条判定）
- **备注**：本文件是元文档，不产生代码增量；判定口径 = 它自称的两项待补事项是否完成 + 索引指向的文件是否存在。

---

### docs/PRD-A15-cli-universal-operation-shell.md
- **它要做什么**：把只能 `ask` 问句的 CLI 升级为**通用操作外壳**——自然语言 → 意图识别（QUERY/OPERATION）→ 路由到模块 → CLI 内交互补参/确认 → 触发模块 REST；并确立不变量 **R15「CLI 对等」**（每个对外能力必须有 CLI 等价命令或 GUI 深链）+ `cli-parity:check` 门。
- **PRD 自称的 AS-IS**：§2「现状与缺口（file:line）」有表：CLI 基座 `platform-cli.mjs` 已有 login/ask(SSE+多轮澄清)/scenarios/approve/tickets/claim/grow；`orchestrator.classify` 只有查询型；`discover` 未在 CLI 暴露；模块端点齐但无 CLI 子命令；`cmdApprove` 已有但未串进操作流末步。
- **实测现状**（骨架 = 已建；对等 = 假的）：
  - **契约与目录已在**：`packages/contracts/src/operation-intent.ts:53` 定义 `OPERATION_CATALOG`（**39 条**，逐条带 `op/keywords/endpoint/requiredSlots/r4/cliCommand`），`operation-intent.ts:127` 的 `classifyOperation` 做确定性打分路由。
  - **端点已接线**：`apps/agentcore/src/server.ts:2062` `app.post("/b/v1/operations/classify", …)` —— 真端点，非仅测试。
  - **CLI `do`/`shell` 已在**：`scripts/platform-cli.mjs:442` `cmdDo`、`:430` `cmdShell`。
  - **⚠ 但 `do` 不执行操作，只打印**：`platform-cli.mjs:456-464` —— `kind==="OPERATION"` 分支只 `console.log` 出 `cls.endpoint` / 深链 / 「需补参：…（用 \`<cliCommand>\` … 子命令）」，**没有任何 HTTP 调用去触发模块**。即 `do` 是分类器打印器，不是万能执行器。
  - **⚠ 28/39 注册的 `cliCommand` 在 CLI 里根本没有实现**：`platform-cli.mjs:511` 的 `const run = {…}` 调度表只有 22 个键（`login, do, shell, ask, import, model, rule, build, solve, opt, ontology-query, generate, synth, types, resources, scenarios, approve, whoami, tickets, claim, grow, sim`）。差集实测 = `scene-config, agent, workflow, skill, mcp, eval, llm, ops, tenant, catalog, connection, meta, slice, rule-extract, sop, platform-config, validate, metric, notify, config-bundle, boundary, calib, policy, signals, quarantine, features, kb, bootstrap`（28 条）。跑 `platform agent` 会命中 `platform-cli.mjs:512` 的 `未知命令: agent` 并 `process.exit(1)`。
- **结论**：◐部分 —— **框架半（分类端点 + 契约 + do/shell + 门脚本）真做了；对等半（附录 A 覆盖矩阵）只做了 11/39**；且 §7 DoD 里「`do/shell` 能路由并**完成** import/model/rule/solve/synth/build/ask/approve 全套」中的「完成」未实现（只到"提示用哪个子命令"为止）。
- **⚠ PRD 自身陈述与现状不符**：见下 §2「A15-1」——PRD 说门禁「逼实现」，实测该门**结构上永不可能红**。
- **最小 WO 建议**：
  - **WO-A15-FIX-GATE**（先做，2 行改动，最快见效）：🚦范围边界 = 只碰 `scripts/check-cli-parity.mjs` + `scripts/cli-parity-baseline.json`。删掉 `check-cli-parity.mjs:38` 的 `doRouted` 短路（或把它降级为"仅当 `cmdDo` 真会代执行该 op 才算可达"），跑 `node scripts/check-cli-parity.mjs --update` 把当前 28 条缺口写进棘轮基线 → 从此**新增能力不接 CLI 会真红**。
  - **WO-A15-CLI-BREADTH**：🚦范围边界 = 只碰 `scripts/platform-cli.mjs`（+ 必要时 `packages/contracts/src/operation-intent.ts` 的 `uiDeepLink` 字段）。按 ROI 分两档：① 高频 8 条（`agent/workflow/skill/mcp/llm/features/tenant/sop`）补真子命令；② 其余 20 条要么补命令、要么诚实改标 `uiDeepLink`（R15 §3.6 明文允许"深链即已覆盖"，改标不是作弊，**假装有 cliCommand 才是**）。每接一条把基线数字往下棘轮一格。

---

### docs/PRD-A18-provisional-build-closure.md
- **它要做什么**：消灭"建域全 0"——引入**未审核态（PROVISIONAL）**双模闭包：STRICT 维持 HARD 原子闸，PROVISIONAL 把缺口降 ADVISORY 不阻断，全域制品（本体/切片/规则/数据/B栈/求解器）建为可用的未审核件，端到端跑出 `PROVISIONAL_ANSWER`，且**绝不写真值**，人工审核 → `promote` 晋升 `GOVERNED`。含 LLM 临时求解器（生成→冻结→沙箱→注册→跑通自检）。
- **PRD 自称的 AS-IS**：§1「问题清单（= 那次建域"全 0"实证表）」P1–P6 逐行 + §2「现状与根因（file:line）」表：闭包门 `closure.ts` HARD 阻断无双模；`SOLVER_KEYS` 全代码内置无 `origin=LLM`；制品只有 DRAFT/PUBLISHED 无 PROVISIONAL；数据闭包过才物化；无"跑 LLM 任意 JS"的锁死沙箱；终态无 `PROVISIONAL_ANSWER`。
- **实测现状**（几乎逐条落地）：
  - **双模闭包 ✅**：`apps/datacore/src/databuilder/closure.ts:20` `validateClosure(plan, policy, buildMode)`；`:159-169` PROVISIONAL 把 FAILED/MISSING 降 `severity="ADVISORY"`、`blocked=false`，而 `gatePassed` 诚实保留 STRICT 口径（`closure.ts:156` 注释自证）。
  - **终态 ✅**：`packages/contracts/src/storybuildrun.ts:256` `BUILD_VERIFICATION_STATUS` 含 `"PROVISIONAL_ANSWER"`；`apps/datacore/src/databuilder/service.ts:720-723` 未审核域答案终态恒 `PROVISIONAL_ANSWER`。
  - **诚实门（防谎报）✅ 且是真门不是注释**：`apps/datacore/src/databuilder/provisional-honesty.ts:19-20`（终态非 PROVISIONAL_ANSWER 即记违规）、`:28-29`（PROVISIONAL 缺口 severity 必须 ADVISORY）。
  - **LLM 临时求解器全链 ✅**：生成 `apps/datacore/src/solvers/llm-gen.ts`；沙箱 `apps/datacore/src/solvers/sandbox.ts` + `sandbox-runner.mjs`（**独立子进程 + Node 权限模型**，非 `isolated-vm`——PRD §3.2 写的是"默认 isolated-vm；候选独立子进程/容器"，实现取了候选项，属 PRD 允许范围）；注册/晋升 `apps/datacore/src/solvers/service.ts:471 generateProvisionalSolver` / `:525 registerProvisionalSolver` / `:625 promoteSolver`。
  - **写真值门控 ✅**：`solvers/service.ts:602` `canArtifactWriteTruth(art, actorUserId)` —— 静态方法，按 status 判是否可写真值。
  - **端点 ✅**：`apps/datacore/src/app.ts:2749` `POST /a/v1/solvers/generate` · `:2772` `POST /a/v1/solvers/:solverKey/promote` · `:3833` `POST /a/v1/databuilder/runs/:id/promote` · `:3775` `runStory(…, buildMode)`。
  - **事件 ✅**：`apps/datacore/src/databuilder/service.ts:509` 发 `domain.provisional_built`；`apps/agentcore/src/event-subscriptions.ts:94` 有订阅方（不是死事件）。
  - **B 栈单机可见 ✅（有 src 调用方）**：`apps/agentcore/src/tools/datacore-http.ts:319` 传 `buildMode: "PROVISIONAL"`。
  - **沙箱有一条已修的真事故值得记**：`solvers/sandbox.ts:11-30` 注释自证——曾把 `--permission` 写死，Node 20（CLAUDE.md 声明的最低支持版本）上子进程直接 `bad option` 启动失败，**整条沙箱求解器路径在最低支持版本上是死的**；现改为运行时探测开关，两个开关都不可用时 **fail-closed 拒绝执行**（`:29-30`），不静默降级成"无隔离直接跑"。
- **结论**：✅已实现（P1–P6 六条修法在码上都有对应实现与端点；诚实门与写真值门控齐备）
- **未查清**：P1「`producedDatasets>0`」这一行我只核到 `service.ts:510` 有 PROVISIONAL 分支，**没有亲手跑一遍 `runStory(buildMode:PROVISIONAL)` 去数 producedDatasets**，故不敢断言"那张实证表已全部翻绿"。卡在：需起服务 + 跑真建域，属重画像任务，不在本审计（只读）范围内。建议由后续单跑一次 §5 的端到端 6 行验收。

---

### docs/PRD-A3-multihop-slice-completion.md
- **它要做什么**：A3 多跳切片的**收尾余量 + 配套四件**（PRD 开篇即自称"四期在正线已建 3.5/4，本 PRD 只覆盖余量，不重建已有"）。两张工单：WO-A3-REFBASE（元租户 14 域参考本体基线 ≈95 节点）+ WO-A3-SUITE（切片约束一等化 / QOS 动态切片深接 / 切片库可视面 / SHAPE 门扩）。
- **PRD 自称的 AS-IS**：§1「背景(正线现状·全有码为证)」表逐行：A3.1 注册表 ✅ 但缺参考基线；A3.2 两库 ✅ `ontology/slice-library.ts`；A3.3 规划器 ✅ `ontology/slice-planner.ts`；A3.4 索引+复用 ✅ `ontology/slice-index.ts`；端点 ✅ `app.ts:2131-2168`；消费 ◐。
- **实测现状**（PRD 的自称 AS-IS **属实**，且本 PRD 的四件增量也已落地）：
  - AS-IS 属实：`apps/datacore/src/ontology/slice-library.ts` / `slice-planner.ts` / `slice-index.ts` 三文件都在；`slice-index.ts:48 lookupReusable` / `:99 lookupReusableByQuestion` 有真调用方 `apps/datacore/src/app.ts:2629/2636`（不是只被 test 引用）。
  - **REFBASE ✅**：`apps/datacore/src/ontology/refbase.ts:11 META_TENANT_ID = "__refbase"`（R2 元租户隔离）· `:14 REFBASE_SEED = 42`（R6）· `:155 generateRefbaseOntology(seed)` · `:202 refbaseNodeCount` · `:212 refbaseDigest`（确定性摘要）；覆盖报告 `apps/datacore/src/ontology/refbase-coverage.ts` + `buildBatteryDomainCoverage`（`app.ts:62` import，`:1829` 端点 `GET /a/v1/meta/refbase`）。
  - **SUITE-1 切片约束一等化 ✅**：`apps/datacore/src/domain.ts:200` 注释 + `:472-473` `RuleEntry.params` 承载 `mustIncludeTypes/mustIncludeLinkKeys`；消费方 `apps/datacore/src/ontology-governance.ts:429-441` `resolveStringArray(…)` 真解析（有 src 调用方，非死代码）。
  - **SUITE-2 QOS 动态切片深接 ✅**：`apps/agentcore/src/tools/datacore-http.ts:114` 经 OBO 调 `POST /a/v1/slices/plan`；触发点 `apps/agentcore/src/server.ts:2531`（卡声明 `sliceTargets` → 自动 planSlice）；`:2542` 注释明说 `slice.planned` 由 DataCore 单源发、此处不重复发（防双源）。
  - **SUITE-3 切片库可视面 ✅**：`apps/frontend-shell/src/pages/admin/SliceLibraryPage.tsx:16`（列表 tab + 规划 tab，接 `POST /a/v1/slices/plan`）+ `SliceInspector.tsx`；前端 API `apps/frontend-shell/src/api/endpoints.ts:956`。
  - **SUITE-4 SHAPE 门扩**：有 `scripts/check-ontology-slice-coverage.mjs`。
- **结论**：✅已实现
- **⚠ 注意一处不构成"不符"的措辞陷阱**：PRD §1 把「消费」标 ◐（"深接与可视面=本 PRD"）——这是**写 PRD 当时**的状态，现已补齐。读者若只读 §1 会误以为深接仍缺。
- **未查清**：C1「同 seed 重跑 deep-equal」与 C3「节点计数≈95」我**没实跑** `generateRefbaseOntology`，只核到函数与摘要机制存在。卡在：需要执行 TS（本审计只读）。

---

### docs/PRD-A9-external-engines-design-deferred.md
- **它要做什么**：**纯设计 PRD**——给三个外部引擎（Datalog/Soufflé 传导、图库 Neo4j/Gremlin、因果 DoWhy）设计统一 sidecar 接入点与触发条件，然后**明确延后不实现**。§1 非目标白纸黑字：「**不实现、不引依赖、不部署。不改任何现有代码。**」§7 DoD 末条：「**不产生任何代码改动**」。
- **PRD 自称的 AS-IS**：§2「现状（为何延后）」：系统自包含，唯一外部 sidecar = CP-SAT（OR-Tools，自托管，未配显式报错）；已有替代 —— 传导/多跳走 A3 切片规划器 + 派生 DSL，图查询走内存对象图 + executeSlice，归因走 margin_attribution/concentration_risk + counterfactual_timeline。
- **实测现状**：
  - **AS-IS 属实**：CP-SAT sidecar 真在 —— `services/optimizer/` 目录存在；`apps/datacore/src/solvers/service.ts:433` 注释 + `:3412` 「`selection_optimize` 未接入最优化引擎（设 `OPTIMIZER_BASE_URL` 起 CP-SAT sidecar）」+ `:2628` portfolio 同款 —— **未配即显式报错、不兜底**，与 §2 描述一致。
  - **三引擎确实零实现（= 符合 PRD 意图）**：`grep -rni "souffle|datalog|neo4j|gremlin|dowhy|外部引擎" apps/*/src packages/*/src` **0 命中**（工具已在 §0 自证可用）。
  - **契约确实未建（= 符合 PRD 意图）**：`packages/contracts/src/external-engines.ts` 不存在（`ls` 报 No such file）。
- **结论**：✅已实现 —— **注意判定口径**：本 PRD 的交付物是"设计 + 决策门"，其 DoD 恰恰要求**零代码**。零命中在这里是**通过**而非失败。这正是「不许用『grep 0 命中』直接推『没做』」的反面样本：**先读 PRD 意图，再看命中数**。
- **备注**：`scripts/check-prd-ontology.mjs`（`prd:check`）存在，§7 要求的门有着落。

---

### docs/PRD-IND-plan-generate-1to1.md
- **它要做什么**：「规划建议 / 方案生成」视图的**工业级 1:1 复刻**（UI 布局 + UX 交互 + 数据字段级落地），把参考 HTML 的 6 目标 / 5 路径 / 3 方案 / 五维雷达 / 外部敏感性 / 问题卡（why+链）逐字落成**种子 + 求解器输出**，前端零写死。
- **PRD 自称的 AS-IS**：§4.5「★系统字段级落地（现状 → 须改/须加，精确）」——这是本批**最精确的一节 AS-IS**：自称 `plan_generate` 已参数化(R14)、**评分系数与 HTML 完全一致**（profitBase50/profitK22/scaleBase40/scaleK3/cashBase50/cashK4/growthBase30/growthK2.5/stabBase90/stabK2.2/hardPenalty15 ✓），逐条列 6 项缺口：改 6 个种子值、加 `invTurns` 目标字段、加 `extSensitivity` 输出、结构化 `problems`、改 growth 口径、复用 audit 时序/KSF。
- **实测现状**（§4.5 的 6 项缺口逐条核）：
  1. **种子值 ✅**：`apps/datacore/src/synthetic/battery.ts:532` `base: { rev: 100, gm: 0.16, share: 18, turns: 5.6, cash: 58 }` —— gm/share/turns/cash 四项全改到 PRD 目标值；`:535-540` targets 从 `PLAN_GOAL_TARGETS` 派生（gmFloor=gmFloorPct/100、cashFloor、turnsFloor）——比 PRD 要求更进一步（做成了单一来源）。
  2. **`invTurns` 目标字段 ✅**：`apps/datacore/src/synthetic/service.ts:1541` `{ key: "invTurns", label: "库存周转", unit: "次", step: 0.5 }`，注释直引本 PRD §4.1/§8.4。
  3. **`extSensitivity` ✅**：契约 `packages/contracts/src/solvers.ts:438`；种子 `battery.ts:566`（GEN_EXT_SENS 5×3，注释引 §4.6）；求解器 `apps/datacore/src/solvers/plan.ts:342` 产出；前端渲染 `apps/frontend-shell/src/views/sim/PlanGenerateView.tsx:348-352`。**四段全通 = 接缝驱动，非各半绿。**
  4. **结构化 `problems` ✅**：种子 `battery.ts:574`（GEN_FOCUS 5×2，含 why/chain 4 节点）；`plan.ts:344` 先 GEN_FOCUS 焦点问题再硬违规问题。
  5. **growth 口径改 `revGrowAbs×2.5` ⚠ 未改成 PRD 写的形态**：`apps/datacore/src/solvers/plan.ts:305` 仍是 `growthBase + (outcome.rev - base.rev) * growthK`（**绝对差**），不是 `revGrowAbs`（百分比）。但 `battery.ts:531` 注释给出了等价性理由：「取值对齐 HTML GEN_BASE/GEN_GOALS（**rev=100 归一保 growth 评分=revGrowAbs×2.5**）」—— 因 `base.rev=100`，`(outcome.rev−100)` 与 `revGrowAbs=(eff.rev−1)×100` 数值恒等，故**结果等价、写法不同**。符号 `revGrowAbs` 在 `apps/*/src` 只出现在这行注释里（0 处代码）。这是「跨命名要再搜一轮」的典型：按符号搜会误判为"没做"。
  6. **复用 audit 时序/KSF**：`PlanGenerateView.tsx` 存在且渲染方案卡；audit 复用未逐组件核（见未查清）。
- **结论**：✅已实现（§4.5 六项缺口 5 项直接落地、第 5 项以数值等价方式落地）
- **未查清**：§7 DoD 的「像素核对」「交互逐项 FDE 亲手跑」我做不到（只读、无浏览器）。另 §4.6 的 `timelineFor` 9×4、`probSeqHTML`、`KSF_DEF` 是否逐字入种子，我只核到 GEN_EXT_SENS/GEN_FOCUS 两项有明确注释锚点，**其余三项未查清**。卡在：需逐字比对 `reference-prototype-decision-platform.html`，属像素级核对工作量。

---

### docs/PRD-WO-LIVE-DISPOSITION.md
- **它要做什么**：一张工单式 PRD ——「产能风险处置 · 最终方案与行动计划」表从「静态 · 从配置库选方案 · 点不开 · 调杠杆不变」升级到「真缺口贪心派生 · 每行可点开看推导 · 点『生成/重算』吃当前杠杆推演态实时重算」。三件一并交付：T1 富推演接入（引擎）/ T2 杠杆 reactive / T3 每行可点开。
- **PRD 自称的 AS-IS**：§1「现状 AS-IS（精确接线 · 已亲验）」——本批**最扎实的一节 AS-IS**，逐点带 file:line：`buildRiskPlanRows`（risk.ts:425-482）的 `act` 直接取 `mits[factor][0].name`（配置库第 0 个）；`void threshold`（risk.ts:479，阈值都没真用）；无 per-row 推导字段；`RiskBoardView.tsx:302-311` 每行 `<tr>` 无 onClick；只有导出按钮无生成/重算按钮；`liveState`（RiskBoardView.tsx:574）完全没回流 planRows。并指出**富推导逻辑已存在于另一个 solver**（`base-outlook.ts:203-252` 的 `dayPlan: DayAction[]`，带 rationale/triggerValue/closesGap/provenance），本 WO 核心 = 把它接进处置表、**复用 capacity 的克隆-覆写单源**（`service.ts:826 capacityInferenceApply`）别新造。
- **实测现状**（三件全落地，且 AS-IS 描述的每个病灶都能在码上看到"病历+治法"）：
  - **T1 富推演接入 ✅**：`apps/datacore/src/solvers/risk.ts:807-811` 注释**逐字复述了 PRD 的 AS-IS**（"`eff` 取配置固定 eff/tn · `void threshold`（阈值都没真用）· 无杠杆入口 · 无 per-row 推导字段"）并声明改为与 `base_capacity_outlook.dayPlan` **同一份实现**；`:955` 每行挂 `steps: d.steps`；`:949` 摘要「N 步收窄 M 套 · 残留 K 套」；`:964-974` 备份方案也挂真 steps（明写"非空壳"）。
  - **T2 杠杆 reactive ✅ 且复用了单源**：`risk.ts:432` args 加 `apply?: {objectType,objectId,prop,value}[]`（`:428` 注释明说形状 = 前端 `liveState.apply`）；`:442-446` `patchCapacityContext` 逐条覆写（**复用 capacity 的克隆语义，未另造**，正合 PRD §1.4 的红线）；`:549` `const overlay = Array.isArray(args.apply) ? args.apply : []`；`:738` `buildRiskPlanRows(c, shown, p.threshold, horizon, c0, overlay)`。前端：`RiskBoardView.tsx:351` 「⚙ 生成/重算行动计划」按钮 → `regen.mutate(boardLive.apply)`；`:122-131` 注释明说是**服务端真重算**、"不在前端拼字"；`:180` `const planRows = livePlan?.rows ?? data.planRows ?? []`；`:181` 换窗口即丢弃上一窗口重算结果（防串窗）。
  - **T3 每行可点开 ✅**：`RiskBoardView.tsx:396` `onClick={() => setOpenPlanRow(openPlanRow === i ? null : i)}`；`:409-410` `<DispositionDetailPanel row={planRows[openPlanRow]!} …/>`。
  - **额外发现（超出本 PRD、但同一表格）**：`RiskBoardView.tsx:365-369` 记了另一桩已修的静默降级 —— 契约里 `planRows[].overlay {count,capRatio}` 一直有值但前端从没渲染过，用户拖完杠杆点重算"表格一个字没变、也不解释为什么"；现补 `OverlayEffectNote`（`:425-445`）解释"哪几个基地落了杠杆、其中几个窗内有缺口故行动项重算、几个无缺口故理应不变"。这是「接了线没数据/没渲染」形态的一个已闭合样本。
- **结论**：✅已实现（T1/T2/T3 三件齐；且守住了 §1.4 "复用不新造" 的红线）
- **⚠ 读者陷阱（不是 PRD 错，是时序）**：§1 的 AS-IS 描述的是**写单当时**的状态，现已全部被推翻。只读 §1 会得出"处置表是写死的"这个已经过期的结论 —— 与本次事故同型。**建议在 §1 顶部加一行「本节为 WO 开工前快照，已于 <commit> 全部落地」**，让后来的读者不必重犯。

