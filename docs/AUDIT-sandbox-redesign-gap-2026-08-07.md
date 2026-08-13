# AUDIT · 推演沙盘重设计（`PRD-sandbox-redesign.md`）实现缺口对账

| 项 | 值 |
|---|---|
| 日期 | 2026-08-07 |
| 上游 | `docs/PRD-sandbox-redesign.md`（v1.0 · 2026-08-04 定稿） |
| 基线 | 分支 `wave4` @ `8e3e91a6`（`git status --porcelain` 空） |
| 身份 | 调查员（只读 + 只写本文件）· 不改任何源码 |
| 判据 | CLAUDE.md 铁律 0.5：grep 是线索不是结论，每条判断必须再追一层调用；三分法定性（**没接线** / **接了线没数据** / **接了线接错地方**） |

---

## 0. 头条结论 —— 「推演沙盘为何依然没有变化」的直接答案

**先纠一条派单前提：PRD「从未开工」不成立。** 2026-08-04 之后 `docs/WO-SANDBOX-SERIES.md`
把这份 PRD 拆成 S0 + D1–D4 + E1–E4 + F1–F4 + G1 共 14 单派了出去，绝大部分产物**已经在 wave4 上**：

- `packages/contracts/src/chain-sim.ts`（596 行，S0 五契约冻结）
- `apps/datacore/src/solvers/chain-impediment.ts`（阻滞点判定器，E3）
- `apps/datacore/src/solvers/chain-loss.ts`（环节损失归因，E1）
- `apps/datacore/src/solvers/scope.ts`（业务线 scope 归一，E2）
- `apps/datacore/src/solvers/aggregates.ts` + `packages/contracts/src/solver-aggregates.ts`（三聚合，D4）
- 前端 `views/sim/**` 已从 PRD 记录的 **7,019 行涨到 12,249 行**，新增 4 个视图组件
  （`ChainLineMapView.tsx` / `PhysicalTopologyView.tsx` / `InspectorNodePanel.tsx` / `TransitFlowLayer.tsx`）

**那为什么界面没变化？—— 因为这 4 个新视图今天没有任何入口，一个都打不开。**
证据链（沿链路走完，不是 grep 一次）：

1. 它们**只**登记在前端渲染器表：`apps/frontend-shell/src/views/registry.ts:75 / :80 / :85 / :91`
   （键 `physical-topology` / `chain-line-map` / `node-inspector` / `transit-flow`）。
2. 用户到达渲染器的**唯一**通路是 `apps/frontend-shell/src/pages/ViewPage.tsx`，它有两道硬闸：
   - `ViewPage.tsx:33` — `features.includes("view." + viewKey)` 否则 **404**；
   - `ViewPage.tsx:38` — `workspace.views.find(v => v.key === viewKey)` 否则 **403**。
3. 而后端**内置视图单一来源** `apps/datacore/src/synthetic/view-manifest.ts:51-63` `BUILTIN_VIEWS`
   只有 10 项（`dash`/`graph`/`risk`/`order`/`plan-audit`/`plan-generate`/`project-sim`/`sop-balance`/`global-sim`
   + 派生的 `view.*` 功能键），**四个新视图一个都不在册** —— 于是既无 `view.chain-line-map` 功能键，
   也无 `workspace.views` 条目 ⇒ 两道闸全部关闭。
4. 侧栏 `apps/frontend-shell/src/pages/ShellLayout.tsx:38` 的「推演」组写死为
   `["project-sim","global-sim","risk","order-chain","decision-play"]`，**没有这四项**；
   且 `ShellLayout.tsx:83-84`（`UnifiedNav`）对 `workspace.navigation` 里查不到的项直接 `return null`，
   即便写进 NAV_GROUPS 也照样不显示。
5. 它们也**没有**像 `decision-play`/`what-if`/`disruption-radius` 那样的专用静态路由
   （`App.tsx:138`/`:140`/`:142`/`:144`/`:146` 五条静态 view 路由逐条列过，无这四项）。

**⇒ 三分法定性：`接了线接错地方`（缺最后一跳挂载点），不是"没做"。**
修法 = 补后端视图册 + 导航登记，**不是**重写前端。

**第二条同等重要的实况：仓主导航里那个「推演沙盘」是活的，但它打开的是旧屏。**
`sim.sandbox` 在 L1 确实 `defaultOn:false`（`apps/datacore/src/features.ts:81`），
但**再追一层**：demo 租户 `industry:"battery-manufacturing"`（`apps/datacore/src/seed.ts:17`）
→ `apps/datacore/src/features.ts:283` 的 L2 行业模板返回
`ALL_FEATURE_KEYS − QOS_DARK_LAUNCH_FEATURES − PERF_DARK_LAUNCH_FEATURES`，
而 `sim.sandbox` **不在**这两个排除集（`features.ts:160-183` 逐条核过）
→ `features.ts:312-316` 的 L2 合并把它 `on.add` 了。
⇒ **`sim.sandbox` 对 demo 租户是开的**，侧栏「推演沙盘」（`ShellLayout.tsx:298-307`）显示，
`/v/sim-sandbox` 渲染 `SandboxView.tsx`（462 行，`App.tsx:112`）。
而 `SandboxView.tsx` 里对 `ChainLineMap` / `PhysicalTopology` / `InspectorNode` / `TransitFlow`
的引用数 = **0**（实测 grep 该文件，无任何一项，也无 tab/navigate 跳转）。

> **仓主看到的沙盘 = 2026-06 那版 PmDag + 就绪雷达 + tick 推进。
> 三周的新工作全部堆在打不开的门后面。**（`seed.ts:72-78` 那段注记已经记过一次"只看 L1 就下结论 = 少追一层"，
> 本次对账把它坐实成了产品可见性问题。）

---

## 1. 方法自证（先证明工具没骗我）

按铁律 0.5 第 5 条，报 0 命中前先拿确定存在的符号跑一遍：

```
grep -rn "propagateTick" apps/*/src packages/*/src   → 14 处命中（app.ts:53/1458、propagation.ts:219 …）
```

工具正常（用的是 `grep -rn` 而非 `git grep -- "apps/*/src"`，后者 pathspec 的 `*` 不跨 `/` 会恒 0）。
本文所有「0 命中」结论均在此工具下取得，且**每一条都追到了调用点或注册表**。

---

## 2. 逐条对账（按 PRD 章节号）

### §2 · 本体引用与影响

#### §2-a 新增对象类型 `ChainImpediment`

1. **PRD 要求**：新增 1 个派生对象 `ChainImpediment`，不进 R4 审批面。
2. **今天的实况**：契约已冻结 `packages/contracts/src/chain-sim.ts:535-581`（`ChainImpedimentSchema`，
   zod strictObject + `superRefine` 两条硬约束）；全序比较器 `chain-sim.ts:591`；
   判定器 `apps/datacore/src/solvers/chain-impediment.ts:688 detectChainImpediments`；
   求解器 key 注册 `apps/datacore/src/solvers/service.ts:166` + 分发 `service.ts:4285`；
   目录 `apps/datacore/src/catalog.ts:148`；本体已回写 `docs/SYSTEM-ONTOLOGY.md:176-177`。
   **前端消费方 0**（`grep -rn "chain_impediment\|ChainImpediment" apps/frontend-shell/src`
   只命中 `views/sim/chainLineMap.ts:67` 的一句**注释**）。
   **agentcore 消费方 0**（`grep -rn "chain_impediments" apps/agentcore/src` = 0 —— 但 B 侧
   `apps/agentcore/src/server.ts:1851` 是通用 OBO 代理 `/b/v1/solvers/:key/run`，
   故"问答路能不能调"不取决于硬编码，取决于 catalog 路由，catalog 里在册）。
3. **归类**：`◐后端已有·差前端`（与你已实测的结论一致）
4. **最小 WO**：已派 `WO-IMPEDIMENT-FE`。

#### §2-b 新增诊断链 `ChainScan → ChainImpediment[] → 方案候选 → 试算 → 对比 → ActionDraft`

1. **PRD 要求**：一条挂在编排链侧面的诊断链，五跳全通。
2. **今天的实况**：只通到第 2 跳。
   - `ChainScan → ChainImpediment[]`：✅ `chain-impediment.ts:688`。
   - `每点 fanout 方案候选`：❌ `ChainImpedimentSchema`（`chain-sim.ts:536-564`）**没有 `candidates` 字段**，
     且是 `z.strictObject` ⇒ 多写字段直接抛。契约顶注 `chain-sim.ts:31` 白纸黑字写着
     「`SolutionCandidate`（PRD §5.3 多方案候选）→ **S3 单**；本单不臆造其形状」。
     全仓 `SolutionCandidate` 命中数 = **1**，就是那句注释本身。
   - `→ SimComparePanel 对比`：`SimComparePanel` 唯一生产调用方是 `SandboxView.tsx:454`，
     比的仍是用户自建的两个场景，**不是同一问题的 N 个解法**。
   - `→ ActionDraft（R4）`：`grep -rn "ActionDraft" apps/datacore/src/solvers/chain-impediment.ts` = **0**。
3. **归类**：`❌两半都缺`（第 3–5 跳）
4. **最小 WO**：`WO-SANDBOX-S3-CANDIDATES`（见 §5.3）。

#### §2-c 新增 2 个事件 `chain.scan_completed` / `chain.impediment_resolved`

1. **PRD 要求**：两个事件须回写本体 §4 **并接消费方**，否则就是 #92 那族「发了没人收」。
2. **今天的实况**：全仓（`*.ts/*.tsx/*.mjs/*.sql/*.json`，排除 node_modules 与 dist）对
   `scan_completed` / `impediment_resolved` 的命中数 = **1**，且是
   `packages/contracts/src/chain-sim.ts:540` 的一句注释「`chain.scan_completed` 事件载荷同键」。
   **产出方 0、消费方 0、本体 §4 无登记**（`grep -n "chain.scan_completed" docs/SYSTEM-ONTOLOGY.md` = 0）。
3. **归类**：`❌两半都缺`（连事件名都还只是文档里的一个词）
4. **最小 WO**：`WO-CHAIN-EVENTS` —— 🚦范围边界：`apps/datacore/src/events*`（发事件处）·
   `apps/agentcore/src/**` 或驾驶舱侧一个真消费方 · `docs/SYSTEM-ONTOLOGY.md` §4 回写 · 自己的测试。
   **判据**：不许只发不收（A10）。

#### §2-d 新增 2 道门 `chain-scan-honesty:check` / `chain-scan-determinism:check`

1. **PRD 要求**：新增两道门并登记本体 §7 + `scripts/gate-ledger.json`。
2. **今天的实况**：`ls scripts/` 81 项里**没有**任何 `check-chain-scan-*.mjs`；
   `package.json` 的 `gates` 脚本（23 条门）里也没有；`scripts/gate-ledger.json` 无对应条目。
   全仓对 `chain-scan-honesty` / `chain-scan-determinism` 的命中只出现在
   `docs/PRD-sandbox-redesign.md:56/57/360/401` 本身。
   代偿物：`apps/datacore/test/chain-impediment-seam.test.ts` 是一条真 SEAM 测试
   （规则发布路径 × 判定引擎），但**它是 vitest 用例不是门**，不进 `pnpm gates`。
3. **归类**：`❌两半都缺`（门不存在）
4. **最小 WO**：`WO-CHAIN-SCAN-GATES`（与 §7.3 三门合并派，见下）。

#### §2-e 新登记断点 `G-TIMEGRAIN-SPLIT`

1. **PRD 要求**：实施时写入本体 §8。
2. **今天的实况**：`grep -n "G-TIMEGRAIN-SPLIT" docs/SYSTEM-ONTOLOGY.md` = **0**。未登记。
3. **归类**：`❌两半都缺`（文档层欠账）
4. **最小 WO**：随 `WO-TIMEGRAIN` 一并回写（本体不回写即过期失效 · 铁律 0）。

---

### §4.1 · 目标 G1–G6

| # | PRD 要求 | 今天的实况（file:line） | 归类 |
|---|---|---|---|
| **G1** | 全链扫描器：一次扫描覆盖 ①→④ 四段 × 三业务 | 扫描器在（`chain-impediment.ts:688`），但**判据表只覆盖 2 段**：`IMPEDIMENT_RULE_BINDINGS`（`chain-impediment.ts:106-190`）6 条里 `stage` 取值只有 `CAPACITY`（4 条：`:112` `:124` `:137` `:175`）与 `MATERIAL`（2 条：`:148` `:159`）。**`DEMAND`(①) 与 `ORDER`(②) 零判据**。三业务维度：`service.ts:3123-3128` **显式 400 拒绝** `scope.businessTypes` | `◐后端已有·差前端` ＋ 后端本身覆盖不全 |
| **G2** | 三类阻滞点机器可判定 | ✅ 真做到了，而且做得比 PRD 严：阈值全部从规则表达式 AST 读回（`chain-impediment.ts:2-40` 顶注 + `readRuleThreshold`），引擎内零阈值；互斥裁决单一出处 `arbitrateByLocus`（`chain-impediment.ts:369`）；读不回来一律进 `unresolved[]`；`UNBOUND_IMPEDIMENT_JUDGEMENTS`（`:195-206`）诚实登记「断点·时间全库无规则承载」 | `◐后端已有·差前端` |
| **G3** | 每点 2–4 候选 + 各自真试算 + 同屏对比 | ❌ 见 §2-b / §5.3。`chain_impediments` 输出键（`service.ts:340`）= `["scanId","scope","impediments","counts","unresolved","caveats","thresholds"]`，**无 candidates** | `❌两半都缺` |
| **G4** | 采纳 → `ActionDraft` → 既有审批链 | ❌ `chain-impediment.ts` / `chain-loss.ts` 对 `ActionDraft` 命中 0。沙盘旧屏有采纳→Action（`SandboxView.tsx:343 source:"sim_sandbox"`），但那条链**不接阻滞点** | `❌两半都缺` |
| **G5** | 时间粒度收敛 | ❌ 见 §6，三层不一致原样保留 | `❌两半都缺` |
| **G6** | 补两个聚合缺口（OTD 批次率 / 库存地点×时间） | **后端全做了**：`packages/contracts/src/solver-aggregates.ts`（口径定死 `OTD_BASIS = "CUSTOMER_REQUEST"`，含三条实测证据的选型论证）· 实现 `apps/datacore/src/solvers/aggregates.ts:68 otdBatchRate` / `:230 inventoryLocationSeries` / `chainOperatingCashflow` · 真挂载点 `apps/datacore/src/solvers/risk.ts:774`（`risk_timeline.otdBatch`）与 `apps/datacore/src/solvers/extended.ts:286`（`inventory_optimize.locationSeries`）· SEAM `apps/datacore/test/sandbox-d4-aggregates.seam.test.ts`。**前端消费方 0**：`grep -rn "otdBatch\|locationSeries\|OtdBatch\|InventoryLocationSeries\|chainOperatingCashflow" apps/frontend-shell/src` = **0** | `◐后端已有·差前端` |

> G6 是本次对账里**最容易变现**的一条：后端契约+实现+SEAM 齐全，且它挂在**已经可达**的两个求解器上
> （`risk_timeline` 走 `risk` 视图、`inventory_optimize` 有既有消费面），前端只差把新键读出来渲染。

---

### §5.1 · 三类阻滞点的可判定定义

1. **PRD 要求**：卡点/堵点/断点各有机器可算的判据；阈值引用规则表禁写死；三类互斥，裁决不靠 if 顺序。
2. **今天的实况**：**这一节是全 PRD 完成度最高的**。逐条核：
   - 卡点：`chain-impediment.ts:112`（C02 化成/老化硬容量，实测值由 D3 的 `readProcessHardCapacity().capacityPerDay` 喂入，让此前**恒不可评估**的 C02 第一次真能判）+ `:124`（C05 产线利用率红线）。
   - 堵点：`:137`（C22 换型损失）+ `:148`（C28 呆滞批次，`locusObjectType:"MaterialBatch"`）。
   - 断点·物理：`:159`（C06 齐套缺口，阈值 0 → 用 `magnitudePath:"MaterialBalance.netDemandTon"` 换分母）。
   - 断点·数据：`:175`（C09 `params.staleHours`，纯 param SEAM，改一个数即翻判定）。
   - 断点·时间：**诚实缺席**（`:195-206` `UNBOUND_IMPEDIMENT_JUDGEMENTS`，理由 = 规则库 C01–C33 逐条核过无提前期规则，拒绝自造阈值）。
   - 互斥裁决：`arbitrateByLocus`（`:369`）唯一出处，红线本身也从规则读回（`utilizationRedlineOf`，`:671`）。
   - 排序：走契约冻结的全序 `compareChainImpediment`（`chain-sim.ts:591`），R6 稳。
   **但有两处"接了线没数据"**（必须与"没接线"分开，修法不同）：
   - C22 的 `Order.changeoverMin` 在 `battery.ts` 只命中 **1 次**（就是 `battery.ts:289` 规则串本身），
     **无对象属性承载** ⇒ 该堵点判据恒 `UNKNOWN`。本体 `SYSTEM-ONTOLOGY.md:177` 已记此事。
   - C05 含 `SUSTAIN(...)`，而 `SolverContext` 无时序访问 ⇒ 只读红线不校验"持续 N 天"，
     结论标 `dataMode:PARTIAL` + `caveats[]`（诚实，但不是全量判定）。
3. **归类**：`◐后端已有·差前端`（判定层）＋ 局部 `接了线没数据`（C22）
4. **最小 WO**：`WO-C22-CARRIER` —— 🚦范围边界：`apps/datacore/src/synthetic/battery.ts`（`Order` 属性 + 种子）· migration · 自己的测试。**判据**：种下 `changeoverMin` 后 `chain_impediments` 的 `CONGESTION.CAPACITY.order-changeover` 从 `unresolved` 变成真判定，且变异反证（删属性→回 unresolved）真红。

---

### §5.2 · `ChainImpediment` 对象形态

1. **PRD 要求**：14 个字段含 `candidates`；`severity` 必须算出来 = 归一化(超阈幅度) × 归一化(下游受影响订单金额)；`manifestations` 归并同根因。
2. **今天的实况**：
   - 字段：`chain-sim.ts:536-564` 有 `impedimentId/tenantId/scanId/kind/breakSubtype/stage/scope/nodeId/stepId/locus/severity/evidence/dataMode/manifestations/rootCauseImpedimentId`。**缺 `candidates`**（刻意留给 S3，见 `chain-sim.ts:31`）。
   - `severity`：`chain-impediment.ts:618`
     `severity = clamp(round(breach / denom * 100), 0, 100)` —— **只有第一个因子**（超阈幅度/阈值，阈值为 0 时降到 `magnitudePath` 规模基准）。**没有「下游受影响订单金额」这一维**。算不出来时 `:612-617` 拒绝拍数（诚实，原文「severity 算不出来，拒绝拍一个数」），符合"禁固定权重表"，但不符合 PRD 的双因子建议。
   - `manifestations` / `rootCauseImpedimentId`：**契约有定义，全仓零生产者** ——
     `grep -rn "manifestations|rootCauseImpediment" apps/*/src packages/*/src` 只命中
     `chain-sim.ts:511 / :561 / :563` 三行**契约自身**。`detectChainImpediments`（`:688-745`）
     的实现是「逐 binding 判 → `arbitrateByLocus` 按 locus 裁决 → 排序返回」，
     **没有建图、没有跨段追踪、没有归并**。
3. **归类**：字段/严重度 `◐后端已有·差前端`；`manifestations` `❌两半都缺`（契约声明了，产出端 0 —— 这正是"声明 ≠ 实现"）
4. **最小 WO**：`WO-CHAIN-SCAN-DEDUP`（见 §7.2②）。

---

### §5.3 · 多方案生成与对比（A/B/C 方案 + 代价）—— **重点排查项**

1. **PRD 要求**：方案候选从本体可动杠杆里选（复用 `discoverCapacityLevers` / `LEVER_PROP_META`）→ 每类 2–4 个候选 → 每个候选走 `propagateTick`/`optimize_whatif` **真试算** → 复用 `SimComparePanel` + `MultiObjWhatifPanel` 同屏对比 → 候选间 KPI 必须真的不同（A4 变异反证）。

2. **今天的实况**（逐个零件核，不拿"有相似东西"当"有"）：

   | 零件 | 实况 | 定性 |
   |---|---|---|
   | 杠杆枚举机制 | ✅ 在且活：`service.ts:374 LEVER_PROP_META` · `service.ts:699 discoverLevers`（本体 `derivationSpecs` 反向 walk）· `service.ts:840 discoverCapacityLevers`（capacity grain 真链反推）· 入口 `service.ts:657`；前端真消费方 `views/sim/DynamicLeverPanel.tsx:136` | ✅已实现（**可直接复用，别重造**） |
   | 候选**契约** | ❌ `SolutionCandidate` 全仓 1 处命中 = `chain-sim.ts:31` 的「本单不臆造其形状」注释 | ❌两半都缺 |
   | 候选**生成器** | ❌ 无。`chain_impediments` 输出无 candidates（`service.ts:340`） | ❌两半都缺 |
   | 候选**试算** | `optimize_whatif` 求解器在（`service.ts:288` 输出键 `baselineObjective/perturbedObjective/deltaObjective/feasible/conflictConstraints/…`），`propagateTick` 在（`sim/propagation.ts:219`，经 `app.ts:1458` 调用）。**但没有任何代码把"某个阻滞点的候选"喂进它们** | 接了线接错地方（引擎在，缺编排） |
   | 对比**面板** | `SimComparePanel` 唯一生产调用方 `SandboxView.tsx:454`（比用户自建的两场景）；`MultiObjWhatifPanel` 唯一生产调用方 `GlobalSimView.tsx:925` | 接了线接错地方 |
   | **最接近 PRD 意图的既有资产** | `decision_play` 求解器：`catalog.ts:88` 描述明写「对某根因生成 **≥3 个决策方案**（各维度真算：补缺口/代价/周期/风险/矿价敞口/可逆性）→ **比对矩阵** → 触发规则 → 贪心组合 → 试算差距收窄」；输出键 `service.ts:315` = `["rootCause","options","matrix","triggers","recommendedPlan","sandboxNarrowing","summary"]`；前端 `DecisionPlayView` 有专用路由 `App.tsx:138` | ✅已实现，**但它的输入是 `gap_attribution` 的根因，不是 `ChainImpediment`** |

   > **关键判断（这一条决定 WO 怎么切）**：「多方案 + 代价 + 比对矩阵」这台机器**本仓已经有了**
   > （`decision_play`），PRD 要的不是造第二台，是**把 `ChainImpediment` 接成它的第二种输入**。
   > 这是「扩挂载点」，不是「造机制」——按 `WO-SANDBOX-SERIES.md §1.1` 的教训，此类误判会把工作量报错一个量级。
   > ⚠ 未查清项：`decision_play` 的 `options` 是否由**杠杆**派生（对齐 PRD §5.3 第 1 条）还是另有来源 ——
   > 我没有逐行读 `decision_play` 实现（它在 `service.ts` 里，与本次取证范围外）。立单时须先核这一层。

   > **另一条 PRD 未提但今天成立的阻塞**：`docs/PRD-sandbox-redesign.md:480-481` 自述
   > 「B5 外协红线 C08 口径与三个消费方打架（任务 #77）」——仓库有 `scripts/check-outsource-redline.mjs`
   > 且已进 `pnpm gates`，说明 #77 已被立门治理；但门存在 ≠ 口径已统一。立 S3 单前需确认 #77 状态。

3. **归类**：`❌两半都缺`（候选契约 + 生成器 + 编排），但**引擎与对比面板都是现成资产**。
4. **最小 WO**：`WO-SANDBOX-S3-CANDIDATES`【整单·跨引擎/前端两半，不许拆】
   🚦范围边界：`packages/contracts/src/chain-sim.ts`（additive 追加 `SolutionCandidate` + `ChainImpedimentSchema` 加 `candidates?`，注意是 strictObject 必须在契约里加）·
   `apps/datacore/src/solvers/chain-impediment.ts` + `service.ts`（候选生成走 `discoverLevers`，禁写死文案）·
   `apps/frontend-shell/src/views/sim/`（对比区复用 `SimComparePanel`/`MultiObjWhatifPanel`，禁新造）· 自己的测试。
   **SEAM 判据**：同一阻滞点的 N 个候选，KPI 至少一项互不相同；**掐掉某个杠杆接线 → 对应候选变得与基线相同 → 门必须红**（PRD A4 变异反证）。

---

### §5.4 · 三业务（乘用车 / 商用车 / 储能）—— **重点排查项**

1. **PRD 要求**：同一套模型换参数；扫描器一次跑全量、结果按 `seg` 打标 + 可筛；跨 seg 权衡是一等场景，「保谁」判据来自 `SEG_REGISTRY.marginPct/floorPct`；禁内联字面量。

2. **今天的实况**（分三层核）：

   **① 单一来源层：✅ 完整。**
   `packages/contracts/src/base-registry.ts` `SEG_REGISTRY` 在；
   业务线枚举单源 `BusinessTypeSchema`（`global-sim.ts`，`passenger|commercial|storage`）；
   桥函数 `chain-sim.ts:207 segOfBusinessType`（零字面量把 `BusinessType` 映到 `SEG_REGISTRY.seg`）；
   `boundary-singlesource:check` + `debattery:check` 都在 `pnpm gates` 里守着。

   **② scope 归一层：✅ 已做（WO-SANDBOX-E2），且治好了一个真事故。**
   `apps/datacore/src/solvers/scope.ts:75 normalizeChainScope` 是单一出处；
   顶注（`scope.ts:6-33`）记录了三分法自查：业务线维**早就接了线**（portfolio 分支），
   病在**只挂了 portfolio 一个点**。修后真消费方：
   `service.ts:2734`（portfolio）· `service.ts:3220` · `service.ts:3323` ·
   `risk.ts:1148`（`affected_orders` 一族）· `risk.ts:1270`。
   闭掉的断点 `G-PORTFOLIO-BT-SILENT-ALL`（`SYSTEM-ONTOLOGY.md:1007`）实测坐实：
   旧码 `businessTypes:["氢能"]` 与不传**逐字节同结果**（静默返全域），现在认不出即 400 列出合法值。

   **③ 进沙盘层：❌ 没进。** 这是 §5.4 的真缺口，两处：
   - **扫描器不吃这一维**：`apps/datacore/src/solvers/service.ts:3123-3128` ——
     `chain_impediments` 对 `scope.businessTypes` / `scope.modelIds` **显式抛 400**
     （注释写明「业务线 scope 入口属 WO-SANDBOX-E2」）。
     诚实（拒绝静默返全域），但结果是**"按 seg 打标 + 可筛"today 做不到**。
     且 `ChainImpedimentSchema` 里也**没有 `seg` 字段**（PRD §5.2 要求有；契约 `chain-sim.ts:536-564` 无）。
   - **跨 seg 权衡不在沙盘**：唯一能按业务线勾选重解的界面是**全局联合推演**
     `views/sim/GlobalSimView.tsx:455-460`（三业务复选框）→ `:287` `args.businessTypes`
     → 后端在收窄世界真重解。这是**可达**的（`global-sim` 在 `BUILTIN_VIEWS`），
     但它是 `portfolio` 求解器的页面，**不是阻滞点扫描**；
     PRD A7「眉山某线被乘用车/储能同时争用 → 按 marginPct 保谁」这一类场景卡今天**无对应产出**。

3. **归类**：`◐后端已有·差前端` 之外还差**后端一跳**（扫描器 scope 挂载点）⇒ 准确说是
   `接了线接错地方`（E2 的归一器造好了但没挂到 E3 上）。
4. **最小 WO**：`WO-E3-SCOPE-SEG`【整单】
   🚦范围边界：`apps/datacore/src/solvers/service.ts`（`chainImpediments` 改走 `normalizeChainScope`）·
   `apps/datacore/src/solvers/chain-impediment.ts`（按 seg 收窄 + 结果打标）·
   `packages/contracts/src/chain-sim.ts`（`ChainImpediment` 加 `seg` 字段，派生自 `SEG_REGISTRY` 禁内联）· 自己的测试。
   **SEAM 判据**（照 PRD A6）：**改 `SEG_REGISTRY` 一个值 → 结论真跟着变**；
   选储能不泄漏其他细分（复用 `apps/datacore/test/sandbox-chain-scope.seam.test.ts` 的形态）。

---

### §6 · 源数据扩充与时间粒度 —— **重点排查项（核实 §6.1「三层不一致」今天是否还成立）**

#### §6.1 实测现状复核 —— **结论：三层不一致 100% 成立，且比 PRD 写的更细一点**

| 层 | PRD 2026-08-04 写的 | 2026-08-07 复核实况 | 是否仍成立 |
|---|---|---|---|
| A8 时序引擎能力 | shift/day/week 三档 | ✅ 原样：`apps/datacore/src/timeseries.ts:48 bucketOf(grain)` 三分支；契约 `packages/contracts/src/timeseries.ts:18/:35` 枚举 `["shift","day","week"]` | **成立** |
| 合成种子实际产出 | 5 条序列全 `grain:"day"` | ✅ 现在是 **6 条**，仍**全部 `grain:"day"`**：`apps/datacore/src/synthetic/battery.ts:2602`(oee:equip) `:2603`(yield:process) `:2604`(output:line) `:2605`(attainment:line) `:2606`(util:line) `:2610`(attainment:base，PRD 之后新增) | **成立**（数量从 5→6，全 day 未变） |
| 生成器**能不能**产 shift | 未写 | 生成器**支持**：`apps/datacore/src/synthetic/tsgen.ts:7` `grain: "shift" \| "day"`。⇒ 这是**接了线没数据**（能力在、没人传 shift），不是没接线 | 新增结论 |
| 求解器时间轴 | day（horizon 30/60/90） | ✅ 未变 | **成立** |
| **120 桶上限** | `timeseries.ts:373` | 行号漂到 **`apps/datacore/src/timeseries.ts:396-399`**：`grainMs = week?7d : day?1d : DAY_MS/2`（**注意 shift 被当成半天而非 1/3 天**），`bucketCount > 120` → 400「use a coarser grain」 | **成立**（行号已漂，且 shift 的桶宽实现是 12h 不是 8h —— PRD §6.2 按"3 班/日 → 40 天"算的最大窗口，实际实现是 **60 天**） |

> ⚠ **PRD §6.2 表格里的一个数今天对不上**：PRD 写「shift（3 班/日）最大窗口 40 天」，
> 而 `timeseries.ts:396` 的 shift 桶宽 = `DAY_MS / 2`（12 小时 = 2 班/日）⇒ 120 桶 = **60 天**。
> 这不改变「shift 与全链到采购互斥」的结论方向（采购提前期常 30–90 天），但**立单前必须以代码为准修正 PRD**
> ——否则会按一个错的窗口数去做取舍决策。

1. **PRD 要求（§6.3 配套三件）**：① 种子真产 shift 数据 + 班次剧本；② 扫描器在③段按 shift 聚合后喂既有求解器（适配层）；③ 超 120 桶自动降 grain 并标 `grainDowngraded:true`，**不许静默降级**。
2. **今天的实况**：
   - ①：**0**（6 条序列全 day，见上；`battery.ts` 无任何班次剧本）。
   - ②：**0**（`chain-impediment.ts` 无任何 shift 聚合适配层；`SolverContext` 本来就无时序访问，见 `chain-impediment.ts:20-27` 顶注）。
   - ③：`grep -rn "grainDowngraded" apps/datacore/src apps/frontend-shell/src packages/contracts/src` = **0**。今天的行为是**直接抛 400**（`timeseries.ts:398`），既不降级也不标注。
3. **归类**：`❌两半都缺`
4. **最小 WO**：`WO-TIMEGRAIN`【整单·跨数据/引擎两半】
   🚦范围边界：`apps/datacore/src/synthetic/battery.ts`（③段序列加 shift 档 + 班次剧本）·
   `apps/datacore/src/synthetic/tsgen.ts`（若剧本需要）· `apps/datacore/src/timeseries.ts`（降级标注）·
   `packages/contracts/src/timeseries.ts`（`grainDowngraded` 字段）· migration · 自己的测试 ·
   `docs/SYSTEM-ONTOLOGY.md` §8 登记 `G-TIMEGRAIN-SPLIT`。
   **⚠ 金值警告**：动 `tsGenerators` 会改 R6 确定性种子输出 ⇒ 必须同步
   `apps/datacore/test/synthetic.test.ts` 与 `adversary-r6-golden-probe.test.ts` 的金值，漏金值即退。
   **变异反证**：三个班的数据一模一样（没有班次剧本）→ 测试必须红（PRD §6.3①：提频等于把同一个数抄三遍，是新一种假数据）。

---

### §7 · 数据关联性（三种关联）—— **重点排查项**

#### §7.1 立 R19「时间自洽」不变量

1. **PRD 要求**：建议立 `R19 · 时间自洽`，与 R18 尺度自洽同构。
2. **今天的实况**：**编号已被占用** —— `docs/SYSTEM-ONTOLOGY.md:798` 的 **R19 = 「任何非终态状态都必须有明确的终态责任人」**（WO-COORD-YIELD-AND-TERMINAL，闭 `G-TASK-NO-TERMINAL`）。
   本体里搜不到任何「时间自洽」不变量。
3. **归类**：`❌两半都缺` ＋ **文档冲突**（PRD 的编号建议已过期）
4. **最小 WO**：随 `WO-TIMEGRAIN` 回写本体时改用下一个空号（当前最大 R19 ⇒ 用 **R20**），并在 PRD §7.1 打更正记录。

#### §7.2① 时间维关联（比率类必须 `weighted_avg` + `weightField`）

1. **PRD 要求**：`output:line` → `sum`；`util:line`/`oee:equip`/`yield:process`/`attainment:line` → `weighted_avg`（按 output 加权）。并指出「今天这层没有强制」。
2. **今天的实况**：**不但没有门，连数据本身就是错的**（这是本次对账里最"安静"的一处真错）。
   逐条核 `apps/datacore/src/synthetic/battery.ts:2628-2633` 的 `BATTERY_TS_AGG_SPECS`：

   | agg spec | 序列语义 | PRD 要求 | 今天代码 | 判定 |
   |---|---|---|---|---|
   | `oee_daily_7d`（`:2628`） | 比率 | `weighted_avg` | `weighted_avg` + `weightField:"output"` | ✅ |
   | `yield_daily`（`:2629`） | 比率 | `weighted_avg` | **`avg`**（无 weightField） | ❌ |
   | `line_output_daily`（`:2630`） | 存量 | `sum` | `sum` | ✅ |
   | `schedule_attainment`（`:2631`） | 比率 | `weighted_avg` | **`avg`** | ❌ |
   | `line_util_daily`（`:2632`） | 比率 | `weighted_avg` | **`avg`** | ❌ |
   | `forecast_dev_daily`（`:2633`） | 比率 | （PRD 未列） | `avg` | ⚠ 同族 |

   引擎侧支持是齐的（`apps/datacore/src/timeseries.ts:281/:323` 真读 `weightField`；
   契约 `packages/contracts/src/timeseries.ts:22` 注明「weighted_avg 必填」），
   **⇒ 三分法定性 = `接了线接错地方`**：机制在、算子选错了。
   PRD 说「提频到 shift 后这个洞会被放大 3 倍触发」——今天在 day 档就已经在错，只是没人量。
   > 同一结论 `docs/PRD-data-backfill.md:137/:188`（A8 判据）也记过，说明这是**两份 PRD 共同指出、至今无人执行**的一条。
3. **归类**：`❌两半都缺`（门）＋ `接了线接错地方`（3 条 agg 算子选错）
4. **最小 WO**：`WO-SERIES-AGG-CONTRACT`
   🚦范围边界：`scripts/check-series-agg-contract.mjs`（新门）· `package.json`(`gates` 串接) ·
   `scripts/gate-ledger.json` · `apps/datacore/src/synthetic/battery.ts:2628-2633`（改 3 条算子）·
   `docs/SYSTEM-ONTOLOGY.md` §7 登记。
   **⚠ 金值警告**：改 agg 算子会改派生属性值（`Line.utilization` / `Process.yield_baseline` /
   `Line.schedule_attainment`）⇒ 下游求解器输出、`demo-chain` / `ontology-core` 金值都要跟着更。
   **变异反证**（PRD 原话）：把 `util:line` 的算子改成 `sum` → 门必须红。

#### §7.2② 对象维关联（先建图再判点 + 同根因归并 + 限深限量）

1. **PRD 要求**：三条硬性 —— ① 扫描必须先建图再判点；② 同根因去重（1 条 + N 个 `manifestations`）；③ 遍历限深限量、超限显式标注截断。
2. **今天的实况**：**三条全未实现。**
   `detectChainImpediments`（`chain-impediment.ts:688-745`）的实现是：
   `for (const b of bindings) judgeOne(...)` → `arbitrateByLocus(candidates, redline)` → 排序返回。
   `arbitrateByLocus`（`:369-411`）只在**同一个 locus**内做三类互斥裁决，
   **不跨 stage、不走关系、不归并根因**。
   `manifestations` / `rootCauseImpedimentId` 全仓零生产者（见 §5.2）。
   无深度/节点数上限、无截断标注。
   PRD §7.2 提到的可复用资产 `discoverLevers` 反向 walk（`service.ts:699`）确实在，**但扫描器没用它**。
3. **归类**：`❌两半都缺`
4. **最小 WO**：`WO-CHAIN-SCAN-DEDUP`【整单】
   🚦范围边界：`apps/datacore/src/solvers/chain-impediment.ts`（建图 + 归并 + 限深限量）·
   `scripts/check-chain-scan-dedup.mjs`（新门）· `scripts/gate-ledger.json` · `package.json` · 自己的测试。
   **SEAM 判据**（照 PRD §7.3 原文）：构造一条「物料断→产线堵→订单险」的链，
   扫描结果**必须是 1 条带 3 个 manifestations**，退化成 3 条 → 红。

#### §7.2③ 尺度维关联（R18 已解，沙盘不得破坏）

1. **PRD 要求**：沙盘新算的数继续走 R18 的桥，禁新写换算常数。
2. **今天的实况**：✅ 守住了。`chain-impediment.ts` 顶注（`:4-10`）「本引擎里没有任何业务阈值，一个数字都没有」；
   前端 `CustomerImpactBar.tsx:14/:28/:29` 影响额一律经 `SEG_REGISTRY.priceWan` 派生；
   `boundary-singlesource:check` / `debattery:check` / `chain-node-singlesource:check` 三门在 `pnpm gates` 里守。
3. **归类**：`✅已实现`
4. **最小 WO**：无（保持现状即可；S3/S4 立单时把它写进不许越界项）。

#### §7.3 配套的三道门

1. **PRD 要求**：`time-coherence:check` / `series-agg-contract:check` / `chain-scan-dedup:check`，三门都要登记本体 §7 **且**进 `scripts/gate-ledger.json`。
2. **今天的实况**：**三道门一道都不存在。**
   - `ls scripts/` 81 项无任何一条同名/近名脚本；
   - `package.json` 的 `gates` = 23 条门，逐条核过，无这三条
     （现有 23 条：`system-ontology`/`ontology-anchors`/`chain-closure`/`debattery`/`prd-ontology`/`prd-coverage`/
     `meta-sync`/`resource-descriptor`/`ontology-slice-coverage`/`slice-connectivity`/`loop-control`/`arg-drop-seam`/
     `scenario-slot-keys`/`action-wiring`/`outsource-redline`/`boundary-singlesource`/`chain-node-singlesource`/
     `view-reachable`/`ontology-descriptions`/`deploy-governance`/`migration-numbering`/`no-raw-nul`/`gate-ledger`）；
   - `scripts/gate-ledger.json` 无对应条目；
   - 全仓这三个门名的命中**全部落在 PRD 文档自身**（`PRD-sandbox-redesign.md:324/325/326` 等）。
   **⇒ 加上 §2-d 的两道，PRD 一共要 5 道门，今天存在 0 道。**
3. **归类**：`❌两半都缺`
4. **最小 WO**：拆两单派（互不冲突，可并行）：
   - `WO-SERIES-AGG-CONTRACT`（见 §7.2①，含 `series-agg-contract:check`）
   - `WO-CHAIN-SCAN-GATES` —— 🚦范围边界：`scripts/check-chain-scan-honesty.mjs` /
     `check-chain-scan-determinism.mjs` / `check-time-coherence.mjs`（三个新文件）· `package.json` ·
     `scripts/gate-ledger.json` · `docs/SYSTEM-ONTOLOGY.md` §7。**不碰任何 `apps/*/src`。**
     **判据**：每道门必须给出**变异反证真红原文**（本仓 `gate-ledger.json` 的 `provenRed` 字段就是记这个的）。

#### §7.4 对 §6 提频方案的三个前提

1. **PRD 要求**：③段提 shift 时跨段 join 必须先聚合回 day；聚合位置唯一；降级后的数不许进跨段比较。
2. **今天的实况**：**三条都还没到能验的阶段**（因为 §6 的 shift 数据根本不存在）。
   唯一相关的既成事实：跨段聚合今天没有统一收口点（`BATTERY_TS_AGG_SPECS` 是一处、
   求解器内各自读对象快照是另一处），符合 PRD 担心的"两处各自聚合、口径漂移"形态 ——
   但这一条我**没有追到底**（见 §4 诚实边界）。
3. **归类**：`❌两半都缺`
4. **最小 WO**：并入 `WO-TIMEGRAIN` 的验收判据，不单独立单。

---

### §9 · 验收判据 A1–A11 现状

| # | 判据 | 今天能不能核 | 证据 |
|---|---|---|---|
| A1 | 每个阻滞点 `evidence.solverKey` 指向的求解器真被调用过 | ⚠ 半成立 | `evidence.solverKey` 恒为 `chain_impediments` 自身（`chain-impediment.ts:668 CHAIN_IMPEDIMENT_SOLVER_KEY`，`:635` 写入）—— 它**没有指向 `bottleneck_matrix`/`mrp_netting` 这些 PRD §5.1 列的主用求解器**，而是自证。溯源真正落在 `evidence.ruleKey` + `ruleParamKey`（规则维，比 PRD 设想的更强），但 A1 的字面判据核不了 |
| A2 | 零写死 + `chain-scan-honesty:check` 绿 | ❌ 门不存在 | §2-d |
| A3 | R6 确定性两次字节一致 | ◐ 结构上成立、无门 | `scanId` 由输入哈希派生（`chain-impediment.ts:692`）、全序排序（`chain-sim.ts:591`）、纯函数无时钟；但 `chain-scan-determinism:check` 不存在 |
| A4 | 候选真不同 + 掐杠杆变异反证 | ❌ 无候选 | §5.3 |
| A5 | 亲手真跑 ≥3 个阻滞点核对 | ❌ 无入口可跑 | §0；且 PRD §11 自述「没有真跑过沙盘页」，至今未补 |
| A6 | 三业务：改 `SEG_REGISTRY` 一个值结论跟着变 | ❌ 扫描器拒绝 seg 维 | `service.ts:3123-3128` |
| A7 | `boundary-singlesource:check` 绿 | ✅ 门在且在 `pnpm gates` | `package.json` gates |
| A8 | 粒度诚实 `grainDowngraded:true` | ❌ 0 命中 | §6 |
| A9 | R4：只产 ActionDraft | ❌ 无链 | §4.1 G4 |
| A10 | 两个新事件有真消费方 | ❌ 事件不存在 | §2-c |
| A11 | 两道新门登记本体 §7 + gate-ledger | ❌ 门不存在 | §2-d |

---

### §10 · 分期 S1–S5 与点亮判据

| 期 | PRD 内容 | 实况 | 归类 |
|---|---|---|---|
| **S1** | 扫描器骨架 + 卡点一类 | ✅ 骨架 + 卡点 2 条判据 + 堵点 2 条 + 断点 2 条（**超额**，做到了 S2 的一部分）；但 A1/A2/A3 三条出口判据的**门**一道都没有，A5 无法跑 | `◐后端已有·差前端` |
| **S2** | 堵点/断点 + ④段最小供应链判据 | ◐ 三类判据都在册，但断点·时间诚实缺席（无规则承载）、堵点·换型无数据承载 | `⚠需新对象类型或新数据源`（`Order.changeoverMin` 承载 + 一条提前期规则） |
| **S3** | 多方案生成 + 对比 | ❌ 未开工（契约明写留给 S3） | `❌两半都缺` |
| **S4** | 三业务跨 seg + 粒度分层 | ❌ 未开工 | `❌两半都缺` |
| **S5** | R4 + 两事件消费方 | ❌ 未开工 | `❌两半都缺` |

#### §10.1 `sim.sandbox` 点亮判据 —— **PRD 的前提已经过期**

1. **PRD 要求**：`sim.sandbox` 今天是暗发（默认关），三条（A1 证据可溯源 / A2 零写死 / A5 亲手真跑）同时成立才点亮。
2. **今天的实况**：**「默认关」对 demo 租户不成立**（追了三层才看清，只看 L1 会判错）：
   - L1：`apps/datacore/src/features.ts:81` `{ key:"sim.sandbox", defaultOn:false }` ← 只看这一行会得出"关着"
   - L2：`apps/datacore/src/features.ts:283` battery 行业模板 = `ALL_FEATURE_KEYS` 减去
     `QOS_DARK_LAUNCH_FEATURES`（`:160-175`，14 键）与 `PERF_DARK_LAUNCH_FEATURES`（`:182-184`，1 键）——
     **`sim.*` 不在这两个集合里**（`features.ts:157-158` 注释亦明写「产品分档特性（sim.* / opt.* 等）不在此列，照常随模板开」）
   - L2 合并：`apps/datacore/src/features.ts:314-315` `for (const k of tmpl) if (byKey.has(k)) on.add(k)` ⇒ **开**
   - demo 租户 industry：`apps/datacore/src/seed.ts:17` `industry:"battery-manufacturing"` ⇒ 命中该模板
   - `apps/datacore/src/seed.ts:72-78` 已实测坐实过同一结论（删掉 override 里 sim.* 三键，
     `GET /a/v1/me/workspace` 仍返回全部 7 个 sim.* 键）。
   ⇒ 侧栏「推演沙盘」（`ShellLayout.tsx:298-307`）**是显示的**，`/v/sim-sandbox` **能打开**，
   打开的是 `SandboxView.tsx`（462 行，无任何新工作）。
3. **归类**：`⚠ PRD 前提失效` —— 真正的「点亮」问题不是 entitlement 开关，
   **是那 4 个新视图连视图册都没进**（§0）。
4. **最小 WO**：见下表 D-1。**并附一条 PRD 更正**：§10.1「今天是暗发默认关」须改写为
   「L1 默认关但 battery 行业模板 L2 已开；真正的可见性闸在 `BUILTIN_VIEWS` 与 `NAV_GROUPS`」。

---

### 附录 A · 场景卡 20 例

1. **PRD 要求**：A1–A10（扫描模式）+ B1–B10（带单来问）作为 A5 验收候选。
2. **今天的实况**：`grep -rn "阻滞点\|卡点\|堵点\|断点" apps/agentcore/src/scenarios-catalog.ts` = **0** ——
   20 例**一条都没进场景启动器目录**。
   逐条能不能跑，取决于上面各节：A1/A2 有判据但无入口；A3 有（C06 已绑）；A4 诚实缺席（无提前期规则）；
   A6 数据断已绑（C09）；A7/A9/A10 全缺；B 组全部依赖 §5.3 的候选机制。
   PRD A.3 反查出的缺口里，`MaterialBalance.coverage` 复核确认**仍无承载**
   （`battery.ts` 里 `coverageDays` 是 `Shipment` 的属性，`battery.ts:1135`；`MaterialBalance` 上没有）。
3. **归类**：`❌两半都缺`
4. **最小 WO**：`WO-SANDBOX-SCENARIO-CARDS` —— 🚦范围边界：`apps/agentcore/src/scenarios-catalog.ts` ·
   自己的测试。**判据**：只把**今天真能跑通**的卡入册（A3/A6 等），跑不通的**不许入册装作能做**
   （PRD §A.2 对 B5 就是这个纪律：「不装作能做」）。

---

## 3. 派单建议表（**按投入产出排序 —— 最上面几单最快让界面出现可见变化**）

> 排序依据：① 用户可见性增量；② 是否只差"最后一跳"（接线 vs 造机制）；③ 是否会动 R6 金值（动金值 = 慢）。
> 画像标注按铁律 2：**重**=跑 datacore vitest（同时 ≤1）· **中**=跑 agentcore/frontend vitest（2–3）· **轻**=只读/写门/写文档。

| 序 | WO | 让仓主看见什么 | 为什么最快 | 🚦范围边界 | 画像 | 动金值？ |
|---|---|---|---|---|---|---|
| **D-1** | **`WO-SANDBOX-VIEW-MOUNT`**【整单】 | **4 个已完工的新视图当场出现在左侧导航**：全链线路图 / 物理拓扑 / 节点检视 / 在途实时层 | 组件、测试、渲染器注册**全部现成**（`registry.ts:75/80/85/91`），只差后端视图册 + 导航一条记录。这是纯"补挂载点" | `apps/datacore/src/synthetic/view-manifest.ts`（`BUILTIN_VIEWS` 加 4 项 + `view.*` 功能键自动派生）· `apps/datacore/src/synthetic/service.ts`（`VIEW_DEFS` 若需 layout）· `apps/frontend-shell/src/pages/ShellLayout.tsx`（`NAV_GROUPS:38`「推演」组加 4 项）· `apps/datacore/test/synthetic.test.ts:28`（`report.views` 金值）· `apps/datacore/test/memory-mode-views.test.ts` | 重 | **是**（`report.views` 金值必更，见 `synthetic.test.ts:26-28`） |
| **D-2** | **`WO-VIEW-MOUNT-GATE`** | （不可见，但防复发） | 现有 `check-view-reachable.mjs` 只查**模块图有没有人引用**（`scripts/check-view-reachable.mjs:24-27` 自述），**查不到"后端有没有这个视图"** —— F3/F4/F2 三次栽在渲染器注册，第四次栽在视图册。同一个病第二次就该交给机器判 | `scripts/check-view-reachable.mjs`（扩判据：registry 键 ↔ `BUILTIN_VIEWS.renderer` ∪ App.tsx 静态路由，双向对账）· `scripts/gate-ledger.json` · `docs/SYSTEM-ONTOLOGY.md` §7 | 轻 | 否 |
| **D-3** | **`WO-D4-AGGREGATES-FE`** | 界面上**第一次出现「这批单准时率 %」与「各地库存的时间演化」** | 后端契约+实现+SEAM 全绿（`solver-aggregates.ts` / `aggregates.ts:68,230` / `risk.ts:774` / `extended.ts:286`），且挂在**已经可达**的 `risk_timeline`、`inventory_optimize` 上；前端只读新键 | `apps/frontend-shell/src/views/`（RiskBoard / 库存相关视图）· `apps/frontend-shell/test/` | 中 | 否 |
| **D-4** | `WO-IMPEDIMENT-FE`（**已派**） | 卡点/堵点/断点第一次上屏 | 后端全绿 | — | 中 | 否 |
| **D-5** | `WO-DECISION-INFO-FE`（**已派**） | `doNothing` / `exposureOrder` 上屏 | 后端全绿 | — | 中 | 否 |
| **D-6** | **`WO-E3-SCOPE-SEG`**【整单】 | 阻滞点**能按乘用车/商用车/储能筛**；改 `SEG_REGISTRY` 结论真跟着变（A6） | `normalizeChainScope` 已是单源且有 5 个真消费方，只差挂到 `chainImpediments` 上（今天 `service.ts:3125` 是**显式 400**） | `apps/datacore/src/solvers/service.ts` · `apps/datacore/src/solvers/chain-impediment.ts` · `packages/contracts/src/chain-sim.ts`（加 `seg`）· 自己的测试 | 重 | 否 |
| **D-7** | **`WO-SERIES-AGG-CONTRACT`** | （数值变对，界面同形）— 但这是**今天就在错**的三个数：利用率/良率/达成率的日聚合用了 `avg` 而非 `weighted_avg` | 门 + 3 行算子修改，工作量小；错值影响面大（利用率是卡点判定的输入） | `scripts/check-series-agg-contract.mjs`(新) · `package.json` · `scripts/gate-ledger.json` · `apps/datacore/src/synthetic/battery.ts:2629/2631/2632` · `docs/SYSTEM-ONTOLOGY.md` §7 | 重 | **是**（派生属性值变 → 下游金值连锁） |
| **D-8** | **`WO-C22-CARRIER`** | 堵点·换型从「算不出来」变成真判定 | 只需给 `Order` 加一个属性 + 种子（今天 `changeoverMin` 只存在于规则串 `battery.ts:289`） | `apps/datacore/src/synthetic/battery.ts` · migration · 自己的测试 | 重 | **是** |
| **D-9** | **`WO-SANDBOX-S3-CANDIDATES`**【整单·大】 | **PRD 的核心承诺：每个阻滞点给 2–4 个方案 + 代价对比** | 杠杆枚举（`discoverLevers`）与多方案机器（`decision_play`）**都是现成资产**，是"扩挂载点"不是"造机制"；但跨契约/引擎/前端三层，工作量真实 | `packages/contracts/src/chain-sim.ts` · `apps/datacore/src/solvers/chain-impediment.ts` + `service.ts` · `apps/frontend-shell/src/views/sim/` · 自己的测试 | 重 | 否 |
| **D-10** | **`WO-CHAIN-SCAN-GATES`** | （不可见）三道门 | 纯脚本单，与所有其他单零冲突，可随时插队并行 | `scripts/check-chain-scan-{honesty,determinism}.mjs` · `check-time-coherence.mjs` · `package.json` · `scripts/gate-ledger.json` · `docs/SYSTEM-ONTOLOGY.md` §7。**不碰 `apps/*/src`** | 轻 | 否 |
| **D-11** | **`WO-CHAIN-SCAN-DEDUP`**【整单】 | 三条重复告警合并成 1 条带 3 个 manifestations（A10 场景卡） | 契约字段已冻结，只缺生产者；但要建图 + 限深限量，是真算法工作 | `apps/datacore/src/solvers/chain-impediment.ts` · `scripts/check-chain-scan-dedup.mjs` · 自己的测试 | 重 | 否 |
| **D-12** | **`WO-CHAIN-EVENTS`** | 驾驶舱能统计「发现→处置」转化率 | 两个事件 + 一个真消费方 | `apps/datacore/src/`（发事件）· 一个真消费端 · `docs/SYSTEM-ONTOLOGY.md` §4 · 自己的测试 | 中 | 否 |
| **D-13** | **`WO-TIMEGRAIN`**【整单·大】 | 班次级卡点（A9「夜班良率低于白班」）第一次可见 | 需班次剧本 + 降级标注 + 求解器适配层；且必改 R6 金值 | `apps/datacore/src/synthetic/battery.ts` · `tsgen.ts` · `timeseries.ts` · `packages/contracts/src/timeseries.ts` · migration · `docs/SYSTEM-ONTOLOGY.md` §8(`G-TIMEGRAIN-SPLIT`)+§5(R20 时间自洽) · 金值 | 重 | **是** |
| **D-14** | **`WO-SANDBOX-SCENARIO-CARDS`** | 场景启动器出现沙盘场景卡 | 只入册今天真跑得通的（A3/A6…），跑不通的不许装 | `apps/agentcore/src/scenarios-catalog.ts` · 自己的测试 | 中 | 否 |
| **D-15** | **`WO-PRD-SANDBOX-CORRECTIONS`**（文档单） | （不可见）修 PRD 三处已过期的口径 | 纯文档 | `docs/PRD-sandbox-redesign.md` 三处：§6.2 shift 最大窗口 40 天 → **60 天**（`timeseries.ts:396` 桶宽是 `DAY_MS/2`）· §7.1 R19 编号已被占用 → 改 R20 · §10.1「暗发默认关」→ battery 模板已开 | 轻 | 否 |

**并行建议**（按铁律 2 的画像分层）：
- **立刻同时开工**：D-1（重，独占 datacore vitest）＋ D-2 / D-10 / D-15（三条轻单，只写脚本与文档，不跑测试套件）＋ D-3 / D-4 / D-5（中，前端）。这一批做完，仓主界面上**会同时多出 4 个新视图 + 阻滞点面板 + OTD/库存新读数**。
- **第二波**：D-6 / D-8（重，串行排队）＋ D-12 / D-14（中）。
- **第三波（真工作量）**：D-9 → D-11 → D-13。
- **红线**：D-1 / D-6 / D-7 / D-8 / D-13 都要跑 datacore vitest，**同时只许一个**；gate 跑着时为 0。

---

## 4. 诚实边界（本文没查清的，逐条写明卡在哪 —— 不猜）

1. **没有真跑过。** 本对账全部是静态读码 + 注册表追踪，**没有起服务、没有点页面**。
   PRD §11 三周前写「没有真跑过沙盘页」，这条**至今没被补上**。
   §0 的结论（4 个视图打不开）是从 `ViewPage.tsx:33/38` 两道闸 + `BUILTIN_VIEWS` 名单推出来的，
   逻辑链完整，但**按本仓纪律它仍属"读到了调用点的条件"，不等于"亲手跑了一遍"**。
   立 D-1 单前，建议先起一次服务 `curl /a/v1/me/workspace` 看 `views[]` 与 `features[]` 的真实内容坐实。
2. **`decision_play` 的 `options` 从哪来没查。** §5.3 我判定「多方案机器是现成资产」，
   依据是 `catalog.ts:88` 的描述与 `service.ts:315` 的输出键，**没有逐行读它的实现**。
   若它的方案候选其实是写死模板（而非从杠杆派生），D-9 的工作量会比我估的大。
   **立 D-9 单前必须先核这一层**（这正是 PRD §11 自己承认过的同型风险：
   「④段无供应商交期是按 key 名称判的，未逐个读实现」）。
3. **跨段聚合是否"两处各自聚合"没追到底。** §7.4 第 2 条（聚合位置必须唯一）我只看到
   `BATTERY_TS_AGG_SPECS` 与求解器各自读对象快照两条路径并存，**没有证明它们口径已漂**。
   要证实需要跑一次 round-trip 对拍，属 D-13 的取证工作。
4. **未验证 `pnpm gates` 当前是否全绿。** 本次未运行任何门/测试（只读身份 + 避免与 gate 抢 datacore）。
   表中"门在且在 gates 里"仅指**登记事实**，不代表今天跑起来是绿的。
5. **未核 `docs/PRD-data-backfill.md` 的 D1–D6 执行状态。** PRD §A.3 把 5 个缺口指向那份文档，
   我只抽查了 `MaterialBalance.coverage`（确认仍无承载）与 shift 种子（确认仍无），
   `Customer.tier` / `MaintPlan.start` / `Base.capexWan` 未查。
6. **未核任务 #77（C08 外协红线口径打架）今天是否已解。**
   只看到 `scripts/check-outsource-redline.mjs` 存在且在 `pnpm gates` 里 —— **门存在 ≠ 口径已统一**。
   PRD §A.2 明写 B5 要等 #77 解了才能给对；D-9 立单时须先确认。
7. **`ChainImpediment.evidence.solverKey` 恒为自身**这一条（§9 A1）我判为"半成立"，
   但没有确认这是**设计选择**（判定器就是唯一算这个数的求解器）还是**遗漏**。
   契约注释（`chain-sim.ts:491`）写的是「算出该结论的求解器 key」，从这个定义看填自身是对的，
   与 PRD §5.1「主用求解器 = `bottleneck_matrix` 等」的设想不一致。**这是 PRD 与实现的口径分歧，需仓主裁决**。

---

## 5. 一句话总结

> **沙盘的"引擎半"做了七成（契约冻结 / 三类判定 / 损失归因 / scope 归一 / 三聚合，都在正线上），
> "界面半"做了四个新视图但一个都挂不上去，而 PRD 承诺的"多方案+对比""三业务筛选""班次粒度""五道门"
> 全部为零。**
> 仓主看不见变化的**直接原因只有一条**：`BUILTIN_VIEWS` 里没有那四个视图，
> 而导航里那个「推演沙盘」打开的是 2026-06 的旧屏。
> **先派 D-1（补视图册与导航），当天就能看见东西。**
