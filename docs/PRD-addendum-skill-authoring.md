# PRD 增量 · Skill 编写规范与质量门禁（让技能"优秀"成为可校验属性）

| 项 | 值 |
|---|---|
| 版本 | v1.0（修订 平台 §8.4 / 管理平台 §4 的 skill 发布校验；联动评测体系 OC2；基线裁决 #25） |
| 解决问题 | 现有 PRD 只规定技能容器，未规定内容质量标准——本文将"优秀技能"定义为**可 lint、可评测的客观属性**，使低能力开发/编写代理无需判断力也能产出达标技能 |
| 对齐 | Anthropic Skill 实践共识：summary=触发器而非简介、渐进披露、祈使句操作规程、显式不适用边界 |

> ## ⚠️ 2026-08-09 逐条复验订正总表（`WO-DOCFIX-SKILL-CLAIMS`）
>
> 依据 `docs/CHECK-SPEC-AUT.md` §4「⛔ 里『宣称做了但其实没做』逐条清单」，本文有 **8 条断言**
> 被实测推翻或已过期（**F1–F7 · F14**），另有 **1 条真冲突待裁决**（X1 · summary 长度）。
> **订正一律就地标注、不删原文** —— 删掉就看不出「这里曾经骗过人」，下一个人还会照原文排期。
>
> | 编号 | 位置 | 形态 | 一句话 |
> |---|---|---|---|
> | F1 | §0 触及门禁 | 门名不存在 | `skill-lint:check` 全仓 0 命中，真实形态是**运行态发布端点门** |
> | F2 | §0 触及门禁 | 门名不存在 + 措辞误导 | `skill-eval:check` 全仓 0 命中；「真实 agent」实为自动创建的探针 agent |
> | F3 | §0 触及门禁 | **CHECK 自身有错，此处按实测重写** | `ontology-writeback:check` **确实存在且每次交付都真跑**（`scripts/gate.sh:86`），但它守的**不是**本文的门名 |
> | F4 | §0 触及对象类型 | 「字段在」≠「做过了」 | `maxBudgetRounds` 零消费方零数据；`resources` 7/7 空 |
> | F5 | §0 R13 | 门在·门后没人走过 | 出厂 0 条 `skill_quality` 用例 ⇒ 7 个出厂 Skill 一个都跑不到这道门 |
> | F6 | §5 出厂范例 | 被测对象不存在 | `production-capacity-interpretation` 全仓 0 命中 ⇒ SA2/SA3 两条验收在生产上不可执行 |
> | F7 | §5 反例对照 | 承诺的形态不存在 | 无并排展示、无 lint 规则标注 |
> | F14 | §0 R16 | 「门装上了」≠「库里的东西过了门」 | 出厂 Skill 走 `repos.skills.insert` 旁门直插，一次也没经过发布端点 |
> | X1 | §1 summary ≤200 | **真冲突 · 待裁决（本单不裁）** | PRD 200 / 契约 400 / 前端 400，三处口径不一 |
>
> **复验基线**：canonical `claude/inspiring-gates-aqczjg`（本单 HEAD `69804185`）。
> 每条订正的 `file:line` 与复跑命令写在各自就地标注里，**别信本表，亲手跑**。

## 0. 本体引用与影响（补录）

> 遗留 PRD 追溯补录（治理 #2，prd:check 入图）；仅引用平台真实不变量(§5 R1–R14)/断点(§8 G-1..G-8)。

- **触及对象类型**（`docs/SYSTEM-ONTOLOGY.md` §2.H）：
  - `Skill`（`SkillDefinitionSchema`，`packages/contracts/src/agentcore.ts`）：工业级字段 capability/sideEffect/inputSchema/outputSchema/references/dependsOn/approvalGate/provenancePolicy/maxBudgetRounds/resources；生命周期 DRAFT→PUBLISHED→RETIRED。
    > ⚠️ **2026-08-09 复验：失实**（`CHECK-SPEC-AUT.md` §4 **F4**）。上面这行把「字段在契约里」写成了「这件事做过了」，
    > 而这 10 个字段里**有两个是空壳**，**不许再据此认为 Skill 的预算/附件能力已交付**：
    > - **`maxBudgetRounds` = 零消费方 + 零数据**：全仓（`apps/*/src` `packages/*/src`）命中**仅 1 处**，
    >   就是契约声明自己（`packages/contracts/src/agentcore.ts:260`）；**没有任何一处读它**，连测试也不读。
    >   按 CLAUDE.md 铁律 0.5 的三分法，这比「接了线没数据」更弱 —— 是**纯声明**。
    >   再追一层：`new BudgetTracker(...)` 的入参全部走 `residualBudgetFromConfig()`（只读 env），
    >   **Skill 的声明根本不在优先级链上**。
    > - **`resources` = 接了线没数据**：消费方真在（`read_skill_resource` 工具 `apps/agentcore/src/tools/registry.ts`、
    >   `skill-lint.ts` 的 `{{resource:name}}` 可解析校验），但 7 个出厂 Skill **全部 `resources: []`**
    >   （`apps/agentcore/src/mocks/seed.ts:1046 / 1093 / 1137 / 1181 / 1224 / 1268 / 1315`）。
    >   两者**修法完全不同**（前者要接消费方或删字段，后者只要补数据），不许合成一句「字段没用起来」。
    > - 复验命令（金丝雀：同命令跑 `outputSchema` 应 ≥10 命中；若金丝雀也是 0，那是 grep 坏了不是代码干净）：
    >   `grep -rn "maxBudgetRounds" apps/*/src packages/*/src` → **1**；
    >   `grep -rn "outputSchema" apps/*/src packages/*/src | wc -l` → **11**；
    >   `grep -n "resources: \[\]" apps/agentcore/src/mocks/seed.ts` → **7 行**。
    > - 交叉印证：`docs/SPEC-industrial-skill.md` §4 的 **D4/D5** 亲自警告过这种危险，本文却又犯了一次。
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
    > ⚠️ **2026-08-09 复验：后半句「无行为增益的技能被评测门禁拒」已生效但从未触发**（`CHECK-SPEC-AUT.md` §4 **F5**）。
    > **门是真的**：`apps/agentcore/src/server.ts:1284` 取 `skill_quality` 用例 → `:1286` 少于 3 条即
    > `422 SKILL_EVAL_INSUFFICIENT` → `:1293-1298` 三类覆盖（应触发/不应触发/行为增益）任一缺失即
    > `422 SKILL_EVAL_COVERAGE` → `:1303` 通过率 <1 即 `422 SKILL_EVAL_FAILED`。
    > **但门后没有人走过**：`seedRegistry()` 的返回键只有 `{ agents, workflows, skills }`
    > （`apps/agentcore/src/mocks/seed.ts:1591`）—— **出厂 `skill_quality` 用例 0 条**，
    > 于是 7 个出厂 Skill 一个都到不了「行为增益」这一层（会先被「≥3 用例」拦住），
    > 而它们又根本不走发布路（见 R16 的 **F14** 标注）⇒ **这道门今天对出厂数据的实际拦截次数 = 0**。
    > **「已生效」与「已排练」必须分开说**：机制成立 ✅ · 生产触发 ❌。
    > 复验：`grep -n "return { agents, workflows, skills }" apps/agentcore/src/mocks/seed.ts`（金丝雀：
    > 同文件 `grep -c "skill_quality"` = 0，而 `apps/agentcore/src` 全目录 = 7 ⇒ 是种子真没有，不是 grep 坏了）。
  - R14（零业务常数：Skill 资源投影不从代码内联业务对象名）。
  - R16（发育闭环：Skill 发布经 lint+eval 两门，跨资源 dependsOn/references 必须指向 PUBLISHED，无环）。
    > ⚠️ **2026-08-09 复验：门是真的，但「库里的东西都过了门」是假的**（`CHECK-SPEC-AUT.md` §4 **F14**）。
    > **出厂数据走的是旁门**：`apps/agentcore/src/main.ts:29`
    > `for (const sk of skills) if (!(await repos.skills.get(sk.id))) await repos.skills.insert(sk);`
    > —— 种子 Skill **直插仓储**，其中 5 条以 `status:"PUBLISHED"` 落库
    > （`apps/agentcore/src/mocks/seed.ts:1046/1137/1181/1268/1315`，另 2 条 DRAFT 在 `:1093/1224`），
    > **一次也没有经过 `POST /b/v1/skills/:id/publish`**。
    > 后果：① 任何「拿出厂 Skill 当达标样例」的推理都不成立；② 若种子里有死路引用，
    > 引用可校验门（`server.ts:1272`）**够不着它们**，今天没有任何信号
    > （同一事实 `docs/PRD-skill-compiler-registry.md` §14.4-1 的 **X-12** 标注亦有记载）。
    > **「门装上了」≠「库里的东西都过了门」** —— 这两句话的差别就是本条订正的全部内容。
    > 复验：`grep -n "skills.insert" apps/agentcore/src/main.ts` → `:29`；
    > `grep -n "status: \"PUBLISHED\"" apps/agentcore/src/mocks/seed.ts`（金丝雀：同文件 `resources: []` 应 7 行）。
- **触及门禁**（`docs/SYSTEM-ONTOLOGY.md` §7）：
  - ~~`skill-lint:check`（结构 lint：summary/body/契约字段/依赖解析/无环）。~~
    > ⚠️ **2026-08-09 复验：失实 · 这个门名不存在**（`CHECK-SPEC-AUT.md` §4 **F1**）。
    > **新事实**：`skill-lint:check` 在 `package.json` / `scripts/` / `apps/*/src` / `packages/*/src` 中
    > **0 命中**。**金丝雀**：同一条命令跑已知存在的 `ref-closure:check` → **命中**
    > （`package.json:35 "ref-closure:check": "node scripts/check-ref-closure.mjs"` 等多处）
    > ⇒ 工具有效，0 是真 0，不是「我没找到」。
    > **真实承载形态**：它不是 CI 静态门，而是**运行态发布端点门** ——
    > `POST /b/v1/skills/:id/publish` 内联调用 `lintSkill(...)`（`apps/agentcore/src/server.ts:1251`），
    > 不过则 `422 SKILL_LINT_FAILED`（`:1253`）。**`force=true` 可豁免**（质量门语义）。
    > **危害**：下一个人跑 `pnpm skill-lint:check` 只会得到「命令不存在」；更糟的是误以为 CI 已守住
    > 而不去看发布路 —— 而发布路上这道门是**可 force 豁免**的，两者的强度完全不同。
    > `docs/SYSTEM-ONTOLOGY.md:946` 早已诚实更正过这一点，**本 PRD 直到今天才同步**。
    > 复验：`for n in skill-lint:check ref-closure:check; do echo -n "$n => "; grep -rn "$n" package.json scripts/ apps/*/src packages/*/src | wc -l; done`
  - ~~`skill-eval:check`（评测门禁：≥3 skill_quality 用例 + SkillProbeRunner 挂载真实 agent 全过）。~~
    > ⚠️ **2026-08-09 复验：失实 · 门名不存在 + 「真实 agent」措辞误导**（`CHECK-SPEC-AUT.md` §4 **F2**）。
    > **新事实 ①**：`skill-eval:check` 同样 **0 命中**（金丝雀同 F1）。真实形态是发布端点门的第二段：
    > `apps/agentcore/src/server.ts:1284`（取用例）→ `:1286` `422 SKILL_EVAL_INSUFFICIENT`
    > → `:1293-1298` `422 SKILL_EVAL_COVERAGE` → `:1303` `422 SKILL_EVAL_FAILED`，**`force=true` 可豁免**。
    > **新事实 ②**：「SkillProbeRunner **挂载真实 agent**」这个措辞会让人以为覆盖了生产 agent 的挂载组合。
    > 实际是**自动创建的一次性探针 agent**：`apps/agentcore/src/skill-probe.ts:119` `ensureProbeAgent(auth, skill)`
    > + `:120` `ensureTwinAgent(auth, skill)`（定义在 `:166` / `:208`）—— 挂的是探针，不是任何业务 agent。
    > **危害**：评测绿只能证明「这个技能在一个干净探针上能被加载并达标」，**证明不了**
    > 「它挂在真实业务 agent 上、和其他技能共存时不误触发」。后者今天**无人覆盖**。
  - `ontology-writeback:check`（新增门须回写 §7，本次补录同步满足）。
    > ⚠️ **2026-08-09 复验：本条的订正与 F1/F2 不同 —— 门是真的、也真在跑，失实的是「本次补录同步满足」**
    > （`CHECK-SPEC-AUT.md` §4 **F3**。**注意：CHECK 原文说它「不在 `package.json` 的 gates 串里 ⇒ 没有机器在守」，
    > 这半句本身不准确，本单实测后按事实重写 —— 见本单交付文档「CHECK 自身的错」一节**）。
    > **新事实 ①（推翻 CHECK 的措辞）**：`scripts/check-ontology-writeback.mjs` **存在**，且**每次交付门都真跑** ——
    > `scripts/gate.sh:86` `run "ontology-writeback:check" node scripts/check-ontology-writeback.mjs`。
    > 它不在 `pnpm gates` 串里是**刻意的**，理由写在 `scripts/gate.sh:44-49`（进 gates 链的门必须同批回写本体 §7，
    > 而 §7 回写归审核方）。所以「没有机器在守」是错的：机器在守，**但守的不是这件事**。
    > **新事实 ②（真正的缺口）**：这道门断言的是「**每个并入 `pnpm gates` 的门都已在本体 §7 登记**」
    > （`scripts/check-ontology-writeback.mjs:42/46`）。它**不会**校验「本 PRD §0 列的门名是否真实存在」——
    > 于是 F1/F2 那两个**根本不存在的门名**在本文里躺了很久，**没有任何机器会红**。
    > ⇒ 「本次补录同步满足」这句话**为真但没有意义**：它满足的是另一道门的另一条断言。
    > **判据（照 CLAUDE.md 铁律 0.6 的句式）**：「我用『某门在跑』当作『本文的门名是真的』的证据，而前者并不度量后者。」
    > 复验：`grep -n "ontology-writeback" scripts/gate.sh package.json`（前者命中 `:86`，后者 **0** ⇒ 两句都要说）。
- **触及断点**（§8）：（无新增特定断点；诚实边界：mock LLM 下评测分数仅证管线与断言框架正确，接 REAL 模型后才是真质量分。）
- **范畴**：Skill 编写规范与质量门禁：技能优秀=可校验属性（lint + 评测用例）

## 1. 三级职责铁律（写错层级 = 发布拒绝）

| 级 | 职责 | 一句话判据 |
|---|---|---|
| summary（≤200 字，常驻 agent 系统提示词） | **触发器**：让模型在恰当时机想起加载它，其余什么都不是 | 删掉任何一句都会导致漏触发或误触发——否则那句不该在 summary 里 |
| body（≤3000 字，load_skill 按需加载） | **操作规程**：照着能把事做对的步骤 | 全文可执行——出现"介绍""背景""众所周知"即违规 |
| resources（read_skill_resource 按需读取） | **参考资料**：表格/清单/长文档 | body 中超过 10 行的静态数据必须下沉至此 |

> ### ⚖️ 2026-08-09 复验：`summary` 长度是**三处口径不一致的真冲突** —— **待裁决，本单不裁**
>
> 依据 `docs/CHECK-SPEC-AUT.md` §4 附录 **X1**。**口径裁决是仓主的活，本单只把事实摆清楚，不擅自收敛。**
>
> | 处 | 上限 | 位置 | 生效时机 |
> |---|---:|---|---|
> | 本 PRD §1 / §2 | **200 字** | 本表首行 | 发布期（`lintSkill` 的 `SUMMARY_MAX`） |
> | 契约 | **400** | `packages/contracts/src/agentcore.ts:242` | 写入期（zod 校验，超即 400） |
> | 前端编辑器 | **400** | `apps/frontend-shell/src/pages/admin/SkillsPage.tsx:77-78`（标签文案与 `maxLength` 均 400） | 编辑期 |
>
> **用户实际会撞上的形态**：编辑器允许写到 400 字、**保存成功**，一点发布**被 lint 拒**（`SUMMARY_MAX=200`）。
> 三处里有两处（契约/前端）对齐、一处（PRD/lint）不对齐，而**没有任何一份文档说明这是有意的两层治理**。
>
> ⛔ **不要把它类比成 `body` 的 3000 vs 50000** —— 那**不是冲突**：
> `docs/SPEC-industrial-skill.md` §9.3（定案 5）**明写**是两层语义（**契约管「存得下」· lint 管「该不该这么写」**），
> 两者都不许改。`summary` 这里**没有对应定案**，所以它是真冲突。**混为一谈会导致把 body 也一起改坏。**
>
> **三条可选处置（供裁决，本单不选）**：① lint 放宽到 400（与契约/前端对齐）；
> ② 前端收紧到 200（编辑期即拦，用户不再白写）；③ 照 §9.3 的样子把它**定案成两层语义**并写进 SPEC。

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

> ## ⚠️ 2026-08-09 复验：**本节整节的被测对象不存在**（`CHECK-SPEC-AUT.md` §4 **F6 + F7**）
>
> 本节以**既成事实的语气**（「电池场景包内置」「编写代理的模仿基准」）描述了一个正例和一个反例对照，
> 而实测下来**两者都没有承载物**。原文全部保留在下方，**不删** —— 它记录了目标形态，只是**今天还不是事实**。
>
> **F6 · 正例不存在**：`production-capacity-interpretation` 在 `apps/` `packages/` `scripts/` 全仓 **0 命中**。
> **金丝雀**：同一命令跑真实存在的 `capacity_analysis` → `apps/*/src packages/*/src` **2 命中**
> ⇒ 工具有效，0 是真 0。语义上最接近的是种子技能 `capacity_analysis`
> （`apps/agentcore/src/mocks/seed.ts:1046` 一带，`status:"PUBLISHED"`、`capability:"analysis"`），
> **但它不叫这个名字、没有配套 `EvalCase`、也没有反例对照**。
> ⇒ **§6 的 SA2 / SA3 两条验收今天在生产上不可执行**（被测对象不存在，不是"跑了没过"）。
>
> **F7 · 反例对照的形态不存在**：原文承诺「**文档内并排展示**，标注每处违规对应的 lint 规则」，
> 而文档里只有一句反例串，**既没有并排展示、也没有标注任何一条 lint 规则名**；
> 代码/fixture 里同样 0 命中。⇒ 「编写代理的模仿基准」这件事**实际不存在**。
>
> **危害**：低能力编写代理照本节去"模仿基准"，会找不到任何可模仿的对象；
> 而验收方照 SA2/SA3 去验，会**验空气**并得到"通过"（因为没有被测对象就没有失败）。
>
> **补齐这一节需要三件事，缺一不可**（**不在本单范围**，本单只订正断言）：
> ① 建出 `production-capacity-interpretation` 这个 Skill（或把本节改名到 `capacity_analysis`）；
> ② 给它配 ≥3 条 `skill_quality` `EvalCase`（三类各 ≥1，否则发布端点 `server.ts:1293-1298` 直接 422）；
> ③ 把反例真的**并排排版**并逐处标出违反的 lint 规则名（规则名取自 `apps/agentcore/src/skill-lint.ts`，
> 如 `summary.maxLength` / `summary.bannedWords` / `body.sections`）。
>
> 复验：`grep -rn "production-capacity-interpretation" apps/ packages/ scripts/ | wc -l` → **0**；
> `grep -rn "capacity_analysis" apps/*/src packages/*/src | wc -l` → **2**（金丝雀命中）。

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

> ⚠️ **2026-08-09 复验：SA2 / SA3 今天不可执行**（`CHECK-SPEC-AUT.md` §4 **F6**，详见 §5 的就地标注）。
> 两条都以「范例技能」为被测对象，而该范例（`production-capacity-interpretation`）**全仓 0 命中**。
> **不可执行 ≠ 不通过**：一条找不到被测对象的验收，跑起来既不红也不绿，**最容易被记成"通过"**。
> 在 §5 的三件事补齐之前，SA2/SA3 一律记 **⛔ 阻塞（被测对象缺失）**，不得计入验收通过数。
| SA4 | 注册表一致性 | body 中写错工具名 → lint 反查拒绝并提示正确名 |
| SA5 | 版本回归 | 改坏已发布技能的步骤段 → 新版本评测红 → 发布阻断，线上 latest 不受影响 |
