# WO-SPEC-INDUSTRIAL-SKILL-GAP · 工业级 Skill 缺口台账

> **本文只出台账，不写实现**（WO-SKILL-PARTIAL-B B 半）。
> 对照物：`docs/SPEC-industrial-skill.md`（仓主给定 12 层 + §4 五条真差距 + §5–§9 各项定案）。
> 逐条：**SPEC 声称的构件 → 今天有没有（`file:line`）→ 三分法定性 → 最小修路径 → 依赖哪张 WO 先做**。
>
> 基线 commit：`9b49b5f6`（canonical `origin/claude/inspiring-gates-aqczjg`）。核对日期 2026-08-09。

---

## §0 · 定性口径（三分法 + 一个第四态）

照 CLAUDE.md 铁律 0.5 判据 1。**混用必修错地方**，故本文每条都必须落一个格：

| 定性 | 判据 | 修法 |
|---|---|---|
| **未实现** | 符号/字段在仓里**根本不存在** | 从零建 |
| **没接线** | 存在，但**src 调用方集合为空**（只有 test 引用 = 已排练，不是已实现） | 接线 |
| **接了线没数据** | 有 src 调用方，但输入**恒空/恒假**，分支从未进入 | 补数据 or 删死分支 |
| **接了线接错地方** | 有 src 调用方，但挂在**错误的路径**上 | 补挂载点 |

### 金丝雀（否定结论的前置自证 · 铁律 0.6）

本文所有「零消费方 / 不存在 / 未实现」结论，都由下列**已知必中**样例证明工具没坏：

| 金丝雀 | 命令 | 命中 | 结论 |
|---|---|---|---|
| 已知存在的功能键 | `grep -rn "view.dash" apps/*/src packages/*/src --include=*.ts` | **32** | shell 展开 glob 正常 |
| 已知存在的字段 | `grep -rn "maxBudgetRounds" packages/contracts/src/*.ts` | **1**（`agentcore.ts:260`） | 字段扫描正常 |
| 已知存在的门脚本 | `ls scripts/ \| grep -i loop-control` | `check-loop-control.mjs` | 门脚本扫描正常 |
| 已知存在的事件名 | `grep -rn "agent_escalated" apps/*/src --include=*.ts` | **3** | 事件名扫描正常 |
| 已知存在的服务 | `grep -rn "EvalService" apps/agentcore/src --include=*.ts` | **2** | 服务符号扫描正常 |

> ⚠ **陷阱已避开**：`git grep -- "apps/*/src"` 的 pathspec `*` **不跨 `/`**，恒 0 命中。
> 本文一律用 **shell 展开的 `grep -rn`**（由 shell 先展开 `apps/*/src`），金丝雀 32 命中即其自证。

---

## §1 · 12 层逐条台账（对照 SPEC §1/§2）

| # | 层 | SPEC 判 | **本单复核** | 证据 `file:line` | **定性** | 最小修路径 | 依赖 WO |
|---|---|---|---|---|---|---|---|
| 1 | Skill Identity | 🟡 部分 | **确认**。`id/tenantId/key/version/name/summary/body/resources/status` 在；`domain`/`category`/`owner`/`risk_level`/`supersedes` **全无** | `packages/contracts/src/agentcore.ts:236-261` | **未实现**（5 字段） | 契约加 5 个 additive 可选字段 + seed 回填 | WO-SKILL-CONTRACT（另一 dev 在做 `skill-*.ts`） |
| 2 | Business Intent | 🔴 几乎全缺 | **确认**。Skill 侧零字段；`IntentDefinitionSchema` 有 `owner`/`riskLevel` 但**那是 Intent 不是 Skill** | `packages/contracts/src/qos.ts:44-63` | **未实现** | 契约加 `businessIntent{role,scenario,trigger,kpi}`，按定案 4 用哨兵 `{status:"TODO"}` 必填 | WO-SKILL-CONTRACT |
| 3 | Ontology Binding | 🟡 有物无声明 | **确认**。Skill 侧无 `objectTypes`/`relations` 声明；只有通用 `references[]` | `agentcore.ts:254`（`references`） | **未实现**（专用声明位） | 归入 §3 `requires` 一并做 | WO-SKILL-REQUIRES |
| 4 | Input Contract | 🟡 两处未统一 | **确认**。Skill `inputSchema` 可选（`:253`）× Intent `slots[]`（`qos.ts:53`）并存，无一权威；数据来源零声明 | `agentcore.ts:253` / `qos.ts:53` | **接了线接错地方**（两套并存） | 收敛为一处权威（Track E） | WO-SKILL-MIGRATION |
| 5 | Context Manager | 🟡 三项各有问题 | 未逐项复核（超出本单取证范围，照 SPEC 转录） | — | *(未复核·见 §5 诚实边界)* | — | — |
| 6 | Reasoning Logic | 🔴 是线性步骤不是图 | **确认**。全仓 `SkillReasoningGraph` **零命中**（金丝雀已自证工具） | *(零命中)* | **未实现** | 见 §3 推理图落位 | WO-SKILL-COMPILER |
| 7 | Tool / MCP Binding | 🟡 有物无声明 | **确认**。Skill 不声明 `tools[]` | — | **未实现**（声明位） | 归入 `requires` | WO-SKILL-REQUIRES |
| 8 | Rule & Constraint | 🟡 引擎在·绑定缺 | ⚠ **SPEC 此格偏保守**：Skill **已能**绑规则并**真跑** —— `references[]` 里 `kind==="rule"` 且带 `role:"precondition"\|"postcheck"` 的项，被 `engine.ts:44` 真取出跑前置/后置校验 | `apps/agentcore/src/engine.ts:41-51` | **接了线有数据会触发** | 无（此半已通）；缺的是 §2-⑧ 说的 `G-C08-EXPR-PARAM-SPLIT` 引擎实缺 | WO-RULEDSL-PARAMS |
| 9 | Solver Integration | 🟢 有真物 | **确认**唯一完整层 | — | **有真物** | Skill 侧 `solver.ref+objective` 内联仍缺（定案 2） | WO-SKILL-REQUIRES |
| 10 | Workflow Execution | 🟡 有物·审批与 Skill 不连 | **确认**。Skill 无 workflow 绑定 | — | **未实现**（绑定位） | 归入 `requires` | WO-SKILL-REQUIRES |
| 11 | Output Contract | 🟡 有形无约束 | ⚠ **SPEC 此格已过期 —— 见 §2-A，定性要改** | `skill-lint.ts:300` / `resource-projector.ts:149` | **接了线接错地方** | 补**一个**校验点（不是接一条线） | WO-SKILL-OUTPUT-GATE |
| 12 | Governance & Learning | 🔴 写得了治不住 | 未复核 RBAC 三条（SPEC 已自行更正过一轮，且 `server.ts` 不在本单边界） | — | *(未复核)* | — | — |

---

## §2 · SPEC §4 五条「真差距」复核（**含对 SPEC 自身的三处更正**）

### A · D5「`outputSchema` 有值但零消费方」——**已过期，定性要改**

**SPEC 原文**（§2-⑪ / §4-D5）：「`outputSchema` **零消费方** —— 没有任何地方拿它校验实际输出」。

**实测**（`grep -rn "outputSchema" apps/*/src packages/*/src --include=*.ts`，金丝雀已自证）：**11 命中**，其中 **2 个真 src 消费方**：

| 消费方 | 干什么 | 是不是 SPEC 要的那件事 |
|---|---|---|
| `apps/agentcore/src/skill-lint.ts:300` | `validateJsonSchemaShape(skill.outputSchema, …)` —— 校验**这个 schema 自己**形状合法 | ❌ 校验的是 schema，不是输出 |
| `apps/agentcore/src/dril/resource-projector.ts:149` | `outputSpec: ioSpecFromJsonSchema(s.outputSchema)` —— 投影成 DRIL 检索用的 `outputSpec` | ❌ 拿去检索排序，不是校验 |

外加 **7 条 seed 真数据**（`mocks/seed.ts:1055,1102,1146,1190,1233,1277,1328`）。

> **定性从「没接线」改为「接了线接错地方」。这不是措辞问题，是工作量差一个数量级**：
> 「零消费方」的修法是**建立消费链**；而真相是链已建、**只是没有任何一处拿它比对实际 `answer.blocks`**，
> 修法是**在答案出口加一个校验点**。SPEC 的判断会把这条排成「造一套」，实际是「补一处」。
> —— 这正是 CLAUDE.md 铁律 0.5 ③ 记过的同一种病（把「接一条线」错报成「造一道门」，直接歪掉排期）。

**最小修路径**：`agent/loop.ts` 收尾 `acceptFinalAnswer` 后（或 `reflect.ts` 复盘清单加一项），
若当前 skill 声明了 `outputSchema` 则校验 `answer.structured`；不过关走既有 reflect 打回。
**依赖**：WO-SKILL-OUTPUT-GATE（可独立做，不依赖 `requires` 改造）。

### B · D4「`maxBudgetRounds` 全空且零消费方」——**成立，且是「只有 test 引用」的教科书形态**

| 位置 | 性质 |
|---|---|
| `packages/contracts/src/agentcore.ts:260` | 字段声明 |
| `apps/agentcore/test/skill-contract.test.ts:65` | 测试**写**了 `maxBudgetRounds: 12` |
| `apps/agentcore/test/skill-contract.test.ts:77` | 测试**断言**读回 `toBe(12)` |

**src 消费方：0**（金丝雀 `maxBudgetRounds` 在 contracts 命中 1，证明扫描没瞎）。
⇒ **假绿第 9 形态 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR`**：实现有、测试有、且是绿的，**零生产调用方**——
测试咬的是**契约往返**（存得进读得出），不是**链路**（这个数真的改变探索轮次）。

**定性：没接线**。
**最小修路径**：`orchestrator.ts` 组 `budget` 时，若本题命中的 skill 有 `maxBudgetRounds` 则覆盖全局常数。
**验收必须是效果层**（SPEC §4 已写死）：改 skill 里这个数 → 该类题**实际探索轮次真变**；只读出来不算。
**依赖**：WO-SKILL-BUDGET（需先有 intent→skill 边才知道"本题命中哪个 skill"，故**依赖 D1**）。

### C · `dependsOn` 与 `references` **必须拆开说**（照 CLAUDE.md 铁律 0.5 ① 的更正）

实测（复验命令即 CLAUDE.md 给的那条）：

```
grep -c "dependsOn"   apps/agentcore/src/mocks/seed.ts   → 0
grep -c "references:" apps/agentcore/src/mocks/seed.ts   → 7
```

| 字段 | 消费方 | 数据 | **定性** | 修法 |
|---|---|---|---|---|
| `dependsOn` | `skill-lint.ts:212`（`detectSkillDependencyCycle` 读 `s.dependsOn`）· `resource-projector.ts:334` | **0 条** | **接了线没数据** | 补数据（或承认 skill 间无复用） |
| `references` | `skill-lint.ts:301,305` · `resource-projector.ts:333` · **`engine.ts:44`（真跑规则前后置）** | **7 条** | **接了线有数据、会触发** | 无（此半已通） |

> 两者定性不同、修法不同。**一句「7/7 全空」会把两个不同事实盖住**——这条戒律本身在 CLAUDE.md 里已被更正过一次，本文照 0.6 不再复犯。

### D · D3「`resources` 7/7 全空」——**成立**

`grep -n "resources: \[\]" apps/agentcore/src/mocks/seed.ts | wc -l` → **7**；
且无任何多行 `resources: [` 形态（即无非空项）。7 个 skill 全空。
**定性：接了线没数据**（`read_skill_resource` 机制在、`SkillAttachment` 契约在，就是没内容）。
**最小修路径**：把 SPEC §6 包结构的文件逐个塞进 `resources[]`（SPEC §6 已指出"不需要新造承载机制"）。
**依赖**：WO-SKILL-PACKAGE。

### E · D1「与意图零绑定」——**成立，且是全表最阻塞的一条**

`IntentDefinitionSchema`（`packages/contracts/src/qos.ts:44-63`）字段全列：
`id/packageId/key/version/status/name/description/examples/enabledViews/slots/planId/planRef/riskLevel/owner/createdAt/updatedAt`。
**没有任何 skill 引用字段**（`skillKey` 在仓里唯一出现处是 `EvalCaseSchema`·`agentcore.ts:396`，那是评测用例关联，不是意图→技能边）。

**定性：未实现**（这条边根本不存在，不是"少了 25 个"）。
**最小修路径**：`IntentDefinitionSchema` 加 `skillRef`（形同既有 `planRef`）。
**依赖**：**无 —— 这是整张表的 root**。`maxBudgetRounds`（B）、按题型配 Context（层 5）、
Skill 侧 `outputSchema` 校验（A）都要先知道"这题归哪个 Skill"。**先做这条。**

---

## §3 · SPEC §5/§7/§9 定案的落地缺口

### F · §5「必配硬门：引用可校验」——**SPEC 说「这道门今天做不了」，已部分过期**

SPEC §5 原文：「加门断言每个被引用的 key 真的已注册…**这道门今天做不了**（无任何一处声明）」。

**实测推翻一半**：探针**已存在且已接两处**——

| 位置 | 状态 |
|---|---|
| `apps/agentcore/src/resources.ts:11` | `probeMissingRefs` **定义在** |
| `apps/agentcore/src/server.ts:690` | **agent 发布**路已接 |
| `apps/agentcore/src/server.ts:1008` | **workflow 发布**路已接 |
| `apps/agentcore/src/server.ts:1235`（`POST /b/v1/skills/:id/publish`） | ❌ **skill 发布路没接** |

**而且缺口比"少接一处"更深**——`lintSkill` 的引用校验**显式跳过非 skill 引用**：

```ts
// apps/agentcore/src/skill-lint.ts:177
if (ref.kind !== "skill") continue; // 非 skill 引用由发布时的跨系统探针或各自注册表保证
```

**它把 rule / solver / objectType / tool 引用甩给"发布时的跨系统探针"，而那个探针恰恰没接在 skill 发布路上。**
⇒ **Skill 上的 rule/solver/objectType/tool 引用，在发布时无人校验**（skill→skill 引用有 `validateRefResolution`
+ `detectSkillDependencyCycle` 守着，非 skill 的没有）。

**定性：接了线接错地方**（挂在 agent/workflow 两条发布路，漏了 skill 这条）。
**最小修路径**：`server.ts:1235` 发布 handler 里照 `:1008` 同款调一次
`probeMissingRefs(deps.dataCore, a, { solverKeys, ruleKeys, objectTypes })`，并**改 fail-open 为 fail-closed**。
**工作量：接一条线，不是造一道门。**
**依赖**：无（可立即做）。⚠ 但 `server.ts` **不在本单边界**，需另开 WO-SKILL-REF-GATE。

### G · 定案 1/3「`requires` 契约」——**未实现**

契约里只有 `references[]` / `dependsOn[]`（`agentcore.ts:254-255`），**没有 `requires`**，
故定案 1 的核心语义（「`Factory` 必须有 `capacity` 属性」「rule 必须已 PUBLISHED」「不满足拒装」）**表达不了**。
`SkillReference` 是扁平 `{kind,key}` 形状 —— 正是 SPEC §9.1 说的「照 migration 写法定案 1 的语义落不了地」。

**定性：未实现**。**依赖**：WO-SKILL-CONTRACT（另一 dev 在做，**本单不碰 `packages/contracts/src/skill-*.ts`**）。

### H · §9.4 推理图落位 + 三道配套门——**全未实现**

| 构件 | 今天 | 定性 |
|---|---|---|
| `SkillReasoningGraph` 结构化字段 | 全仓零命中 | **未实现** |
| `load_reasoning_node(nodeId)` 工具 | 全仓零命中 | **未实现** |
| 门 `skill-graph:check`（DAG/无孤儿/ref 可解析） | `ls scripts/ \| grep -i skill` → 无（金丝雀 `check-loop-control.mjs` 命中） | **未实现** |
| 门 `skill-refs:check` | 同上，无 | **未实现** |
| 门 `skill-business-intent:check`（TODO 棘轮） | 同上，无 | **未实现** |

> 可复用的现成模式已核实在跑：`buildSkillSection`（`prompts.ts:71` 调 `selectSkills`）top-k 注全文、其余降级为 id、
> 模型按需 `load_skill` 取全文 —— SPEC §9.4 说的「同一模式下推一级」有真实落点，不用新造工具族。

**依赖**：WO-SKILL-COMPILER（依赖 G 先落 `requires`，否则图里的 `solverRef`/`ruleRef` 无处解析）。

---

## §4 · SPEC §8 SDK 层（仓主给定 V1.0）

| SDK 项 | 今天 | 定性 |
|---|---|---|
| Skill CLI（create/validate/compile/test/package/deploy） | 零命中 | **未实现** |
| Skill Compiler（AST/Validator/Optimizer） | 零命中 | **未实现** |
| `.skill` 包 + `manifest.json` + `signature/` | 零命中 | **未实现** |
| Skill Orchestrator API（Skill Graph） | 零命中 | **未实现** |
| **Permission：per-Skill data/tool/action 三面** | `grep -rn "allowedTools\|skillPermission\|toolAllowlist"` → **零命中** | **未实现**（SPEC 判 🔴 真缺口，**确认**） |
| Execution Trace 含 Prompt Version | prompt 在代码里，无版本字段 | **未实现** |

> ⚠ **SPEC §8 头号风险「API 面重复」本单认同**：12 组 SDK API 多数在仓里已有对应端点，
> 应按「新增薄层 + 复用既有端点」实现。此项是**设计约束**不是缺口，不进本表定性。

---

## §5 · 汇总

### 按定性分组

| 定性 | 条目 | 条数 |
|---|---|---|
| **未实现** | 层①5字段 · 层②Business Intent · 层③⑦⑩声明位 · 层⑥推理图 · **D1 意图→技能边** · `requires` · 3 道门 · SDK 6 项 | **16** |
| **没接线** | **D4 `maxBudgetRounds`**（只有 test 引用） | **1** |
| **接了线没数据** | **D3 `resources` 7/7 空** · `dependsOn` 0 条 | **2** |
| **接了线接错地方** | **D5 `outputSchema`**（消费方在·不校验输出） · **F 引用可校验门**（漏 skill 发布路） · 层④输入契约两套并存 | **3** |
| **接了线有数据会触发**（无需修） | 层⑧规则引用（`engine.ts:44` 真跑） · `references` 7 条 | 2 |
| **未复核** | 层⑤ Context Manager · 层⑫ 治理 RBAC 三条 | 2 |

### 依赖排序（先做谁）

```
① D1 意图→技能边（root·无依赖·阻塞 D4/层⑤/层⑪）        → WO-SKILL-INTENT-EDGE
② F  引用可校验门接 skill 发布路（无依赖·接一条线·收益即时） → WO-SKILL-REF-GATE
③ G  requires 契约（阻塞推理图与三道门）                   → WO-SKILL-CONTRACT（进行中）
④ A  outputSchema 校验点（无依赖·补一处）                  → WO-SKILL-OUTPUT-GATE
⑤ B  maxBudgetRounds 接线（依赖 ①）                        → WO-SKILL-BUDGET
⑥ D3 resources 填包（依赖 ③）                              → WO-SKILL-PACKAGE
⑦ H  推理图 + 3 道门（依赖 ③）                             → WO-SKILL-COMPILER
```

**②④ 可与①③ 完全并行**（无共享文件、无语义依赖）。

---

## §6 · 诚实边界

1. **未复核项照实标空，不照抄 SPEC 充数**：层⑤ Context Manager 三项、层⑫ 治理 RBAC 三条，
   本单**没有**逐项跑证据（前者需实测 token 阈值、后者需读 `server.ts` 权限链，均超本单边界/CPU 纪律）。
   表里标 *(未复核)* 而非沿用 SPEC 结论 —— **转录不是复核**。
2. **本文所有否定结论都配了金丝雀**（§0 表）。`git grep -- "apps/*/src"` 的 pathspec 陷阱**已避开**：
   全文用 shell 展开的 `grep -rn`，金丝雀 32 命中即自证。
3. **对 SPEC 的三处更正（A/C/F）是本文的主要增量**，且三处**都是同一种病**：
   SPEC 拿 grep 的直接命中数当结论、少追一层间接调用。三处的修法都因此被错估
   （A 把「补一处」说成「造一套」、F 把「接一条线」说成「造一道门」、C 把两个字段合成一句）。
4. **未跑四包 gate**（本单 CPU 纪律禁 `pnpm -r test` / datacore vitest）。本文是**只读取证**产物，不改运行时代码。
5. **`packages/contracts/src/skill-*.ts` 本单未碰也未读改**（另一 dev 在做）；本文引用的契约位置均在
   `packages/contracts/src/agentcore.ts` 与 `qos.ts`，为**现状**快照，可能被那张 WO 改写。
