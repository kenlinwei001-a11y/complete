# 审核方复验核发 · WO-P0-LOCK 闭合 + 新撞出 T5 续跑-租约阻断（真 PG 16 端到端）

> dev 报 WO-P0-LOCK 完成（7bc4b70），并按施工单边界「一并扫同类潜伏 P0」。审核方起**真 PostgreSQL 16** 独立复验（含对抗还原 + 门咬合 + 端到端 + T5 续跑实拍）。
> **结论**：**WO-P0-LOCK 核发闭合 ✅**（airtight）；但借此终于跑通的 **T5 重启续跑实拍撞出新 bug：续跑被死锁租约阻断 ❌**（T5+锁交互，非 P0 本身）。

## §1 WO-P0-LOCK — ✅ 核发闭合（独立真 PG 复验·对抗坐实）

| 验项 | 审核方独立真跑 | 结果 |
|---|---|---|
| 修法对规格 | `pg.ts` `PgExecutionLockStore.super()` 补 `extraColumns{resource_kind,resource_key,holder_id,lease_until}`——**含 lease_until**（我标的第二潜伏 bug：续租须改列非仅 doc） | ✅ 逐字对规格 |
| 真 PG 集成测 | `DATABASE_URL_TEST` 真 PG 跑 `execlock-pg.integration.test.ts` | ✅ **7/7 passed**（含"heartbeat 真前移 lease_until 列"） |
| **对抗·还原修复** | 临时把 `super()` 还原成无 extraColumns → 重跑集成测 | ✅ **6/7 failed**·错文逐字 `null value in column "resource_kind"`（=P0 原文）；门 `repo-pg-notnull:check` 同步**变红**（`[resource_kind, holder_id, lease_until] 未覆盖`）→ 证修复与门**真咬合**、非空测 |
| 端到端（原 P0 复现） | 真 PG datacore `POST /a/v1/rule-docs`(3 规则·真 Kimi) | ✅ EXTRACTING ~130s → **IN_REVIEW · candidateCount=3 · extractError=none**（修前必瞬崩 PARTIAL·0 候选） |
| 同类潜伏扫除 | `merge_candidates`/`object_merges`（`data` 列·无 `doc`/`updated_at`）→ 新 `PgDataColStore` | ✅ 真 PG put→get→list 不崩（集成测用例 7 通过·且对抗还原 execlock 时它仍过=独立修） |
| 防复发门 | `repo-pg-notnull:check`（扫 migration NOT-NULL-无默认列 vs 仓储写入列集）并入 gates | ✅ 绿（83 通用写入表/92 表）·逻辑真（对抗时正确变红） |
| 构建底线 | `pnpm -r build`(全4包) | ✅ 绿 |

**核发**：P0-LOCK **闭合**。修法是根因解（extraColumns 全 NOT-NULL 列 + lease_until 修第二 bug）、对抗坐实真咬合、同类扫除是真独立 P0、防复发门结构性可用。**dev 这单做得扎实**（含主动扫同类 + 立门，正中施工单边界）。

## §2 新发现 — T5 重启续跑被死锁租约阻断（❌·真 PG 实拍坐实）

P0 修好后，审核方终于能跑施工单 FDE 判据②「杀进程→重启→续跑实拍」（此前被 P0 阻断）。**结果：续跑触发了但没真续上。**

- **真跑（真 PG）**：POST rule-doc → EXTRACTING 中（~15s·Kimi 在算）**杀 datacore** → PG 里 doc 干净 `EXTRACTING`、0 候选、锁 `fence=1`（原进程持有）。
- **重启** → 启动日志 `"resumed":1·重启遗留 EXTRACTING 文档已重新触发`——**续跑确实 fire 了**。但轮询 **240s+ 仍 EXTRACTING**，候选 0，锁 **fence 恒=1**。
- **根因（逐位坐实）**：被杀进程持有的锁租约 **60min**（`rule_extraction` lease = 30×60000×2 ms）。重启 ~15s 后续跑 → `withLock`→`acquire`→`ON CONFLICT … WHERE lease_until < now()`——**租约还剩 ~54min·未过期 → acquire SKIPPED**（fence 不变）→ 续跑空跑、doc 卡 EXTRACTING 最长 60min。**`"已重新触发"` 日志误导**（实际 skip 了·无 skipped 可见性）。
- **对照证伪（铁证）**：手动把该锁 `lease_until` 改成已过期 → 重启 → 续跑 → **fence 1→2（这次 acquire 成功夺锁）→ 跑到 IN_REVIEW·3 候选**。**即：续跑机制本身对（夺锁+跑+收敛全 OK），唯独真崩溃留下的 60min 租约挡住它。**

### 性质 / 影响
- **不是 P0-LOCK 的回归**——P0 修对了（抽取真能用）。这是 **T5(436e96d)+锁(99e7538) 的交互 bug**，被"P0 修好后才能跑的重启续跑测"首次暴露（典型「绿测试≠能用」：续跑单测没在"持锁未过期"前提下真崩溃重启）。
- **后果**：进程崩在抽取中途 → 该 doc 卡 EXTRACTING 最长 60min；且续跑只在**启动时**跑一次（重启即 skip），无后续重试 → 实际需"租约过期后再来一次重启"才续上 →「restart-safe resume」名不副实。

### 修向（dev·建议①）
1. **①（根因解）续跑前清陈旧租约**：`resumeInflightExtractions` 对每个遗留 `EXTRACTING` doc，**先强制过期/夺取其锁**再 fireExtraction——理由：**新进程启动时，任何"在抽取中" doc 的锁必属已死进程**（同进程不可能跨重启还在抽取），故该租约一定是陈旧的，可安全 steal（fencing 已防僵尸写）。
2. ② 或 `withLock` 给续跑路径传 `steal/force` 选项（绕未过期租约·仅续跑用）。
3. ③ 兜底：缩短 `rule_extraction` 租约 + 心跳频率（治标·崩溃窗口仍存）。
- **FDE 判据**：真 PG 杀 datacore 抽取中→**立即重启**→doc **≤一个抽取周期内**续到 IN_REVIEW（无需手动过期租约）、候选幂等不重复、fence 递增（证真夺锁）。

## §3 交接

- **WO-P0-LOCK**：闭合，无需 dev 再动。
- **新单 WO-T5-RESUME-LEASE**（P1·见 DEV-TODO/派发表）：续跑清陈旧租约。修后审核方复验「杀→立即重启→续到 IN_REVIEW」。
- **本体回写**：T5 续跑语义应注明"续跑须 steal 陈旧锁"（执行语义章节）。

---
*审核方独立真 PG 16 端到端复验（集成测 7/7 + 对抗还原 6/7 红 + 门咬合 + 端到端 IN_REVIEW + 续跑租约证伪）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
