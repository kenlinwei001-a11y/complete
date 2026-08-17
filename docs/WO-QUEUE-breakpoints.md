# WO 队列 · 本体 §8 未闭断点 → 可派工单（WO-BREAKPOINT-TRIAGE · 2026-08-17）

> **这份文档解决的是一个调度问题，不是技术问题。**
> `scripts/dispatch-deficit.sh` 每次都报「待写WO 17」，而这 17 条一直卡在那个形态没动 ——
> 因为 §8 里标 🔴 / ◑ 的东西是**诊断**，不是**工单**：没有范围边界、没有验收判据、没有画像分层，
> 谁也没法直接派。本文把它们逐条转成可派的单。
>
> **本文不改一行生产代码。** 只读 + 出文档 + 回写 §8 状态标记。

## 本体引用与影响

- **触及断点**：`G-SEAM-GATE-METHOD-BLIND` · `G-ACTION-NOOP-EXEC` · `G-ADOPT-SCHEME-NO-CARRIER` ·
  `G-PLAN-CHANGE-NO-LEVER` · `G-C08-EXPR-PARAM-SPLIT` · `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` ·
  `G-STEP-VOCAB-SPLIT-TWO-HOMES` · `G-IMPEDIMENT-OPTION-NOJOIN` · `G-PROMPT-KEYS-CONFIG-ONLY` ·
  `G-PROVISIONAL-HONESTY-DEAD` · `G-GATE-ROSTER-HANDCOPIED` · `G-OEE-DUAL-TRUTH` ·
  `G-SPLITACCOUNT-PROMISE-ONLY`（13 个唯一编号）
- **触及链路**：本体 §3 行动写回链 · 规则 DSL 链 · Skill 发布链 · 提示词模板链 · 阻滞点→方案链
- **不变量**：R4（Action 审批即生效）· R6（确定性）· R13（未审核态不谎报）
- **回写**：本文对 §8 做**状态标记与过期描述**的回写，不动任何断点编号（见文末《§8 回写清单》）

---

## 一 · 先自证工具：17 是什么数

`dispatch-deficit.sh` 的第三个队列用的是
`grep -cE '🔴 *未修|◑ *部分闭合' docs/SYSTEM-ONTOLOGY.md` —— **整文件、整行**。

我用独立口径重数（只扫 §8 表体 · 按编号行 · 抽全行状态标记序列，金丝雀 4/4：
三个必中样例 + 一个必不中样例），得到**同样的 17**。两个口径对得上。

但 **17 是行数，不是断点数**：

| 口径 | 数 |
|---|---|
| 含 🔴未修 / ◑部分闭合 的**行** | **17**（= 脚本报的那个数） |
| 去重后的**唯一断点编号** | **13** |
| 展开成**可独立派单的缺口** | **16**（三条断点各自内部还分岔，见下表） |
| 逐条复核后**今天真未闭的唯一编号** | **9**（本单回写 §8 后脚本现算 **13 行**） |

差额来自 §8 里的**重复行**：同一个编号被登记了多次而旧行没删。
`G-GATE-ROSTER-HANDCOPIED` 一个编号占 **4 行**（其中最老的一行今天已是**描述过期**），
`G-ACTION-NOOP-EXEC` 占 2 行。全 §8 共 **190 个编号行 / 172 个唯一编号 / 13 个编号有重复行**。

### ⚠️ 顺带测出的一个更大的洞（不在本单范围，但必须记账）

§8 的 190 个编号行里，**104 行（95 个唯一编号）连一个状态标记都没有**
（既不是 🔴 也不是 ◑ 也不是 ✅，例如 `G-1`…`G-12` · `G-BE-FE-SEAM-DEAD` · `G-MOCK-OVERCLAIM` ·
`G-DIST-STALE-READ` 这一大批）。

⇒ **`dispatch-deficit.sh` 的「待写WO」永远看不见这 95 个编号**，无论它们是开是闭。
形态（铁律 0.6 句式）：**「我用『带状态标记的行数』当作『未闭断点数』的证据，而前者并不度量后者。」**
这本身是一张单（下表 `WO-ONTO-STATUS-BACKFILL`）。

---

## 二 · 逐条复核：「今天还成立吗」

**判据不是读 §8 的描述，是去代码里追调用链。** 每条都给了金丝雀或提交号。

| # | 断点 | §8 记的 | **今天** | 三形态定性 | 证据 |
|---|---|---|---|---|---|
| 1 | `G-SEAM-GATE-METHOD-BLIND` 残余(甲)<br>客户端函数是死代码 | 🔴 未修 | **✅ 已闭未回写** | ~~没接线~~ 已接线 | `fetchProcessInstance`/`advanceProcessInstance` 今有生产调用方 `apps/frontend-shell/src/views/process/ProcessInstanceDetailView.tsx` 第 163/312 行，且该视图**真被路由挂载**（`apps/frontend-shell/src/App.tsx` 第 163 行 `process-instances/:instanceId`）。提交 `dc998e41`。金丝雀：同法查 `fetchStuckProcesses` 命中 2 处 ⇒ 工具没坏 |
| 2 | `G-SEAM-GATE-METHOD-BLIND` 残余(乙)<br>通配段冒领 | 🔴 未修 | **仍成立** | 接了线接错地方（判据少一维） | `scripts/check-backend-frontend-seam.mjs` 的 `pathMatches` 第 706 行仍是 `if (be[i] === "*" \|\| fe[i] === "*") continue;` —— 前端 `${id}` 归一出的 `*` 仍会吃掉后端字面子路由 |
| 3 | `G-ACTION-NOOP-EXEC` | ◑ 部分闭合 | **仍成立（◑）· 数字过期** | 接了线接错地方（剩余型无落点） | `node scripts/check-action-wiring.mjs` 今日 RC=0：**11 型 = WIRED 10 · NO_WRITE 0 · NOT_IMPLEMENTED 1**。§8 写的是「10 型 = WIRED 9 · NOT_IMPLEMENTED 1」⇒ 分母分子都涨了一个，描述过期 |
| 4 | `G-ADOPT-SCHEME-NO-CARRIER` | 🔴 未修 | **仍成立** | **没接线**（缺的是承载对象，不是执行器） | `apps/datacore/src/actions.ts` 第 80 行 `采纳经营方案: "NOT_IMPLEMENTED"`，理由已签在 `NOT_IMPLEMENTED_RATIONALE`（同文件第 160 行）。这就是 #3 里那唯一一个 NOT_IMPLEMENTED |
| 5 | `G-PLAN-CHANGE-NO-LEVER` | ◑ 部分闭合 | **仍成立（◑）** | 接了线接错地方 | `apps/datacore/src/app.ts` 第 580 行带 levers 走 `applyLeverWrites`；第 583–596 行无 levers 时诚实失败。二分结构未变 |
| 6 | `G-C08-EXPR-PARAM-SPLIT` | 🔴 未修 | **✅ 已闭未回写** | ~~没接线~~ 已接线 | DSL 已支持 `params.<名>` 操作数（`apps/datacore/src/ruledsl.ts` 第 10/39/318/491 行，取不到即抛错、**不静默回退**）；发布/编辑期**双向**闭包校验 `assertValidExpression`（`apps/datacore/src/rules.ts` 第 26 行）接在创建第 225 行 / 更新第 268 行 / HTTP 路由 `apps/datacore/src/app.ts` 第 4406 行。**提交 `aba33841` 的标题原文就写着「闭 G-C08-EXPR-PARAM-SPLIT」** |
| 7 | `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` ①<br>死抽取器 | 🔴 未修 | **仍成立** | **没接线**（零 src 调用方） | `grep -rn extractRelations apps/*/src packages/*/src` 只命中它自己的定义行 `apps/agentcore/src/dril/resource-projector.ts` 第 365 行。金丝雀：同条件查 `lintSkill` 命中 3 处 src 引用 ⇒ 工具没坏 |
| 8 | `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` ②<br>`dependsOn` 数据 | 🔴 未修（原文「仍 0 条」） | **描述已过期** | 接了线**已有数据**（1 条，非 0） | `apps/agentcore/src/mocks/seed.ts` 第 1350 行有一条真种子（`sop_meeting --dependsOn--> capacity_analysis`）。CLAUDE.md 铁律 0.5 里已记过这次 0→1，§8 没跟上。**剩余缺口不是「0 条」而是「7 个技能只有 1 个有」**，定性与修法都变了 |
| 9 | `G-STEP-VOCAB-SPLIT-TWO-HOMES` | 🔴 未修 | **仍成立** | 接了线接错地方（真源分居两处） | `ExtraToolStepSchema` 仍在 `apps/agentcore/src/catalog/service.ts` 第 28 行（contracts 看不见）；`packages/contracts/src/skill-compile.ts` 第 162 行仍只是**注释里指过去** |
| 10 | `G-IMPEDIMENT-OPTION-NOJOIN` 缺口②<br>`decision_play` join | 🔴 未修 | **✅ 已闭未回写** | ~~没接线~~ 已接线·含消费端 | `apps/datacore/src/solvers/service.ts` 第 3907 行的方法注释原文就写着「闭 `G-IMPEDIMENT-OPTION-NOJOIN` 缺口②」，实现 `decisionPlayLocus` 在第 3944 行；**前端两端都通**：`apps/frontend-shell/src/views/DecisionPlayView.tsx` 第 35 行传 locus、`apps/frontend-shell/src/views/DecisionPlayPanel.tsx` 第 1335 行 `LocusPlayBlock` 上屏 |
| 11 | `G-PROMPT-KEYS-CONFIG-ONLY` | 🔴 未修 | **仍成立** | 接了线接错地方（线在 CRUD 上不在 LLM 调用上） | 全仓 `resolvePromptOverride` 的调用点只有一处且写死 `"classifier"`（`apps/agentcore/src/router/orchestrator.ts` 第 1257 行）；`EXTRACTION_SYSTEM` 仍硬编码在 `apps/datacore/src/ruledocs.ts` 第 17/212 行、`SUGGEST_SYSTEM` 在 `apps/datacore/src/modeling.ts` 第 12/216 行 |
| 12 | `G-PROVISIONAL-HONESTY-DEAD` | 🔴 未修 | **✅ 已闭未回写** | ~~没接线~~ 已接线 | 生产调用点 `apps/datacore/src/databuilder/service.ts` 第 82 行（在 `assertProvisionalHonesty` 内），**再追一层**该函数自己有两个调用点：同文件第 557 行（record 步落库）与第 856 行（verifyBuild 回写终态）。守门 `scripts/check-redline-wired.mjs`。提交 `8341656d` 标题原文「闭欠账 #134『红线闸零生产调用方』」 |
| 13 | `G-GATE-ROSTER-HANDCOPIED`（L2164 那一行） | 🔴 未修 | **描述已过期**（重复行） | — | 该行的判负理由是「`check-edge-active-mounts.mjs` 的名单**尚未改成现算**」，而今天它第 62 行已 `import { computeRoster … } from "./lib/sim-page-roster.mjs"`、第 233 行明写「本文件里一个页面键都不存」。同编号的另外三行（L2168/2170/2172）已更新为 ◑ |
| 14 | `G-GATE-ROSTER-HANDCOPIED`（整类） | ◑ 部分闭合 | **仍成立（◑）** | 接了线接错地方（射程不全） | `scripts/gate-roster-baseline.json` 今日 71 个候选名册在册，`roster` 债 13 处未收（明细见 `docs/AUDIT-gate-roster-sweep.md`） |
| 15 | `G-OEE-DUAL-TRUTH` | 🔴 未修·**等仓主裁决** | **✅ 已闭未回写**（见下方专节） | ~~两个写入方~~ 已归一 | 裁决 C 已落地：合并提交 `8d70bcdb`「收编 oee-unify（OEE 三套口径归一·裁决 C 落地）」。`apps/datacore/src/synthetic/battery.ts` 第 1928 行注释「四个 OEE 属性全部 = EquipmentOEE 日事实表 7 日均值（同源）」。门 `node scripts/check-oee-ssot.mjs` 今日 RC=0 |
| 16 | `G-SPLITACCOUNT-PROMISE-ONLY` | ◑ 部分闭合 | **仍成立（◑）· 描述已过期** | 接了线接错地方（拆出去那半没门守） | ◑ 成立（B-1/B-3/B-4 内容面仍无验收方式）；但 §8 写的「**差真浏览器 harness**」已过期 —— harness 已建（`scripts/lib/layout-probe.mjs`，`layout-legibility:check` 在用、12 页真渲染），`docs/PRD-harness-ux-adoption.md` 已于 2026-08-17 自行订正。**照 §8 旧文派单会重造一个已有的东西** |

### 分布

| 结论 | 数（按上表 16 个缺口） |
|---|---|
| **仍成立** | **8**（#2 #3 #4 #5 #7 #9 #11 #14 #16 中去重后 → 见下） |
| **已闭未回写** | **4**（#1 #6 #10 #12 #15 中的 4 个编号：`G-C08` · `G-IMPEDIMENT②` · `G-PROVISIONAL` · `G-OEE`；另 #1 是 `G-SEAM-GATE-METHOD-BLIND` 的一半） |
| **部分闭合** | **2**（`G-SEAM-GATE-METHOD-BLIND` 甲闭乙开 · `G-SKILL-REFGRAPH` ①开②数据变） |
| **描述已过期** | **4**（#3 数字 · #8 「仍 0 条」 · #13 重复行 · #16 harness） |

**按唯一编号统计**：13 个编号里 —— **4 个整条已闭未回写** · **2 个部分闭合** · **7 个仍成立**。

---

## 三 · 「其实已经闭了」清单（含证据）

这四条今天在代码里是通的，§8 却仍标 🔴。**本单已就地回写 §8。**

| 编号 | 修它的提交 | 生产调用点（追到条件为止） | 门 / 测试 |
|---|---|---|---|
| `G-C08-EXPR-PARAM-SPLIT` | `aba33841` feat(rules): 规则 DSL 支持 params 引用…（**标题自带「闭 G-C08-EXPR-PARAM-SPLIT」**） | `assertValidExpression` 三个挂载点：`rules.ts` 创建/更新两处 + `app.ts` HTTP 路由一处；**双向**闭包（引用⊆声明 ∧ 被绑定阈值必被引用） | 运行时发布闸（不再是静态门，正好补上 §8 原文说的「静态门看不到运行时规则记录」那半） |
| `G-IMPEDIMENT-OPTION-NOJOIN` 缺口② | WO-ORDER-JOURNEY | 引擎 `decisionPlayLocus`（`solvers/service.ts`）+ 前端传参 `DecisionPlayView.tsx` + 上屏 `DecisionPlayPanel.tsx` 的 `LocusPlayBlock` | 精度三档 `EXACT`/`TYPE`/`NONE` 不塌成一个；不传 locus 则输出逐字节不变（可回退） |
| `G-PROVISIONAL-HONESTY-DEAD` | `8341656d` gate(redline-wired): 新门 + 接线 —— 闭欠账 #134 | `checkProvisionalHonesty` ← `assertProvisionalHonesty` ← record 步落库 / verifyBuild 回写终态两处；**fail-closed**（违规拒绝落库） | `scripts/check-redline-wired.mjs` 判据 W1 |
| `G-OEE-DUAL-TRUTH` | `8d70bcdb`（merge）· `24791ee1` 第 1 步按裁决 C 归一 · `3298add3` 第 4 步接缝测试 | `Equipment` 四个 OEE 属性全部派生自 `EquipmentOEE` 日事实表 7 日均值；「一个字段两个写入方」的病根消除 | `oee-ssot:check` RC=0；接缝测试 `apps/datacore/test/oee-ssot.seam.test.ts` S1–S5（S2 咬「三套口径最差设备是同一台」） |

### ⚠️ `G-OEE-DUAL-TRUTH` 为什么会「修了但本体是旧的」—— 这条值得单独记账

提交 `3298add3` 的信息里白纸黑字写着
「SYSTEM-ONTOLOGY §8 G-OEE-DUAL-TRUTH 追加闭合段（含分页 1000/5460 残账登记）」，
**但它的 diffstat 是 `docs/SYSTEM-ONTOLOGY.md | 2127 ------` —— 2127 行删除、0 行新增**：
那次提交把整份本体写成了**空文件**（blob 哈希 `e69de29b` = git 的空 blob）。
后续合并 `8d70bcdb` 解冲突时取了 ours 把文件救回来，**于是那次真做了的回写一并没了**。

形态（铁律 0.6 句式）：
> **「我用『提交信息里写了已回写』当作『本体真被回写了』的证据，而前者并不度量后者。」**

这也解释了为什么 `dispatch-deficit.sh` 一直把它算进「待写WO」：
**队列度量的是本体，而本体停在裁决前那一刻。**

**建议的机制（第 2 次即建，别等第 3 次）**：合并时若 `docs/SYSTEM-ONTOLOGY.md` 的新 blob 是空 blob
或行数比父提交少 50% 以上，门当场判负。判据落在**行数比**上，不落在「提交信息说了什么」上。
已落成下表的 `WO-ONTO-TRUNCATE-GUARD`。

---

## 四 · 可派工单表

> 每张单顶部的 **🚦范围边界** 就是那个 dev 本单的身份。
> **跨数据/引擎两半的必须一个 dev 整单做** —— 拆两半用不同机制不对接是本仓反复炸的根。

### A · 无前置依赖（可立刻并行派）

| 单号 | 断点 | 三形态 | 🚦范围边界（只碰） | 验收判据（断言落在什么上） | 画像 |
|---|---|---|---|---|---|
| **WO-BEFE-WILDCARD-CLAIM** | `G-SEAM-GATE-METHOD-BLIND` 残(乙) | 接了线接错地方 | `scripts/check-backend-frontend-seam.mjs`（`pathMatches` 与其调用方）· 该门的基线 json | 喂一条「前端 `/a/v1/rules/*` × 后端字面 `/a/v1/rules/evaluate`」**同方法**的样例，门必须判它**没被消费**（今天判「已接」）。变异反证：把判据改回旧口径 ⇒ 该样例重新变绿即证明判据真在起作用。存量冒领条目一次性入基线并逐条写 why，此后只降不升 | **轻** |
| **WO-GATE-ROSTER-SWEEP-2** | `G-GATE-ROSTER-HANDCOPIED` 剩余 13 处 | 接了线接错地方 | `scripts/gate-roster-baseline.json` · 各被点名门脚本的扫描面常量 · `docs/AUDIT-gate-roster-sweep.md` | 逐处要么改现算、要么同批加「名单 vs 现算」一致性断言；`gate-roster:check` 的 `roster` 债从 13 降到 N 并**只降不升**。头号那笔先做：`check-ui-first-layer.mjs:SCAN_DIRS` 差集 54 个 `.tsx`（`components/**` 整个在射程外）。**验收不是「门绿了」，是「拿一个原本在差集里的文件造一处真违规，门必须点名到 file:line」** | **轻** |
| **WO-ONTO-STATUS-BACKFILL** | 本单测出（§8 有 95 个编号无状态标记） | 接了线没数据 | `docs/SYSTEM-ONTOLOGY.md` §8（**只加状态标记，不动编号、不动描述**） | 95 个无标记编号逐个补上 ✅/🔴/◑ 之一（补之前每个都要复核，不许照描述猜）；补完后 `dispatch-deficit.sh` 的「待写WO」数会跳变 —— **那个跳变本身就是验收证据**：它证明此前这个队列度量的对象不完整 | **轻** |
| **WO-ONTO-DEDUPE** | 本单测出（13 个编号有重复行，最多的占 4 行） | — | `docs/SYSTEM-ONTOLOGY.md` §8 · `scripts/check-ontology-anchors.mjs` 的基线 | 每个编号在 §8 只留一行（保留信息最全的那行，旧行的独有内容并进去）；加一条断言「§8 编号行数 == 唯一编号数」。**验收落在断言上**：造一个重复编号 ⇒ 该断言必须当场红。跑 `check-ontology-anchors.mjs` 确认锚点未被删（基线键不许消失） | **轻** |
| **WO-ONTO-TRUNCATE-GUARD** | 本单测出（`3298add3` 把本体写成空文件） | 没接线（这道门不存在） | `scripts/`（新门 + 接进 `pnpm gates`）· `package.json` 的门键 | 门判据：`docs/SYSTEM-ONTOLOGY.md` 相对**父提交**行数少 50% 以上、或为空 blob ⇒ RC=1。**金丝雀必须双向**：拿真实的 `3298add3` 那次改动喂进去必须判红（必中），拿一次正常增改必须判绿（必不中）。⚠️ 金丝雀与主逻辑共用同一份实现，不许各抄一份 | **轻** |
| **WO-FACT-USAGE-REGISTRY** | `G-SPLITACCOUNT-PROMISE-ONLY` 的 B-3 **前置** | 没接线（这份注册表不存在） | 新建「事实 → 读取它的页面集合」注册表（`apps/frontend-shell/src` 下建，或从各页 `useQuery` 的 queryKey + 取值路径静态抽）· 一条一致性断言 | 断言落在「给定一个 `objectId.prop`，能列出读它的页面集合且非空」；抽不出的**诚实留白**不许补空数组冒充。⚠️ 不碰 `docs/PRD-harness-ux-adoption.md`（同期多人在动） | **轻** |
| **WO-PROMPT-KEYS-WIRE** | `G-PROMPT-KEYS-CONFIG-ONLY`（3 键） | 接了线接错地方 | `apps/datacore/src/ruledocs.ts`（`extraction`）· `apps/datacore/src/modeling.ts`（`modeling`）· `apps/agentcore/src/router/orchestrator.ts` 的 8 处 `llm.compose` 调用点（`answer_compose`）。**不碰** `skill_summary_lint`（见 B 组） | **断言落在模型真收到的那段文本上**，不是落在「版本号涨了」：改模板 → 落库 → 触发一次真实抽取/建模/合成（LLM mock）→ 断言 mock 收到的 `system`/`instruction` **逐字节等于**改后的模板；不改模板则逐字节等于兜底常量。⚠️ 别被 `LlmPurposeSchema` 的同名 `purpose:"extraction"` 骗到 —— 那是**选哪个模型**不是**用哪段提示词** | **中** |
| **WO-SKILL-REFGRAPH-WIRE** | `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` ① | **没接线** | `apps/agentcore/src/dril/resource-projector.ts`（`extractRelations` 及其应有调用方）· 资源图构建路径 · 对应 seam 测试 | **验收判据不许是「extractRelations 有测试」**（今天就有，且是绿的 —— 那正是本断点本身）。要断言的是：种一个带 `references`/`dependsOn` 的技能 → **从资源图那一端读回来**，派生边真在图里。变异反证：摘掉接线 ⇒ 该断言当场红 | **中** |
| **WO-STEP-VOCAB-UPLIFT** | `G-STEP-VOCAB-SPLIT-TWO-HOMES` | 接了线接错地方 | `packages/contracts/src/skill-compile.ts` · 新建/上提 `ExtendedPlanStepSchema` 进 `packages/contracts` · `apps/agentcore/src/catalog/service.ts` · `apps/agentcore/src/workflow/validate.ts` | 断言落在**跨包可见性**上：在 `packages/contracts` 的测试里（不是 agentcore 里）能用 `query_timeseries_agg` / `search_knowledge` / `plan_slice` 三类步骤编译过一条技能。⚠️ 现有的「刻意保持 `unknown` 透传」那条注释与两条断言是**缓解**，收编时不许直接删 —— 要证明根治后它们仍绿或被更强断言取代 | **中** |

### B · 有前置依赖 / 需先裁决

| 单号 | 断点 | 前置依赖 | 🚦范围边界 | 验收判据 | 画像 |
|---|---|---|---|---|---|
| **WO-ADOPT-SCHEME-CARRIER** | `G-ADOPT-SCHEME-NO-CARRIER` | **需产品裁决**：新建「方案采纳台账对象」+「AOP 细化读端」属新增对象类型，要仓主先点头 | `packages/contracts`（新对象类型）· `apps/datacore/src/actions.ts` · `apps/datacore/src/app.ts` 的 `domainExecutor` · 迁移 + `repo/pg.ts` + `repo/memory.ts` 三处同步 · 金值（catalog/ontology-core 计数） | 断言落在**另一条路读回台账对象**上（照 `adopt_mitigation → AdoptedMitigation → risk.ts` 那条已闭链路的形态）。⚠️ **勿把本条洗成 `NO_WRITE`** —— 它不是「设计上无副作用」，是「落点还没造出来」，两者在 `check-action-wiring.mjs` 断言⑤ 下处置相反。⚠️ 硬接一个写入路径 = 假 MO 号换件衣服，明令禁止 | **重** |
| **WO-PLAN-CHANGE-LEVER-MAP** | `G-PLAN-CHANGE-NO-LEVER` | 无硬依赖，但与上一张同碰 `domainExecutor` ⇒ **不许与 WO-ADOPT-SCHEME-CARRIER 并行**（同文件冲突改法） | 同上 + `apps/frontend-shell/src/views/sim/`（order-chain / 协调加产两条生产者） | 只做**两条真域映射缺失**的（order-chain 结论 / 协调加产）。⚠️ 沙盘那两条（`patch.simulated:true`）的诚实失败**是正确行为不是欠账**，`PRD-enterprise-decision-twin` §4.1 明令禁止仿真回流真实 —— 谁把它"修"成能写就是退步。判据落在 **payload 形状**（有没有 `{objectId,prop,value}`）**不是 `source` 串** | **重** |
| **WO-SKILL-DEPENDSON-COVER** | `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` ② | `WO-SKILL-REFGRAPH-WIRE`（先把抽取器接上，否则补了数据也没人读） | `apps/agentcore/src/mocks/seed.ts` · `apps/agentcore/test/skill-compiler.seam.test.ts` 里那条计数金丝雀 | 今天 7 个种子技能只有 1 个有 `dependsOn` ⇒ `detectSkillDependencyCycle` 与 `validateRefResolution` 的环检测分支**几乎从不进入**。判据落在「**环检测真被触发过**」：种一个真环 ⇒ 发布被拒且报出环路径。⚠️ 那条金丝雀断言写死了条数，改种子必须同批改它（它就是当年逼出 0→1 那个数的东西） | **中** |
| **WO-GATE-B-BROWSER-HARNESS** | `G-SPLITACCOUNT-PROMISE-ONLY` B-1 + B-4·U8 | 无（**但范围已缩小**，见下） | `scripts/lib/layout-probe.mjs`（在既有 probe 上加能力，**不新造 harness**）· 对应门脚本 | ⚠️ **§8 原文「差真浏览器 harness」已过期，照它派单会重造已有的东西。** 真实缺口只剩两项：① B-1 = 「同一页面两个时刻的 DOM 快照比对」（probe 现在只做单时刻几何）；② B-4·U8 = 「A 盖住了 B 的哪一部分」的 z-order × 矩形相交判定。判据：改一个输入、**不点任何按钮**，断言结果 DOM 在 N ms 内变了 | **中** |
| **WO-QOS-PAGECTX-EVAL** | `G-SPLITACCOUNT-PROMISE-ONLY` B-4·U7 | 无 | agentcore 侧评测集（问题 + 期望要素 + 判分口径） | 断言落在「同屏问答**答得对不对**」，不是「知不知道自己在哪一页」（后者已判） | **重** |
| **WO-R13-ONTOCHAIN-PANEL** | `G-SPLITACCOUNT-PROMISE-ONLY` B-2 充分条件 | **需产品裁决**：今天实测 3 个面板 0 个有对位实现 ⇒ 现状是**不符合**而非判不了，补不补属产品判断 | 待裁决后定 | 待裁决后定 | 待定 |
| **WO-PROMPT-KEY-LINT-DECIDE** | `G-PROMPT-KEYS-CONFIG-ONLY` 的 `skill_summary_lint` | **需治理裁决**：「LLM 辅助审查是发布门的第几道 / 如何不破 R6」 | 裁完再定；结论可能是**删键**而不是接线 | ⚠️ 硬接会造出第二个空转消费方（正是本仓在猎的病）：`skill-lint.ts` 文件头明写本门「机械检查零判断力」且发布门依赖其确定性（R6） | **轻**（裁决单） |

### C · 已闭，无需派单

`G-C08-EXPR-PARAM-SPLIT` · `G-IMPEDIMENT-OPTION-NOJOIN`② · `G-PROVISIONAL-HONESTY-DEAD` ·
`G-OEE-DUAL-TRUTH` · `G-SEAM-GATE-METHOD-BLIND` 残(甲)。**本单已回写 §8。**

---

## 五 · 「可立刻并行派」清单（调度方直接拿）

无前置依赖 + 画像不冲突，**今天就能同时挂出去**：

| 画像 | 同时上限 | 可立刻派 | 单号 |
|---|---|---|---|
| **轻**（只读 + 写文档/门脚本，不跑测试套件） | 不设限（实测 5+ 无压力） | **6 张** | `WO-BEFE-WILDCARD-CLAIM` · `WO-GATE-ROSTER-SWEEP-2` · `WO-ONTO-STATUS-BACKFILL` · `WO-ONTO-DEDUPE` · `WO-ONTO-TRUNCATE-GUARD` · `WO-FACT-USAGE-REGISTRY` |
| **中**（跑 agentcore / frontend vitest） | 2–3 | **3 张，先派 2–3 张** | `WO-PROMPT-KEYS-WIRE` · `WO-SKILL-REFGRAPH-WIRE` · `WO-STEP-VOCAB-UPLIFT` |
| **重**（跑 datacore vitest） | ≤1，gate 跑着时为 0 | **0 张**（两张重单都有前置：一个等产品裁决、一个与它同文件冲突） | — |

⇒ **今天可立刻并行派 9 张**（轻 6 + 中 3），一张重画像都不占。

⚠️ 三张 `WO-ONTO-*` 都改 `docs/SYSTEM-ONTOLOGY.md`，虽是轻画像但**同文件冲突** ——
派的时候串行，或者明确切分到不同章节/不同职责（`STATUS-BACKFILL` 只加标记 ·
`DEDUPE` 只删重复行 · `TRUNCATE-GUARD` 根本不碰本体只写门脚本 ⇒ 后者可与前两张并行）。

---

## 六 · §8 回写清单（本单已做）

按铁律 0「本体不回写即过期失效」就地回写。**只改状态标记与已过期描述，一个断点编号都没动。**

| 行 | 编号 | 改法 |
|---|---|---|
| L1971 | `G-SEAM-GATE-METHOD-BLIND` | 残余(甲) 从「零调用方」改为**已闭**并注明生产调用点与提交；残(乙) 保持 🔴 |
| L2071 | `G-ACTION-NOOP-EXEC` | 实测口径数字 10 型/WIRED 9 → **11 型/WIRED 10** |
| L2073 | `G-C08-EXPR-PARAM-SPLIT` | 🔴 未修 → **✅ 已闭**（DSL param 引用 + 双向发布闸） |
| L2087 | `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` | ② 的「`dependsOn` 仍 0 条」→ **1 条**，定性改为「数据覆盖不足」而非「无数据」 |
| L2103 | `G-IMPEDIMENT-OPTION-NOJOIN` | 缺口② 🔴 未修 → **✅ 已闭**（`decisionPlayLocus` + 前端消费端） |
| L2122 | `G-PROVISIONAL-HONESTY-DEAD` | 🔴 未修 → **✅ 已闭**（生产调用点 + `redline-wired:check`） |
| L2164 | `G-GATE-ROSTER-HANDCOPIED` | 该重复行的过期判负理由订正（名册已现算），状态改为**已被下方行取代** |
| L2166 | `G-OEE-DUAL-TRUTH` | 🔴 未修·等裁决 → **✅ 已闭**（裁决 C 已落地）+ 记上「回写在合并中丢失」这条账 |
| L2169 | `G-SPLITACCOUNT-PROMISE-ONLY` | 保持 ◑，但「差真浏览器 harness」订正为「harness 已建，缺的是它上面的两条能力」 |

**回写后的机器复核（不是我说的，是脚本说的）**：

```
回写前  队列现算：待派 3 · 待复验 6 · 待写WO 17 = 合计 26
回写后  队列现算：待派 3 · 待复验 7 · 待写WO 13 = 合计 23
                                      ↑ 17 → 13
```

**「待写WO 17 → 13」这个跳变本身就是本单的验收证据** —— 它证明那 4 条从来不是欠账，
只是本体停在了修好之前那一刻。（待复验 6→7 是本单自己的 handoff 分支推上去了。）

锚点门 `node scripts/check-ontology-anchors.mjs` 回写前后**都是 RC=0**：
已校准锚点 291 → 305（+14，全是本单新写的带 `(symbol)` 锚点 —— 门自己写着「新增带 symbol 的锚点
无需改基线（鼓励补）」），**未校准存量 89 / 基线 89 逐次未动 ⇒ 基线一次都没被抬**。
全程**没有跑过 `--update`**（那条路会顺手抬基线，属买绿）。

⚠️ **回写过程中被门当场抓到两次，都是我错、门对**（留此为戒，正是「机器先说话」该有的样子）：
1. 我凭印象写了 `(createRule)` / `(updateRule)` / `(recordStep)` 三个**根本不存在**的 symbol，
   门报 `SYMBOL_GONE` 拒绝 `--update` 代劳。真名是 `publish` / `update`，第三个所在方法离锚点 141 行
   （超出 ±40 容差）⇒ 改用「第 N 行」的非锚点写法。
2. 我在订正文字里写进了字面的「🔴 未修」四个字，于是**队列计数不降反不变** ——
   我自己的行文把标记又带回来了。形态：**「我用『我改了状态』当作『标记没了』的证据。」**
   靠重跑抽取器（14 ≠ 13）当场抓出。

---

## 七 · 本单没做的 + 差什么

1. **95 个无状态标记的编号一条都没复核** —— 本单范围是「§8 里标 🔴/◑ 的」，那 95 个不带标记，
   不在射程内。它们是开是闭**今天没有任何人知道**，已开单 `WO-ONTO-STATUS-BACKFILL`。
   **「我没找到」和「它不存在」是两个命题**，本条按前者写。
2. **没有跑任何测试套件**（本单是轻画像），所以上表里凡写「今天成立」的，
   证据都是**读到调用点的条件**，不是「亲手把那条链跑了一遍」。
   四条判「已闭」的都追到了生产调用点与触发条件，但 `G-OEE-DUAL-TRUTH` 的
   接缝测试 S1–S5 我**没有实跑**（重画像），只跑了门 `oee-ssot:check`。
3. **顺带测出一条与本单无关的红**：`node scripts/check-redline-wired.mjs` 今日在集成线上
   **RC=1** —— 但**不是** W1（provisional-honesty 接线那条，那条今天是通的），
   是 **W2 棘轮回潮**：本体 §7 里 `pnpm X` 形式的执行入口，`package.json` 查无此键的
   有 **14 条 > 基线 13 条**。新增的一批被门逐条点名（`validation:check` · `ui-smoke` ·
   `cli-parity:check` 等）。这是「制度上宣称存在、实际不可执行」，另立单，本单不碰。
4. **`G-ACTION-NOOP-EXEC` 与 `G-ADOPT-SCHEME-NO-CARRIER` 的关系没有在 §8 里理顺**：
   前者 ◑ 的**唯一**剩余项就是后者（`check-action-wiring.mjs` 报的那 1 个 NOT_IMPLEMENTED）。
   两行各自成立但读起来像两笔账，收编 `WO-ADOPT-SCHEME-CARRIER` 时应一并合并。
