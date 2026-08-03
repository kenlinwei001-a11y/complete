# Skill 改造五份 PRD · 对照审查（审核方）

> 五份 PRD 由五个 dev 并行产出，各自独立读码。本文件是**并线前的对照审查**：
> 只记**跨文档的冲突、重复、传播性错误与口径分歧**，不复述任何单份 PRD 的内容。
>
> 纪律：本文每条结论的 `file:line` 都是我**亲手核过的**，不是据 PRD 转述。
> 凡我核不动的，明写"未核"。（本会话已发生过四次"据 grep 下结论、漏一层间接"的错误，
> 三次是同一种病；本文按"先核后写"执行。）

**被审五份**

| # | 文档 | 分支 | 行数 |
|---|---|---|---|
| 1 | `docs/PRD-skill-contract-dsl.md` | `claude/handoff-prd-skill-contract` | 643 |
| 2 | `docs/PRD-skill-compiler-registry.md` | `claude/handoff-prd-skill-compiler` | 741 |
| 3 | `docs/PRD-skill-governance-learning.md` | `claude/handoff-prd-skill-governance` | 722 |
| 4 | `docs/PRD-skill-runtime-orchestrator.md` | `claude/handoff-prd-skill-runtime` | 720 |
| 5 | `docs/PRD-skill-migration.md` | `claude/handoff-prd-skill-migration` | 534 |

---

## 0. 并线前必须先处理的一条机械风险（与内容无关）

四份分支（contract / compiler / runtime / migration）从 `f1a37a7e` 或更早切出，
而 canonical 已到 `620090c8`，其间新增了 `docs/TEST-PLAYBOOK.md`（205 行）。
故 `git diff canonical..<branch>` 对这四条都显示 **`docs/TEST-PLAYBOOK.md | 205 ------`**。

> **并线方式必须是 cherry-pick 单个 PRD commit，不能 merge 分支**——
> merge 会把 TEST-PLAYBOOK.md 删掉，而它正是仓主要求交付、准备派给其他 agent 执行的测试手册。

---

## 1. C1 · `requires` vs `references[]/dependsOn[]` —— **真冲突，需仓主裁决**

**两方主张**

| 方 | 主张 | 位置 |
|---|---|---|
| contract PRD | `skill.requires.{objectTypes, relations, slices, rules, solvers, tools, mcp, workflows, agents, dependsOn}`，每条带 `required` / `minStatus` / `properties[]` | §4.5 |
| migration PRD | **保留现名 `references[]` / `dependsOn[]`，不改叫 `requires`**（自标"⚠ 这是我提的偏离，请裁决"） | §10.3 表 · §1.5 G3 |

**migration 的理由与我的核验结论**

> 理由原文：`requires` 已被 `FeatureDef.requires`（entitlement 依赖级联）占用，再用一次 =
> 同名不同义的第三套词表，正是 `G-SIDEEFFECT-VOCAB-SPLIT` 那一族的病。

- ✅ **占用属实**：`packages/contracts/src/features.ts:15` `requires: z.array(z.string()).optional()`。
- ❌ **但类比不成立**。`G-SIDEEFFECT-VOCAB-SPLIT` 是**同一个概念**有三套互不相识的词表
  （判定分支永不触发、测试自产自销照样绿）。这里是**两个不同对象**（`FeatureDef` / `SkillDefinition`）
  各有一个同名字段，语义各自自洽——与 `id` / `key` / `version` 同类，是常态不是病。
- ❌ **也不构成导出冲突**。`ExecutionPlanSchema` 那次是**真的同命名空间导出撞车**，
  所以 `packages/contracts/src/execution-plan.ts:6-7` 才改叫 ComposePlan；那条先例
  （compiler PRD §2.4 引以为据）在此**不适用**：两个 `requires` 是对象内字段，不是顶层导出。

**更要紧的是：这两个提案的表达力不同，不只是拼写不同。**

`requires` 能表达 `objectTypes[].properties: ["capacity"]` + `required: false` + `rules[].minStatus: "PUBLISHED"`；
扁平的 `references[]`（`{kind, key}`）**表达不了**「Factory 必须有 capacity 属性」这种契约式需求，
而这正是 SPEC §7 定案 1「`requires` 是契约不是副本 · 装载期校验 · 不满足拒装」要的东西。
**照 migration 的写法，定案 1 的语义落不了地**——它说"语义全盘采纳、只是不用这个词"，
但扁平结构承载不了那个语义。

**我的建议（供裁决）**：**采纳 contract PRD 的 `requires` 结构**，
并把 `references[]` / `dependsOn[]` 降为**解析期归一的输入别名**——
读入即折进 `requires`，运行时只有一处真源（contract PRD §5.3「一份声明、一处读」）。
这样既拿到表达力，又不产生第二套**活的**词表（别名是入口不是真源），
且 7 个存量 Skill 与 `skill-lint.ts:212/302`、`resource-projector.ts:334` 无需大爆炸迁移。

> 若仓主选 migration 方案，则 contract PRD §4.5 与 SPEC §7 定案 1 都要改，
> 且必须同时回答「`properties[]` / `minStatus` 这类契约式需求放哪」——不能留空。

---

## 2. C2 · 引用闭包门被提了两次，两个名字 —— **C1 的症状，不是独立问题**

| PRD | 门名 | 判据 |
|---|---|---|
| contract §0.6-5 | `skill-refs:check` | `requires` 的引用静态可校验 + 运行态发布门 |
| migration §5.2-2 | `skill-ref-closure:check` | 每个 `references[]` 的 key 真已注册 |

**同一件事、两个名字**，且各自锚在自己那套字段名上。**C1 一裁决，这两道门合并成一道**。
不裁决就并线 → 仓里会同时出现两道功能重叠的门（第 5 形态假绿的温床：
两道门互相以为对方管着，实际都只管一半）。

---

## 3. C3 · 门总数 16 → 33，**没有任何一份 PRD 负责这张合并清单**

五份 PRD 新提的门（去重后 **17 道**）：

```
contract    : skill-refs
compiler    : skill-compiler
governance  : skill-permission · skill-trace · skill-eval · skill-lint · growth-hitl · metrics-tenant
runtime     : graph-runtime · progress-reachability
migration   : skill-ref-closure · skill-plan-parity · skill-single-source · skill-export
              skill-business-intent · skill-budget-effect · skill-entitlement-single
```

叠加现有 16 道 = **33 道**，而 `ontology-writeback:check` 强制每道门都要登记进本体 §7。

**风险**：门多不等于治理强。本仓已登记的第 5 形态假绿就是「**被制度指定的死门**」
（红 + 零接线，见 #76）；门一多，"某道门长期红/长期没人跑"的概率线性上升。

**建议**：任一份 PRD 落地前，先出**一张合并门账**（谁跑、何时跑、红了谁修、
以及**每道门的"曾经真红过"证据**——没红过的门不算门）。这张账目前无人认领。

---

## 4. C4 · 同一条不准确说法在三份文档里传播 —— **必须一次性掐掉**

**说法**：「引用可校验门今天做不了」。
- migration §5.2-2 原文：「**这道门今天做不了**（`skill-lint.ts:177` 明确跳过所有非 skill 引用）」
- `docs/SPEC-industrial-skill.md` 亦有同源表述（已随本批更正）

**我的核验（逐条 file:line 亲手看过）**

| 断言 | 核验结果 |
|---|---|
| `skill-lint` 只校验 `kind=skill` 的引用 | ✅ 属实（`skill-lint.ts:165` 注释「仅针对 kind=skill（本地资源）」） |
| 「所以这道门今天做不了」 | ❌ **不成立**。`probeMissingRefs`（`apps/agentcore/src/resources.ts:11`）**已经能校验非 skill 引用**，且**已接线两处**：workflow 发布 `server.ts:1008`（`solverKeys` / `ruleKeys`）、agent 发布 `server.ts:690`（`objectTypes`） |
| 真实缺口 | **skill 发布路没接**——`POST /b/v1/skills/:id/publish` 只调 `lintSkill`（`server.ts:1243`）；**且 `probeMissingRefs` 自身 fail-open** |

**为什么这条必须纠正**：它把工作量从「**接一条已有的线 + 关掉 fail-open**」
错报成「**从零造一道门**」，会让排期与风险判断整体偏移。

---

## 5. C5 · **「Phase 2」在这套 PRD 里指三件不同的事** —— 最高风险的口径冲突

| 出处 | 「Phase 2」的含义 |
|---|---|
| migration §3 分期总览 | **权威翻转**：执行改读 `Skill.execution.plan`，删 Plan 独立入口 |
| runtime §7.1（对 WO Track A 的裁决） | **正则门降级为白名单**（路由改造的第三步） |
| runtime §3.6 / §2 非目标 | **图运行态跨请求持久化 + `human` 节点 resume** |

三个 Phase 2 分属三条互不相干的时间线，而 runtime §7.1 写着
「**Phase 2 是 Runtime 的硬前置**」——**读者无法判断是哪个 Phase 2**。

同理 `Phase 1`：migration 指"一致性门"，runtime §7.1 指"给 10 道门打 `routeSource` 标签"，
runtime §3.6 又指"`human` 节点非阻塞形态"。

**这不是文风问题**。本仓所有反复炸的坑（metric-aware、接缝丢参、两张词表）
都是**两半各自用一套词、没人对接**。三条时间线共用一个编号词，是同一个病在文档层的复现。

**建议（并线前必须做，成本极低）**：三条线各自加前缀，全文替换——

```
迁移线   : M0 影子声明 · M1 一致性门 · M2 权威翻转 · M3 独有能力
路由线   : R0 先量后改 · R1 routeSource 标签 · R2 正则门降白名单 · R3 检索前置
运行时线 : T1 单请求图 · T2 跨请求 resume
```

于是 runtime §7.1 的裁决读作「**R2 是 T1 的硬前置，R1 必须与 T1 合并实施**」——一读即明。

---

## 6. C6 · 已显式声明的口径差异（**不是冲突**，但要收敛成一个数）

runtime PRD 自己标注了两处与 WO 的口径差异，处理是对的（显式声明 > 悄悄不一致）：

1. **决策点计数**：runtime 数 `runPipeline` 内 **13 个可返回决策点** + classify 作第 14；
   WO 说「分类器前有 **10 道正则门**」。二者**统计口径不同**（前者含非正则的提前返回），
   不矛盾。但**本体 §8 里我这次只写了「10 道」**（`G-ROUTE-REGEX-PREEMPTS-RETRIEVAL`）——
   建议在本体里把两个口径一并写明，否则迟早冒出第三个数。
2. **E9「旁白一条不发」**：那是 `518e46b1` **之前**的基线；现存缺口收窄为
   角色 agent / 场景 agent 无旁白 + 无结构化进度 + 前端 reducer 丢 `role/roleLabel`。

---

## 7. 一致性检查：五份 PRD **没有**冲突的地方（记录下来，免得下轮重查）

- **「Skill 吞并 ExecutionPlan」**：五份口径一致（contract §4.4 / migration §7 / compiler §3.2 术语表脚注 / runtime §3.2）。
- **命名禁外部产品名**：compiler §3.1 红线 2 已把 SDK 规格里的 `dos skill …` 改为 `platform skill …`，复用既有 `scripts/platform-cli.mjs` 不新起二进制——符合铁律 0，其余四份无相反主张。
- **禁止手抄枚举**：compiler §3.1 红线 3 与 governance §3.1「不许出现第二个判定出口」、runtime §4.3「Skill 只能收紧不能放宽」同向，无冲突。
- **Skill 预算只能收紧**：runtime §4.3 与 governance 的权限三面「一处判定」互补，不重叠。
- **`execution.steps` 复用既有 `PlanStepSchema`**：compiler §3.2 明确"复用既有类型是单一来源，不是重名"——与 contract §4.4 一致。

---

## 8. 结论与建议处置顺序

| 序 | 事项 | 谁定 | 阻塞谁 |
|---|---|---|---|
| 1 | **C1 命名裁决**（建议：`requires` 结构 + 旧名降为解析期别名） | **仓主** | contract / migration / compiler 都改不动，C2 也解不了 |
| 2 | **C5 三条时间线加前缀**（M/R/T） | 审核方可直接做 | 所有 PRD 的可读性与派单准确性 |
| 3 | **C4 掐掉传播性错误** | 审核方（本批已改 SPEC，migration §5.2 待改） | 排期判断 |
| 4 | **C3 合并门账 + 每道门"曾真红过"证据** | 需立一张单，无人认领 | 五份 PRD 任一落地 |
| 5 | C6 口径一并写进本体 | 审核方 | 无（防第三个数） |

> **诚实边界**：本文只做了**跨文档对照**与其中关键断言的代码核验，
> **没有**逐份 PRD 做完整技术复审（例如 compiler 的编译管线是否可实现、
> governance 的 trace 采集点是否够用，均未逐条验证）。
> 五份 PRD 各自的 `file:line` 我抽查了本文引用到的那些，未做全量抽验。
