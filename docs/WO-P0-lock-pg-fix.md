# 施工单 · WO-P0-LOCK — PG 模式 execution_locks 写入崩（rule-doc 抽取全失效）

> **P0·生产阻断**。母单（根因+真 PG 复现+经验证伪）：`REVIEW-T5-pg-execlock-P0-verdict.md`。本单是 dev 可直接照做的修复 spec。
> **红线**：`pnpm -r build`(全4包) + `pnpm -r test` 全绿 + **真 PG live-fire 判据过**（绿测试≠能用·本 bug 正因只内存测才漏）；只推 `claude/vigilant-knuth-b1nmxn`；密钥仅 env。

## 目标

PG 模式下，`execution_locks` 的任意 `withLock` 当前**必崩**（`null value in column "resource_kind"`）→ rule-doc 抽取每次瞬间 PARTIAL·0 候选（1C+T1+T5 在生产全失效）。修到：锁 acquire→heartbeat→release 全程在真 PG 不崩，rule-doc 抽取真出候选。

## 根因（一句话）

`PgExecutionLockStore`（`apps/datacore/src/repo/pg.ts:165`）`super(pool, "execution_locks")` **未传 `extraColumns`** → 继承的通用 `PgStore.put`（`:133-146`）只写 `(id, tenant_id, doc, ...extraColumns)`，漏 NOT NULL 的 `resource_kind`/`resource_key`/`holder_id`/`lease_until`。而 `tryAcquire:213 this.put(rec)`（同步 doc 列）+ heartbeat/release/requestRerun/consumeRerun 都走这个通用 put → **PG 在 ON CONFLICT 解析前先校验待插入元组 NOT NULL → 抛**（fresh id 与已存在 id 两路均抛，经验证伪）。

## 改哪些（主修·最小根因解）

**`apps/datacore/src/repo/pg.ts`** — `PgExecutionLockStore` 构造的 `super(...)`（约 `:167`）补 `extraColumns`，把**全部 NOT-NULL-无默认**列纳入通用 put 的列集：

```ts
class PgExecutionLockStore extends PgStore<ExecutionLockRecord> implements ExecutionLockStore {
  constructor(pool: pg.Pool) {
    super(pool, "execution_locks", (l) => ({
      resource_kind: l.resourceKind,
      resource_key: l.resourceKey,
      holder_id: l.holderId,
      lease_until: l.leaseUntil,   // ISO string → TIMESTAMPTZ（PG 隐式 coerce）
    }));
  }
  // tryAcquire 不变（专用 INSERT 仍写全列；此后 this.put(rec) 现在写齐 NOT NULL，ON CONFLICT 不再撞约束）
  ...
}
```

**为何必须含 `lease_until`（不止 resource_kind/resource_key）**：通用 `put` 的 `ON CONFLICT DO UPDATE SET … ${k}=EXCLUDED.${k}`（`:139-141`）只更新 `doc`+`extraKeys`。`heartbeat`/`release` 经 `put({...lock, leaseUntil})` 更新租约，而 **`tryAcquire` 抢锁的 `ON CONFLICT … WHERE execution_locks.lease_until < now()`（`:195`）读的是 `lease_until` 列**。若 `lease_until` 不在 extraColumns → 心跳只改 doc 不改列 → 续租对抢占**无效**（锁可能在抽取中途被误抢）。含进去，心跳即真更新列。`resource_kind`/`resource_key`/`holder_id` 解 NOT NULL 崩；`lease_until` 解 NOT NULL 崩 **且** 解续租失效（一并修两个潜伏 bug）。
**列默认值无需纳入**：`acquired_at`/`fence`/`rerun_requested`/`doc`/`updated_at` 有 DEFAULT 或经 doc 读回（`current()`→`get()` 读 `doc` JSONB，非列），故不入 extraColumns。

> 备选（更显式，二选一）：在 `PgExecutionLockStore` **override `put`** 写专用 UPSERT（与 tryAcquire 同列形态 + `doc=JSON.stringify(item)`）。等价，代码多但意图清晰。主修（extraColumns）更小，优先。

## 回归测试（必补·根除"绿测试≠能用"）

新增 **真 PG live-fire** 回归（仿 `test/opt-real-sidecar.integration.test.ts` env-gated 范式，未配 `DATABASE_URL_TEST` 则 skip，但 **CI 配上跑真 PG**）：

1. `acquire("rule_extraction", k)` → 不抛 + 行落库（`resource_kind` 非空）。
2. `heartbeat` 后查 **`lease_until` 列真前移**（证续租改的是列非仅 doc）。
3. `release` 后 `lease_until` 列 ≤ now()（下一 acquire 可重夺）。
4. **端到端**：真 PG datacore `POST /a/v1/rule-docs`（3 中文规则·真/或 mock LLM）→ 抽取到 **IN_REVIEW·candidateCount≥3**（不再 PARTIAL/resource_kind 崩）。
5. 抽样另一 kind（如 `derivation_spec`）同样不崩（证锁通用可用，非仅 rule_extraction）。

**门**：把"execution_locks 真 PG 回归"并入 CI（`gates.yml` 已跑 `pnpm -r test`；新测 env-gated，CI 提供 `DATABASE_URL_TEST`）。可选 `repo-pg-notnull:check`：扫 `PgStore` 子类，凡其表有 NOT-NULL-无默认列却未在 `extraColumns` 覆盖 → 红（根除同类漏配）。

## FDE 真值判据（审核方据此真跑复验核发）

1. 真 PG 16 起 datacore（`DATABASE_URL`）→ `POST /a/v1/rule-docs`(3 规则) → **IN_REVIEW·candidateCount≥3**，doc 无 `extractError`。
2. 抽取中途**杀 datacore→重启**→ `resumeInflightExtractions` 把 EXTRACTING doc 续到 IN_REVIEW、候选**幂等不重复**（= 顺带闭 T5 续跑实拍·本单修好才可验）。
3. 心跳真更新 `lease_until` 列（长抽取不掉锁）；另一 kind 锁不崩。
4. `pnpm -r build` + `pnpm -r test` 全绿，且真 PG 回归测试在 CI 真跑过。

## 边界 / 连带

- 这是 `execution_locks` 的**潜伏 P0**（任意 kind 在 PG 都崩）——修后**所有**走锁的特性（derivation_spec/connection_sync/materialize/replay…）在 PG 才真可用，建议 dev 一并扫一眼这些路径是否已在生产 PG 被静默打挂。
- 本单修好 → 审核方补 **T5 重启续跑真 PG 实拍**（当前被本 P0 阻断）。
- **本体回写**：若锁语义/列被改，回写 `SYSTEM-ONTOLOGY.md` 执行语义相关章节。

---
*审核方设计落地施工单（design+review·非 dev 实装）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
