# 分析 · 「数据」导航重组 + 推演的销售预测维度 + 沙盘归并 + 隔离区价值

> 用户四问：① 导航「数据接入」→「数据」并纳入全部源数据模块（订单台账/数据构建发动机/外部信号→外部数据…）；② 推演是否需「销售预测」数据，否则如何做完整时序推演而非只靠订单一维；③「推演沙盘」是否并入「推演」；④「隔离区」有价值吗、为何前端空、是否假关联。
> 审核方沿本体走查（§2.A/§2.B/§10.2 D1 接入域）+ 真读源后给分析。**②④ 是真发现，非纸面推断。**

## §0 现状真盘点（ShellLayout `NAV_GROUPS`·配置驱动 R14）

| 组 | 成员 | 与「源数据」关系 |
|---|---|---|
| 规划与平衡 | annual-scenario / quarterly-rolling / **sop-balance** / plan-audit / plan-generate / review | sop/annual **持有销售预测维度**（见 §2） |
| **推演** | project-sim / **risk(预判看板)** / order-chain | 时序推演**只吃订单+mock**（见 §2） |
| 台账与地图 | **order(订单台账)** / geo-map | order=源数据视图 |
| **数据接入** | connections / rule-docs / synthetic / **external-signals(外部信号)** / **quarantine(隔离区)** | 当前的"数据"组 |
| 建模与图谱 | graph / modeling / object-types / source-overview / domains / slices / merge | 本体层（非原始源数据） |
| 构建与成长 | **data-builder(数据构建发动机)** / growth / evals / solvers / solver-review | data-builder=源数据建域引擎 |

> 即：用户点名的「订单台账」在**台账与地图**、「数据构建发动机」在**构建与成长**、「外部信号」在**数据接入**——三处分散。

## §1 ① 导航「数据接入」→「数据」重组（IA·低风险）

**建议**：组名 `数据接入`→`数据`，收编全部"源/原始数据"模块；语义按"数据生命周期早段"归一。

```
数据（原"数据接入"）
├ connections      连接器与上传        （源接入）
├ external-signals 外部数据（原"外部信号"·zh.ts 改 label） （外部源）
├ rule-docs        规则文档（源文档→规则候选）
├ synthetic        合成数据            （确定性造数源）
├ data-builder     数据构建发动机       ← 从「构建与成长」移入（故事→建域的源数据管线）
├ order            订单台账            ← 从「台账与地图」移入（核心业务源数据视图）
└ quarantine       隔离区              （源数据异常区·见 §4）
```

- **改哪些**（dev·小）：`ShellLayout.tsx NAV_GROUPS`（移 order/data-builder 进"数据"组、组名改）；`zh.ts` external-signals label「外部信号」→「外部数据」+ 组名。配置驱动、无契约改。门 `f61.admin-nav-groups.test.tsx` 同步。
- **诚实权衡（留给你定）**：① `data-builder` 也是"建域/成长"语义，移入"数据"后「构建与成长」只剩 growth/evals/solvers——可接受（成长偏治理）。② `order(订单台账)` 是**业务台账视图**，归"数据"强调其"源数据"面、弱化"经营台账"面；若想保经营语义可两处皆挂（nav 项可复用 key）。③ `geo-map(基地地理视图)` 是否随 order 进"数据"？建议留"台账与地图"（它是地理可视非源数据）。
- **本体**：D1 接入域（§10.2）的对象类型正好是这组（Connector/RawDataset/ExternalSignal/SyntheticJob/BuildPlan/QuarantineRow）——**导航与系统自我域 D1 对齐**，IA 有本体依据。

## §2 ② 推演需要「销售预测」——这是真缺口（📖读源坐实）

**结论**：**需要，且当前没接**。时序推演（预判看板 risk_timeline）现在**只吃订单+mock 哈希**，完全没消费已存在的销售预测数据。

- **现状（risk.ts）**：`tensionSeries`(`:177`) 的曲线种子 `cur = baseline ?? mockTightness(...)`(`:189`)——**紧张度来自 charCode 哈希**（`mockTightness:28`，= 洛阳死路 A★ 同根）；只用 `c.orders`(`:135`) 的交期做受影响订单，**不读任何需求预测**。
- **capacity_forecast(capacity.ts)**：算的是**产能** P50/P90（从订单批次 dueDate，`:218-259`）+ 一个 what-if `demandDelta`(`:176`)——**也不读销售预测 DemandSegment**。
- **而销售预测数据系统里早有**（只是推演没接）：`DemandSegment`（forecast 域·p50/p90/revenueWan）· `SopVersion`（S&OP demand/supply）· `AnnualScenario`（年度情景需求）· `ForecastSnapshot`。**规划与平衡组**（sop-balance/annual-scenario）已在用它们。
- **为什么这是"只靠订单一维"的病根**：订单=**已承诺的近期需求**；销售预测=**前向的中长期需求**。只用订单做时序推演 → 只能看到"已下单"的紧张，看不到"预测会来但还没下单"的产能/物料缺口演化。**完整时序推演 = (订单[近期实需] + 销售预测 DemandSegment/SopVersion[前向需求]) vs 产能/物料 over time**。

**建议（与 hollow-data A★/WO-DM 合流）**：把 risk_timeline 的紧张度从 `mockTightness` 哈希**改由 真需求-产能缺口 派生**——需求侧喂 `DemandSegment`(前向 p50/p90) + `SopVersion.demand` + 订单近期实需，供给侧用 capacity_forecast 产能曲线，紧张度 = 缺口/产能 over horizon。**这同时根治 A★（红色源自哈希）与本问（只靠订单一维）**：销售预测正是 A★ 要补的"真数据源"。
- **FDE 判据**：预判看板紧张度曲线随 DemandSegment/SopVersion 真值变化（改预测→曲线变）；点红→真受影响订单 + 缺口由"预测需求 − 产能"算出，可溯源、非哈希。

## §3 ③ 「推演沙盘」并入「推演」（IA·建议合并）

- **现状**：`推演`组 = project-sim/risk/order-chain（3 业务视图）；`推演沙盘`(sim-sandbox)+沙盘初始化(sim-init) 是 ShellLayout **单列特殊 nav 项**（暗发 `sim.sandbox` 门控、`SimSandboxGuard`），**游离在推演组外**。
- **建议**：**并入「推演」组**（推演沙盘/沙盘初始化 作为该组成员，受同一 entitlement 门控显隐）。理由：沙盘与 project-sim/risk **同属"推演/仿真"语义族**；沙盘传导拓扑本质是"本体图+传导叠加"（见 `ANALYSIS-graph-modules-consolidation.md` 类型A），与预判看板/项目沙盘是一家。合并后「推演」= {项目沙盘 / 预判看板 / 订单全链 / 交互沙盘 / 沙盘初始化}，信息架构更内聚。
- **边界**：沙盘暗发可回退（关 `sim.sandbox`→入口消失），并入后保留该门控即可，不破 R3。

## §4 ④ 「隔离区」有价值——且是真关联，非假关联（📖读源坐实）

**结论**：**有价值，真接线**。空是因为**演示数据是确定性合成、天然无脏行**，不是模块没关联。

- **真关联（铁证）**：`modeling.ts:537-557`——materialize（RawDataset→ObjectInstance）时，坏行**真路由进隔离区**：主键缺失→`SCHEMA_MISMATCH`(`:540`)、主键重复→`DUP_KEY`(`:545`)、校验失败→规则 reason(`:557`)，调 `quarantine.record(...)`；服务 `app.ts:290 new QuarantineService` 真实例化；隔离区可 reprocess(`:95`)/discard(`:106`)。**这是数据质量正门，链路真通。**
- **为何前端空**：demo 走**确定性合成数据**（R6·按构造无缺主键/无重复/无越规）→ materialize **产 0 隔离行**。只有**真实/脏数据上传**（带坏行的 CSV）才会落隔离区。**= 空因无脏数据流经，非假关联。**
- **价值判定**：保留（真实接入场景必需的数据质量闸）。但**演示态它永远空、看不出价值**——两个选项：① **造一次真值演示**：上传一份含重复/缺主键行的 CSV → 实拍坏行落隔离区→reprocess 修好（证活体）；② 或 seed 2-3 条 demo 隔离行（诚实标"示例"）让用户看到形态。**不建议删**（删了真实脏数据无处可去）。
- **IA**：归"数据"组合理（源数据异常区），但建议加一句空态文案「无异常行（合成数据洁净；真实上传的坏行将在此）」——把"空"从"像坏了"变成"诚实的好消息"。

## §5 本体引用与影响

- **对象类型**：D1 接入域 Connector/RawDataset/**ExternalSignal**/SyntheticJob/BuildPlan/**QuarantineRow**（§10.2）· forecast 域 **DemandSegment**/ForecastSnapshot · **SopVersion**/AnnualScenario（plan 域）· risk_timeline/capacity_forecast（D4 推演）。
- **链路**：`sys.ingest.data_to_object`（§10.3·含 quarantine 异常分流）· 数据→本体→推演链（**断点：销售预测未喂入 risk_timeline**）· 规划与平衡↔推演（预测数据在前者、推演在后者，二者未接 = 接缝缺口）。
- **不变量**：R6（合成洁净·隔离区空是确定性结果非 bug）· R13（推演紧张度应派生自真需求-产能·非哈希）· R14（nav 配置驱动）。
- **断点**：**A★/G(hollow-data)**（risk 紧张度哈希·§2 的销售预测正是其待补真源）· G-5（nav/视图配置驱动）。
- **回写**：若 risk_timeline 接销售预测 → 回写 §3 数据→推演链（新增 DemandSegment→risk_timeline 边）+ §8（A★ 真源接入进度）。

## §6 给你的决策清单

| 问 | 审核方结论 | 动作 |
|---|---|---|
| ① 数据接入→数据 | 合理·低风险 IA | dev 改 NAV_GROUPS+zh.ts（移 order/data-builder 入"数据"·external 改名） |
| ② 推演需销售预测 | **真缺口**·已存数据未接 | 与 A★/WO-DM 合流：risk_timeline 紧张度改由 DemandSegment/SopVersion 真需求-产能派生 |
| ③ 沙盘并入推演 | 建议合并·更内聚 | dev 把 sim-sandbox/sim-init 并进"推演"组（保留 entitlement 门控） |
| ④ 隔离区 | **有价值·真关联**·空因合成洁净 | 不删；造真值演示或 seed 示例行 + 补空态诚实文案 |

> **边界**：①③④ 是 IA/小改（可直接转 WO）；**② 是中等数据建模改**（推演接预测维度），建议与 hollow-data A★ 一起做（同一真源）。要哪几项转成可派发施工单，说一声。

---
*审核方架构分析（design+review·真读源）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
