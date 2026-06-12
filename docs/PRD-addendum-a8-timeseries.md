# PRD 增量 · A8 时序数据层（Raw 时序 → 结论数据）+ 全模块关联与模拟数据更新

| 项 | 值 |
|---|---|
| 版本 | v1.0（增量：在 DataCore 新增模块 **A8**；修订 A1/A3/A4/A5/A6/A7、求解器增量 PRD §S1/S3、QOS-PRD §7.1、前端 PRD §6.5/§7） |
| 解决问题 | ① 原始时序（MES 实绩/OEE 等，单源可达数十万行）严禁进入本体对象存储与 LLM 上下文；② 显式规格化"原始时序 → 本体快照属性（结论数据）"的加工链；③ 合成数据模块支持**一键模拟数据更新**（推进模拟时钟），让全链路（聚合→派生→规则→看板）活起来 |

## 0. 数据分层总图（规范性）

```
原始层  ts_points (TimescaleDB hypertable)      ← A1 时序通道 / A7 合成 tick    【LLM 永不可达】
        raw_datasets (实体类行数据)              ← A1 实体通道
加工层  A8 聚合作业（声明式规约，增量窗口计算）     ← S3 调度器触发
结论层  本体对象快照属性（设备.oee_current 等）    ← A8 写回，带窗口级溯源
派生层  A4 派生管线（产能金字塔/财务/差异）        ← 快照属性变更触发
消费层  求解器(S1) / 规则引擎(A5) / 看板 / LLM 工具（仅聚合查询）
```

**红线**（代码评审级）：`objects` 表禁止出现逐条时序记录型对象；任何返回给 LLM 的工具禁止返回 `ts_points` 原始行。

---

## 1. A8.1 · 时序接入通道（修订 A1）

1. `SourceSchema.datasets[]` 新增 `kind: "ENTITY" | "TIMESERIES"`（schema discovery 自动建议：存在时间列 + 实体键列 + 数值测量列 → 建议 TIMESERIES，人工可改）。
2. TIMESERIES 数据集**不落 raw_datasets、不参与 A3 materialize**，经独立写入器进：

```
ts_series(id PK, tenant_id, conn_id, series_key,            -- 如 "oee:equip"
          entity_type, entity_ref_field, measure_fields JSONB, time_field, unit, created_at)
ts_points(series_id FK, entity_id, ts TIMESTAMPTZ, values JSONB)
          -- hypertable，按 ts 分区；索引 (series_id, entity_id, ts DESC)
```

3. 写入语义：幂等 upsert（series+entity+ts 唯一）；乱序容忍窗口 7 天，更晚的迟到数据落 `ts_late_arrivals` 并告警。
4. 保留与降采样**接口预留**：`RetentionPolicy { rawDays, downsampleAfterDays, downsampleGrain }`（本期只建表与配置位，不实现压缩）。
5. 文件上传同样支持：上传时序 CSV → 向导中标记 kind=TIMESERIES + 指定时间列/实体键列。

## 2. A8.2 · 聚合规约与作业（核心，"raw → 结论"的显式模块）

```ts
interface TsAggSpec {                       // 表 ts_agg_specs，场景包内容，版本化
  id: string; tenantId: string; key: string; version: number;
  seriesKey: string;
  groupBy: "entity";                        // 本期固定按实体
  window: { grain: "shift"|"day"|"week"; rolling?: number };   // 如 day + rolling 7
  agg: "avg"|"sum"|"min"|"max"|"p95"|"weighted_avg";
  weightField?: string;                     // weighted_avg 必填
  output: { objectType: string; property: string };            // 写回绑定：设备.oee_current
  status: "ACTIVE"|"PAUSED";
}
```

- **执行**：S3 调度器新增 kind `TS_AGGREGATE`（默认每小时）；**增量计算**——只重算自 `last_run_at` 以来有新点/迟到点的 (entity, 窗口)；结果写回对象快照属性，同时落 `ts_agg_runs(spec_id, window_start, window_end, rows_in, value, run_at)` 作为溯源载体。
- **级联**：快照属性写回 → 触发 A4 派生管线对依赖该属性的派生对象做增量重算（A4 修订：派生公式依赖图把"快照属性"作为合法叶子节点）。
- **首批内置规约**（battery 场景包）：设备日 OEE（7 日滚动加权均值）→ `设备.oee_current`；工序日良率 → `工序.yield_baseline`；班次实绩汇总 → `产线.actual_output_daily`；**计划达成率** = 排产 vs 实绩逐日回比（周滚动，原型口径 91.4%）→ `产线.schedule_attainment`。

## 3. A8.3 · 溯源扩展（修订 QOS-PRD §4.4 与前端 PRD §6.5）

`ProvenanceRef.source` 枚举新增 `"TS_AGGREGATE"`，附 `{ aggRunId, specKey@version, window:{start,end}, rowsIn }`。前端溯源弹窗新形态文案：「来自 2026-06-01~06-07 共 84,213 条实绩 · 加权均值 · 规约 oee_daily v2」——窗口可点开查看该实体的聚合趋势小图（调 §4 聚合查询，仍不出原始行）。

## 4. A8.4 · 模型/工作流可用的聚合查询工具（修订 QOS-PRD §7.1）

新增内置工具 `query_timeseries_agg`（sideEffect=READ，进路径 B 白名单与 workflow 步骤类型）：

```
入参 { seriesKey, entityIds[]≤20, window:{from,to,grain}, agg }
出参 { points: [{entityId, bucket, value}] }   // bucket 数 ≤ 120，超出 → 400 要求加大 grain
```

权限：entity 维度继承其对象类型的行级策略（A6 在 SQL 注入 entity 过滤）；**无任何参数组合能返回原始行**。

## 5. A8.5 · 时序型规则（修订 A5 规则 DSL）

C05"利用率>95% **持续 3 日**"、C12"MAPE>8% 触发重校"这类规则本质是时序判定。规则 DSL 新增一个函数：

```
SUSTAIN(comparison, days)     -- 过去 days 个聚合桶内 comparison 连续为真
例：SUSTAIN(产线.utilization > 95, 3) → 升级瓶颈告警（C05）
```

实现：规则引擎对 SUSTAIN 子句改查 `ts_agg_runs`/聚合查询而非快照单值；持续监测扫描（S3 的 RULE_SCAN）即可消费。校准触发（C12）同机制：`SUSTAIN(|预测−实际|/实际 > 0.08, 1)` 按周期扫描，命中发 `calibration.required` 事件。

## 6. A8.6 · 合成数据联动：时序生成与一键模拟更新（修订 A7，核心需求）

### 6.1 行业模板新增时序生成规约

```ts
// IndustryTemplate 新增
tsGenerators: {
  seriesKey: string; entityType: string; grain: "shift"|"day";
  base: { mean: number; noise: number };          // 基线 + 高斯噪声
  drift?: number;                                  // 趋势项/天
  effects?: ("weekend_dip"|"maint_window_dip"|"ramp_curve")[];  // 与本体事件联动的形变
}[];
scenarioScript?: { tick: number; event: string; params: object }[];   // 剧本（见 6.3）
```

初次合成任务（§7.2 流程）追加阶段 ③b：按 tsGenerators + seed 生成**过去 90 天**的历史时序（确定性 PRNG；maint_window_dip 在该基地检修周自动下凹，与本体检修计划对象同源——保证"事件↔时序"互相印证），随后跑全量 TS_AGGREGATE → 派生 → 校验报告新增时序段（点数/缺口/聚合抽样复算）。

### 6.2 模拟时钟与一键数据更新

```
表 simulation_clocks(tenant_id PK, t0, current_tick, seed, status)
POST /a/v1/synthetic/clock/tick     Body: { advance: "1d" | "7d" }   → 202 { tickJobId }
POST /a/v1/synthetic/clock/reset    回到 t0（清 tick 产生的数据，保留初始 90 天）
GET  /a/v1/synthetic/clock          当前模拟日期/已推进 tick 数/剧本进度
```

**tick 作业流水（顺序执行，单事务边界按阶段）**：
1. 生成推进窗口内的新时序点（确定性：seed+tickIndex，同 tick 重放结果一致）；
2. 生成源头事务对象增量：新实绩、在途批次到货/延迟、订单状态推进（仅源头对象——**派生数据一律不生成**，一致性原则不破）；
3. 执行剧本事件（若 scenarioScript 命中当前 tick）：如 `tick 3: iot_delay`（→ 数据健康度降级，演示 C09/P90 降档）、`tick 5: shipment_delay`（→ 到货间隙脉冲，风险卡越线日提前）、`tick 8: yield_drop`（→ 良率下滑，触发 C05/告警）；
4. 触发 TS_AGGREGATE（增量）→ A4 派生重算 → RULE_SCAN；
5. 产出 tick 报告：本次新增点数、变化的快照属性 Top10、新触发/解除的告警、（若已有预测对象）**预测 vs 新实际的偏差增量**——这是校准引擎（M11/C12）的演示粮食：连续 tick 几次后偏差累积、触发重校事件，"系统越用越准"的故事线可现场演示。

### 6.3 前端（修订前端 PRD §7.7 合成数据向导）

向导第三步（报告页）下方常驻**模拟时钟控制台**：当前模拟日期、`推进 1 天` / `推进 1 周` / `重置` 按钮、剧本时间线（已触发事件打勾）、tick 报告流（每次推进追加一卡：变化摘要 + 新告警跳转链接）。推进完成后全局事件 `synthetic.tick_completed` 经 SSE/轮询通知各打开页面刷新（驾驶舱数字变化、风险卡变化即演示效果）。

## 7. 与其他模块关联矩阵（汇总）

| 模块 | 关联 |
|---|---|
| A1 连接器 | dataset kind 声明；时序独立写入器；上传 CSV 支持时序标记 |
| A3 建模 | 字段画像识别时序特征 → 建议 kind=TIMESERIES + 实体绑定；时序数据集不进 materialize |
| A4 派生 | 快照属性为派生依赖图合法叶子；属性变更触发增量重算 |
| A5 规则 | SUSTAIN 时序函数；C05/C12 改为真实时序判定 |
| A6 权限 | ts 查询按实体继承对象行级策略 |
| A7 合成 | 历史时序生成 + 模拟时钟 tick + 剧本事件（§6） |
| S1 求解器 | OEE 基线/良率/计划达成率等输入改从快照属性取（不再手填/Mock）；校准引擎的"实际"序列来自 ts_agg_runs |
| S3 调度器 | 新增 kind TS_AGGREGATE |
| QOS/AgentCore | 新工具 query_timeseries_agg；LLM 上下文与原始行物理隔离 |
| 前端 | 溯源新形态 + 聚合趋势小图；模拟时钟控制台；tick 后看板刷新 |

## 8. 验收用例增量

| # | 用例 | 预期 |
|---|---|---|
| T1 | 同步含 10 万行 OEE 时序的 mock 数据集 | 全部进 ts_points；objects 表零新增；raw_datasets 零新增 |
| T2 | TS_AGGREGATE 增量性 | 首跑全量；补 3 个迟到点后重跑仅重算受影响 (entity,窗口)；设备.oee_current 更新且 provenance 含 aggRunId/窗口/rowsIn |
| T3 | 级联 | 快照属性变更 → 依赖它的派生对象重算 → 驾驶舱对应数字变化（同源断言） |
| T4 | SUSTAIN 规则 | 构造连续 3 日 >95 → C05 告警触发；中断 1 日 → 不触发 |
| T5 | query_timeseries_agg | 聚合查询正确；请求原始粒度超 120 桶 → 400；base_manager 仅得常州实体；任何参数无法取得原始行（含注入式参数测试） |
| T6 | 初次合成含时序 | 90 天历史生成，检修周 OEE 自动下凹与本体检修对象同周；同 seed 字节一致 |
| T7 | 模拟时钟 tick | 推进 1 天：新点生成→聚合→派生→规则全链执行；tick 报告字段齐全；同 tick 重放结果一致；reset 后回到初始态 |
| T8 | 剧本事件 | tick 5 触发 shipment_delay → 风险看板对应基地越线日变化；tick 3 IoT 延迟 → P90 系数 0.93→0.90 在推演输出中体现 |
| T9 | 偏差演示线 | 先跑一次 capacity_forecast，连续 tick 7 天后偏差报告生成、C12 SUSTAIN 命中 → calibration.required 事件 |
| T10 | LLM 隔离红线 | 路径 B 全用例审计：进入 LLM 上下文的工具结果中不存在 ts_points 原始行（结构断言） |
