# 施工单批次2 · 推演接预测 / 数据导航 / 沙盘归并 / 隔离区 / 图谱融合

> 把审核方此前几轮分析（已问"是否转施工单"的全部项）落成 dev 可照做的 WO（改哪些文件:行 + 具体改动 + FDE 真值判据 + 边界）。架构母单：`ANALYSIS-graph-modules-consolidation.md` · `ANALYSIS-data-nav-forecast-quarantine.md`。
> **通用红线**：`pnpm -r build`(全4包) + `pnpm -r test` 全绿 + 按 FDE 判据真跑自验贴证（绿测试≠能用）；只推 `claude/vigilant-knuth-b1nmxn`；密钥仅 env（R5）；改链路/事件/对象/不变量/门禁回写 `docs/SYSTEM-ONTOLOGY.md`；命名禁外部产品名；模型标识不入提交物。

---

## ▌ WO-FORECAST-SIM（P1·中·合并 A★）— 推演接销售预测真源

- **目标**：时序推演（预判看板 risk_timeline）紧张度从 `mockTightness` 哈希改由**真需求(销售预测)−产能**派生；点红落真订单/诚实面板（A★ 洛阳死路）。一举根治"红色是哈希"与"只靠订单一维"。
- **改哪些**：
  1. **求解器 `apps/datacore/src/solvers/risk.ts`**：`mockTightness`(`:28`) 哈希 / `tensionSeries`(`:189` baseline 种子) 改用**真需求-产能缺口**——需求侧 `DemandSegment`(forecast 域 p50/p90) + `SopVersion.demand` + 订单近期实需；供给侧复用 capacity_forecast 产能曲线；紧张度 = 缺口/产能 over horizon（确定性 R6·零写死）。
  2. **SolverContext 注入**：`loadContext` 把 `DemandSegment`/`SopVersion` 喂进求解器上下文（现有对象库可查·`/a/v1/objects?type=DemandSegment`、`/a/v1/sop/versions`）。
  3. **契约**：`RiskTimelineOutputSchema` 已有 `dataMode`——接真源置 `LIVE`，无真预测回落 `PARTIAL`（与 WO-DM 同诚实位）。
  4. **前端 A★**：`apps/frontend-shell/src/views/RiskBoardView.tsx` `AffectedOrdersModal`(`:462-491`)——点红 D+N → 真受影响订单非空 **OR** 诚实「此为 mock 基线·无真订单关联」面板；**禁裸 `zh.common.none`(`:491`)**。
- **FDE 判据**：① 改 `DemandSegment`/`SopVersion` 真值 → 预判看板紧张度曲线随之变（非哈希·可溯源）；② 洛阳 D+13 红 → 点开 → 真订单或诚实文案、**绝不裸"暂无数据"**；③ 缺口 = "预测需求 − 产能" over time，逐日可溯。
- **边界**：销售预测数据现成（DataCore·`/a/v1/sop/*`、`/a/v1/plan/{aop,quarterly}`、`objects?type=DemandSegment`，已在"规划与平衡"组可见）——本单是**接线**不是补数据。与 WO-DM(dataMode 契约) 协同。
- **本体回写**：§3 数据→推演链新增 `DemandSegment/SopVersion → risk_timeline` 边；§8 A★ 真源接入进度。

---

## ▌ WO-NAV-DATA（P2·小）— 数据导航「数据接入」→「数据」

- **改哪些**：`apps/frontend-shell/src/pages/ShellLayout.tsx` `NAV_GROUPS`——组名 `数据接入`→`数据`(`:38`)；移入 `order`(从"台账与地图"`:37`)、`data-builder`(从"构建与成长"`:53`)；`apps/frontend-shell/src/locales/zh.ts` 把 external-signals label「外部信号」→「外部数据」。`test/f61.admin-nav-groups.test.tsx` 同步断言。
- **FDE 判据**：真浏览器左导「数据」组含 连接器与上传 / 外部数据 / 规则文档 / 合成数据 / 数据构建发动机 / 订单台账 / 隔离区；空组自动隐藏正常。
- **边界（留 dev 注意）**：`order` 是业务台账视图——可在"数据"与"台账与地图"两处复用同 key 保经营语义（见 `ANALYSIS-data-nav-forecast-quarantine.md §1` 权衡）；`geo-map` 留"台账与地图"（地理可视非源数据）。配置驱动·无契约改。

---

## ▌ WO-NAV-SANDBOX（P2·小）— 推演沙盘并入「推演」组

- **改哪些**：`ShellLayout.tsx`——把游离的特殊 nav 项 `sim-sandbox`/`sim-init`（当前单列·`nav-sim-sandbox`）并入「推演」组（`NAV_GROUPS` 推演组 `:36`），**保留 `sim.sandbox` entitlement 门控显隐**（`SimSandboxGuard` 不动）。
- **FDE 判据**：真浏览器「推演」组 = 项目沙盘 / 预判看板 / 订单全链 / 交互沙盘 / 沙盘初始化；关 `sim.sandbox` → 沙盘项消失（R3 不破）。

---

## ▌ WO-QUARANTINE（P3·小）— 隔离区空态诚实 + 真值演示

- **背景（审核方坐实）**：隔离区**真接线**（`modeling.ts:537-557` materialize 坏行真路由 SCHEMA_MISMATCH/DUP_KEY/校验）；空因 demo 合成数据洁净（R6 无脏行）。**非假关联，勿删。**
- **改哪些**：① `apps/frontend-shell/src/pages/admin/QuarantinePage.tsx`（或对应隔离区页）空态文案改「无异常行（合成数据洁净；真实上传的坏行将在此排队修复）」——把"空"从"像坏了"变"诚实的好消息"；② 可选**真值演示**：脚本/手测传一份含重复+缺主键行的 CSV → 经 connectors.upload → materialize → 坏行落隔离区 → reprocess 修好（实拍证活体）；**或** seed 2-3 条 demo 隔离行（诚实标"示例"）让用户看到形态。
- **FDE 判据**：空态文案诚实；若做真值演示——坏行真落隔离区（`GET /a/v1/quarantine` 非空）+ reprocess 后进对象库。

---

## ▌ 图谱融合（分步·**别一次性大重构**·见 `ANALYSIS-graph-modules-consolidation.md`）

> 母单结论：把"本体图(类型A)"融合为一个图引擎+主入口、"过程DAG(类型B)"语义分散但共用渲染。**先抽两个共享引擎做低风险验证，再渐进迁入口。**

### WO-GRAPH-1（P2·先做·低风险）— 抽统一「过程 DAG」渲染组件
- **改哪些**：把 `components/InferenceProcessDag.tsx` / `ProvenanceDag.tsx` / `DataBuilderPage FdeGraph` / `components/Dag/LayeredDag.tsx` 的 SVG 渲染抽成**一个共享组件**（统一 par/conv/seq/aux/fb 边样式 + 节点 IPO 抽屉 `DagNodeDrawer` + 缺口红标 + 缩放）；四处入口/数据/语义**不动**，只换渲染层。
- **FDE 判据**：四处 DAG 用同一组件渲染、视觉/交互一致（截图对比前后）；各自入口/数据不变；`InferenceProcessDag` 的对比度修（WO-CSS）随迁不回潮。

### WO-GRAPH-2（P2·抽图引擎）— 统一「本体图谱引擎」
- **改哪些**：把 `views/OntologyGraphView.tsx` 的 `forceLayout` 抽成可复用图引擎（节点/边/力导布局/`DagNodeDrawer`/域配色[14 域 R14 配置驱动]/缩放/框选）；数据**实时派生**自本体发布(`fetchOntologyGraph`)。
- **FDE 判据**：`OntologyGraphView` 用新引擎渲染、实时取已发布本体不变；引擎可被 WO-GRAPH-3 复用。

### WO-GRAPH-3/4（P3·后续·依赖 GRAPH-2）— 融合主入口 + 沙盘/元本体/边界/图查询接同引擎
- **改哪些**：`SlicesPage` / Object360 血缘 / `KsfGraph` 接入图引擎（模式切换：结构/切片/血缘/域）；建模工作台(`ModelingPage`)改为图的"编辑态"；沙盘传导(`PmDag`)=引擎+传导/state 叠加；元本体(`MetaPage`)/边界(`BoundaryPage`)=同引擎换数据源；图查询(U12·PlatformConsole)=图上"查询模式"（后端建好后）。
- **FDE 判据**：本体图谱主入口模式切换覆盖结构/切片/血缘；各入口渲染一致、数据各自真实。
- **边界**：中等重构·依赖 GRAPH-2 先落；按 START-HERE §3 不盲建——先 GRAPH-1/2 验证可行再做。

---

## 建议施工顺序（含批次1依赖）

1. **WO-NAV-DATA / WO-NAV-SANDBOX / WO-QUARANTINE**（IA 小改·速胜·并行）。
2. **WO-FORECAST-SIM**（合并 A★·与批次1 的 WO-DM dataMode 协同）。
3. **WO-GRAPH-1**（过程 DAG 共享组件·低风险）→ **WO-GRAPH-2**（图引擎）→ **WO-GRAPH-3/4**（融合主入口·依赖前者）。

> dev 实装贴证后，审核方按各单 FDE 判据**独立真跑复验核发**（真浏览器/真 PG 实拍）。

---
*审核方设计落地施工单批次2（design+review·非 dev 实装）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
