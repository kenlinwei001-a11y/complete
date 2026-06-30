# 审核核发 · WO-T5-RESUME-LEASE + GATE-B 闭合（真 PG live-fire + 对抗式撤回）

> 提交物 `9a26702`「续跑前 steal 陈旧锁（重启不卡 60min）+ gates 全 4 包构建」。
> **本单是 dev 修复审核方上轮自提的 finding**（`REVIEW-WO-P0-LOCK-closure-and-resume-finding.md` 的 T5-RESUME-LEASE：P0-LOCK 修好后暴露的交互 bug——重启续跑被未过期 60min 租约挡住、doc 卡 EXTRACTING、fence 恒=1）。审核方**真起 PostgreSQL 16 live-fire + 对抗式撤回**独立复验，非纸面采信。

## 一句话结论

**✅ 双单闭合。** WO-T5-RESUME-LEASE：真 PG live-fire 8/8 过（含 #8 steal 夺锁）；对抗式撤回 steal → #8 即红（证修真咬）；常态 acquire 仍 SKIP（mutex 原语不破）；端到端续跑 stuck-EXTRACTING→IN_REVIEW+候选≥3+fence 递增。GATE-B：`gates` 别名从 2/4 包构建改为 `pnpm -r build` 全 4 包（本会话亲历的「本地漏 tsc-red」根因收口）。

## WO-T5-RESUME-LEASE · FDE 真跑核对

源单 finding 判据：① 重启后 stuck-EXTRACTING doc 不再卡 60min，自动续上 → IN_REVIEW；② 常态并发不双跑（mutex 不破）；③ fence 递增证真夺锁（对照卡死态 fence 恒=1）。

| 判据 | 状态 | 审核方独立证据（本会话真起 PG 16·端口 5433·trust） |
|---|---|---|
| ① 续跑不卡·doc 进 IN_REVIEW | ✅ | `ruledocs.test.ts:243` 真跑绿：stuck `doc_lock`（EXTRACTING·instanceA 持未过期 60min 租约）→ `resumeInflightExtractions()` steal → `flushExtractions` → doc=**IN_REVIEW** + 候选 **≥3** |
| ② 常态 acquire 仍互斥（不双跑） | ✅ | 同测：instanceB 常态 acquire（不 steal）→ `ok=false` **SKIPPED**；live-fire `execlock-pg #8` 亦断言常态 `blocked.ok=false` |
| ③ fence 递增证真夺锁 | ✅ | live-fire `#8`：`tryAcquire({steal:true})` → `holderId="resume"` · `fence > a1.fence`；ruledocs `#243`：`lock.fence > acq.fence` |

### 真 PG live-fire（关键·此前 env-gated 被 skip）

- `execlock-pg.integration.test.ts` 由 `describe.skipIf(!DATABASE_URL_TEST)` 门控——审核方先前跑 datacore「786 passed | **11 skipped**」时它在 skip 之列。
- 本会话**真搭 PG 16**（`initdb -A trust`·5433·throwaway DB `dc_livefire`）配 `DATABASE_URL_TEST` 真跑 → **8/8 全过**（含 #8 steal·#1 NOT-NULL 列落库·#2 heartbeat 前移 lease_until 列·#6 withLock 端到端·#7 merge_candidates/object_merges data 列）。

### 对抗式撤回（证修真咬·非门面绿）

把 `apps/datacore/src/repo/pg.ts:237` 的 `const conflictWhere = input.steal ? "" : "WHERE …lease_until < now()"` 改回**恒带 WHERE**（无视 steal）→ 真 PG 重跑：

```
× #8 WO-T5-RESUME-LEASE：steal 无条件夺未过期租约 → AssertionError: expected undefined to be defined (pg.ts:121 expect(stolen).toBeDefined())
✓ #1–#7 仍过（隔离干净·仅 steal 路径塌）
```

→ 撤回即红，证 steal 真在「绕未过期租约夺锁」上起作用；`git checkout` 还原复绿。**这正是母单卡死态的复现**：无 steal，未过期租约挡住续跑、`stolen=undefined`。

## 根因解评估（修向①而非兜底）

dev 修法符合「铁律0 根因解」：
- **不是**把 rule_extraction 租约改短（兜底②会牺牲长抽取的互斥保护）；
- **而是**给 `tryAcquire/acquire/withLock` 加 `steal` 选项（双仓储 pg+memory 四处一致），**仅 `resumeInflightExtractions` 续跑传 `steal:true`**——单实例重启时「在抽取中」的 doc，其锁必属已死进程，安全夺取；fencing（fence+1）+ `runExtraction` 幂等清写防僵尸双写。
- **常态触发不 steal**：保 T1#1 活并发互斥原语不破（审核方 #8/#243 双证常态 SKIP）。

## GATE-B · 收口本会话亲历的根因

- **根因**：`gates` 别名此前 = `pnpm --filter @platform/contracts build … pnpm --filter datacore build`——**只构建 2/4 包**（contracts+datacore），frontend/agentcore 从不 tsc → 类型红本地全漏（本会话即由此放过 `sseScripts.ts:34` tsc-red，靠 `pnpm -r build` 才抓出）。
- **修**：别名链首改 `pnpm -r build`（4 包拓扑序）+ 删冗余 mid `--filter datacore build`。
- **审核方确认**：`package.json:48` 现以 `pnpm -r build` 起头（4 包）；该机制本会话已被独立验证有效（正是它抓出 sseScripts tsc-red）。本地 `pnpm gates` 现复现前端 tsc-red，CI/本地一致。

## 门 / 回归（审核方亲跑）

- 真 PG `execlock-pg` **8/8**；`ruledocs` **7/7**（含 #220 #243 续跑）。
- 对抗撤回 steal → #8 红 → 还原复绿。
- `pnpm -r build` 全 4 包绿；datacore **786** / frontend **289**（本会话亲跑·与 dev 声称一致）。
- PG 实例已 `pg_ctl stop -m fast` 收尾、data dir 清除、repo 树净。

## 诚实边界（dev 已标·审核方确认）

1. **steal 仅安全于单实例重启**：续跑 steal 的前提是「持锁进程已死」。**真多实例并发双跑**（两活实例抢同 doc）不在本单——dev 诚实标注「需 job 队列另立单」。本单不破单实例互斥，不解决多实例编排。
2. **端到端续跑实拍为内存仓储**（ruledocs #243）；**锁层 steal 为真 PG**（execlock #8）。二者各自证半，组合成立（resume 路径走 withLock(steal)→PG tryAcquire(steal)，#8 已证 PG 侧）。真 PG 全链端到端续跑实拍可作 belt-and-suspenders 后续增量（非阻断）。

## 本体引用与影响

- **执行语义**（§ 执行锁/续跑）：`withLock(steal)` 续跑语义回写——崩溃实例遗留未过期租约的安全接管路径。
- **不变量**：R6（确定性·fence 单调）不破；锁互斥原语（常态 acquire）不破。
- **断点**：T5-RESUME-LEASE（P0-LOCK 衍生交互 bug）闭；GATE-B（本地门 2/4 包漏构建）闭。
- **Maven 对标 §1 环 D（生产/多实例韧性）**：单实例重启韧性补齐；真多实例编排仍为后续。

---
*审核方独立核发（design+review·真 PG live-fire + 对抗式撤回为据·非 dev 实装）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入提交物*
