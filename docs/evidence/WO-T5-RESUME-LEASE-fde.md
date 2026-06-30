# WO-T5-RESUME-LEASE（续跑前 steal 陈旧锁）+ GATE-B — FDE 真值证据

## WO-T5-RESUME-LEASE（#1b·P1）

**根因（母单 REVIEW-WO-P0-LOCK §2 真 PG 坐实）**：进程崩在抽取中途，其 `execution_locks` 租约（rule_extraction=60min）未过期 → 重启 `resumeInflightExtractions`→`withLock`→`acquire`→`ON CONFLICT … WHERE lease_until<now()` 命中未过期 → **SKIPPED（fence 恒=1）** → doc 卡 EXTRACTING 最长 60min。「已重新触发」日志误导（实际 skip）。

**修（修向①·根因解）**：`tryAcquire/acquire/withLock` 加 `steal` 选项（去 `WHERE lease_until<now()`·无条件夺锁·fence 仍 +1）；`resumeInflightExtractions` 续跑传 `steal:true`。理由：单实例 docker 重启时任何"在抽取中"doc 的锁必属已死进程（同进程不可能跨重启还在抽取），安全夺取；`runExtraction` 幂等清写（按 docId）防双写。**常态（非续跑）acquire 不 steal**——保 T1#1 活并发互斥（#1 多实例 mutex 原语不破；真多实例双跑需 job 队列另立单）。

**真值证据**：
- 真 PG live-fire `test/execlock-pg.integration.test.ts` #8：dead_holder 持未过期 60min 租约 → 常态 acquire SKIPPED（互斥仍在）→ `tryAcquire({steal:true})` 夺锁成功·**fence 递增**（对照母单"fence 恒=1 卡死"）。8/8 真 PG 绿。
- 内存 `ruledocs.test T1#1+WO-T5`：崩溃实例 A 持锁 → 常态 acquire(B) SKIPPED → `resumeInflightExtractions`（steal）→ **产候选 ≥3 + IN_REVIEW + fence 递增**（不卡 60min）。
- 改双仓储四处（repo 接口/pg/memory + execlock + ruledocs）；`pnpm -r test` 全绿。
- 真 PG 杀 datacore 抽取中→立即重启→续到 IN_REVIEW 的端到端实拍（需 Kimi）留审核方 FDE 判据复验；steal 机制已由上述 live-fire 坐实。

## GATE-B（#9·P2）

`pnpm gates` 此前只 `pnpm --filter @platform/contracts build` + `pnpm --filter datacore build`（2/4 包）→ 前端/agentcore tsc-red 本地漏过。修：链首改 `pnpm -r build`（4 包·依赖序），删冗余 mid datacore build。本地 `pnpm gates` 现复现前端/agentcore tsc 错误（不再 2/4 漏）。CI `gates.yml` 本就 `pnpm -r build`，本地对齐。
