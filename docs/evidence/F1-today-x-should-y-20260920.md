# F1 开工前的事实陈述（今天 X / 应该 Y）

> 依据派单书前提纪律：file:line 是线索不是结论，以下为开工前亲读原文后的事实陈述。

## 今天的行为是 X

1. **配对引擎的 actual 侧只有一个来源**：`apps/datacore/src/calibration/pairing.ts:36 runPairing`
   的 actual = A8 `ts_agg_runs`（`line_output_daily`，系统**自己跑出来**的时序聚合）。
   摄取面落的行与预测记录之间**零语义连接**。
2. **`RealizedOutcome` 概念全仓不存在**：`grep -rn "RealizedOutcome" apps/ packages/ --include="*.ts"`
   RC=1 零命中（金丝雀：同法查 `interface DatasetConfig` RC=0 必中于 `connectors/service.ts:17`，查法有效）。
3. **摄取 sync 落行后无人认领**：`connectors/service.ts:283 sync()` 把行落 `RawDataset`/`rawRows`
   （`:334-345`），发完 outbox 事件即结束；`job.id`（syncJobId）在内存里但没被任何 outcome 登记消费。
4. **DatasetConfig 无 outcome 映射**：`connectors/service.ts:17-24` 只有
   `kind/seriesKey/entityType/entityRefField/timeField/measureFields`。
5. **预测记录已在落库**：`solvers/service.ts:6764 recordCalibrationForecasts`（调用点 `:6417`）
   对 capacity_forecast 每日窗口落 `CalibrationForecastRecord`（domain.ts:1486），
   配对键语义 = (solverKey, modelId, baseId?, windowFrom/To)。

## 应该是 Y（PRD §2.1 F1）

1. 契约新增 `RealizedOutcome`（落 `apps/datacore/src/domain.ts`，与 CalibrationForecastRecord 同处
   ——本仓「契约」层 record 类型的既有位置）：
   `{ id, tenantId, subjectRef{typeKey,objectId,prop}, asOf, value, unit,
      source: INGESTED|WORK_ORDER_CLOSURE|MANUAL_ENTRY,
      provenance{ connId?, syncJobId?, datasetKey?, rowRef?, importedBy, importedAt } }`
2. `DatasetConfig` 增 `realizedOutcome` 映射：`{ typeKey, objectIdField, prop, asOfField, valueField, unitField?, unit? }`。
3. sync 落行后：有映射的数据集 ⇒ 每行登记 RealizedOutcome（source:INGESTED，
   provenance 带 connId/syncJobId/datasetKey/rowRef/importedBy/importedAt）。
4. 硬拒（⛔ 不许静默丢弃）：
   - source=INGESTED 但 provenance 缺 syncJobId/connId ⇒ **400 点名缺哪个字段**；
   - 连接 `connectorTypeKey` 是 `mock_*` ⇒ 拒绝登记并点名；
   - syncJobId 追不到真实 sync 记录 ⇒ 拒绝。
5. 与 `recordCalibrationForecasts` 配对：forecast 派生 subjectRef =
   `{typeKey:"Model", objectId: baseId? "<modelId>@<baseId>" : modelId, prop:"dailyOutputWan"}`，
   asOf = windowTo（日窗口 from==to）；RealizedOutcome 按 subjectRef+asOf 配对 ⇒
   落 CalibrationPairRecord + forecast.pairedAt。
