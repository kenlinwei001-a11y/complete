# PRD 增量 · Skill 编写规范与质量门禁（让技能"优秀"成为可校验属性）

| 项 | 值 |
|---|---|
| 版本 | v1.0（修订 平台 §8.4 / 管理平台 §4 的 skill 发布校验；联动评测体系 OC2；基线裁决 #25） |
| 解决问题 | 现有 PRD 只规定技能容器，未规定内容质量标准——本文将"优秀技能"定义为**可 lint、可评测的客观属性**，使低能力开发/编写代理无需判断力也能产出达标技能 |
| 对齐 | Anthropic Skill 实践共识：summary=触发器而非简介、渐进披露、祈使句操作规程、显式不适用边界 |

## 0. 本体引用与影响（补录）

> 遗留 PRD 追溯补录（治理 #2，prd:check 入图）；仅引用平台真实不变量(§5 R1–R14)/断点(§8 G-1..G-8)。

- **触及对象类型**（`docs/SYSTEM-ONTOLOGY.md` §2.H）：
  - `Skill`（`SkillDefinitionSchema`，`packages/contracts/src/agentcore.ts`）：工业级字段 capability/sideEffect/inputSchema/outputSchema/references/dependsOn/approvalGate/provenancePolicy/maxBudgetRounds/resources；生命周期 DRAFT→PUBLISHED→RETIRED。
  - `SkillReference`：kind∈{rule,constraint,slice,ontologyType,solver,skill,workflow,agent}，含 required/role/version。
  - `SkillAttachment`：resources 附件（mime/description）。
  - `AgentDefinition.skills[]`：挂载 skillId+version+arguments。
  - `EvalCase`：新增 `suite=skill_quality`、`skillKey`、`expect.behaviorGain`。
  - `SkillResource`（DRIL 统一资源投影，WO-SKILL-4）。
- **触及链路**（`docs/SYSTEM-ONTOLOGY.md` §3）：
  - `Agent --binds--> Skill`（运行时挂载）。
  - `Skill --references|dependsOn--> {rule|constraint|slice|ontologyType|solver|skill|workflow|agent}`。
  - `Skill --evaluatedBy--> EvalCase(suite=skill_quality)`。
  - `Skill --projectedTo--> SkillResource`（DRIL 检索）。
  - `Skill --published--> skill.published` 事件。
- **触及事件**（`docs/SYSTEM-ONTOLOGY.md` §4）：`skill.published`（B 栈 outbox，失效 agent-editor.skill-bindings）。
- **触及不变量**（§5）：
  - R1（contracts-only-shared：Skill 契约在 `@platform/contracts` 定义，跨包复用）。
  - R3（entitlement：feature 关则不存在，Skill 相关入口受 catalog_admin/authz 守护）。
  - R4（版本化/发布态：DRAFT 可编辑，PUBLISHED 不可变，RETIRED 退役；引用 latest 的 agent 下次加载即新内容）。
  - R6（确定性：SkillProbeRunner 行为增益对照、lint 规则纯函数、依赖环检测稳定）。
  - R9（仓储双实现+迁移：skills/evalCases/resource_relations 表 memory/pg 同改）。
  - R13（诚实输出：provenancePolicy=required 必须带 provenance；WRITE/approvalGate 必须产 action_draft；无行为增益的技能被评测门禁拒）。
  - R14（零业务常数：Skill 资源投影不从代码内联业务对象名）。
  - R16（发育闭环：Skill 发布经 lint+eval 两门，跨资源 dependsOn/references 必须指向 PUBLISHED，无环）。
- **触及门禁**（`docs/SYSTEM-ONTOLOGY.md` §7）：
  - `skill-lint:check`（结构 lint：summary/body/契约字段/依赖解析/无环）。
  - `skill-eval:check`（评测门禁：≥3 skill_quality 用例 + SkillProbeRunner 挂载真实 agent 全过）。
  - `ontology-writeback:check`（新增门须回写 §7，本次补录同步满足）。
- **触及断点**（§8）：（无新增特定断点；诚实边界：mock LLM 下评测分数仅证管线与断言框架正确，接 REAL 模型后才是真质量分。）
- **范畴**：Skill 编写规范与质量门禁：技能优秀=可校验属性（lint + 评测用例）

## 1. 三级职责铁律（写错层级 = 发布拒绝）

| 级 | 职责 | 一句话判据 |
|---|---|---|
| summary（≤200 字，常驻 agent 系统提示词） | **触发器**：让模型在恰当时机想起加载它，其余什么都不是 | 删掉任何一句都会导致漏触发或误触发——否则那句不该在 summary 里 |
| body（≤3000 字，load_skill 按需加载） | **操作规程**：照着能把事做对的步骤 | 全文可执行——出现"介绍""背景""众所周知"即违规 |
| resources（read_skill_resource 按需读取） | **参考资料**：表格/清单/长文档 | body 中超过 10 行的静态数据必须下沉至此 |

## 2. Summary 规范（强制模板）

```
[一句话能力] 当 [触发场景1]、[触发场景2]、[触发场景3] 时使用。
不适用：[排除场景]（此时应 [替代做法]）。
```

- 触发场景必须是**业务动词短语**（"用户追问产能口径差异""回答涉及 P50/P90 取舍"），禁止抽象名词（"产能相关问题"——过宽必误触发）；
- **不适用句强制存在**——没有排除边界的技能是误触发制造机；
- 禁用词 lint：`有用|强大|全面|各种|帮助你|介绍` 出现即拒（这些词只占字数不增触发信息）；
- 多技能互斥：同一 agent 的技能 summary 两两做触发场景重叠检查（编辑器警告），重叠场景必须在各自"不适用"句中互相让渡。

## 3. Body 规范（固定骨架，发布校验检查段落存在性）

```markdown
## 目的            一句话，与 summary 能力句一致
## 适用边界        适用/不适用各 ≥1 条（比 summary 展开）
## 前置检查        执行前必须确认的事实（含用哪个工具确认）
## 步骤            祈使句编号步骤；每步含"做什么+用什么工具+判定标准"；分支用"若 X → 步骤 N"
## 示例            ≥1 正例（输入→正确处理→输出）+ ≥1 反例（常见错误做法及为何错）
## 失败处理        每类可预见失败的明确动作（重试/换工具/向用户说明边界——禁止"酌情处理"）
## 输出要求        交付物形态（引用溯源要求/block 类型/语气约束）
```

- 写作纪律：祈使句（"调用 X 校验 Y"），禁叙事体与第一人称；具体值优先于形容词（"≤6 周"而非"较短时间"）；工具名/字段名与平台注册表逐字符一致（lint 反查注册表）；
- 超 3000 字 → 拒绝发布并提示"将 [识别出的静态内容块] 下沉至 resource"。

## 4. 质量门禁（两道，发布必过）

**门禁一 · 结构 lint**（机械检查，零判断力）：summary 模板匹配（含"当…时使用"与"不适用"句式）、禁用词、字数、body 七段骨架齐全、示例含正反例、工具/字段名注册表反查、resources 引用（`{{resource:name}}`）可解析。

**门禁二 · 评测门禁**（联动 OC2，每技能发布必附 ≥3 条 EvalCase）：

| 用例类型 | 断言 |
|---|---|
| 应触发 | 触发场景问句 → toolSequence 含 `load_skill(本技能)` 且回答符合"输出要求"段（answerMust） |
| 不应触发 | "不适用"场景问句 → toolSequence **不含**本技能加载（误触发=污染所有无关任务的行为） |
| 行为增益 | 同一问句在"挂载/不挂载本技能"两态下跑：挂载态必须在指定断言上**更优**（如正确引用了口径表）——证明技能有真实增益而非摆设 |

发布流程：lint 过 → 评测套件过 → PUBLISHED；任一不过给出定位与修改建议。修改已发布技能 = 新版本重过两道门禁（引用 latest 的 agent 自动获得，回归保护由评测承担）。

## 5. 出厂范例（电池场景包内置，编写代理的模仿基准）

**正例骨架**（`production-capacity-interpretation` 产能口径解读）：
- summary：`解读产能数字的口径与可比性。当回答中需要对比 P50/P90、解释认证系数或爬坡折减、用户追问"为什么两个产能数对不上"时使用。不适用：产能数值计算本身（应调用 capacity_forecast 求解器，本技能只管解读已算出的数字）。`
- body 七段齐全：前置检查=确认数字的 snapshotVersion 与求解参数；步骤含"口径差异三连查：健康度系数→认证系数→爬坡窗口"；反例="直接平均 P50 和 P90 给用户一个'综合值'（错：分位数不可平均）"；输出要求=每个口径解释必须挂溯源角标。

**反例对照**（文档内并排展示，标注每处违规对应的 lint 规则）：`本技能介绍产能相关的各种知识，帮助你更好地回答产能问题…`——三个禁用词、无触发场景、无排除边界、body 叙事体。

## 6. 验收用例

| # | 用例 | 预期 |
|---|---|---|
| SA1 | 反例技能提交 | lint 逐条定位拒绝（禁用词/缺不适用句/骨架缺段） |
| SA2 | 应触发/不应触发 | 范例技能在两类问句上评测全过；删除"不适用"句后误触发用例转红 |
| SA3 | 行为增益 | 挂载态回答含口径溯源、未挂载态不含（断言差异存在）；无增益技能（body 为空话）发布被评测门禁拒 |
| SA4 | 注册表一致性 | body 中写错工具名 → lint 反查拒绝并提示正确名 |
| SA5 | 版本回归 | 改坏已发布技能的步骤段 → 新版本评测红 → 发布阻断，线上 latest 不受影响 |
