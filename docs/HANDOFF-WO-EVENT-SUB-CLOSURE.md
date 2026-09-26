# HANDOFF · WO-EVENT-SUB-CLOSURE（2026-08-20）

分支：`claude/handoff-wo-event-sub-closure`（自 `claude/verify-reclaim-6` 尖 9945e77c 开出，`check-branch-base HEAD` RC=0）。
提交单元：① `bcce8dc3` sim.checkpoint_saved 接线 · ② `d258bdfd` 事件门判据 · ⑦ `3becb42d` 本体回写 · 本报告（末个提交）。

---

## ① 四个断点逐条交付

### G-SIM-EVENT-NOSUB → 🟢 6/6 全接（本单闭最后一条）

复核现状（报告素材）：`sim.*` 真 emit = **7 处 / 6 个事件名**（`app.ts` 1819 起，事件名是 `outbox.emit` 第二实参）。本单之前 5 条已接（WO-SANDBOX-A10 一条 + WO-L4B 三条 + WO-SIM-PERTURB-TIMELINE 一条），**唯 `sim.checkpoint_saved` 记在 `SIM_EVENT_GAPS` 缺口台账**。

逐条判定「谁该在乎」：

| 事件 | 消费方判定 | 处置 |
|---|---|---|
| `sim.session_created` | 世界列表多一行（别的标签页） | 已接（WO-L4B），本单不动 |
| `sim.tick_completed` | 当前世界态 + 世界列表（emit 前写 `status`/`curTick`） | 已接（WO-L4B），本单不动 |
| `sim.branched` | 世界列表多一个子世界 | 已接（WO-L4B），本单不动 |
| `sim.scenario_saved` | 方案列表 + 横比矩阵 | 已接（A10），本单不动 |
| `sim.perturbation_created` | 扰动时间轴 + 世界态 | 已接（WO-SIM-PERTURB-TIMELINE），本单不动 |
| `sim.checkpoint_saved` | **存档清单**（`checkpointsQuery`，管别的标签页/用户存的档） | **本单接线** |

checkpoint 这条**没有**硬接——前任在台账里写死了出台账三条件，本单逐条核验均已达成：① 读端路由 `GET /a/v1/sim/sessions/:id/checkpoints`（WO-ENGINE-2 件二，08-13 已开）；② 前端真缓存 `checkpointsQuery`（WO-BEFE-E，`["a","sim-checkpoints",sessionId]`）早已挂载，此前只靠发起方本地失效、跨标签页收不到；③ agentcore `event-subscriptions` 登记（本单补）。三件齐备 ⇒ 接线不是假接线：经 `EVENT_INVALIDATES["sim.checkpoint_saved"] → "sim-checkpoints" 标签 → LABEL_TO_KEYS → ["a","sim-checkpoints"] 前缀失效`，`SIM_EVENT_GAPS` 清空为 `{}`（机制保留，防今后新增 sim.* emit 当天无缓存可接时被硬接）。**emit 侧一行未动**（7 处/6 名），无假订阅、无新 emit。

附带发现（不在本单范围，如实记录）：`POST …/rollback` 删 ticks、写 `curTick` 但**不发任何事件** ⇒ 别的标签页停在陈旧世界态。属「该发没发」新候选，建议另立单。

### G-EVENT-GATE-MEASURES-SUBS-NOT-EMITS → 🟢 判据已闭

门的判据从「量订阅声明 ⊆ §4」改成「**每个真 emit 的事件名，至少一处静态可见订阅方**」，并补对称方向。三处实质变更（详见 §7 `ontology:check` 条）：

1. **可选链盲点修复**：`this.outbox?.emit(` 的 `?` 断掉字面 needle ⇒ 全仓 30 处发射点（connectors/databuilder/solvers 等 8 文件）对门不可见，「真 emit 78」是少报。修复后实测 **100**。金丝雀 `literal(optional-chain)` 钉死该形态。
2. **1c 发射→订阅对账**（新判据本尊）：订阅方 = `event-subscriptions` ∪ `EVENT_INVALIDATES` 键 ∪ B 侧 `/b/v1/internal/invalidate` 前缀 ∪ `SIM_EVENT_GAPS`（有理由的故意不接，记账豁免）。双向棘轮 `NO_SUBSCRIBER_BASELINE` 42 名（建账 35 + `?.` 修正实测 7 名，逐名留证据，是测量工具修正不是新增违规）。口径边界如实写：运行时租户自助注册的 webhook 静态不可见，只走该通道的事件只能落台账。
3. **1d 订阅→发射对账**（对称方向，M2 的 catcher）：每条订阅须有两条真发射通道之一在发（outbox/emitDomainEvent ∪ 任务总线 `events.emit(taskId,…)`），否则 = 死登记。建账 6 名 exact + 2 前缀（`feature`/`prompt`）。

**变异反证（WO 点名要求的两条 + 两条自加，全部现跑）**：

| 变异 | 结果 |
|---|---|
| M1 新增无订阅 emit（`sim.wo_m1_orphan`） | RC=1，**1c 点名该事件**（1b 计数同响） |
| M2a `EVENT_INVALIDATES` 改名 `sim.branchedX` | RC=1，1d 点名 |
| M2b `event-subscriptions` 改名 `sim.branchedY` | RC=1，1d 点名 |
| M3 破坏 1d 抽取器 | RC=1「门自己瞎了」（金丝雀 C5） |

**M2 首跑曾漏报**（RC=0），根因两个：对称方向缺失（故建 1d）＋订阅侧抽取器限定小写形状（改名带大写即被静默跳过，两个方向都看不见）⇒ 两处抽取器放宽为任意字符串键，由对账判红而非抽取器滤掉。另修 1b 措辞：纯计数棘轮打印的「新增的是」实为**字母序尾部**，本单一度被它误导去登记错误的事件名。

存量台账（42 零订阅 + 6 死登记 + 2 死前缀 + §4 未登记 21）由棘轮看着、只降不升；其中 §4 未登记的 3 个净新增（`buildpipeline.updated/reset`、`buildworkflow.step_approved`）本单已回写 §4 压回 21。

### G-CONSOLE-EVIDENCE-STRIPPED → 🟢 已闭（本单复核确认）

剥落跳定位：`apps/frontend-shell/src/views/sim/chainLineMap.ts` 的 `ChainLossPayloadSchema` 未声明 `evidence[]` ⇒ zod 静默 strip（实测 RAW len=26 → PARSED false）。**schema 半已由 WO-R13-ONTOCHAIN-PANEL 补齐**（现 `evidence: z.array(ChainLossEvidenceRowSchema).optional()`，chainLineMap.ts:104），本单属复核确认，零代码改动。绊线已翻向：`sandbox-console.seam.test.tsx` ① 现断言契约必须带 `evidence[]`、fixture 真带 26 条、解析后仍在——红在「证据从响应/屏上消失」，不是「函数缺失」。测试实测结果见 ⑥。

### G-AGENTRUN-NO-AGENT-ATTRIBUTION → 🟡 维持（残余两类为设计事实）

契约+持久化+读端「四处同改」纪律实测仍成立，本单零代码改动：

- 契约 additive 字段（`qos.ts` AgentRunRecordSchema：`agentId`/`agentKey`/`agentVersion`/`attribution`，三态区分「确知无归属」与「旧记录未知」）；
- `migrations/014_agentrun_attribution.sql`（投影列 + `(tenant_id, agent_key, created_at)` 索引，NULL 天然排除旧记录）；
- `persistence/repos.ts:217` 接口 · `memory.ts:205` · `pg.ts:313` 双实现；
- 读端 `GET /b/v1/agents/:id/runs`（两道租户隔离）+ 前端 `AgentsPage` 已收编（WO-BEFE-C）。

残余 (a) 探索路运行按构造无 AgentDefinition、(b) 上线前旧记录归属未知——均为设计事实，诚实位横幅常驻，一个字不许删。测试实测结果见 ⑥。

## ②–⑤ 过程合规

- 分支基线：`check-branch-base.mjs HEAD` RC=0；占位提交 `7700864f` 开工即推。
- 禁改文件零触碰（`views/sim/**`、`ontology-governance.ts`、`rule-scope.ts`、`actions*`、`features.ts`、`seed.ts` 全在 diff 外）；app.ts 仅注释 3+/2-。
- 每次变异用 `cp` 备份复原（不用 `git checkout --`——它曾把本单合法注释改动连同变异体一起抹掉，已重补）。
- 退出码全部 `out=$(cmd 2>&1); rc=$?` 形式捕获。

## ⑥ 接缝测试与门实测（全部本单现跑）

| 验证 | 命令 | 结果 |
|---|---|---|
| 本体门（净树） | `node scripts/check-system-ontology.mjs` | RC=0（emit 100 · 1c 台账 42 · 1d 台账 6+2 · §4 未登记 21=基线） |
| M1/M2a/M2b/M3 变异 | 见 ① 表 | 全部 RC=1 且点名 |
| store 层接缝 | `sim-event-invalidation.seam.test.ts` | **13/13 绿**（44.8s） |
| 效果层接缝 | `sim-event-consumers.seam.test.tsx` | **5/5 绿**（71.8s；首跑 3 红全系负载 780+ 下的 waitFor 超时，复跑全绿，每条断言带前置「没发事件⇒屏上不变」，恒真风险已被前置排除） |
| ③ 证据透传 | `sandbox-console.seam.test.tsx` | **37/37 绿** |
| ④ 归属 | `agent-run-attribution.seam.test.ts` | **11/11 绿** |

**T1 变异反证（红在正确的地方）**：摘掉 `EVENT_INVALIDATES["sim.checkpoint_saved"]` 这一条接线 ⇒
store 层 ⑫ 红在「存档事件到达但存档清单 query 没失效」（`expected false to be true`，④/⑪/⑬ 同红）；
效果层 ⑤ 红在「那一档没出现在屏上」（waitFor 超时，DOM 后果）——**都红在消费方的产出上，不是「函数不存在」**。
复原后门 RC=0、树干净。门的变异反证 M1/M2a/M2b/M3 见 ① 表。

**T2 基线对照**（merge-base `9945e77c`，`/tmp/base-probe`，已 `pnpm install --prefer-offline` + build 两共享包后跑**同一批命令**逐字对比）：

| 命令 | base | HEAD | 差异归因 |
|---|---|---|---|
| ontology 门 | RC=0 · emit **78** · 订阅 58 · 无 1c/1d | RC=0 · emit **100** · 订阅 59 · 1c 台账 42 · 1d 台账 6+2 | 全部来自本单（可选链修复 +22 emit 可见、checkpoint 登记 +1 订阅、两个新对账段） |
| invalidation seam | 11/11 绿 | 13/13 绿 | +2 例 = 本单 ⑫⑬ |
| consumers seam | 4/4 绿 | 5/5 绿 | +1 例 = 本单 ⑤ |
| sandbox-console | 37/37 绿 | 37/37 绿 | 本单没碰，两边同绿 ⇒ 没被我弄红 |
| agent-run-attribution | 11/11 绿 | 11/11 绿 | 同上 |

**T3 金丝雀正反两侧**：1c 三条（C1 必咬孤儿 emit · C2 必不咬+锚陷阱（散文提及先于声明） · C3 前缀订阅）、1d 两条（C4 必咬死订阅 · C5 必不咬任务总线），全部与主逻辑共用 `harvestTopKeys`/`makeSubPredicate`/`computeUncovered`/`harvestTaskBusEmits`/`computeDangling` 本尊；M3 破坏抽取器 ⇒ C5 当场「门自己瞎了」红，证明金丝雀不是装饰品。

**T4 基线方向**：`git diff` 逐行核——既有数字基线只有 `MAX_EMIT_UNREGISTERED=21`，**一字未动**；`NO_SUBSCRIBER_BASELINE`（42 名）与 `DANGLING_*`（6+2）是本单**新建**台账不是抬旧账，其中 42 名 = `outbox?.emit` 抽取器修正后的实测值，7 名新进者逐名列在脚本注释里（测量工具修正的正当记账，非新增违规）。

**T5 交单前三条**：`git status --porcelain` 仅本报告未跟踪（提交后为空）· `check-branch-base HEAD` RC=0 · `check-merge-conflict-markers` RC=0。

## 遗留与下一单候选（如实）

1. `POST …/rollback` 不发事件 ⇒ 跨标签页陈旧（上述）。
2. 1c 台账 42 名 / 1d 台账 6+2 / §4 未登记 21 名的存量清理——棘轮只降不升，接线即删名。
3. 审计建议的 §4 第五列（失效下游标签）上门（`G-ONTO-INVALIDATION-COL-UNGUARDED`）未做，超出本单范围。
4. 发射侧 `EV_SHAPE` 小写限定仍在（emit 一个带大写的名字会被抽取器丢弃）——订阅侧已放宽，发射侧留待需要时同法处理。
