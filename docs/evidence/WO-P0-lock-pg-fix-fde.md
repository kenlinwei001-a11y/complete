# WO-P0-LOCK · PG execution_locks 写入崩 修复 — FDE 真值证据

> P0·生产阻断：PG 模式下任意 `withLock` 必崩（`null value in column "resource_kind"`）→ rule-doc 抽取每次瞬间 PARTIAL·0 候选（1C+T1+T5 在生产全失效）。本 bug 只内存测才漏（内存仓储无 NOT NULL 约束）——典型「绿测试≠能用」。

## 根因 & 修复

`PgExecutionLockStore`（`apps/datacore/src/repo/pg.ts`）`super(pool, "execution_locks")` **未传 extraColumns** → 继承的通用 `PgStore.put` 只写 `(id, tenant_id, doc)`，漏 NOT-NULL-无默认列 `resource_kind/resource_key/holder_id/lease_until`。`tryAcquire` 后 `this.put(rec)` + heartbeat/release/requestRerun/consumeRerun 都走通用 put → PG 校验 NOT NULL 直抛。

修：`super(...)` 补 `extraColumns`，把 4 个 NOT-NULL-无默认列纳入通用 put 列集。**含 `lease_until` 一并修第二个潜伏 bug**：通用 put 的 `ON CONFLICT DO UPDATE SET …=EXCLUDED.…` 只更 doc+extraKeys；heartbeat 经 put 续租，而 tryAcquire 抢锁的 `ON CONFLICT … WHERE lease_until < now()` 读的是**列**——不纳入则心跳只改 doc 不改列 → 续租对抢占无效（锁可能抽取中途被误抢）。

## 真值证据 1 · 真 PG live-fire 回归（红→绿，airtight）

新增 `apps/datacore/test/execlock-pg.integration.test.ts`（env-gated `DATABASE_URL_TEST`，CI 配真 PG 跑）。本地真起 PG 16 集群实跑：

| | 不带修复（还原 buggy super） | 带修复 |
|---|---|---|
| 6 例（acquire/heartbeat列前移/release重夺/未过期SKIPPED/另一kind/withLock互斥） | **6 failed**：`null value in column "resource_kind" … violates not-null constraint`（= 审核方复现的 P0 原文） | **6 passed** |

- 用例 2 直读 `lease_until` **列**（非 doc）证心跳真前移列；用例 4 证未过期不可抢、用例 6 证 withLock 同键互斥——续租/抢占判定全在列上生效。

## 真值证据 2 · 端到端（真 PG datacore → rule-docs 抽取）

真起 datacore（`DATABASE_URL`=真 PG·SEED_DEMO·真 Kimi extraction 绑定）→ `POST /a/v1/rule-docs`（3 条中文规则·常州良率/产能/危险品）：

- **抽取全程 0 次 `resource_kind` 崩**（修前必崩 → PARTIAL/0 候选）。
- 终态 **IN_REVIEW · candidateCount=6（≥3）· extractError=None**。
- 即 1C/T1/T5 的 rule-doc 抽取链在 PG 模式真可用（修前生产全失效）。

## 真值证据 3 · 同类潜伏 bug 扫除（施工单边界「建议一并扫」→ 实做）

扫所有 migration 的 NOT-NULL-无默认列 vs PgStore 子类/extraColumns，发现 **2 个同类潜伏 P0**：
`merge_candidates` / `object_merges`（实体合并 A 特性）用裸 `new PgStore` 却建表为 `data JSONB NOT NULL`（**连 `doc` 列都没有**）→ 通用 put/get 引用不存在的 `doc` 列，PG 下该特性**完全崩**。一并修（见同提交）。

## 防复发根因解 · `repo-pg-notnull:check` 门

新增 `scripts/check-repo-pg-notnull.mjs`（并入 `pnpm gates`）：静态扫每张表的 NOT-NULL-无默认列，与对应 PgStore（裸/子类/extraColumns）实际写入列集比对，凡未覆盖 → 红。根除「建表加了 NOT-NULL 列却忘了让仓储写它」这一整类漏配。

## 门

`pnpm -r build` 全绿；`pnpm -r test`（datacore 含新 PG 测 env-gated skip 本地、CI 真跑）全绿；`repo-pg-notnull:check` 绿。

## 本体回写

执行语义 §1 锁机制列语义不变（仅修仓储写入完整性）；新增门记于门禁章节。

## 距北极星 / 交接

- 施工单 FDE 判据 ②（抽取中途杀 datacore→重启续跑真 PG 实拍）由**审核方**复验（本单修好才可验·T5 续跑被本 P0 阻断已解除）。
- 实体合并（merge_candidates/object_merges）PG 修复随本单一并落，建议审核方补一条该特性的 PG e2e 实拍。
