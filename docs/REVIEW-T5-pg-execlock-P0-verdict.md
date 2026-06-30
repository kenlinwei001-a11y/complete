# 审核方真跑核发 · T5 重启续跑实拍 → 撞出 P0（PG 模式抽取 100% 崩）

> 用户要「T5 真重启续跑实拍」。审核方起**真 PostgreSQL 16**（内存模式重启即清空、无从验续跑）跑端到端——**没跑成续跑，反而撞出一个 P0：在 PG（生产）模式下，rule-doc 抽取每次都瞬间崩成 PARTIAL（0 候选），连 Kimi 都没调到**。1C（解析率）+ T1（异步）+ T5（续跑）在 PG 全线失效。

## 结论速览

| 项 | 结果 |
|---|---|
| **P0·execution_locks PG 写入崩** | ❌ **确认**（真 PG 复现 + 逐行根因 + 经验证伪） |
| T5 重启续跑实拍 | ⛔ **被 P0 阻断**（doc 永远到不了干净的 EXTRACTING 态——一上锁就崩 PARTIAL，无 orphan 可续） |
| 影响面 | rule_extraction **已证**；execution_locks 的 `tryAcquire` 在 PG 对**任意 kind 必崩**（derivation_spec/connection_sync/… 同理）→ 疑似 PG 锁从未真正工作（潜伏 P0，被 99e7538 新引用首次引爆） |
| 为何测试全绿 | 内存 `ExecutionLockStore.put` = `Map.set`（无 NOT NULL 约束）→ 单测永远绿；**只有真 PG 强制约束**→ 绿测试≠能用 |

## 根因（📖读源 + 真 PG 经验证伪·逐行坐实）

1. `apps/datacore/src/repo/pg.ts:165` `class PgExecutionLockStore extends PgStore<ExecutionLockRecord>`，`:167` `super(pool, "execution_locks")` —— **未传 `extraColumns`**。
2. 基类 `PgStore.put`（`:133-146`）只写 `(id, tenant_id, doc, ...extraColumns)`；`extraColumns` 默认 `() => ({})` → **不写 `resource_kind`/`resource_key`**（二者 migration `011:11-12` NOT NULL）。
3. `tryAcquire`（`:186` 专用 INSERT 写全列 → 行落库 ✓）紧接 **`:213` `await this.put(rec)`**（注释「keep generic doc column coherent」，为让 `get`/`list` 读的 `doc` JSONB 同步全字段）→ 走通用 put → `INSERT INTO execution_locks (id,tenant_id,doc) … ON CONFLICT (id) DO UPDATE`。
4. **PostgreSQL 在 ON CONFLICT 解析前先校验待插入元组的 NOT NULL** → `resource_kind` 为 NULL → **抛 `null value in column "resource_kind" … violates not-null constraint`**（id 存在与否都抛——经验证伪：fresh id 与已存在 id 两路均崩）。
5. → `tryAcquire` 抛 → `acquire`/`withLock` 抛 → `ruledocs.ts:189 fireExtraction` 的 `.catch` 落 doc `status=PARTIAL` + `extractError`（**Kimi 尚未调用**，故 ~毫秒级崩、非 70s）。

**净效果**：PG 模式下每次 `POST /a/v1/rule-docs` → 202 EXTRACTING → 后台一上锁即崩 → doc PARTIAL·0 候选。规则文档审核台在生产恒空，「文档→规则候选→规则库」正门断首跳。

## 真值证据（审核方亲手·真 PG 16）

- 真 PG（initdb 16 · 127.0.0.1:5433）+ datacore PG 模式 SEED_DEMO + Kimi seeded（AES-GCM 落库·R5）。
- POST 规则文档 → 202 EXTRACTING（0.x s）→ 后台秒级 → doc `status=PARTIAL`，`doc->>'extractError'` = **`null value in column "resource_kind" of relation "execution_locks" violates not-null constraint`**，候选 0。
- 经验证伪（直打 PG）：通用 put 形态 `INSERT (id,tenant_id,doc) ON CONFLICT (id) DO UPDATE` —— **fresh id 与已存在 id 两路均抛 resource_kind NULL**（坐实 PG 先校验 NOT NULL 再解 ON CONFLICT）。
- 对照：同 3 条规则、同 Kimi，在**内存模式**（本会话早先）抽取成功 `IN_REVIEW`·**candidateCount=3** → 证 bug 是 PG 专属（约束差异），非 Kimi/抽取逻辑。

## 修向（dev·任一即可解，建议①）

1. **①（最小根因解）** `PgExecutionLockStore` 的 `super()` 传 `extraColumns`：`super(pool, "execution_locks", (l) => ({ resource_kind: l.resourceKind, resource_key: l.resourceKey, holder_id: l.holderId, lease_until: l.leaseUntil, fence: String(l.fence) }))` —— 让通用 put 写齐所有 NOT NULL 专用列（注意覆盖全部 NOT NULL 列，非仅 resource_kind）。
2. **②** 重写 `PgExecutionLockStore.put` 为专用 UPSERT（与 tryAcquire 同列形态），不复用通用 put。
3. **③** 去掉 `tryAcquire:213 this.put(rec)`，并把专用 INSERT 的 `doc` 由 `'{}'` 改写 `JSON.stringify(rec)`（get/list 读 doc 才不丢字段）。

## 为何单测全绿（绿测试≠能用·复盘）

- 单测默认内存仓储；内存 `ExecutionLockStore.put` 是 `Map.set`，**无 NOT NULL 约束** → tryAcquire 的 put(rec) 不抛 → 锁/抽取/续跑单测全绿。
- 真 PG 才强制 `resource_kind NOT NULL`。**锁/续跑特性从未在真 PG live-fire 过** → 这条 PG 接缝测不出来（断点在跨存储形状接缝，非模块内部）。
- 与早先 `sseScripts.ts:34` tsc-red 同源教训：**vitest 绿 ≠ 真起 PG 能用**。

## 连带：T5 重启续跑实拍（仍欠·被 P0 阻断）

`resumeInflightExtractions()` 启动扫 `status=EXTRACTING` 重夺续跑——逻辑读源看是对的，但 PG 模式下 doc 一上锁即崩 PARTIAL，**永远到不了干净 EXTRACTING orphan** → 无从触发/实拍续跑。**修完 P0 后**审核方再补：杀进程→重启→`resume` 把 EXTRACTING doc 续到 IN_REVIEW + 候选幂等不重复（真 PG 实拍）。

## FDE 真值判据（修后审核方据此复验）

1. 真 PG `POST /a/v1/rule-docs`（3 中文规则）→ 后台抽取**到 IN_REVIEW·candidateCount≥3**（不再 PARTIAL/resource_kind 崩）。
2. execution_locks 其余 kind（如 derivation_spec）在 PG 同样不崩（抽样验锁通用可用）。
3. **T5 续跑**：doc EXTRACTING 时杀 datacore → 重启 → `resume` 续到 IN_REVIEW·候选幂等（不重复堆积）。
4. **加门**：补真 PG live-fire 回归（非仅内存）——锁 acquire→heartbeat→release 全走真 PG 不崩；并入 gates。

---
*审核方独立真跑（真 PG 16 端到端 + 逐行读源 + 经验证伪）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
