# AUDIT · 8 份收编台账的横向对账 —— 把过期台账变成当前欠账清单

| 项 | 值 |
|---|---|
| 工单 | **WO-RECLAIM-DOCS** |
| 日期 | **2026-08-13** |
| 分支 | `claude/handoff-wo-reclaim-docs` |
| canonical | `origin/claude/inspiring-gates-aqczjg` @ **`9730a99f`** |
| 性质 | **只读取证 + 只写 `docs/**`**。未跑 `pnpm -r test` / `pnpm -r build` / `scripts/gate.sh` / 任何 datacore vitest |
| 🚦 范围边界 | 只碰 `docs/**`。未碰 `apps/**` / `packages/**` / `scripts/**` |

> **本文存在的理由**：收编回来的 8 份台账，最老的一份基线距 canonical **581 个提交**。
> 一堆两到六天前的判定，若原样躺在仓里被引用，就是**把已解决的病灶当现状**。
> 本文把它们逐条按今天的 canonical 重测一遍，产出的**不是历史，是待办**。

---

## 0 · 工具自证（金丝雀 —— 报任何「0 命中 / 不存在」之前的强制前置）

本文报了 **20 条**否定结论（「符号 0 命中」「文件不存在」），按铁律 0.6 全部配金丝雀，
且金丝雀与主逻辑**共用同一份实现**（`src()` / `allc()` / `blob_at()` 三个函数本体，没有另抄一份正则）。

### 0.1 blob 存在性判别器（判据落在 **RC** 上，不落在 stdout 非空上）

```
PRESENT arm: blob_at(CANON, CLAUDE.md)                       rc=0  sha=de37421730a4  ✅
ABSENT  arm: blob_at(CANON, docs/__canary_definitely_absent_r9__.md)  rc=1  sha=<空>  ✅
NAIVE   arm（反面教材·不带 --verify -q）:
    git rev-parse CANON:docs/__canary_definitely_absent_r9__.md
    → rc=128, stdout='origin/claude/inspiring-gates-aqczjg:docs/__canary_definitely_absent_r9__.md'
VERDICT: PASS
```

**NAIVE arm 就是本仓记载过的那个陷阱的现场复现**：不带 `--verify -q` 时它把**输入串原样吐回 stdout**，
只看 `-n "$out"` 的脚本会把「文件不存在」读成「存在但内容不同」。**判据必须落在 RC 上。**

### 0.2 符号扫描器（正控 + 反控双向）

```
正控 src()  'probeMissingRefs'      = 17 命中  ✅（>0 才允许报 0 命中）
正控 allc() 'check-debattery.mjs'   =  5 命中  ✅
反控        '__r9_ghost_sym__'      =  0 命中  ✅（必须为 0，否则是「什么都命中」）
正控 hits() 'validateClosure'       = 29 命中  ✅
VERDICT: PASS
```

只有正控会被「匹配器把什么都算命中」骗过去，所以反控是必须的。

### 0.3 canonical 路径 / blob 全集（用于改名与有意删除的排查）

```
canon 路径数 = 1836   canon blob 数 = 1834
探针 'CLAUDE.md' 在路径表: True     ghost 'docs/__ghost_r9__.md': False
VERDICT: PASS
```

---

## 1 · 逐分支处置

**判据 4（审计的文件清单会漏）已执行**：每条分支都自己跑
`git diff --name-status $(git merge-base <b> $CANON) <b>` 重列，没有信 `AUDIT-branch-reconcile-2026-08-11.md` 的数字。
**结果：9 条里有 2 条的清单与审计对不上**（见 §1.2）。

### 1.1 捞进来的（8 个文件 · 4732 行）

| 源分支 | tip | 基线距 canonical | 捞的文件 | 判据 |
|---|---|---|---|---|
| `handoff-prd-audit-b2` | `5ef6503c9f` | **581** | `AUDIT-prd-reality-batch1.md`（255 行）· `batch2.md`（937 行）· `AUDIT-sandbox-redesign-gap-2026-08-07.md`（545 行） | 三者在 canonical 均 rc=1；blob 不在 canonical 任何路径下（无改名）；`git log CANON -- <f>` = 0（无有意删除）⇒ 可整取 |
| `handoff-prd-audit-b3` | `ddac597c02` | **581** | `AUDIT-prd-reality-batch3.md`（535 行） | 同上；且 b1/b2/b4/b5 上该文件均 rc=1 ⇒ **独有性成立**，必须单独捞 |
| `handoff-prd-audit-b4` | `dd3e87f9a5` | **581** | `AUDIT-prd-reality-batch4.md`（**444 行**） | 同上。**⚠️ 审计判反了，见 §1.3** |
| `handoff-prd-audit-b5` | `cb494eb02b` | **581** | `AUDIT-prd-reality-batch5.md`（947 行） | 同上；b1/b2/b3/b4 上均 rc=1 ⇒ **独有性成立** |
| `handoff-prd-coverage-full` | `2cdc882d7d` | **472** | `AUDIT-prd-coverage-full-2026-08-09.md`（575 行） | 同上 |
| `handoff-wo-prd-field-audit` | `8ed7727b6f` | **259** | `AUDIT-prd-field-grounding.md`（494 行） | 同上（本批最新的一份） |

**判据 6 已执行**：8 个文件逐个跑
`git log --oneline $(git merge-base <b> $CANON)..$CANON -- <file>` ⇒ **全部为空**，
即 canonical 自分叉起没动过这些路径 ⇒ **整取合法，无需手工合并**。

### 1.2 跳过的 / 拒捞的

| # | 分支 | 处置 | 理由（复验结论） |
|---|---|---|---|
| 24 | `handoff-prd-audit-b1` | **跳过** | 审计说「被 b2 覆盖」——**部分成立**。实测 4 个文件：`batch4.md` 与 `sandbox-gap.md` 与 b2 **blob 全等**；`batch1.md`（123→255）与 `batch2.md`（264→937）b2 是更完整版。⇒ b1 的内容 **100% 落在 b2 ∪ b4 之内**，无独有内容，跳过无损 |
| 61 | `handoff-prd-audit-b4` | **不跳过·必须捞** | 审计说「⊂ b1/b2 ⇒ 可删」，**方向反了**，见 §1.3 |
| 59 | `handoff-onto-writeback-p1` | **拒捞** | ① 它的唯一 ABSENT 文件是 `scripts/dark-launch-baseline.json` —— **不在本单 🚦 范围**（`scripts/`）② 更要紧：**canonical 是有意删掉它的**，不是漏了。证据原文 `scripts/gate-ledger.json:1022`：「旧棘轮基线 `scripts/dark-launch-baseline.json` **已随换判据删除**：那个 15 是 15 个误报，留着等于把误报固化成待还的债」⇒ **捞回来是往仓里塞 15 个已被裁定为误报的债**。它的 `docs/SYSTEM-ONTOLOGY.md` 改动吸收率 **0.88**（25 条新增行已进 22 条），剩 3 条描述的正是这个已被换掉的旧判据 ⇒ 一并拒捞 |
| 44 | `handoff-ontology-context` | **拒捞** | ① 它的 ABSENT 文件全是**源码**（见 §1.4），不在本单 🚦 范围 ② 它的 `docs/SYSTEM-ONTOLOGY.md` 改动吸收率仅 **0.09**（11 条新增行只进了 1 条），未吸收的 10 条写的是「**◐ 地基已闭**：`projectTypeSemantics` / `resolveOntologyContext` / `assembleContextBundle` 已实现」——**而这三个符号在 canonical 上今天 0 命中**（金丝雀 `probeMissingRefs`=17 命中，工具正常）⇒ **把这段本体文字写进 canonical 就是往单一真值源里写一条假话**：本体会声称一条根本不存在的链路已闭 |

> **拒捞不等于「这条分支没价值」**：#44 的**代码半**（4 个 ABSENT 源文件）是真欠账，
> 只是属于别的 🚦 边界，需另立单。本单只负责说清楚「文档半不能这么捞」。

### 1.3 ⚠️ 我要顶回去的第一条：审计 §4.2 关于 b4 的结论**方向反了**

审计原文（`docs/AUDIT-branch-reconcile-2026-08-11.md` §4.2）：

> `handoff-prd-audit-b4` ⊂ `b1`/`b2` | b4 只缺 `AUDIT-prd-reality-batch4.md`，b1/b2 都带 ⇒ **b4 可删**

blob 级实测：

```
b1:docs/AUDIT-prd-reality-batch4.md = 356aaf531a    96 行   （commit 题：「抢救落盘 PRD 对账 batch2/4 中间态」）
b2:docs/AUDIT-prd-reality-batch4.md = 356aaf531a    96 行   （与 b1 全等）
b4:docs/AUDIT-prd-reality-batch4.md = d8184661a1   444 行   （commit 题：「batch4 · 16-22 + 汇总表（全 22 份完）」）

comm -23 <(sort -u 96行版) <(sort -u 444行版)  =  0 行     ⇒ 96 行版是 444 行版的真子集
```

⇒ **是 `b1/b2` ⊂ `b4`，不是反过来。** 照审计「捞 b2、删 b4」会丢 **348 行**
（22 份 PRD 里 16 份的判定全在被丢的那段）。

**形态**（照铁律 0.6 句式）：
> **「审计用『两条分支缺的是同一个文件名』当作『内容互为子集』的证据，而文件名相同并不度量内容相同。」**

这与审计自己在 §4.1 对 `integ-ui-w5` 用的判据（**逐个比 blob 哈希**）是同一件事，
只是 §4.2 这一格**没照做**——它只比了文件名列表。

### 1.4 ⚠️ 我要顶回去的第二条：派单把 2 条**源码分支**写成了「纯文档/PRD 审计」

派单表格把 9 条并列为「纯文档/PRD 审计类欠账分支」。实测其中 **2 条不是**：

| # | 分支 | 派单/审计说 | 实测（自己重列 `git diff --name-status`） |
|---|---|---|---|
| 59 | `handoff-onto-writeback-p1` | 缺 1 个文件 | 改了 **5 个**文件，唯一 ABSENT 的是 **`scripts/dark-launch-baseline.json`**（`scripts/`，非 `docs/`）。另有 `docs/SYSTEM-ONTOLOGY.md`（DIFF，canonical 自分叉起动过 **68 次**）· `package.json`（动过 19 次）· `scripts/gate-ledger.json`（动过 23 次）· `scripts/check-dark-launch-integrity.mjs`（canonical 已有） |
| 44 | `handoff-ontology-context` | 缺 2 个文件 | 改了 **12 个**文件，ABSENT 的是 **4 个**不是 2 个。审计漏列的两个恰恰是**核心实现与契约**：`apps/agentcore/src/router/ontology-context.ts`（引擎侧解析器）与 `packages/contracts/src/ontology-context.ts`（共享契约）。审计只列了 `mocks/type-semantics-fixture.ts` 与 `datacore/src/ontology/type-semantics.ts` |

**这两条都会歪掉排期**：#59 被读成「捞一份文档」，实为「捞一个 canonical 已有意删除的棘轮基线」（应拒）；
#44 被读成「捞两个文件」，实为「一条跨 数据×引擎×契约 三半的完整特性」（该按 SEAM-GATE 整单派，不是文档单）。

---

## 2 · 横向对账表 —— 这 8 份台账里的结论，今天各是什么状态

**读法**：🟢 已解决 = 台账点名的病灶今天在 canonical 上已不存在 ·
🔴 仍在 = 缺口原样还在 · ⚠️ 已变形 = 事实变了或数字失真，**照抄会出错**。

### 2.1 🟢 已解决（4 条）—— 这几条如果照抄进新 PRD，就是把已修的病当现状

| # | 台账原结论 | 今日实测状态 | 证据 |
|---|---|---|---|
| R-1 | **`sandbox-redesign-gap` 的头条结论**：4 个新视图（`chain-line-map`/`transit-flow`/`physical-topology`/`node-inspector`）「今天没有任何入口，**一个都打不开**」，根因是 `BUILTIN_VIEWS` 只有 10 项、四个都不在册 | 🟢 **已解决**（挂载点已补） | `apps/datacore/src/synthetic/view-manifest.ts:87-90` 四项全在册，各带 `featureKey` + `seed:true`。**再追两层**：`apps/datacore/src/synthetic/battery.ts:2680` `scenarioSeed.views = [...SEEDED_VIEW_KEYS]` · `apps/datacore/src/synthetic/service.ts:347` `VIEW_FEATURE_MAP[v]` 派生功能键 ⇒ `ViewPage.tsx` 的 features 闸与 `workspace.views` 闸**两半都能过** |
| R-2 | **`field-grounding` 自称最值钱的 §6.3**：规则 scope 名对不上时，「整条规则被**静默丢掉**：无日志、无报错、无返回值」（`comprehend.ts:214`） | 🟢 **已解决**（静默态已消除） | `apps/datacore/src/databuilder/comprehend.ts:224-225` 现有病史注释「此处**曾经**是 `core.rules.filter(...)`」；`:10` 已 `import { findUnknownScopeTypes, type RuleScopeFinding }`；`:17` 新增字段注释「改前它们在这里被静默丢掉，连下游 HARD 门都看不见」⇒ 改为显式产出 findings |
| R-3 | **`batch4` 对 `PRD-live-traceable-data` 的判定**：P2 半实现，`GET /a/v1/lineage/object/:type/:id` 在后端但缺消费方 | 🟢 **消费方那半已解决** | `apps/frontend-shell/src/api/endpoints.ts:534` 真消费方 + `apps/frontend-shell/src/mocks/handlers.ts:1636` mock。端点行号从 `app.ts:2496` 漂到 **`:2879`** |
| R-4 | **`coverage-full` §0.3② 的自纠**：`apps/datacore/src/pipeline/service.ts` 差点被误报成死代码 | 🟢 该文件确实存在（8770 字节）⇒ 台账的**自纠是对的** | `ls -la apps/datacore/src/pipeline/service.ts` |

### 2.2 🔴 仍在（16 条）—— 这就是从 8 份过期台账里析出的**当前欠账清单**

**全部配了金丝雀**（`probeMissingRefs`=17 / `check-debattery.mjs`=5 命中，ghost=0）。
扫描范围 = `apps/agentcore/src apps/datacore/src apps/frontend-shell/src packages/contracts/src packages/llm-adapters/src`。

| # | 来源 | 台账原结论 | 今日 src 命中 | 定性 |
|---|---|---|---|---|
| G-1 | batch3 | `deriveDag`（8a 核心：DAG 从 ExecutionPlan 派生）未实现 | **0** | 🔴 没接线 |
| G-2 | batch3 | `termAlias` / `industryAlias`（8c 行业别名）未实现 | **0 / 0** | 🔴 没接线 |
| G-3 | batch1 | 数据工坊页 `/admin/data-forge` 未实现 | `DataForge` = **0** | 🔴 没接线 |
| G-4 | batch1 | MCP 按需加载：`load_tools` 工具不存在 | **0** | 🔴 没接线 |
| G-5 | batch1 | 审计字段 `AgentRunRecord.loadedTools` 不存在 | **0** | 🔴 没接线 |
| G-6 | batch1 | 等价能力组 `capabilityGroup` / `groupPriority`「连数据模型都没有」 | **0 / 0** | 🔴 没接线 |
| G-7 | batch2 | 关键词路由到 `plan_audit`：`KEYWORD_SOLVER` 全仓零命中 | **0** | 🔴 没接线 |
| G-8 | batch2 | CLI 自动派生器 `deriveOperationCatalog` / `OPERATION_REGISTRY` 未建 | **0 / 0** | 🔴 没接线 |
| G-9 | batch2 | `Base.capexWan` 全仓零命中 | **0** | 🔴 没接线 |
| G-10 | batch2 | 声明式渲染契约 `ViewDefSchema` 零命中 | **0** | 🔴 没接线 |
| G-11 | batch2 | `Base.attainment_daily` src 零命中 | **0** | 🔴 没接线 |
| G-12 | batch2 | 自愈事件 `datagap.detected` / `datagap.healed` 零命中 | **0** | 🔴 没接线 |
| G-13 | batch2 | `agent.reflected` 事件在 agentcore/src 零命中 | **0** | 🔴 没接线 |
| G-14 | batch2 | 中途目标检查 `goalCheck` / `dispatchId` 全域零命中 | **0 / 0** | 🔴 没接线 |
| G-15 | batch4 | `GET /api/v1/queries/:taskId/trace` 是**孤儿端点**，前端零消费方 | 端点在（`server.ts:463`）；全前端 `src` 里 `/queries/*/trace` **仍 0 个消费方**，唯一咬它的仍是 `apps/agentcore/test/trace-endpoint.test.ts` | 🔴 **只有 test 引用 = 已排练，不是已实现** |
| G-16 | batch4 | `InferenceProcessDag.tsx` 的 `NODES` 硬编码（违 PRD「前端零写死步骤」） | `:18` 仍是字面量数组 | 🔴 仍在 |

> **G-1…G-14 全是「没接线」形态**（符号在 src 里根本不存在），**不是**「接了线没数据」，
> 修法是**建**不是**补数据**。这个三分法定性是台账自己做的，今天复测后仍成立。

### 2.3 ⚠️ 已变形（8 条）—— 事实变了或数字失真，**照抄必错**

| # | 来源 | 台账原文 | 今日实测 | 为什么危险 |
|---|---|---|---|---|
| D-1 | batch5 | 推演沙盘 `views/sim/**` = **36 文件 / 15,261 行** | **49 文件 / 26,725 行** | 涨了 75%。台账用这个数反驳「沙盘从没开工」，**论点更强了**，但**数字本身不能引用** |
| D-2 | batch5 | `packages/contracts/src/chain-sim.ts` **596 行** | **1195 行** | 翻倍 |
| D-3 | coverage-full | 覆盖 `docs/` 下**全部 147 份** PRD；`ls docs/*.md` = **237** | canonical 树 `docs/*.md` = **286**；`docs/PRD-*.md` = **133** + `docs/industrial-prd/PRD-*.md` = **12**（合 145） | **它自称的「100% 覆盖」对今天不成立**——分母涨了，新增的没被审过 |
| D-4 | field-grounding | 语料 **129** 份 main PRD + **12** 份 industrial | **133** + **12** | 分母变了 ⇒ 该文全部百分比需重算 |
| D-5 | batch1 | `OPERATION_CATALOG` **39 条**（`operation-intent.ts:53`） | 行号锚点仍准（`:53`），条目数已是 **40** | 「11/39 已实现」这个比值的分母变了 |
| D-6 | batch2 | `scripts/check-cli-parity.mjs` 门已造好但**零调用方** | 事实**仍成立**：不在 `package.json:33` 的 `"gates"` 37 条链里；`grep -rn "check-cli-parity\|check-validation" .github/ scripts/gate.sh` **RC=1 / 0 命中**（金丝雀：同一文件查 `pnpm` 命中 13 处，工具正常）。但已从「隐形」变为「**两道机制在盯**」：`scripts/redline-wired-baseline.json` 棘轮把 `cli-parity:check` 明列进 `_knownPhantoms`（`phantomEntrypointCount: 13`）；`scripts/gate-ledger.json:156` 记 `binding:"NONE"` + `disposition:"WIRE"` | 照抄会说「没人知道这个门没接」——**今天有机器在盯了**，欠账的性质从「假绿」降级为「已记账的待办」 |
| D-7 | batch2 | `scripts/check-validation.mjs` 脚本已建，**零生产调用方** | 同 D-6：仍未接，但已进同一份棘轮（「`validation:check` → 存在，缺 `package.json` 别名」） | 同上 |
| D-8 | 多份 | 大量 `file:line` 锚点 | 抽查 24 条中 **7 条行号已漂**（`platform-cli.mjs` 511→522 · `simclock.ts` 132→54 · `app.ts` 742→764 · `server.ts` 455→463 · `app.ts` 2496→2879 · `registry.ts` 85→92/91→98 · `comprehend.ts` 214→224），**符号全部仍在** | 行号锚点**几乎全废**，符号锚点**几乎全准**。⇒ 引用这些台账时**按符号找，别按行号找** |

### 2.4 覆盖声明 —— 做到第几条（不静默截断）

| 项 | 数 |
|---|---|
| 收编文档 | **8** 份 / **4732** 行 |
| 8 份里带「结论**：」标记的判定总数 | **99** 条（batch1 13 · batch2 22 · batch3 22 · batch4 22 · batch5 17 · coverage-full 1 · field-grounding 2 · sandbox-gap 0，后者用 §0 头条 + 逐项证据链而非「结论」标记） |
| 本次**亲手重测**的断言 | **24** 条（每份 3 条，含每份最核心的那条） |
| 本次重测的符号级否定结论 | **20** 个符号 |
| 覆盖率 | **24 / 99 ≈ 24%** |

> **⛔ 剩下的 75 条判定，本次一条都没有重跑。**
> 「我没重测」≠「它已失效」，也 ≠「它仍成立」——这两个命题都不成立，它就是**未知**。
> 每份文档的横幅里都写了这句，不许被读成「已全量复验」。
>
> **为什么只做 24 条**：抽查是按「每份挑 3 条**最核心**的」选的，不是随机取样。
> R-1（沙盘头条）与 R-2（field-grounding 自称最值钱的一条）都是这么抽出来的，
> 而这两条恰好都**已解决** —— 这说明**越是当年最痛的那条，越可能已经被修了**，
> 也就越危险（照抄的代价最大）。剩下 75 条按同样的逻辑，大概率**没那么痛、也就没那么可能被修**。

---

## 3 · 本体引用与影响

**本单不改任何链路 / 事件 / 对象类型 / 不变量 / 门禁**，故**不回写** `docs/SYSTEM-ONTOLOGY.md`。

- **触及的对象类型**：无（纯文档收编）。
- **触及的链路**：无新增。§2.1 R-1 复验时**读过**「`BUILTIN_VIEWS` → `SEEDED_VIEW_KEYS` → `scenarioSeed.views` /
  `VIEW_FEATURE_MAP` → `ViewPage` 双闸」这条既有链路，但只读未改。
- **触及的不变量 / 门禁**：无。
- **⚠️ 明确拒绝的一次本体回写**：`handoff-ontology-context` 分支的 `docs/SYSTEM-ONTOLOGY.md` §8
  带一条 `G-ONTOLOGY-CONTEXT-VOID` 断点，自述「**◐ 地基已闭**」并点名三个实现符号。
  实测这三个符号在 canonical 上 **0 命中**（金丝雀通过）⇒ 写进去会让本体**声称一条不存在的链路已闭**。
  按铁律 0「本体是单一真值来源」，宁可不写，也不能写假。
  该断点若要入本体，正确姿势是**先合代码半、再回写**，且状态写 `🔴 未闭` 而非 `◐ 已闭`。

---

## 4 · 本单自己踩到并当场纠正的坑（照铁律 0.6 记账）

三条都是同一个形态：**「我用 X 当作 Y 的证据，而 X 并不度量 Y。」**

| # | 我差点报出的错误结论 | X（我拿来当证据的） | Y（我真想度量的） | 怎么发现的 |
|---|---|---|---|---|
| ① | 「`opsteam/replay.ts` 的 R1 红线『零 Store/Repo import』**已被破**」 | `grep -c "^import.*\(Store\|Repo\)"` = **1** | 有没有 import Store/Repo **类** | 追一层看命中原文：命中的是 `import type { OpsAction, OpsPlaybook, OpsTickReport }` —— **`Repo` 是 `Report` 的子串**。红线**未破** |
| ② | 「`batch4` 说的『前端零消费方』已不成立，前端已接 trace」 | `grep -cn 'trace' endpoints.ts` = **7** | `/queries/*/trace` **这一个端点**有没有消费方 | 逐条看那 7 条：1 条注释 + sim tick 的 `trace?` 字段 + `decision-trace`（**另一个端点**）+ `promoteFallback(traceId)`，**没有一条是 `/queries/*/trace`**。金丝雀：同一命令查 `decision-trace` 命中 3 处（工具正常，不是搜不到）⇒ 台账结论**仍成立** |
| ③ | 「canonical 上 `docs/*.md` 有 **294** 份」（写进了 D-3 与 coverage-full 的横幅） | `ls docs/*.md \| wc -l` = 294，在**工作树**里数的 | **canonical 树**里有多少份 | 数的时候本单 8 份文档已经 checkout 进工作树了 —— **我把自己刚放进去的东西数进了「现状」**。改用 `git ls-tree -r --name-only <canonical> -- docs/` 直接数树，得 **286**。两处已订正 |

**①② 都发生在「命中数 > 0 就想收工」的那一刻；③ 发生在「忘了自己已经改过被测对象」的那一刻。**
铁律 0.5 的老话在这里换了两个方向仍然成立：

> **grep 报 0 会骗你，grep 报非 0 一样会骗你 —— 命中数不是证据，命中的那一行才是。**
> **而且：在自己动过的工作树上数「现状」，数的是自己。测量对象被自己污染时，工具再对也没用。**

③ 尤其值得写进这里，因为**它是在本单执行「凡数字必自证」这条纪律的过程中犯的** ——
横幅里明明写着「基线 sha · 距 canonical 多少提交」，我却在同一份文档里用工作树的数当 canonical 的数。
**纪律写在文档里不是机制。** 真正拦住它的是「换个独立口径（`git ls-tree`）复算一遍」这个动作。

---

## 5 · 处置建议（我一条都没删分支，全部交裁决）

| 建议 | 对象 | 理由 |
|---|---|---|
| **可删** | `handoff-prd-audit-b1` | 内容 100% 落在 b2 ∪ b4 内（blob 级已验），无独有内容 |
| **⛔ 不可删** | `handoff-prd-audit-b4` | 审计判反了。它带的 444 行完成版是 b1/b2 那 96 行的严格超集 |
| **可删** | `handoff-prd-audit-b2` / `b3` / `b5` / `prd-coverage-full` / `wo-prd-field-audit` | 内容已 100% 收编进本分支（8 个文件逐个 blob 已在） |
| **另立单（非文档）** | `handoff-ontology-context` | 代码半是真欠账，跨 数据×引擎×契约 三半 ⇒ 按 SEAM-GATE **一个 dev 整单做**，不许拆两半 |
| **建议直接判「已过期·可删」** | `handoff-onto-writeback-p1` | 它的唯一 ABSENT 文件是 canonical **有意删除**的棘轮基线（`gate-ledger.json:1022` 写明「那个 15 是 15 个误报」）⇒ 不是欠账，是回退 |
| **建议照 §2.2 建 16 张单** | G-1…G-16 | 这是本单最有用的产出：16 条今天仍成立的缺口，全部带符号级证据与三分法定性 |
