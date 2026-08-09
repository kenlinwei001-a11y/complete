# AUDIT · 全部 PRD 的「写了没做 / 做了没验」100% 对账（2026-08-09）

| 项 | 值 |
|---|---|
| 工单 | **WO-PRD-COVERAGE-FULL** |
| 性质 | **纯对账 · 只读取证 · 不改一行代码** |
| 取证基线 commit | **`c45f1eba1167960085f12cb7686c4dae5af46f91`**（= `origin/claude/inspiring-gates-aqczjg`，canonical） |
| 分支 | `claude/handoff-prd-coverage-full` |
| 覆盖范围 | `docs/` 下**全部 147 份** PRD 类文档 |
| 未跑 | `scripts/gate.sh` · `pnpm -r test` · 任何 datacore vitest（工单禁令） |

> **所有 `file:line` 只对 `c45f1eb` 有效。** 换 commit 必须重取证。

---

## 0 · 起手纪律与工具自证（铁律 0.5 / 0.6）

### 0.1 我一开始站错了分支 —— 用祖先关系判出来的

worktree 默认停在 `778cc589`。按工单给的判据实测：

```
$ git merge-base --is-ancestor HEAD origin/claude/inspiring-gates-aqczjg
ANCESTOR=YES 落后必须重开
```

`HEAD` 是 canonical 的**祖先** ⇒ 落后。已从 canonical 重开分支后再取证。
**注意这条判据救了整单**：若按"文件存在性"判，`docs/PRD-frontend.md` 在两版都在，探针恒真，
我会在一棵旧树上把已并线的东西读成"不存在"。

### 0.2 金丝雀（报任何否定结论前的强制自证）

| 工具 | 金丝雀（已知必中） | 结果 | 反向金丝雀 | 结果 |
|---|---|---|---|---|
| `ls docs/*.md` | — | **237** 份（三位数）✅ | — | — |
| 锚点扫描器 · src | `/a/v1/` | HIT `apps/agentcore/src/auth.ts:32` ✅ | `registerRoutes` | **MISS ⇒ 当场报「工具坏了」**（见 0.3①） |
| 锚点扫描器 · src | `outbox.emit` | HIT `apps/datacore/src/actions.ts:600` ✅ | — | — |
| 锚点扫描器 · test | `describe(` | HIT，575 个测试文件 ✅ | — | — |
| 锚点扫描器 · scripts | `process.exit` | HIT ✅ | — | — |
| 符号探针 `symprobe` | `PlanStep` | **4+** src 命中 ✅ | `ZZZ` 类不存在符号 | 0 ✅ |
| 路由抽取器 | 抽到 **406** 条注册路由 | ✅ | — | — |
| 路由匹配器 | `/a/v1/tenants` → `adminplatform.ts:138` | ✅ | — | — |
| 测试信号器 | `order_fullchain` 命中 3 个测试文件 | ✅ | — | — |
| 文件存在探针 | `package.json` PRESENT | ✅ | `zzz-nope.ts` ABSENT | ✅ |
| 原型 HTML 判别器 | `buildRisk` / `<script` in 459KB HTML | ✅ | — | — |

**本文所有「0 命中 / 未实现 / 零调用方」结论，都配了上面这排金丝雀。**

### 0.3 ⚠ 我自己在本单里踩中并当场纠正的 **5 个工具陷阱**（照铁律 0.6 记账）

全部是同一个形态：**「我用 X 当作 Y 的证据，而 X 并不度量 Y。」**

| # | 我差点报出的错误结论 | X（我拿来当证据的） | Y（我真想度量的） | 怎么发现的 |
|---|---|---|---|---|
| ① | —（未出报告） | 金丝雀 `registerRoutes` | 「扫描器工作正常」 | 金丝雀 MISS ⇒ 报「工具坏了」。**本仓根本没有 `registerRoutes` 这个符号**，是我凭印象编的。金丝雀机制当场生效 |
| ② | 「`apps/datacore/src/pipeline/service.ts` 是死代码」 | 该**路径字符串**在 src 文件**内容**里 0 命中 | 该**文件**在不在磁盘上 | 该文件真实存在。已改为**路径型锚点用 `existsSync` 判**，不用内容匹配 |
| ③ | 「一批 PRD 实现率恰好都是 0.5」 | 被 `slice(0,14)` **截断后**的 srcSym/deadSym 之比 | 真实实现比例 | 大 PRD 两端都撞到 14 上限 ⇒ 比值恒 ≈0.5。已**去掉截断**重算 |
| ④ | 「IND 系列 12 份 PRD 大面积未实现」（deadSym 高达 53） | 死锚点总数（含 `buildDash`/`odNodes`/`renderProbDrill` 等） | 系统侧交付物缺不缺 | 这些是**参考原型 HTML 的函数名**，本就不该在 src 里存在。已用 `docs/reference-prototype-decision-platform.html` 做判别器**剔除原型侧符号**。剔除后 `PRD-IND-plan-generate.md` 的真·系统侧死符号从 16 变成 **0** |
| ⑤ | 「`/a/v1/tenants/{id}/users` 未实现」 | 该路由字符串在 src 里 0 命中 | 该路由注册没注册 | PRD 写 `{id}`、src 写 `:id`，**字符串永不相等**。已把**路由型锚点**改由「注册模式编译成正则」的匹配器判，并自证 `/a/v1/tenants` 能匹配上 |

> ③④⑤ 是**同一个错的三次复发**（都是"拿一个看起来相关的计数当判据"）。按铁律 0.6，
> 第 2 次就该建机制 —— 我建的机制是：**每类锚点必须声明"用什么判据判"，
> 且判据必须先跑一个已知必中的样例**。上表第 5 列就是那些样例。

### 0.4 我**没有**建立机制的地方（诚实标注）

上述判别器全在 `/tmp` 的一次性脚本里，**没有落成仓内的门**。工单 🚦范围边界禁止我改 `scripts/*`。
若要把本文变成可复跑的门，需另开一单。**本文的数字下次会过期，且没有机器会提醒你。**

---

## 1 · 第 1 步 · PRD 全集（147 份）

### 1.1 纳入判据

`ls docs/*.md | wc -l` = **237**（金丝雀通过：三位数，不是 0）。237 份里按下述判据取 **147** 份：

| 纳入 | 数量 | 判据 |
|---|---:|---|
| `docs/PRD-*.md` | **126** | 文件名即声明自己是 PRD |
| `docs/industrial-prd/PRD-IND-*.md` | **12** | 工业级 1:1 复刻 PRD，独立目录但性质是 PRD |
| `docs/SPEC-*.md` | **5** | **算**。`SPEC-industrial-skill` / `SPEC-optimization-template-pool` / `SPEC-sandbox-propagation-and-session` / `SPEC-sandbox-readiness-certification` / `SPEC-trust-traceability-interaction` —— 五份都写了"可照抄的工程规格 + 验收"，与 PRD 同构，只是名字不同 |
| `docs/ARCH-*.md` | **4** | **算**。四份都含"要改什么 / 红线 / 落地顺序"，是**架构决策型 PRD**；但它们不产独立代码交付物（见 §2 ①类） |
| **合计** | **147** | |

### 1.2 **不**纳入的 90 份及理由

| 类 | 例 | 为什么不算 PRD |
|---|---|---|
| 工单（WO-*） | `WO-TESTGAP-AUDIT.md` · `docs/wo/*.md`(17) | 是**施工单**，其需求源头是某份 PRD；纳入会与源 PRD 重复计数 |
| 审计/取证报告（AUDIT-/ASSESS-/REVIEW-/VERIFY-） | `AUDIT-zombie-and-orphan-code.md` | 是**对系统的观察**，不声明交付物 |
| 台账/索引（LEDGER/ROADMAP/TODO/HANDOFF-） | `HANDOFF-LEDGER.md` · `COMPLETION-LEDGER.md` | 是**过程记录** |
| 本体/协议/规范 | `SYSTEM-ONTOLOGY.md` · `TESTING-STANDARD.md` · `OPERATING-MODEL.md` | 是**元模型/纪律**，不是需求 |
| 数据/测试资料 | `DATA-scenario-genome-20cards.md` · `TEST-PLAYBOOK.md` | 资料 |
| 模板 | `_PRD-TEMPLATE.md` | 空壳 |

> **边界争议自陈**：`PRD-IND-plan-generate.md`（industrial-prd/）与 `PRD-IND-plan-generate-1to1.md`（docs/）
> **内容几乎完全相同**（我实测两者 srcSym/deadSym/ratio 全部一致：16/16/0.48→修正后同为 0）。
> 这是**一份 PRD 存了两处**。我按文件计为 2 份（保持"147"可复现），但**实际独立需求是 146 条**。

---

## 2 · 第 2 步 · 逐份判「有没有开发」

### 2.1 判据与它的诚实边界

对每份 PRD 抽取**锚点**（反引号里的标识符 / 契约类型名 / 事件名 / 路由 / 文件路径），
再按锚点类型分别判：

| 锚点类型 | 判据 | 为什么不能用别的 |
|---|---|---|
| 符号（`compileGraph`/`SkillOutcomeStat`） | 在 `apps/*/src`、`packages/*/src`、`scripts/` 的**非测试**文件里字符串命中 | — |
| 文件路径（`apps/datacore/src/pipeline/service.ts`） | **`existsSync`** | 内容匹配会把真实存在的文件报成死（陷阱②） |
| 路由（`/a/v1/tenants/{id}/users`） | **注册模式编译成正则**去匹配 | `{id}` vs `:id` 字符串永不相等（陷阱⑤） |
| 原型 HTML 符号（`buildDash`/`odNodes`） | **剔除**（用 459KB 原型文件做判别器） | 它们本就不该在 src 里存在（陷阱④） |

> **⚠ 这个判据度量的是「PRD 点名的构件在不在」，不是「PRD 的意图实现了没有」。**
> 一份 PRD 可以构件全在、意图仍未达成（见 §2.4 `attainment:base`）。
> 所以下表的定性是**该 PRD 主体交付物的态**，逐构件态见「系统侧死符号」列。

### 2.2 五档分布（147 份）

| 定性 | 份数 | 说明 |
|---|---:|---|
| **①流程/索引/审查/规格类** | **21** | 无可施工代码交付物（路线图 / 索引 / 审查报告 / 仅设计延后）。不进下面三档 |
| **②主体已实现已接线** | **60** | 主体构件有 src 生产命中，且追一层确认真被调到 |
| **③部分**（含三种"接了线但…"） | **58** | 主体在、部分构件缺；或接了线没数据；或挂错路径 |
| **④主体未实现** | **8** | 核心交付物全仓 0 命中 |
| **合计** | **147** | 21+60+58+8 |

### 2.3 ④ 主体未实现（8 份 · 全部逐条追过一层）

| PRD | 声称的核心交付物 | 契约里有吗 | 代码里有吗 | 生产调用方 | 定性 |
|---|---|---|---|---|---|
| `PRD-skill-compiler-registry.md` | 七段编译流水线 DSL→Parser→AST→Validator→Optimizer→ExecGraph→RuntimePackage + `dos skill` CLI | ❌ | **38 个系统侧符号全 0**（`SkillRuntimePackage`/`SkillPackageManifestSchema`/`SkillCompileReportSchema`/`skill.compiled`…），**16 条声称路由未注册** | — | **未实现**（唯一落地的是 Validator = `lintSkill`，见 §2.5） |
| `PRD-skill-contract-dsl.md` | Skill 声明外壳（`businessIntent`/`requires.*`/`outputEnforcement`/`trigger.slots`/`execution.mode`） | 部分 | **34 个符号全 0** | — | **部分未实现**（已实现的 8 个字段见 §2.5 引用） |
| `PRD-skill-governance-learning.md` | 治理学习闭环（`SkillExecutionTrace`/`SkillOutcomeStat`/`HumanCorrection`/`promptRefs` + `skill.trace_recorded` 等事件） | ❌ | **30 个符号全 0** | — | **未实现** |
| `PRD-skill-runtime-orchestrator.md` | Reasoning Graph 运行时（`compileGraph`/`GraphScheduler`/`ReasoningGraph`/`reasoningGraphRun`/`SkillBudget`） | ❌ | **20 个符号全 0**（我亲手复验 5 个，见 §2.5） | — | **未实现** |
| `PRD-addendum-excel-seed-700B-expansion.md` | 700 亿规模数据扩充：`daily_capacity`/`weekly_kit`/`monthly_gap` 剧本 + `MonthlyDemand`/`WeeklyDemand`/`DailyPlan`/`MonthlyCapacity`/`DailyOEE` 等对象类型 | ❌ | **31 个符号全 0** | — | **未实现** |
| `PRD-ontoflow-data-builder.md` (v1) | 可视化数据建模流水线（`PipelineService`/`pipeline_graphs` 表 / 6 条 `/a/v1/pipelines/*` 路由） | ❌ | `PipelineService`=0 · `pipeline_graphs`=0 · **7 条路由未注册** | — | **未实现 —— 但是被 v2 取代，见 §5.2。不是欠账** |
| `PRD-addendum-capability-routing.md` | `load_tools` / `capabilityGroup` / 等价能力故障转移 | ❌ | 3 个符号全 0（唯一命中 `argHints`） | — | **未实现** |
| `PRD-seam-arg-drop-audit.md` | `sys.scenario.launch` 链路的丢参彻查 | ❌ | 链路名 0 命中 | — | **未实现**（该 PRD 只有 1 个可测锚点，信号极弱，标为**低置信**） |

### 2.4 ③ 部分 —— 三种"接了线但…"的**实测样本**（各给一例，全部亲手追过一层）

| 形态 | 实例 | 证据 | 修法 |
|---|---|---|---|
| **接了线没数据** | `Skill.maxBudgetRounds` | 契约 `packages/contracts/src/agentcore.ts:260` 有字段；**src 生产命中只有这一处声明本身**；测试 `apps/agentcore/test/skill-contract.test.ts:65,77` 断言字段能存能读 ⇒ **零生产消费方**，预算从未被执行器用上 | 接消费方 |
| **接了线没数据** | `CausalFactor.boundMetricKeys` | 读处 `apps/datacore/src/app.ts:2449`，`metricsAffected` 由它算（`:2451`）；但**全 src `boundMetricKeys =` 写入方 = 0** ⇒ 顶层 Metric 归因**恒为空**，代码注释自陈"未种则 pending 不编"（`:2460`） | 补写入方 |
| **有数据没接消费方** | `attainment:base` 基地级日达成率 | 产出侧已接线：`apps/datacore/src/synthetic/battery.ts:2663` 定义序列，链路测试 `apps/datacore/test/attainment-base-daily.test.ts` 断言 seed→物化→agg-query 通；**但全仓 `attainment:base` 的引用只有这 1 处 src + 该测试自己** ⇒ **没有任何求解器/视图消费它**。PRD 的目的「回答本月逐日为何未达成」**未达成** | 接归因消费方 |
| **接了线接错地方**（文档侧） | `PRD-demand-pulled-growth-engine` 的 6 条路由 | PRD 写 `/a/v1/growth/*`（DataCore）；实现在 **`/api/v1/growth/*`（AgentCore）**：`apps/agentcore/src/server.ts:224/239/288/293/313` ⇒ **能力在、PRD 的前缀写错了** | 改 PRD，不改代码 |

### 2.5 Skill/Agent 14 份 —— **引用**既有对账 + 抽验 5 条

工单指定的 14 份直接引用 `docs/RECONCILE-skill-agent-prd-2026-08-09.md`（分支 `origin/claude/handoff-skill-agent-reconcile`）。

**该报告的基线仍然有效 —— 我实测过，不是假设**：

```
$ git merge-base --is-ancestor 319d6e94 HEAD   → 是祖先 ✅
$ git diff --name-only 319d6e94..HEAD          → 只有 CLAUDE.md
```

其取证基线 `319d6e94` 是我基线 `c45f1eb` 的祖先，两者之间**只差 `CLAUDE.md` 一个文件**，
**零 `apps/`/`packages/` 改动** ⇒ 它的全部 `file:line` 对我的基线**逐字有效**。

**抽验 5 条（工单要求 ≥3），全部复现**：

| # | 它的结论 | 我的复验 | 结果 |
|---|---|---|---|
| 1 | `maxBudgetRounds` 零生产消费方 | src 命中仅 `agentcore.ts:260`（声明本身）；test 2 处 | ✅ 一致 |
| 2 | `compileGraph`/`GraphScheduler`/`ReasoningGraph`/`reasoningGraphRun` 全 0 | 四个全 0；金丝雀 `PlanStep` = 4+ 命中，证明工具正常 | ✅ 一致 |
| 3 | `lintSkill` 已接线，发布门真调且传了 `allSkills`+`requirePublishedDeps` | `apps/agentcore/src/skill-lint.ts:234` 定义；`apps/agentcore/src/server.ts:1246` 调用，实参确含两者 | ✅ 一致（**逐字符核过实参**） |
| 4 | `RuntimePackage`/`SkillManifest` 零实现 | 两者全 0 | ✅ 一致 |
| 5 | CLI `dos skill` 零实现 | 我另测：`/b/v1/skills/:id/compile`、`/package`、`/promote`、`/deprecate`、`/rollback` **五条路由全部未注册** | ✅ 一致，且补强了它的结论 |

---

## 3 · 第 3 步 · 逐份判「开发了有没有复验」

### 3.1 ⚠ 先说一个我**放弃使用**的指标

我最初对每份 PRD 统计"咬它的测试文件数"。实测 `PRD-impediments-reachable.md` 的值是 **575 —— 全仓每一个测试文件**。
原因：它的锚点里有 `ViewConfig` 这种满仓通用词。**这个数不度量覆盖，只度量锚点有多普通。**
已按铁律 0.6 弃用，改用**区分性锚点**（在 ≤20 个测试文件里出现的锚点）重算。

### 3.2 结果

| 指标 | 值 | 判据 |
|---|---:|---|
| **零测试**（PRD 的全部区分性锚点在 575 个测试文件里 0 命中） | **0 份** | — |
| **有测试但只咬函数**（咬它的测试里**没有一个是 seam 测**） | **5 份** | 见下表 |
| 有 seam 测 | 141 份 | — |
| 无任何代码锚点（纯流程文档） | 1 份（`PRD-maturity-master-plan.md`） | — |

**「零测试 = 0 份」这个数会骗人**，必须配这句：它是**PRD 粒度**的。
**构件粒度**上，本单实测 **460 个** PRD 点名的系统侧构件在全仓 0 命中 —— 它们按定义**一个测试都没有**。
PRD 粒度全绿、构件粒度 460 个洞，正是本仓"绿测试≠能用"的形状。

### 3.3 有测试但只咬函数的 5 份

| PRD | 咬它的测试 | 咬的是函数还是链路 | seam | 变异反证 |
|---|---|---|:--:|:--:|
| `PRD-addendum-dataflow-loop-closure.md` | 8 个（`admin-closure.test.ts` / `domain-events.test.ts`…） | **函数**（事件名能发能收，未驱动跨模块流转） | ❌ | ❌ |
| `PRD-addendum-lived-in-state.md` | 1 个（`datacore/test/livedin.test.ts`） | **函数** | ❌ | ❌ |
| `PRD-addendum-replay-orchestrator.md` | 3 个（`replay-ops.test.ts` / `trace-endpoint.test.ts`） | **函数** | ❌ | ❌ |
| `PRD-addendum-skill-authoring.md` | 6 个（`skill-probe.test.ts` / `runtime-workflow.test.ts`） | **函数** | ❌ | ❌ |
| `PRD-addendum-validation-loop.md` | 2 个（`vle.test.ts` / `a15-operation-classify.test.ts`） | **函数** | ❌ | ❌ |

> 五份**全部**是 `PRD-addendum-*` 系列 —— 即"遗留 PRD 追溯补录（治理 #2）"那一批。
> 形态一致：**能力是真的、测试是真的、但没有一条测试驱动它声称的那条链路**。

### 3.4 复核 `docs/WO-TESTGAP-AUDIT.md` 是否过期 —— **结论：清单没过期，但它的"实现在不在"需要重判**

该文档基线是 `origin/claude/wave4-integration @ c0b7ee0d`（2026-08-06），我基线是 3 天后的 `c45f1eb`。

**实测它列的 22 个缺失测试文件，今天 canonical 上仍然 `0/22` 存在**（`existsSync` 逐个探，
配 `package.json` PRESENT / `zzz-nope.ts` ABSENT 双向金丝雀）。**清单一条没补，完全没过期。**

抽验它的 E 类（"实现也不在正线"）判定今天是否仍成立：

| 它的判定 | 我今天实测 | 是否仍成立 |
|---|---|---|
| `cf-oee-deficit` 全仓 0 | 0 | ✅ |
| `ActionPropagationRule` 全仓 0 | 0 | ✅ |
| `propertyPolicy` 全仓 0 | 0 | ✅ |
| `plan_builder` 全仓 0 | src 0（仅 `scripts/check-migration-numbering.mjs:11` + `gate-ledger.json` 提及） | ✅ |
| `classifier-failsafe` / `nl-solver-route` / `gray-node-*` 全 0 | 全 0 | ✅ |
| `synthetic/ontology-readability.ts` 整文件缺 | 仍缺 | ✅ |
| `boundMetricKeys` "只有前向兼容读处，零写入方" | **仍是零写入方**，但**新增了一个咬它的测试** `apps/datacore/test/ext-signal-references.test.ts:7,12,43` | ⚠ **半过期**：该文档写这条时该符号在测试语料里没有；今天有了。结论方向不变（仍是"接了线没数据"），但"零测试"那半已不准 |
| `demand_attain_2026-Q1` 全仓 0 | 精确串仍 0（`demand_attain` 前缀有 4+ 命中，属别的东西） | ✅ |

**判定：`WO-TESTGAP-AUDIT.md` 主体结论仍然有效，只有 `boundMetricKeys` 一条需要打补丁。**

---

## 4 · 第 4 步 · 汇总

### 4.1 四个数

| | 值 |
|---|---:|
| **PRD 总数** | **147**（其中 21 份是流程/索引/审查/仅设计类，无可施工代码交付物） |
| **已实现已接线** | **60** |
| **部分（含三种"接了线但…"）** | **58** |
| **未实现** | **8** |

补充两个数：

| | 值 |
|---|---:|
| **有测试但只咬函数**（零 seam 测） | **5 份** |
| **零测试** | **0 份**（PRD 粒度）／ **460 个构件**（构件粒度，全仓 0 命中 ⇒ 按定义无测试） |

### 4.2 最该先补的 10 份（按「用户可见性 × 修复成本」排序）

| # | PRD / 具体缺口 | 用户可见性 | 修复成本 | 一句话理由 |
|---:|---|---|---|---|
| 1 | **`PRD-attainment-base-daily-timeseries`** — `attainment:base` 有数据零消费方 | 高 | **极低** | 序列已生成、已测、已可查；只差一个归因消费方。用户问"本月逐日为何未达成"今天仍拿不到答案，而**数据就躺在那里** |
| 2 | **`PRD-IND-order` / `PRD-order-project-sim-1to1`** — DAG 节点数 9 vs PRD 的 11 | 高 | **极低** | `solvers/service.ts:3284-3293` 实建 **9 节点/11 边**，PRD 与前端注释（`OrderChainView.tsx:159,406`）都写"11 节点"。**"11"是边数被抄成了节点数**。且**无任何测试断言节点数**（测试只断 `edges.length >= 9`）——改哪边都不会红 |
| 3 | **`PRD-demand-pulled-growth-engine`** — 6 条路由前缀写错 | 中 | **极低** | 能力在 `/api/v1/growth/*`（`agentcore/src/server.ts:224+`），PRD 写成 `/a/v1/growth/*`。**只改文档**，但不改就会让下一个 dev 去 DataCore 找一个不存在的东西 |
| 4 | **`Skill.maxBudgetRounds` 接消费方**（`PRD-skill-runtime-orchestrator` 子项） | 中 | **低** | 契约有、测试绿、零消费方 —— 本仓"假绿第 9 形态"的活样本。接一条线即可，且接上后 agent 预算失控才真的有护栏 |
| 5 | **`CausalFactor.boundMetricKeys` 补写入方** | 高 | 低 | 读处已在 `app.ts:2449`，`metricsAffected` 恒空。用户在归因页看到的"受影响指标"**永远是空列表**，且代码自陈"pending 不编" |
| 6 | **`PRD-IND-sop` / `PRD-sop-balance-1to1`** — `MrpNettingOutput` / `FinancePnlOutput` 两张表 | 高 | 中 | S&OP 平衡台缺"物料 MRP 净需求表"与"量·价·本·利科目表"，两个契约全仓 0。这是 CEO 月度例会**直接要看的两张表** |
| 7 | **`PRD-IND-audit` / `PRD-plan-audit-1to1`** — `audit_ksf` / `KsfGraphOutput` 财务 KSF 图 | 高 | 中 | `audit_timeline` 已实现（`solvers/plan.ts:212`，有 `audit-timeline.test.ts`），**同页的 KSF 图求解器全仓 0**。一页两块，做了一半 |
| 8 | **5 份 `PRD-addendum-*` 补 seam 测** | 低（对用户）/ 高（对信任） | 中 | 五份都是"能力真、测试真、零链路断言"。它们正是下次重构时**会静默坏掉且全绿**的地方 |
| 9 | **`PRD-addendum-capability-routing`** — 等价能力故障转移 | 中 | 中 | `load_tools`/`capabilityGroup` 全 0。今天某个 solver 挂了就是硬失败，没有等价能力兜底 |
| 10 | **`PRD-skill-*` 五份的「先收敛口径」** | 低 | **低（只写文档）** | 五份合计 **123 个**系统侧构件全仓 0、**17 条**路由未注册。**不是先去实现，是先裁掉不做的**——否则 `prd:coverage` 门会长期把它们报成缺口，噪声淹没真信号 |

> **为什么 1–5 排在前面**：五条全是"**差最后一根线**"——实现已在正线，缺口是一个消费方 / 一个数字 / 一个前缀。
> 单条工作量都在半天内，而每一条今天都在**用户眼前直接可见地失效**。
> 6–7 是"做了一半的页"，8–10 是"欠的是纪律不是功能"。

---

## 5 · 「工单 / 既有文档与代码不符」之处

工单要求「直接指出并给证据」。共 **6 处**。

### 5.1 ⚠ `scripts/check-prd-coverage.mjs` 这道门的输出**不可信** —— 且它就在 `pnpm gates` 里

**形态**：**「我用『某个短 ID 在全测试语料出现过』当作『这篇 PRD 的验收项被测了』的证据，而前者并不度量后者。」**

该门（`scripts/check-prd-coverage.mjs:41-46`）对每篇 PRD 抽出验收项编号（`A1`/`B2`/`E1`/`OC2`…），
然后在**整个测试语料拼成的一个大字符串**里查这个编号。**编号不按 PRD 分命名空间。**

**反证（实测）**：`docs/prd-coverage-index.json` 报 `PRD-A18-provisional-build-closure.md` 的
`coverage: 1`（100% 覆盖，验收项 `A5`）。而：

```
$ grep -rn "PRD-A18" apps packages scripts | wc -l
0
```

**这篇 PRD 在全仓零引用**，它的"A5 被覆盖"是因为**别的 PRD 的 A5** 出现在某个测试里。

另外两个实测缺陷：
- 只扫 `apps/{frontend-shell,datacore,agentcore}/test` **三个目录的顶层**（`readdirSync` 非递归），
  **漏掉 `packages/contracts/test`（4 个）与 `packages/llm-adapters/src`（2 个）**；
- `idCovered` 用**大小写不敏感**匹配（`:46` 的 `"i"` flag），`A1` 会匹配到 `a1`。

**建议**：把编号改成 **PRD 名 + 编号**联合查（如测试里写 `PRD-A18/A5`），或把该门降级为"仅统计"，
不再输出 `coverage` 这个会被当成事实的字段。**在修好之前，`docs/prd-coverage-index.json` 的 `coverage` 字段不应被任何人引用。**

### 5.2 `PRD-ontoflow-data-builder.md`（v1）不是欠账，是**被取代**

我的路由差集把它报成"7 条路由缺失"。追一层后：`apps/datacore/src/pipeline/` **存在**，
但里面是 `WorkflowService`（`service.ts:15`），实现的是 **OntoFlow v2** 的 `OntologyWorkflow`，
路由在 **`/a/v1/ontology-workflows/*`**（`apps/datacore/src/app.ts:2225–2245`，9 条）。
`PRD-ontoflow-v2-unified-modeling.md` 开头明写"**取代并扩展** v1"。

⇒ **v1 的 `PipelineService`/`pipeline_graphs`/`/a/v1/pipelines/*` 是有意不做的，不是漏做的。**
**建议在 v1 文件头加一行 `SUPERSEDED BY PRD-ontoflow-v2`**，否则每一轮对账都会把它重报一次为缺口。

### 5.3 `PRD-IND-order.md` 的「系统现状是最大缺口」已过期

该 PRD 写：「`OrderChainView` 现为"问题归并 4 类"，**缺**订单选择器 + 6 KPI 卡 + 统一结论 + 11 节点 DAG + 三判明细表 + C18 现金闸 + 采纳→Action」。

实测 `apps/frontend-shell/src/views/plan/OrderChainView.tsx`：
- `:406-407` 注释：「ORD 订单全链推演面板（order_fullchain）：**订单选择器** → **6 KPI** + 统一结论（三色）+ 三判明细 + **11 节点业务建模链 DAG** + **采纳→Action（C10 留痕）**」
- `:449` 6 KPI + 统一结论；`:470` DAG
- 后端 `order_fullchain` 已注册（`catalog.ts:82`）、已实现（`solvers/service.ts:4344` 分发 → `:3225` 起）、有测试（`cockpit-order-fullchain.test.ts`）+ `scripts/e2e-realbackend.mjs:103`

⇒ **除"11 节点"这一项外（实为 9 节点，见 §4.2 第 2 条），其余全部已做。PRD 正文需要重写。**

### 5.4 `docs/WO-TESTGAP-AUDIT.md` 的 `boundMetricKeys` 条目半过期

见 §3.4 表末行。结论方向不变，"零测试"那半已不准。

### 5.5 `PRD-IND-plan-generate.md` 与 `PRD-IND-plan-generate-1to1.md` 是同一份 PRD 的两个副本

两者全部机器指标逐位相同。**建议留一份、另一份改为指针**，否则任何"PRD 总数"都会永久多算 1。

### 5.6 关于工单本身 —— **工单的描述与仓库一致，我没有发现错误**

工单点名的 `docs/RECONCILE-skill-agent-prd-2026-08-09.md`（分支 `origin/claude/handoff-skill-agent-reconcile`）
**存在且内容与工单描述相符**（14 份 skill/agent PRD 对账）。
工单给的祖先关系判据、`outbox.emit` 第二实参、`git grep -- "apps/*/src"` 三条警告**我都实测复现了**，全部属实。

---

## 6 · 诚实边界（四档）

### 6.1 ✅ 亲手读代码验的（可直接引用）

| 结论 | 证据 |
|---|---|
| `lintSkill` 定义与调用点的**实参** | 读了 `skill-lint.ts:234` 与 `server.ts:1246` 的完整调用行 |
| `order_fullchain` 的 DAG 是 **9 节点 / 11 边** | 读了 `solvers/service.ts:3284-3300` 全部节点与边的字面量 |
| 该 DAG 的测试**不断言节点数** | 读了 `cockpit-order-fullchain.test.ts:5-30` 全部断言 |
| `attainment:base` 产出侧接线 + 消费侧零调用方 | 读了 `battery.ts:2663` 定义 + `attainment-base-daily.test.ts` 全文 + 全仓引用清单（仅 1 src + 该测试） |
| `boundMetricKeys` 只读无写 | 读了 `app.ts:2426/2449/2451/2460` 四行含注释 |
| `apps/datacore/src/pipeline/` 实为 OntoFlow v2 | 读了 `pipeline/service.ts:1-30`，确认导出 `WorkflowService` 而非 `PipelineService` |
| OntoFlow v2 的 9 条路由 | 读了 `app.ts:2225-2245` |
| growth 路由在 AgentCore | 读了 `agentcore/src/server.ts:224/239/288/293/313` |
| `OrderChainView` 已有选择器/KPI/DAG | 读了该文件的结构注释与分节 |
| `check-prd-coverage.mjs` 的缺陷 | **读了该脚本全文** |
| 22 个缺失测试文件今天仍全缺 | `existsSync` 逐个探 + 双向金丝雀 |
| reconcile 报告基线仍有效 | `git merge-base --is-ancestor` + `git diff --name-only` |

### 6.2 ⚠ 只 grep 到符号 / 只跑了扫描器的（是线索，**不是**结论）

- **§2.2 的 60 / 58 / 8 三个分档数**。它们由锚点比例 + 死符号数 + 路由缺口三个机器信号按阈值切出，
  **阈值是我定的**（`ratio<0.6 或 deadSys≥20 或 routeMiss≥5 判未实现`）。换阈值，数会变。
  我逐条读代码验过的只有 §2.3 的 8 份 + §2.4 的 4 个样本 + §2.5 的 5 条抽验，**合计约 17 条**，
  **不是 147 份都读过**。
- **§3.2 的「零测试 = 0 份」**。它基于"区分性锚点在测试文件里出现"，
  **"出现"不等于"断言"** —— 一个锚点出现在测试的注释里也算命中。
- **460 个"全仓 0 命中的系统侧构件"**。这是去重后的字符串计数，
  其中必然混有 PRD 里的**示意性写法**（如 `train(`、`n.c26`、`d.vc66` 这种明显是原型片段的），
  **真实的"该做没做的构件"数量小于 460**。我没有逐个甄别。
- **`nSeam` / seam 测判定**：靠文件名含 `seam` 或正文含 `SEAM|接缝`。**命名约定不是机制**。

### 6.3 📄 从 PRD 或既有文档抄的（**可能过期**）

- **Skill/Agent 14 份的逐字段结论**：抄自 `docs/RECONCILE-skill-agent-prd-2026-08-09.md`。
  我验证了它的**基线仍有效**（§2.5）并**抽验了 5 条**，但其余条目是转述。
- **`WO-TESTGAP-AUDIT.md` 的 A/C/D/E 分类**：我复核了"文件是否仍缺"与 9 条 E 类符号，
  但**没有重跑**它的分类逻辑（如"某测试被更强的测试取代"这类判断）。
- **各 PRD 自述的"系统现状"**：如 `PRD-capacity-live-cockpit` 说"引擎全已建（57 solver）"。
  **我没有核 57 这个数。** §5.3 已实证这类自述会过期。

### 6.4 ❌ 未能验证的（明写，不冒充）

- **没跑过任何测试**。工单禁 `gate.sh` / `pnpm -r test` / datacore vitest。
  所以本文**没有一条结论来自"我亲手把那条链跑了一遍"** —— 全部是静态取证。
  按铁律 0.5 判据 #4，这意味着**本文尚未构成"复验"，只构成"取证"**。
- **没验证"绿测试是否真的绿"**。141 份"有 seam 测"里，我不知道它们今天跑起来是不是通的。
- **没做变异反证**。我没有删掉任何一行实现去看测试会不会红。
  §3.3 的"只咬函数"是**结构判断**（无 seam 文件），不是**行为判断**（删了不红）。
- **没验证间接调用**。铁律 0.5 判据 #3 点名的 re-export / 高阶函数 / 依赖注入 / **字符串键分发** / 事件订阅，
  我的扫描器**一个都看不见**。§2.3 那 8 份"未实现"里，
  若有构件是经**字符串键分发**注册的（本仓 solver 就是这种模式），**我会误报为 0 命中**。
  我对 §2.3 里的 `compileGraph`/`ReasoningGraph` 等做了名字级复验，
  但**没有为全部 460 个构件排除这种可能**。
- **没读 147 份 PRD 的全文**。我读的是每份的标题 + 首段 gist + 抽出的锚点。
  一份 PRD 的核心交付物若只在正文中段用散文描述、没有可抽取的标识符，**我会漏掉它**。

---

## 7 · 后续建议（不在本单范围，仅登记）

1. **修 `check-prd-coverage.mjs`**（§5.1）——它现在正在 `pnpm gates` 里产出会被当事实引用的假数据。
2. **给 3 份 PRD 加 `SUPERSEDED BY` 头**：`PRD-ontoflow-data-builder` / `PRD-deterministic-cross-domain` /
   `PRD-multi-intent-orchestration`（后两份被 `PRD-qos-cross-domain-unified` 明写取代）。
3. **合并 `PRD-IND-plan-generate` 的两个副本**（§5.5）。
4. **把 §0.3 的 5 类锚点判据落成仓内的门**（本单被禁止改 `scripts/*`，需另开单）。

---

*本文由 WO-PRD-COVERAGE-FULL 产出。基线 `c45f1eb`。未跑任何测试套件。*

---

## 附录 A · 全部 147 份逐份对账表（机器取证 · 置信度见 §6.2）

> **读法**：「系统侧死符号」= PRD 点名、但在 `apps/*/src`+`packages/*/src`+`scripts/` 全 0 命中，
> 且**已剔除**参考原型 HTML 侧符号与路由形状锚点。「原型侧(已剔除)」列显示剔掉了多少个 ——
> **该列数值大的行，正是 §0.3 陷阱④ 会把它误报成「大面积未实现」的那些**（如 PRD-IND-dash 剔了 45 个）。
> 「src锚点」大不等于做得多，只说明这份 PRD 点了很多名（如 skill 五份各点 84–138 个）。

| # | PRD | 定性 | src锚点 | 系统侧死符号 | 原型侧(已剔除) | 路由缺 | 首个 src 锚点(file:line) | 系统侧死符号样例 |
|---:|---|---|---:|---:|---:|---:|---|---|
| 1 | PRD-addendum-capability-routing.md | ④未实现 | 1 | 3 | 0 | 0 | `argHints` @ apps/agentcore/src/dril/resource-projector.ts:37 | `load_tools` · `capabilityGroup` · `routedTo` |
| 2 | PRD-addendum-excel-seed-700B-expansion.md | ④未实现 | 21 | 31 | 0 | 2 | `SEG_REGISTRY` @ apps/agentcore/src/growth/data-boundary.ts:1 | `daily_capacity` · `weekly_kit` · `monthly_gap` · `BOM_Material` |
| 3 | PRD-ontoflow-data-builder.md | ④未实现 | 37 | 15 | 0 | 7 | `RawDataset` @ apps/datacore/src/app.ts:1291 | `parsers.ts` · `profiler.ts` · `pipeline_graphs` · `PipelineService.run` |
| 4 | PRD-seam-arg-drop-audit.md | ④未实现 | 1 | 1 | 0 | 0 | `AMBIGUOUS_SCOPE` @ apps/agentcore/src/mocks/seed.ts:684 | `sys.scenario.launch` |
| 5 | PRD-skill-compiler-registry.md | ④未实现 | 138 | 38 | 0 | 16 | `seedRegistry` @ apps/agentcore/src/main.ts:9 | `sys.meta.change_loop` · `skill.compiled` · `SkillRuntimePackage` · `SkillRuntimePackageSchema` |
| 6 | PRD-skill-contract-dsl.md | ④未实现 | 84 | 34 | 0 | 0 | `SkillDefinitionSchema` @ apps/agentcore/src/server.ts:25 | `businessIntent` · `requires.relations` · `requires.slices` · `requires.events` |
| 7 | PRD-skill-governance-learning.md | ④未实现 | 125 | 30 | 0 | 1 | `SkillReference` @ apps/agentcore/src/skill-lint.ts:1 | `promptRefs` · `SkillExecutionTrace` · `SkillOutcomeStat` · `HumanCorrection` |
| 8 | PRD-skill-runtime-orchestrator.md | ④未实现 | 96 | 20 | 0 | 1 | `PlanStep` @ apps/agentcore/src/catalog/service.ts:7 | `reasoningGraphRun` · `budgetLeft` · `ReasoningGraph` · `SkillBudget` |
| 9 | PRD-A15-cli-universal-operation-shell.md | ③部分 | 20 | 4 | 0 | 1 | `ActionDraft` @ apps/agentcore/src/agent/loop.ts:1136 | `OperationIntent` · `orchestrator.classify` · `operationClassify` · `OperationIntentSchema` |
| 10 | PRD-A18-provisional-build-closure.md | ③部分 | 35 | 4 | 0 | 0 | `StoryBuildRun` @ apps/datacore/src/app.ts:3765 | `VleReport` · `delivery_delay_forecast` · `isolated-vm` · `ProvisionalSolverOutput` |
| 11 | PRD-addendum-dataflow-loop-closure.md | ③部分 | 7 | 3 | 0 | 0 | `derivation.completed` @ apps/agentcore/src/event-subscriptions.ts:32 | `objects.changed` · `rule.published` · `clock.ticked` |
| 12 | PRD-addendum-execution-semantics.md | ③部分 | 8 | 2 | 0 | 0 | `STALE_EXECUTOR` @ apps/datacore/src/execlock.ts:2 | `exec_lease_expired_total` · `MANUAL_INTERVENTION` |
| 13 | PRD-addendum-feature-entitlement.md | ③部分 | 14 | 0 | 0 | 1 | `FEATURE_NOT_FOUND` @ apps/agentcore/src/features/gate.ts:43 | — |
| 14 | PRD-addendum-ontology-core.md | ③部分 | 5 | 2 | 0 | 0 | `snapshotVersion` @ apps/agentcore/src/agent/loop.ts:1116 | `derivation_specs.deps` · `derivation_warnings` |
| 15 | PRD-addendum-operational-completeness.md | ③部分 | 10 | 2 | 0 | 0 | `mergedInto` @ apps/datacore/src/app.ts:1438 | `includeArchived` · `sched_lock_wait_ms` |
| 16 | PRD-addendum-replay-orchestrator.md | ③部分 | 6 | 0 | 0 | 1 | `llm_text` @ apps/datacore/src/opsteam/pools.ts:6 | — |
| 17 | PRD-addendum-skill-authoring.md | ③部分 | 7 | 1 | 0 | 0 | `SkillDefinitionSchema` @ apps/agentcore/src/server.ts:25 | `production-capacity-interpretation` |
| 18 | PRD-admin-self-approval.md | ③部分 | 12 | 3 | 0 | 0 | `actions.ts` @ apps/datacore/src/actions.ts:254 | `sys.action.writeback` · `selfApprovePolicy` · `action_types.self_approve_allowed` |
| 19 | PRD-agent-execution-governance-loop-control.md | ③部分 | 56 | 4 | 0 | 0 | `runAgentLoop` @ apps/agentcore/src/agent/context.ts:268 | `EscalationLadder` · `retry-manager-seam` · `per-tool-cap-seam` · `escalation-ladder-seam` |
| 20 | PRD-agent-react-harness.md | ③部分 | 22 | 2 | 0 | 0 | `final_answer` @ apps/agentcore/src/agent/context.ts:22 | `agent.reflected` · `agent-budget` |
| 21 | PRD-attainment-base-daily-timeseries.md | ③部分 | 12 | 2 | 0 | 0 | `BATTERY_TS_AGG_SPECS` @ apps/datacore/src/synthetic/battery.ts:2673 | `sys.ops.tick` · `attainment_daily` |
| 22 | PRD-attribution-routing-plan-audit.md | ③部分 | 10 | 3 | 0 | 0 | `plan_audit` @ apps/agentcore/src/features/registry.ts:29 | `KEYWORD_SOLVER` · `agent-data-generation-tools` · `admin-self-approval` |
| 23 | PRD-capacity-feasibility-demanddelta-fix.md | ③部分 | 43 | 4 | 0 | 0 | `capacity_forecast` @ apps/agentcore/src/agent/navigation-slice.ts:125 | `task.answer.provenance` · `model.updated` · `base.updated` · `data.provenance.formula` |
| 24 | PRD-cli-full-coverage.md | ③部分 | 58 | 8 | 0 | 4 | `uiDeepLink` @ packages/contracts/src/operation-intent.ts:10 | `deriveOperationCatalog` · `OPERATION_REGISTRY` · `derive-operation-catalog` · `cli-coverage` |
| 25 | PRD-cockpit-capacity-1to1-parity.md | ③部分 | 78 | 11 | 0 | 1 | `RootCauseChain` @ apps/agentcore/src/agent/navigation-slice.ts:80 | `wizardly-gauss` · `forecast.snapshot_recorded` · `problem-cards` · `module-links` |
| 26 | PRD-data-gap-self-healing-loop.md | ③部分 | 15 | 5 | 0 | 0 | `probe.ts` @ packages/contracts/src/agentcore.ts:168 | `scaffold.ts` · `sys.datagap.self_heal` · `sys.scenario.launch` · `datagap.detected` |
| 27 | PRD-de-battery-multitenant-config.md | ③部分 | 19 | 10 | 0 | 0 | `ViewConfig` @ apps/datacore/src/adminplatform.ts:5 | `view.layout.widgets` · `layout.columns` · `layout.verdicts` · `layout.segments` |
| 28 | PRD-decision-resource-intelligence-layer.md | ③部分 | 67 | 6 | 0 | 1 | `ResourceDescriptor` @ apps/datacore/src/catalog.ts:4 | `solver_registry.updated` · `boundRules` · `resource.indexed` · `resource.quality_updated` |
| 29 | PRD-demo-lightup-2.md | ③部分 | 41 | 2 | 0 | 0 | `QOS_DARK_LAUNCH_FEATURES` @ apps/agentcore/src/router/orchestrator.ts:282 | `slot-harvest-floor` · `features.test.ts` |
| 30 | PRD-discover-real-type-names.md | ③部分 | 12 | 0 | 0 | 1 | `plan_version` @ apps/agentcore/src/tools/registry.ts:10 | — |
| 31 | PRD-dogfooding-self-ontology.md | ③部分 | 25 | 2 | 0 | 2 | `__platform__` @ apps/datacore/src/meta/service.ts:10 | `SystemLink` · `sys.meta.change_loop` |
| 32 | PRD-fde-fullstack-build-workflow.md | ③部分 | 33 | 5 | 0 | 1 | `storybuild.run_recorded` @ apps/agentcore/src/event-subscriptions.ts:82 | `capability.indexed` · `EntityFieldCatalogEntry` · `FdeWorkflowNode` · `entity_field_catalog` |
| 33 | PRD-frontend.md | ③部分 | 28 | 0 | 0 | 2 | `VITE_DATACORE_URL` @ apps/frontend-shell/src/env.ts:2 | — |
| 34 | PRD-global-sim-live-upgrade.md | ③部分 | 44 | 0 | 0 | 1 | `global-sim` @ apps/agentcore/src/agent/sim-planner.ts:26 | — |
| 35 | PRD-in-dialog-gap-fill-loop.md | ③部分 | 23 | 0 | 0 | 2 | `classifyGap` @ apps/agentcore/src/growth/probe.ts:33 | — |
| 36 | PRD-IND-audit.md | ③部分 | 39 | 7 | 28 | 0 | `AUDIT_KIND` @ apps/datacore/src/solvers/plan.ts:214 | `audit_ksf` · `d.vc66` · `d.vc10` · `AUDIT_FIELDS` |
| 37 | PRD-IND-dash.md | ③部分 | 39 | 5 | 45 | 2 | `buildDash` @ apps/frontend-shell/src/views/DashboardView.tsx:22 | `sop.materials` · `LedgerProblemPanel` · `RootCauseDag` · `order_margin_contrib` |
| 38 | PRD-IND-map.md | ③部分 | 28 | 1 | 8 | 3 | `VIEWS` @ apps/datacore/src/features.ts:14 | `view.options.desc` |
| 39 | PRD-IND-order-aggregate.md | ③部分 | 41 | 3 | 16 | 0 | `buildRisk` @ apps/datacore/src/solvers/base-outlook.ts:120 | `AffectedOrdersEconSchema` · `econ.coef` · `segByCust` |
| 40 | PRD-IND-order.md | ③部分 | 29 | 13 | 21 | 1 | `MODEL_DEF` @ apps/datacore/src/synthetic/battery.ts:53 | `OrderFullchainOutputSchema` · `orderSolverKey` · `n.c26` · `n.c12` |
| 41 | PRD-IND-risk.md | ③部分 | 58 | 10 | 23 | 0 | `buildRisk` @ apps/datacore/src/solvers/base-outlook.ts:120 | `ordersCount` · `minCrossDay` · `factorPointCount` · `affectedOrderCount` |
| 42 | PRD-IND-sop.md | ③部分 | 43 | 3 | 16 | 0 | `sop-balance` @ apps/agentcore/src/features/registry.ts:39 | `version.inputs.note` · `total.p90` · `MaterialBalanceSchema` |
| 43 | PRD-inference-process-enhancement.md | ③部分 | 12 | 0 | 1 | 1 | `STORY_SHORT` @ apps/agentcore/src/router/orchestration-skeleton.ts:16 | — |
| 44 | PRD-lever-binding-drift.md | ③部分 | 22 | 1 | 0 | 0 | `oee_current` @ apps/agentcore/src/agent/sim-planner.ts:110 | `caplive-truechain` |
| 45 | PRD-live-traceable-data.md | ③部分 | 13 | 1 | 0 | 2 | `SyntheticJob` @ apps/datacore/src/app.ts:12 | `sys.ingest.data_to_object` |
| 46 | PRD-multi-intent-orchestration.md | ③部分 | 25 | 6 | 0 | 0 | `solve_portfolio` @ apps/agentcore/src/router/multi-route.ts:29 | `solverDepGraph` · `runMultiIntentPath` · `multi_intent_dispatch` · `multi_intent_solver` |
| 47 | PRD-ontoflow-v2-unified-modeling.md | ③部分 | 45 | 11 | 0 | 3 | `OntologyWorkflow` @ apps/datacore/src/app.ts:50 | `parsers.ts` · `workflow.test.ts` · `processing.test.ts` · `promote.test.ts` |
| 48 | PRD-ontology-browser-field-coverage.md | ③部分 | 20 | 8 | 1 | 3 | `DerivationSpec` @ apps/datacore/src/actions.ts:303 | `field_coverage.evaluated` · `ontology-browser` · `closure-report` · `sys.ingest.data_to_object` |
| 49 | PRD-opt-whatif-close.md | ③部分 | 45 | 0 | 0 | 0 | `optimize_whatif` @ apps/agentcore/src/agent/navigation-slice.ts:52 | — |
| 50 | PRD-plan-generate-1to1.md | ③部分 | 15 | 2 | 1 | 1 | `audit_timeline` @ apps/datacore/src/catalog.ts:85 | `TARGET_FIELDS` · `KsfGraphOutput` |
| 51 | PRD-platform-foundry-aip.md | ③部分 | 39 | 1 | 0 | 1 | `claude-haiku-4-5` @ apps/agentcore/src/config.ts:11 | `QueueAdapter` |
| 52 | PRD-prototype-intake-databuilder.md | ③部分 | 21 | 4 | 0 | 0 | `prototype-intake` @ apps/agentcore/src/event-subscriptions.ts:90 | `PrototypeArtifact` · `schema_reconcile.candidate_created` · `IntakeAdapter` · `PrototypeArtifactSchema` |
| 53 | PRD-qos-cross-domain-unified.md | ③部分 | 38 | 8 | 0 | 0 | `DomainResolution` @ apps/agentcore/src/router/domain-resolver.ts:45 | `crossdomainmultiintentorchestration.md` · `handoff-wo-det-cross-domain` · `handoff-wo-multi-intent-p1` · `solverDepGraph` |
| 54 | PRD-rules-as-references.md | ③部分 | 17 | 2 | 0 | 0 | `capacityForecast` @ apps/agentcore/src/router/ceo-route.ts:120 | `rule.updated` · `rule.published` |
| 55 | PRD-sandbox-multiplan.md | ③部分 | 136 | 7 | 0 | 1 | `ChainImpediment` @ apps/datacore/src/catalog.ts:146 | `decision_play.matrix` · `noCandidateReason` · `optimize_whatif.feasible` · `chain.impediment_resolved` |
| 56 | PRD-sandbox-ontogenesis-buildplan.md | ③部分 | 21 | 6 | 0 | 0 | `runStory` @ apps/datacore/src/app.ts:3775 | `ruleNeeds` · `actionNeeds` · `metricNeeds` · `sandboxConfigNeeds` |
| 57 | PRD-sandbox-redesign.md | ③部分 | 71 | 4 | 0 | 1 | `propagateTick` @ apps/datacore/src/app.ts:53 | `chain.impediment_resolved` · `time-coherence` · `wo-unitprice-scale` · `quote_margin.verdict` |
| 58 | PRD-semantics-singlesource.md | ③部分 | 7 | 2 | 0 | 0 | `chain-node-singlesource` @ apps/frontend-shell/src/views/sim/chainNodeSemantics.ts:27 | `order.reviw` · `cf.text` |
| 59 | PRD-sim-scope-local.md | ③部分 | 37 | 1 | 0 | 1 | `endpoints.ts` @ apps/frontend-shell/src/mocks/handlers.ts:3478 | `selectedVars` |
| 60 | PRD-simulation-sandbox.md | ③部分 | 39 | 4 | 0 | 4 | `generic_inference` @ apps/agentcore/src/agent/navigation-slice.ts:51 | `timelineId` · `worldState` · `SandboxGraph` · `sim_checkpoints` |
| 61 | PRD-skill-migration.md | ③部分 | 120 | 13 | 0 | 0 | `ExecutionPlan` @ apps/agentcore/src/catalog/service.ts:4 | `businessIntent` · `resolveSkillForIntent` · `antiExamples` · `skill.execution.plan` |
| 62 | PRD-sop-balance-1to1.md | ③部分 | 15 | 6 | 2 | 2 | `MaterialBalance` @ apps/agentcore/src/agent/navigation-slice.ts:161 | `s2.total.p90` · `inputs.note` · `sopSeed` · `MaterialBalanceSchema` |
| 63 | PRD-unified-build-engine.md | ③部分 | 17 | 5 | 0 | 4 | `ontology.published` @ apps/agentcore/src/event-subscriptions.ts:31 | `buildplan.closure_evaluated` · `scaffold.completed` · `registerPurpose` · `build_decompose` |
| 64 | SPEC-optimization-template-pool.md | ③部分 | 31 | 4 | 0 | 1 | `facility_location` @ apps/agentcore/src/mocks/clients.ts:601 | `deriveOperationCatalog` · `sandbox.ts` · `_run_with_exec` · `train(` |
| 65 | SPEC-sandbox-propagation-and-session.md | ③部分 | 31 | 0 | 0 | 1 | `RuleEntrySchema` @ packages/contracts/src/datacore.ts:101 | — |
| 66 | SPEC-trust-traceability-interaction.md | ③部分 | 10 | 2 | 0 | 0 | `RuleRef` @ apps/agentcore/src/catalog/service.ts:17 | `definedBy` · `definedAt` |
| 67 | PRD-addendum-a8-timeseries.md | ②已实现已接线 | 9 | 1 | 0 | 0 | `ts_points` @ apps/agentcore/src/mocks/clients.ts:854 | `last_run_at` |
| 68 | PRD-addendum-admin-console-closure.md | ②已实现已接线 | 3 | 0 | 0 | 0 | `ExecutionPlan` @ apps/agentcore/src/catalog/service.ts:4 | — |
| 69 | PRD-addendum-admin-platform.md | ②已实现已接线 | 10 | 0 | 0 | 6 | `platform_admin` @ apps/agentcore/src/resources.ts:55 | — ⚠改判：6 条 routeMiss 全是 `/b/v1/{res}` 泛型占位符，非真实路由；实测 `/a/v1/tenants/:id/users` 等均已注册 |
| 70 | PRD-addendum-agent-runtime.md | ②已实现已接线 | 10 | 0 | 0 | 0 | `count_tokens` @ apps/agentcore/src/agent/context.ts:8 | — |
| 71 | PRD-addendum-lived-in-state.md | ②已实现已接线 | 1 | 0 | 0 | 0 | `/a/v1/history/bundle` @ apps/datacore/src/app.ts:4315 | — |
| 72 | PRD-addendum-llm-providers-and-references.md | ②已实现已接线 | 10 | 0 | 0 | 0 | `SERVICE_TOKEN` @ apps/agentcore/src/config.ts:9 | — |
| 73 | PRD-addendum-m11-calibration.md | ②已实现已接线 | 10 | 0 | 0 | 0 | `paramsVersion` @ apps/datacore/src/calibration/pairing.ts:13 | — |
| 74 | PRD-addendum-ontology-governance.md | ②已实现已接线 | 7 | 0 | 0 | 0 | `contractFixture` @ apps/datacore/src/app.ts:2970 | — |
| 75 | PRD-addendum-solvers-and-gaps.md | ②已实现已接线 | 35 | 2 | 13 | 0 | `solverParams` @ apps/datacore/src/calibration/config.ts:22 | `EmbeddingProvider.embed` · `fallback_traces.normalized_query` |
| 76 | PRD-addendum-validation-loop.md | ②已实现已接线 | 1 | 0 | 0 | 0 | `/a/v1/validation/runs` @ apps/datacore/src/app.ts:1328 | — |
| 77 | PRD-agent-data-generation-tools.md | ②已实现已接线 | 25 | 0 | 0 | 0 | `BUILTIN_TOOLS` @ apps/agentcore/src/engine.ts:20 | — |
| 78 | PRD-agent-navigation-slice-latency.md | ②已实现已接线 | 14 | 0 | 0 | 0 | `gap_attribution` @ apps/agentcore/src/agent/navigation-slice.ts:77 | — |
| 79 | PRD-aop-annual-scenario-1to1.md | ②已实现已接线 | 15 | 0 | 1 | 0 | `AnnualScenario` @ apps/agentcore/src/mocks/clients.ts:951 | — |
| 80 | PRD-build-workflow-runtime.md | ②已实现已接线 | 30 | 0 | 0 | 0 | `BuildWorkflowStep` @ apps/datacore/src/databuilder/fde-graph.ts:6 | — |
| 81 | PRD-capacity-inference-completion.md | ②已实现已接线 | 13 | 0 | 0 | 0 | `battery.ts` @ apps/datacore/src/actions.ts:55 | — |
| 82 | PRD-capacity-live-cockpit.md | ②已实现已接线 | 44 | 0 | 0 | 0 | `risk-board` @ apps/agentcore/src/features/registry.ts:13 | — |
| 83 | PRD-catalog-battery-20-scenarios.md | ②已实现已接线 | 14 | 0 | 0 | 0 | `mitigation_select` @ apps/agentcore/src/mocks/clients.ts:573 | — |
| 84 | PRD-chain-24nodes.md | ②已实现已接线 | 76 | 0 | 0 | 0 | `CHAIN_NODE_REGISTRY` @ apps/datacore/src/sim/propagation.ts:46 | — |
| 85 | PRD-console-cleanup.md | ②已实现已接线 | 66 | 0 | 0 | 0 | `ChainNode` @ apps/datacore/src/solvers/chain-loss.ts:68 | — |
| 86 | PRD-data-backfill.md | ②已实现已接线 | 19 | 2 | 0 | 0 | `MaterialBalance` @ apps/agentcore/src/agent/navigation-slice.ts:161 | `capexWan` · `durationDays` |
| 87 | PRD-demand-pulled-growth-engine.md | ②已实现已接线 | 43 | 2 | 0 | 6 | `classifyGap` @ apps/agentcore/src/growth/probe.ts:33 | `sys.meta.change_loop` · `growth_runs` ⚠改判：6 条 routeMiss 是 PRD 前缀写错（实现在 `/api/v1/growth/*`，agentcore/server.ts:224+） |
| 88 | PRD-deterministic-cross-domain.md | ②已实现已接线 | 13 | 0 | 0 | 0 | `DomainResolution` @ apps/agentcore/src/router/domain-resolver.ts:45 | — |
| 89 | PRD-empty-tenant-bootstrap.md | ②已实现已接线 | 25 | 2 | 0 | 0 | `seedDemo` @ apps/datacore/src/seed-cli.ts:11 | `sys.ingest.data_to_object` · `sys.action.writeback` |
| 90 | PRD-external-signal-domain.md | ②已实现已接线 | 6 | 0 | 0 | 0 | `ExternalSignal` @ apps/datacore/src/app.ts:2393 | — |
| 91 | PRD-frontend-addendum-remaining-views.md | ②已实现已接线 | 15 | 0 | 1 | 0 | `LayeredDag` @ apps/frontend-shell/src/components/Dag/LayeredDag.tsx:1 | — |
| 92 | PRD-frontend-addendum-sim-views.md | ②已实现已接线 | 13 | 1 | 0 | 0 | `SOLVER_TIMEOUT` @ apps/agentcore/src/config.ts:23 | `recommendedNo` |
| 93 | PRD-fullstack-story-build-g8.md | ②已实现已接线 | 54 | 0 | 0 | 0 | `growth.gap_detected` @ apps/agentcore/src/event-subscriptions.ts:70 | — |
| 94 | PRD-generic-inference.md | ②已实现已接线 | 9 | 0 | 0 | 0 | `generic_inference` @ apps/agentcore/src/agent/navigation-slice.ts:51 | — |
| 95 | PRD-global-sim.md | ②已实现已接线 | 33 | 2 | 0 | 0 | `GlobalSimRequest` @ apps/frontend-shell/src/views/sim/inspectorModel.ts:743 | `wo-gsim-solver` · `wo-gsim-frontend` |
| 96 | PRD-goal-metric-owner-spine.md | ②已实现已接线 | 31 | 3 | 0 | 0 | `PlanTarget` @ apps/agentcore/src/agent/navigation-slice.ts:92 | `subgoal_drivenby_ksf` · `metric_sourcedfrom` · `SubGoal` |
| 97 | PRD-hardcoded-absence.md | ②已实现已接线 | 42 | 0 | 0 | 0 | `PROCUREMENT_BRANCH` @ apps/frontend-shell/src/views/sim/SandboxConsole.tsx:7 | — |
| 98 | PRD-impediments-reachable.md | ②已实现已接线 | 49 | 0 | 0 | 0 | `ViewConfig` @ apps/datacore/src/adminplatform.ts:5 | — |
| 99 | PRD-IND-aop.md | ②已实现已接线 | 44 | 3 | 4 | 0 | `AOP_SCEN` @ apps/frontend-shell/src/views/plan/AnnualScenarioView.tsx:19 | `layout.year` · `materializePlanDomain` · `capex.test.ts` |
| 100 | PRD-IND-model.md | ②已实现已接线 | 39 | 2 | 21 | 0 | `pmDagSVG` @ apps/frontend-shell/src/components/InferenceProcessDag.tsx:63 | `generateModels` · `layout.models` |
| 101 | PRD-IND-plan-generate.md | ②已实现已接线 | 16 | 0 | 16 | 0 | `plan-generate` @ apps/agentcore/src/features/registry.ts:32 | — |
| 102 | PRD-IND-quarter.md | ②已实现已接线 | 43 | 3 | 3 | 0 | `quarterly-rolling` @ apps/agentcore/src/features/registry.ts:54 | `scenarios.baseline.projects` · `ruleTip` · `subNote` |
| 103 | PRD-IND-story.md | ②已实现已接线 | 45 | 2 | 6 | 0 | `STORY_SHORT` @ apps/agentcore/src/router/orchestration-skeleton.ts:16 | `DagCanvas` · `selectInferenceNodes` |
| 104 | PRD-inference-line.md | ②已实现已接线 | 125 | 0 | 0 | 0 | `gap_attribution` @ apps/agentcore/src/agent/navigation-slice.ts:77 | — |
| 105 | PRD-llm-agent-empty-response-guard.md | ②已实现已接线 | 10 | 0 | 0 | 0 | `response.usage` @ apps/agentcore/src/agent/loop.ts:820 | — |
| 106 | PRD-multi-intent-L2-L3-coupled-solving.md | ②已实现已接线 | 22 | 1 | 0 | 0 | `portfolio.ts` @ apps/agentcore/src/server.ts:1759 | `solverDepGraph` |
| 107 | PRD-nav-gate.md | ②已实现已接线 | 27 | 1 | 0 | 0 | `BuiltInView` @ apps/datacore/src/synthetic/view-manifest.ts:22 | `BUILT_IN_VIEWS` |
| 108 | PRD-nav-ia-reorg.md | ②已实现已接线 | 10 | 1 | 0 | 0 | `ViewConfig` @ apps/datacore/src/adminplatform.ts:5 | `BUSINESS_NAV_GROUPS` |
| 109 | PRD-node-semantics.md | ②已实现已接线 | 33 | 0 | 0 | 0 | `drillValue` @ apps/agentcore/src/router/live-endpoints.ts:21 | — |
| 110 | PRD-opt-whatif-data.md | ②已实现已接线 | 41 | 0 | 0 | 0 | `facility_location` @ apps/agentcore/src/mocks/clients.ts:601 | — |
| 111 | PRD-optimize-whatif-conversational-wiring.md | ②已实现已接线 | 79 | 3 | 0 | 0 | `optimize_whatif` @ apps/agentcore/src/agent/navigation-slice.ts:52 | `qos-det-gate-seam` · `qos-cross-domain-seam` · `solverDepGraph` |
| 112 | PRD-order-project-sim-1to1.md | ②已实现已接线 | 16 | 0 | 7 | 0 | `order_fullchain` @ apps/datacore/src/catalog.ts:82 | — |
| 113 | PRD-plan-audit-1to1.md | ②已实现已接线 | 16 | 1 | 8 | 0 | `risk_timeline` @ apps/agentcore/src/event-subscriptions.ts:104 | `KsfGraphOutput` |
| 114 | PRD-quarter-rolling-1to1.md | ②已实现已接线 | 10 | 1 | 3 | 0 | `quarterlyFromContext` @ apps/datacore/src/planviews.ts:204 | `subNote` |
| 115 | PRD-query-orchestration-service.md | ②已实现已接线 | 66 | 3 | 0 | 0 | `VERIFIED_WORKFLOW` @ apps/agentcore/src/engine.ts:525 | `PermissionGuard` · `AuditRecorder` · `output_format` |
| 116 | PRD-route-nav-coverage.md | ②已实现已接线 | 38 | 1 | 0 | 0 | `NAV_GROUPS` @ apps/agentcore/src/router/orchestration-skeleton.ts:6 | `routePath` |
| 117 | PRD-sandbox-metro-semantics.md | ②已实现已接线 | 44 | 0 | 0 | 0 | `stepId` @ apps/agentcore/src/agent/loop.ts:519 | — |
| 118 | PRD-scenario-launcher.md | ②已实现已接线 | 43 | 2 | 0 | 0 | `ScenarioCard` @ apps/agentcore/src/scenarios-catalog.ts:10 | `scenarios-wiring` · `sys.scenario.launch` |
| 119 | PRD-scenario-ontogenesis.md | ②已实现已接线 | 36 | 2 | 0 | 0 | `BUDGET_EXCEEDED` @ apps/agentcore/src/agent/loop.ts:687 | `deriveOperationCatalog` · `lastOntogenesisRunId` |
| 120 | PRD-segment-scoped-gap-attribution.md | ②已实现已接线 | 34 | 1 | 0 | 0 | `seg_attain_ess` @ apps/agentcore/src/mocks/clients.ts:568 | `global_sim` |
| 121 | PRD-stale-claims.md | ②已实现已接线 | 21 | 1 | 0 | 0 | `PurchaseOrder` @ apps/agentcore/src/agent/navigation-slice.ts:167 | `putAllX` |
| 122 | PRD-topo-realdata.md | ②已实现已接线 | 28 | 1 | 0 | 0 | `spread` @ apps/datacore/src/synthetic/view-manifest.ts:117 | `workshop_metrics` |
| 123 | PRD-transit-geometry.md | ②已实现已接线 | 39 | 1 | 1 | 0 | `TransitFlowLayer` @ apps/frontend-shell/src/views/registry.ts:94 | `transit-station-only-note` |
| 124 | PRD-transit-wire.md | ②已实现已接线 | 58 | 0 | 0 | 0 | `TransitFlowView` @ apps/frontend-shell/src/views/registry.ts:97 | — |
| 125 | PRD-WO-LIVE-DISPOSITION.md | ②已实现已接线 | 30 | 3 | 0 | 0 | `risk_timeline` @ apps/agentcore/src/event-subscriptions.ts:104 | `sys.scenario.launch` · `planRows0` · `planRows1` |
| 126 | SPEC-sandbox-readiness-certification.md | ②已实现已接线 | 31 | 3 | 0 | 0 | `closure.ts` @ apps/agentcore/src/workflow/validate.ts:39 | `RESERVED` · `r_xxx` · `r_order_risk_from_factory` |
| 127 | ARCH-global-ia-consolidation.md | ①流程/索引/审查类 | 8 | 1 | 0 | 0 | `solver-review` @ apps/frontend-shell/src/App.tsx:178 | `RUNBOOK` |
| 128 | ARCH-redlines-and-R17-decision-page.md | ①流程/索引/审查类 | 3 | 0 | 0 | 0 | `sim.sandbox` @ apps/agentcore/src/router/orchestrator.ts:112 | — |
| 129 | ARCH-sandbox-landing-discipline.md | ①流程/索引/审查类 | 18 | 0 | 0 | 1 | `ClosureReport` @ apps/datacore/src/databuilder/closure.ts:1 | — |
| 130 | ARCH-sandbox-reconciliation.md | ①流程/索引/审查类 | 15 | 1 | 0 | 0 | `/b/v1/solvers/:key/run` @ apps/agentcore/src/server.ts:1851 | `RUNBOOK` |
| 131 | PRD-1to1-README-HANDOFF.md | ①流程/索引/审查类 | 5 | 0 | 0 | 0 | `audit_timeline` @ apps/datacore/src/catalog.ts:85 | — |
| 132 | PRD-A3-multihop-slice-completion.md | ①流程/索引/审查类 | 8 | 0 | 0 | 0 | `lookupReusable` @ apps/datacore/src/app.ts:59 | — |
| 133 | PRD-A9-external-engines-design-deferred.md | ①流程/索引/审查类 | 1 | 5 | 0 | 0 | `selection_optimize` @ apps/datacore/src/catalog.ts:109 | `graph_query` · `causal_estimate` · `DatalogTransitiveOutput` · `GraphQueryOutput` |
| 134 | PRD-data-closure-spec.md | ①流程/索引/审查类 | 10 | 9 | 0 | 0 | `IndustryTemplate` @ apps/datacore/src/domain.ts:8 | `sys.ingest.data_to_object` · `sys.ingest.build_closure` · `sys.ontology.type_lineage` · `sys.solving.invoke` |
| 135 | PRD-gate-ledger.md | ①流程/索引/审查类 | 13 | 1 | 0 | 0 | `boundary-singlesource` @ apps/datacore/src/synthetic/battery.ts:3234 | `GateLedger` |
| 136 | PRD-generation-boundary-grounding.md | ①流程/索引/审查类 | 18 | 4 | 0 | 1 | `getObject` @ apps/agentcore/src/mocks/clients.ts:273 | `migration024_boundary.sql` · `PropertyDefSchema` · `BoundaryItem` · `ImportPort` |
| 137 | PRD-implementation-handbook.md | ①流程/索引/审查类 | 2 | 2 | 0 | 0 | `crypto.randomUUID` @ apps/frontend-shell/src/lib/uuid.ts:2 | `expectedVersion` · `CRYPTO_KEY` |
| 138 | PRD-IND-plan-generate-1to1.md | ①流程/索引/审查类 | 16 | 0 | 16 | 0 | `plan-generate` @ apps/agentcore/src/features/registry.ts:32 | — |
| 139 | PRD-maturity-master-plan.md | ①流程/索引/审查类 | 0 | 0 | 0 | 0 | — | — |
| 140 | PRD-ontology-7elements.md | ①流程/索引/审查类 | 57 | 7 | 0 | 1 | `outputSpec` @ apps/agentcore/src/dril/resource-projector.ts:149 | `implementsInterface` · `interfaceKey` · `InterfaceDef` · `ObjectInterface` |
| 141 | PRD-reference-views-1to1-roadmap.md | ①流程/索引/审查类 | 3 | 0 | 0 | 0 | `VIEWS` @ apps/datacore/src/features.ts:14 | — |
| 142 | PRD-self-driving-qos-data-foundation.md | ①流程/索引/审查类 | 27 | 6 | 0 | 2 | `SolverArtifact` @ apps/datacore/src/repo/repo.ts:1 | `BoundaryItem` · `ImportPort` · `PROVISIONAL_SOLVERS` · `boundaryCanSynthesize` |
| 143 | PRD-skill-crossreview.md | ①流程/索引/审查类 | 13 | 2 | 0 | 0 | `FeatureDef` @ apps/agentcore/src/features/registry.ts:1 | `minStatus` · `execution.steps` |
| 144 | PRD-system-ontogenesis-spec.md | ①流程/索引/审查类 | 8 | 6 | 0 | 0 | `runStory` @ apps/datacore/src/app.ts:3775 | `deriveOperationCatalog` · `sys.meta.change_loop` · `ontogenesis.organ_matured` · `sys.meta.ontogenesis_loop` |
| 145 | PRD-traceability-and-baseline-v2.md | ①流程/索引/审查类 | 4 | 1 | 0 | 0 | `search_knowledge` @ apps/agentcore/src/catalog/service.ts:22 | `scenario.triggered` |
| 146 | PRD-traceability-and-baseline.md | ①流程/索引/审查类 | 4 | 1 | 0 | 0 | `search_knowledge` @ apps/agentcore/src/catalog/service.ts:22 | `scenario.triggered` |
| 147 | SPEC-industrial-skill.md | ①流程/索引/审查类 | 56 | 12 | 0 | 10 | `factory_id` @ packages/contracts/src/derive-fields.ts:36 | `skill_id` · `risk_level` · `product_id` · `time_range` |
