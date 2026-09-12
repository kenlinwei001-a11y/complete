# WO-CEO-DATA-supply · CEO 驾驶舱真数据供给（灌真颗粒·颗粒不聚合）

> **Lane**：Dev-4 · **handoff 分支**：`claude/handoff-ceo-data`（独立·不并入 b1nmxn·不开 PR·复验方逐值复验）
> **文件域**：`packages/contracts/src/record-materialize.ts`（新契约·非 databuilder.ts）· `apps/datacore/src/decision/record-materialize.ts`（新纯函数）· `apps/datacore/src/app.ts`（新端点·additive）· `apps/datacore/src/features.ts`（新暗发 key）· `apps/datacore/test/record-materialize.test.ts`
> **状态**：BUILT·待复验方真跑复验

## 1 · 问题（源↔现状↔设计）

CEO 经营驾驶舱（`DashboardView` / `DASH_LAYOUT`）的 KPI 全部由求解器（`cockpit_kpi` / `finance_pnl` / `mrp_netting`）从
一组**驾驶舱对象**（`FinancePlan` / `MaterialBalance` / `DemandSegment` / `Metric` / `SopVersionRow`）派生。这些对象**当前只由
合成种子产出**（`synthetic/battery.ts generateBattery` → `putAll`），`BINDINGS`（`battery.ts:1072`）**无任一驾驶舱类型条目**
→ 真上传的财务/MES/矿价 CSV **无路进入驾驶舱对象**。既有 `derive/decision-fields` 是**聚合**引擎（`avg/sum/ratio…`）且只能
在**已存在**对象上打标量、**不能建行对象**——它是决策字段派生的**后半段**，缺的是**前半段**：把真源原始行**按颗粒**落成真对象。

## 2 · 设计（前半段：真源记录颗粒级物化）

新端点 `POST /a/v1/records/materialize`（admin·暗发 `data-import.record-materialize` defaultOn:false）：

1. 取已入库真 `RawDataset`（经真连接器/上传门 `POST /a/v1/uploads` 产生）。
2. **KILL-MOCK-RED 门**：源连接为合成源（`config.synthetic===true`）→ **硬拒 400**（合成不得冒充真物化对象）。
3. 目标类型须已发布 `ACTIVE`；按**导入方提供的列→属性映射**（R14 零业务常数）逐行装配。
4. **逐行 1:1 物化**（`materializeRecords` 纯函数）：一条真源行 → 一个 `ObjectInstance`，`origin={type:MATERIALIZED,
   datasetId,jobId}`（真源·非合成），`props` 由列映射 + 按目标 `dataType` 确定性强转（number 列 parse）。
   `replaceExisting` → 先清本类型同租户既有对象（含合成种子）再落真行 → 真值换合成。
5. **⛔ 颗粒不聚合**（命门）：只落原始颗粒，**入库零聚合**；聚合留给下游确定性派生层（`derive/decision-fields` / 求解器）→
   驾驶舱任一数字可逐值下钻回一条真 RawDataset 行（R13 · R-NO-ORPHAN-SOURCE：删源→对象成孤儿）。

物化后求解器读**真值**（如 `finance_pnl` 读真 `FinancePlan.budget`），驾驶舱数字随真数据实变；provenance 维为真
（`buildSynthProvenancePredicate` 判 datasetId ∉ 合成源集 → 非合成）。

## 3 · 本体引用与影响

- **对象类型**（本体 §2）：读侧新增消费——`RawDataset`（源）+ `Connection`（provenance 判定）→ 物化 `ObjectInstance`
  （`origin.type=MATERIALIZED`·真 `datasetId`），目标为驾驶舱绿地类型 `FinancePlan/MaterialBalance/DemandSegment/Metric/SopVersionRow`。
- **链路**（§3·§4 数据流）：补齐 `真连接器/上传 → RawDataset(原始颗粒) → **[本 WO 新接缝] 逐行物化 → 真 ObjectInstance** →
  (下游既有) derive/decision-fields 聚合 / 求解器 → DASH widget`。此前该接缝对驾驶舱类型缺失（`BINDINGS` 无条目）。
- **不变量**：**R14**（列映射 config-driven·平台零财务/电池常数）· **R6**（同 rows+mapping 字节级同 objects）·
  **R13/R-NO-ORPHAN-SOURCE**（origin 挂真 datasetId·可下钻·删源成孤儿）· **R2 tenant 隔离** · **R3 暗发**（关=404）·
  **KILL-MOCK-RED / 铁律 0.4**（合成源硬拒·真源判定与 `buildSynthProvenancePredicate` 同源）。
- **断点**：缓解 `G-13`（源数据不透明残口——真源颗粒现可物化成一等对象、可溯）；接续 `G-DATAMODE-PROV`（provenance 两正交维·
  本 WO 落真 provenance 侧的真物化输入）。
- **事件/门禁**：未改事件名；未新增门禁；未改求解器内部（仅喂真对象）。

## 4 · 真证据（复验方逐值复验）

`apps/datacore/test/record-materialize.test.ts`（9 用例·**本 WO 全绿·R6 双跑一致**）：

- 纯函数：① 2 行→2 对象（**无聚合**）·`budget "50000"→50000`·origin MATERIALIZED 真 datasetId；② R6 双跑字节一致；
  ③ 非数值→null+告警·`"1,200"→1200`；④ 空主键跳过；⑤ 主键列缺省自动取。
- HTTP 真链路：⑤ `POST /a/v1/uploads`(真财务 CSV) → `POST /a/v1/records/materialize`(FinancePlan·replace) →
  `materializedCount=3 / worldSource=imported / provenanceReal=true` → 对象 `budget=50000`·origin 真 datasetId →
  `finance_pnl` 逐值 `收入.budget=50000` + **聚合值 `gmRow.budgetPct=40`（毛利÷收入=20000/50000·求解器算出·非入库预聚合）**；
  **⑧ 铁律「改颗粒→聚合必变」**：只改一条真源毛利颗粒（20000→10000）→ `finance_pnl` 毛利率 **40→20**（聚合确随颗粒变）；
  ⑥ 合成源数据集 → **400 硬拒**（KILL-MOCK-RED）；⑦ dryRun 不落库 + 非 admin 403。

**复现**：`pnpm --filter datacore test -- record-materialize`（datacore vitest.config testTimeout=180000；根级 `npx vitest`
默认 5s 会误超时，务必用 datacore 配置跑）。

## 5 · 残口诚实交底

- **provenance 前端标注**：本 WO 落"真物化"数据侧；驾驶舱 widget 尚未**逐格视觉标**"真实/合成"（`cockpit_kpi/finance_pnl/
  mrp_netting` 未透 dataMode·`DashboardView` 现只显工具 provenance）——留下一增量（gap-d·可复用 `buildSynthProvenancePredicate`）。
- **矿价/MES 专用连接器**：现走通用 `file_upload`（真·可用）；`external_feed` 仍供 `MOCK_EXTERNAL_DATA`（矿价 mock），
  接真行情源为独立后续。
- **回滚**：feature key `data-import.record-materialize` 关（defaultOn:false·非 battery 租户默认即关）→ 端点 404·存量零影响。
- **跟 dev2（本体扩展·WO-CEO-1a）对齐**：本端点物化只打**已发布 ACTIVE 类型**（`ontology.listTypes` 过滤·通用零硬编码类型名）——
  dev2 升级的一等 `Metric`（顶层 year 目标 + 三细分责任 Metric·GOAL_REGISTRY）等新/改类型**自动可作 targetType**，本 lane 代码不动。
- **基线红诚实交底**：team 分支 `b1nmxn` 现带 pre-existing 红（`solvers`/`m11-calibration`/`planviews`/`replay-ops`/`sop-actions`——
  经 `git stash` 跑清源基线确认：**我改动 stash 后这些仍红**，系 dev2 WO-CEO-1a 等在飞 WIP 改了 cockpit 值未同步依赖测试，**非本 WO 回归**）。
  本 WO 纯 additive（新契约/纯函数/新端点/1 feature key/1 import），自身 9 测全绿·四包 build 绿；不替 dev2 lane 修测试（其 file-domain）。
