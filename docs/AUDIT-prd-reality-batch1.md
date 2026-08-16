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


---

### docs/PRD-addendum-a8-timeseries.md
- **它要做什么**：新增 **A8 时序数据层**——原始时序（MES 实绩/OEE，数十万行）严禁进本体对象存储与 LLM 上下文；显式规格化「原始时序 → 聚合 → 本体快照属性（结论数据）」的加工链；合成数据支持**模拟时钟一键推进**让全链路（聚合→派生→规则→看板）活起来。
- **PRD 自称的 AS-IS**：无独立 AS-IS 节（它是"新增模块"型增量）。§0「数据分层总图（规范性）」是它的规范锚：`ts_points`（hypertable）→ A8 聚合作业 → 快照属性 → A4 派生 → 消费层；红线「`objects` 表禁止出现逐条时序记录型对象；任何返回给 LLM 的工具禁止返回 `ts_points` 原始行」。
- **实测现状**（逐节全落地）：
  - **§1 接入通道 ✅**：`kind: "ENTITY"|"TIMESERIES"` 契约 `packages/contracts/src/timeseries.ts:7` + `packages/contracts/src/datacore.ts:56`；自动画像建议 `apps/datacore/src/connectors/profiler.ts:45`（时间列+实体键+数值测量 → 建议 TIMESERIES）；分流写入 `apps/datacore/src/connectors/service.ts:207`（`kind==="TIMESERIES" && this.ts` → 走独立时序写入器，不落 raw_datasets）。
  - **表全建 ✅**：`apps/datacore/migrations/002_addendum.sql:53 ts_series` · `:61 ts_points` · `:71` 索引 `(series_id, entity_id, ts DESC)`（与 PRD §1 逐字一致）· `:79` `create_hypertable('ts_points','ts',…)` 且 `:81` timescaledb 不可用时**优雅降级为普通表**并 RAISE NOTICE（诚实，不静默）· `:85 ts_late_arrivals`（迟到数据）· `:93 ts_agg_specs` · `:116 simulation_clocks`。
  - **§2 聚合 ✅**：`apps/datacore/src/timeseries.ts` `TimeseriesService`（`app.ts:88` import，`:344` 实例化，`:394` 注入 deps）；端点 `app.ts:4259 POST /a/v1/timeseries/agg-query` · `:4263 GET /a/v1/timeseries/agg-specs` · `:4264 POST /a/v1/timeseries/aggregate`。
  - **§6.1 tsGenerators ✅**：`apps/datacore/src/synthetic/battery.ts:2601 tsGenerators` · `:2612 scenarioScript`；消费方 `synthetic/service.ts:496`（③b 确定性历史生成）· `simclock.ts:183` · `livedin/bundle.ts:310`（三处 src 调用方，非死配置）。
  - **§6.2 模拟时钟 ✅**：`apps/datacore/src/simclock.ts`（`app.ts:381` `new SimClockService(repos, timeseries, ontology, ruleScan, solvers, outbox)` —— 依赖注入进的正是 §6.2 tick 流水第 4 步要求的聚合/规则/求解器）；端点 `app.ts:4282 GET /a/v1/synthetic/clock` · `:4283 /clock/ticks` · `:4305 POST /clock/tick` · `:4310 POST /clock/reset`；事件 `simclock.ts:149` 发 `synthetic.tick_completed`。
  - **§6.3 前端控制台 ✅**：`apps/frontend-shell/src/pages/admin/SimClockConsole.tsx`；事件消费 `apps/frontend-shell/src/store/eventInvalidation.ts:49` `"synthetic.tick_completed": ["dashboard","object-queries","scenario-data"]`（**四段全通：发→订阅→前端失效→重拉**）。
  - **跨系统订阅方 ✅**：`apps/agentcore/src/event-subscriptions.ts:59` 同一事件登记 `tier: "IN_SESSION"`，`dl: "DL7"`。
- **结论**：✅已实现
- **未查清**：§0 那条红线（"任何返回给 LLM 的工具禁止返回 `ts_points` 原始行"）我**没有做穷举核验**——只见到 `query_timeseries_agg` 这类聚合工具。卡在：需枚举 agentcore 全部工具的返回体做静态判定，工作量超出本次。建议补一条 `check-*` 门做静态断言（这是"红线写在文档里但没有门看着"的典型风险位）。

---

### docs/PRD-addendum-admin-console-closure.md
- **它要做什么**：管理面**引用闭合性**（任何引用型控件必须"选择/＋新建/查看"三态，禁裸下拉 = D-27）+ **DSL 输入辅助**（自动补全/实时校验/试运行，禁裸文本框 = D-28）+ 补 7 个"被引用却无创作页"的整页缺失。总判据 AC8：客户管理员**不碰代码、不遇死路、不被反问**能从零搭出可推演的新场景。
- **PRD 自称的 AS-IS**：§5「逐页缺陷审计」逐页列已发现的具体缺陷（12 类页面）；§6「整页缺失清单（审计发现 7 个被引用却无创作页的资源）」；§10「验收基线声明」自陈"在此之前，系统是**开发者可用、客户不可自助**的状态"。
- **实测现状**（§6 七页逐条核）：
  1. 工作流/执行计划编辑器 → **✅** `apps/frontend-shell/src/pages/admin/WorkflowsPage.tsx`（`App.tsx:40` 已注册路由）
  2. 评测用例编辑器 `/admin/evals` → **✅** `EvalsPage.tsx`（`App.tsx:53`）
  3. 本体切片编辑器 `/admin/slices` → **✅** `SlicesPage.tsx`（`App.tsx:54`）+ `SliceLibraryPage.tsx`（`App.tsx:55`）+ `SliceInspector.tsx`
  4. 域管理页 `/admin/domains` → **✅** `DomainsPage.tsx`（`App.tsx:52`）
  5. 运营自动化页 `/admin/ops-schedule` → **✅** `OpsSchedulePage.tsx`（`App.tsx:45`）
  6. **数据工坊页 `/admin/data-forge` → ❌ 未实现**：`grep -rn "data-forge|DataForge|数据工坊|直方图|histogram|提示词框|forge"` 在 `apps/frontend-shell/src` **0 命中**（工具已自证）。**已按"跨命名再搜一轮"复核**：相近页 `SyntheticPage.tsx`（合成数据向导）/ `DataBuilderPage.tsx`（FDE 建域）/ `PrototypeIntakePage.tsx`（原型接入）都在，但都不是 PRD §6-6 要的"三栏配置器 + 提示词框 + 直方图预览"。判为**没接线**（不是接了线没数据）。
  7. 运营页组（合并队列/隔离区/配置迁移/通知中心）→ **✅ 四页全在** `MergePage.tsx`(`App.tsx:56`) · `QuarantinePage.tsx`(`:50`) · `ConfigMigrationPage.tsx`(`:60`) · `NotificationsPage.tsx`(`:51`)
  - **D-28 DSL 输入辅助 ◐**：组件 `apps/frontend-shell/src/pages/admin/DslTextarea.tsx:53` 存在且有真消费方 —— `RulesPage.tsx:9/479`（规则表达式）与 `PermissionsPage.tsx:6/117`（rowFilter）。**但 §7 点名的四类输入只覆盖了两类**：`ModelingPage.tsx` **0 命中 DslTextarea**（派生公式无补全）；模板值走的是另一套 `templateSuggest.ts:7 templateSuggestions`（`WorkflowsPage.tsx:18/303` 消费）—— 这是**同一需求两个实现**，不是缺失，但 §7 要求的统一规范未统一。
- **结论**：◐部分 —— 7 页缺 1（数据工坊）；D-28 四类输入覆盖 2 类 + 1 类走并行实现 + 1 类（派生公式）缺。
- **未查清**：§5 逐页缺陷表共 40+ 条具体缺陷（如"objectRef 槽位缺 refType 下拉""MCP toolFilter 鸡生蛋须强制先连接测试""视图配置缺 widget 编辑器"），我**只核到页面存在，没有逐控件核**。卡在：需真开浏览器逐控件点（AC9 明写是人工巡检项）。**故本条结论只覆盖 §6 整页存在性与 §7 DSL 辅助，不覆盖 §5**——这是本次审计最大的一块未覆盖面，诚实标出。
- **最小 WO 建议**：
  - **WO-ADMIN-DATAFORGE**：🚦范围边界 = 新建 `apps/frontend-shell/src/pages/admin/DataForgePage.tsx` + `App.tsx` 注册 + nav 分组（`ShellLayout`）；后端复用既有 `/a/v1/synthetic/*`，不新建端点。
  - **WO-ADMIN-DSL-UNIFY**（小、见效快）：🚦范围边界 = 只碰 `ModelingPage.tsx` 与 `DslTextarea.tsx`，把派生公式输入框换成 `DslTextarea`（数据源=本体元模型，已有）。
  - **WO-ADMIN-§5-AUDIT**（先取证再修）：🚦范围边界 = 只写一份逐控件巡检清单文档，把 §5 的 40+ 条逐条标 ✅/❌ + file:line —— **不要凭"页面在"就宣布 §5 通过**（那正是本次事故的同型错误）。

---

### docs/PRD-addendum-admin-platform.md
- **它要做什么**：管理平台补全 —— 平台引导 Bootstrap（空库首启建 `platform_admin`）/ 租户与用户管理（A0 扩展）/ 场景包与视图配置管理 / AgentCore 五类资源统一 CRUD 模式 / 规则库手工管理 / 空态引导规范。
- **PRD 自称的 AS-IS**：无独立 AS-IS 节，但 §5 自称「前端 `/admin/rules`（**原 PRD 已列路由但未给规格**）」——即承认路由在、规格缺。
- **实测现状**（六节逐条核）：
  - **§1 Bootstrap ✅**：`apps/datacore/src/bootstrap.ts:17-18`（`BOOTSTRAP_ADMIN_EMAIL/PASSWORD` → `default` 租户建 `platform_admin`，`:18` 明写幂等）· `:39` 未配置且表空 → 明示原因 · `:80` `/readyz` 返 `BOOTSTRAP_REQUIRED`；配置项 `apps/datacore/src/config.ts:41-42`。
  - **§1-2「管别人房子不看别人抽屉」✅ 且是真强制不是注释**：`apps/datacore/src/authz.ts:32-39` —— `platform_admin` 命中即 deny 业务对象读取，`reason` 逐字复述 PRD 措辞。
  - **§2 IAM ✅**：全部端点在 `apps/datacore/src/adminplatform.ts`（`app.ts:34` 注册）—— `:138 GET /a/v1/tenants` · `:145 POST /a/v1/tenants` · `:169 GET /a/v1/tenants/:id/users` · `:177 POST` · `:204 PATCH .../users/:userId` · `:249 POST /a/v1/users/:id/reset-password` · `:265 GET /a/v1/roles`。安全规则 ②`LAST_ADMIN` **真落**：`adminplatform.ts:218` 注释 + `:229` `throw new AppError("LAST_ADMIN", …, 409)`。
    > ⚠ 取证注记：我第一轮只 grep `apps/datacore/src/app.ts` 得 0 命中（只有 `/tenants/:id/features`），差点判"租户 CRUD 未实现"。改 grep 整个 `apps/datacore/src` 才找到 `adminplatform.ts` —— **搜索范围选窄了会骗你**，与铁律 0.5 #5 同型。
  - **§3 场景包与视图配置 ✅**：`adminplatform.ts:284/289/334`（scenario-packages GET/POST/PATCH）· `:413/420/452/509`（view-configs GET/POST/PUT/DELETE）；**§3 的强制联动（建 ViewConfig → 自动注册 `view.{viewKey}` feature）也真接了**：`adminplatform.ts:367/501/518` 三处 `VIEW_FEATURE_MAP[…] ?? (dyn.has(\`view.${…}\`) …)`。前端 `ViewsPage.tsx`（`App.tsx:71`）。
  - **§4 AgentCore 五类资源统一模式 ✅**：`IMMUTABLE_VERSION` 409 —— agents `apps/agentcore/src/server.ts:642` · workflows `:972` · skills `:1228` · mcp-configs `:1501`；`new-version` —— `:732/:1073/:1312/:1575`；`references` —— `:744/:1093/:1324/:1595` + scene-entries `:2801`；`mcp-configs/:id/test` —— `:1475`。**五类全覆盖，无洼地。**
  - **§5 规则手工管理 ✅**：`apps/datacore/src/app.ts:3191 POST /a/v1/rules/dry-run`；前端 `RulesPage.tsx` + DSL 补全（见上条）。
- **结论**：✅已实现
- **未查清**：§6「空态与引导规范（全管理页统一）」与 §7 M1–M7 验收用例我未逐页核（同 admin-console-closure，属 UI 巡检）。

---

### docs/PRD-addendum-agent-runtime.md
- **它要做什么**：Agent 运行时强化 —— ①上下文管理（Token 预算器 / tool_result 8KB 截断 / 三刀清理 / 多轮前情摘要）②Workflow 执行语义（有界同步 ≤5min + 崩溃扫描 `INTERRUPTED_BY_RESTART` + checkpoint 接口预留）③Skill 资源可消费（`read_skill_resource`）④MCP 运行时（连接生命周期 / `mcp__{server}__{tool}` 命名空间 / **stdio 安全红线**）⑤工具并行执行。
- **PRD 自称的 AS-IS**：无独立 AS-IS 节（"修订"型增量，逐节写"修订 QOS-PRD §X"）。§2-3 有一处**显式边界声明**：「本期**不做持久化恢复**——这是显式边界而非疏漏」。
- **实测现状**（五节逐条核，注释多处逐字回引 PRD 节号 = 可对账）：
  - **§1.1 预算器 ✅**：`apps/agentcore/src/agent/context.ts:8`（注释逐字引 §1.1）· `:17 SOFT_THRESHOLD_RATIO = 0.7`（= PRD 的 70%）· `:314/:333 softLimit` · `:337` count_tokens 每 2 轮实测一次（= PRD 节奏）· `:358 metrics.contextOps.inc({op})`（= PRD 要求的 `ac_context_ops_total{op}`）。
  - **§1.2 截断 ✅ 且豁免名单对得上**：`agent/loop.ts:225 TRUNCATION_EXEMPT_TOOLS = new Set(["query_timeseries_agg","read_skill_resource"])` —— PRD §1.2-3 点名 `query_timeseries_agg` 豁免，§3 给 `read_skill_resource` 自带 64KB 上限，**两条豁免理由都在 PRD 里，实现一条不多一条不少**。
  - **§1.3 三刀 ✅**：`context.ts:11` 注释列三刀；第 1 刀 `:157-172`（折叠最旧迭代，`:158` "最近 2 轮永不折叠" = PRD 原文）；第 2 刀 compaction `:313 caps.compaction`；`:270-291` 另有 provider 可用时的滚动摘要增强。
  - **§1.4 多轮连续性 ✅**：`context.ts:270` 前情摘要 ≤1600 字 + `agent/loop.ts:332` 注入 system。
  - **§2-2 崩溃语义 ✅**：`apps/agentcore/src/ops/sweep.ts:6/12/22`（启动扫描 → `{code:"INTERRUPTED_BY_RESTART", message:"系统重启中断，请重试"}`）· 挂载点 `apps/agentcore/src/main.ts:70-73` · **前端也接了** `apps/frontend-shell/src/components/QueryDock/TaskRun.tsx:20` 对该错误码特判。**后端发→前端识，接缝通。**
  - **§2-3 checkpoint 预留 ✅（是"故意的空实现"不是漏）**：`apps/agentcore/src/workflow/checkpoint.ts:4` 注释自证「崩溃语义由启动扫描（INTERRUPTED_BY_RESTART）覆盖」。
  - **§3 read_skill_resource ✅ 全链**：注册 `tools/registry.ts:258` → 分发 `tools/executor.ts:467` → 实现 `:527`（文本 ≤64KB 截断 / 二进制返元信息，与 PRD 逐字一致）→ 端口 `tools/skill-resources.ts:8` + `deps.ts:49` + `engine.ts:91`（依赖注入 —— **这类端口 grep 一次看不见调用方，属铁律 0.5 #3 点名的形态，已追到注入点**）。
  - **§4.2 命名空间 ✅**：`engine.ts:214` + `tools/executor.ts:250` 逐字引 §4.2；`agent/navigation-slice.ts:272` 用正则 `/^mcp__[a-z0-9_]+__/` 识别，说明全名格式在多处被真消费。
  - **§4.3 stdio 安全红线 ✅**：`apps/agentcore/src/config.ts:60 MCP_STDIO_ENABLED` · `:62 MCP_STDIO_COMMAND_ALLOWLIST` · `:88-89` 解析为 `{enabled, commandAllowlist}`。
  - **§5 并行执行 ✅**：`agent/loop.ts:537-543 sideEffectOf` · `:1010 const allRead = toolUses.every(b => sideEffectOf(b.name)==="READ")`（READ 全并行/混合全串行，与 PRD 逐字一致）· `:298 await Promise.all(workers)`。
- **结论**：✅已实现
- **备注**：本份 PRD 是本批**实现与文本对账度最高**的一份 —— 实现注释大量逐字回引 PRD 节号（`§1.1`/`§1.2`/`§4.2`/`增量 §3`），使对账可机械完成。**这是值得推广的纪律**：注释里写清"我实现的是哪条 PRD 的哪一节"，就把未来的对账成本从"重读两份文档"降到"grep 一次节号"。
- **未查清**：§4.1 连接生命周期的具体数值（连接池 ≤4 / 空闲 30s / 超时 20s / 退避 1-2-4s / 连续 5 次置 ERROR）我未逐个核到常量。卡在：需读 MCP client 实现细节，优先级低于结构性缺口。

---

### docs/PRD-addendum-capability-routing.md
- **它要做什么**：能力发现与路由三件 —— §1 统一 `discover` 工具（slices/solvers/mcp_tools 目录发现）· §2 MCP 工具集规模管理（>24 个工具时启用**按需加载**：占位摘要 + `discover`/`load_tools` 两个管理工具）· §3 等价能力组 `capabilityGroup` 与故障转移。§4 显式声明 Skill 路由**本期不做**（≤20 技能 + summary 常驻 + `load_skill` 即最优）。
- **PRD 自称的 AS-IS**：无独立 AS-IS 节。§4 是一段**显式边界声明**（"不引入额外路由层，复杂度不偿失"），并写明 v2 触发条件（单 agent 技能 >20 或跨 agent 共享技能库）。
- **实测现状**（三件：一件超额完成、两件未做）：
  - **§1 discover ✅（且超出 PRD）**：注册 `apps/agentcore/src/tools/registry.ts:8`；分发 `apps/agentcore/src/tools/executor.ts:258`；PRD 只要 `slices|solvers|mcp_tools` 三种 kind，实现多了 `object_types`（`executor.ts:264-269`，用途是"agent 照真名查不再猜"）。`description`/`argHints` 供给侧也在：`tools/datacore-http.ts:356/363/365` 的返回类型含 `argHints`，`server.ts:798` 注释直引「复用能力路由增量 §1 的 DataCore 目录（含 description/argHints）」。排序另接了 DRIL Resource Registry（`executor.ts:277-296`，混合检索 + entitlement 前置过滤，失败 fail-open 回落 catalog）。
  - **§2 MCP 按需加载 ❌ 未实现（形态 = 没接线，但代码是诚实的）**：`apps/agentcore/src/tools/executor.ts:270-272` ——
    ```
    if (kind === "mcp_tools") {
      // §2 MCP 按需加载目录：当前部署未启用 >24 工具按需加载模式 → 空目录
      return { items: [] };
    }
    ```
    即 `discover(kind=mcp_tools)` 恒返回空数组。配套的 `load_tools` 工具 **`grep -rn "load_tools\|loadedTools" apps/*/src packages/*/src` = 0 命中**（工具、契约、审计字段 `AgentRunRecord.loadedTools` 三者皆无）。**注意区分**：`load_skill`（技能渐进披露）是**另一件事**且**真在**（`agent/loop.ts:402/539/551/559/567`）—— 两者名字像，功能不同，别混。
  - **§3 等价能力组 ❌ 未实现**：`capabilityGroup` / `groupPriority` 在 `apps/*/src` 与 `packages/contracts/src` **均 0 命中**（`memory.ts:237` 的 "SKIP-LOCKED-equivalent" 是英文单词误命中，已排除）。契约 `McpServerConfig` 里也没有这两个字段 → **连数据模型都没有**，属彻底没接线。
  - **§4 Skill 路由边界 ✅（PRD 要求的就是"维持现状"）**：`load_skill` 全链在（见上）；`apps/agentcore/src/agent/skill-router.ts:9` 注释「其余降级为『id+名』经 load_skill 按需加载（保留渐进式披露）」—— 与 §4 描述一致。
- **结论**：◐部分 —— **§1 ✅（超额）· §4 ✅（边界声明成立）· §2 ❌ · §3 ❌**。三件实质工作做了一件。
- **⚠ 半真半假的信号（值得单独记）**：`discover` 工具本身是**已接线、已被 agent 用**的；但它的 `mcp_tools` 分支是**硬编码空返回**。若只 grep `discover` 会得出"能力路由已实现"的结论 —— **工具存在 ≠ 该工具的每个 kind 都工作**。这是"接了线没数据"的一个变种：不是数据恰好为空，是**代码里写死了返回空**。
- **最小 WO 建议**（按 ROI 排序）：
  - **WO-CAP-2-LAZYLOAD**（中）：🚦范围边界 = `apps/agentcore/src/tools/registry.ts`（加 `load_tools` 定义）+ `tools/executor.ts`（`mcp_tools` 目录真返回 + `load_tools` 执行）+ `agent/loop.ts`（任务级工具列表追加，**追加不替换**以保 prompt cache 前缀）+ 契约加 `AgentRunRecord.loadedTools`。**触发条件先自查**：若当前任何 agent 的解析后工具数都 ≤24，这件事今天**没有真实收益**，应先量测再排期（别做"没数据的接线"）。
  - **WO-CAP-3-FAILOVER**（低优先）：🚦范围边界 = `packages/contracts`（`McpServerConfig` 加 `capabilityGroup?`/`groupPriority?`）+ agentcore MCP 路由 + `McpPage.tsx` 录入位。**同样先自查**：单实例部署下无收益，PRD §3 自己就标了"可选配置"。

---

### docs/PRD-addendum-dataflow-loop-closure.md
- **它要做什么**：数据流闭环验收 —— §1 每个上传入口的前向链 + 强制"下一步"直达（UP-1）· §2 **12 条主数据环 L1–L12** 逐跳接线（WIRE-1：产出方与消费方读写同一持久层键）· §3 联动刷新三档 + **传播 SLO ≤60s，PROP-1「不允许必须重新登录才看到」**· §4 **断链审计 DL1–DL10**（已识别的"产出了但没接到/没刷新"风险点）。
- **PRD 自称的 AS-IS**：§4 断链审计表本身就是一份 AS-IS —— 它逐条列出了当时已识别的 10 个断链风险点及修复要求。
- **实测现状**（后端 ✅ 全登记；前端 ◐ 只兑现 5/14）：
  - **后端事件登记表 ✅ 完整**：`apps/agentcore/src/event-subscriptions.ts` 共 **51 条**事件登记，其中 **14 条带 `dl:` 标**，与 PRD §4 的 DL 编号一一对应（`:30 DL1 raw_dataset.uploaded` · `:31 DL2 ontology.published` · `:37 DL3 rules.updated` · `:49/:50 DL4` · `:55 DL5 calibration.applied` · `:57 DL6 intent.promoted` · `:59 DL7 synthetic.tick_completed` · `:68 DL8 objects.merged` · `:61/:62 DL9` · `:66 DL10 kb.indexed` · `:78 DL11 policy.updated` · `:80 DL12 features.updated`）。**PRD 只列到 DL10，实现自行补齐到 DL12（权限环/功能开通环）——超额。**
  - **前端全局通道 ✅ 存在**：`apps/frontend-shell/src/store/useDomainEventStream.ts:36` `invalidateForEvent(e.event)`；`:10` 注释自证「此前 `invalidateForEvent` 仅由发起方自己的 mutation 本地触发，跨用户/被动页不更新；本通道补上跨会话传播」—— 即 PROP-1 的传播机制真在。
  - **⚠ 但前端映射表没跟上，9/14 条 DL 事件到前端是静默 no-op**：`apps/frontend-shell/src/store/eventInvalidation.ts:38 EVENT_INVALIDATES` 只有 **19 个键**，逐条比对结果：

    | DL | 事件 | 前端 |
    |---|---|---|
    | DL1 | `raw_dataset.uploaded` | ❌ 无键 |
    | DL2 | `ontology.published` | ✅ `:45` |
    | DL3 | `rules.updated` | ✅ `:39` |
    | DL4 | `action.executed` | ✅ `:50` |
    | DL4 | `writeback.divergence` | ❌ 无键 |
    | DL5 | `calibration.applied` | ❌ 无键（前端只有 `calibration.proposed`/`.rolled_back`，**恰恰漏了"已应用"这条**） |
    | DL6 | `intent.promoted` | ❌ 无键 |
    | DL7 | `synthetic.tick_completed` | ✅ `:49` |
    | DL8 | `objects.merged` | ✅ `:53` |
    | DL9 | `connection.sync_completed` | ❌ 无键 |
    | DL9 | `connector.sync_failed` | ❌ 无键 |
    | DL10 | `kb.indexed` | ❌ 无键 |
    | DL11 | `policy.updated` | ❌ 无键 |
    | DL12 | `features.updated` | ❌ 无键 |

    机制原因在 `eventInvalidation.ts:62-67`：`for (const label of EVENT_INVALIDATES[event] ?? [])` —— 键不存在 → `?? []` → **循环零次、不抛错、无日志**。这是**静默 no-op**，不是崩溃，所以不会有任何测试变红。
  - **语义标签映射同样缺口**：后端 `invalidates` 用到 **54 个**语义标签，前端 `LABEL_TO_KEYS`（`:12-32`）只映射 **18 个**，未映射 36 个，含 `raw-datasets` / `modeling.dataset-picker`（DL1 要的）· `calibration-report`（DL5）· `fallback-stats`（DL6）· `connectors`/`quarantine`（DL9）· `kb-search`/`search-test`（DL10）· `workspace`/`navigation`（DL12）等。**即便补上事件键，标签不映射仍然失效不了。**
  - **单一来源纪律写在码上但没门看着**：`eventInvalidation.ts:8-10` 明写「后端 event-subscriptions 是事件→语义标签的**单一来源**；前端只负责把语义标签映射到实际 TanStack queryKey 前缀。**改了后端 invalidates 语义标签时，同步增补 `LABEL_TO_KEYS` 即可**」—— 纪律是对的，但**靠自觉**，于是漂了 36 个标签。
- **结论**：◐部分 —— **后端半 ✅（甚至超额到 DL12）；前端半 ◐（14 条 DL 事件只有 5 条真会刷新页面）**。这正是 CLAUDE.md 「SEAM-GATE / 绿测试≠能用 · 断在接缝」的教科书样本：两半各自都能跑绿，接缝上掉了 9 条。
- **⚠ PRD 自身陈述与现状的关系**：PRD §3-3 的 PROP-1 「上游变更到下游可见 ≤60s，**不允许"必须重新登录才看到"**（重登才更新 = 验收不通过）」—— 对 DL12 `features.updated`（功能开通）而言，前端既不失效 `workspace` 也不失效 `navigation`，**实测就是"要重新登录/刷新才看到"**，即 PROP-1 当前不成立。
- **最小 WO 建议**：
  - **WO-DATAFLOW-FE-SYNC**（**本批 ROI 最高的一件**：改动集中在 1 个文件、缺口精确已知、修完 9 条 DL 环一起活）：🚦范围边界 = 只碰 `apps/frontend-shell/src/store/eventInvalidation.ts`。① `EVENT_INVALIDATES` 补齐 9 个缺失事件键；② `LABEL_TO_KEYS` 补齐这 9 条用到的语义标签 → TanStack queryKey 前缀。
  - **WO-DATAFLOW-SYNC-GATE**（配套，防再漂）：🚦范围边界 = 新建 `scripts/check-event-invalidation-sync.mjs` + 接进 `package.json` 门列表。断言：后端 `event-subscriptions.ts` 的每个 `event` 都在前端 `EVENT_INVALIDATES` 有键、每个 `invalidates` 标签都在 `LABEL_TO_KEYS` 有映射；缺口走棘轮基线（当前 9 事件 + 36 标签）只减不增。**⚠ 写这个门时务必吸取 A15 的教训：别写成"只要文件里出现过某符号就算通过"的存在性检查**（那样又是一道永不红的门）——断言必须是**集合差为空/不增**，且**先故意删一条验证它真会红**（tooth 测试）。
