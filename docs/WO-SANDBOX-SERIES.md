# WO 系列 · 推演沙盘（端到端产销控制台）

> 配套 PRD：`docs/PRD-sandbox-redesign.md`（设计与验收） · 本文件只管**怎么拆、怎么派、怎么验收**。
> 欠账主单 #93。UI/UX 方案见控制台原型（三视图：线路图 / 物理拓扑 / 链路阶段）。

## 0. 派单纪律（每张 WO 都适用，不再逐条重复）

1. **一 WO 一 fresh dedicated dev**。每张单顶部的「🚦 范围边界」就是该 dev 本单的身份，**靠文件边界不靠人名**。越界即退单。
2. **跨数据/引擎两半的特性必须一个 dev 整单做**。拆两半用不同机制不对接，是本仓 metric-aware 反复炸的根。凡本文件标 `【整单】` 的，不许再拆。
3. **交付形态**：`claude/handoff-<wo-id>` 分支，commit + push，**不碰正线、不开 PR**。
4. **禁止跑** `bash scripts/gate.sh` / `pnpm -r test` / `pnpm --filter datacore test`（datacore 勿并发多 vitest）。只跑自己那一两个测试文件。整包 gate 由审核方串行跑。
5. **取退出码必须显式** `out=$(cmd 2>&1); rc=$?`。禁止 `cmd | tail; echo $?`（管道末端退出码恒 0，本仓因此把编译失败判成"通过"过）。
6. **SEAM-GATE**：每张单必须含一条**驱动接缝**的组合测试，在合并态断言端到端行为，而非只测各半 unit。
7. **变异反证**：把自己的修改回退 → 测试必须真红并打印断言原文；还原 → 绿。**无变异反证一律退单。**
8. **grep 的结果不是结论**（铁律 0.5）。下「没接线 / 是死代码」这类判断前必须再追一层调用，并按三分法定性：**没接线**（调用方只有 test）/ **接了线没数据**（有 src 调用方但输入恒空）/ **接了线接错地方**（挂在错误路径上）——修法完全不同。
9. **禁止静默兜底**。缺值就诚实缺席或标 `EMPTY`，绝不塞一个看着合理的默认值。
10. **三色系适配**：凡触及前端的单，必须在 `dark`（黑曜石·默认）/ `light`（冷蓝）/ `warm`（亮橙 `#E8590C`）三档下都可读。token 单源 `apps/frontend-shell/src/styles/tokens.css`，切换机制 `components/ThemeToggle.tsx` + `workspace/themeMode.ts`。**禁止在组件里写死颜色**。
11. **金值/注册即更**：新增 solver / 对象类型 / 门 → 同步 golden 计数与注册表，漏金值即退。

---

## 1. 这批单要解决的真实缺口（**已按实测更正 · 见 §1.1 的更正记录**）

| 缺口 | 实测证据 | 三分法定性 |
|---|---|---|
| **业务线维度只挂了 1 个点** | `args.baseId` 4 处 + `args.baseIds` 1 处；`args.modelId` 6 处；**`args.businessType` 单数 0 处，但复数 `args.businessTypes` 有一条真消费链**：`solvers/service.ts:2693` → `PortfolioInput.businessTypes` → `portfolio.ts:860 btFilter`（真的在收窄 orders/bases/DemandSegment） | **接了线接错地方**（57 个求解器里只挂了 portfolio 一个）→ **扩挂载点，不是造机制**。字段名与值域照 `portfolio.ts:860` 的既有先例，勿造第二套 |
| **「节拍」概念全仓不存在** | 无任何契约承载「多久处理一次」 | **没接线**（新契约·S0 已冻结 `Cadence`） |
| **硬容量读不进瓶颈判定** | `Process.channels` **存在且有真数据**（常州 1932 柜位 × 89 套/柜位·日，`battery.ts:3582`），且有 src 真消费方 `capacity.ts:75/:84`、`vle-oracle.ts:93/:96`，还是已登记杠杆②（`capacity-factors.ts:51`）。**但** `liveTightness`（`risk.ts:139`）只有 oee/utilization/yield 三分支，瓶颈判定读不到它；`capacity_rollup` 虽在 `min(serialMin, formationCap, agingCap)`（`capacity.ts:133`）用了，**却不记录谁夹定、差多少** | **接了线接错地方**（补挂载点） |
| **C02 是条永不可评估的死规则** | 表达式 `Process.parallelThroughput < Process.requiredThroughput`（`battery.ts:267`），**两个操作数都不是 Process 属性**，全仓只命中规则串本身与前端 mock 的 `NOT_APPLICABLE` | **接了线没数据**（缺承载物） |
| **采购段：数据在，消费方缺两项；耗时缺两段** | **已有**：`PurchaseOrder`（`poId/matId/qty/etaDay/delayed` + 落库 `synthetic/service.ts:767` + 链路 `material_supplied_by_po`）· `Supplier.leadTime` 真种子（容百 5/当升 7/长远 8/贝特瑞 4 天）· `minOrderQty` 真种子（1000/800/600/1200）· `onTimeRate` 真种子 · 在途（`在途` 14 文件 / `inTransit` 4 / `transitDay` 6）· 断供（`断供` 10 文件 / `disruption` 6）。**真缺**：`minOrderQty` 与 `onTimeRate` 在 `solvers/` **0 消费方**；**清关（`customs` 0 命中）与到货检验（`IQC` 0 命中）两段完全无承载** | **接了线没消费方 ＋ 缺两段**（不是"造一套凭证对象"） |
| **三个聚合缺口** | OTD 只有逐单风险无批次准时率；`inventory_optimize` 只有快照无地点×时间序列；现金流只有 `capex.ts` 项目级按季 + `credit_exposure` 敞口快照，**两者不同源不可相加** | **接了线没数据**（聚合层，不是新引擎） |
| **基线天然不夹定（沙盘没有戏剧性的根因）** | `channels = ceil(lineTargetCells / (channelOutputDaily×0.97))`（`battery.ts:3582`）——**柜位数是从目标反解出来的**，故基线上硬容量几乎恰好等于要求量（常州 formation 余量仅 +1.7%），**永远"刚好够"** | 设计性质问题：要有真瓶颈须把柜位改成独立种子量，**会动 R6 金值 → 单独立单** |

### 1.1 更正记录（**本节比结论本身更重要**）

本文件初稿有**三处「今天没有 X」的断言经实测不成立**，均为「凭 grep 命中写结论、未沿调用链再追一层」——正是 CLAUDE.md 铁律 0.5 记的那个病：

| 初稿写的 | 实测 | 谁查出 |
|---|---|---|
| 工序链含「模组」、起点「涂布」 | `WORKSHOP_DEFS` 真值起点是**制浆**、**无「模组」**（`模组` 只出现在 `battery.ts:151 BOTTLENECKS` 那套瓶颈标签，是另一口径） | F3 dev |
| 「采购段无凭证对象 / 无供应商交期 / 无 MOQ」 | 三者**皆有且有真种子**（见上表） | 审核方自查 |
| 「化成柜位在本体里没有承载物」 | `Process.channels` **有、有数据、有真消费方、且已是登记杠杆** | D3 dev |

**给后续 dev 的硬要求**：本文件任何一条「今天没有 X / X 是死代码 / 这里没接线」，**都必须自己再追一层调用后才可作为施工前提**。若你的取证与本文件冲突，**以你的取证为准**，并在交付说明里写明冲突点——三位 dev 已各自这样做过，正确。

**可复用资产（别重造）**：`propagateTick`（纯函数·R6 确定性）· `order_fullchain` 已产出 `dag`/`conds`(带规则码)/`judges`/`kpis` · 57 个 `SOLVER_KEYS` · `SEG_REGISTRY`/`BASE_REGISTRY` 单源 · 前端 `LayeredDag`/`ProvenanceDag`/`KsfGraph` · `SOLVER_RULE_REFS` + `EvaluatedRule` · 规则 `params` 引用机制（已并线 `aba33841`）· S0 冻结的 `chain-sim.ts` 五契约。

## 2. 波次与依赖

```
W0 契约冻结（串行·唯一前置）
   └── S0
W1 数据/对象层（4 单并行）        W2 引擎层（4 单并行·依赖 S0）
   D1 节拍 · D2 采购凭证链           E1 环节损失 · E2 业务线 scope
   D3 工序容量 · D4 三聚合           E3 阻滞点判定 · E4 节拍进推演
                    ↓
W3 前端层（4 单并行·依赖 S0 契约，可与 W1/W2 并行开工，接真数据在 W4）
   F1 线路图 · F2 在途实时层 · F3 物理拓扑 · F4 节点检视
                    ↓
W4 收口（串行）
   G1 SEAM 总门 + 金值 + 点亮 entitlement
```

**关键排期判断**：W3 前端不必等 W1/W2 完成——**先按 S0 冻结的契约做，用 mock 数据**；但 W4 收口时必须换成真数据并由 SEAM 总门咬死。这是本仓「数据半 × 引擎半」教训的正面应用：**契约先冻结，两半各自做，收口有门**。

---

## W0 · S0 契约冻结【整单·唯一串行前置】

**🚦 范围边界**：`packages/contracts/src/`（新增 `chain-sim.ts`）· `docs/SYSTEM-ONTOLOGY.md` §2/§3/§5 回写。**不碰**任何 `apps/*/src`。

**任务**：冻结全系列共用的契约，一次定死口径，避免后面 12 张单各写各的。

1. **`ChainNode` / `ChainStep`**：节点与其内部环节。`ChainStep` 必带 `kind: "queue"|"cadence"|"work"|"rework"|"handoff"`（五段），`days: number`，`valueAdd: boolean`。
2. **`Cadence` 一等公民**：`{ everyDays: number, offsetDays?: number, kind: "meeting"|"batch"|"settlement"|"shipping" }`。**等待期望 = everyDays/2**，此公式写进契约注释并由 E4 的测试锁死。
3. **`ChainImpediment`**：卡点/堵点/断点三类，判据见 PRD §5.1。派生对象（求解器算出，不落人工录入），不进 R4 审批面。
4. **`LossAttribution`**：`{ stepId, nonValueDays, pctOfChainLoss }`。**口径定死**：`pctOfChainLoss = 该环节非增值天数 ÷ 全链非增值总量`，分母**排除增值段**。全链所有非增值环节之和必须 = 100%（由 E1 的守恒测锁死）。
5. **`ChainScope`**：`{ businessTypes?: string[], baseIds?: string[], modelIds?: string[] }` —— 这是闭「业务线带不下去」的契约口子。

**SEAM 判据**：本单无运行时行为，但必须提供一份 `contracts` 包内的 schema 往返测试（strict parse，写错枚举值抛、多写字段抛）。

**本体回写**：§2 新增 5 个对象类型；§3 新增诊断链；§5 新增「R-CADENCE 等待期望 = 节拍/2」不变量候选。

---

## W1 · 数据 / 对象层（4 单并行）

### D1 · 节拍承载【整单】
**🚦 范围边界**：`apps/datacore/src/synthetic/`（节拍种子）· `apps/datacore/src/repo/`（若需落库）· 对应 migration · 自己的测试。**不碰** solvers。

**任务**：让「节拍」在数据层真实存在。为 §1 表中列出的每个限流环节种下 `Cadence`：S&OP 共识会 30d / 开票对账 15d / 订单评审 5d / 主计划 7d / 过程质检 2d …（值从现有种子推导，不许拍脑袋，取不到就诚实标 `EMPTY`）。

**SEAM 判据**：种子产出的 `Cadence` 必须能被 `propagateTick` 读到（哪怕本单还不消费它）——断言"数据半产出的形状 == 引擎半期待的形状"。
**变异反证**：删掉某个节点的 Cadence → 消费方拿到 `EMPTY` 而非默认值（证明没有静默兜底）。
**⚠ 迁移号**：canonical 当前最新 `027`，且 `028` 已被三条未并分支占用（`repo/pg.ts:560-568` 按**完整文件名**记账 + 三份均幂等，故不阻断）。本单请用 **`029` 起**，并在交付说明里写清用了哪个号。

### D2 · 采购段凭证链【整单】
**🚦 范围边界**：`apps/datacore/src/synthetic/`（供应商/物料侧）· `packages/contracts/src/`（新增采购对象）· migration · 自己的测试。

**任务（已按实测重定范围）**：采购段**不是从零建模**。`PurchaseOrder`/`Supplier.leadTime`/`minOrderQty`/`onTimeRate`/在途 均已有真种子。本单实际做三件：① **接线**——`minOrderQty` 与 `onTimeRate` 今天在 `solvers/` **0 消费方**，让齐套/交期判定真读它们；② **补两段**——清关（`customs` 全仓 0）与到货检验（`IQC` 全仓 0）无任何承载，这两段才是真新增；③ 让耗时**按责任方可分解**。**耗时必须按责任方拆开**（供应商生产 / 在途 / 清关 / 检验），否则只知道晚了、不知道找谁——这是本单的核心判据。

**SEAM 判据**：造一张缺料订单 → 齐套判定能给出**按责任方分解**的最早齐套日，而不是一个合成数字。
**变异反证**：把四段耗时合成一个数 → 测试红（断言必须能分解）。

### D3 · 工序容量对象
**🚦 范围边界**：`apps/datacore/src/synthetic/battery.ts` 工序段 · contracts 中 `Process` 相关 · 自己的测试。

**任务（已按实测重定范围·D3 已交付 `10b1cf57`）**：`Process.channels` 已存在且有真数据与真消费方，**本单不是建对象**，是补挂载点——让 `liveTightness`(`risk.ts:139`) 能看见硬容量，并让 `capacity_rollup` 的 `min(...)` **记录谁夹定、差多少**。另需补 `requiredThroughput`（比较基准，今天全仓不存在，导致规则 C02 恒不可评估）。

**SEAM 判据**：`bottleneck_matrix` 能把柜位数量当约束读到并影响判定（数据半 × 引擎半）。

### D4 · 三个聚合缺口【整单】
**🚦 范围边界**：`apps/datacore/src/solvers/`（仅聚合层）· `packages/contracts/src/` 输出形状 · 自己的测试。**不碰**底层求解器算法。

**任务**（三项都是**聚合层不是新引擎**）：
1. **OTD 批次准时率**：`risk_timeline` 今天给逐单风险，缺「这批单准时率 %」。**必须同时定死 OTD 判定口径**（按承诺交期 / 客户要求交期 / 首次承诺），三选一并写进契约——口径不统一时两个部门报的准时率能差 20 个点。
2. **库存地点 × 时间序列**：`inventory_optimize` 今天只有快照（over/under/idle/releasableCash）。
3. **全链经营现金流**：今天 `capex.ts cashflow[]` 是**项目级按季投资现金流**，`credit_exposure` 是**信用敞口快照**，**两者不同源不可相加**。本单要么产出真正的全链经营现金流，要么**诚实标 EMPTY 并在契约里写清为什么不能相加**——后者也是合格交付，硬凑一个数就是退单项。

**变异反证**：三项各自被回退 → 对应断言真红。

---

## W2 · 引擎层（4 单并行 · 依赖 S0）

### E1 · 环节级损失归因【整单】
**🚦 范围边界**：`apps/datacore/src/solvers/`（新增 chain-loss 求解器）· 自己的测试。

**任务**：按 S0 冻结的 `LossAttribution` 口径，算出每个环节吃掉全链损失的比例。**必须与 R13 溯源对齐**：每个数字可溯源到哪个求解器/哪条派生边（本仓刚修过 `drillField` 标签与真值差 1e4 的错标，别再犯）。

**SEAM 判据（守恒测）**：全链所有**非增值**环节的 `pctOfChainLoss` 之和 == 100%（±0.1）。增值段不计入分母。
**变异反证**：把增值段错误计入分母 → 守恒测真红。

### E2 · 业务线 scope 入口
**🚦 范围边界**：`apps/datacore/src/solvers/`（args 解析与 scope 归一）· 自己的测试。**不碰**前端。

**任务**：闭「业务线带不下去」。让求解器接受 `ChainScope.businessTypes`，与既有 `baseId`/`modelId` 同级。注意**已有 scope 归一单源**（`normalizeBaseRef` 一族），照它的模式做，别新造第二套。

**SEAM 判据**：选「储能」推演 → 结果只含储能订单，**不泄漏其他细分**（本仓有过"储能达成率下钻混入整车厂"的真实事故，见 §8 `G-SEG-ATTR-CROSS-SEGMENT`）。
**变异反证**：去掉 scope 过滤 → 跨细分泄漏被测试抓住。

### E3 · 阻滞点判定器【整单】
**🚦 范围边界**：`apps/datacore/src/solvers/`（阻滞点判定）· 自己的测试。

**任务**：把卡点/堵点/断点做成**机器可判定**（PRD §5.1 已给判据），产出 `ChainImpediment[]`。**阈值一律引用规则 params，不许写死**——`params` 引用机制已由 WO-RULE-EXPR-PARAMS 打通，直接用。

**SEAM 判据**：改规则 params 的阈值 → 阻滞点判定结果真的跟着变（改阈值即改推演）。
**变异反证**：把阈值写死回字面量 → 测试红。

### E4 · 节拍进推演【整单】
**🚦 范围边界**：`apps/datacore/src/sim/propagation.ts` 及其调用点 · 自己的测试。**保持 `propagateTick` 纯函数与 R6 确定性**。

**任务**：让 `propagateTick` 消费 D1 种下的 `Cadence`：到节拍点才放行，等待期望 = `everyDays/2`。这是整个沙盘**最值钱的一条**——实测全链损失 Top3 全是等节拍、合计 30.7%。

**SEAM 判据**：把 S&OP 节拍从 30d 改到 7d → 全链前置期真的缩短，且缩短量与 `Δ(everyDays)/2` 一致（不是随便变小就算通过）。
**变异反证**：把节拍当固定时长处理（而非到点放行）→ 测试红，因为批量释放现象消失。
**R6 守护**：同 (seed, 场景, 参数版本) 重跑字节一致。

---

## W3 · 前端层（4 单并行 · 依赖 S0 契约，可先用 mock）

> 四单共同要求：**三色系全过**（`dark`/`light`/`warm`）· 禁止写死颜色 · 复用既有 `LayeredDag`/`ProvenanceDag` 等组件不重造 · 每单自带 `apps/frontend-shell/test/` 下的测试 · **注意定时器句柄必须覆盖前先清**（本仓刚修过 4 处「ref 只存得下最后一个 handle → 孤儿定时器 → 整包随机红」）。

### F1 · 线路图视图
**🚦 范围边界**：`apps/frontend-shell/src/views/sim/`（新增线路图组件 + 其 module.css）· 自己的测试。

**任务**：站=环节、**换乘站=共用工序（即共享瓶颈）**、**合流站=齐套 AND**（注意：地铁并线是 OR，齐套是 AND，这是隐喻唯一撑不住的地方，必须用不同图元）、停运区间=断点、红弧=返工逆行。站圈大小 ∝ 该站 `pctOfChainLoss`。

**SEAM 判据**：引擎返回的 `LossAttribution` 变化 → 站圈大小与百分比真的跟着变（不是渲染写死）。

### F2 · 在途实时层
**🚦 范围边界**：同 F1 目录下的在途层组件 · 自己的测试。

**任务**：区间上跑在途/在制批次（`WipLot` / `Shipment.etaDay` / `InterBaseTransfer` —— **这三个对象都已存在**）；到限流站排队堆积、到节拍点批量放行；仿真时钟 + 播控倍速 + 事件流。**必须尊重 `prefers-reduced-motion`**。

**诚实判据（本单核心）**：采购支线**必须显示为空且明说原因**（"本体缺 ASN / 在途批次对象"），在 D2 交付前**不许**画假车。这条是"绿测试≠能用"的正面应用：**看不见的东西不许画出来**。

### F3 · 物理拓扑视图
**🚦 范围边界**：同目录下的拓扑组件 · 自己的测试。

**任务**：13 基地 × 产线 × 10 工序（真实值：常州/厦门/成都/眉山/武汉/江门/合肥/信阳/枣庄/邯郸/自贡/金华/扬州；制浆→涂布→辊压→分切→卷绕→装配→注液→化成→分容→PACK（取自 `battery.ts` `WORKSHOP_DEFS` 真值·**无「模组」**））。悬停出工序详情。基地/工序清单**必须从 `BASE_REGISTRY` 与工序单源派生，禁内联**（`boundary-singlesource:check` 守）。

**SEAM 判据**：改 `BASE_REGISTRY` → 视图跟着变（证明是派生不是手抄）。

### F4 · 节点检视 + 变量输入
**🚦 范围边界**：同目录下的检视面板 · 自己的测试。

**任务**：五段耗时瀑布 + 流动效率读数 + 七类变量分组输入（**T 时长 / K 节拍 / B 批量 / C 能力 / P 概率 / R 规则 / S 结构**）。
**关键设计约束**：这七类**推演机理不同，UI 必须分开**——T–C 是连续滑杆；**R 类必须引规则码**（改的是 rule param）；**S 类是离散分支换拓扑，不能做成滑杆**。把 S 类做成滑杆即退单。
每个变量必须标注今天有无契约承载（有 / 薄 / 缺），**缺的不许给一个假默认值**。

---

## W4 · G1 收口【串行·审核方自己做或指定单人】

1. **SEAM 总门**：一条组合测试，从「改一个节点的节拍变量」一路断言到「底部四个财务指标变化」，跨数据半 × 引擎半 × 前端半。任一半漏即红。
2. **金值/注册即更**：新增求解器 → 同步 demo-chain / catalog / ontology-core 金值计数。
3. **点亮 `sim.sandbox`**：按 PRD §10.1 的点亮判据（是「什么条件」不是「什么时候」）。
4. **本体回写**：§2/§3/§4/§5/§7/§8 全部对应章节，含新增门登记（否则 `ontology-writeback:check` 红）。
5. **诚实边界落档**：哪些格子仍是占位值、哪些指标仍标 `EMPTY`，逐条写进 PRD §11，**不许在收口时偷偷用默认值填上**。

---

## 3. 验收总判据（审核方逐条核，缺一不算过）

| # | 判据 | 怎么证 |
|---|---|---|
| A1 | 五包 gate 全绿 | `bash scripts/gate.sh` RC=0，5/5 包点名 |
| A2 | 每单有 SEAM 且**接缝驱动通** | 不是各半 unit 绿就算 |
| A3 | 每单有**变异反证真红原文** | 无原文 = 无证据 |
| A4 | 损失守恒 | 非增值环节 `pctOfChainLoss` 之和 == 100% |
| A5 | 节拍语义正确 | 改 `everyDays` → 前置期缩短量 == `Δ/2` |
| A6 | 业务线不泄漏 | 选储能不混入其他细分 |
| A7 | 三色系全过 | dark/light/warm 逐档可读，无写死颜色 |
| A8 | **诚实缺席** | 缺数据处标 `EMPTY`，全仓搜不到为本系列新增的静默默认值 |
| A9 | R6 确定性 | 同 (seed, 场景, 参数版本) 重跑字节一致 |
| A10 | 本体已回写 | `ontology-writeback:check` 绿 + §8 断点状态更新 |

---

## 4. 诚实边界（本文件自身的）

- 本系列**不重造** `propagateTick`、不引入图数据库、不做实时流（按需触发 + 缓存）。
- W1 之前，控制台原型里物理拓扑那 130 格的利用率/OEE/节拍、以及线路图上的批次，都是 **seed 42 确定性占位值**（可复现，非实测）。真值须走 `capacity_rollup` + `bottleneck_matrix` + `EquipmentOEE`——**这三个对象都已存在**，属「接了线但没接进这张图」，不是没接线。
- 全链 244.8 天 / 增值 48.9 天（20.0%）这组数字来自原型的建模口径，**不是从生产数据实测的**。W1 完成后必须用真数据重算，重算结果与此不符时**以真数据为准并更新 PRD**，不许反过来把数据往这个结论上凑。
