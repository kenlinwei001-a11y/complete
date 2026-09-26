# 测试并线缺口 · 逐文件定性（WO-TESTGAP-BACKFILL 定性阶段 · 欠账 #73）

> **本文件是定性产物，不是执行产物**：只做「补并 / 已被等价测试取代 / 确应丢弃」的判定与举证，
> 不改任何 `src/`、`test/`、`scripts/`。执行按本文的优先级另开 WO。
>
> **产出纪律**：本轮**未跑任何测试、未跑任何 gate**（范围边界）。所有判定基于
> ①`node scripts/check-handoff-integration.mjs --json` 的机器清单 ②逐文件读原文
> ③对 canonical **已提交 ref**（`origin/claude/inspiring-gates-aqczjg`）做符号追链。
> 凡「实现在不在」的结论，都追到了**调用点或声明点的 file:line**，不以 grep 命中数收工（铁律 0.5）。

- canonical：`origin/claude/inspiring-gates-aqczjg` @ `d4be4224`
- 缺失测试文件：**20 个**（去重后；分布在 18 条 `claude/handoff-*` 分支）
- 判定日期：2026-08-04

---

## ⚠️ 头号发现 · 台账那句「实现进了正线、咬住它的测试没进」**只对 4/20 成立**

`docs/HANDOFF-LEDGER.md` 的头号缺陷段把这 20 个文件整体描述为「实现并了线、测试没并」。
逐个追链后，**这个前提对其中 15 个文件不成立**：它们咬的实现在 canonical **零命中**，
即**整单（实现 + 测试）都没并**。

误判的来源是台账门自身的信号语义：门把「分支引入的文件」分成 `missing`（canonical 缺）与
`differing`（canonical 有但内容不同）。`differing` 被默认读成「实现在，只是 canonical 又演进了」——
**但对一条落后 canonical 400+ commit 的老分支，`differing` 的真实含义是「canonical 那个文件是更新的版本，
里面根本没有本分支的新增内容」**。举证：

| 分支 | merge-base 距 canonical | 台账原判 | 实测 |
|---|---:|---|---|
| `wo-det-cross-domain` | — | 实现已并线 | ✅ 属实（`domainResolveMulti` 在 `apps/agentcore/src/router/domain-resolver.ts:263`，7 个 src 文件引用） |
| `metric-aware-gap` | **432** | 缺测试 | ❌ 实现也没并（`boundMetricKeys` 在 canonical **零写入方**） |
| `causal-deepchain` | **413** | 缺测试 | ❌ 实现也没并（`cf-oee-deficit` 全仓 0 命中） |
| `geo-real-signal` | **413** | 缺测试 | ❌ 实现也没并 |
| `plankpi-mq` | **413** | 缺测试 | ❌ 实现也没并 |
| `sandbox-action-propagation` | **413** | 缺测试 + migration | ❌ 实现也没并 |
| `wo-0-nl-wiring` | **235** | 缺 SEAM 测试 | ❌ 实现也没并（`deterministic:classifier-failsafe` 0 命中） |
| `wo-gray-node-autofill` | **223** | 缺 SEAM 测试 | ❌ 前端实现也没并 |
| `wo-aip-cap0` | **195** | 整块未并（台账已正确判） | ✅ 台账此条判对 |
| `wo-69-*`（3 条） | **111** | 「等其 PR」 | ❌ 实现也没并 |
| `wo-63-schema-readability` | **102** | 「等 PR 复验」 | ❌ 实现也没并 |
| `wo-66-rules-p1p2` | **102** | 已退单 rebase | ✅ 台账此条判对 |

**这条误判本身就是铁律 0.5 的第五次复发**：拿门的 `differing/missing` 二分当结论，
没追一层「这个符号在 canonical 到底有没有」。修正后的含义完全不同——
**这 15 个不是「补一个测试文件」的活，是「整单要不要并」的裁决**，工作量与决策层级都不一样。

> **对台账的建议改法**（本 WO 不改台账，留给 WO-INTEGRATION-AUDIT）：
> 头号缺陷段应从「实现进了正线、测试没进（27→21 个）」改为
> 「**4 个是真·测试并线缺口；15 个是整单未并被误分类为测试缺口；1 个是纯测试 WO 的交付物丢失**」。
> 门本身也该加一条：判 `PENDING` 时，对缺失测试文件里的**顶层 import 符号**做 canonical 存在性探测，
> 直接把「测试缺口」与「整单未并」分成两个信号——否则这个误分类会再犯。

---

## 总表

| 定性 | 数量 | 文件 |
|---|---:|---|
| **补并** | **1** | `e2e-dialogue-acceptance.test.ts` |
| **已被等价测试取代**（均残留少量断言，见各条） | **4** | `deterministic-multi-domain-seam.test.ts` · `tier2-bc-route.test.ts` · `metric-aware-composition.test.ts` · `multi-intent-seam.test.ts` |
| **确应丢弃**（原文件不可用） | **0** 独立 + **2** 含在上一类 | `tier2-bc-route.test.ts`（含**与现语义冲突**的断言）· `multi-intent-seam.test.ts`（import 的模块已重构消失） |
| **⚠ 不属本 WO · 整单未并** | **15** | 见 §3 |

另有 **4 条「实现在 canonical、零测试覆盖」的残留断言**，不需要整文件补并，
只需以补丁形式加进现有取代者——它们才是本 WO 真正能立刻兑现的价值（见 §4 优先级）。

---

## 1 · 判「补并」

### 1.1 `apps/agentcore/test/e2e-dialogue-acceptance.test.ts` 【P0】

**分支**：`claude/handoff-wo-e2e-dialogue-acceptance` · 402 行 · 7 个 describe

**为什么是最干净的一例**：该分支的**唯一** `differing` 文件是 `docs/SYSTEM-ONTOLOGY.md`，
**零产品代码改动**——它是一张**纯测试 WO**。而且：

> **canonical 里躺着这张 WO 的工单文档 `docs/wo/WO-E2E-DIALOGUE-ACCEPTANCE.md`，
> 文档第 5 行白纸黑字写着「🚦 文件边界：`apps/agentcore/test/e2e-dialogue-acceptance.test.ts`（新）」，
> 并称它是「**所有对话 WO（WO-0/HARNESS/CLASSIFIER-PROMPT/REFLECT/DRIL-P\*）的头号复验判据**」——
> 工单进了正线，工单的唯一交付物没进。**

**咬的链路**（本体 §3 QOS 编排链，蓝图 `docs/BLUEPRINT-DRIL-decision-dialogue.md` §4 接缝表 S1~S7）：
真问句 → ①分类器→router(S1) → ②开放落 DRIL(S2/S3) → ③agent 调 solver(S4) → ④缺数据自动补(S5) → ⑦结构化接地输出(S7)。

**符号可用性**（逐个追到声明点，全部在 canonical）：

| 测试用到 | canonical 声明点 |
|---|---|
| `projectNavigationSlice` / `renderNavigationSlice` / `navigationSliceSolverKeys` | `apps/agentcore/src/agent/navigation-slice.ts:283 / :358 / :389` |
| `buildGrowthLoopWiring` | `apps/agentcore/src/growth/scenario-grow.ts:34` |
| `questionSlug` | `apps/agentcore/src/growth/scaffold.ts:12` |
| `lastToolCallId` / `PLANNER` / `PKG` / `createTestApp({env})` | `apps/agentcore/test/helpers.ts:119 / :20 / :18 / :35`（`opts.env` 于 `:37`） |
| `POST /api/v1/growth/probe` · `/api/v1/growth/run` | 已有 canonical 测试在打（`growth-probe.test.ts:57`） |

**独有价值 = S4/S7 效果层断言（canonical 今天零覆盖）**：

- `e2e-dialogue-acceptance.test.ts:256-269`：断言**产出的 final_answer** 真含 结论/证据/建议/风险 四段
  ＋ `⟦ref:N⟧` ＋ `trustLevel === "AGENT_EXPLORATORY"`。
- canonical 现有的 `apps/agentcore/test/harness-elements.test.ts:45` 只断言 **prompt 模板字符串**含
  `["结果结构","结论","关键分析","证据","建议","风险"]` —— 那是**运输层**（我们给模型下了指令），
  不是**效果层**（模型的产物真长这样）。这正是本仓「绿测试≠能用」的典型形态。

**其余 5 个 describe 与 canonical 重复**（补并会引入重复，但不构成阻断，且重复的是端到端串跑而非单点）：

| e2e 文件段 | canonical 已覆盖者 |
|---|---|
| `:156-179` S1/S2 无 LLM 诚实降级（2 例） | `apps/agentcore/test/no-llm-degradation-seam.test.ts:15` / `:28`（**逐条同义**） |
| `:186-217` S2/S3 navigation-slice R6 + 异 scope 有牙 | `apps/agentcore/test/qos-agent-slice-seam.test.ts:119` / `:127` / `:141` / `:156` |
| `:290-359` S5 growth 四例 | `growth-probe.test.ts:45`/`:57` · `growth-autofill-seam.test.ts:28`/`:99`/`:115` |
| `:367-375` S6 reflect | 本身就是 `describe.skip` 骨架 |
| `:383-400` S7 答案结构骨架 | 各 path-A 测试已覆盖 |

**已知需修的 1 处**：`:18` `import { questionSlug }` 在文件正文中**未被使用**（全文仅 1 次命中 = import 行本身）。
补并时删掉这行 import。

**诚实标注（我没做的事）**：我**没有运行**这个文件。它的 merge-base 距 canonical 235 个 commit，
S1 的两条路由断言（`:134` `deterministic:ceo-route` + `:135` `ceo_root_cause`）落在
canonical 后来收窄过的路由语义区（见 §2.2 的 `tier2-semantic-route` 变更），**有非零概率需要按现语义微调**。
补并的 dev 必须先跑一遍再定，不许照搬本文当"已验证"。

---

## 2 · 判「已被等价测试取代」

### 2.1 `apps/agentcore/test/deterministic-multi-domain-seam.test.ts` — 取代者严格更强

**分支**：`wo-det-cross-domain`（另 3 条分支带同名文件的更新版 blob `53b5701a`；`wo-det-cross-domain` 是旧版 `5ddc2540`）

**取代者**：`apps/agentcore/test/qos-cross-domain-seam.test.ts`（canonical，257 行，18 例）

**这是 20 个里唯一「实现真的并了、测试真的没并」的原型例**——但测试其实**也**并了，只是换了文件名和更强的版本：

| 缺失文件的用例 | 取代者 file:line + 用例名 | 是否不弱于 |
|---|---|---|
| `:25` R6 字节一致·风控员例枚举三域 | `qos-cross-domain-seam.test.ts:36`「R6：同问句同 PageContext → domainResolveMulti 字节一致·风控员例枚举出 [finance_pnl, atp_check, yield_diagnosis]」 | **相同**（含同一个 `sel!.length===3`） |
| `:36` 无 PageContext → perDomainScore=0 → null | — **无取代者** | ❌ **弱了**（见下） |
| `:42` open/orchestration 压到阈下 → 整体回落 null | `:80`「诚实边界：任一域被 open/orchestration 压到阈下 → 整体回落 null」 | 相同 |
| `:49` 单域族 <2 → null | `:85`「单域族 → <2 → null（只对≥2 独立域启用·不劫持单域）」 | 相同 |
| `:53` R13 耦合诚实标 + 装配 | `:89`「装配诚实标：检出耦合对 → 顶部标「独立测算·未链式传导·见 L3」…」 | 更强（`provenance.length` 断言改为 `routes.length` 动态值） |
| `:78` SEAM-1 flag 开·并行 solver·各 ⟦ref⟧ | `:169`「SEAM-1（风控员独立多域）…并行 3 solver·各 ⟦ref⟧·agentRequests=0」 | 相同 |
| `:102` SEAM-2 根治证（flag 关落 LLM / 开确定性接住） | `:184`「SEAM-2（根治证）…」 | **逐行相同** |
| `:128` SEAM-4 耦合诚实标 | `:236`「SEAM-4（耦合诚实）…」 | 相同 |
| `:141` SEAM-5 零回归 | `:249`「SEAM-6（零回归·含 Coordinator）…」 | 更强（多控了 Coordinator） |

取代者另有 **9 条缺失文件没有的**：Q2 扩域覆盖(`:47`)、Q2 耦合链(`:64`)、槽可填硬门剔除(`:69`)、
Coordinator 降级(`:104`)、`selectMultiIntent` 纯函数(`:112`)、SEAM-Q2 治 300s(`:127`)、SEAM-Q2 对照(`:155`)、SEAM-3 ⑤兜底(`:208`)。

**残留 1 条（严格讲「弱了」）**：`domainResolveMulti(q, undefined)` → `perDomainScore` 全 0 → 判定 null
（"不冒进·上游照落单域/LLM"）。canonical 全部 9 次 `domainResolveMulti(` 调用都传了 `riskPc()`
（`qos-cross-domain-seam.test.ts:37,38,48,61,65,71,82,86,90`），**`pageContext === undefined` 分支零覆盖**。
该分支实现在 `apps/agentcore/src/router/domain-resolver.ts:274-280`（`contextRich` 计算）。

**处置**：不补并原文件；把这 4 行加进 `qos-cross-domain-seam.test.ts` 的纯函数 describe（§4 优先级 P3）。

---

### 2.2 `apps/agentcore/test/tier2-bc-route.test.ts` — 取代者更强，**且原文件含一条与现语义冲突的断言 → 原文件确应丢弃**

**分支**：`tier2-semantic-discover-v2` · 52 行 · 7 例

**取代者**：`apps/agentcore/test/tier2-semantic-route.test.ts`（canonical，68 行，6 例）+ 4 个旁证文件

| 缺失文件的断言 | 取代者 | 结论 |
|---|---|---|
| `:13` 信用逾期 → `credit_exposure` | `tier2-semantic-route.test.ts:20`「信用/逾期/敞口 → credit_exposure（不被 gap_attribution 缺省吞）」 | 取代 |
| `:14` `args.custName === "长安"`（args 从问句派生） | `apps/agentcore/test/arg-drop-seam.test.ts:39` `expect(route.args.custName).toBe("电网公司")` | 取代（同一机制，换了客户名） |
| **`:20` `resolveCeoRoute("毛利为什么下滑").solverKey === "gap_attribution"`** | **`tier2-semantic-route.test.ts:29-35` 断言的是 `finance_pnl`**（「毛利/量价本利 → finance_pnl（**不被『为什么』根因吞**）」） | ⛔ **直接冲突** |
| `:21` 储能为什么没达标 → `gap_attribution` | `tier2-semantic-route.test.ts:59`「对照不误吞：纯根因问句仍 → gap_attribution」 | 取代 |
| `:24-27` 供需/产销 → `supply_demand_gap_attribution` | `tier2-semantic-route.test.ts:38`（并多断了 `args.metricKey`） | 更强 |
| `:29` SO-号 → `atp_check` + `args.orderRef` | `tier2-semantic-route.test.ts:48`（并多断了 `usedPageContext`） | 更强 |
| `:36` 方案问句 → `decision_play` | `tier2-semantic-route.test.ts:64` | 取代 |
| `:37` 「储能还差多少达成」→ `metric_rollup` | `apps/agentcore/test/ceo-agent-context.test.ts:40` **同一问句同一期望** | 取代 |
| `:41` 「能否提前挤占产能」→ `sop_reschedule` | `apps/agentcore/test/sop-reschedule-route.test.ts:24` 同一问句 | 取代 |
| `:44-50` PageContext focus 注入 `metricKey` + `usedPageContext` | `tier2-semantic-route.test.ts:45` + `:56` | 取代 |

**判「确应丢弃」的证据**：canonical 在本分支之后**主动改过**这条语义——
`tier2-semantic-route.test.ts:29` 的用例名直接写着「不被『为什么』根因吞」，即
「毛利为什么下滑」现在**必须**落 `finance_pnl`。把 `tier2-bc-route.test.ts` 原样补并，
要么 CI 红，要么逼人把 `finance_pnl` 路由回退掉——**后者是真正的危险**（拿一个更旧的设计盖回更新的）。
**7 条断言 100% 已被覆盖，0 条独有价值，1 条有害** → 原文件丢弃，不留残条。

---

### 2.3 `apps/datacore/test/metric-aware-composition.test.ts` — 主体被严格更强的 SEAM 取代，残 2 条

**分支**：`metric-aware-seam` · 73 行 · 3 例（`it.each` 展开 4 + 2）

**取代者**：`apps/datacore/test/ceo-data2-seam.test.ts:115`
「**SEAM-GATE·C5 命脉：4 未达成指标各归自己因果域根（绝不回落 cathode 供应链）**」

这条正是 CLAUDE.md「接缝门 SEAM-GATE」词条里点名的那条（`gap_attribution(market_share)→cf-competitor-price`）。
取代者**严格更强**：

| 维度 | 缺失文件 | 取代者 `ceo-data2-seam.test.ts:115` |
|---|---|---|
| 覆盖指标 | 4（market_share/cash/demand_attain/revenue） | **5**（+ gross_profit） |
| 每指标断言 | 域根在叶里 + 不含 2 个 cathode 终点 | 入口 gap 因子 + **本域 3 根全部**进叶 + **因果边全程不触碰 5 个 cathode 因子** + `reconciled` + `severityKind` |
| 跨指标隔离 | 4 域两两不同 | 5 域**两两**不同（双重循环） |
| 附加 | — | `:182` gross_profit 落毛利桥三真叶 · `:232` cash 域 `cf-ar-aging` 下钻非恒 0 · **改颗粒→归因变** |

**残 2 条**：
1. **运输层**：缺失文件走 HTTP `POST /a/v1/solvers/gap_attribution/invoke`（`:23`）；
   canonical **零测试**用 HTTP 打 `gap_attribution`（`git grep "solvers/gap_attribution/invoke" -- apps/datacore/test` = 0），
   取代者走进程内 `t.services.solvers.invoke`（`ceo-data2-seam.test.ts:28`）。
2. **R6**：缺失文件 `:60` 断言 `market_share` 两跑 `atomicLeaves` 字节一致；
   canonical 的 R6 只在默认 metric 上（`gap-attribution.test.ts:94` C7）。

按本 WO 的优先级口径（SEAM > 效果层 > 运输层），残条①是运输层、②是弱效果层 → 都排在末位。

---

### 2.4 `apps/agentcore/test/multi-intent-seam.test.ts` — **原文件确应丢弃**（模块已重构消失），残 3 条真空

**分支**：`wo-multi-intent-p1` · 313 行 · 5 个 describe

**原文件不可用的硬证据**：它 `:4-10` 从 `../src/router/multi-intent.js` import 了
`selectMultiIntent, assembleMultiIntentAnswer, solversCoupled, MultiIntentCandidateInput, MultiIntentSubResult`。
对 canonical：

- `apps/agentcore/src/router/multi-intent.ts` — **文件不存在**（台账已记：内容并进了 `multi-route.ts`）
- `solversCoupled` — 全仓 **0 命中**
- `assembleMultiIntentAnswer` — 全仓 **0 命中**（等价物叫 `assembleMultiDomainAnswer`，`multi-route.ts:125`）
- `MultiIntentCandidateInput` / `MultiIntentSubResult` — **0 命中**
- `selectMultiIntent` **存在**（`multi-route.ts:291`）但**签名与返回形状都不同**：
  canonical 入参 `{intentKey, confidence, solverKey?, args, slotsFillable}`（`multi-route.ts:271-280`）、
  返回 `{routes, coupledPairs}`（`:282-285`）；缺失文件用的是 `{requiredSlots, filledSlots, sectionTitle}`、
  返回 `{selected, coupledPairs}`。

→ 这是「**实现已被重构掉**」的标准形态，原文件整体丢弃。

**行为层的取代情况**（逐条核）：

| 缺失文件的行为断言 | canonical 覆盖 |
|---|---|
| `:42` ≥2 高置信槽可满足 → 命中、coupledPairs 空 | `qos-cross-domain-seam.test.ts:112`（同一判据集） |
| `:56` 耦合对检出 | `qos-cross-domain-seam.test.ts:64` + `multi-route.ts:31-38` `COUPLED_ROUTE_PAIRS`；⚠ 缺失文件断言的 `solversCoupled("outsourcing_split","quarterly_gap")` 里 **`quarterly_gap` 不在 canonical 的耦合表**（表内是 `lta_gap↔outsourcing_split`） |
| `:71` 槽抽不满 → 丢弃、剩 <2 → null | `qos-cross-domain-seam.test.ts:112`（`x_unfilled` 用例） |
| `:82` 低于 tauMid 不计 + **同 solver 去重** | 前半覆盖（`x_low`）；**同 solver 去重零覆盖**（`multi-route.ts:308` `seen.has(c.solverKey)` 分支） |
| `:95` 确定性装配 ⟦ref⟧ 平移 + 耦合诚实标 | `qos-cross-domain-seam.test.ts:89` |
| `:123` SEAM-1 并行真跑 3 solver + 分节 | `qos-cross-domain-seam.test.ts:208` SEAM-3（llm-multi-intent 并行） |
| `:177` SEAM-2 耦合诚实·不出假综合措辞 | `qos-cross-domain-seam.test.ts:236` SEAM-4 |
| `:220` SEAM-3 延迟 <3s + `composeRequests===0` | **零覆盖**（canonical SEAM-3 只断 `agentRequests===0`，不断 compose、不断延迟） |
| **`:248` SEAM-4 partial 诚实：单 solver 抛错 → 该节标「未计算 + 原因」·其余正常·`parallelResults[k].ok` 分裂** | **零覆盖 —— 见下** |
| `:289` SEAM-5 零回归（flag 关 → 只跑 top-1） | `qos-cross-domain-seam.test.ts:249` SEAM-6（形态相近） |

**⚠ 这里挖出一个独立于本 WO 的真空**：
canonical 的 R7 partial 诚实**实现在**（`apps/agentcore/src/router/multi-route.ts:152-156`，
失败域产出 `## {label}（{solverKey}）\n该域未计算（原因：{outcome}）——诚实标·不臆造。`），
但 **`未计算` 在 `apps/*/test` 零命中、`parallelResults` 在 `apps/*/test` 零命中**。
也就是说：**多路并行的"一子 solver 炸了怎么办"这条诚实分支，今天没有任何测试咬它**。
这正是本仓「只有 test 引用 = 已排练」的镜像形态——**只有 src、没有 test：已接线、没人验**。

---

## 3 · ⚠ 不属本 WO：整单（实现 + 测试）都没并 —— **15 个**

**共同判据**：测试文件顶层 import / 核心断言所依赖的符号，在 canonical
`apps/*/src`、`packages/*/src`、`apps/*/migrations` 中**命中数为 0**（用 `git grep <sym> origin/claude/inspiring-gates-aqczjg -- <dirs>` 对**已提交 ref**核对，避开工作区脏文件）。
这些文件**今天补并 = 必红**；它们的正确归属是 **WO-INTEGRATION-AUDIT（#9）判「整单要不要并」**，不是 backfill 测试。

| # | 缺失测试 | 分支 | 关键符号 | canonical 现状（追到 file:line） |
|---:|---|---|---|---|
| 1 | `datacore/test/gap-attribution-metric-aware.test.ts` | `metric-aware-gap` | `CausalFactor.boundMetricKeys` 作 BFS 起点 | **零写入方**。唯一读处 `apps/datacore/src/app.ts:2401` 是防御性前向兼容，注释 `:2412` 自述「metric-aware-gap **合** + data agent 种后填」＝**明说没合**；canonical 现有测试 `datacore/test/ext-signal-references.test.ts:43-50` 反过来断言它**恒空**。`seg_attain_ess` 的因果 BFS 起点在 `solvers/service.ts:1719` 仍**硬编码 `cf-cathode-shortage`**。（canonical 的 metric-aware 走的是另一套：`service.ts:1474-1478` 按 `CausalFactor.metricKey` 找入口 gap 因子 + `metric_causal_binding` 规则，与本单机制不同） |
| 2 | `datacore/test/causal-deepchain.test.ts` | `causal-deepchain` | `cf-oee-deficit`/`cf-changeover-loss`/`cf-equip-aging`/`cf-cert-lag` | 4 个因子 **全仓 0 命中**（含 `synthetic/battery-extended.ts` 的 `CAUSAL_FACTORS` 表）。多种子 BFS 也没并（`service.ts:1719` 仍单起点） |
| 3 | `datacore/test/geo-real-signal.test.ts` | `geo-real-signal` | `provenanceSynthetic` 由真源派生（翻真） | canonical 里 `cf-geopolitical.provenanceSynthetic` 是**种子硬编码 `true`**（`synthetic/battery-extended.ts:214`），references 端点直接 `Boolean(p.provenanceSynthetic)`（`app.ts:2400`）——**没有任何"真源覆盖→翻 false"的通路**。（`buildSynthProvenancePredicate` 确在 `solvers/service.ts:3966`，但没接到这条链上） |
| 4 | `datacore/test/plankpi-month-quarter.test.ts` | `plankpi-mq` | `demand_attain_{period}` 月/季 Metric 实例 | `demand_attain_` **0 命中**；canonical 只种年级 `demand_attain` 一条（`synthetic/battery.ts:3888`）。`metric_rollup` 的 `byLevel` 在（`solvers/service.ts:2979`）但没有 quarter/month 实例可数 |
| 5 | `datacore/test/sim-action-propagation.test.ts` | `sandbox-action-propagation` | `ActionPropagationRule` · `apply-action` 端点 · `sandbox-triggers` | 三者**全 0 命中**（含 `migrations/`）。canonical 只有 tick 级传导（`app.ts:1399` `/sim/sessions/:id/tick`、`seed.ts:116` `sourceStateVar:"demandPressure"`）；`solvers/service.ts:2796` 的注释自述「全 propagateTick **action→stateVar 建模＝沙盘 S6 后续**」＝**明说是未来工作** |
| 6 | `datacore/test/schema-readability-seam.test.ts` | `wo-63-schema-readability` | `synthetic/ontology-readability.ts`（整文件缺）· `PROP_READABILITY` · `TYPE_BUSINESS_DEFINITIONS` · `unitExempt` · `VAGUE_WORDS_BASE` | 全 0 命中。canonical 的近似物是**棘轮基线门** `scripts/check-ontology-descriptions.mjs`（已在 `package.json:31` 的 `gates` 链上），但它带着一份很大的存量违规基线 `scripts/ontology-description-baseline.json`（`prop:ARAging.*` 等数百条）→ **严格弱于**缺失测试的「每个 PropertyDef 都有非空 description 与 displayName」 |
| 7 | `frontend-shell/test/schema-readability-view.test.tsx` | 同上 | 「口径」面板 / 本体中文名+单位列 | 同 6（前端半） |
| 8 | `datacore/test/rules-first-class-seam.test.ts` | `wo-66-rules-p1p2` | `SolverRuleBinding` · `solver_rule_bindings` · `thresholdProvenance` · `code_fallback` · `readRuleParam` · `publishRuleOverride`(helper) | 全 0 命中。**台账 `HANDOFF-LEDGER.md:120` 已独立得出同一结论**并已退单要求 rebase 重交，且已列明「真正尚缺的只有 `readRuleParam` / `solvers/rule-params.ts` / `solver_rule_bindings`」——本条与台账**互相印证** |
| 9 | `datacore/test/column-security.test.ts` | `wo-69-ontology-primitives`（另 2 条 69 分支带同一 blob `de073f53`） | `propertyPolicy` · `PROPERTY_FORBIDDEN` · `SOLVER_COLUMN_RESTRICTED` | 全 0 命中 src/test。**只在 `docs/WO-69-ONTOLOGY-PRIMITIVES.md` 里有**（工单进了正线、实现没进——与 e2e-dialogue 同一形态）。追第二层确认不是改名：canonical `apps/datacore/src/authz.ts` 的导出面只有 `ResourceKind`/`Op`/`AccessDecision`/`AuthzService`，**没有任何列级/属性级策略概念**（`columnPolicy`/`fieldPolicy`/`deniedProps`/`maskProps` 亦全 0） |
| 10 | `datacore/test/ontology-signature.seam.test.ts` | `wo-69-p2-function-signature` | `solvers/ontology-signature.ts`（整文件缺）· `SOLVER_ONTOLOGY_SIGNATURES` · `OntologyReadSurface` · `mergeReadSurfaces` · `test/ontology-signature.recorder.ts`（配套 helper 也缺） | 全 0 命中 |
| 11 | `datacore/test/object-interface.seam.test.ts` | `wo-69-p3-interface` | `BATTERY_OBJECT_INTERFACES` · `contracts/object-interface.ts`（整文件缺）· `migrations/028_object_interfaces.sql`（缺） | 全 0 命中。第二层确认非改名：canonical `packages/contracts/src/index.ts` 无任何 `Interface` 导出 |
| 12 | `agentcore/test/plan-builder.test.ts` | `wo-aip-cap0` | `src/plan-builder/compiler.ts`·`service.ts`（整目录缺）· `migrations/010_plan_builder_canvases.sql`（缺·且 `010` 与 canonical 已占用的 `010_multi_intent_plan.sql` 实撞） | 全 0 命中。台账 `:119` 已正确判为「整块特性未并线」 |
| 13 | `frontend-shell/test/admin-plan-builder.test.tsx` | 同上 | `PlanBuilderPage.tsx` · `planBuilderFixtures.ts`（缺） | 同 12（前端半） |
| 14 | `frontend-shell/test/gray-node-autofill-seam.test.tsx` | `wo-gray-node-autofill` | `data-testid="gray-node-*"` / `gray-fill-cta-*` / `gray-fill-soft-*` / `gray-fill-hard-*` | 全 0 命中于 `apps/frontend-shell/src`。第二层确认：canonical 前端只有 `endpoints.ts:1045` 调 `/b/v1/growth/run`（`GapCard.tsx` 用），**RiskBoardView 里没有灰节点补齐入口**；文案 `无逐日实测源` 亦 0 命中 |
| 15 | `agentcore/test/qos-nl-wiring-seam.test.ts` | `wo-0-nl-wiring` | `classification.model === "deterministic:classifier-failsafe"`（用例 ②·`:64`） | `classifier-failsafe` **全仓 0 命中**。追到实际分支：canonical `router/orchestrator.ts:727-745` 的 classify 失败路径是 `classifierErrors.inc()`(`:729`) → `WORKFLOW_ONLY` 则 `completeWorkflowOnlyMiss` → 否则 `providerAvailable` 假则 `completeNoLlmDegradation`(`:738`) → 否则 `runPathB`。**没有「domainResolve 确定性兜底拉回 path-A」这一档**。该文件的用例 ①③④ 大体被 canonical 覆盖（`qos-c.test.ts:87` 咬 `classifierErrors`；`no-llm-degradation-seam.test.ts` 咬诚实降级），唯 ② 是本单的病灶修复，**而这个修复没并** |

> **对第 15 条的额外提醒**：`wo-0-nl-wiring` 分支的 `orchestrator.ts` 相对 canonical 是**减 700+ 行**的老版本
> （缺 multi-route / l2-decompose / l3-coupled / DRIL-P4 / opt-whatif 全部）。谁去 rebase 它，
> 必须按「只补 `isLlmUnavailableError` + classifier 确定性兜底两块」而非整单重放——
> 否则会把 canonical 已长出的能力盖回去（与台账 `:120` 对 `wo-66` 的告诫同一坑）。

---

## 4 · 「补并」优先级（按 SEAM 测试 > 效果层断言 > 运输层断言；咬**静默错答**的排最前）

| 序 | 动作 | 咬什么 | 为什么这个位置 |
|---:|---|---|---|
| **P0** | **补并 `agentcore/test/e2e-dialogue-acceptance.test.ts`** | 全链 S1~S7 capstone；独有 = **S4/S7 效果层**（final_answer 真含 结论/证据/建议/风险 + `⟦ref:N⟧` + `trustLevel`） | 唯一的整文件补并；纯测试 WO、零实现依赖、工单文档已在正线自称「所有对话 WO 的头号复验判据」。缺它 = 对话链**没有任何端到端门**，各 WO 只测自己那半 |
| **P1** | **给 `multi-route.ts` 的 R7 partial 诚实补一条 SEAM**（源：`multi-intent-seam.test.ts:248`） | 多路并行中**单 solver 抛错** → 该节标「未计算 + 原因」、其余节照出、`parallelResults[k].ok` 真分裂、`trustLevel` 降级 | **咬静默错答**：实现在 `apps/agentcore/src/router/multi-route.ts:152-156`，但 `未计算` 与 `parallelResults` 在 `apps/*/test` **双双零命中**。今天若有人把这段改成"跳过失败域不吭声"，**没有任何门会红**——用户看到的是一份少了一节却读起来完整的答案 |
| **P2** | 给 `qos-cross-domain-seam.test.ts` 补 SEAM-3 的**零 compose + 延迟**断言（源：`multi-intent-seam.test.ts:220`） | 多意图路径不得引入推理档综合（`composeRequests===0`、总耗时 <3s） | 效果层；canonical SEAM-3 只断了 `agentRequests===0`，compose 通道是敞的 |
| **P3** | 给 `qos-cross-domain-seam.test.ts` 补 4 行：`domainResolveMulti(q, undefined)` → 全 0 → null（源：`deterministic-multi-domain-seam.test.ts:36`） | 无 PageContext 时**不冒进**（fail-safe：绝不把开放题误降级给窄 solver） | 效果层但风险面小（`domain-resolver.ts:274` 的 `contextRich` 分支） |
| **P4** | 给 `qos-cross-domain-seam.test.ts:112` 补 1 行：**同 solver 去重**（源：`multi-intent-seam.test.ts:82`） | `multi-route.ts:308` `seen.has(c.solverKey)` 分支 | 效果层，边角 |
| **P5** | 给 `ceo-data2-seam.test.ts` 补 R6 两跑（`market_share`）（源：`metric-aware-composition.test.ts:60`） | 绑定后归因的确定性 | 弱效果层；canonical 已有默认 metric 的 R6 |
| **P6** | 挑一条 datacore 测试改走 HTTP `POST /a/v1/solvers/gap_attribution/invoke`（源：`metric-aware-composition.test.ts:23`） | 求解器 HTTP 面（canonical 零覆盖） | **运输层**，排最后 |

P1~P6 都是**补丁到现有取代者**，不新增文件、不引入重复。
P0 之外的 15 个文件**不进本 WO**（见 §3）。

---

## 5 · 我不确定的条目 + 卡在哪

诚实的未知优于编造的结论。以下三项我**没有**得出确定结论：

1. **`e2e-dialogue-acceptance.test.ts` 补并后是否一次绿。**
   卡点：范围边界禁止跑测试，我只做了静态符号核对。风险点具体是
   `:134` `expect(task.classification?.model).toBe("deterministic:ceo-route")` 与
   `:135` `expect(task.matchedIntent?.intentKey).toBe("ceo_root_cause")`——
   canonical 在该分支 merge-base（落后 235 commit）之后**收窄过** CEO 深问路由
   （`tier2-semantic-route.test.ts:29` 把「毛利为什么下滑」从 `gap_attribution` 改判 `finance_pnl`；
   另有 `ceo-route-metric-split.test.ts` 收窄 `metric_rollup`）。
   「储能为什么没达标」按 `tier2-semantic-route.test.ts:59` 应仍是 `gap_attribution`，
   但我**没能确认** `deterministic:ceo-route` 这个 `classification.model` 字面值在今天的 orchestrator 里
   对该问句仍成立。**解卡方式**：补并的 dev 先单跑该文件，把红的断言按现语义改并在 PR 里逐条说明改动理由。

2. **§3 那 15 个整单未并的分支，各自"该不该并"。**
   本 WO 的范围是「测试怎么处置」，不是「特性要不要」。我只证明了**今天不能单独补测试**。
   `wo-66`（台账已退单）、`wo-aip-cap0`（台账已判整块未并）两条台账已有结论；
   其余 13 条需要 WO-INTEGRATION-AUDIT 逐条裁决（并 / 驳回 / 挂起并写解挂条件）。
   我**不给**它们的并线建议——那需要读各自的 PRD 意图，超出本轮取证范围。

3. **`multi-intent-seam.test.ts:57` 的 `solversCoupled("outsourcing_split","quarterly_gap")`。**
   canonical 的耦合表 `apps/agentcore/src/router/multi-route.ts:31-38` 里
   **没有** `quarterly_gap` 这个 solver 名（表内是 `lta_gap ↔ outsourcing_split`）。
   我**不确定**这是（a）分支上的 solver 改名后 canonical 用了别的名字、还是（b）canonical 的耦合表**真的漏了**
   「季度缺口 ↔ 外协补缺口」这条依赖——若是 (b)，那就是一个**真的耦合漏判**（会把耦合题当独立题假综合，
   正是 G-PORTFOLIO-LOCAL-ONLY 那个病）。**卡在**：我没有找到 `quarterly_gap` 在 canonical solver 注册表里的对应物，
   也没有 PRD 依据判断它该不该在耦合表里。**建议**：交由懂 L1/L3 耦合语义的人在 §4 的 P1 那单里顺手核一次。

---

## 附 · 本体引用与影响

- **对象类型**：`CausalFactor`（`boundMetricKeys` / `metricKey` 两套 metric-aware 机制之争）· `Metric`（月/季 level 实例缺失）· `PropagationRule` / `ActionPropagationRule`（后者未并）· `ObjectInterface`（未并）
- **链路**：本体 §3 编排链 ②确定性多域 → ⑤LLM 多意图 → `runParallelRoutes`（**R7 partial 分支零测试覆盖**）· 归因链 `gap_attribution` BFS 起点 · 成长回路 probe→run→fill
- **不变量**：R6（确定性字节一致，多处残条围绕它）· R7（partial 诚实，**今天没门**）· R13（溯源 ⟦ref⟧）
- **断点**：本轮**新识别 1 个** —— `runParallelRoutes` 的失败域诚实分支「已接线、零测试」（src 2 处 / test 0 处），
  形态是 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 的镜像：那个是「有测试无生产调用方」，这个是「有生产实现无测试」。
- **本文件不改 `docs/SYSTEM-ONTOLOGY.md`**（范围边界）。若上述断点被接受，应由后续 WO 回写本体断点表。
