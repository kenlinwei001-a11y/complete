# ROLLOUT · 外部执行内核（dsh）灰度方案与推广/回退判据

> **状态**：待评审 · 全部量化门槛为**初值**（本单首拟，评审落定前不生效）
> **日期**：2026-08-21
> **本单**：`WO-DSH-PROD-READY W7`（**纯文档单**——零代码、零测试、零新增门/棘轮/基线 JSON）
> **基线**：canonical `4a4a0edfa`
> **上游真相源**（位次先于本文，冲突时以上游为准）：
> - `docs/DECISION-dsh-fusion.md` §3 前置 A/B/C + §10（per-agent 激活路径）——「**能不能开**」的闸
> - `docs/PRD-agentcore-dsh-upgrade.md` §6 前置 D（F-1 已销）· §8 三级 flag · §9 分期 kill 条件
> - `apps/agentcore/test/fixtures/dualrun-corpus/RECONCILIATION.md` §3 固有不对称全集
> - W4 故障注入登记 `/tmp/dsh-prod-ready-evidence/w4-fault-injection.md` · W6 PG 边界 `/tmp/dsh-prod-ready-evidence/w6-pg-persistence.md` · W3 前置审计 `/tmp/dsh-prod-ready-evidence/w3-precondition-audit.md`

---

## §0 位次与边界（先答「本文管什么、不管什么」）

- **本文不管「能不能开」**。前置 A/B/C/D 任一未销账 ⇒ 本文全部档位停在 G0，灰度不启动。
  这是闸，不是建议（`DECISION-dsh-fusion.md` §3 原话：「这三条不是『建议』，是闸」）。
- **本文管「开了之后怎么推、怎么看数、怎么退」**。每条判据带四件套：指标名 / 阈值（初值）/ 观察窗口 / 回退动作。
- **主控杠杆 = per-agent `kernel`（DB/config 层），不是进程 env。** WO-AGENT-KERNEL-SELECT 后
  分叉守卫为 `agent.kernel === "EXTERNAL" || (agent.kernel === undefined && process.env.DSH_HARNESS === "1")`
  （`apps/agentcore/src/engine.ts:580`）。灰度全程 `DSH_HARNESS` 部署面保持 `0`/不设（D1 门不变），
  逐个 agent 经 `PUT /b/v1/agents/:id`（`server.ts:797`，`requireCatalogAdmin` 守 `server.ts:799`）置
  `kernel: "EXTERNAL"`（契约 `packages/contracts/src/agentcore.ts:66`，additive optional）。
  env=1 的进程级缺省开在本文任何档位都**不使用**——PRD §8 的 `1`（P3 缺省开）档由 PRD §9 分期表
  另行裁决，不在本灰度面。
- **每次 run 直读配置**：分叉守卫每 run 求值（engine.ts:580），kernel 翻转**下一次 run 即生效**，
  无重启、无重部署。这是「秒级回退」的机制基础。

---

## §1 阻塞性前置 · W9-lite 计费口径翻转（本单存在的理由）

### 事实链（逐环 file:line）

1. **记账点无条件**：`apps/agentcore/src/router/orchestrator.ts:2125` ——
   `void this.deps.llmBudget.record(task.tenantId, (result.run.totalInputTokens ?? 0) + (result.run.totalOutputTokens ?? 0))`，
   注释自陈「这是账本的**唯一真实写入方**」。不分内核，拿到 run 就记。
2. **EXTERNAL 臂现恒 0/0**：dsh 臂 run = `emptyAgentRunRecord`（engine.ts:172-200），
   `totalInputTokens: 0` / `totalOutputTokens: 0` 硬编码（engine.ts:194-195）；token 真账在
   `answer.stats` 回声里（reassemble 纯 fold，见 §6.5 载体 B），不进 run 记录。
3. **0 账连 wire 都不上**：`apps/agentcore/src/ops/llm-budget.ts:71` —— `if (tokens <= 0) return;`
   ⇒ **当前 EXTERNAL run 的 llmBudget 扣减恒为零次调用**（不是记了 0，是根本没记）。
   同 task 走 native 臂正常扣减。这就是「计费逃单」现状的精确形态。
4. **W9-lite 落地即翻转**：W9-lite（审计记录骨架·两态 + tokens 回填）把 `run.totalInput/OutputTokens`
   回填为真值的那一刻，orchestrator.ts:2125 的无条件记账**立即开始真实扣减** EXTERNAL 租户的
   llmBudget——无需任何配置变更，无 feature flag 间隔。**灰度方案必须把这一刻当作已知的
   行为跳变点来设计**，否则「回填 token 账」这件审计修复会顺手变成「租户账单突变」事故。

### 灰度四件（判据均为初值）

| 件 | 内容 |
|---|---|
| **a · 观察指标** | ① `llmBudget.stats.recorded` / `recordFailures`（`llm-budget.ts:82` / `:79,:84`，进程内计数——记账静默失效也是「看起来没事」的一种，该端口注释原话）；② 分租户 token 日账（DataCore `/a/v1/llm-budgets` 读回侧）；③ **同 task 双臂账差**：灰度期对每个新晋 EXTERNAL agent 抽样同 task 双跑（kernel 来回切），比 `answer.stats.tokenUsage` 折出和（pi-ai 口径：cacheRead/uncachedInput/output 分桶，RECONCILIATION §2-A4）对 native `run.total*` 账 |
| **b · 账差合理区间** | 初值：`|dsh臂折出和 − native臂账| / native臂账 ≤ 50%`。方差主源已登记：cache 命中分桶口径差（dsh 侧 prompt_cache_hit_tokens→cacheReadTokens，native 无此概念）+ 提示组装差。出区间不自动等于缺陷，但**必须先解释再放行** |
| **c · 回退开关** | per-agent `kernel` 置回 `"NATIVE"`（或删字段回落 env=0 缺省）——`PUT /b/v1/agents/:id`，下一 run 生效，秒级，零数据迁移（配置真相源从未动，PRD §8 同口径）。**回退不碰 env、不碰部署面**（D1 兼容） |
| **d · 量化门槛** | 记账通路：`recordFailures / (recorded + recordFailures) > 1%`（窗 1h）⇒ 立案查账本通路，**不回退内核**（账本 fail-open 是设计，`llm-budget.ts:14-15` 原话「账本不可用绝不阻断业务」）；账差：出 §1-b 区间且样本 ≥ 20 个双跑 task ⇒ **回退该租户全部 EXTERNAL agent 并立案** |

---

## §2 推广顺序与驻留时间（初值）

| 档 | 范围 | 进入前提 | 驻留初值（两条件**同时**满足才可升档） |
|---|---|---|---|
| **G0** | 全原生（现状） | —— | —— |
| **G1 内部租户** | 我方自有租户，1–2 个低风险 agent 置 `kernel=EXTERNAL` | 前置 A/B/C/D 全销 + §1 观察面就位 | ≥ 3 天 **且** ≥ 200 次 EXTERNAL run |
| **G2 白名单租户** | ≤ 5 个外部租户、每租户 ≤ 2 个 agent | G1 驻留期满 + §3 推广判据全绿 | ≥ 7 天 **且** ≥ 1000 次 EXTERNAL run |
| **G3 全量** | 放开 per-agent kernel 配置权（仍不设 env 缺省开） | G2 驻留期满 + §3 全绿 + W9-lite 账差观察满一档 | 常驻；旧路 `runAgentLoop` 保留至 PRD §9 P4 退役 |

**升档是配置动作，不是部署动作**（§0）；**降档同理**。任一档命中 §3 回退判据 ⇒
回到上一档（或 G0），动作 = kernel 回 NATIVE，不重走部署。

---

## §3 推广判据 / 回退判据（四件套表 · 阈值全为初值）

### 推广判据（升档须**全部**满足）

| # | 指标名 | 阈值（初值） | 观察窗口 | 数据源 |
|---|---|---|---|---|
| P1 | EXTERNAL run `outcome=FAILED` 率 | ≤ native 同期 FAILED 率 **+2pp** | 档内全程，样本 ≥ 100 run | `AgentRunRecord`（`GET /api/v1/queries/:taskId/agent-run` 读回面） |
| P2 | 「dsh 重组装拒绝」FAILED 率（reassemble ok:false，engine.ts:647-658 出口） | ≤ 1% | 24h 滑动 | task 错误文案前缀 `dsh 重组装拒绝：` |
| P3 | 子进程卫生 | 僵尸计数 = **0**；收束时延 P95 ≤ 5s | 档内全程 | `pgrep -f` harness bin 计数（W4 F5 口径）· 收束时延（G1 修复后基线 398ms，留 ~10x 余量） |
| P4 | `agent_degraded` 事件面 | reason 全集 ⊆ {TIMEOUT, BUDGET_EXHAUSTED, STALL_LOOP}；频次 ≤ native 同档 +5pp | 档内全程 | SSE 事件流日志核（§6.3） |
| P5 | 计费账 | §1-b 账差区间内 且 §1-d 记账通路健康 | 档内全程 | §1-a 三指标 |
| P6 | 已知差异白名单外漂移 | **0** 起 | 档内全程 | §5 白名单反向咬 |

### 回退判据（**任一命中即退**，动作除注明外 = 涉事 agent kernel→NATIVE + 立案）

| # | 指标名 | 阈值（初值） | 观察窗口 | 回退动作 |
|---|---|---|---|---|
| R1 | EXTERNAL FAILED 率 | > native +5pp 且样本 ≥ 50 | 1h | 该租户全部 EXTERNAL agent 回 NATIVE |
| R2 | 重组装拒绝率 | > 1% | 1h | 同上 |
| R3 | 子进程卫生 | 僵尸 > 0 **或** 收束 P95 > 30s | 即时 | 全部 EXTERNAL 回 NATIVE（资源面事故，不单点退） |
| R4 | 白名单外事件面/Answer 结构差（A1 面） | 1 起 | 即时 | 同上 |
| R5 | 计费账差 | 出 §1-b 区间且样本 ≥ 20 | 24h | 该租户回 NATIVE + 冻结 W9-lite 推广 |
| R6 | 用户工单聚类（§5 白名单分流后剩余）指向 DSH 臂 | ≥ 3 单 | 24h | 该租户回 NATIVE，工单逐条复核 |

---

## §4 资源与并发约束（灰度期）

**事实（W4 Q3 实证，`w4-fault-injection.md`）**：DSH 分叉 = 每 run 一个 JSON-RPC 子进程，
**无池化、无并发上限**（F7 实证并发×4 ⇒ 4 个相异 pid 同时在跑）；runner/engine 两侧均无
信号量/队列/池。N 租户并发 ⇒ N 个 node 子进程，上限仅靠宿主机；突发扇出（coordinator 多角色×DSH）
有进程风暴面。子进程 crash/hang/zombie 的**收束**已被 F1–F5 + G1 修复钉死（收束三源：
turn/end + 进程死亡 + deadline，缺一即慢失败），有界的是「怎么死」，无界的是「生多少」。

**灰度期建议（FaultRecord 实证结论：上限放调用/部署侧，不在 runner 内建池）**：

| 项 | 初值 | 说明 |
|---|---|---|
| 单 agentcore 实例并发 EXTERNAL 子进程上限 | **≤ 4**（= W4 F7 实证面） | 超出部分在调用侧排队或诚实拒新（不静默）；落地形态（orchestrator 信号量 vs 部署侧副本数×每实例上限）由落地方定，**本文不定实现** |
| 监控点 | 子进程计数（`pgrep -f`）· 单进程 RSS · G1 收束时延 · requestTimeoutMs 120s 缺省命中率（W4 F4①：engine 分叉不传 requestTimeoutMs ⇒ 生产缺省 120s） | 僵尸/RSS 异常 ⇒ §3-R3 |
| 重套件纪律 | dualrun50 全量 **191s 串行**（W5 提交 `76a547cd8` 自陈 73/73 绿）；战役实测机器负载 159+ 时基建红（n0 实证负载尖峰 191→977，`/tmp/dsh-n0-evidence/shard4-rerun-load.txt`） | CI/灰度环境跑重套件**必须串行、禁并发重画像**；4 核机重套件并发上限 = 1（既有纪律，灰度期延伸到任何「双跑对账」类重负载核验） |

---

## §5 灰度期已知差异白名单（用户工单分流表）

以下四条是**已裁决/已登记**的语义 delta。工单命中 ⇒ 归白名单存档、不计 §3-R6、不触发回退；
不命中 ⇒ 按 R6 计。分流表随新裁决扩，**不许凭口头扩**（每条必须能指出登记处）。

| # | 差异 | 登记处 | 分流口径 |
|---|---|---|---|
| W-1 | **B5 并行到达序**：并行工具调用按网络到达序各自 tryConsume，序不确定（dualrun 只声明串行预算场景） | W8/W9 立项架构评审登记（team-lead 2026-08-21 归因订正）。⚠ 文件锚待 **W8主 落线回填（REC §3 语义 delta 登记）**（W8主 在途），引用须连带本说明 | 「并行工具调用到达序不一致」类工单 ⇒ 白名单；排序之外的**内容**差不许借本条目放行 |
| W-2 | **watchdog post-execute 计数差 1**：第 cap 次调用**已执行后**才中断（native 在 dispatch 前拦，第 cap 次不执行）⇒ 工具执行数差 1；事件面/轮次/outcome 不受影响 | `packages/dsh-harness/plugins/platform-watchdog.mjs:79-81` 自陈 · `w3-precondition-audit.md:74` 登记 | 「环检测时多执行了一次工具」类 ⇒ 白名单 |
| W-3 | **纯空 stop 缝**（RECONCILIATION §3 #8）：provider 病态零内容 stop ⇒ native 兜底软收尾 ANSWERED / dsh pi-ai 判 EMPTY_RESPONSE 诚实 FAILED | team-lead 2026-08-20 判词：缝观察、设计取向差、不判缺陷、不动码 | 「同问句 native 答了 dsh  FAILED」且现场为字面零内容 stop ⇒ 白名单；L2/L6 真跳证据翻案通道保留 |
| W-4 | **length 截断取向差**（RECONCILIATION §3 #9）：native stopReason≠tool_use 一律软收尾（loop.ts:1027）/ dsh BUDGET_EXHAUSTED + 诚实摘要头 + run.budgetExhausted=true | team-lead 2026-08-21 判词：native 不修（换心不换身/半残机制/仓主级产品裁决） | 「dsh 报预算耗尽 native 不报」且 finish_reason=length ⇒ 白名单 |

附带登记（同源，防误报）：watchdog cap 解析失败时 native=拒 boot / dsh=静默禁用
（`platform-watchdog.mjs:52-54` 自陈，`w3-precondition-audit.md:74` 登记）——出货态由
`check-deploy-governance` 门守住正整数，该差在生产不可达；**灰度期不许手工塞非整数 cap 来「测试」**。

---

## §6 观测面边界与诚实登记（灰度期按此读数据，不许读超）

### 6.1 SDK filter-throw 形态（w4-verifier 注）

`@deepseek-ai/dsh-sdk-client` 的订阅 filter 谓词抛错时：`lib/index.js:197-213` ——
**只杀本订阅**（`unsubscribe()` + `fail(error)`，抛出的错误成为该订阅的终止错误），
**不扰兄弟订阅、不扰 transport 读循环**（实现注释原话，镜像 Python client 语义）。
灰度含义：runner 侧任何过滤谓词的 bug，表现形态 = **该订阅终止性失败（task FAILED）**，
不是挂起、不是全链路崩。工单按此分流：FAILED 且死因落在订阅谓词 ⇒ 先查谓词，不先怀疑 harness。

### 6.2 PG 边界（W6 登记，`w6-pg-persistence.md`）

- DSH 路**全部**持久化写入在外壳、与内核选择无关：`agentRuns.insert` ×4
  （orchestrator.ts:2121 / :2420 / :2682 + engine.ts:887 扇出）、`events.append` 经同一 emit 通道
  （events.ts:14）、`tasks.patch` answer ×3（:2163-2168 / :2421-2427 / :2683-2688）。
  分叉块内零写库，子进程零写库。
- `run.kernel` PG 侧**无投影列**、JSONB 透明（pg.ts:285 `JSON.stringify(rec)` 整记录进 `record` 列，
  migrations 001/013/014 可证无 kernel 列）⇒ kernel 字段不存在 PG 特有分歧面。
- **EXTERNAL run 零 `toolCalls` 行**（loop.ts:731/767/804、executor.ts:620 均为原生 loop 专属）
  = 双臂**预期差**，不是缺陷；PG 核验时按预期差记账。
- **前瞻注记（W9 后翻新）**：W9（lite/full）落地后 DSH 臂审计记录不再恒空壳——
  **toolCalls 不再恒零**、run.total* 回填（§1 同步翻转）。本条边界声明届时同批重写，
  灰度文档读者不许把「恒零」当成永久不变量引用。
- 真 PG 运行时等价性**未验**（本机无 docker daemon）：补验脚本
  `/tmp/dsh-prod-ready-evidence/w6-pg-verify.sh`（Tier A/B/C 诚实门）待有 docker 的环境实跑——
  **G2 升 G3 前建议先补验**（出货 compose 本身支持 PG + DSH 同开，`docker-compose.yml` postgres-b）。

### 6.3 degraded 事件面 parity = 码对称论证，非双跑实证

`agent_degraded` 的三处发射点 orchestrator.ts:2182 / :2433 / :2694 全部在**分叉之后**的共享码
（`if (result.degraded) emit(...)`，三处同构），且 `agentLoopRepeat` 计量两 fork 互斥不双计
（engine.ts:666 对位 loop.ts:641）。⇒ parity 论证是**结构性**的：双臂过同一段发射码，
不是「双跑各发一次再对拍」。**灰度期核验手段 = 日志核**：按 taskId 查 SSE 帧序——
agent_degraded 恰一条、早于 answer.final、reason 原值（`dsh-degraded-seams.test.ts` A1–A5 口径）。
发现「两条 degraded」或「degraded 晚于 answer.final」⇒ 直接命中 §3-R4，没有灰区。

### 6.4 expectsSchema + BUDGET_EXHAUSTED 组合路无摘要头 = 明示边界

reassemble.ts:412-420：expectsSchema 分支校验通过后**提前 return**——outcome=BUDGET_EXHAUSTED 时
带 `degraded{BUDGET_EXHAUSTED}`（:418），但 answer 是占位文案
（`lastAssistantText || "（结构化回答见 structured）"`，:415），**不带诚实摘要头**。
摘要头只加在非 expectsSchema 路（:458-466 max-tokens 头块；stall 路自带模板 :370-390 提前 return
不叠双头）。代码内已自陈「expectsSchema 分支同有 BUDGET_EXHAUSTED 可能（:417），其 answer 是
占位文案，不在本修复面」（:453-456）。⇒ 屏上该组合呈现 = 占位文案无截断警告头，**登记为明示边界**；
工单命中归白名单（同 §5 分流），要修另立 WO。

### 6.5 B11 双计审计结论账（token 观测双载体 · 消费方分列）

| 载体 | 生产 | 消费方（本单 grep 实证） |
|---|---|---|
| **A · `run.totalInputTokens` / `totalOutputTokens`** | native：`loop.ts:577-578`（finishRun 累计）；EXTERNAL：现恒 0/0（engine.ts:194-195），W9-lite 后转真值 | ① `llmBudget.record`（orchestrator.ts:2125，账本唯一真实写入方）· ② `skill-probe.ts:290`（probeTokenCost）· ③ `evals.ts:238`（tokenCost） |
| **B · `answer.stats`（additive 回声键）** | reassemble.ts:394 `foldDshRunStats` 纯 fold → :419/:475 挂载 → engine.ts:687 并入 answer（交叉类型 additive 键；orchestrator:2187 answer.final 整对象直发自动带上） | 前端 `components/QueryDock/Timeline.tsx:54`（`selectTurnStats(state.answer.stats)` 轮次统计条） |

**禁令（灰度期有效）**：**禁新增「两处都读再相加」的消费方。** 载体 A 对 EXTERNAL 恒零期间，
相加 = 单计（侥幸无害）；W9-lite 回填瞬间，同一批 token 在两个载体同时为真，相加 = **双计**。
W9 验收判据应含「两载体同源等值」断言，但**等值也不许相加**——消费方按上表各读各的。

> **W9-lite 落地注记（2026-08-21）**：载体 A 回填已落线（engine.ts DSH 出口后置补丁，
> run.total* = fold tokenUsage 的 uncachedInput/output 两桶；零 usage 帧 ⇒ 维持 0/0 诚实缺省），
> 计费翻转按 §1 生效（orchestrator.ts:2125 无条件记账自此对 EXTERNAL 真扣减，无 flag 间隔）。
> 消费方本单 grep 复核与上表逐条相符：载体 A = orchestrator:2125 / skill-probe:290 / evals:238
> / AgentsPage 展示（:428/:557 只读）；载体 B = Timeline.tsx:54 唯一。**无「两处都读再相加」**。
> 同源等值断言已入 dualrun50 A4 dsh 臂锚（run.total* === stats 对应桶，逐任务机器核）。

---

## §7 裁决史（每条目的出处，留给复验 Agent）

| 本文条目 | 出处裁决 / 登记 |
|---|---|
| §1 计费翻转四件 | W9-lite 阻塞性前置（team-lead W7 派单，2026-08-21）；事实链 file:line 本单 grep 复核 |
| §2 三档推广 + 驻留 | 本单首拟（初值）；PRD §8 三级 flag / §9 分期为上位框架 |
| §3 判据门槛数值 | 本单首拟（全部初值，待评审落定） |
| §4 并发上限放调用/部署侧 | **W4 Q3** FaultRecord 实证结论（2026-08-20/21，`w4-fault-injection.md`） |
| §4 重套件串行 / 负载 159 基建红 | dualrun50 负载敏感性观察（战役台账；n0 实测负载证据 `/tmp/dsh-n0-evidence/shard4-rerun-load.txt`  corroborate；W5 `76a547cd8` 191s 串行自陈） |
| §5 W-2 / cap 解析差 | **W3** 前置审计登记（`w3-precondition-audit.md:74`） |
| §5 W-3 / W-4 | **W2 批1 / 批3** 裁决（team-lead 2026-08-20 / 2026-08-21，RECONCILIATION §3 #8/#9） |
| §5 W-1（B5 并行到达序） | **W8主（在途）**——并行工具调用按网络到达序各自 tryConsume、序不确定（dualrun 只声明串行预算场景）；W8/W9 立项架构评审登记，文件锚待 W8主 落线回填（REC §3 语义 delta 登记），引用须连带本说明（team-lead 2026-08-21 归因订正：与 W5 块4 无关） |
| §6.1 filter-throw | **w4-verifier** SDK 注；本单复核 `dsh-sdk-client/lib/index.js:197-213` |
| §6.2 PG 边界 | **W6** 边界登记（2026-08-19，`w6-pg-persistence.md` Q2/Q4） |
| §6.3 degraded 码对称 | **W5 块4** 方向 + RECONCILIATION §3 #7（orchestrator 三发射点，`886c436a7` 静默缝×2 修复落线）；本单复核 :2182/:2433/:2694 同构 |
| §6.4 expectsSchema 无头边界 | W2 批3 dsh 自体修复②的明示边界面（reassemble.ts:453-456 自陈） |
| §6.5 双载体账 | **B10/B11 双计审计**（战役台账）+ 本单 grep 实证分列消费方 |

---

## §8 本文**没有**做什么（不许把没做的读成做了）

- ❌ 没有定任何实现——并发上限的落地形态（信号量 vs 副本控制）留给落地方，本文只给判据。
- ❌ 没有改任何代码 / 测试 / 门 / 棘轮 / 基线 JSON（纯文档单）。
- ❌ 没有把初值门槛当裁决——§2/§3 全部数值标「初值」，评审落定前不生效。
- ❌ 没有宣布 PG 运行时等价性已验（W6 遗留，`w6-pg-verify.sh` 未实跑）。
- ❌ 没有给 W-1（B5 并行到达序）造文件锚——它现在是台账登记，锚落线前引用它必须连带本说明。
- ❌ 没有重述/替代前置 A/B/C/D——那些是闸，在 DECISION/PRD，本文一个字不放宽。
