# WO-PIPE-INCR ③ 删除墓碑（tombstone·CDC 删除传播）· FDE 证据

> 工单：WO-PIPE-INCR ③ —— ①② 把"增量 delta 合并（upsert by pkField）+ watermark 推进 + 调度自动续传 + sync 完成钩子"做扎实后，
> ③ 补**删除墓碑**：当前增量合并是 **upsert-only**，上游删除的行在本地**保留**（漏删）。本单让 CDC 源能把"该 pk 已删"传播到本地真移除。
> 根因解（铁律0）：不是再加一个标志位应付门，而是补齐 CDC 三类变更（I/U/**D**）里缺失的 D——删除是真实业务事件（订单取消、物料下线），漏删会让派生/对象长期带"幽灵行"。

## 完成定义（用户视角）

运维配的 REST/CDC 数据源在增量 delta 里对某主键回一条**带删除标记**的行（缺省约定 `_deleted === true`，或自定义 `deleteField`/`deleteValue` 如 CDC 的 `op="D"`）：
1. 平台增量合并时识别该墓碑行 → 从既有数据**按 pk 移除该行**（而非 upsert），普通行仍 upsert（新增/变更/未变保留）。
2. 删除行的 watermark **照常参与水位推进**（否则纯删除 delta 水位卡住、下次重取同一批）。
3. job 回执 / sync 完成钩子带 `deletedCounts`（每数据集删除数）+ `deletedRows`（总删除数），下游据此知"有删除"也须刷新/重算。
4. 全量 sync 天然反映删除（replace 整表）·不受影响（向后兼容）。

## 墓碑设计（要点）

| 维度 | 决策 |
|---|---|
| 契约 | `DatasetConfig` **契约化进 `@platform/contracts`（datacore.ts `DatasetConfigSchema`）**，此前仅内联于 `connectors/service.ts`；新增 `deleteField?` + `deleteValue?`（contracts-only-shared，单一来源），服务层改 `import type { DatasetConfig }` 复用、删内联 interface |
| 删除判定 | 纯函数 `isTombstone(row, cfg)`：① 均不配 → 看 `_deleted === true`；② 仅配 `deleteField` → 看该列为真值（`=== true`）；③ 同配 `deleteField`+`deleteValue` → 严格相等命中。**无时钟/随机·确定性守 R6** |
| 合并 | 增量分支：`for d of delta`——`isTombstone(d)` → `byPk.delete(key)`（仅在确实存在该 pk 时 `deletedCount++`，幂等：删不存在 pk 不计）；否则 `byPk.set(key,d)`（upsert 不变） |
| 水位 | 删除墓碑行已从 `finalRows` 移除，但其 watermark 须参与推进 → 增量分支取 `[...finalRows, ...rows]`（含墓碑）的 wmField 最大值与既有取 max（纯删除 delta 水位也推进） |
| 计数 | `SyncJob.deletedCounts?`（JSONB doc 内·**无需迁移**，sync_jobs 用通用 `doc JSONB`）+ `SyncCompletedInfo.deletedRows/deletedCounts`；`app.ts` 把删除计数并入 `connection.sync_completed` 事件，触发条件改 `changedRows>0 || deletedRows>0` |

设计取舍：删除标记列与水位列正交——delta 过滤仍按 wmField（`> since`）统一筛，墓碑行只是合并阶段走 delete 分支；既有 delta 计数 `deltaCount` 已含墓碑行，故纯删除 delta 的 `changedRows>0` 天然触发下游重算（删除传播到对象/派生）。

## 改动文件（只在 connectors 区 + contracts DatasetConfig，零碰 repo.ts）

| 层 | 文件 | 改动 |
|---|---|---|
| 契约 | `packages/contracts/src/datacore.ts` | 新增 `DatasetConfigSchema`（含全部既有字段 + ③ `deleteField?`/`deleteValue?`）+ `export type DatasetConfig` |
| 同步服务 | `apps/datacore/src/connectors/service.ts` | 删内联 `DatasetConfig` interface 改 import 契约类型；新增 `isTombstone()`；增量合并墓碑分支（delete by pk + deletedCount）；水位含墓碑行推进；`SyncCompletedInfo` 增 `deletedRows/deletedCounts`；job 落 `deletedCounts` |
| 领域 | `apps/datacore/src/domain.ts` | `SyncJob.deletedCounts?`（additive·JSONB doc·无迁移） |
| 装配 | `apps/datacore/src/app.ts` | `connection.sync_completed` 事件并入 `deletedRows/deletedCounts`；recompute 触发条件加 `|| deletedRows>0` |
| 单测 | `apps/datacore/test/connectors-incremental.test.ts` | +2 用例（缺省 `_deleted` 墓碑 / 自定义 `op="D"` 墓碑） |

## 验收证据 1 · vitest（直测 ConnectorService 删除墓碑）

`apps/datacore/test/connectors-incremental.test.ts`（4 tests 全绿）：
```
✓ WO-PIPE-INCR ② 调度自动增量 + sync 完成钩子
  ✓ auto 模式无须传 since…
  ✓ WO-PIPE-INCR ③ 删除墓碑：delta 行带删除标记 → 该 pk 本地真被移除·其余保留·watermark 推进·deleted 计数
  ✓ WO-PIPE-INCR ③ 自定义 deleteField/deleteValue：CDC op=D 标记命中即移除
  ✓ 无 incremental 能力的连接器（mock_erp）即便 auto 也走全量 replace（向后兼容）
```
判据（缺省墓碑用例）：① 全量基线 A/B/C·watermark=2026-01-03；② 二次 auto 续传上游回墓碑（删 B）→ `deletedCounts.orders=1`·`deletedRows=1`·`watermarks.orders=2026-01-09`（删除行 wm 推进）·落库剩 A/C（B 真移除·rowCount=2）。
自定义用例：`deleteField:"op",deleteValue:"D"` → op=D 删 A → 落库剩 B。

## 验收证据 2 · FDE 真跑（真 HTTP·真 datacore·内存 SEED_DEMO=1·亲手 curl）

stub 上游 `:4099`（无 since→全量 A/B/C；带 since→回 `{id:"B",_deleted:true,updatedAt:"2026-01-09"}`）+ 真 datacore `:4001`：
```
=== sync #1 (full baseline, no since) ===
{"syncJobId":"sync_…","status":"SUCCEEDED","rowCounts":{"orders":3},"watermarks":{"orders":"2026-01-03"}}
=== rows after full (expect A,B,C) ===
ids: A,B,C
=== sync #2 with ?since=2026-01-03 (delete delta: B _deleted) ===
{"syncJobId":"sync_…","status":"SUCCEEDED","rowCounts":{"orders":1},"watermarks":{"orders":"2026-01-09"}}
=== rows after delete delta (expect A,C — B GONE) ===
ids: A,C
B present? false
=== dataset meta ===
rowCount: 2 watermark: 2026-01-09
```
- 读 `GET /a/v1/raw-datasets/:id/rows` 核实：删除前 ids=A,B,C；删除后 ids=A,C，**`B present? false`**——该 pk 真被移除（非 upsert 保留）。
- watermark 由 2026-01-03 → **2026-01-09**（删除行的 wm 也推进水位）·rowCount 3→2·sync HTTP 202 SUCCEEDED。

## 门禁

`pnpm -r build`（4 包）+ `pnpm --filter datacore test` 全绿；`pnpm gates` 全绿（见提交记录 push 前重跑）。

## 本体回写

- §2 RawDataset：补 ③ 删除墓碑语义（delta 行命中删除标记 → 按 pk 移除·删除行 wm 仍推进水位·`deletedCounts` 入 job/事件·全量 sync 天然反映删除）。

## 诚实边界 · 流式 upsert 延后为 ③b（本单不做·原因）

- ⏭ **流式 upsert（非全量载入合并）显式延后 ③b**：当前增量合并是 **read-merge-replace**——`rawRows.list` 全量读既有 → 内存 Map 合并（含删除）→ `rawRows.replace` 整表写回。大表下这是 O(全表) 内存。真流式需 **repo 层 per-pk upsert/delete API**（改 `repo.ts` 接口 + `repo/memory.ts` + `repo/pg.ts`）。本单**不做**：① repo.ts 正被在跑的后端 agent 改动，碰它会撞并行集成；② 本单红线限定"只改 connectors 区 + 其单测 + contracts DatasetConfig·勿碰 repo.ts"。故 ③ 在既有 read-merge-replace 框架内补删除墓碑（语义正确·删除真生效），流式作为 ③b 后续单独落（届时与 repo agent 协调或在其落地后接）。
- 📏 ③ 边界：删除依赖上游 CDC **显式发墓碑行**——若上游用"全量快照差集"表达删除（不发墓碑、只是某 pk 不再出现在增量里），增量路径不会推断删除（增量按定义只看 delta，无法区分"未变"与"已删"）；这类源应走全量 sync（replace 天然反映删除）。属 CDC 源契约，非缺陷。

## 距北极星还差什么（诚实）

- ✅ 本次真做到：CDC 删除传播闭合（上游删 → 本地按 pk 真移除）·删除行 wm 推进·删除计数入 job/事件·删除触发下游重算·缺省+自定义删除标记·确定性 R6·真 HTTP 走通。
- ⏭ ③b 流式 per-pk upsert/delete（repo 层 API·避免 read-merge-replace 全表内存）——待 repo agent 落地后接，不在本单。
- 🔭 软删除/审计：本单是**硬删除**（行从 rawRows 移除）。若业务要保留删除痕迹（tombstone 留行 + deleted 标志供审计/回放）属后续策略选项，非本单范围。
