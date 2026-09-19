# handoff 并线台账（单一真值 · 机器可校验）

> **这张表存在的理由 = 一次真实误判**：审核方凭记忆向仓主报告「四条 handoff 分支全未并线」，
> 实测其中三条**早已并进 canonical**——cherry-pick 换了 commit hash，分支的 ahead/behind 因此
> 永远非零，**从分支状态根本判断不出它并没并**。于是「并了没有」这个事实没有任何机器可读的
> 载体，只能靠人肉记忆与口头中转：错报、漏并、重复并线都不会触发任何告警。
>
> 从此并线状态**只以本表为准**。`scripts/check-handoff-integration.mjs` 逐条比对分支引入的文件
> 与 canonical 现状，时效窗（默认 21 天）内任何非 INTEGRATED 的分支**必须在本表有明确处置**，
> 否则门红。写「已并线」必须给并线提交号；写「挂起 / 已驳回」必须写理由。

## 状态取值

| 状态 | 含义 | 必填 |
|---|---|---|
| `已并线` | 内容已进 canonical（cherry-pick 或等价实现） | 并线提交号 |
| `已驳回` | 经复验判定不并线 | 驳回理由 + 最小修路径或替代方案 |
| `挂起` | 暂不处理（等上游 / 等裁决 / 等依赖） | 挂起原因 + 解挂条件 |

## ⚠ 头号缺陷 · 测试并线缺口（首次台账化即检出）

首次运行本门即检出一个比「漏并分支」严重得多的系统性缺陷：**实现进了正线、咬住它的测试没进**。
canonical 缺失的 68 个 handoff 新增文件里 **27 个是测试**（去重 21 个，含 7 个 SEAM 测试）。
已坐实抽查：`domainResolveMulti` / `selectDeterministicMultiRoute` 的**实现**都在 canonical，
而 `deterministic-multi-domain-seam.test.ts` **不在**——CI 从此跑的是一个**缺牙的测试集**，
这批功能的回归不会被任何门抓住。这是「绿测试 ≠ 能用」的制度化版本：绿的是残缺集合。

统一由 **WO-TESTGAP-BACKFILL** 处置（逐个测试文件判定：补并 / 已被等价测试取代 / 确应丢弃并写明理由）。
在它闭合前，相关分支一律标「挂起」，**不许标「已并线」**——本门对「标已并线但测试仍缺」直接判红。

## ⚠ 第二个头号缺陷 · CI 从未真正运行过

台账门促成的 PR 化让 CI 状态第一次被真正查看，随即发现：`gates` workflow **自建立起从未跑过一个测试**。

```
Error: Multiple versions of pnpm specified:
  - version 9 in the GitHub Action config with the key "version"
  - version pnpm@10.33.0 in the package.json with the key "packageManager"
```

workflow 钉 pnpm 9，`package.json` 的 `packageManager` 是 10.33.0 → `pnpm/action-setup@v4` 拒绝启动，
每次 run 在 **8 秒内**死于 setup。**五包测试与 `pnpm gates` 在 CI 里一次都没执行过** ——
所有"CI 会拦住"的假设都不成立，`gates` 是装饰品。已在 `WO-INTEGRATION-LOOP` 修（去掉 `version:`，
版本单一来源 = `packageManager`）。

**门上线首日即真抓一例**：`wo-66-rules-p1p2` 在审核方本地校验通过之后才推上来，CI 随即判红并点名「PENDING 但台账无登记」。本地绿 / CI 红的差异不是门不稳，恰是门在按设计工作——**并线状态的真值在远端分支集合，不在任何一个人的工作副本里**。这也是本门必须跑在 CI 而非只在本地跑的理由。

**同一教训的第三种形态**（`gate.sh` 逐包点名）：GitHub Actions 设 `CI=true` → vitest 强开彩色输出，
汇总行变成 `Tests \e[22m \e[1m\e[31m16 failed`，而点名正则要求 "Tests" 与数字间只有空格 →
CI 上恒匹配 0 行，误报「有包被静默跳过」。本地用 `$(...)` 捕获时无 TTY、不着色，故一直正常。
**同一个坑三种形态**：Node 版本（`--permission`）、构建产物不同步（陈旧 dist）、输出格式（ANSI 着色）——
都是"本地绿只代表本地绿"。已改为匹配前先剥 ANSI 码（比设 `NO_COLOR` 稳：不依赖下游是否尊重该变量）。

值得记的是这条门**失败的方式是对的**：它明确说「RC=0 不算通过」而拒绝判绿，而不是因为解析不到就
默认放行。防假绿设计在自己出错时仍然保守 —— 门宁可误红，不可误绿。

**教训**：门存在 ≠ 门在跑。本仓「绿测试≠能用」的下一层是「**门≠在执行**」——
从此 CI 状态必须经 PR 呈现出来被人看见，这正是本 LOOP 要解决的。

## ⚠ 第三个头号缺陷 · canonical 的测试套件本来就不绿（最低支持版本上功能是死的）

CI 第一次真正跑完测试套件（pnpm 修复之后），立刻红在三条：

```
test/a18-sandbox.test.ts:47            node: bad option: --permission
test/grounding-hook.test.ts:54         expected 'UNREGISTERED' to be 'PROVISIONAL'
test/grounding-vocab-grow.test.ts:53   expected 'UNREGISTERED' to be 'PROVISIONAL'
❌ 未通过：TEST (五包·串行) —— 不得并线
```

**一个根因**：`apps/datacore/src/solvers/sandbox.ts` 把 Node 权限模型开关写死成 `--permission`，
而该开关名随版本变过 —— Node 20 只有 `--experimental-permission`。CLAUDE.md 声明支持 **Node ≥20**，
于是在声明支持的最低版本上，沙箱子进程直接以 `bad option` 启动失败：**生成式求解器整条路径是死的**，
连带依赖它的 DF.8 / DF.11 接地链永远停在 `UNREGISTERED`（到不了 `PROVISIONAL`）。

**为什么长期无人发现**：开发机跑 Node 22（本地 14/14 全绿），而 CI 从未真正执行过测试。
两个盲区叠加，缺陷得以在正线上存活至今。「五包全绿是交付底线」这句话**从未在干净环境里被验证过**。

**教训**：本仓「绿测试 ≠ 能用」的第三层是「**绿只代表在你那台机器上绿**」。
本地全绿是关于开发机的陈述，不是关于软件的陈述。

**已修**（`WO-INTEGRATION-LOOP`）：改为运行时探测实际可用的开关，而非按版本号猜边界（版本边界本身
就是这次踩坑的来源）；两个开关都不可用时 **fail-closed 拒绝执行** —— 这里跑的是 LLM 生成的不可信
代码，没有权限模型就没有沙箱，静默降级等于静默开洞。并新增 `runtime-portability` 矩阵 job
（Node 20 × 22 复跑沙箱与接地测试），让"在 A 版本绿在 B 版本红"不可能再静默发生。

## 台账

| branch | 状态 | 说明 |
|---|---|---|
| `claude/handoff-gate-ledger` | 已并线 | 并线提交 `5d96a1e3`（cherry-pick 自 `a212e100`，无冲突）。**它红在 CI 上的那几天，红的正是本门**——我复验通过后既没并线也没登账，于是 PENDING 无登记判红，PR #4 的 `integration-ledger` job 卡在这一条。这恰是本表存在的理由：复验结论只活在我记忆里，机器读不到。内容：门账 `gate-ledger.json`（40 门普查·`gate-census.mjs`）+ `check-gate-ledger.mjs` + `check-ontology-writeback.mjs` 追加 G3 反向断言（§7 宣称「已并入 pnpm gates」而现算零调用方 → `LIE_DEAD` 判红）。复验证据：A6 红在判据③ · A7 红在判据① · A8 的 G3 反向断言抓出声明与现实相反的门；判据③ 现算非快照。零测试文件 → 无测试并线缺口。 |
| `claude/handoff-wo-unitprice-scale` | 已并线 | 并线提交 `58629f99`（cherry-pick 自 `68285bbc`，无冲突）。**解挂条件已逐条兑现**（2026-08-04）：① 隔离 worktree 取 canonical 现状 cherry-pick，五包 gate 全绿（datacore 1205→1207，5/5 包点名，`GATE_RC=0`）；② 亲手驱动 `gap_attribution` 确认兜底不再触发——SEAM 测数字**现算非快照**（`Order.unitPrice` 量加权均值 18471 元/套 × portfolio 反解 `avgUnitPrice` 1.8000 万元/套，rel=0.0255）；③ **审核方自己的变异反证**（不采信 dev 自述）：把 `num(o.unitPrice)` 改回 `num(o.unitPrice, 600)` → 真红 `base:hefei 不得因缺价单被静默兜底出非 0 份额: expected 0.0686 to be +0`，还原即绿 → 门有牙。**该单诚实上报了一个它未修的邻接缺陷**（超其范围）：`service.ts` provenance 标 `drillField:"value"` 却回 `orderVal`（万元），而 `Order.value` 是元，差 1e4 → 已另立 #96，不并入本单静默扩范围。原登记（保留备查）：**未复验·本门首次抓到的漏登条目**。独有 1 个 commit `68285bbc`「订单单价口径取证与修正」：禁 `solvers/service.ts` `gap_attribution` 的**静默兜底 600 元/套**（WO-SCALE-COHERENCE 当年消灭的病灶值残留）+ 两处口径显式标注，并带接缝测试 `apps/datacore/test/unitprice-scale.test.ts`（数据半 battery 种子 元/套 × 引擎半 portfolio 万元/套，任一半被「对齐」或兜底改回业务数即红）。**属「静默错答」族，优先级高于一般测试缺口。**解挂条件：审核方隔离复验（五包 gate + 亲手驱动 `gap_attribution` 确认兜底真的不再触发）→ 通过即 cherry-pick 上正线并改标「已并线」+ 提交号。 |
| `claude/handoff-wo-63-schema-readability` | 挂起 | 本体可读性达标。五包 gate 全绿、`pnpm gates` 绿。等 PR 复验后并线——新 LOOP 的第一条走通用例。 |
| `claude/handoff-wo-integration-loop` | 挂起 | 本 LOOP 基础设施自身（并线台账门 + CI 改跑 gate.sh + 部署主干收口）。随 PR 复验并线。 |
| `claude/handoff-wo-scenario-input-phase0` | 挂起 | 主体已并线（`d2f7c356` + `8cca14b0`）；未并 delta `5c9e8537` 放宽了 modelId 断言。解挂条件：`toContain("4680")` 判别力不足（`4680-LFP` 亦过）须收紧，且 `slots.ts:277` `objectId ?? key` 的 A/B 契约静默兜底要么修要么登记为断点。 |
| `claude/handoff-wo-det-cross-domain` | 挂起 | 实现已并线（`domainResolveMulti`/`selectDeterministicMultiRoute` 在 canonical），**但 `deterministic-multi-domain-seam.test.ts` 未并** → 测试并线缺口首例。归 WO-TESTGAP-BACKFILL。 |
| `claude/handoff-wo-multi-intent-p1` | 挂起 | ⑤ 多意图判定半已并线（内容并入 `multi-route.ts` 的 `selectMultiIntent`，故独立文件 `multi-intent.ts` 缺失属组织方式差异、非内容缺失）；`multi-intent-seam.test.ts` 未并 → 归 WO-TESTGAP-BACKFILL。 |
| `claude/handoff-wo-qos-cross-domain-unified-graw0b` | 挂起 | L1 跨域统一已并线（`routeSource`/`SOLVER_DEP_GRAPH`/`selectMultiIntent` 均在 canonical `multi-route.ts`）；缺的 `multi-intent.ts` 同上属组织差异；`deterministic-multi-domain-seam.test.ts` 未并 → 归 WO-TESTGAP-BACKFILL。 |
| `claude/handoff-wo-multiintent-l2` | 挂起 | L2 真分解已并线（`l2-decompose.ts` 在 canonical）；同上两个文件差异 → 归 WO-TESTGAP-BACKFILL。 |
| `claude/handoff-wo-multiintent-l3` | 挂起 | L3 耦合联合求解已并线（`l3-coupled.ts` + datacore 守恒测试均在 canonical）；同上两个文件差异 → 归 WO-TESTGAP-BACKFILL。 |
| `claude/handoff-wo-69-ontology-primitives` | 挂起 | 其它 dev 在做（07-31），缺 `column-security.test.ts`。等其 PR 复验，勿抢并。 |
| `claude/handoff-wo-69-p2-function-signature` | 挂起 | 同上（07-31），缺 5 件含 `ontology-signature.ts` 与 seam 测试。等其 PR。 |
| `claude/handoff-wo-69-p3-interface` | 挂起 | 同上（07-31），缺 9 件含 migration `028_object_interfaces.sql`。等其 PR。**注意 datacore `028` 为三方撞号**（本分支 / `sandbox-action-propagation` / `wo-66-rules-p1p2`），并线前必须重编号。 |
| `claude/handoff-wo-capacity-100pct` | 已并线 | 并线提交 `15e1937c`（+ 后续收编）。**原登记「缺 datacore + frontend 两个 capacity-page-100pct 测试」已实测证伪**——canonical **两个测试文件都在**（datacore 侧与分支字节相同；frontend 侧不同是因为被更强机制取代，见下）。这正是本表要治的病：cherry-pick 换 hash 后，凭 ahead/behind 与记忆都判不出并没并。**实测判据（2026-08-04·隔离 worktree 取 canonical 现状）**：三个 commit 逐个 cherry-pick，`b74767d1` 与 canonical `15e1937c` 同一 patch；`a352eb32`、`d52def35` 应用后**净变更为空**（冲突处逐一核为「canonical 更新」而非「分支有货」）。三处冲突取 HEAD 的理由逐条可核：① `RiskBoardView` 的 `scope?.factorApplied` — canonical 就地 cast `ga`，语义同，且分支写法会绑到 726 行那个无关的 `scope:{baseId}`；② `risk.ts` — canonical 多出 `adoptedMitigationIndex`（WO-ADOPT-MITIGATION 后出）；③ `risk.ts` 排序契约注释 — canonical 已写着「别再退回去」，正是本单那条修的落档。**测试并线缺口 = 0**：分支 10 例 vs canonical 7 例，差的 3 例咬的是 `tensionDotColor`/`plateauNote`，二者在 canonical **已 0 个 src 引用**（被 `dotVisual` 同档 alpha ⊕ 柱高双通道**严格超集**取代，`plateauNote` 因 `saturateTension` 消除平顶而成永不触发的死代码）；对应断言已迁至 `risk-honest-gray-and-daily.test.tsx:170/205`（含反向红咬「恒定值行不许被伪造成起伏」）——**是取代不是丢失，已逐条亲验**。 |
| `claude/handoff-wo-66-rules-first-class` | 挂起 | 其它 dev（07-30），缺 `docs/rule-threshold-ledger.md`。等其 PR。 |
| `claude/handoff-diag-100q` | 已驳回 | 缺失件全是**临时诊断产物**（`scratchpad/diag100.pid`、`diag100-results.json`、`diag100.py` 及一次性诊断报告 md）。运行时产物与一次性报告不入正线；结论若有价值应沉淀为门或测试，而非把 pid 文件并进仓库。 |
| `claude/handoff-causal-deepchain` | 挂起 | 缺 `causal-deepchain.test.ts` → 测试并线缺口，归 WO-TESTGAP-BACKFILL 复验（实现是否已在正线待逐条确认）。 |
| `claude/handoff-geo-real-signal` | 挂起 | 缺 `geo-real-signal.test.ts` → 同上。 |
| `claude/handoff-metric-aware-gap` | 挂起 | 缺 `gap-attribution-metric-aware.test.ts` → 同上。metric-aware 是本仓反复炸过的接缝，此测试缺失风险最高，优先复验。 |
| `claude/handoff-metric-aware-seam` | 挂起 | 缺 `metric-aware-composition.test.ts` + 一份完成报告 md → 同上，与上一条合并处置。 |
| `claude/handoff-plankpi-mq` | 挂起 | 缺 `plankpi-month-quarter.test.ts` → 同上。 |
| `claude/handoff-tier2-semantic-discover-v2` | 挂起 | 缺 `tier2-bc-route.test.ts` → 同上。 |
| `claude/handoff-wo-0-nl-wiring` | 挂起 | 缺 `qos-nl-wiring-seam.test.ts` → 同上（SEAM 测试）。 |
| `claude/handoff-wo-e2e-dialogue-acceptance` | 挂起 | 缺 `e2e-dialogue-acceptance.test.ts` → 同上（端到端验收）。 |
| `claude/handoff-wo-gray-node-autofill` | 挂起 | 缺 `gray-node-autofill-seam.test.tsx` → 同上（SEAM 测试）。 |
| `claude/handoff-sandbox-action-propagation` | 挂起 | 缺 migration `028_sim_action_propagation_rule.sql` + `sim-action-propagation.test.ts`。**迁移号 028 三方撞车**（`wo-69-p3-interface` / 本分支 / `wo-66-rules-p1p2`），并线前必须重编号——由 WO-INTEGRATION-AUDIT（#9）处置。 |
| `claude/handoff-ontology-context` | 挂起 | 缺 4 件含 `router/ontology-context.ts`、`contracts/ontology-context.ts` 等**实现**文件。需复验：是被等价实现取代（canonical 已有 `type-semantics` 路由）还是真漏并 → WO-INTEGRATION-AUDIT。 |
| `claude/handoff-ceo6` | 挂起 | 缺 `apps/agentcore/src/agent/ceo.ts`（实现文件）。需复验是否被 `ceo-route.ts` 等价取代 → WO-INTEGRATION-AUDIT。 |
| `claude/handoff-wo-aip-cap0` | 挂起 | 缺 11 件（`plan-builder/compiler.ts`、migration、前后端测试）。**迁移号 `010` 与 canonical 已占用的 `010_multi_intent_plan.sql` 实撞（非潜在风险）**，并线前必须重编号。整块特性未并线，规模最大 → WO-INTEGRATION-AUDIT（Issue #9）单独定性。 |
| `claude/handoff-wo-66-rules-p1p2` | 挂起 | **本门上线首日真抓的第一条**：该分支在审核方本地跑完台账后才推上来，本地绿 / CI 红的差异本身即证据——旧机制下它会静默躺数周。缺 `028_solver_rule_bindings.sql`、`solvers/rule-params.ts`、`rules-first-class-seam.test.ts`。**其 `028` 使 datacore 028 变成三方撞号**（见下）。解挂条件：等其 PR 复验；SEAM 测试归 WO-TESTGAP-BACKFILL（#8），迁移重编号归 WO-INTEGRATION-AUDIT（#9）。<br>**2026-08-04 审核方实测退单 → 请在当前 canonical 上 rebase 后重交**：隔离 worktree 取 canonical 现状 cherry-pick `7b92660a` **失败**，`merge-base 73c558f8` 距 canonical 已 **100 个 commit**，16 处冲突落在本单**正要改语义的那几个文件**——`solvers/service.ts`（本单 +237 行·4 处冲突）· `solvers/extended.ts`（+160·4 处）· `synthetic/battery.ts`（+120·3 处）· `contracts/datacore.ts`（1 处）· `package.json` 门链（1 处）· 本体（3 处）。**不由审核方代解**：每处该取 HEAD 还是取分支，取决于本单的设计意图（谁是「阈值唯一入口」的权威），代解等于我替作者做语义决策，正是静默漂移的入口。<br>⚠ **rebase 时必须逐条比对 canonical 已独立长出的同区能力**（否则会把更旧的设计重新盖回来）：`SOLVER_RULE_REFS`（5 文件）· `no-hardcoded-rules:check`（已在 19 门链上）· `ruleParams`（3 文件）**canonical 均已有**；本单**真正尚缺**的只有 `readRuleParam`（0 命中）· `solvers/rule-params.ts`（新文件）· `solver_rule_bindings`（0 命中，含 migration）——请按「补齐这三样」而非「整单重放」来重交。<br>⚠ **勿回退刚并线的 `58629f99`**：`service.ts` 的 `orderVal` 已改为**禁止静默兜底**（`num(o.unitPrice)`，无 600 兜底），本次实测该行落在冲突区之外侥幸未被覆盖；rebase 后请确认 `apps/datacore/test/unitprice-scale.test.ts` 仍绿。<br>📌 `028` 撞号已定性=**卫生问题非阻断**（`repo/pg.ts:560-568` 按完整文件名记账 + 三份均幂等 DDL），并线时改 `029/030` 即可，不必为此挡单。 |
| `claude/handoff-qos-live-evidence` | 已驳回 | 缺失件是一份一次性验收记录 `docs/acceptance-log-qos-live-10q.md`。验收记录属过程产物，不入正线；其结论已由 QOS 相关 SEAM 测试承载。 |
| `claude/handoff-wo-scenario-forced-extract` | 已并线 | 并线提交 `57dd0141`（cherry-pick `a6508ce7`）。**含测试**：`scenario-forced-extract.seam.test.ts` 与实现同批并入，不属测试并线缺口。修的是 `orchestrator.ts` forced 分支 `extracted` 恒 `{}` —— `fillSlots` 内建「extracted > presetSlots」优先级，等于解析器被传空参：前端卡输入框/CLI/对话坞直打 `/api/v1/queries` 时自由文本被吞，「常州基地能不能接」与「能不能接」同答案（都是全网合计）。复验：四包 build RC=0；SEAM 绿；**变异反证**先证 `tsc --noEmit` RC=0（红不是编译失败），再把 `extracted` 改回 `{}` → 如期红（`expected null to be 'changzhou'`）。SEAM 是效果层断言（两问句 P50 24.2 vs 74.7 真不同 + 控制了 modelId/demandDelta 同值排除他因），非「参数到达了」的运输层。 |

## 已核验可删分支（删除前登记 · 分支消失后本表即唯一凭据）

> 删除远端分支不可逆。本节在删除**之前**登记每条的 tip sha 与核验结论——
> 分支没了，sha 还在（GitHub 侧对象保留期内可 `git fetch origin <sha>` 取回），
> 且内容本就已在 canonical（这正是判可删的理由）。
>
> **判据（勿用简化版）**：文件集取 `merge-base..tip` **整支**，不是 `git show --name-only <tip>`（那只是最后一个 commit）。
> 实测 `handoff-wo-skill-3` 三个 commit：tip 碰 15 个文件、整支碰 22 个 —— 简化版会漏比 7 个文件。
> 本仓今日真实踩过同一形态：一条 handoff 三个 commit 只 cherry-pick 了两个，第三个（`d52def35`）从未被看到。

| 分支 | tip sha | 核验结论 |
|---|---|---|
| `claude/handoff-wo-scenario-forced-extract` | `a6508ce7` | 逐文件核毕：整支新增行全部落在 canonical，或被**更强的单源实现取代**（详见下） |
| `claude/handoff-wo-1-skill-probe` | `2935a32f` | 逐文件核毕：整支新增行全部落在 canonical，或被**更强的单源实现取代**（详见下） |
| `claude/handoff-wo-skill-3` | `efaa3479` | 逐文件核毕：整支新增行全部落在 canonical，或被**更强的单源实现取代**（详见下） |
| `claude/handoff-ceo2v2-data2-seam` | `e99f23c3` | 台账门判 INTEGRATED（`merge-base..tip` 全部文件内容与 canonical 一致） |
| `claude/handoff-ceo6-fe` | `0b23aebf` | 台账门判 INTEGRATED（`merge-base..tip` 全部文件内容与 canonical 一致） |
| `claude/handoff-metric-aware-integrated` | `4e4b4331` | 台账门判 INTEGRATED（`merge-base..tip` 全部文件内容与 canonical 一致） |
| `claude/handoff-scale-coherence` | `aeb823ba` | 台账门判 INTEGRATED（`merge-base..tip` 全部文件内容与 canonical 一致） |
| `claude/handoff-wip` | `0897fc9c` | 台账门判 INTEGRATED（`merge-base..tip` 全部文件内容与 canonical 一致） |
| `claude/handoff-wo-caplive-atom` | `9a1b5cea` | 台账门判 INTEGRATED（`merge-base..tip` 全部文件内容与 canonical 一致） |
| `claude/handoff-wo-caplive-cockpit` | `337270d1` | 台账门判 INTEGRATED（`merge-base..tip` 全部文件内容与 canonical 一致） |
| `claude/handoff-wo-gslive-cockpit` | `af9637bd` | 台账门判 INTEGRATED（`merge-base..tip` 全部文件内容与 canonical 一致） |
| `claude/handoff-wo-live-nl` | `6ce50f61` | 台账门判 INTEGRATED（`merge-base..tip` 全部文件内容与 canonical 一致） |
| `claude/handoff-wo-portfolio-fg-inventory` | `a93100ae` | 台账门判 INTEGRATED（`merge-base..tip` 全部文件内容与 canonical 一致） |
| `claude/handoff-wo-risk-perfactor-series` | `cc5b6bd6` | 台账门判 INTEGRATED（`merge-base..tip` 全部文件内容与 canonical 一致） |
| `claude/handoff-wo-s02-regression` | `91b11d8e` | 台账门判 INTEGRATED（`merge-base..tip` 全部文件内容与 canonical 一致） |

**取代关系（缺行≠丢失，逐条）**：

- `VALID_REF_KINDS`/`VALID_REF_ROLES` 本地硬编码词表 → 提进 `packages/contracts` `SKILL_REFERENCE_KINDS`/`SKILL_REFERENCE_ROLES` 单源（假绿第 6 例的修复）
- `sideEffect === "WRITE_BACK" || "EXTERNAL_ACTION"` → `isWriteEffectSkill()`；`sideEffect === "WRITE" || approvalGate` → `isWriteModeSkill()`（判定单源在 contracts）
- `packages/contracts` 里的内联 `z.enum([...])` → 引用上述常量（schema 与词表同源）
- `checkSkillDependencyClosure`（原在 `server.ts`）→ 迁入 `skill-lint.ts`，由 `skill-lint.test.ts` 守
- twin 差分 / `behaviorGain` → 在 `skill-probe.ts`（`ensureTwinAgent`/`runCase`），`skill-probe.test.ts` 10 处断言守
- `SkillProbeRunner`/`runSkillProbe` → 在 `evals.ts`，`server.ts` 路由已挂

**冻结（一条都不许删）**：持有 canonical 里不存在的测试文件的 17 条分支 —— 见 WO-TESTGAP-BACKFILL。
删它们等于销毁那 15 个测试的唯一副本，把「暂时缺牙」变成「永久缺牙」。
