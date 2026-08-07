# AUDIT · PRD 实现状态对账 · 第 5/5 批（19 份）

| 项 | 值 |
|---|---|
| 审计日期 | 2026-08-07 |
| 基线 commit | `8e3e91a677c6c860daeff4d0826af263e5852972`（分支 `wave4`） |
| 范围 | `ls docs/PRD-*.md \| sed -n '89,107p'` 的 19 份 |
| 性质 | **只读审计**。本文件是本批唯一写入物，未改任何源码/PRD |

---

## 0. 方法与自证（先证明工具没骗我）

本批**不使用** mtime、待办状态、"最近有没有人改过"这类间接证据判断实现与否 —— 这三条正是一小时前
把「推演沙盘从没开工」这个错误结论推出来的三根柱子（实测沙盘 `views/sim/**` 今天是
**36 文件 / 15,261 行**，见 §1.2）。

**工具自证（铁律 0.5 判据 5）**：

```
$ git grep -ln "createIntent" -- 'apps/*/src'     → 0 个文件（pathspec 的 * 不跨 /，工具骗人）
$ git grep -ln "createIntent" -- 'apps/**/src/**' → 5 个文件（正确）
```
本文全部检索改用 ripgrep（`Grep` 工具）或 `apps/**/src/**` 形态；且**排除** `.claude/worktrees/**`
（那里是其他 agent 的隔离副本，会造成同一命中重复 8 次的假象）。

**判定口径（三分法，混了必修错地方）**：
- **没接线** = 符号的调用方集合里只有 test / 只有文档
- **接了线没数据** = 有 src 调用方，但输入恒空/恒假，分支从未进入
- **接了线接错地方** = 有 src 调用方，但挂在错误的路径上（如只接后端、没接前端入口）

---

## 1. PRD-sandbox-redesign.md ⚠⚠ 本次事故的当事文档

- **它要做什么**：把推演沙盘从「等人提问」改成「系统先扫出全链卡点/堵点/断点，每点给多方案并对比」。
  自称交付形态 = **「本文只是 PRD。零代码改动，实施由后续 WO 承接」**（`docs/PRD-sandbox-redesign.md:9`）。

### 1.1 PRD 自称的 AS-IS（§3 · 逐条摘录，这一节我点开读了）

| PRD 原文位置 | 自称 |
|---|---|
| `:80` | 沙盘主屏 `SandboxView.tsx`（462 行）· 路由 `v/sim-sandbox` —— **在，暗发**（entitlement `sim.sandbox` 关 → 404，`App.tsx:111`） |
| `:84` | 确定性传导引擎 `propagateTick` 经 `app.ts:1428` 调用 —— 在，且是纯函数 |
| `:85` | sim 端点 **17 条** |
| `:86` | sim 前端总量 `views/sim/**` **7,019 行 / 20 个组件** |
| `:89` | 求解器 **57 个** `SOLVER_KEYS` |
| `:98` | ④ 物料/采购段最薄：**无供应商交期/提前期/最小起订量/断供推演** |
| `:105-110` | §3.3 今天做不到的四条：无问题发现层 / 无多方案生成与对比 / 三业务未进沙盘 / 链路只到产能没接采购 |
| `:214-218` | 时间粒度三层不一致：引擎有 shift 档、种子 5 条序列全 day、求解器按 day 算 |
| `:224` | `timeseries.ts:373` `bucketCount > 120` → 400 |
| `:414` | 诚实边界：AS-IS 是静态读码得出，**没有真跑过沙盘页** |

### 1.2 实测现状（file:line）

**⚠ 已确认三处「PRD 断言了一件可核实的事、而事实相反」：**

**⚠-A · `sim.sandbox` 不是暗发，是开着的**（`:80` 与 `:385` 两处，`§10.1` 整节建立在这个错误前提上）

- L1 默认关**属实**：`apps/datacore/src/features.ts:81` `{ key: "sim.sandbox", …, defaultOn: false }`。
- **但 L2 行业模板把它抬上来了**：`apps/datacore/src/features.ts:283`
  ```ts
  return new Set(ALL_FEATURE_KEYS.filter((k) => !QOS_DARK_LAUNCH_FEATURES.has(k) && !PERF_DARK_LAUNCH_FEATURES.has(k)));
  ```
  两个暗发集合分别在 `features.ts:160-175`（14 个 key，全是 `ceo.*`/`agent.*`/`qos.*`）与
  `features.ts:182-184`（1 个 key `dc.lazy-solver-context`）—— **`sim.*` 一个都不在里面**。
- 源码里已有明写：`features.ts:158` 「产品分档特性（**sim.\*** / opt.\* 等）**不在此列，照常随模板开**」；
  `apps/datacore/src/seed.ts:74-75` 「L2 行业模板 … **已经把 sim.\* 全开了**」。
- ⇒ battery 模板租户（= demo 租户）上 `sim.sandbox` **是开的**，`App.tsx:111` 那条 404 路径走不到。
  **只看 L1 `defaultOn:false` 就下结论 = 少追一层（L2 能抬上来）。** 这处错误已误导至少三个读者。

**⚠-B · §3.1 的两个规模数字已过期，且方向是「实际多得多」**

| PRD 写 | 实测 | 证据 |
|---|---|---|
| sim 前端 7,019 行 / 20 组件 | **15,261 行 / 36 文件** | `find apps/frontend-shell/src/views/sim -type f`（36）· `wc -l` 合计 15261 |
| sim 端点 17 条 | **21 条** | `apps/datacore/src/app.ts:1385,1405,1410,1415,1479,1488,1497,1506,1519,1525,1530,1538,1669,1677,1717,1728,1735,1747,1772,1784,1791` |
| `SOLVER_KEYS` 57 个 | **59 个** | `apps/datacore/src/solvers/service.ts:163` `chain_loss_attribution` · `:166` `chain_impediments`；金值 `apps/datacore/test/ontology-core.test.ts:496` 已同步到 59 |

**⚠-C · 「零代码改动」已不成立 —— §5 的核心设计已实施过半**

PRD 头部 `:9` 写「零代码改动」，但配套工单文件 `docs/WO-SANDBOX-SERIES.md` 已把它拆成 W0–W4 四波并**已落地多波**：

| PRD 设计项 | 实测状态 | 证据 |
|---|---|---|
| §5.2 `ChainImpediment` 对象形态 | **✅ 已实现**（契约冻结） | `packages/contracts/src/chain-sim.ts`（含 `ChainImpediment`）· 往返测 `packages/contracts/test/chain-sim.test.ts` |
| §5.1 三类阻滞点可判定 | **✅ 已实现**（741 行判定引擎） | `apps/datacore/src/solvers/chain-impediment.ts:106 IMPEDIMENT_RULE_BINDINGS`（六条判据登记表）· `:277 readRuleThreshold`（阈值从规则 AST 读回·引擎内零阈值）· `:366 arbitrateByLocus`（同 locus 三类互斥裁决）· `:688 detectChainImpediments` |
| 求解器接线 | **✅ 已接线**（非死代码） | `apps/datacore/src/solvers/service.ts:4285` `if (solverKey === "chain_impediments") return this.chainImpediments(ctx, args);` ← `:3121 private async chainImpediments`；输出形状登记 `:340`；目录 `apps/datacore/src/catalog.ts:148`（带 `answersQuestions` ⇒ QOS 自然语言可路由到它） |
| §9 A1 证据可溯源 | **✅**（`evidence.solverKey`） | `chain-impediment.ts:635 solverKey: CHAIN_IMPEDIMENT_SOLVER_KEY` |
| SEAM 组合测试 | **✅ 在** | `apps/datacore/test/chain-impediment-seam.test.ts:42`（规则发布路径 × 判定引擎，POST `/a/v1/solvers/chain_impediments/invoke`） |
| §4.1 G6 · OTD 聚合率 | **✅ 已实现** | `apps/datacore/src/solvers/aggregates.ts:68 otdBatchRate`（唯一实现）· `:47 customerRequestDay`（`OTD_BASIS=CUSTOMER_REQUEST`）· `:158 otdFromRiskCard` |
| §4.1 G6 · 库存地点×时间序列 | **✅ 已实现** | `aggregates.ts:230 inventoryLocationSeries` · `:283 locationAxis`（带 `dataMode` 诚实标注）· `:312 materialLocationRefs` · `:331 purchaseOrderInbound` |
| §3.2 ④ 段「无供应商交期/MOQ」 | **⚠ PRD 自认按 key 名判、未读实现**（`:418`），实测**数据早就在** | `docs/WO-SANDBOX-SERIES.md §1` 实测记载：`Supplier.leadTime` 真种子（容百 5/当升 7/长远 8/贝特瑞 4 天）、`minOrderQty` 真种子（1000/800/600/1200）、`PurchaseOrder` 落库 `synthetic/service.ts:767`。真缺口是「`minOrderQty`/`onTimeRate` 在 `solvers/` 零消费方」＋清关/IQC 两段无承载 —— 是**接了线没消费方**，不是 PRD 说的「没有」 |

**仍然缺的半边（都在「前端 + 门 + 本体回写」这一侧）：**

| 缺口 | 三分法定性 | 证据 |
|---|---|---|
| **前端零入口** —— 沙盘里没有任何组件调 `chain_impediments` | **接了线接错地方**（只挂了后端 solver + QOS 目录，**没挂沙盘 UI**） | `grep -rn "chain_impediments\|impediment" apps/frontend-shell/src` = **0 命中**；跨语言复搜「卡点/堵点/断点/全链扫描/BOTTLENECK/CONGESTION」也**无一条指向 chain_impediments** —— 前端出现的「断点」全部属于**另一个求解器** `chain_loss_attribution`（`apps/frontend-shell/src/views/sim/chainLineMap.ts:63 CHAIN_LOSS_SOLVER_KEY` · `ChainLineMapView.tsx:165` 把 `empty[]` 渲染成「停运站位 = 断点」）。**两个 chain_* 求解器不是一回事，别混。** |
| §2 两个新事件 `chain.scan_completed` / `chain.impediment_resolved` | **没接线**（零 emit、零订阅） | 全仓（排除 worktree 副本）唯二命中是 `packages/contracts/src/chain-sim.ts:540` 的一句**注释**与 PRD 自己 `:43-44`。`apps/agentcore/src/event-subscriptions.ts` 无这两条 |
| §2/§7.3 五道新门 | **没接线** | `scripts/gate-ledger.json` 里 26 个已登记门（`arg-drop-seam:check` … `view-reachable:check`）**无** `chain-scan-honesty` / `chain-scan-determinism` / `time-coherence` / `series-agg-contract` / `chain-scan-dedup` |
| §2 新断点 `G-TIMEGRAIN-SPLIT` 登记 | **没接线** | `grep -n "G-TIMEGRAIN-SPLIT" docs/SYSTEM-ONTOLOGY.md` = 0 命中 |
| §7.1 建议立 **R19 · 时间自洽** | **⚠ 编号已被占用** | `docs/SYSTEM-ONTOLOGY.md:798` 的 **R19 是「任何非终态状态都必须有明确的终态责任人」**（WO-COORD-YIELD-AND-TERMINAL）。若照 PRD 立"R19 时间自洽"会撞号 —— **实施时必须换号** |
| §6.3 配套①：种子真产 shift 数据 | **接了线没数据**（引擎支持 shift，种子一条没有） | `apps/datacore/src/synthetic/battery.ts:2620-2635 BATTERY_TS_AGG_SPECS` 六条序列 grain 全是 `day`/`week`（`oee_daily_7d`/`yield_daily`/`line_output_daily`/`line_util_daily`/`forecast_dev_daily` = day，`schedule_attainment` = week）；类型上支持 `"shift"`（`:2623`）但**零实例** |
| §6.2 120 桶上限 | **仍在，且未做 `grainDowngraded` 降级标注** | `apps/datacore/src/timeseries.ts:397-399` `bucketCount > 120 → throw`；`grep -rn "grainDowngraded"` 全仓 0 命中 |
| §10.1 点亮判据 A1/A2/A5 | **A2/A5 的门不存在**（见上）；A1 已具备机制 | — |

- **结论**：**◐ 部分实现，且 ⚠PRD 自身陈述与现状不符（三处）**
  - **已做**：契约（`chain-sim.ts`）+ 判定引擎（`chain-impediment.ts` 741 行）+ 求解器接线 + SEAM 测 + 两项聚合缺口（`aggregates.ts`）。
  - **未做**：沙盘前端入口（问题发现层 UI）· 多方案生成与对比（§5.3 `SolutionCandidate` 全链）· 两个事件 · 五道门 · 本体 §4/§7/§8 回写 · shift 档种子。
  - **纠正**：「零代码改动」「暗发」「7,019 行/17 端点/57 求解器」全部已过期，**沙盘不是"没开工"，是"后端做了大半、前端入口没接"**。

- **最小 WO 建议**

  | WO | 🚦 范围边界 | 出口判据 |
  |---|---|---|
  | **WO-B5-1 · 沙盘扫描入口接线**（最高价值·整单不许拆） | 前端 `apps/frontend-shell/src/views/sim/`（新增扫描面板 + 接 `runSolver("chain_impediments")`）· `apps/frontend-shell/src/api/endpoints.ts` · mock `apps/frontend-shell/src/mocks/handlers.ts`。**不碰** `apps/datacore/src/solvers/chain-impediment.ts`（已实现） | SEAM：真载荷跑一次扫描 → 三类阻滞点上屏 → 点某点能看到 `evidence.ruleKey`；改一条规则阈值 → UI 判定真翻面 |
  | **WO-B5-2 · PRD 口径回写**（零风险·先做） | 只改 `docs/PRD-sandbox-redesign.md` §3.1/§3.2/§10.1 与 §7.1 的 R19 号 | 三处 ⚠ 改成实测值；R19 换号；§3.3 的四条「今天做不到」按本审计逐条更新 |
  | **WO-B5-3 · 两事件 + 门** | `apps/agentcore/src/event-subscriptions.ts` · `scripts/check-chain-scan-*.mjs` · `scripts/gate-ledger.json` · `docs/SYSTEM-ONTOLOGY.md` §4/§7/§8 | `gate-ledger:check` 绿；变异反证：改 `chain-impediment.ts` 某阈值读法 → 确定性门真红 |

---

## 2. PRD-sandbox-ontogenesis-buildplan.md

- **它要做什么**：沙盘不硬编码数据/规则/agent/意图 —— 从「一句场景」倒序推演出全部所需制品，
  再经现有「连接器/合成/数据构建发动机」正向长出来、闭环、就绪认证，最后才「可进入推演」。

- **PRD 自称的 AS-IS**：只有一处，且是 §1 的 ⚠ 诚实接地块（`:12`）：
  > 核验 `comprehend.ts:481 comprehendScript`：当前 `comprehend` **不是 LLM 听懂，而是确定性关键词目录匹配**
  > （`ENTITIES.filter(e => matches(script, e.keywords))`），**无命中即兜底 `Order+Base` 最小集（:491）**。
  > …**须把 comprehend 升为 LLM 听懂（关键词目录降为地板兜底）** …这是沙盘倒序发育的**头号前置缺口**。

- **实测现状**

  **⚠ 这条"头号前置缺口"已经被填了 —— PRD 的 AS-IS 陈述与现状不符（方向：实际比 PRD 说的好）**

  `apps/datacore/src/databuilder/service.ts:84-100`：
  ```ts
  private async comprehendPlanBody(ctx, script, seed) {
    if (this.llm) {
      try {
        const core = await this.llm.parseStructured({ …, purpose: "comprehend",
          system: comprehendSystemWithSolvers(SOLVER_KEYS), …, schema: LlmComprehendSchema });
        if (core.objectTypes.length > 0) return assemblePlanBody(core, script, seed, SOLVER_KEYS);
      } catch { /* 无绑定/无 key/解析失败 → 落地板 */ }
    }
    return comprehendScript(script, seed);   // ← 关键词目录已降为地板兜底
  }
  ```
  即 PRD 要求的「LLM 优先 + 关键词降为地板」**已是现行架构**（`service.ts:80-81` 的注释一字对应 PRD 的要求）。
  `comprehendScript` 现位于 `apps/datacore/src/databuilder/comprehend.ts:611`（PRD 引的 `:481` 行号已漂）。

  **其余逐项**

  | PRD 要求 | 实测 | 定性 |
  |---|---|---|
  | 复用 BuildPlan 13 need | ✅ 存在且正好 13 项：`packages/contracts/src/databuilder.ts:208-221` = dataSources / objectTypes / rules / solverNeeds / kbDocs / sliceNeeds / intentNeeds / planNeeds / workflowNeeds / skillNeeds / agentNeeds / mcpNeeds / sceneNeeds | ✅ |
  | ★ 新增 need **`actionNeeds`** | **不存在** —— `grep -rn "actionNeeds" packages/contracts/src apps/datacore/src` = 0 | ❌ 没接线 |
  | ★ 新增 need **`sandboxConfigNeeds`** | **不存在**（同上 0 命中） | ❌ 没接线 |
  | ★ 新增 need **`metricNeeds`** | **不存在**（同上 0 命中） | ❌ 没接线 |
  | ★ `ruleNeeds`（传导子类 PropagationRule） | BuildPlan 里叫 `rules`（`databuilder.ts:210`），**无传导子类**；`PropagationRule` 走的是另一条路（`/a/v1/sim/propagation-rules`，`app.ts:1525/1530`），**未并入 BuildPlan** | ❌ 没接线 |
  | `ModuleProvisioner` 注册表 | ✅ 在：`apps/datacore/src/databuilder/provisioners.ts:24 interface ModuleProvisioner` · `:35 MODULE_PROVISIONERS` · `:118` 遍历 provision | ✅（但只覆盖既有 13 need） |
  | §2 正向管道 ①–⑦ | 底座在（`runStory` / `GapReport` / `runGrowthLoop` / A10 `verifyBuild`），但**入口不是沙盘** —— 沙盘 init 走 `POST /a/v1/sim/sessions`（`app.ts:1385`），与 BuildPlan 管道无连接 | ❌ 两条管道未对接 |
  | §5 门禁 `ontogenesis:check` 三环 | ✅ `scripts/check-ontogenesis.mjs` 在，但断言面是**场景卡**（见 §4），无沙盘条目 | ◐ |

- **结论**：**❌ 未实现（沙盘侧）＋ ⚠PRD 自身陈述与现状不符（comprehend 那条 AS-IS 已过期）**
  本 PRD 的**底座**（BuildPlan / ModuleProvisioner / runStory / GapReport / A10）全部真实存在且在跑，
  但它主张的**沙盘专属增量**（3 个新 need + 沙盘作为发育目标 + 沙盘 init 读发育产物）**一条都没接**。
  这不是"接了线没数据"，是**沙盘和倒序发育管道之间根本没有那根线**。

- **最小 WO 建议**

  | WO | 🚦 范围边界 | 出口判据 |
  |---|---|---|
  | **WO-B5-4 · 三个新 need + provisioner**（整单） | `packages/contracts/src/databuilder.ts`（加 `actionNeeds`/`metricNeeds`/`sandboxConfigNeeds`）· `apps/datacore/src/databuilder/provisioners.ts`（三个 provisioner 注册）· `apps/datacore/src/databuilder/comprehend.ts`（倒推这三类） | 新 need 未注册 provisioner 即测试红（PRD `:30` 已定此纪律）；一句场景 → BuildPlan 里真出现这三类条目 |
  | **WO-B5-5 · PRD AS-IS 回写**（零风险） | 只改 `docs/PRD-sandbox-ontogenesis-buildplan.md:12` | 把「comprehend 是关键词目录」改成「LLM 优先已实现（`service.ts:84`），关键词已是地板」，并把"头号前置缺口"重新定位到真正没接的那三个 need |

---

## 3. PRD-scenario-launcher.md

- **它要做什么**：把 `Scenario` 升为一等主键，做场景启动器（⌘K / 目录墙 / 首页），
  点一张卡把 `presetContext` 注入 QOS **不被反问槽位**，直达答案。关闭本体断点 G-3。

- **PRD 自称的 AS-IS**：有专节 §2「现状与缺口（对照代码）」，六条 C-1…C-6，逐条带 file:line
  （`qos.ts:388/:176`、`orchestrator.ts:212`、`scenarios-catalog.ts:24,60`、`agentcore.ts:171`、
  `ScenesPage.tsx:13`、`server.ts:1367`、`scripts/check-chain-closure.mjs`）。

- **实测现状（逐 C 核）**

  | # | PRD 说缺 | 实测 | 定性 |
  |---|---|---|---|
  | **C-1** 无 `presetSlots` 通道 | **✅ 已补**：`packages/contracts/src/qos.ts:212` `presetSlots: z.record(z.string(), z.unknown()).optional()`（`:210` 注释写明优先级「用户自由文本抽取 > presetSlots > defaultFrom」）；`packages/contracts/src/agentcore.ts:405` 同字段 | ✅ |
  | **C-2** 短路读不到预置槽 | **✅ 已接**：`apps/agentcore/src/router/slots.ts:465`「①.5 场景启动器 presetSlots（PRD-scenario-launcher §3.1）：按槽位名预置」；`orchestrator.ts:1590/:1628` 真消费 `presetSlots` 逐键合并；`orchestrator.ts:1189` 继承路径也读它 | ✅（有 src 消费方，非只 test） |
  | **C-3** 前端无启动器、后端无注入 | **✅ 两半都有**：前端 `apps/frontend-shell/src/components/ScenarioLauncher/ScenarioLauncherPage.tsx`（目录墙，`data-testid="scenario-launcher"`，按域分组 `:39`，每卡「启动」按钮 `:61` 调 `useScenarioLaunch`）＋ `CommandPalette.tsx`（⌘K，`:18` 同一 `launch`）；后端 `apps/agentcore/src/server.ts:2371 POST /b/v1/scenarios/:key/launch` | ✅ |
  | **C-4** 模型倒置（SceneEntry 为主键） | **✅ 已反转**：`Scenario` 是一等对象 —— 仓储 `apps/agentcore/src/persistence/repos.ts:247 scenarios: {…}`；管理面 `server.ts:2675 POST /b/v1/scenarios` · `:2676 PUT` · `:2677 publish` · `:2722 retire` · `:2600 GET /manage` · `:2612 GET /:key/closure` | ✅ |
  | **C-5** 仅列表无「启动」语义 | **✅** 见 C-3（`:2371`） | ✅ |
  | **C-6** `chain:check` 未校验「presetContext 零反问」 | **❌ 仍缺**：`scripts/check-chain-closure.mjs` 通读（110 行）只有三项断言 —— ① 场景卡 solver 在 `SOLVER_KEYS`（`:39-53`）② `SOLVER_OUTPUT_SHAPES` 覆盖（`:56-60`）③ slice-planner 形状/tooth test（`:64-101`）。**无** `presetSlots` / 必填槽 / 零反问任何字样（`grep -n "presetSlots\|零反问\|AWAITING_CLARIFICATION" scripts/check-chain-closure.mjs` = 0） | ❌ 没接线（门未扩） |

  **附加已实现（PRD §4 要求的事件）**：`scenario.published` / `scenario.retired` 真 emit
  （`server.ts:2689`、`:2719`、`:2730`）**且真有订阅方**
  （`apps/agentcore/src/event-subscriptions.ts:44-45`，`invalidates: ["scenarios","scene-entries","intent-catalog"]`）
  —— 不是 #92 那族「发了没人收」。

- **结论**：**◐ 部分实现（5/6 已闭，只差 C-6 上架门）**
  P1/P2/P3 全部落地；**P4（16 张静态 text 场景升级为 solver+agent 解读）** 见 §4 的实测，已另由
  `PRD-scenario-ontogenesis` 接手并做掉。

- **最小 WO 建议**

  | WO | 🚦 范围边界 | 出口判据 |
  |---|---|---|
  | **WO-B5-6 · chain:check 扩第二项**（小·高价值） | 只改 `scripts/check-chain-closure.mjs` ＋（若需）`scripts/gate-ledger.json` 的 `chain:check` 条目。**不碰** `apps/**` | 静态断言 `intent.slots(required) ⊆ presetSlots ∪ deriveableFrom(selectedObjects)`；**变异反证**：删任一张卡的一个 slotPreset → 门真红并打印卡号与缺的槽名 |

---

## 4. PRD-scenario-ontogenesis.md

- **它要做什么**：把场景卡从「静态手装 + 浅门放行 + 缺则静默掉探索」变成 R16 发育闭环的活体器官 ——
  卡 = 胚胎，`grow` 倒序长出全闭包，A10 亲手跑通才 GOVERNED；缺则生长或诚实开工单，**绝不静默"未能产出回答"**。

- **PRD 自称的 AS-IS**：有专节 §0「问题即原则被违反（实测证据 · 本会话亲手跑出）」，六层锚点：
  `agent/loop.ts:215`（探索兜底串）· `main.ts:22-29`（播种守卫挂"包是否存在"）· `server.ts:1775`（`ensureScenarios` 独立懒种）·
  `server.ts:1791`（`scenarioClosure` 只查存在 → 20/20 假绿）· `seed.ts:389-400`（16/20 卡静态文本渲染）。

- **实测现状**

  | PRD 要求 | 实测 | 证据 |
  |---|---|---|
  | §2.2 `growScenario` 倒序发育 | **✅ 已实现**（约 105 行） | `apps/agentcore/src/server.ts:2486 const growScenario = async (a, sc): Promise<ScenarioOntogenesisRun>`；端点 `:2585 POST /b/v1/scenarios/:key/grow` → `:2591 const run = await growScenario(a, sc)` |
  | §2.3 A10 验证即上架门（查存在 → 查跑通） | **✅** | `server.ts:2489 let v = await verifyScenario(a, sc)`；`:2530` 收敛后 `v = await verifyScenario(a, sc)` 重验；成熟度按 `dataOk` 三态裁决（`:2585` 附近 O12 注释） |
  | §2.5 GapReport → runGrowthLoop / GrowthTicket | **✅ 两支都接** | `server.ts:2496 initialAutoDerive`（7 个 gapCode）→ `:2506 runGrowthLoop({maxRounds:6, probe, fill})` → `:2508` 落 `growthLedger`；补不上 → `:2511-2523` 开 `GrowthTicket` + `growth.ticket_opened` 事件 |
  | §2.2 复用既有发育机件不分叉 | **✅ 单源** | `apps/agentcore/src/growth/scenario-grow.ts:17`「场景发育闭环 `growScenario`(O9) 共用，不分叉第二套引擎」· `server.ts:243`「probe/fill 单源（RL3/RL10）：抽到 `growth/scenario-grow.ts`」 |
  | §2.6 相位成熟 PROVISIONAL/ADVISORY/GOVERNED | **✅ 三态真在** | `packages/contracts/src/agentcore.ts:324 ScenarioMaturitySchema` · `:369 maturity` · `:370 lastOntogenesisRun` |
  | §4 `ScenarioOntogenesisRunSchema` | **✅** | `packages/contracts/src/agentcore.ts:328-345` |
  | §5 三事件 | **✅ 全 emit，且订阅登记** | `server.ts:2504 scenario.growth_triggered` · `:2580 scenario.matured \| scenario.gap_detected`；订阅 `apps/agentcore/src/event-subscriptions.ts:46`（`invalidates: ["scenarios","growth-ledger","growth-tickets"]`） |
  | §2.2 O11 切片自动规划 | **✅** | `server.ts:2659`「卡声明的切片自动规划目标（growScenario 据此 OBO 调 planSlice）」+ `growScenario` 内 `for (const st of sc.sliceTargets ?? [])` → `deps.dataCore.ontology.planSlice`；不可达 → `NO_SLICE` + `NEEDS_HUMAN`（**不静默跳过**） |
  | §6 `ontogenesis:check` 扩 6 条 | **◐ 3/6 静态可查 + 3/6 显式让位给运行期测试** | `scripts/check-ontogenesis.mjs:36-43` + `:130-132` 逐条写明：**§6.1**（每张 GOVERNED 卡有 VERIFIED run）与 **§6.5**（未闭环卡 maturity≠GOVERNED 且有 gaps disposition）= **运行期**，本静态门（只读源码/无后端）测不了 → 明确跳过并指名由 `scenario-ontogenesis.test.ts` / `scenario-honest-gate.test.ts` 保证；**§6.4**（sliceTargets 被 resolve_slice 覆盖）= 出厂目录卡未声明该字段 → **N/A 跳过** |

- **结论**：**✅ 已实现（P1/P2/P3 全落地）**，唯一保留项是 §6 门的 3 条断言**按设计**下放到运行期测试
  —— 这是**门自己写明的诚实让位**，不是偷偷漏掉（`check-ontogenesis.mjs:39-43` 逐条给了理由与接手方）。

  ⚠ **但要点名一条残余风险**：§6.1/§6.5 由**测试文件**而非门保证 ⇒ 落进「只有 test 引用」的灰区。
  测试咬的是**函数**还是**链路**，需实跑一次才算复验（本审计只读代码，未起后端跑 grow，**此项未查清 —— 卡在没有真后端**）。

- **最小 WO 建议**（低优先级）

  | WO | 🚦 范围边界 | 出口判据 |
  |---|---|---|
  | **WO-B5-7 · §6.4 从 N/A 转真** | `apps/agentcore/src/scenarios-catalog.ts`（给出厂卡补 `sliceTargets`）＋ `scripts/check-ontogenesis.mjs`（去掉 N/A 分支） | 至少 3 张卡声明 `sliceTargets` 且门真断言覆盖；变异反证：删一条 → 红 |

---

## 5. PRD-seam-arg-drop-audit.md

- **它要做什么**：彻查「路由解析出实体 → slotNames 漏声明 → 计划构建丢参 → 求解器静默默认全部」
  这一整类**静默给错答案**的 bug（信阳→全 12 基地）。三相位：AUDIT 台账 / 逐项 FIX / 立门堵死整类。

- **PRD 自称的 AS-IS**：§2「已知/疑似（预览）」四行表 —— `ceo_bottleneck`（**已确认·WO-Q2 修中**）、
  `ceo_credit_exposure`（疑似）、`ceo_finance_pnl`（疑似）、其余「**待 Phase 1 审计**」。

- **实测现状**

  | 相位 | 实测 | 证据 |
  |---|---|---|
  | **Phase 1 · AUDIT 台账** | **✅ 已产出** | `docs/seam-arg-drop-ledger.md` 存在；本体 `docs/SYSTEM-ONTOLOGY.md:801` 明列「台账 `docs/seam-arg-drop-ledger.md`」，覆盖面记为「全 ceoCaps + sim-planner + intent catalog」 |
  | **Phase 2 · FIX** | **✅ 两 CONFIRMED 已修 + 两波续篇** | 本体 `:983` G-ARG-DROP-SEAM 条目记：① `ceo_credit_exposure` slotNames=[] 丢 `custName` → `extended.ts` `?? customers[0]` 静默落首客户 —— 已修（引擎半报 `AMBIGUOUS_SCOPE` / 标 `scope:ALL`）；② `ceo_whatif` 槽名 `baseId` ≠ 路由发的 `scopeObjectIds` —— 已修。续篇：`WO-BASE-ID-FIDELITY`（base 族两症，`normalizeBaseRef`/`resolveBaseId` 单一出处）＋ 前端半 `RiskBoardView` 的 `base-常州` mock 形态修正 |
  | **Phase 3 · GATE** | **✅ 门已立、已进 `pnpm gates`、有牙** | `scripts/check-arg-drop-seam.mjs` 存在（236+ 行）；`package.json:32` 的 `"gates"` 串里含 `node scripts/check-arg-drop-seam.mjs`；门账 `scripts/gate-ledger.json:22-23` 登记 `alias: "arg-drop-seam:check"`，`:37` 记「en→red 有牙：删某 CEO intent 的 slot（如 `ceo_credit_exposure` 去 `custName`）→ 门红（**已亲测退 1**）」 |
  | 门的两条断言（PRD §3 Phase 3） | **✅ 双断言都在** | `check-arg-drop-seam.mjs:98`（断言① 数据半：路由可解析实体 ⊆ slotNames ∪ 豁免表，含 `{{slots.X}}` 孤儿引用检查）· `:183`（断言② 引擎半哨兵：`credit_exposure` 首客户静默默认惯用法 `.map(props)[0] ?? {}` 回潮即红）· `:225` 豁免登记**逐条带理由** |
  | **本体回写**（PRD §4） | **✅ 三处全回写** | §5 不变量：`SYSTEM-ONTOLOGY.md:801` **R-ARG-FIDELITY**（完整定义 + 守护门 + SEAM 测清单）· §7 门：`:881` `arg-drop-seam:check` 完整条目 · §8 断点：`:983` `G-ARG-DROP-SEAM` **标 ✅ 已修** |
  | SEAM 测（PRD §5） | **✅ 两侧都有** | 本体 `:801` 列：`apps/datacore/test/arg-drop-seam.test.ts`（引擎半·router×plan×solver 接缝驱动）+ `apps/agentcore/test/arg-drop-seam.test.ts`（数据半）+ `base-id-fidelity-seam.test.ts` |

  **⚠ 但这一类 bug 并没有随门关闭而绝迹 —— 门是「守 CEO intent 那一面」，不是守全体求解器**：
  本体 `:1016 G-DERIVED-INTENT-SLOT-DEAF` 记载了**同族第三形态**（16 个派生意图声明零槽位），
  `:1017 G-SOLVER-SCOPE-ECHO`（作用域实参只回显不重算，7 处，已 7/7 闭）与
  `G-SOLVER-SCOPE-DEAF`（实参完全忽略，**2/16 已闭·余 14 处仍开**）。
  其中本体 `:1016` 还记了一处**与 G-ARG-DROP-SEAM 同形的新发现**：
  `lta_gap` 的 `mats.find(...) ?? mats[0]`（`apps/datacore/src/solvers/extended.ts:662`）静默落首个物料。

- **结论**：**✅ 已实现（三相位全交付：台账 + 修复 + 门 + 本体回写 + SEAM 测 + 亲测有牙）**
  这是本批**完成度最高**的一份。

- **残余（不属本 PRD 缺口，属其派生的下一层）**：`G-SOLVER-SCOPE-DEAF` **余 14 处仍开**
  —— 即「用户说的实体真的到达了求解器」已由本 PRD 保证，但「求解器真按它重算」在 14 处仍未做到。
  本体 `:1016` 已把它单列为欠账 #118 一线，不重复立单。

---
