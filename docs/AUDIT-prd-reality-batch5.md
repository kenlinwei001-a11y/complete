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
  | **C-6** `chain:check` 未校验「presetContext 零反问」 | **◐ 门在，但不在 PRD 指定的位置**（见下方「⚠ 一次自我纠错」） | ◐ 接了线接错地方 |

  **⚠ 一次自我纠错（本审计自身踩了「grep 结果不是结论」，追一层后改口）**

  我先按 PRD §3.6 的字面去查 `scripts/check-chain-closure.mjs`：通读 110 行，只有三项断言 ——
  ① 场景卡 solver 在 `SOLVER_KEYS`（`:39-53`）② `SOLVER_OUTPUT_SHAPES` 覆盖（`:56-60`）
  ③ slice-planner 形状/tooth test（`:64-101`）；`grep "presetSlots|零反问|AWAITING_CLARIFICATION"` = **0**。
  据此**差点写下「❌ 没接线」**。

  但 `docs/SYSTEM-ONTOLOGY.md:923` 的 G-3 条目白纸黑字写着「+ **零反问门**（20/20）」——
  于是再追一层，找到它：**`apps/agentcore/test/scenarios-wiring.test.ts:65`**
  ```ts
  it("R11 零反问：每张场景卡 presetContext 注入后必填槽位全满足（fillSlots 无 missing）", async () => {
    for (const card of SCENARIO_CATALOG) {
      const { missing } = await fillSlots(intent, {}, context, ontology, ctx);
      expect(missing.map((m) => m.name), `场景 ${card.sNo}(${card.intentKey}) 启动后仍反问槽位: […]`).toEqual([]);
  ```
  且 `:57-63` 的注释**明写为什么换了实现位置**：「此门以**运行时真跑 `fillSlots`** 校验（比静态解析更可靠），
  故障注入（删某卡 slotPreset / 去掉 objectRef 的 defaultFrom）即变红」；
  并且它用的是**真本体 mock 客户端**（`createMockDataCore`，`:69-71` 注释：宽容桩「只能证预置接到了槽名，
  证不了预置的值真解析得出对象」）。**这比 PRD 要求的静态子集检查更强。**

  **诚实定性**：这条不是「只有 test 引用 = 已排练」那族假绿 —— 它守的是**声明数据的一致性**，
  本来就没有生产代码路径可接，测试就是它唯一合理的宿主，且 `pnpm -r test` 是交付门的一部分。
  但它**确实**没进 `pnpm gates`（`package.json:32` 的 23 个门里无此项），
  也没在 `scripts/check-chain-closure.mjs` 里 —— 所以 PRD §3.6/§7 的字面承诺「`chain:check` 扩第二项」
  **未兑现**，兑现的是一个**位置不同、判据更强**的等价物。

  **附加已实现（PRD §4 要求的事件）**：`scenario.published` / `scenario.retired` 真 emit
  （`server.ts:2689`、`:2719`、`:2730`）**且真有订阅方**
  （`apps/agentcore/src/event-subscriptions.ts:44-45`，`invalidates: ["scenarios","scene-entries","intent-catalog"]`）
  —— 不是 #92 那族「发了没人收」。

- **结论**：**✅ 已实现（6/6，其中 C-6 以更强的运行时门形态兑现，位置与 PRD 字面不同）**
  P1/P2/P3 全部落地；**P4（16 张静态 text 场景升级为 solver+agent 解读）** 见 §4 的实测，已另由
  `PRD-scenario-ontogenesis` 接手并做掉。
  ⚠ 但本体 `:923` 的 G-3 条目仍写「**待**：前端 ⌘K/目录/首页启动器 + 场景编辑器(P3)」——
  **这一句已过期**：`ScenarioLauncherPage.tsx` 与 `CommandPalette.tsx` 都在（见 C-3）。**建议回写本体。**

- **最小 WO 建议**（低优先级·纯治理）

  | WO | 🚦 范围边界 | 出口判据 |
  |---|---|---|
  | **WO-B5-6 · 零反问门登记 + 本体回写** | `scripts/gate-ledger.json`（把 `scenarios-wiring.test.ts` 的零反问门登记为运行时门）· `docs/SYSTEM-ONTOLOGY.md:923`（去掉已过期的「待：前端启动器」）· `docs/PRD-scenario-launcher.md:81`（把 §3.6 的落点从 `chain:check` 改为实际位置）。**不碰** `apps/**` | `gate-ledger:check` 绿；本体与 PRD 两处字面与实测一致 |

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

## 6. PRD-segment-scoped-gap-attribution.md

- **它要做什么**：Bug PRD。储能达成率（`seg_attain_ess`）的根因下钻叶层混入乘用车/商用车整车厂客户，
  原因是 `gap_attribution` 的结构反向分摊回落路径把**全部 OPEN 订单**不分细分铺进基地×订单叶。

- **PRD 自称的 AS-IS**：§1 整章 + §1.6「复现（亲手真跑·非只看绿测试）」。
  根因锚点 `service.ts:1340` `const affected = orders.filter((o) => str(o.status) === "OPEN");`；
  亲跑观测（seed 42·port 14031）：订单叶 24 张，其中 15 张整车厂/商用车，仅 9 张储能，叶 `businessType=None`。

- **实测现状**：**PRD 推荐的「方案 A（种子建模 + 字段过滤）」全部落地，且多修了一处正交回归。**

  | PRD 要求 | 实测 | 证据 |
  |---|---|---|
  | §4.1 主修：按目标业态过滤 | ✅ 逐字落地（行号已从 1340 漂到 1553） | `apps/datacore/src/solvers/service.ts:1553-1573`，含 `SEG_SUFFIX_BT`（`:1557`）· `segSuffix` 正则（`:1559`）· `targetBusinessType` 优先读 `m.businessType`（`:1560`） |
  | §4.2 加固(a)：种子给 `Metric` 补 `businessType` | ✅ **方案 A 真采了** | `apps/datacore/src/synthetic/battery.ts:3975` `businessType: businessTypeOfSegment(d.segment as string), // WO-SEG-ATTR-SCOPE：细分升 Metric 一等字段`；另 `:3895` 给 `DemandSegment` 同源派生；`businessTypeOfSegment` 定义 `:135` |
  | §6.1 SEAM 门 | ✅ 文件存在 | `apps/datacore/test/gap-attribution-segment-scope.test.ts` |
  | §7 本体回写 §8 新增 `G-SEG-ATTR-CROSS-SEGMENT` | ✅ 已登记（2 处命中） | `docs/SYSTEM-ONTOLOGY.md` |
  | §4.4 非细分指标字节兼容 | ✅ 短路仍在 | `service.ts:1572` `(!effectiveBusinessType \|\| …)` |

  **⚠ 一处 PRD 里没有、实测多出来的语义（不是缺陷，是后续回归的修法，值得记账）**

  `service.ts:1565-1570` 记载了一次**回归修复**（治 `0079ba31` 回归，2026-07-27，登记为 `G-SEG-ATTR-BASE-SCOPE`）：
  ```ts
  // 业态过滤**仅对全局细分达成率下钻**（无 scope.baseId）生效；当 scope.baseId 存在（每基地根因推演树·
  // RiskBoard RootCausePanel）→ **不套业态过滤**：base 视图与业态正交，须展示该基地**跨全部业态**订单。
  const effectiveBusinessType = scopedBaseId ? undefined : targetBusinessType;
  ```
  即：**PRD §4.1 那个无条件过滤器实际上会把非储能基地在储能默认指标下打成空树**，
  上线后被逮住并加了 `scopedBaseId` 逃生门。PRD 文本**未记载**这一条 —— 读 PRD 的人会以为过滤是无条件的。

- **结论**：**✅ 已实现（方案 A 全采）**，唯 PRD 文本未反映后续 base 作用域正交修。

- **最小 WO 建议**（可选·文档级）：把 `G-SEG-ATTR-BASE-SCOPE` 的裁决补进 PRD §4.1 后（只改 `docs/PRD-segment-scoped-gap-attribution.md`）。

---

## 7. PRD-self-driving-qos-data-foundation.md

- **它要做什么**：不是新建 PRD，是**评审批注 + 开发顺序落档**。核心主张：现有 growth/A18 是**无边界生成**
  （能跑通、会编造业务事实），本 PRD 的价值 = 用**业务词表(硬/软) + 语义目录 + 拉取靶**把生成框住。
  交付物是 **DF.0–DF.15 的 To-Do 表**。

- **PRD 自称的 AS-IS**：AS-IS 是本文件的主体 —— §2「现状对照」+ §2.1「关键纠正」+
  **§2.2 逐句 grep 核实账本**（18 行，PRD 自己把「PRD 声明 vs grep 实测 vs 裁定」摆成三栏，
  并当场裁掉 6 条 PRD 自身的错误：growth.ts 当新建实则已存在 / 搞错服务 / 迁移号 014 撞车 / 锚点不存在 / BP-4 误报）。
  这份 AS-IS 是本批**质量最高**的一份。

- **实测现状（逐 DF 核）**

  | DF | 要求 | 实测 | 证据 |
  |---|---|---|---|
  | DF.1 | Boundary 契约 + 单一来源读取层（keystone） | **✅ 已实现，但落点与 PRD 不同** —— PRD 说建 `apps/datacore/src/synthetic/boundary.ts`，**该文件不存在**；实际单一来源落在 **contracts** 里 `packages/contracts/src/base-registry.ts`（前后端同源，比 PRD 的落点更符合 R1 contracts-only-shared） | `base-registry.ts:2` 「DF.1 单一来源基地册（GenerationBoundary Part A · VOCAB+TOPOLOGY 接地脊柱）」 |
  | DF.2/DF.3/DF.4 | 提升 BASES / SEG_PRICE / ROOT_LIB 等 | **✅** | `base-registry.ts:32`（DF.3 细分册）· `:98`（DF.4 规划目标阈值册） |
  | DF.5 | 语义目录：`description` + `GET /a/v1/catalog/search` | **✅ 两半都在** | `apps/datacore/src/domain.ts:236` 「DF.5 语义目录：属性业务语义描述…喂生成接地 prompt + /catalog/search 检索」· 端点 `apps/datacore/src/app.ts:1945 app.get("/a/v1/catalog/search", …)` |
  | DF.6 | 拉取靶 keystone `VIEW_DEFS.outputFields` | **✅** | `apps/datacore/src/databuilder/pull-target.ts:17-26`（从视图集派生拉取靶登记表，仅声明了 `solverKey` + `outputFields` 的视图入册·确定性排序）· 视图侧声明 `apps/datacore/src/synthetic/service.ts:1550` |
  | DF.7 | 影响图（改前查崩哪些） | **✅** | `packages/contracts/src/base-registry.ts:308` `BOUNDARY_IMPACT`「把"改某条边界册会波及谁"显式登记」；`apps/datacore/src/app.ts:110` import 真消费 |
  | DF.8 | **生成接地 hook（PRD 核心论点）** | **✅ 全链接通，且传的是真数据** | `apps/datacore/src/solvers/llm-gen.ts:14-15`（`vocab?: string[]`）· `:23 checkGrounding`（越界判定）· `:54-56`（注入 prompt「业务词表…越界将被拒」）；消费方 `apps/datacore/src/solvers/service.ts:544`；**生产实参**（关键）`service.ts:474-476`：`const vocab = await this.deriveGroundingVocab(ctx); … registerProvisionalSolver(ctx, spec.key, draft, { vocab })`，入口 `app.ts:2749 POST /a/v1/solvers/generate` |
  | DF.9 | 真人正门精确数据请求（HARD/SOFT 分流） | **✅ 已实现，落在 AgentCore（PRD 自己纠正过的正确落点）** | `apps/agentcore/src/growth/data-boundary.ts:4`「DF.9 真人正门 HARD/SOFT 分流」· `:27` 时序维「HARD（真实体）：DataRequest 声明须补真实逐日时序…**绝不伪造真实体时序**」· `:32 dataRequest?: DataRequest`；真消费方 `apps/agentcore/src/growth/scenario-grow.ts:58/66` |
  | DF.10 | Boundary 版本化 + 进 R6 key | **✅** | `packages/contracts/src/base-registry.ts:382/409 boundaryVersion()`；端点 `apps/datacore/src/app.ts:1979 GET /a/v1/boundary/version` |
  | DF.11 | 边界自动抽 | **✅（词表侧）** | `service.ts:473` 注释「DF.11：词表自本体自成长」+ `deriveGroundingVocab`（`service.ts:489`），`staticGroundingVocab`（`:479`）作兜底基底 |
  | DF.12 | 绑定面板 | 源码里有 DF.12 标记 | 见下方枚举 |
  | DF.13 | 需求可溯 / 外协红线单源 | **✅**（编号被复用给了 `OUTSOURCE_REDLINE`） | `base-registry.ts:117`「DF.13 外协比例红线单一来源 `OUTSOURCE_REDLINE`（规则 **C08**）」 |
  | DF.14 / DF.15 | A/B 归一评估 · C/D delta | **未查清** —— 源码里无 `DF.14`/`DF.15` 标记；这两项是「评估类」任务，可能已在别处以别的名义完成，也可能没做。**卡在：评估类任务没有可 grep 的产物锚点。** | `grep -rhno "DF\.[0-9]+"` 全仓 src 结果 = `DF.1 DF.3 DF.4 DF.5 DF.6 DF.7 DF.8 DF.9 DF.10 DF.11 DF.12 DF.13`（**无 DF.0 / DF.2 / DF.14 / DF.15**） |

  **⚠ 一次工具骗人的实例（记下来给下一个人）**：我先 `grep -rn "vocab:" apps/datacore/src` 想找 DF.8 的
  生产调用点，**结果只有定义行**，差点判成「接了线没数据」。真实调用点是
  `service.ts:475` 的 **对象字面量简写** `{ ...spec, vocab }` 与 `:476` 的 `{ vocab }` ——
  **简写属性 grep `"vocab:"` 一个都看不见**。这是 CLAUDE.md 铁律 0.5 第 3 条「间接调用」的一个新形态，
  建议补进那条清单。

- **结论**：**✅ 已实现（DF.1–DF.13 全部落地；DF.14/DF.15 未查清）**
  ⚠ 并附一条 **PRD 自身陈述与现状不符**：§4 Phase 0 的 DF.1 落点写「建 `synthetic/boundary.ts` 单一来源」，
  实际落在 `packages/contracts/src/base-registry.ts` —— **实现比 PRD 的方案更对**（跨包单源符合 R1），
  但照 PRD 字面去找文件会扑空。

- **最小 WO 建议**：只有文档级 —— 把 §4 的 DF.1 落点改成 `packages/contracts/src/base-registry.ts`，
  并给 DF.14/DF.15 一个可核实的产物锚点（否则永远无法判定完成）。

---

## 8. PRD-simulation-sandbox.md

- **它要做什么**：把散落的仿真积木（模拟时钟 / what-if / 派生 / 时序求解器 / 动作 / 就绪闭包）
  整合成**一个有状态、可交互、可回滚、可分支的推演沙盘**，且**行业无关、前端可配**（R14 去锂电锁死）。
  新登记断点 `G-11`。

- **PRD 自称的 AS-IS**：§0「问题与定位（对照参考产品的"推演沙盘"能力缺口）」——
  「**积木齐全，缺整合层**」，逐条给了 `simclock.ts:80` / `generic_inference` / `risk_timeline` /
  `views/sim/` 的现状，并把缺口收敛为四项：① 统一交互式沙盘会话 ② 时序风险传导 ③ checkpoint/回滚/分支/KPI 对比 ④ 仿真就绪认证。

- **实测现状（逐项核）**

  | PRD 项 | 实测 | 证据 |
  |---|---|---|
  | §3.1 `SimSession` 一等对象 + 端点 | **✅ 21 条端点全在** | `apps/datacore/src/app.ts:1385`(sessions) `:1410`(world) `:1415`(tick) `:1479`(act) `:1488`(checkpoint) `:1497`(rollback) `:1506`(branch) `:1519`(compare) `:1669`(certification) `:1677`(scope-precheck) 等 |
  | §7 新增表 `sim_sessions`/`sim_checkpoints` | **✅ 迁移在** | `apps/datacore/migrations/026_sim_sessions.sql` |
  | §3.2 时序传导引擎 `PropagationRule`（系数+延迟） | **✅ 真引擎** | `apps/datacore/src/sim/propagation.ts:219 export function propagateTick`；接线 `app.ts:53` import → `app.ts:1415` tick 路由内调用；规则 CRUD `app.ts:1525/1530 /a/v1/sim/propagation-rules` |
  | §3.3 沙盘态 Action（`sandbox=true` 不写真值） | **✅** | `app.ts:1479 POST …/act`；`app.ts:1377` 注释「act=模拟态不写真值（R4）」 |
  | §3.4 checkpoint/rollback/branch/compare | **✅ 四条齐** | `app.ts:1488/1497/1506/1519` |
  | §3.5 就绪认证 L0-L4 + Trial Tick + 雷达 | **✅** | `apps/datacore/src/sim/certification.ts`（`:8` 「一次 Trial Tick（`ontology-core recompute`）」）· 端点 `app.ts:1669` |
  | §4.1 `SandboxViewConfig` 配置驱动 | **✅ 端点在** | `app.ts:1538 GET /a/v1/sim/view-config` |
  | §5 AI 指挥台（QOS + MCP `sim.*` 工具） | **✅ 四个工具真注册** | `apps/agentcore/src/tools/registry.ts:350`(sim_init) `:362`(sim_tick) `:457 SIM_COMMANDER_TOOLS = ["sim_init","sim_tick","sim_world","sim_certify"]`；注入 `apps/agentcore/src/agent/prompts.ts:184-188`；门控 `apps/agentcore/src/router/orchestrator.ts:118/645`（`sim.commander` ∧ `sim.sandbox`） |
  | §4.2 前端主视图 | **✅ 36 文件 / 15,261 行**（见 §1.2） | `apps/frontend-shell/src/views/sim/` |
  | §3.1 事件 7 个 | **◐ 只 emit 了 2 个** | 在：`app.ts:1397 sim.session_created` · `app.ts:1516 sim.branched`。**缺**：`sim.ticked` / `sim.acted` / `sim.checkpointed` / `sim.goal_evaluated` / `sim.certified`（全仓 0 emit）⇒ PRD §5「事件 `sim.ticked/acted/branched`(outbox)──SSE──> 前端实时刷新节点色/传导动画/KPI/时间轴」这条数据流**只成立三分之一** |
  | §3.1 / §3.6 目标-冲突引擎 `POST …/goals` | **❌ 没接线** | `grep -n "sim/sessions/:id/goals\|goal_evaluated" apps/datacore/src/app.ts` = 0 |
  | §3.6 **WebSocket 实时连接器** | **❌ 没接线** | `grep -rn "websocket" apps/datacore/src/connectors/` = 0 命中 |
  | §8 门禁 `sim-readiness:check` | **◐ 脚本在，未进 `pnpm gates`** | `scripts/check-sim-readiness.mjs` 存在（另有 `check-sim.mjs` / `check-genuine-sim.mjs`），但 `package.json:32` 的 `"gates"` 串（23 个门）**不含任一 sim 门**；`grep -n "sim-readiness\|genuine-sim" package.json` = 0 ⇒ 三个 sim 门**都得手动跑**（`scripts/gate.sh:51` 佐证：「genuine-sim（不在 gates 列表）」） |
  | §9 验收 1「**两行业证明**」（核心，证去锂电锁死） | **❌ 未做到** | `apps/datacore/src/synthetic/service.ts:134` `if (industry === "battery-manufacturing") return BATTERY_TEMPLATE;` —— 非 battery 行业走 `:139` 「Unknown industry → **LLM-generated** template」。即第二行业模板**不是预置的、需 LLM 现生成**，无法作为确定性的 R14 证明。仓内 `synthetic/` 下无第二份手写行业模板（`builtin-templates.ts` 需另核，本次**未查清**） |
  | §8 `G-11` 本体登记 | **✅ 已登记且在册** | `docs/SYSTEM-ONTOLOGY.md:933`（G-11 条目）· `:899`「推演沙盘门（G-11 · 增量 0 登记契约 · **脚本待各增量新建并入 `pnpm gates`**」——本体自己就写着门还没并入 |

- **结论**：**◐ 部分实现（P1/P2 基本落地，P3 抽象证明 + 实时源 + 门并入未做）**
  - **已做（约 80%）**：SimSession 全套端点 + 迁移 + 传导引擎 + 沙盘态 Action + checkpoint/rollback/branch/compare
    + L0-L4 认证 + view-config + MCP `sim.*` 四工具 + 前端 15k 行。
  - **未做**：5/7 事件（⇒ SSE 实时刷新链路只通三分之一）· goals 目标-冲突端点 · WebSocket 实时连接器 ·
    三个 sim 门未进 `pnpm gates` · **第二行业证明（PRD 自称的"核心验收"）**。

- **最小 WO 建议**

  | WO | 🚦 范围边界 | 出口判据 | 优先 |
  |---|---|---|---|
  | **WO-B5-8 · 补 5 个 sim 事件 + SSE 联动**（整单） | `apps/datacore/src/app.ts`（tick/act/checkpoint/certification 四处 emit）· `apps/agentcore/src/event-subscriptions.ts`（订阅登记）· `docs/SYSTEM-ONTOLOGY.md` §4。**不碰** `sim/propagation.ts` | SEAM：前端点 tick → 后端 emit `sim.ticked` → SSE → 前端 KPI 真变；D-29 每个新事件都有订阅方（否则又是「发了没人收」） | 高 |
  | **WO-B5-9 · 三个 sim 门并入 `pnpm gates`** | 只改 `package.json` 的 `"gates"` 串 + `scripts/gate-ledger.json` + `docs/SYSTEM-ONTOLOGY.md:899`。**不碰** `apps/**` | 三个门在 CI 里真跑；变异反证：破坏一条沙盘诚实性 → 门红 | 高（成本极低） |
  | **WO-B5-10 · 第二行业模板（R14 硬证明）** | `apps/datacore/src/synthetic/builtin-templates.ts`（加一份手写非锂电模板）· 对应 SEAM 测。**不碰** `battery.ts` | 同一前端同一引擎、只换本体 + `SandboxViewConfig`，第二行业能 init→tick→传导→branch→compare；`debattery:check` 沙盘维绿 | 中（PRD 自称核心，但工作量大） |

---

## 9. PRD-skill-compiler-registry.md

- **它要做什么**：Skill 编译器（静态校验）+ 注册中心（生命周期/版本）+ `.skill` 包与签名 + API 面复用约束。
  自称「本文只定义…不重复定义字段语义」，状态 **DRAFT**。

- **PRD 自称的 AS-IS**：§2 三节，是本批**取证最扎实**的 AS-IS：
  - §2.1「今天真有的（可复用，不重造）」16 行，逐行 file:line。
  - §2.2「今天确实没有的」11 行，每行给**核实方式**（可复跑的 grep/find）。
  - §2.3「三处**声明了没接线**实测」——(a) `probeMissingRefs` 已证可用但 skill 发布路径没接；
    (b) 该探针是 **fail-open** 的，直接当硬门会造出「DataCore 挂了就全部放行」；
    (c) Skill 引用边抽取函数 `extractRelations` **有测试、有实现、零生产调用方**
    → 提出登记 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR`。

- **实测现状**：**PRD 提出的东西一件没做；PRD 自己指出的三处缺口今天全部仍在。**

  | PRD 交付物 | 实测 | 证据 |
  |---|---|---|
  | `SkillRuntimePackage` / `SkillPackageManifest` / `SkillCompileReport` 契约 | **❌ 0 命中** | `grep -rn "SkillRuntimePackage\|SkillPackageManifest\|SkillCompileReport" packages/contracts/src apps/agentcore/src scripts docs/SYSTEM-ONTOLOGY.md`（排除 PRD 自身）= 空 |
  | `skill.compiled` 事件 | **❌ 0 命中** | 同上 |
  | 门 `skill-compiler:check` | **❌ 0 命中**；`package.json:32` 的 23 个门里无 skill 门 | 同上 |
  | 暗发特性 `skill.compiler`（双注册） | **❌** `apps/agentcore/src/features/registry.ts` 无此 key | grep = 0 |
  | `SKILL_REFERENCE_KINDS` 覆盖 `tool`/`mcp` | **❌ 仍是八种，不含 tool/mcp** | `packages/contracts/src/agentcore.ts:216` 逐字未变 |
  | `supersedes`/`owner`/`domain`/`category`/`riskLevel` | **❌ 五项全无** | `packages/contracts/src/agentcore.ts:236-262` 逐字段核对 |
  | 新端点 `/b/v1/skills/…/compile\|package\|inspect` | **❌** | grep = 0 |

  **PRD §2.3 的三条缺口，逐条复验（行号有漂移，代码未变）**

  | # | PRD 断言 | 今天复验 | 定性 |
  |---|---|---|---|
  | (a) | `probeMissingRefs` 只接 workflow（`server.ts:1004`）与 agent（`server.ts:686`），**skill 发布路径不调用** | **仍然如此**（行号漂 4）：`apps/agentcore/src/server.ts:690`（agent，`objectTypes`）· `:1008`（workflow，`solverKeys/ruleKeys`）· 定义 `apps/agentcore/src/resources.ts:11`。skill 发布路径 `server.ts:1235` 起通读，只有 lint（`:1246`）+ eval 计数/分类 + probe **三段**，**无 `probeMissingRefs`** | **接了线接错地方**（探针在，挂载点少一个） |
  | (c) | `extractRelations` 零生产调用方 | **仍然如此**：`grep -rn "extractRelations" apps packages scripts --include=*.ts`（排除 `dist`/worktree）= 定义 1 处（`apps/agentcore/src/dril/resource-projector.ts:296`）+ 测试 3 处（`apps/agentcore/test/dril-registry.test.ts:11,177,204`）。**零 src 调用方** | **没接线**（= 假绿第 9 形态：实现有、测试有、且是绿的，零生产调用方） |

  ⇒ 本体 §2H 声称的「skill→refs 写入 `resource_relations`，供影响分析」，
  在**已接线的那条路上今天依然不成立**；`G-SKILL-REFGRAPH-DEAD-EXTRACTOR` **仍开**。

- **结论**：**❌ 未实现（DRAFT 未动工）**，但 ⚠ 其 AS-IS **今天仍然全部准确** —— 这份 PRD 的取证部分
  比它的设计部分更有价值，**别当废纸**。

- **最小 WO 建议**（按投入产出排序）

  | WO | 🚦 范围边界 | 出口判据 | 性价比 |
  |---|---|---|---|
  | **WO-B5-11 · skill 发布接引用探针**（PRD §2.3(a)·**极高性价比**） | 只改 `apps/agentcore/src/server.ts`（skill publish 路径 `:1235-1290` 加一次 `probeMissingRefs`）+ `apps/agentcore/src/resources.ts`（给 publish 用的 fail-**closed** 变体）+ 一条 SEAM 测。**不碰** contracts、不碰 compiler | green→red→green：`references:[{kind:"solver",key:"不存在"}]` → 发布 422 `SKILL_REF_UNRESOLVED`；改回 → 通过。**注意 §2.3(b)**：`resources.ts:22-46` 三段查询各自 `try/catch` fail-open + `if (known.size>0)` 守卫，直接复用会变成「DataCore 挂了就全放行」——必须显式换语义 | ⭐⭐⭐ **一条线，不是一道门**（PRD 原话：这一条曾被错报成「造一道门」，把工作量歪掉） |
  | **WO-B5-12 · 接 `extractRelations` 到生产投影** | 只改 `apps/agentcore/src/dril/resource-registry.ts:220`（把 `extractResourceRelations` 换/并成 `extractRelations`）+ SEAM 测。**注意 PRD §2.3(c) 末段的坑**：`resource-registry.ts:224-226` 会用 `present` 集合过滤掉两端不在册的边 ⇒ **悬挂引用会静默消失而非标红**，所以关系图不能当校验器用 | `GET /b/v1/resources/rule/C08/relations` 的 `inbound` 里真出现引用 C08 的 skill | ⭐⭐ |
  | WO-B5-13 · 编译器/包/签名 | 全新模块 | —— | ⭐ 大工程，PRD 自己也标 DRAFT；建议**先做 11/12 两条线**，再评估是否需要编译器 |

---

## 10. PRD-skill-contract-dsl.md

- **它要做什么**：定义 Skill 的**契约与 DSL 形态**（12 层 → 字段落位、引用模型、内联 vs 引用边界、
  `execution` 详规、包结构 → `resources[]` 映射、命名红线、门禁）。明确**不交付**迁移脚本/Compiler/CLI/路由改造。

- **PRD 自称的 AS-IS**：§2「基线盘点：既有 `SkillDefinitionSchema` 逐字段处置」（18 字段逐行给活消费方）
  + **§11.1「本会话亲手核实」22 行**（每行给 file:line 或可复跑命令）
  + **§11.2「未核实」7 行**（明确不装懂）。三栏分明，**没有第三栏**（PRD 原话）。

- **实测现状**：**契约层一字未动；PRD 自己列的 AS-IS 事实今天逐条仍然成立。**

  | PRD §11.1 断言 | 今天复验 | 结果 |
  |---|---|---|
  | `maxBudgetRounds` **零消费方** | `grep -rn "maxBudgetRounds" apps packages --include=*.ts`（去 test/dist/worktree）= **仅 `packages/contracts/src/agentcore.ts:260` 一条** | ✅ 仍然零消费方 |
  | 7 个种子 Skill 的 `resources` 全空 | `grep -c "resources: \[\]" apps/agentcore/src/mocks/seed.ts` = **7** | ✅ 仍全空 |
  | `FeatureDef.bindings` **无 `skills`** | `packages/contracts/src/features.ts:16-22` = `intents` / `solverKeys` / `apiTags` 三项 | ✅ 仍无 |
  | lint 上限 200/3000 vs 契约 400/50_000 **不一致** | `apps/agentcore/src/skill-lint.ts:45-46`（`SUMMARY_MAX = 200` / `BODY_MAX = 3000`）vs `packages/contracts/src/agentcore.ts:242-243`（`.max(400)` / `.max(50_000)`） | ✅ 仍不一致 |
  | 发布路径只有 lint + eval + probe 三段，**无跨注册表引用校验** | `apps/agentcore/src/server.ts:1235` 起通读 | ✅ 仍如此（同 §9） |
  | `validateRefResolution` 只校验 `kind==="skill"` | `apps/agentcore/src/skill-lint.ts:176` | ✅ 仍如此 |

  | PRD 提出的新层 | 实测 | 证据 |
  |---|---|---|
  | §4.1–4.8 `identity` / `businessIntent` / `trigger` / `execution` / `requires` / `progress` / `acceptance` | **❌ 一个都没有** | `SkillDefinitionSchema`（`packages/contracts/src/agentcore.ts:236-262`）今天仍是 **18 个字段**，与 PRD §2 的基线表**逐字相同** |
  | §4.6 `outputEnforcement` | **❌ 0 命中** | `grep -rn "outputEnforcement\|goldenCases\|businessIntent"` = 空 |
  | §10.1 新门（引用可校验·静态半） | **❌** 同 §9，无 skill 门 | — |
  | §10.2 SEAM S1–S8 | **❌ 一条都没有** | — |

- **结论**：**❌ 未实现（契约零变更）**；⚠ 与 §9 同族 —— **AS-IS 部分今天 100% 仍准确，设计部分零落地**。

- **最小 WO 建议**（按投入产出排序 · 都是「小而真」的接消费方，不是造 DSL）

  | WO | 🚦 范围边界 | 出口判据 | 性价比 |
  |---|---|---|---|
  | **WO-B5-14 · lint 与契约上限归一**（半小时的活） | `apps/agentcore/src/skill-lint.ts:45-46` 与 `packages/contracts/src/agentcore.ts:242-243` 二选一为单源（推荐 lint 常数从 contracts import）。**不碰**其它字段 | 双上限只剩一处；变异反证：改 contracts 的数 → lint 行为跟着变 | ⭐⭐⭐ |
  | **WO-B5-15 · `maxBudgetRounds` 接消费方** | `apps/agentcore/src/engine.ts`（把 skill 的 `maxBudgetRounds` 归一到 `AgentBudget.maxRoundTrips`，`packages/contracts/src/qos.ts:611-612`）+ 一条**效果层** SEAM（PRD §10.2 S2）。**不碰** contracts 字段定义 | **效果层**判据：改某 Skill 的 `maxBudgetRounds` → 该类题**实际探索轮次真变**（观测 SSE iteration / `AgentRunRecord`），**不是「字段被读出来」** | ⭐⭐⭐ 这是本批唯一一个「字段声明了三个月零消费方」的确凿死字段 |
  | **WO-B5-16 · `outputSchema` 接校验消费方** | `apps/agentcore/src/engine.ts` + contracts 加 `outputEnforcement`（默认 `off` 保字节兼容） | S4：`block` + `required` 加一字段 → 缺该字段的答案真被拦；`off` 下逐字节等同今日 | ⭐⭐ |
  | WO-B5-17 · 12 层全量 DSL | 全契约重写 | —— | ⭐ 建议先做 14/15/16，把「有字段没消费方」的账先还掉 |

---

## 11. PRD-skill-crossreview.md

- **它要做什么**：**不是 PRD，是审查记录** —— 五份 Skill PRD 并线前的跨文档对照审查，
  只记冲突/重复/传播性错误/口径分歧（C1–C6），不复述任何单份内容。

- **PRD 自称的 AS-IS**：本文件**整体就是 AS-IS**，且带 **§9 收口记录**（自报哪几条已落地）。
  这一节我逐条复验了。

- **实测现状（逐条核 §9 收口记录 —— 它自称的，我一条都不放过）**

  | 条 | §9 自称 | 实测复验 | 判定 |
  |---|---|---|---|
  | **C1** 命名裁决（采纳 `requires` 结构，旧名降解析期别名） | ✅ 已裁决，写入 `SPEC-industrial-skill.md` §9.1 | ✅ **属实**：`docs/SPEC-industrial-skill.md:421`「**`references[]` / `dependsOn[]` 保留为「解析期输入别名」**：读入即归一折进 `requires`」。⚠ 但**只落在 SPEC 文档里** —— `packages/contracts/src/agentcore.ts:216` 的 `SKILL_REFERENCE_KINDS` 与 `SkillDefinitionSchema` **代码零变更**（见 §10），裁决尚未进代码 | ✅ 文档层属实 |
  | **C2** 两道重名门合并为 `skill-refs:check` | ✅ 随 C1 收口 | **无法复验**（两道门都还不存在，`grep skill-refs` = 0）——**合并的是纸面承诺，不是代码** | ◐ 纸面 |
  | **C3** 门总数 16→33 无人认领的合并门账 | 🟡 **仍无人认领** | ⚠ **这一条已经过期了 —— 账已经立了**：`docs/PRD-gate-ledger.md`（v1.0·2026-08-03·上游明写「`docs/PRD-skill-crossreview.md` §3（C3）与 §9 · 任务 #95」），且**已落地成机器可核的账**：`scripts/gate-ledger.json`（**44 条**登记）+ `scripts/check-gate-ledger.mjs` + 已进 `package.json:32` 的 `"gates"` 串。门账里还带着 crossreview 要的那件东西——**「曾经真红过」的证据**（如 `gate-ledger.json:37`「en→red 有牙…**已亲测退 1**」） | ✅ **已解决，§9 状态过期** |
  | **C4** 传播性错误「引用可校验门今天做不了」 | ✅ 三处已掐掉 | ✅ 属实（SPEC 两处 + migration §5.2）。且 **C4 的技术判断今天仍然正确**：`probeMissingRefs` 仍只接 workflow（`server.ts:1008`）与 agent（`server.ts:690`），skill 发布路仍没接（见 §9） | ✅ |
  | **C5** 「Phase 2」三义 → M/R/T 前缀 | ✅ 已改名，残留裸「Phase N」= 0 | ✅ **属实且机械可核**：`grep -c "Phase 1\|Phase 2" docs/PRD-skill-migration.md docs/PRD-skill-runtime-orchestrator.md` = **0 / 0**；两份文里 `M0 M1 M2 M3` / `R1 R2 R3 R4` / `T1` 前缀真在用 | ✅ |
  | **C6** 决策点计数两口径未并列写进本体 | 🟡 部分 | **未查清** —— 需读本体 §8 `G-ROUTE-REGEX-PREEMPTS-RETRIEVAL` 全文逐字核对两个数是否并列。**卡在：该条目文本极长，且「有没有并列写」是措辞判断，静态 grep 判不了。** | 未查清 |
  | 末尾附记：crossreview 自身被 `check-prd-ontology.mjs` 索引为 `hasOntologyRef:false` | — | ✅ 属实：`docs/prd-ontology-index.json:1833` 有 `"PRD-skill-crossreview.md"` 条目；`:2315` 亦在列 | ✅ |

- **结论**：**✅ 已实现（作为审查记录，它的产出已被消费）**，但 ⚠ **§9 收口记录本身有一条过期**：
  C3 标 🟡「仍无人认领」，实际已由 `docs/PRD-gate-ledger.md` + `scripts/gate-ledger.json`(44 条) 兑现。

- **最小 WO 建议**：只需把 §9 的 C3 行从 🟡 改为 ✅ 并指向 `PRD-gate-ledger.md`（只改 `docs/PRD-skill-crossreview.md`）。

---

## 12. PRD-skill-governance-learning.md

- **它要做什么**：把 Skill 的「治理」与「学习」落成可校验机制 —— per-Skill 的 **data/tool/action 三面权限**
  （与 entitlement 一处判定）· 可复盘的 **Execution Trace（含 Prompt 版本）** · 建在正确且不裸奔的指标上的
  **学习闭环** · 生长回路的**人在回路审批位**。

- **PRD 自称的 AS-IS**：§1「问题陈述 · AS-IS 实证」五小节（1.1 权限三面 / 1.2 Trace / 1.3 Learning Loop 两个硬前置 /
  1.4 生长回路「**订正 SPEC**：不是只报不写，是写了 DRAFT 但审批位不在 R4 上」/ 1.5 已有正面资产），
  外加 §9「未核实」清单。**§1.4 是一次自我订正，值得记账。**

- **实测现状**

  | PRD 交付物 | 实测 | 证据 |
  |---|---|---|
  | `SkillExecutionTrace` 对象 | **❌ 0 命中** | `grep -rn "SkillExecutionTrace" packages/contracts/src apps/agentcore/src scripts package.json` = 空 |
  | Prompt 版本化（`promptVersion`） | **❌ 0 命中** | 同上 |
  | 六道新门（`skill-permission` / `skill-trace` / `skill-eval` / `skill-lint` / `growth-hitl` / `metrics-tenant`） | **❌ 0 命中**；`scripts/gate-ledger.json` 的 44 条登记里无一条 skill 门 | 同上 |
  | §2.1 **P0 前置 A · 指标补租户维** | **❌ 仍缺，且形态是「机制在、实参没传」** —— `apps/agentcore/src/metrics.ts:5-17` 的 `Counter.inc(labels)` **支持任意标签**，但全部 ~20 处调用点**没有一处传 tenantId**：`deps.ts:64 .inc({reason})` · `agent/loop.ts:476 .inc({path:"AGENT"})` · `:567/:603/:640 .inc({tool,outcome})` · `llm/providers.ts:281 .inc({from,to})` · `agent/context.ts:358 .inc({op})` | 上列 file:line |
  | §2.2 **P0 前置 B · `/metrics` 鉴权** | **❌ 仍裸奔** —— `apps/agentcore/src/server.ts:203` `app.get("/metrics", async (_req, reply) => {…})`，**参数名就是 `_req`**（下划线 = 声明「我不看请求」），路由体内零 `auth(req)` | `server.ts:203-206` |

- **结论**：**❌ 未实现（零代码落地）**；⚠ 其 AS-IS 中的两个 P0 前置**今天仍逐字成立**。

  ⚠ 一条需要点名的**跨 PRD 依赖风险**：`PRD-skill-contract-dsl.md §4.9` 明写「砍掉 learning 层」的
  **唯一理由**就是「采纳率埋点跨租户混算 · `/metrics` 两服务 200 无鉴权」这个前提；
  而该前提在它自己的 §11.2 里标着「**未核实**」。**本审计实测：该前提为真**（见上两行 file:line）
  ⇒ contract PRD 砍 learning 层的决策**依据成立**。这条以前没人核过。

- **最小 WO 建议**（按投入产出排序）

  | WO | 🚦 范围边界 | 出口判据 | 性价比 |
  |---|---|---|---|
  | **WO-B5-18 · `/metrics` 鉴权**（十分钟的活·安全面） | 只改 `apps/agentcore/src/server.ts:203`（+ datacore 对侧同款，若同形态）加 `SERVICE_TOKEN` 或 admin 门。**不碰** `metrics.ts` | 无凭据 GET `/metrics` → 401/403；带 `SERVICE_TOKEN` → 200 | ⭐⭐⭐ |
  | **WO-B5-19 · 指标补租户维** | 只改 `apps/agentcore/src/metrics.ts` 的**调用点**（~20 处 `.inc()` 补 `tenantId`）+ 一条断言「所有 counter 至少带 tenant 标签」的门。**不碰** `Counter` 实现（labels 已支持） | 渲染出的 prom 文本每行带 `tenant="…"`；变异反证：去掉一处 → 门红 | ⭐⭐ |
  | WO-B5-20 · 权限三面 + Trace + Prompt 版本 | 大工程 | —— | ⭐ 建议等 §9/§10 的 skill 基础线（`requires` 结构）先落 |

---

## 13. PRD-skill-migration.md

- **它要做什么**：把 **32 份 `ExecutionPlan` 升格进 Skill** 的可执行迁移路线（Track E 落地）。
  分期 **M0 影子声明 → M1 一致性门 → M2 权威翻转 → M3 独有能力**。
  自称交付形态 = **「本文只写路线与验收判据。零代码改动」**。
  核心主张：「这次迁移最容易失败的方式不是做不完，而是**做完了但门是恒真的**」。

- **PRD 自称的 AS-IS**：§1「AS-IS 事实基线（本会话静态读码核实 · 每条带 file:line）」五小节，
  含 §1.4「已实测的**三个零消费方**（迁移必须一并了结，否则是搬运既有的债）」。

- **实测现状**

  | PRD 交付物 | 实测 | 证据 |
  |---|---|---|
  | `Skill.execution.plan` 字段 | **❌ 0 命中** | `SkillDefinitionSchema`（`packages/contracts/src/agentcore.ts:236-262`）无 `execution` |
  | M0 导出器 / `skill-export:check` | **❌ 0 命中** | grep = 空 |
  | M1 一致性门 `skill-plan-parity:check` | **❌ 0 命中** | grep = 空 |
  | M2 双源红门 `skill-single-source:check` | **❌ 0 命中** | grep = 空 |
  | `skill-ref-closure:check` / `skill-refs:check` | **❌ 0 命中** | grep = 空 |
  | M2 权威翻转（执行改读 `Skill.execution.plan`） | **❌** 执行仍读 `ExecutionPlan` | `apps/agentcore/src/workflow/executor.ts:104 for (const step of input.steps)` |
  | §1.4 三个零消费方「一并了结」 | **❌ 至少 `maxBudgetRounds` 仍零消费方**（见 §10 复验） | `packages/contracts/src/agentcore.ts:260` 是唯一命中 |

  **AS-IS 基线复验（PRD §1.1「32 Plan / 7 Skill」）**：`apps/agentcore/src/mocks/seed.ts` 的
  `seedIntentsAndPlans` 仍在（2 处引用），7 个种子 Skill 的 `resources: []` 仍是 7 处 —— **基线未变**。

- **结论**：**❌ 未实现（PRD 自称零代码改动，至今确实零代码改动）**

- **最小 WO 建议**：按 PRD 自己的分期，**M0 是唯一低风险起手**（不改一行执行代码）。

  | WO | 🚦 范围边界 | 出口判据 | 性价比 |
  |---|---|---|---|
  | **WO-B5-21 · M0 影子声明导出器** | 新增 `scripts/export-plans-to-skills.mjs` + `apps/agentcore/src/mocks/seed.ts`（只加影子字段，**不改任何读取点**） | 32 份 Plan 全部导出成影子 Skill 声明；执行路径逐字节不变（现有测试零回归） | ⭐⭐ |
  | ⚠ **前置**：M1 一致性门是「整条路径的命门」（PRD §6），而 PRD §6.1 自己指出「**Skill 里有 plan 字段且内容相同」是恒真断言** —— 立单时**必须**把 §6.2 的四条同时成立与 §6.4 的两条变异反证抄进 WO，否则做出来的是一道恒真门 | | | |

---

## 14. PRD-skill-runtime-orchestrator.md

- **它要做什么**：Skill Runtime 与 **Reasoning Graph 编排器** —— 把「执行是线性串行 / 预算是全局常数 /
  取消只到一半 / 过程可见半数路径为 0 / Runtime 第一站被 13 道前置门抢答」五条从目标形态翻译成
  可施工、可门控、**效果层可验收**的运行时设计。立场：**不造新执行器**，Reasoning Graph 是既有
  `PlanStep` 派发的**调度层超集**。

- **PRD 自称的 AS-IS**：§1「问题陈述：五个必须正面回应的既有病灶」A–E，每条带 file:line。

- **实测现状**

  | PRD 交付物 | 实测 | 证据 |
  |---|---|---|
  | `ReasoningGraph` 契约 | **❌ 0 命中** | grep 遍 `packages/contracts/src` + `apps/agentcore/src` + `scripts` + `package.json` = 空 |
  | 门 `graph-runtime:check` / `progress-reachability:check` | **❌ 0 命中** | 同上；`scripts/gate-ledger.json` 44 条无此二门 |
  | §3.6 `human` 节点 | **❌ 0 命中** | 同上 |
  | §4 预算按题型声明 | **❌** 仍是全局常数 | `packages/contracts/src/qos.ts:668 maxRoundTrips: z.number().int().default(24)` · `:672-680 DEFAULT_AGENT_BUDGET` 里 `maxRoundTrips: 24` |

  **§1 五条病灶复验（全部仍在）**

  | 病灶 | PRD 断言 | 今天复验 |
  |---|---|---|
  | **A · 执行是串行** | `apps/agentcore/src/workflow/executor.ts:104` | ✅ 仍是 `for (const step of input.steps) { … await … }`（`executor.ts:104`），逐步串行 |
  | **B · 预算是全局常数，字段早在、零消费方** | `maxBudgetRounds` 零消费方 | ✅ 仍零消费方（`packages/contracts/src/agentcore.ts:260` 唯一命中）；全局默认 24（`qos.ts:668/680`） |
  | **C · 取消只做了一半** | — | ◐ 部分改善：`executor.ts:108-110` 每步前有 `input.nesting.isCancelled?.()` 检查（注释标 `WO-SCENARIO-INPUT-PHASE0`）。**PRD 说的另一半（同步求解通道）未查清** |
  | **D · 过程可见半数路径结构性为 0** | — | **未查清**（需实跑观测 SSE，本审计只读代码） |
  | **E · Runtime 第一站排在第 14 位** | 13 道前置门 | **未查清**（决策点计数正是 §11 C6 悬着的那个口径分歧，静态数不准） |

- **结论**：**❌ 未实现**；病灶 A/B 仍逐字成立，C 部分改善，D/E 未查清（卡在需要实跑）。

- **最小 WO 建议**：与 §10 的 WO-B5-15 是**同一件事**（`maxBudgetRounds` 接消费方 = 病灶 B 的最小闭合），
  **两份 PRD 指向同一条线，不要开两张单**。其余（Reasoning Graph / 并行调度 / human 节点）是大工程，
  建议先做完 §10/§12 那批「小而真」的接消费方，把「有字段没消费方」的账还掉再谈图化。

---

## 15. PRD-sop-balance-1to1.md

- **它要做什么**：月度 S&OP 平衡台（sop）对参考原型 **1:1 复刻（=100%，色调/字体可调）**。
  自称系统 `SopBalanceView` 骨架已是原型超集，1:1 缺口是**四张原型有、系统缺的明细表**。

- **PRD 自称的 AS-IS**：§2「现状与缺口（HTML vs 系统，带 file:line）」12 行表，
  ✅/◐/❌ 逐行标注（六卡 ✅ · 五步状态机 ✅ 超集 · ① 可产矩阵 ◐ · **② P90 列 ❌** ·
  **③ 物料线 MRP 表 ❌ 全缺** · **④ 量价本利科目表 ❌** · **⑤ 版本演进对比表 ❌**）。

- **实测现状（四张缺表逐张核）**

  | 分期 | 缺表 | 实测 | 证据 |
  |---|---|---|---|
  | **SOP.1** | ② 滚动 P90 列 | **✅ 已补** | `apps/frontend-shell/src/views/sim/SopBalanceView.tsx:438-441`（`p90ByName` 取自 `DemandSegment.p90`，注释标 `SOP.1`，`R-一致`）· `:489 <th>滚动 P90</th>` · `:503 data-testid="sop-p90-{key}"` · `:531 data-testid="sop-p90-total"` |
  | **SOP.2** | ③ 物料线 MRP 净需求表 | **✅ 已补，数据+引擎两半都在** | 求解器注册 `apps/datacore/src/solvers/service.ts:90 "mrp_netting"` · 派发 `:4282`；前端 `SopBalanceView.tsx:763` `runSolver("mrp_netting", {})` → `{materials:[{material,netDemand,ltaCoverPct,gap,earliestComplete}], shortageCount}` · `:765 const mats = data?.materials ?? []` |
  | **SOP.3** | ④ 量·价·本·利科目表 | **✅ 已补** | 求解器 `service.ts:92 "finance_pnl"` · 派发 `:4286`；前端 `SopBalanceView.tsx:788-812`（`data-testid="sop-pnl"` / `sop-pnl-table` / `sop-pnl-row-{subject}` / `sop-pnl-gm`，含 `gmRow.budgetPct/rollPct/diffPp` 与 `attribution`） |
  | **SOP.4** | ⑤ 版本演进对比表 | **✅ 已补** | `SopBalanceView.tsx:700`「SOP.4 ⑤ 版本演进对比表（V1→V7）」· `:822-832`「版本演进对比（V1 → V7，缺口 = 需求 − 供给）」，数据源 `fetchSopVersions`（`:3` import · `:45` useQuery） |
  | §3.5 | 前端零写死（R14） | **✅** | `SopBalanceView.tsx:757` 注释：「sop 前端 1:1 增量（SOP.2/.3/.4）：物料线 MRP / 量价本利科目 / 版本演进对比，**读新求解器/对象，前端零写死**」 |

  **`MaterialBalance` 对象类型**：✅ 真在本体里且被别的求解器当**下钻靶**用 ——
  `apps/datacore/src/synthetic/battery-extended.ts:320`（`cf-cathode-shortage → drillType:"MaterialBalance", drillId:"mbal-2", drillField:"gapTon"`）·
  `:357/:360`（`cf-demand-attain-gap` / `cf-material-short`）· `:851`（毛利桥由 `DemandSegment × MaterialBalance` 派生）。
  即它不只是 sop 的一张表，已经是跨求解器的一等对象。

- **结论**：**✅ 已实现（SOP.1–SOP.4 四期全落地）**

  ⚠ **两项本审计未查清**（诚实标出，不猜）：
  1. **§7 DoD 的「=100% 1:1」**：能核到「四张表都在、数据走求解器」，
     **核不到「渲染出来的数字与参考原型逐格相同」** —— 那需要对照 `docs/reference-prototype-decision-platform.html`
     的 `SOP_*` 种子逐值比对并实跑前端。**卡在：静态读码判不了像素/数值级的 1:1。**
  2. **§1 目标 1「收入预算口径统一（240 vs 248）」**：未核。

---

## 16. PRD-system-ontogenesis-spec.md

- **它要做什么**：**宪法级总纲** —— 立 **R16 发育闭环**不变量（倒序发育 ⊕ 正序运作是同一有机体两相），
  统摄十余份 PRD；三环自动闭合（数据/本体/能力）+ 产物二分处置（AUTO-DERIVE / NEEDS-HUMAN）
  + 发育透明 + 成熟分相位。分期 ONT.1–ONT.4。

- **PRD 自称的 AS-IS**：§2「两轴与双面（系统已具雏形）」四行表 + **§3 三环表的「现状」列**（这一列就是 AS-IS）：
  ① 数据环 **◐**「A10+inferenceProbe 已有；模版/单一上传口缺口」·
  ② 本体环 **❌**「本体是文档 + `ontology:check` 防漂，**靠人回写**」·
  ③ 能力环 **❌**「`OPERATION_CATALOG`/`REGISTRY` **手维护**」。

- **实测现状（逐 ONT 核）**

  | 分期 | 要求 | 实测 | 证据 |
  |---|---|---|---|
  | **ONT.1** 立 R16 | **✅ 已立** | `docs/SYSTEM-ONTOLOGY.md:795` **R16 · 发育闭环**（完整定义：三环 + 二分处置 + 透明 + 分相位 + `GapReport` 生长信号），状态列自标 **◐** |
  | ONT.1 `sys.meta.ontogenesis_loop` 切片 | ◐ **只在 R16 条目内提及，未见独立切片登记** | `grep "sys.meta.ontogenesis_loop"` 唯一命中就是 `:795` R16 那一行本身；`apps/**` 无实现 |
  | ONT.1 `ontogenesis.organ_matured` 事件 | ❌ 同上，仅 `:795` 内提及，零 emit / 零订阅 | 同上 |
  | **ONT.1 `ontogenesis:check` 并入 `pnpm gates`** | ⚠⚠ **本体自称已并入，实测没有** | 见下方专条 |
  | **ONT.2** 能力环自动派生 `deriveOperationCatalog` | **❌ 没接线** | `grep -rn "deriveOperationCatalog"` 全仓（排除 dist/worktree）= **0 命中**。`OPERATION_CATALOG` 今天仍是 `packages/contracts/src/operation-intent.ts:53` 的一个**手写数组**（`export const OPERATION_CATALOG: OperationCatalogEntry[] = [`）⇒ **PRD §3 环③ 的 AS-IS「手维护」今天逐字仍成立** |
  | ONT.2 二分处置统一收件箱（GrowthTicket 泛化） | ◐ `GrowthTicket` 机制在（§4 已验，`server.ts:2511-2523`），但**未泛化到所有制品类型** —— 未查清 | — |
  | **ONT.3** 透明一等视图（活过程 DAG + 模块同步矩阵） | **✅ 两半都在** | 前端 `apps/frontend-shell/src/components/InferenceProcessDag.tsx` + `InferenceProcessPanel.tsx` + `QueryDock/TaskRun.tsx`；后端 `apps/datacore/src/databuilder/artifacts.ts`（`deriveProducedArtifacts`）+ `databuilder/service.ts` |
  | **ONT.4** 本体环活体化（dogfooding 落库） | ◐ **防漂门在，落库未查清** | `package.json:15` `"meta:sync": "node scripts/check-meta-sync.mjs"`；`scripts/check-meta-sync.mjs:3`「meta:sync 漂移门（Dogfooding PRD §7 / R6）：保证系统本体 markdown 始终可被 `meta/parse.ts` 解析」⇒ **这仍是"文档 + 防漂门"，正是 PRD §3 环② 判为 ❌ 的那个形态**。是否已有 ObjectType 落库版本 —— **未查清** |

  **⚠⚠ 最值得单独标出的一条：本体自己的陈述与现状不符（且门账已经知道）**

  `docs/SYSTEM-ONTOLOGY.md:795`（R16 条目状态列）写着：
  > `ontogenesis:check` 门（三环+二分声明性校验，**已并入 `pnpm gates`**）

  **实测：没有并入。**
  ```
  $ node -e 'const p=require("./package.json"); console.log(p.scripts.gates.includes("ontogenesis"))'
  false                      # gates 串 23 个门，无 check-ontogenesis.mjs
  $ node -e '...Object.keys(p.scripts).filter(k=>k.includes("ontogenesis"))'
  []                         # 也没有 pnpm 别名
  ```
  而 `scripts/gate-ledger.json` 的对应条目**早就把它标出来了**（这正是门账该干的事）：
  ```json
  "check-ontogenesis.mjs": {
    "alias": null, "binding": "NONE",
    "ontologyRef": "§7:838",
    "provenRed": { "kind": "NEVER", "note": "本体 §7 行838 未记录已执行的反证" },
    "disposition": "WIRE"
  }
  ```
  即：**脚本在（`scripts/check-ontogenesis.mjs`）· 无 pnpm 别名 · 未绑任何 gate runner · 从未红过 · 门账判定应当接线。**
  这与本仓 #76（`boundary-singlesource` 红着零接线活了 24 个 commit）**完全同族**。
  ⇒ **本体 `:795` 那句「已并入 `pnpm gates`」必须回改。**

- **结论**：**◐ 部分实现（ONT.1 立了不变量、ONT.3 透明层落地；ONT.2 能力环自动派生 ❌；ONT.4 本体活体化 ◐；
  且 ⚠⚠ ONT.1 的门"声称并入实则未并入"）**

- **最小 WO 建议**

  | WO | 🚦 范围边界 | 出口判据 | 性价比 |
  |---|---|---|---|
  | **WO-B5-22 · `ontogenesis:check` 真接线**（门账已判 `disposition:"WIRE"`，照办即可） | `package.json`（加别名 + 进 `"gates"` 串）· `scripts/gate-ledger.json`（更新 `binding`/`alias`）· `docs/SYSTEM-ONTOLOGY.md:795`（把"已并入"改成真话或等接线后成真）。**不碰** `apps/**` | 门在 CI 里真跑；**变异反证**（`provenRed` 从 `NEVER` 变成有证据）：故意破一条三环声明 → 门红并打印原文 | ⭐⭐⭐ |
  | WO-B5-23 · 能力环自动派生 | `packages/contracts/src/operation-intent.ts`（`OPERATION_CATALOG` 改从注册表派生）+ `cli-parity:check` 同步 | 新增一个模块 → 目录**自动**出现该 op，无需手改数组 | ⭐⭐ |

---

## 17 & 18. PRD-traceability-and-baseline.md ＋ PRD-traceability-and-baseline-v2.md

> **这两份必须合并审 —— 它们是同一份文档的两个版本，且第一处发现就是：两份的标题、版本号、地位声明完全一样。**

- **它们要做什么**：需求追踪矩阵（R1–R28 需求→文档落点）+ 跨文档修订裁决清单 + 补全最后几个算法缺口（Part C）
  + 决策确认记录。自称**「文档集的阅读入口与裁决权威：与任何单篇冲突时，以本文 Part B 的裁决为准」**。

- **PRD 自称的 AS-IS**：无传统 AS-IS 节。最接近的是 **Part E 覆盖承诺**：
  > 全部需求（R1–R28）**100% 具有文档落点且逐条可追踪**…**本承诺的边界：覆盖的是"需求→规格"，
  > **不含"规格→实现"的验证**。

  ⇒ 这两份 PRD **自己就声明了不管实现**。所以对它们的「实现状态」审计，只能核**文档层**的三件事：
  ① 两份的关系 ② 内部计数是否自洽 ③ Part C 的算法缺口是否真被实现。

- **实测现状**

  **发现 1 · 两份文件是父子关系，v2 是超集，差异只有 8 行**

  ```
  $ diff PRD-traceability-and-baseline.md PRD-traceability-and-baseline-v2.md
  17c17   （§0 范畴一行加了"v2"两个字）
  74a75,81  （Part B 追加 7 行：#20–#26）
  ```
  **除此之外逐字节相同** —— 包括 `| 版本 | v1.0 |`、`| 地位 | 文档集的阅读入口与裁决权威 |`
  和标题 `# PRD · 需求追踪矩阵与文档基线（**v2.0 收口文档**）`。

  ⚠ **两份都自称是"裁决权威"，而它们的 Part B 不一样** —— 读到旧那份的人会拿到一份少 7 条裁决的权威表。
  且**旧文件的标题里也写着"v2.0"**，光看标题分不出哪份新。

  **发现 2 · ⚠ 内部计数与实际不符（两份都错，且错法不同）**

  | 文件 | Part B 标题自称 | 实际行数 | 差 |
  |---|---|---|---|
  | `PRD-traceability-and-baseline.md` | 「跨文档修订裁决清单（最终状态，**共 17 条**）」 | **19** | +2 |
  | `PRD-traceability-and-baseline-v2.md` | 「跨文档修订裁决清单（最终状态，**共 17 条**）」 | **26** | +9 |

  （行数由 `awk '/^## Part B/,/^## Part C/' | grep -c "^| [0-9]"` 得出。）
  即：v2 追加了 7 条却**没改标题里的数**，而 v1 的数**本来就已经不对**。

  **发现 3 · Part C 的三个算法缺口 —— C1 全实现，C2/C3 部分**

  | 缺口 | PRD 给的公式级规格 | 实测 |
  |---|---|---|
  | **C1 `capex_scenario`** | 供给曲线 `S[q]` / 缺口 `G[q]` / `util24` / IRR 牛顿迭代（初值 0.1、`\|NPV\|<0.01`、20 次不收敛报 `IRR_DIVERGED`）/ C23 判定 `(IRR≥15%) ∧ (util24≥75%)` | **✅ 逐条落地** —— `apps/datacore/src/solvers/capex.ts:10`「C1 · `capex_scenario` — 年度情景测算（**Part C 公式级**）」· `:14` 出参含 `S[q]/G[q]/窗口/项目级 IRR·util24·c23pass` · `:60-63` `ramp/irr/util24/c23pass` · `:104 rampAt`（k 超长维持达产 1.0）· `:125-126`「IRR 牛顿迭代：初值 0.1，收敛 \|NPV\|<0.01 亿，20 次不收敛报 **IRR_DIVERGED**；病态输入…**不死循环**」。注册 `solvers/service.ts:57` · 派发 `:4217` |
  | **C2 季度滚动供给口径** | `supply[q] = 月聚合上卷 + Σ已批准产能项目增量×ramp + Σ该季 S&OP 决议增量` | **◐ 求解器在，口径未闭** —— `quarterly_gap` 在（`apps/datacore/src/solvers/extended.ts:473/573/950`），但本体 `:1017` 记载它的 `quarter` 维**已被判为 `dataMode:"EMPTY"`**：「季度需求真源 `PlanTarget(level=quarter)` 在库，但缺口=需求−供给的**供给侧**要走 `capex.deriveS0`（仅 planviews 路可达 + 季度索引相对预测窗口起点、未与日历季对齐）⇒ 新通道，本轮不接，只标 `quarterScope.dataMode:"EMPTY"`」。**⇒ C2 那条公式的"供给侧"至今没接通** |
  | **C3 S&OP ④ 财务整合口径** | `毛利率_roll` 加权公式 + `现金垫 = min_{w∈1..13}(...)` 13 周滚动 | **◐ 已实现但未逐格核** —— `finance_pnl` 求解器在（§15 已验，含 `gmRow.budgetPct/rollPct/diffPp`）；`cashCushion` 在 `apps/datacore/src/solvers/plan.ts:17/:127`。**「是不是 13 周 min」这一条本审计未逐行核 —— 未查清** |

- **结论（两份合并）**：
  - `PRD-traceability-and-baseline-v2.md`：**✅ 已实现（就其自定范围「需求→规格」而言）**；Part C 的 C1 更是**代码级逐条兑现**。
  - `PRD-traceability-and-baseline.md`：**⚠ 应废弃** —— 它是 v2 的**真子集**，却与 v2 同标题、同版本号、同自称"裁决权威"。
  - **两份都 ⚠ 内部计数不符**（Part B 自称 17 条，实为 19 / 26）。

- **最小 WO 建议**（纯文档·零风险·⭐⭐⭐ 性价比最高的一类）

  | WO | 🚦 范围边界 | 出口判据 |
  |---|---|---|
  | **WO-B5-24 · 消除双权威** | 只改 `docs/PRD-traceability-and-baseline.md`（改为一行指针「本文已被 `-v2` 取代，见该文件」并保留归档说明）+ `docs/PRD-traceability-and-baseline-v2.md`（Part B 标题的「共 17 条」改为 26；正文标题的版本号与 `\| 版本 \| v1.0 \|` 对齐）+ `docs/prd-ontology-index.json` 随 gate 重写 | 全仓只有一处自称"裁决权威"；Part B 的数与行数一致；`prd:check` 绿 |
  | WO-B5-25 · C2 供给侧接通（可选） | `apps/datacore/src/solvers/extended.ts`（`quarterly_gap` 供给侧接 `capex.deriveS0`）+ 季度索引与日历季对齐。**注意**：本体 `:1017` 已把「今天为什么标 EMPTY」的三条理由写死进门，**接通时那道门会变红，是设计如此**（逼人回来把 EMPTY 换成真算） | `quarterScope.dataMode` 从 `EMPTY` 变 `LIVE`，且供给数与 `capex_scenario` 的 `S[q]` 同源对拍 |

---

## 19. PRD-unified-build-engine.md

- **它要做什么**：把 A7 数据构建发动机从「故事→DataCore 栈」**扩成「故事→可运行场景」全栈编译器** ——
  三入口统一（数据先行/图谱先行/故事先行）+ **全链闭包门** + 场景为主实体 + rawin 三路 +
  scaffold 去电池锁死 + `generic-inference`。自称是 **G-1…G-8 全部八个断点的系统级解**。

- **PRD 自称的 AS-IS**：§2「现状与缺口（对照代码）」两段 ——
  「已存在（复用，勿重造）」列 A7 七阶段 / `validateClosure` / publish 经 Action 等；
  「缺口」列 G-8→G-1 / G-2 跨服务输出形状 / G-3 场景模型倒置 / G-4 无前端入口 /
  G-5 电池锁死且 `generic-inference` 不存在 / G-6 Excel 解析 TODO / G-7 LLM 用途枚举写死。

- **实测现状（逐期核 P1–P6）**

  | 期 | 要求 | 实测 | 证据 |
  |---|---|---|---|
  | **P1** BuildPlan 扩 AgentCore 栈 | **✅** 八类 B 栈需求全在 | `packages/contracts/src/databuilder.ts:214-221`：`sliceNeeds` / `intentNeeds` / `planNeeds` / `workflowNeeds` / `skillNeeds` / `agentNeeds` / `mcpNeeds` / `sceneNeeds`（命名是 `*Needs` 而非 PRD 字面的 `intents[]/skills[]/…`，**实质等价**） |
  | **P1** ClosureReport 扩 `CHAIN` / `SHAPE` | **✅ 逐字落地** | `packages/contracts/src/databuilder.ts:235` `kind: z.enum(["OBJECT","DATA","FORWARD","CHAIN","SHAPE"])`；`:234` 注释「CHAIN（R11 全链闭包）：求解器需求是否在 DataCore 注册（**跨系统接缝，焊进闭包报告**）」；`:236` ref 语义含 `solver:key`(CHAIN) / `solver.output.path`(SHAPE) |
  | **P2** 跨系统生成（B catalog seed） | **✅ 已实现，落点与 PRD 不同** | PRD 说 `POST /a/v1/build/scaffold` + `POST /api/v1/catalog/…`；实际是 `apps/datacore/src/app.ts:622-628`「g8-P3 跨系统 scaffold（A→B）：closure 后把 B 栈需求下发 AgentCore」→ `POST {agentBase}/b/v1/internal/scaffold`（`SERVICE_TOKEN` 守闸）。`/a/v1/build/preview\|scaffold` 两个 PRD 字面端点 **0 命中** |
  | **P2** 场景为主实体（G-3） | **✅** | 见 §3（`Scenario` 已升一等对象） |
  | **P3** rawin 三路 · `parseXlsx` | **✅** | `apps/datacore/src/connectors/parsers.ts:1-8`「CSV / JSON / **XLSX** tabular parsing（**G-6：xlsx 经 node-xlsx 解析**）」`export function parseXlsx(buf)` |
  | **P3** 数据模版 | **✅** | `apps/datacore/src/synthetic/data-template.ts:41 buildDataTemplates` · 端点 `apps/datacore/src/app.ts:1997 GET /a/v1/data-templates` |
  | **P4** `generic-inference` 通用 what-if | **✅ 注册为求解器 + 进目录** | `apps/datacore/src/solvers/service.ts:98-100`「通用 what-if 求解器（generic-inference P2，**G-5**）：包装本体派生引擎 `recompute(dryRun+apply)`」`"generic_inference"`；目录 `apps/datacore/src/catalog.ts:104`（带 `answersQuestions`，QOS 可路由） |
  | **P5** LLM 用途可扩展 | **◐ 枚举被扩了，但仍是枚举** | `packages/contracts/src/llm.ts:216-224` 今天 7 个用途（`classifier`/`agent`/`extraction`/`modeling`/`template_gen`/`compose`/**`comprehend`**）。PRD 要的 `registerPurpose` 或配置驱动 **❌ 0 命中**；PRD 举例的 `build_decompose` 也不在。本体 G-7 状态 = **◐** |
  | 新事件 `buildplan.closure_evaluated` / `scaffold.completed` | **❌ 两个都没有**，但**有一个语义相近的替代** | `apps/datacore/src/databuilder/service.ts:393` emit 的是 `"scaffold.manifest_recorded"`（载荷 `{runId, items, pendingBstack}`）。PRD 命名的两个事件 grep = 0 |
  | **§7 DoD「G-1…G-8 全部关闭」** | **◐ 6 闭 2 未全闭** | 本体 §8 逐条：**G-1 已闭** · **G-2 ✅ 已修** · **G-3 ◐ 大部修**（见 §3）· **G-4 ✅ 已修** · **G-5 ✅** · **G-6 ✅** · **G-7 ◐** · **G-8 ◐ 大部闭合**（`:` 条目原文列了四条已做：`chain:check` 跨系统门 / ClosureReport CHAIN 维 / SHAPE 维 / 跨系统 scaffold g8-P3） |

- **结论**：**◐ 大部实现（P1–P4 全落地，P5 部分，P6 联调未查清）**
  这份 PRD 的实施完成度在本批里仅次于已 ✅ 的几份 —— 它自称要关的 8 个断点，**6 个已闭 / 2 个 ◐**。

  ⚠ 两处**落点与 PRD 字面不同**（不是缺陷，是实现选了更好的路，但照字面找会扑空）：
  1. 端点：`/a/v1/build/preview|scaffold` → 实际 `POST /b/v1/internal/scaffold`（A→B 服务间，`SERVICE_TOKEN` 守闸）。
  2. 事件：`buildplan.closure_evaluated`/`scaffold.completed` → 实际 `scaffold.manifest_recorded`。

- **最小 WO 建议**

  | WO | 🚦 范围边界 | 出口判据 | 性价比 |
  |---|---|---|---|
  | **WO-B5-26 · PRD §4 落点回写**（零风险） | 只改 `docs/PRD-unified-build-engine.md` §4/§0（端点名与事件名改成实测值） | 照 PRD 字面 grep 能找到东西 | ⭐⭐⭐ |
  | WO-B5-27 · G-7 收口（LLM 用途配置驱动） | `packages/contracts/src/llm.ts` + `LlmProvidersPage.tsx`。**保留枚举校验**（PRD §4 原话），加注册通道 | 新增一个构建用途无需改 contracts 枚举即可绑定；本体 G-7 由 ◐ 转 ✅ | ⭐ |

---

# 汇总

## A · 19 份逐份结论

| # | PRD | 结论 | 一句话 |
|---|---|---|---|
| 1 | `PRD-sandbox-redesign.md` | **◐ + ⚠⚠⚠** | 后端做了大半（`chain-impediment.ts` 741 行判定引擎已接线 + `aggregates.ts` 两项聚合），**前端零入口**；⚠ 三处 PRD 断言与事实相反（`sim.sandbox` 不是暗发 / 规模数字全过期 / 「零代码改动」不成立）；R19 撞号 |
| 2 | `PRD-sandbox-ontogenesis-buildplan.md` | **❌ + ⚠** | 底座全在，**沙盘与倒序发育管道之间根本没有那根线**；三个新 need 全仓 0 命中；⚠ AS-IS 说 comprehend 是关键词目录，实测 LLM 优先已实现 |
| 3 | `PRD-scenario-launcher.md` | **✅** | 6/6，C-6 以更强的运行时门形态兑现（位置与 PRD 字面不同）；⚠ 本体 `:923`「待前端启动器」已过期 |
| 4 | `PRD-scenario-ontogenesis.md` | **✅** | P1/P2/P3 全落地（`growScenario` / A10 验证门 / 三事件 / 相位三态 / 切片自动规划） |
| 5 | `PRD-seam-arg-drop-audit.md` | **✅** | 本批完成度最高：台账 + 修复 + 门（有牙·已亲测退 1）+ 本体三处回写 + 两侧 SEAM |
| 6 | `PRD-segment-scoped-gap-attribution.md` | **✅** | 方案 A 全采；另多一处 PRD 未记载的 `G-SEG-ATTR-BASE-SCOPE` 正交修 |
| 7 | `PRD-self-driving-qos-data-foundation.md` | **✅ + ⚠** | DF.1–DF.13 全落地（含核心论点 DF.8 生成接地，实参真传）；⚠ DF.1 落点不是 `synthetic/boundary.ts` 而是 `contracts/base-registry.ts`；DF.14/15 未查清 |
| 8 | `PRD-simulation-sandbox.md` | **◐** | P1/P2 约 80%；缺 5/7 事件（SSE 链只通 1/3）+ goals 端点 + WebSocket + 三个 sim 门未进 gates + **第二行业证明（自称核心验收）** |
| 9 | `PRD-skill-compiler-registry.md` | **❌** | 零落地；但其 AS-IS 今天 **100% 仍准确**（`probeMissingRefs` 仍差 skill 挂载点 · `extractRelations` 仍零生产调用方） |
| 10 | `PRD-skill-contract-dsl.md` | **❌** | 契约零变更；`maxBudgetRounds` 仍零消费方、7/7 skill `resources` 仍全空、lint 200/3000 vs 契约 400/50000 仍不一致 |
| 11 | `PRD-skill-crossreview.md` | **✅ + ⚠** | 审查产出已被消费（C1/C4/C5 全兑现）；⚠ **§9 自己的 C3 状态过期**（门账已由 `PRD-gate-ledger.md` + 44 条 `gate-ledger.json` 兑现） |
| 12 | `PRD-skill-governance-learning.md` | **❌** | 零落地；两个 P0 前置今天仍逐字成立（`/metrics` 裸奔 `server.ts:203` · 指标零租户维） |
| 13 | `PRD-skill-migration.md` | **❌** | 自称零代码改动，至今确实零改动 |
| 14 | `PRD-skill-runtime-orchestrator.md` | **❌** | 病灶 A/B 仍逐字成立；C 部分改善；D/E 未查清（卡在需实跑） |
| 15 | `PRD-sop-balance-1to1.md` | **✅** | SOP.1–SOP.4 四期全落地（P90 列 / `mrp_netting` / `finance_pnl` / 版本演进表）；「逐格 1:1」未查清 |
| 16 | `PRD-system-ontogenesis-spec.md` | **◐ + ⚠⚠** | R16 已立、ONT.3 透明层已落；ONT.2 能力环 ❌（`OPERATION_CATALOG` 仍手写数组）；⚠⚠ **本体 `:795` 自称 `ontogenesis:check` 已并入 `pnpm gates`，实测没有**（门账已标 `binding:"NONE"` / `provenRed:"NEVER"`） |
| 17 | `PRD-traceability-and-baseline.md` | **⚠ 应废弃** | 是 v2 的真子集（差 8 行），却同标题同版本号同自称"裁决权威" |
| 18 | `PRD-traceability-and-baseline-v2.md` | **✅ + ⚠** | 就其自定范围（需求→规格）已实现；Part C 的 C1 `capex_scenario` 代码级逐条兑现；⚠ Part B 自称「共 17 条」实为 26 条 |
| 19 | `PRD-unified-build-engine.md` | **◐ 大部** | P1–P4 全落地（CHAIN/SHAPE 维 · 跨系统 scaffold · parseXlsx · 数据模版 · `generic_inference`）；自称要关的 8 个断点 **6 闭 2 ◐**；两处落点与 PRD 字面不同 |

**计**：✅ 8 份 · ◐ 4 份 · ❌ 6 份 · ⚠应废弃 1 份。

## B · ⚠「PRD/本体断言了一件可核实的事、而事实相反」清单（最有价值的发现类）

| # | 位置 | 断言 | 事实 | 危害 |
|---|---|---|---|---|
| **1** | `PRD-sandbox-redesign.md:80` 与 `:385`（§10.1 整节的前提） | `sim.sandbox` 是**暗发**（关 → 404） | **是开的** —— L1 `features.ts:81 defaultOn:false` 属实，但 L2 模板 `features.ts:283` 减去的两个暗发集合里 `sim.*` **一个都没有**；`features.ts:158` / `seed.ts:74` 源码明写「sim.* 照常随模板开」 | **已误导至少三个读者**；§10.1「何时点亮」整节前提错 |
| **2** | `PRD-sandbox-redesign.md:9` | 「本文只是 PRD。**零代码改动**」 | §5 核心设计已实施过半（契约 + 741 行判定引擎 + 求解器接线 + SEAM 测 + 两项聚合） | 让人以为沙盘"没开工"→ **正是本次事故的错误结论** |
| **3** | `PRD-sandbox-redesign.md:86/:85/:89` | 7,019 行 / 20 组件 · 17 端点 · 57 求解器 | **15,261 行 / 36 文件 · 21 端点 · 59 求解器** | 规模判断偏小一倍 |
| **4** | `PRD-sandbox-redesign.md:276` | 建议立 **R19 · 时间自洽** | **R19 已被占用**（`SYSTEM-ONTOLOGY.md:798` = 终态责任人） | 照做即撞号 |
| **5** | **`docs/SYSTEM-ONTOLOGY.md:795`（R16 状态列）** | `ontogenesis:check` 门**已并入 `pnpm gates`** | **没并入** —— gates 串 23 个门无它、无 pnpm 别名；`gate-ledger.json` 自己标 `binding:"NONE"` / `provenRed:{kind:"NEVER"}` / `disposition:"WIRE"` | 与 #76（红着零接线活 24 个 commit）同族；**本体是"接线单一来源"，它说错了传播面最大** |
| **6** | `docs/SYSTEM-ONTOLOGY.md:923`（G-3） | 「**待**：前端 ⌘K/目录/首页启动器」 | 都在：`ScenarioLauncherPage.tsx` + `CommandPalette.tsx` | 低估已完成度 |
| **7** | `PRD-skill-crossreview.md §9`（C3 行） | 🟡「仍无人认领」 | 已认领并落地：`docs/PRD-gate-ledger.md` + `scripts/gate-ledger.json`(44 条) + 已进 `pnpm gates` | 会导致重复立单 |
| **8** | `PRD-sandbox-ontogenesis-buildplan.md:12` | comprehend「**不是 LLM 听懂**，而是确定性关键词目录匹配」，称为**头号前置缺口** | 已是 LLM 优先（`databuilder/service.ts:84-99`），关键词已降为地板 | 把已解决的当头号缺口，真缺口（三个 need）被埋 |
| **9** | `PRD-self-driving-qos-data-foundation.md §4`（DF.1） | 落点「建 `synthetic/boundary.ts` 单一来源」 | 实际 `packages/contracts/src/base-registry.ts`（**更对**，跨包单源合 R1） | 照字面找文件会扑空 |
| **10** | `PRD-traceability-and-baseline{,-v2}.md` Part B 标题 | 「最终状态，**共 17 条**」 | 实为 **19 条 / 26 条** | 两份都自称"裁决权威"却各带一份不同的表 |
| **11** | `PRD-unified-build-engine.md §4/§0` | 端点 `/a/v1/build/preview\|scaffold`；事件 `buildplan.closure_evaluated`/`scaffold.completed` | 实际 `POST /b/v1/internal/scaffold`；事件 `scaffold.manifest_recorded` | 照字面 grep 全 0，易误判"没做" |
| **12** | `PRD-segment-scoped-gap-attribution.md §4.1` | 过滤是无条件的 | 实际带 `scopedBaseId` 逃生门（`service.ts:1570`，治后续回归 `G-SEG-ATTR-BASE-SCOPE`） | 读 PRD 的人会以为 base 视图也被裁 |

## C · 补做建议（按投入产出排序）

> 排序依据 = **(闭合的真实缺口大小) ÷ (触碰的文件数)**。前六条全部是「改几行 / 接一条线」，不是造模块。

| 序 | WO | 类型 | 范围（文件数） | 为什么排这里 |
|---|---|---|---|---|
| **1** | **WO-B5-22 · `ontogenesis:check` 真接线** | 接线 | 3 个非代码文件（`package.json` / `gate-ledger.json` / 本体 `:795`） | **门账已经替你判好了**（`disposition:"WIRE"`）；且它闭的是「本体说错话」这个传播面最大的问题 |
| **2** | **WO-B5-11 · skill 发布接引用探针** | 接线（非造门） | 2 个源文件 + 1 条 SEAM | `probeMissingRefs` 已在、已接两处，**只差 skill 这一个挂载点**。这条曾被三份文档错报成「造一道门」，把排期整体歪掉 |
| **3** | **WO-B5-9 · 三个 sim 门并入 `pnpm gates`** | 接线 | 2 个非代码文件 | 门脚本都在（`check-sim.mjs` / `check-sim-readiness.mjs` / `check-genuine-sim.mjs`），**只是没人跑** |
| **4** | **WO-B5-18 · `/metrics` 鉴权** | 补一行 | 1–2 个源文件 | 安全面裸奔；且它是 contract PRD 砍 learning 层的**依据**，本审计已实证前提为真 |
| **5** | **WO-B5-14 · lint 与契约上限归一** | 单源化 | 2 个源文件 | 半小时的活；`SUMMARY_MAX=200` vs `.max(400)` 是活的双源 |
| **6** | **WO-B5-2 / 24 / 26 · 三处 PRD 口径回写**（可合成一单） | 纯文档 | 只改 `docs/**` | 零风险；**直接防止本次事故重演**（沙盘"暗发"那条已误导三人） |
| **7** | **WO-B5-15 · `maxBudgetRounds` 接消费方** | 接线（效果层） | 1 个源文件 + 1 条效果层 SEAM | 本批唯一确凿的死字段；判据必须是**实际轮次真变**，不是"字段被读出来" |
| **8** | **WO-B5-1 · 沙盘扫描入口接线**（整单） | 接线（前端半） | `views/sim/` + endpoints + mock | 后端 741 行判定引擎已就绪且有 SEAM 测，**只差 UI 入口**；闭的是仓主原始需求「让用户发现卡点/堵点/断点」 |
| **9** | **WO-B5-8 · 补 5 个 sim 事件 + SSE 联动**（整单） | 接线 | `app.ts` + `event-subscriptions.ts` + 本体 §4 | SSE 实时刷新今天只通 1/3；D-29 要求每个新事件有订阅方 |
| **10** | **WO-B5-12 · `extractRelations` 接生产投影** | 接线 | 1 个源文件 + 1 条 SEAM | 闭 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR`（假绿第 9 形态）；⚠ 注意 `present` 集合会静默吞悬挂边 |
| **11** | **WO-B5-4 · 三个新 need + provisioner**（整单） | 造机制 | contracts + provisioners + comprehend | 沙盘接入倒序发育的前置 |
| **12** | **WO-B5-19 · 指标补租户维** | 补实参 | ~20 处调用点 + 1 道门 | 机制（labels）已支持，只差传参 |
| **13** | **WO-B5-23 · 能力环自动派生** | 造机制 | `operation-intent.ts` + `cli-parity:check` | R16 环③，PRD AS-IS 判 ❌ 至今成立 |
| **14** | **WO-B5-21 · M0 影子声明导出器** | 新脚本 | 1 个脚本 + seed | ⚠ 立单时必须把 M1 的四条同时成立 + 两条变异反证抄进 WO，否则做出恒真门 |
| **15** | **WO-B5-10 · 第二行业模板（R14 硬证明）** | 大工程 | `builtin-templates.ts` + SEAM | `PRD-simulation-sandbox` 自称的核心验收，至今未做 |
| — | Skill 编译器 / Reasoning Graph / 12 层 DSL | 大工程 | 全新模块 | **建议全部后置**：先把上面 1–7 那批「有字段没消费方 / 有门没人跑 / 有线没接完」的账还掉 |

## D · 本审计自身的诚实边界

1. **未起过任何后端服务、未跑过任何测试**。全部结论来自静态读码 + 交叉引用本体/门账。
   凡涉及「实际跑起来是什么样」的判据（沙盘逐格 1:1 · SSE 旁白 · Runtime 决策点计数 · scenario grow 实跑），
   一律标了**未查清 + 卡在哪**，没有猜。
2. **明确写「未查清」的共 8 处**：§4（§6.1/§6.5 运行时门实跑）· §7（DF.14/DF.15）· §8（第二行业模板 `builtin-templates.ts` 内容）·
   §11（C6 本体口径措辞）· §14（病灶 D 过程可见 / 病灶 E 决策点计数）· §15（逐格 1:1 · 收入预算 240 vs 248）· §16（ONT.2 收件箱泛化 / ONT.4 落库）· §17-18（C3 现金垫 13 周）。
3. **本审计踩过并当场纠正的两个坑**（写下来给下一个人）：
   - **§3 C-6**：按 PRD 字面 grep 门脚本 = 0，差点判 ❌；是**本体的一句话**逼我再追一层，
     找到门在测试文件里且判据更强 ⇒ **改判 ◐，整份 PRD 由 ◐ 改判 ✅**。
   - **§7 DF.8**：`grep "vocab:"` 只有定义行，差点判「接了线没数据」；
     真调用点是**对象字面量简写** `{ ...spec, vocab }` ⇒ **简写属性 grep 一个都看不见**。
     建议把这一形态补进 `CLAUDE.md` 铁律 0.5 第 3 条的间接调用清单
     （现有清单是 re-export / 高阶函数 / 依赖注入 / 字符串键分发 / 事件订阅，**没有"对象简写"这一条**）。
4. **本审计全程未使用** mtime / 待办状态 / 「最近有没有人改过」作为判据。
