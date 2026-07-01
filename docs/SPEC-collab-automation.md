# SPEC · reviewer↔dev 协同自动化（共享分支 + 工作队列 + 双侧循环）

> 用户要"我写文档→dev 扫描开工→dev 更新→触发我评审"的机器闭环。**诚实边界**：两个 Claude 会话是独立容器，谁也不能直接触发对方的 agent 循环。**能做的**：共享 git 分支 + 机器可读队列 + 各自定时轮询/事件唤醒。**我搭我半边(reviewer 循环)+共享协议/队列/脚本；dev 半边靠你把 §2 提示词粘进 dev 会话并让它循环。**

## §1 协议（状态机 + 队列 + 脚本）
- **单一来源**：`docs/work-queue.json`（机器可读）。**勿手改**——用 `scripts/collab-queue.mjs` 读写（确定性格式·减少 git 冲突）。
- **状态机**：`TODO`(可开工) → `WIP`(dev 建中) → `BUILT`(dev 交付待复验) → `DONE`(审核核发) ／ `BLOCKED`(门红待修·带原因) → 回 `BUILT`。
- **脚本命令**（两侧共用）：
  ```
  node scripts/collab-queue.mjs show          # 看全队列
  node scripts/collab-queue.mjs next-dev      # dev: 下一个该做的(先BLOCKED再TODO·按P0-P3·deps满足)
  node scripts/collab-queue.mjs next-review   # reviewer: 待复验(BUILT)
  node scripts/collab-queue.mjs claim <id> dev / built <id> / done <id> / block <id> <原因>
  ```
- **冲突**：每次改队列前 `git fetch && git rebase`，改后 `commit && push`；push 冲突走 rebase 重试（本会话已验此纪律稳）。claim(WIP) 防两侧抢同一单。

## §2 dev 侧循环（**把这段粘进 dev 会话·并让它 /loop 或自挂 cron 循环**）
```
你是本仓库开发方(dev)。进入协同自动开工循环，直到队列无 TODO/BLOCKED：
1. cd /home/user/complete && git fetch origin claude/vigilant-knuth-b1nmxn && git rebase origin/claude/vigilant-knuth-b1nmxn
2. node scripts/collab-queue.mjs next-dev  → 拿下一个 WO(BUILD 新单/FIX 门红单)。NONE 则本轮结束(等下次唤醒)。
3. node scripts/collab-queue.mjs claim <id> dev；git add docs/work-queue.json && git commit && (fetch/rebase/push)  ← 认领防重复
4. 打开该 WO 的 doc，按 §2 施工、§3 FDE 验收真实现代码。红线：诚实标合成/真实边界·无 mock 冒充真实·build+test 全绿·本体回写·绿测试≠能用(须真 FDE)。
5. node scripts/collab-queue.mjs built <id>；git add -A && git commit(独立·含代码+evidence+队列) && (fetch/rebase/push)
6. 回 2 取下一个。BLOCKED 单会被 next-dev 优先给出(先修)。
只推 claude/vigilant-knuth-b1nmxn·每单独立 commit·模型标识不入提交物。
```
> 触发：dev 会话需自己的循环器（`/loop` 该提示词，或 CronCreate 每 ~20 分钟 fetch+next-dev）。**这一步只有你能在 dev 会话里开**——我够不到它。

## §3 reviewer 侧循环（**我已挂 cron·我这半边自动了**）
我的会话已 `CronCreate` 一个复验循环（每 ~30 分钟·my-session 内存态·7 天自动过期）：
```
fetch+rebase → next-review 列 BUILT → 逐个真跑复验(git show + build + test + 代码评审 + 诚实/不变量 + 本体回写)
→ 绿+诚实: done <id> + REQ-LEDGER 标 ✅已核发 ；门红: block <id> <精确原因+file:line>
→ push(队列+ledger+closure)。无 BUILT 静默不打扰。全 DONE 告知你收工。
红线：门红不核发·绝不合并坏代码·绝不 force-push 覆盖 dev。
```

## §4 安全 / 终止
- reviewer cron **只读验证 + 只改文档(队列/台账/closure)**，**从不改代码、不 force-push、不合并**。门红=标 BLOCKED 退回 dev，不放行坏代码。
- 终止：队列全 DONE → 我告知收工。随时停：你说停 / 我 `CronDelete`。cron 7 天自动过期。

## §5 局限（诚实）
- **不是纯机器闭环**：dev 半边的触发只有你能在 dev 会话开（§2）。我搭了 reviewer 半边(§3) + 共享协议/队列/脚本(§1)。
- 两侧都靠**轮询**(cron)，非即时事件。想更快见 §6。

## §6 可选升级：PR + webhook 事件驱动（更快·需你点头）
开一个 PR → 两会话各 `subscribe_pr_activity` → 一侧 push 即 webhook 唤醒另一侧（近实时·省轮询）。代价：需建 PR + 两侧订阅。要的话我建 PR 并订阅我这侧。

## 本体引用与影响
- 不改代码/本体接线；新增治理制品 `work-queue.json`+`collab-queue.mjs`+本 SPEC。协同产出仍走各 WO 的本体回写。
- 关联：REQ-LEDGER(需求台账·状态权威) ↔ work-queue(施工队列·流转权威)——前者对"用户真目标闭没闭"，后者对"WO 建到哪步"。

---
*审核方协同自动化设计+搭建(reviewer 半边已挂 cron·dev 半边提示词待你注入)· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
