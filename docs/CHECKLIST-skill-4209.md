# 逐条勾选 · 8 份 Skill 文档（4209 行）× 系统实测

> 2026-08-09 · 审核方 · 仓主：「你自己对照着 4209 行需求，复验系统，逐一勾选是否满足」
>
> **基线时点**：canonical `213fa49e`（已收编 Skill 分支 3/5：orchestrator-s1 · refclosure-a · partial-b；
> `compiler-s1` / `partial-a` 仍未并 —— **这直接决定了下面若干条的判定**）。

---

## 0. 判定口径（**四档，不合并成一个绿勾**）

本轮之所以要分四档，是因为今天刚抓到一个反例（#159）：
`SkillExecutionSchema` 进主线了、`GraphScheduler` 进主线了、测试全绿了、符号搜得到了——
**但 `SkillDefinition` 上没有 `execution` 字段**，一个存下来的 Skill 带不走自己的推理图。
若按"符号在不在"记账，这条会被记成 ✅。

| 档 | 含义 | 判据 |
|---|---|---|
| **✅ 实体层真满足** | 承载物在**该在的对象上**，且有生产消费方 | 追一层调用，看到真触发条件 |
| **🔗 有实现·接线不全** | 代码在、也被调用，但挂错位置 / 只覆盖部分路径 | 形态④ |
| **⚠️ 只有 test 引用** | 实现有、测试有、且是绿的，**零生产调用方** | 形态②「已排练不是已实现」 |
| **❌ 无承载物** | 契约/代码里根本没有 | 需先跑金丝雀自证工具，再报 0 |

> ⚠️ **「有落点」≠「已实现」≠「实体层真满足」**。这三个是不同命题，本表不许混。

---

## 1. 需求提取（进行中）

| 文档 | 行数 | 提取条数 | 其中自标非目标 |
|---|---:|---:|---:|
| `SPEC-industrial-skill.md`（12 层 + 跨层 G） | 514 | **183** | 26 |
| `PRD-skill-migration.md` | 545 | **186** | 19 |
| `PRD-addendum-skill-authoring.md` | 108 | **63** | 1 |
| `PRD-skill-crossreview.md` | 211 | **43** | 6 |
| `PRD-skill-contract-dsl.md` | 643 | **215** | 45 |
| `PRD-skill-compiler-registry.md` | 741 | **240** | 43 |
| `PRD-skill-runtime-orchestrator.md` | 725 | **214** | 34 |
| `PRD-skill-governance-learning.md` | 722 | **221** | 30 |
| **合计（8 份 · 4209 行）** | **4209** | **1365** | **204** |

> **⚠️ 「非目标」分三档，核对时不许混为一谈**（提取方口径，我采纳）：
> - **绝对不做**（如 CMP 的 Skill Orchestrator、GOV 的分级评分）—— **不该算缺口**
> - **本期不做/另立单**（如 DSL 的 `context.memory`、CMP 的 `maxBudgetRounds` 运行时消费）——
>   这些文档**自己要求「验收文案必须诚实标注未接」**，所以「没做」不是缺口，**「宣称做了」才是**
> - **不改/不新造**（如「AgentDefinition 不改」「不新建反查端点」）—— 这是**反向断言：做了反而是缺陷**

**SPEC 12 层条数分布**：① 10 · ② 18 · ③ 10 · ④ 5 · ⑤ 7 · ⑥ 18 · ⑦ 5 · ⑧ 8 · ⑨ 10 · ⑩ 6 · ⑪ 5 · ⑫ 10 · 跨层 G 71。

> ⚠️ 提取方自报一处口径风险，我采纳并记账：**SPEC §5–§9 共 351 行（占全文 68%）跨越多层或高于层**
> （如「引用可校验硬门」同时约束 ③⑦⑧⑨），已编入 `SK-SPEC-G-*` 而非硬塞进 12 层。
> **强行按 12 层归属会把跨层约束拆碎，反而让缺口藏起来。**

---

## 2. 六个跨文档重复族 —— 已亲手核完（一次覆盖约 40 条）

> 提取方指出这六族在多份文档里重复出现。先核它们，性价比最高。
> 每条给 `file:line`，判定按 §0 四档。

| 族 | 涉及编号 | 判定 | 实测证据 |
|---|---|---|---|
| **① `requires` 结构** | `SK-SPEC-G-67..70` · `SK-MIG-158` · `SK-XR-5..11` | ❌ **已裁决未落地** | C1 仓主 **2026-08-03 已裁「采纳 `requires` 结构，`references[]`/`dependsOn[]` 降为解析期输入别名」**，写进了 `SPEC §9.1`。但 `SkillDefinitionSchema`（`contracts/src/agentcore.ts:236-262`）**至今没有 `requires` 字段** —— 18 个字段里零命中。⇒ **裁决进了文档，没进代码。** |
| **② 引用闭包门** | `SK-SPEC-G-25/G-39` · `SK-MIG-30/88/89` · `SK-XR-12/20/21` | ✅ **真落地**（本轮刚闭） | `scripts/check-ref-closure.mjs` 存在；`package.json` 2 处（npm 别名 + gates 链）。gates 实测原文：「三条发布路均接探针 · 两层 fail-open 均关死 · skill 路拦在落库之前」。⇒ C4 点名的两条真实缺口（skill 发布路没接 · fail-open）**均已关**。 |
| **③ `maxBudgetRounds` 效果层** | `SK-SPEC-G-15/G-20` · `SK-MIG-35/84/136` | ⚠️ **形态②·只有 test 引用** | `grep maxBudgetRounds apps/agentcore/src --include=*.ts \| grep -v test` = **0**。实现在 `handoff-skill-partial-a` 分支上，**该分支未并**（撞 `SYSTEM-ONTOLOGY.md`）。⇒ 这条的闭合**卡在合并冲突上，不是卡在开发上**。 |
| **④ `outputSchema` 接消费方或删** | `SK-SPEC-11-5` · `SK-MIG-57/139` | 🔗 **有消费方，但不校验实际输出** | 两处消费方：`skill-lint.ts:342` 只跑 `validateJsonSchemaShape`（**验的是"它是不是一个合法 JSON Schema"**）· `dril/resource-projector.ts:149` 只做投影展示。**没有任何一处拿它校验 Skill 的实际输出。** ⇒ 形态④：字段在、消费方在，但消费方量的不是这个字段该管的事。 |
| **⑤ Business Intent 棘轮** | `SK-SPEC-2-15..2-17` · `SK-MIG-31/90/143/144` | ❌ **无承载物** | `businessIntent` 在 `contracts/src/agentcore.ts` = **0**、`skill-lint.ts` = **0**。SPEC 第②层（Business Intent）**整层无承载物**。 |
| **⑥ `body` 3000 上限** | `SK-SPEC-6-6..6-9` · `SK-AUT-30/48` | 🔴 **契约与门口径打架（新发现）** | 契约 `agentcore.ts:243` 写 `body: z.string().max(50_000)`；而 `skill-lint.ts:47` 写 `const BODY_MAX = 3000`。⇒ **契约放行的东西，门会拒**。一条 4000 字的 Skill 过得了 zod、过不了发布门，且两个数谁是真源没有任何地方声明。 |

### 2.1 这六族核出来的两条硬结论

**结论一：「已裁决」不等于「已落地」。**
族① 是仓主亲自裁过的（2026-08-03「ok」），裁决写进了 SPEC §9.1，`crossreview` 的收口表也标了 ✅「本条已全闭」。
但代码里没有。**收口表记的是「文档改完了」，被当成了「事情做完了」。**
⇒ 形态：**「我用『裁决已写进文档』当作『裁决已落地』的证据，而前者不度量后者。」**
这与今天已记的五次同族（OntologySlice / D3 / Person / Skill.execution / 14 域）**是同一个病的文档侧变种**。

**结论二：族③ 揭示了一个排期事实 —— 有些缺口卡在合并冲突上，不是卡在开发上。**
`maxBudgetRounds` 的实现早写好了，躺在 `partial-a` 分支，因撞 `SYSTEM-ONTOLOGY.md` 未并。
**在它并入之前，任何"补 `maxBudgetRounds`"的派单都是重复劳动。**
⇒ 收编 `compiler-s1` / `partial-a` 两条分支，应排在任何新 Skill 开发之前。

---

## 2.5 🔴 提取方抓到一处 **crossreview 的 C1–C6 漏掉的跨文档冲突**

> 我的 `PRD-skill-crossreview.md` 只记了 C1–C6 六条冲突。提取方在拆 890 条时又找到一条，
> **它不在我那六条里**，而且它正好压在今天刚立的 #159 上：

**`execution` 字段的形态，三份文档三种说法：**

| 文档 | 主张的形态 | 出处 |
|---|---|---|
| `PRD-skill-contract-dsl.md` | `plan[]` —— **线性步骤** | DSL 契约段 |
| `PRD-skill-runtime-orchestrator.md` | `graph` —— **Reasoning Graph** | RT §3.6 / §8 |
| `PRD-skill-compiler-registry.md` | `execution.steps` | CMP 术语表 |

而**已并入主线的实现**（`orchestrator-s1`）给的是
`SkillExecutionSchema = { steps?, graph?, mode? }` —— **三者的并集**，实际上是把冲突"用一个既能这样又能那样的 schema"绕过去了。
⇒ 三份 PRD 的验收条款会各自按自己那套判，**同一份实现可能同时被判过和判不过**。

**这条必须裁决，否则 #159（给 `SkillDefinition` 加 `execution`）落地时不知道该加哪一种。**
建议：以已实现的并集为准（`steps` 是 `graph` 的链式退化形态，RT §3.2 自己也这么写），
但**三份 PRD 须同步改口径**，不许留三种说法。

### 2.6 六处「互相甩锅点」（核对时最易两边都算没做）

| 需求 | 谁认领 | 风险 |
|---|---|---|
| `SKILL_REFERENCE_KINDS` 扩 `tool`/`mcp` | CMP 认领 · RT **明确登记给契约 PRD** · GOV 还要多一个 `actionType` | 三方都以为别人管 |
| `FeatureDef.bindings.skills` | DSL + GOV 都写了 · CMP/RT 未认领 | 重复实现 |
| `maxBudgetRounds` 接消费方 | DSL 定字段 · CMP **只校验并明说未接** · RT 认领运行时接线 | 正是族③ 今天的状态 |
| 引用可校验硬门 | DSL/CMP/RT **三份各写一遍，判据不一致**（CMP 要 fail-closed 且不可 force，DSL 只说 422） | 实现按哪份都可能被另一份判红 |
| `constraint` kind 无权威注册表 | RT 提出并归口给契约 PRD · **DSL 全文未处置** | 掉在缝里 |
| `execution` 字段形态 | 见 §2.5 | 三种形态 |

### 2.7 两处文档自承的口径冲突（不是我判的，是文档自己写的）

1. CMP §14.2 与 RT §12 都标「意图/计划 32」为静态推算，但**算式不同**：CMP 是 `4+16+12`、RT 是 `5+16+11`。
2. GOV §9 订正声明**明确说自己与上游 SPEC §2-⑫/§4-D 结论不一致**，要求 SPEC 随它更新 —— 至今未同步。

---

## 3. SPEC 12 层现状（本轮重测 · 基线 `213fa49e`）

> 上一次测是 ✅1 / ⚠️6 / ❌5。收编 3 条分支后重测。

| 层 | 判定 | 关键证据 |
|---|---|---|
| ① Skill Identity | ⚠️ **部分** | 有 `id/tenantId/key/version/name/status/capability`；**缺 `domain`/`owner`/`riskLevel`/`supersedes`**（`supersedes` 全仓 0） |
| ② Business Intent | ❌ **整层无** | 族⑤ |
| ③ Ontology Binding | 🔗 **能声明·零数据** | `SKILL_REFERENCE_KINDS` 含 `slice`/`ontologyType`，但 7 条种子零条使用；且族① 的 `properties[]`（「Factory 必须有 capacity」）**表达不了** |
| ④ Input Contract | ⚠️ **部分** | `inputSchema` 7/7 有值；**数据来源（ERP/MES/WMS…）无处声明** |
| ⑤ Context Manager | ❌ **整层无** | 无 `context{retrieval,compression,memory}`；且 contract-dsl 与 compiler 双双**显式退出** 5.3 记忆 |
| ⑥ Reasoning Logic | 🔗 **执行器有·实体带不走**（#159） | `SkillExecutionSchema`（`skill-graph.ts:384`）+ `GraphScheduler` + `POST /b/v1/skill-graphs/run`（`server.ts:1332`）**已进主线**；**但 `execution` 挂在路由请求体（`server.ts:1346`）不在 `SkillDefinition` 上** |
| ⑦ Tool / MCP Binding | ❌ **声明不了** | `SKILL_REFERENCE_KINDS` 八种 kind **不含 `tool`/`mcp`** —— 不是「不声明」是「声明不了」（比 SPEC 自评的 🟡 还差一档） |
| ⑧ Rule & Constraint | ✅ **真接线** | `references[kind=rule]` → `engine.ts:41-51` → `:272` 预检 / `:401` 后验。**本轮 WO-S05 把 `kind=solver` 的 precondition 也接上了**，并加了 lint 防复发 |
| ⑨ Solver Integration | ⚠️ **能声明·无运行时消费方** | kind=`solver` 5 条种子；本轮 S05 后 **precondition 语义已可执行**，但 `objective`/`weights` 仍无 |
| ⑩ Workflow Execution | 🔗 **半接** | `approvalGate` 有消费方；`GraphScheduler` 已进主线 ⇒ 比上轮进了一档，但 Skill 层仍不声明「我这一步需人审」 |
| ⑪ Output Contract | 🔗 **有形无约束** | 族④ |
| ⑫ Governance & Learning | ⚠️ **治理半有·学习全无** | `provenancePolicy`/`sideEffect` 真聚合；`SkillExecutionTrace`/`acceptance`/`goldenCases` 全仓 **0** |

**⇒ 本轮：✅ 1 → ✅ 1（⑧）· 🔗 4（③⑥⑩⑪）· ⚠️ 4（①④⑨⑫）· ❌ 3（②⑤⑦）。**
上轮 ❌5 → 今 ❌3（⑥⑩ 因收编分支各升一档），**但 ⑥ 只升到 🔗 不是 ✅**——原因见 #159。

---

## 4. 待办（按性价比排序）

| 序 | 动作 | 覆盖 | 依据 |
|---|---|---|---|
| 1 | **收编 `compiler-s1` + `partial-a` 两条分支** | 族③ + 编译器整块 | 卡在合并冲突不是开发（§2.1 结论二） |
| 2 | **`SkillDefinition` 补 `execution` 字段**（additive 可回退） | ⑥ 升 ✅ · #159 | 执行器已在，只差实体带得走 |
| 3 | **落地 C1 的 `requires` 裁决** | 族① + ③ 的 `properties[]` | 裁决 2026-08-03 已下，代码至今没有 |
| 4 | **裁定 `body` 上限到底是 3000 还是 50000** 并做成单源 | 族⑥ | 契约与门今天打架 |
| 5 | C3 合并门账（每道门"曾真红过"的证据） | `SK-XR-14..17` | crossreview 自记「无人认领」，且**阻塞五份 PRD 任一落地** |
| 6 | **裁决 `execution` 形态三选一并同步三份 PRD** | §2.5 · #159 | 不裁则 #159 落地时不知加哪种 |
| 7 | 逐条核剩余约 1300 条 | — | 本表现状是抽样核完，不是逐条完成 |

> §5 的 C3 是 crossreview 自己标为**序 4 · 阻塞五份 PRD 任一落地**的那条，至今无人认领。
> 本表把它列进来，就是不让它继续隐形。

---

## 5. 本表的诚实边界

1. **1365 条已全部提取，但只核完六族（约 40 条）+ SPEC 12 层。**
   剩余约 1300 条**尚未逐条核** —— 本表现在是「提取完成 + 抽样核完」，**不是「逐条勾选完成」**。
2. 本表判的是**当前 canonical 的实体层状态**，不判「分支上有没有」——
   `compiler-s1`/`partial-a` 上的东西一律记作未落地，**因为用户用的是 canonical**。
3. 六族之外的条目尚未逐条核。**「核了六族」不等于「475 条都核了」** ——
   这正是本项目连续四次遗漏的那个形态，不在本表上重犯。
