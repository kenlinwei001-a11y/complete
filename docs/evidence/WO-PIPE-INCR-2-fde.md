# WO-PIPE-INCR ② 调度器自动增量 + sync→事件→派生重算（闭 DL9）· FDE 证据

> 工单：#18 WO-PIPE-INCR ② —— ① 把"手动 `?since=` 增量"做扎实后，② 收两件事：
> (a) **调度器自动续传**：定时 `CONNECTOR_SYNC` 无须调用方传 since，每数据集用自身已存 watermark 续传（增量·非每次全量重灌）；
> (b) **闭 DL9 断链**：`sync` 完成发 `connection.sync_completed` 事件 + 真实变更触发派生重算，使同步进来的新数据自动流入对象/派生。

## 根因（铁律0）：DL9 是真断链，不是新功能

读源发现：`connection.sync_completed` 在本体 §4（L8·DL9）**声明**、被 agentcore `event-subscriptions.ts:57` **订阅**（失效 dashboard/scenario-data/object-queries），但 `connectors/service.ts` **从无 outbox、从不产出此事件** —— 声明+订阅却永不触发。后果：连接器同步完数据，下游页不刷新、派生不重算（同步数据成"孤岛"）。② 正是补这条断链。

## 改动

| 层 | 文件 | 改动 |
|---|---|---|
| 同步服务 | `connectors/service.ts` | `sync(ctx,connId,{since?,auto?})`；**auto 模式**：每数据集 `dsSince = opts.since ?? (auto ? existing.watermark : undefined)`（逐数据集用自身水位续传）；新增 `onSyncCompleted` 钩子（解耦·不 import Outbox/Ontology·R1）+ `SyncCompletedInfo{connId,datasets,rowCounts,watermarks,incremental,changedRows}`；同步成功后调钩子（失败计 metric·非致命非静默） |
| 装配 | `app.ts` | `connectors.wire({onSyncCompleted})`：发 `connection.sync_completed` 事件（闭 DL9）+ `changedRows>0` 触发 `ontology.runDerivations`（try/catch·warn·非致命）；`CONNECTOR_SYNC` 调度 handler 改 `sync(...,{auto:true})` |

设计取舍：钩子用 wire 注入而非让 ConnectorService 直接依赖 Outbox/Ontology（守 R1 分层）；recompute 仅 `changedRows>0` 才跑（增量零 delta 同步不空转重算）。

## 验收证据 1 · vitest（直测 ConnectorService·auto 续传 + 钩子 payload）

`apps/datacore/test/connectors-incremental.test.ts`：
```
✓ WO-PIPE-INCR ② 调度自动增量 + sync 完成钩子 (2 tests)
  ✓ auto 模式无须传 since：每数据集用自身 watermark 续传；钩子带 changedRows/incremental（changedRows=0 时下游可跳过重算）
  ✓ 无 incremental 能力的连接器（mock_erp）即便 auto 也走全量 replace（向后兼容）
```
判据：① 首次 auto（无水位）→ 全量 2 行·incremental=false·watermark 落 2026-01-02；② 二次 auto **不传 since** → 用存的水位续传 → delta=2·incremental=true·watermark→2026-01-06·落库合并 3 行（A 留 B 覆盖 C 增）；③ 三次 auto 无新行 → delta=0·**changedRows=0**（app 据此跳过重算）；mock_erp（无 incremental 能力）auto 仍全量。
连接器全套：`connectors + connectors-incremental` 12/12 绿。

## 验收证据 2 · FDE 真跑（真 HTTP·真 outbox）

真上游 `:4099` + 真 datacore，curl：
```
outbox events before: 29
=== sync (full) === {"status":"SUCCEEDED","rowCounts":{"orders":3},"watermarks":{"orders":"2026-01-03"}}
=== outbox by type after sync ===
{"ontology.published":1,"rules.updated":28,"connection.created":1,"connection.sync_completed":1}
```
- **`connection.sync_completed` 真出现在 outbox**（此前永不产出 → DL9 闭合）；事件总数 29→31（+connection.created +connection.sync_completed）。
- 派生重算 clean：服务日志 sync 请求 `incoming → completed`（~30ms·含 runDerivations），**无 `派生重算失败` warn**（recompute 跑通未抛），进程 healthz=200。

## 门禁

`pnpm gates` 全绿（见下）。

## 本体回写

- §4：`connection.sync_completed` DL9 由"声明+订阅却不产出"→ **真产出**（ConnectorService onSyncCompleted 钩子 → outbox.emit），并标注 `changedRows>0` 触发派生重算。
- §2 RawDataset：补 ② auto 自动续传语义（每数据集用自身 watermark）。

## 距北极星还差什么（诚实）

- ✅ 本次真做到：DL9 闭合（同步事件真产出·下游可失效）+ 同步数据自动触发派生重算 + 调度自动增量续传（不再每次全量）。
- 📏 ② 边界：调度自动增量仍承 ① 的 upsert-only（无删除墓碑）+ read-merge-replace（非流式）边界——真 CDC 的 tombstone/流式 upsert 属后续增量。
- ⚠️ 全量 sync（无 incremental 能力或首次）changedRows=总行数 → 即便数据未变也会触发一次 recompute（全量模式无法廉价判定"无变更"）；增量路径已按 delta 精确跳过。
- 🔭 `derivation.completed` 事件：runDerivations 当前不发该事件（§4 列为派生管线产出，属既有缺口，非本单范围）——本单的 recompute 真跑但不另发事件，下游靠 `connection.sync_completed` 失效。
