# WO-PIPE-INCR ① 真增量同步（CDC delta-merge）· FDE 证据

> 工单：#18 WO-PIPE-INCR ① —— 连接器真增量同步（按 pkField upsert delta·watermark 推进·`?since=` 端点），非全量重灌。
> 根因解（铁律0）：不是"标个 incremental:true 应付门"，而是让 `rest_api` 成为**真能用的 CDC 源**——
> 适配器把 `since` 下推为查询参数、服务层按主键 upsert 合并、水位真推进，并以**真 HTTP fetch** 走通一遍。

## 完成定义（用户视角）

运维在「数据连接器」配一个 REST API 数据源（声明业务主键 `pkField` + 水位列 `watermarkField`）：
1. 首次同步：全量灌入，落库 N 行，回执给出本数据集 `watermark`（= 水位列最大值）。
2. 之后定时/手动带上 `?since=<上次 watermark>` 再同步：上游**只回**变更/新增行，平台**按主键合并进既有数据**
   （未变的行原样保留、变更的行被覆盖、新增行追加），回执的 `rowCounts` 报的是 **delta 行数**、`watermark` 推进。
3. 不满足增量条件（连接器无 incremental 能力 / 没传 since / 没配 pk+水位）→ 回落全量重灌（向后兼容，旧连接器零影响）。

## 改动（根因·非省事）

| 层 | 文件 | 改动 |
|---|---|---|
| 连接器注册表 | `apps/datacore/src/connectors/registry.ts` | `rest_api.capabilities.incremental: false→true`（REST `?since=updated_at` 是合法 CDC 语义）；`RestApiAdapter.fetchBatch(dataset,_cursor,since)` override：`since` 下推为查询参数（`?since=`/`&since=`），缺省全量 |
| 适配器接口 | 同上 `SourceAdapter.fetchBatch` | 增 `since?: string`（CDC 源据此只回更新行；不支持的源忽略·服务层兜底再筛） |
| 同步服务 | `apps/datacore/src/connectors/service.ts` | `sync(ctx,connId,{since})`；`connIncremental = 连接器 incremental 能力 ∧ 传了 since`；ENTITY 分支 delta 合并：取水位后更新行 → 按 `pkField` upsert 进既有行 Map → `watermark=max(watermarkField)`；`rowCounts` 增量报 delta、全量报总行 |
| 领域模型 | `apps/datacore/src/domain.ts` | `RawDataset.watermark?: string` |
| 数据集配置 | `service.ts DatasetConfig` | 增 `pkField?` / `watermarkField?` |
| 端点 | `apps/datacore/src/app.ts` | `POST /a/v1/connections/:id/sync?since=` → `sync(c,id,{since})`；回执带各数据集新 `watermarks` |

## 验收证据 1 · vitest E2E（走真 Fastify 路由 + 真读落库行，非仅断言返回值）

`apps/datacore/test/connectors.test.ts` → `WO-PIPE-INCR: rest_api 增量同步 — 二次 sync?since= 仅灌 delta、按 pk 合并、watermark 推进`：

```
✓ A1 connectors > WO-PIPE-INCR: rest_api 增量同步 — 二次 sync?since= 仅灌 delta、按 pk 合并、watermark 推进
 Test Files  1 passed (1)   Tests  10 passed (10)
```
全量 datacore 套件：`Test Files 146 passed | 2 skipped` · `Tests 787 passed | 11 skipped`（无回归；skipped 为需活 PG/sidecar 的集成测试）。

## 验收证据 2 · FDE 真跑（真 HTTP fetch · 非 stub fetchImpl）

起真上游 HTTP 源（`127.0.0.1:4099`，`?since=` 只回更新行）+ 真 datacore（内存模式 SEED_DEMO=1），全程 curl：

```
=== 2) full sync (no since) → 3 rows, watermark 2026-01-03 ===
{"syncJobId":"sync_f18vte7h3xh8gemr","status":"SUCCEEDED","rowCounts":{"orders":3},"watermarks":{"orders":"2026-01-03"}}

=== 4) incremental sync (?since=2026-01-03) → delta=2, watermark 2026-01-06 ===
{"syncJobId":"sync_42416xvn8e1x1d1d","status":"SUCCEEDED","rowCounts":{"orders":2},"watermarks":{"orders":"2026-01-06"}}

=== 5) read landed rows → 4 rows (upsert, NOT full reload) ===
rowCount=4
  A 甲    2026-01-01   ← 未变保留
  B 乙-改 2026-01-05   ← 同 pk 覆盖为新值
  C 丙    2026-01-03   ← 未变保留
  D 丁    2026-01-06   ← 新增追加
```

判据全中：首次全量 3 行；`?since=` 后 `rowCounts=2`（**只灌 delta**，不是又灌 4）；落库 4 行且 A/C 原样、B 被新值覆盖、D 新增；watermark `2026-01-03 → 2026-01-06` 推进。

## 门禁

`pnpm gates` 全绿（含新登记 §7 的 `repo-pg-notnull/css-vars/scene-agent-config/no-silent-mock` 4 门 + `ontology-writeback:check` 由红转绿——该门正确抓出此前 4 门漏登 §7，已补登）。

## 本体回写

- §2 RawDataset：增 `watermark` + 真增量同步语义（四条件齐备走 delta·缺则全量回落）。
- §7：补登 4 个此前漏登的 gates（`ontology-writeback:check` 抓出）。

## 距北极星还差什么（诚实）

- ✅ 本次真做到：`rest_api` CDC 增量同步端到端可用（真 HTTP·真 upsert·真水位），二次 `?since=` 只灌 delta。
- 📏 还差（WO-PIPE-INCR ②，已分阶段）：**调度器自动增量** —— 当前 `?since=` 需调用方显式传；`SchedulerService` 的 `CONNECTOR_SYNC` 定时作业尚未"记住上次 watermark 并自动续传 since"，也未在 sync 完成后发 `dataset.synced` 事件触发下游重算（recompute）。这是下一增量，本次按 FDE 纪律先把 ① 做扎实再上 ②。
- ⚠️ TIMESERIES 数据集走 ts writer 分支（既有按时间幂等），增量 delta 仅作用于 ENTITY 数据集——符合设计（时序本就按 timeField 去重），非缺口。
- 🔭 真实接入仍需运维在连接器配 `pkField/watermarkField` 并提供支持 `?since=` 的上游；未配则安全回落全量。
