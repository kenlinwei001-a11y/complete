# 审核方设计 · WO-T5 steal 的根因解 + #8/#10 复验核发

> 用户问「WO-T5 steal 的问题怎么解决？」+ 派 #8(SopBalance 徽章)/#10(scene-agent-config 门) 复验。
> 本体引用：§85 执行锁/续跑语义 · §1 执行锁(租约/fence/心跳) · 不变量 R6(确定性) · 断点 G-3/G-9。

---

## 一 · WO-T5 steal 的根因解（怎么彻底解决"steal vs 多实例 mutex"张力）

### 问题复述

dev 现行 `steal-on-resume`：续跑时**无条件夺锁**（去掉 `WHERE lease_until<now()`）。单实例安全（resume 仅启动时跑→持锁进程必已死），但**多实例不安全**：两个活实例都可能误判对方已死而互夺锁→**双跑**。dev 已诚实标"真多实例需 job 队列另立单"。

### 根因（真因不是"缺 steal"，是"租约过长"）

`execlock.ts:27` `rule_extraction: 30*60_000*2` = **60min 租约**；`:178` 心跳间隔 `leaseMs/3` = **20min**。
**系统早已有自动心跳**（`withLock` 持锁期间每 leaseMs/3 续租；execlock-pg #2/#6 实证 heartbeat 真前移 lease_until）。问题是**租约定得过长**：死掉的进程留下的租约要 60min 才过期 → 续跑被挡 60min → 才被迫加 steal 绕过。**steal 是"租约过长"的创可贴，不是根因解。**

### 根因解：短租约 + 既有心跳（让 steal 变得不必要）

把"持锁者是否已死"的判定，从"无条件夺锁猜它死了"换成**"租约新鲜度（心跳）自证"**——这是分布式锁的标准 lease+fencing 范式：

1. **缩短 `rule_extraction` 租约**：60min → **~120s**（心跳间隔随之 ~40s）。
2. **活持锁者**：每 ~40s 心跳续租 → 租约恒新鲜 → 他实例常态 `acquire` 命中 `lease_until>now()` 必 SKIP → **跨实例互斥真成立（无需 steal）**。
3. **死持锁者**：心跳停 → 租约 ~120s 后过期 → 续跑/竞争者**常态 acquire**（非 steal）即可重夺。
4. **续跑**：启动 resume 扫 EXTRACTING，走**常态 acquire**——进程重启本身耗数秒，死租约多半已过期 → 立即夺得；最坏等 ~120s（非 60min）。**steal 不再需要。**

### 为何对多实例正确（steal 不正确而它正确）

- 没有任何实例绕过租约检查 → **没有实例能夺走活持锁者的锁** → 双跑不可能。
- 死活判定 = 租约新鲜度（心跳驱动），不靠"我猜你死了"。fence+1 仍每次 acquire 递增（防慢死进程的僵尸写）。

### 代价与安全边界

- **代价**：崩溃 doc 最坏等 ~租约 TTL（~120s）才被 resume 重新捡起（vs steal 的即时）。远优于 60min；且 doc 本就要等进程重启。
- **安全裕度**：租约须 > 最坏事件循环停顿（心跳间的同步活）。LLM 抽取是异步 I/O（不阻塞 loop）；唯一同步风险是巨型 zod parse（秒级）。120s 租约 >> 任何可信停顿；保守可取 180s。

### 可选优化（既要多实例正确、又要单实例即时续跑）

若单实例快重启的"即时续跑"体验也要保（不等 ~120s）：**保留 steal，但用显式 `EXECUTION_SINGLETON` 配置开关守它**（默认 true=单实例 docker；多实例部署置 false）。
- `true`：resume 走 steal（即时·安全因单实例）。
- `false`：resume 靠租约过期（等 ~TTL·安全因多实例）。
把"持锁者必已死"的假设从**隐式**（藏在代码注释）变**显式**（配置 + 启动校验），杜绝多实例误开 steal。

### 推荐落地（新单 WO-T5-LEASE-HEARTBEAT·P2）

1. `DEFAULT_LEASE_MS.rule_extraction` 60min → ~120s（连带其它长租约 kind 评估：connection_sync/replay/bundle_import 同理可短，但各自评估最坏单步时长）。
2. 确认 `withLock` 自动心跳在 LLM 抽取期间真触发（异步 I/O 不阻塞·已具）。
3. `resumeInflightExtractions` 去 `steal:true`（或保留并用 `EXECUTION_SINGLETON` 守）。
4. 测试改：execlock-pg #8 / ruledocs #243 从"steal 夺未过期租约"改为"租约过期后常态 acquire 重夺"（+ 若保 steal：加 singleton-flag 分支两测）。
5. **回写本体 §85**：WO-T5-RESUME-LEASE 叙事由"steal 陈旧锁"升级为"短租约+心跳 liveness（steal 退化为 singleton 可选优化）"。

> **一句话**：steal 不是答案，**短租约 + 已有心跳**才是——它把多实例 mutex 与续跑不卡 60min 这对矛盾**一并消解**，且 less code than job 队列。job 队列是**吞吐分发**的事（要不要多实例并行抽不同 doc），与**锁正确性**正交，本张力无需它。

---

## 二 · #10 WO-SCENE-C/D（scene-agent-config:check 门）· ✅ 核发

| 判据 | 状态 | 审核方独立证据 |
|---|---|---|
| 门存在 + 并入 gates | ✅ | `scripts/check-scene-agent-config.mjs`（3501B）·`package.json:47` + gates 链尾 |
| 门绿（9 入口一致） | ✅ | 真跑：「9 个对话入口配置一致：无 WORKFLOW_ONLY · defaultAgentId 均指向已发布 agent · 工具/规则绑定合法」 |
| 门真咬（防半截上架） | ✅（对抗） | 注入 `scn_plan_audit mode=WORKFLOW_ONLY` → 重建 agentcore → 门红「开放式入口拒答反模式」；还原重建 → 复绿 |

门校验 4 条：①非 WORKFLOW_ONLY ②AGENT_FIRST/ONLY 有 defaultAgentId ③defaultAgentId→出厂注册表存在且 PUBLISHED ④BUILTIN 工具∈注册表 + ruleBindings 合法。**结构性"防半截上架"成立。** Phase C 渐进铺开（新配入口自动受此门校验）合理。诚实边界：规则⊆已发布是跨系统运行期校验（规则在 DataCore），门自标"留审核方 FDE"——诚实划界。

## 三 · #8 WO-DM-tail（SopBalance 兜底簇徽章）· ✅ 核发（结构）

- `SopBalanceView.tsx`：②需求三线 `usingDefaultSegments = !workspace.sopConfig?.segments` → 仅在**真用电池示例兜底时**显 `DataModeBadge(PARTIAL)`「请按本租户实际编辑后运行·勿直接喂 C21」；④财务示例占位显 PARTIAL「勿直接喂 C15/C18 裁决」。
- **诚实精度好**：②徽章**条件化**（配了真 sopConfig 就不显）——不无脑 cry wolf。把"凭空业务示例数喂规则裁决"显式标诚实位，正解 B-MED。
- **诚实边界（dev 已标·审核确认）**：徽章是**前端 props 直挂**（`mode="PARTIAL"` 字面量）——结构正确；**视觉实拍需真前端**（本环境未起前端·按 FDE 纪律标未实拍）。extended 求解器经 QOS answer 渲染不携 solver dataMode（AnswerBlock 深层 render-contract plumbing）属增量、dev 诚实标。

---

## 本体引用与影响

- **§85 执行锁/续跑**：WO-T5 根因解（短租约+心跳）若落地需回写——这是**架构演进建议**，本文为设计、未改码。
- **断点 G-3**（场景入口接地）：#10 门把"入口配置完整"结构性锁死，G-3 再收一格；**G-9**（场景卡发育闭环）#10 门亦相关。
- **不变量 R6**（确定性）：短租约方案不破（心跳/租约是时钟驱动的确定性状态机）；R3（scene 门控）#10 守。

---
*审核方设计 + 复验核发（design+review·#10 对抗真跑/#8 读源结构·WO-T5 为根因设计建议未改码）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入提交物*
