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
