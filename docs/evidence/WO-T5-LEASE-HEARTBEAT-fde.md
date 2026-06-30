# WO-T5-LEASE-HEARTBEAT · FDE 证据 — 短租约 + 心跳保鲜 + 死锁过期重夺 + 多实例互斥（真 PG live-fire）

> 本体引用：§1 执行锁（租约/fence/心跳）· §85 RuleDoc 抽取续跑 · 不变量 R6（确定性）/R9（双仓储四处一致）· 断点 G-3。
> 模型标识不入提交物。

## 一 · 根因与锁模型

### 旧模型（脆弱：长租约 → 死锁 60min）

`execlock.ts` 把租约定为「任务预估时长 × 2」，`rule_extraction = 30min × 2 = 60min`。
持锁进程崩溃后，遗留的未过期租约要 **60min** 才自然过期 → 续跑/竞争者的常态 `acquire`（`WHERE lease_until<now()`）命中未过期锁 → SKIP → doc 卡 `EXTRACTING` 最长 60min。
为绕开此死锁，曾加无条件 `steal`（去掉 `WHERE lease_until<now()`）——**单实例安全，但两个活实例都可能误判对方已死而互夺锁 → 双跑**。`steal` 是「租约过长」的创可贴，不是根因解。

### 新模型（短租约 + 心跳保鲜 · 分布式锁标准 lease+fencing 范式）

1. **短租约 TTL**：`SHORT_LEASE_MS = 120_000`（120s），所有 `ExecutionResourceKind` 统一。acquire 设 `lease_until = now + ttl`。
2. **心跳保鲜**：`withLock` 持锁期间每 `ttl/3 ≈ 40s` 调 `heartbeat` 续租（活着就续约）→ 活持锁者租约恒新鲜 → 他实例常态 `acquire` 命中 `lease_until>now` 必 SKIP → **跨实例互斥真成立**；长任务（数百秒 LLM 抽取）由心跳保鲜，不被误夺。
3. **死锁过期重夺**：进程崩 → 心跳停 → 租约 ~120s 后自然过期 → 另一实例**常态 acquire**（非 steal）即可重夺；`fence + 1` 防僵尸写。
4. **steal 退化为显式可选优化**：新增 `EXECUTION_SINGLETON` 配置（默认 `true`=单实例 docker）。
   - `true`：`resumeInflightExtractions` 走 `steal` 即时夺锁续跑（安全因单实例：在抽取中的锁必属已死进程）。
   - `false`（多实例部署）：禁 `steal`，续跑靠**短租约自然过期 + 常态 acquire** 重夺 → 永不绕过未过期租约 → 杜绝两活实例双跑。
   把「持锁者必已死」的假设从隐式（藏在注释）变显式（配置）。

死活判定从「我猜你死了（steal）」改为「租约新鲜度（心跳）自证」——多实例正确 + 续跑不卡 60min，一并消解这对矛盾。

### TTL / 心跳参数

| 参数 | 值 | 说明 |
|---|---|---|
| `SHORT_LEASE_MS`（生产 TTL） | `120_000` ms = 120s | 取「最坏单步同步停顿安全上界」而非任务总时长；长任务靠心跳保鲜 |
| 心跳间隔 | `max(1000, ttl/3)` ≈ 40s | `withLock` 自动 `setInterval`（`.unref()`） |
| 崩溃后最坏重夺延迟 | ~120s（vs 旧 60min） | doc 本就要等进程重启 |
| 安全裕度 | 120s >> 任何可信事件循环停顿（LLM/网络/IO 异步不阻塞 loop；唯一同步风险巨型 zod parse 秒级） | |
| 测试 TTL | `2000` ms（整秒，PG 以秒粒度抢锁） | 受控 sleep 验 TTL，断言确定（R6） |

## 二 · 改动清单（R9 双仓储四处 + 配置 + 续跑）

| 文件 | 改动 |
|---|---|
| `apps/datacore/src/execlock.ts` | `DEFAULT_LEASE_MS` 全 kind → `SHORT_LEASE_MS=120s`（rule_extraction 60min→120s）；补短租约+心跳模型注释 |
| `apps/datacore/src/config.ts` | 新增 `EXECUTION_SINGLETON`（默认 true·transform 解析 0/false） |
| `apps/datacore/src/ruledocs.ts` | 构造加 `executionSingleton`（默认 true）；`resumeInflightExtractions` 的 `steal` 由该旗标门控（多实例靠租约过期） |
| `apps/datacore/src/app.ts` | `RuleDocService` 注入 `config.EXECUTION_SINGLETON` |
| `apps/datacore/test/execlock-pg.integration.test.ts` | 新增 `WO-T5-LEASE-HEARTBEAT` 4 条真 PG live-fire |

R9 锁原语（`tryAcquire`/`heartbeat`/`acquire`/`withLock`/`assertFence`）已存在于 `repo.ts` 接口 + `pg.ts` + `memory.ts` + `execlock.ts` 四处一致，本单只缩 TTL（数据驱动 const），未改接口形状 → 四处自动一致；新增配置不触及仓储契约。

## 三 · 真 PG live-fire 证据

环境：PostgreSQL 16，TCP `127.0.0.1:5433`，`initdb` 以 `postgres` 用户 `su postgres -c` 跑，库 `wo_t5`。
跑法：`DATABASE_URL_TEST=postgres://postgres@127.0.0.1:5433/wo_t5 pnpm --filter datacore exec vitest run test/execlock-pg.integration.test.ts`

```
 ✓ ... > 1) acquire 不抛 + 行落库 42ms
 ✓ ... > 2) heartbeat 真前移 lease_until 列 1131ms
 ✓ ... > 3) release 后 lease_until ≤ now() → 下一 acquire 可重夺（fence +1） 43ms
 ✓ ... > 4) 未到期第二抢占者 SKIPPED 32ms
 ✓ ... > 5) 另一 kind（derivation_spec）不崩 20ms
 ✓ ... > 8) WO-T5-RESUME-LEASE：steal 夺未过期租约·fence +1 39ms
 ✓ ... > 7) merge_candidates/object_merges 真 PG put→get→list 不崩 22ms
 ✓ ... > 6) withLock 端到端（acquire→自动心跳→release）+ 同键互斥 42ms
 ✓ ... > WO-T5-LEASE-HEARTBEAT > T5-1) 短租约下不心跳 → 过 TTL → 另一实例可重夺（死锁过期重夺·常态 acquire 非 steal） 3224ms
 ✓ ... > WO-T5-LEASE-HEARTBEAT > T5-2) 持锁方持续心跳 → 租约保鲜 → 另一实例过 TTL 后仍拿不到（活锁心跳有效·长任务不被误夺） 7459ms
 ✓ ... > WO-T5-LEASE-HEARTBEAT > T5-3) 两实例并发 acquire 同 key → 恰一个成功（多实例互斥·PG 行级原子裁决） 23ms
 ✓ ... > WO-T5-LEASE-HEARTBEAT > T5-4) 重夺后 fence 递增 → 旧持有者写被 fencing 拒（无僵尸写） 3234ms

 Test Files  1 passed (1)
      Tests  12 passed (12)
```

### 四条目标 live-fire 对照判据

| 判据 | 测试用例 | 机制 | 证据 |
|---|---|---|---|
| ① 短租约不心跳 → 过 TTL → 另一实例重夺（死锁过期重夺） | T5-1 | 实例A acquire 后停心跳；TTL 内实例B 常态 acquire 被挡；过 TTL 后实例B 常态 acquire 成功·fence > A.fence | 绿 3224ms |
| ② 持锁方持续心跳 → 租约保鲜 → 另一实例 TTL 后仍拿不到（活锁心跳·长任务不被误夺） | T5-2 | 实例A 每 ttl/3 心跳；等 2×TTL 后实例B 仍 SKIP；停心跳过 TTL 后才放行（证拿不到确因心跳而非锁坏） | 绿 7459ms |
| ③ 两实例并发 acquire 同 key → 恰一个成功（多实例互斥） | T5-3 | `Promise.all` 真并发打 PG → 恰 1 winner + 1 SKIP（携 winner holderId）；PG 行级 INSERT…ON CONFLICT WHERE 原子裁决 | 绿 23ms |
| ④ 重夺后 fence 递增·旧持有者写被 fencing 拒（无僵尸写） | T5-4 | 旧持有者持 oldFence；过 TTL 实例B 重夺 fence>oldFence；旧持有者复活 `assertFence(oldFence)` → `StaleExecutorError`；新持有者新 fence 合法 | 绿 3234ms |

两实例由共享同一 PG `execution_locks` 表的两个独立 `ExecutionLockService` 模拟（PG 行级原子是唯一跨实例裁决者）。受控 `sleep` 仅用于跨越 TTL 边界，断言只依赖「TTL 已过/未过」的确定状态（R6：不依赖墙钟随机值）。

## 四 · 门禁 / 回归

- `pnpm -r build`（4 包）：绿（见提交前重跑）。
- `pnpm --filter datacore test`（内存模式全量）：绿（含 `ruledocs.test.ts` 续跑 steal 用例——`EXECUTION_SINGLETON` 默认 true 保持单实例续跑即时性，向后兼容）。
- `pnpm gates`：绿。

## 五 · 距北极星

- ✅ 多实例互斥 + 死锁过期重夺 + 心跳保鲜 + fencing 防僵尸写：真 PG live-fire 四条坐实。
- ◐ 真正的多实例并行**吞吐分发**（多实例并行抽不同 doc）仍需 job 队列——与锁正确性正交，本单不引入（设计文档已划界）。`EXECUTION_SINGLETON=false` 已为多实例部署预留正确的锁语义（靠租约过期重夺，不双跑）。
- ◐ TTL=120s 是保守默认；若部署观测到长 zod parse 同步停顿 >> 预期，可经 `leaseOverrides` 单 kind 调整（已具能力）。
