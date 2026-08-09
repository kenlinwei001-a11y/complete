# CHECK · `SPEC-industrial-skill.md` + `PRD-addendum-skill-authoring.md` 逐条复验

| 项 | 值 |
|---|---|
| 复验对象 | `docs/SPEC-industrial-skill.md`（514 行·12 层 + §2–§9）· `docs/PRD-addendum-skill-authoring.md`（108 行·§0–§6） |
| 基线 | `claude/inspiring-gates-aqczjg` @ `b50f42af0e2e8e3234944c1bc49863fa5e06eece`（`git status --porcelain` 空） |
| 复验日期 | 2026-08-09 |
| 前置 | `pnpm install --prefer-offline`(RC=0) → `@platform/contracts` build(RC=0) → `@platform/llm-adapters` build(RC=0) → `pnpm --filter agentcore build`(RC=0) |
| 条目数 | **本次独立提取 274 条**（SPEC 196 + 增量 PRD 78·脚本核过：编号无重复、无未定档行）。派单口径是 183+63=246；差额来自**粒度**：本表把「一张表的每一行 / 一个 YAML 键 / 一条 SDK 模块 / 一条不变量」各计一条，是**超集**，不是抽样。逐条对照见下两表，**无一条跳过**。 |
| 本单边界 | **只复验取证，不改代码**。发现的缺口只列不修。 |

---

## 0 · 复验方法（先自证工具，再报结论）

照 CLAUDE.md 铁律 0.5 / 0.6：**任何否定结论（「没实现 / 零调用方 / 不存在」）前先跑金丝雀**，
金丝雀不中就报「工具坏了」而不是「代码干净」。本次用到的三条命令与其金丝雀：

| 命令形态 | 金丝雀（已知必中） | 实测命中 | 判定 |
|---|---|---|---|
| `grep -rn <sym> apps/*/src packages/*/src` | `SkillDefinitionSchema` | **7** | 工具有效 |
| `grep -rn <sym> <单文件>` | `planRef` in `packages/contracts/src/qos.ts` | **2 行** | 工具有效 |
| `grep -rn <str> scripts/platform-cli.mjs` | `solver` | **8** | 工具有效 |
| `grep -rn <route> apps/*/src` | `"/api/v1/queries` | **10** | 工具有效 |
| 运行时实测（非 grep） | `node -e require('apps/agentcore/dist/mocks/seed.js').seedRegistry()` | 7 skills 逐字段打印 | 工具有效 |

**「只有 test 引用 = 已排练不是已实现」**这一档全部靠「调用方集合里有没有 `src/` 路径」判定，
且**每条都追到了触发条件**（下表末列「追的那一层」）。

### 运行时实测基线（跑 `seedRegistry()`，不是 grep）

```
capacity_analysis     v1 PUBLISHED body= 484 summary=71 res=0 refs=2 deps=0 mbr=- cap=analysis     se=READ  gate=none  prov=best_effort in=y out=y exec=n bi=n
sop_meeting           v1 DRAFT     body= 403 summary=69 res=0 refs=1 deps=0 mbr=- cap=planning     se=READ  gate=none  prov=best_effort in=y out=y exec=n bi=n
risk_analysis         v1 PUBLISHED body= 387 summary=61 res=0 refs=1 deps=0 mbr=- cap=analysis     se=READ  gate=none  prov=best_effort in=y out=y exec=n bi=n
supply_chain_mgmt     v1 PUBLISHED body= 415 summary=66 res=0 refs=1 deps=0 mbr=- cap=analysis     se=READ  gate=none  prov=best_effort in=y out=y exec=n bi=n
quality_control       v1 DRAFT     body= 387 summary=44 res=0 refs=1 deps=0 mbr=- cap=diagnosis    se=READ  gate=none  prov=best_effort in=y out=y exec=n bi=n
mcp_integration       v1 PUBLISHED body= 522 summary=47 res=0 refs=0 deps=0 mbr=- cap=analysis     se=READ  gate=none  prov=best_effort in=y out=y exec=n bi=n
capacity_action_draft v1 PUBLISHED body= 493 summary=66 res=0 refs=1 deps=0 mbr=- cap=prescription se=WRITE gate=human prov=required    in=y out=y exec=n bi=n

字段并集 = id,tenantId,key,version,name,summary,body,resources,status,capability,
          sideEffect,provenancePolicy,approvalGate,inputSchema,outputSchema,references
（无 dependsOn · 无 maxBudgetRounds · 无 execution · 无 businessIntent）
seedRegistry() 返回键 = agents, workflows, skills（**无 evalCases**）
```

### Skill 相关测试全绿（10 文件 / 92 用例 / RC=0）

```
✓ skill-eval-gate ✓ skill-ref-closure.seam ✓ skill-orchestrator.seam ✓ skill-free-qa-seam
✓ skill-lint ✓ skill-solver-precondition.seam ✓ skill-probe ✓ skill-contract ✓ skill-runtime ✓ skill-router
Test Files 10 passed (10) · Tests 92 passed (92) · RC=0
```
> ⚠️ **绿测试 ≠ 能用**：下表中标 ⚠ 的条目全部在这 92 个绿用例覆盖范围内。

### 四档 + ⛔ 的判定口径

| 档 | 判据 |
|---|---|
| ✅ | 承载物在该在的对象上 + 有 `src/` 生产调用方 + 已追到触发条件 |
| 🔗 | 代码在、被调用，但挂错位置 / 只覆盖部分路径 / 做的不是它宣称的那件事 |
| ⚠ | 实现有、测试有、且绿，**零 `src/` 生产调用方** |
| ❌ | 契约/代码里根本没有（**已跑金丝雀**） |
| ⛔ | 文档自标非目标。三分：**绝对不做** / **本期不做·须诚实标注** / **不改不新造·做了反是缺陷** |

---

## 1 · `SPEC-industrial-skill.md` 逐条（194 条）

### §1 · 12 层结构（仓主给定原文 · 44 条）

#### ① Skill Identity（8 条）

| 编号 | 需求 | 档 | 证据 | 追的那一层调用 |
|---|---|---|---|---|
| SK-SPEC-L1-1 | `skill_id` 字段 | ✅ | `packages/contracts/src/agentcore.ts:237` `id: z.string()` | `server.ts:1217` `newId("skl")` 落库；`repos.skills.get(id)`（`server.ts:1201/1243`）按 id 取 |
| SK-SPEC-L1-2 | `name` 字段 | ✅ | `agentcore.ts:241` | `prompts.ts:72` 注入 system prompt `- [${s.id}] ${s.name}: ${s.summary}` |
| SK-SPEC-L1-3 | `domain`（域）字段 | ❌ | `SkillDefinitionSchema` 18 字段无 `domain`；`agentcore.ts:352` 的 `domain` 属 **`ScenarioSchema`**（另一个对象） | 金丝雀：同文件 `references` 命中 2 行 ⇒ grep 有效 |
| SK-SPEC-L1-4 | `category`（分类）字段 | 🔗 | 无 `category`；最接近的是 `capability`（`agentcore.ts:252`，枚举 analysis/diagnosis/prescription/optimization/planning/approval，`agentcore.ts:143-155`） | `dril/resource-projector.ts:147` `capability: s.capability ?? …` → `resource-registry.ts:188` → `retrieve_knowledge` 检索排序。**能分类但不是 SPEC 的 category 语义（域内分类），且不参与权限/生命周期** |
| SK-SPEC-L1-5 | `version` 字段 | ✅ | `agentcore.ts:240` | `server.ts:1219` `Math.max(...)+1` 自增；`engine.ts:270-283 resolveSkill` 按 `latest`/pin 解析 |
| SK-SPEC-L1-6 | `owner`（负责人）字段 | ❌ | Skill 无 `owner`。`IntentDefinition` 有（`qos.ts:60`），Skill 没有 | 金丝雀同上 |
| SK-SPEC-L1-7 | `risk_level` 字段 | ❌ | Skill 无 `riskLevel`。`agentcore.ts:358` 的 `riskLevel` 属 `ScenarioSchema`；`qos.ts:59` 属 `IntentDefinition` | 全仓 `riskLevel` 50 处命中，**逐处核对无一处挂在 Skill 上** |
| SK-SPEC-L1-8 | Identity 的四项作用：注册 · 生命周期 · 权限控制 · 版本升级 | 🔗 | 注册 ✅(`repos.skills`)、生命周期 ✅(DRAFT/PUBLISHED/RETIRED `agentcore.ts:247`)、版本升级 ✅(`server.ts:1219`)；**权限控制 ❌** —— 无 per-Skill 权限字段，只有端点级 `requireCatalogAdmin`(`server.ts:1212/1228/1241`) | `requireCatalogAdmin` → `resources.ts` 导出 → 三处 skill 端点。**这是"谁能改 Skill"，不是"这个 Skill 能干什么"** |

#### ② Business Intent（4 条）

| 编号 | 需求 | 档 | 证据 | 追的那一层调用 |
|---|---|---|---|---|
| SK-SPEC-L2-1 | 声明**用户角色** | ❌ | `businessIntent` 全仓 **0 处**（`grep -rn businessIntent apps/*/src packages/*/src` = 0，金丝雀 `SkillDefinitionSchema`=7 ⇒ 工具有效） | — |
| SK-SPEC-L2-2 | 声明**决策场景** | ❌ | 同上。`ScenarioSchema` 有 `triggerQuestion`/`summary`，但那是 Scenario 不是 Skill | — |
| SK-SPEC-L2-3 | 声明**触发条件** | 🔗 | Skill 侧唯一触发信息 = `summary` 里的「当…时使用」自然语言句（lint 强制，`skill-lint.ts:289`） | `prompts.ts:71 selectSkills` 语义路由 top-k → system prompt。**是自由文本不是结构化 KPI/角色/场景，机器读不了** |
| SK-SPEC-L2-4 | 声明 **KPI**（OTD / 产能利用率等） | ❌ | Skill 契约无任何 metric/KPI 字段 | — |

#### ③ Ontology Binding（3 条）

| 编号 | 需求 | 档 | 证据 | 追的那一层调用 |
|---|---|---|---|---|
| SK-SPEC-L3-1 | Skill 声明 `objects[]` | ✅ | `SkillReferenceSchema.kind` 含 `"ontologyType"`（`agentcore.ts:216`） | `server.ts:1269` 抽 `refObjectTypes` → `:1272 probeMissingRefs` → `resources.ts:64` → DataCore 本体注册表；不存在则 `422 SKILL_REF_UNRESOLVED`（`server.ts:1279`）**且未落库**。触发条件：发布时该 Skill 有 required 的 ontologyType 引用 |
| SK-SPEC-L3-2 | Skill 声明 `relations[]`（`Factory -HAS_LINE-> ProductionLine`） | ❌ | `SKILL_REFERENCE_KINDS` 8 值（`agentcore.ts:216`）**无 `relation`**。7 个种子 Skill 零关系声明 | 金丝雀：同数组的 `ontologyType` 在 `resource-projector.ts:328`、`server.ts:1269` 各有消费方 ⇒ 词表是活的，`relation` 是真没有 |
| SK-SPEC-L3-3 | 「Skill 不操作数据库，操作业务对象」 | ✅ | Skill body/工具面只暴露 `query_objects`/`resolve_slice`/`invoke_solver` 等对象级工具（`tools/registry.ts`），无 SQL 面 | `engine.ts:412` system prompt + `BUILTIN_TOOLS` 注入；`GuardedToolExecutor`(`engine.ts:237`) 是唯一出口 |

#### ④ Input Contract（3 条）

| 编号 | 需求 | 档 | 证据 | 追的那一层调用 |
|---|---|---|---|---|
| SK-SPEC-L4-1 | 参数定义（`factory_id`/`time_range`…） | ✅ | `inputSchema`（`agentcore.ts:254`），7/7 种子已填 | `resource-projector.ts:148 ioSpecFromJsonSchema` → `SkillResource.inputSpec` → `resource-registry.ts:188` → `retrieve_knowledge` 下发给模型；`AgentDefinition.skills[].arguments`（`agentcore.ts:43`）可预填默认值 |
| SK-SPEC-L4-2 | **数据来源声明**（ERP/MES/WMS/PLM/CRM） | ❌ | Skill 契约无 `dataSource`/`connector` 字段；`SKILL_REFERENCE_KINDS` 无 `connector` | 金丝雀同 L3-2 |
| SK-SPEC-L4-3 | 自然语言→自动补全入参（「预测宁德基地产能」→`{factory,period,product_family}`） | 🔗 | 槽位抽取在**意图**侧（`SlotDefSchema`/`router/slots.ts`），不在 Skill 侧 | `orchestrator.ts` classify → `extractedSlots` → `execute-plan.ts`。**Skill 的 `inputSchema` 不参与这条链**，两份入参声明并存（正是 §2-④ 说的「两处未统一」） |

#### ⑤ Context Manager（3 条）

| 编号 | 需求 | 档 | 证据 | 追的那一层调用 |
|---|---|---|---|---|
| SK-SPEC-L5-1 | 5.1 Context Retrieval | 🔗 | `conversationSummary`(2 处) + DRIL 组包(`dril/search-engine.ts`) + `search_experience`(17 处) 都在 | `orchestrator.ts` → `classifierConversationSummary`(`prompts.ts:92`)。**均非 Skill 字段** —— 无法按题型配置，Skill 说不出「我要哪些上下文」 |
| SK-SPEC-L5-2 | 5.2 Context Compression | 🔗 | `estimateTokensChars`(6 处) + 工具结果截断 + `maxToolCalls`(29 处) 在 | 同上：全局常数，非 Skill 字段。SPEC §2-⑤ 说的「默认阈值下不可达」未复验（需真跑长上下文），此处只判「不是 Skill 的字段」这一半 |
| SK-SPEC-L5-3 | 5.3 Context Memory（决策历史/人工修正/最终结果回写） | ❌ | 读侧在：`search_experience`(17 处)；**写侧只有 boot 时的种子** | **追一层后自纠**：`distillExperienceCases`(`mocks/seed.ts:1741`) 唯一 src 调用方是 `main.ts:44`（**启动时**把常量 `LIVED_IN_SCENE_HISTORY` 灌进 `repos.experience`），**不是从真实 task 蒸馏**。⇒ SPEC §2-⑤「5.3 只读不写」**完全成立** |

#### ⑥ Reasoning Logic（2 条）

| 编号 | 需求 | 档 | 证据 | 追的那一层调用 |
|---|---|---|---|---|
| SK-SPEC-L6-1 | Reasoning **Graph**（非「请分析」） | 🔗 | 图契约与编译器**真的有**：`packages/contracts/src/skill-graph.ts`（`SkillGraphSchema:126` / `compileGraph:175` / `compileExecution:478`），调度器 `apps/agentcore/src/skill-orchestrator.ts:95 GraphScheduler`，端点 `server.ts:1360 POST /b/v1/skill-graphs/run` | 追到底：`server.ts:1368 new GraphScheduler(...)` 是**唯一生产入口**，且只接受**请求体里显式传的图**。`SkillDefinitionSchema` **没有 `execution` 字段**（18 字段实测），故**没有任何 Skill 能声明自己的图** ⇒ 「接了线没数据」。该文件自己也钉死了这句：`skill-graph.ts:347-353` |
| SK-SPEC-L6-2 | 表达条件分支 / 汇流（「瓶颈识别结果决定要不要走扩产建议」） | ❌ | `SKILL_GRAPH_EDGE_KINDS` 有 `cond`（`skill-graph.ts:105`），但 `IMPLEMENTED_EDGE_KINDS = ["seq","parallel"]`（`:109`），`compileGraph` 对 `cond` 显式返 `NOT_IMPLEMENTED`（`:206-212`） | 诚实拒绝而非静默跳过 ⇒ 是**登记在案的未实现**，不是假绿 |

#### ⑦ Tool / MCP Binding（2 条）

| 编号 | 需求 | 档 | 证据 | 追的那一层调用 |
|---|---|---|---|---|
| SK-SPEC-L7-1 | Skill → MCP Registry → {ERP, MES, Solver} | 🔗 | MCP 面在（`mcp/`、`agent/mcp-router.ts selectMcpTools`），求解器面在（`/b/v1/solvers/:key/run` `server.ts:1930`） | `engine.ts:6` import `selectMcpTools`；但**入口是 `agent.mcpServers`（`agentcore.ts:46`）不是 Skill**。Skill 侧无 MCP 绑定字段 |
| SK-SPEC-L7-2 | Skill 声明 `tools[]` | ❌ | `SKILL_REFERENCE_KINDS`（`agentcore.ts:216`）**无 `tool`、无 `mcp`** | 金丝雀：同数组的 `solver`/`rule` 在 `server.ts:1267-1268`、`engine.ts:61-65` 有真消费方 ⇒ 词表活着，`tool`/`mcp` 是真缺。裁剪首轮工具集靠 `scopeToolNames`（`engine.ts:234`）来自 **agent**，不是 Skill |

#### ⑧ Rule & Constraint Engine（2 条）

| 编号 | 需求 | 档 | 证据 | 追的那一层调用 |
|---|---|---|---|---|
| SK-SPEC-L8-1 | 必须有 Business Rules 引擎（不只靠 LLM） | ✅ | `apps/datacore/src/ruledsl.ts` + 规则库；Skill 侧 `kind:"rule"` 引用可声明 | 追到执行点：`engine.ts:364 skillRuleRefs(skills,"precondition")` → `dataCore.rules.evaluate` → BLOCK 则 `:372-378` **不调 LLM 直接返 rule_violation**；postcheck 同理。触发条件：Skill 的 `references` 里有 `{kind:"rule", role:"precondition"|"postcheck"}` —— 种子 `capacity_analysis` 真有一条（`mocks/seed.ts:1061` C03 postcheck） |
| SK-SPEC-L8-2 | 能表达「换型时间 ≥4h」「良率<95% 禁止承诺」这类阈值规则 | ✅ | `ruledsl.ts:318-325` 支持 `params.<阈值名>` 一等操作数；`:357-361` 无 params 时**抛错**而非静默 false；`:414-420 collectParamRefs` 供发布期校验 | **SPEC §2-⑧ 标的 `G-C08-EXPR-PARAM-SPLIT`（expression 不能引用 params → 静默恒假）已被 WO-RULE-EXPR-PARAMS 修掉**。SPEC 该格已过期，见 §4 清单 |

#### ⑨ Solver Integration（2 条）

| 编号 | 需求 | 档 | 证据 | 追的那一层调用 |
|---|---|---|---|---|
| SK-SPEC-L9-1 | LLM 生成问题 → OR Solver → 方案 → LLM 解释 | ✅ | 求解器注册表 + CP-SAT sidecar `services/optimizer/server.py`；`invoke_solver` 工具 | `engine.ts:106-120 unmetSolverPreconditions` 读 `repos.toolCalls.listByTask` 判「这个求解器跑过没有」→ 未跑则 `loadSkill` 返 `unmetPreconditionBody`（`engine.ts:129`）**替代技能正文**。触发条件：Skill 有 `{kind:"solver", role:"precondition"}` —— 种子 `capacity_action_draft` 真有（`mocks/seed.ts:1337`） |
| SK-SPEC-L9-2 | Skill 声明 solver 的 `type` / `objective` / `constraints` | ❌ | Skill 只能声明 solver **key**（`kind:"solver"`）。`objective` 全仓 1 处（`server.ts:2075` 是求解器实参不是 Skill 字段）、`weights` **0 处** | 金丝雀：`references` 在同批文件命中 ⇒ 工具有效。见 §7 定案 2 未落地（SK-SPEC-7-5/6） |

#### ⑩ Workflow Execution（2 条）

| 编号 | 需求 | 档 | 证据 | 追的那一层调用 |
|---|---|---|---|---|
| SK-SPEC-L10-1 | 长流程 Trigger→数据准备→模型计算→**专家审核**→生成方案→**审批**→执行 | 🔗 | `workflow/executor.ts` + Action `approvalChain` 在；Skill 侧有 `approvalGate: none/human/workflow`（`agentcore.ts:258`） | `approvalGate` 真被消费：`isWriteModeSkill`(`agentcore.ts:201`) → `engine.ts:361 skillWriteMode` → `engine.ts:459 writeMode` → `agent/loop.ts:1135` 强制 `final_answer` 含 `action_draft`。**但 `kind:"workflow"` 引用无任何执行消费方**（`probeMissingRefs` 只覆盖 solver/rule/ontologyType，`skill-lint.ts:215-217` 自己写明） |
| SK-SPEC-L10-2 | BPM + Agent（并行/编排） | 🔗 | `workflow/executor.ts:104` 仍是 `for (const step of input.steps)` **串行**；并行只在旁挂的 `GraphScheduler` 里（`skill-orchestrator.ts`），且无 Skill 能声明图（见 L6-1） | E5「三角色 203s 成因」复验成立：主执行器无 `Promise.all` |

#### ⑪ Output Contract（2 条）

| 编号 | 需求 | 档 | 证据 | 追的那一层调用 |
|---|---|---|---|---|
| SK-SPEC-L11-1 | 结构化输出（`risk[]` / `recommendation[]`），非「分析完成」 | 🔗 | `outputSchema` 字段在、7/7 已填；**两个真消费方**：`skill-lint.ts:342 validateJsonSchemaShape`（只校验"是不是 JSON Schema 形状"）、`resource-projector.ts:149 → SkillResource.outputSpec`（投影给检索） | 追一层后**修正 SPEC §2-⑪ 的「零消费方」说法**：有消费方，但**没有任何一处拿它校验实际输出**。答案形状仍由 `Answer.blocks[]` 自由生成 ⇒ 形态④「接了线接错地方」，不是「没接线」 |
| SK-SPEC-L11-2 | 承载面 Dashboard / Report / API / Workflow Action | 🔗 | API ✅（`/b/v1/skills*`）、Workflow Action ✅（`action_draft` 经 `writeMode`）；Dashboard/Report 无 Skill 专属承载 | 前端唯一 Skill 面是 `pages/admin/SkillsPage.tsx`（93 行·CRUD+发布），无输出契约视图 |

#### ⑫ Governance & Learning（2 条）

| 编号 | 需求 | 档 | 证据 | 追的那一层调用 |
|---|---|---|---|---|
| SK-SPEC-L12-1 | Evaluation：准确率 · 响应时间 · **人工采纳率** · 收益 | 🔗 | `SkillProbeRunner`(`skill-probe.ts:85`) 真算 `passRate`/`intentAccuracy`/`toolCorrectness`/`avgLatencyMs`/`avgTokenCost`（`:150-160`）；**人工采纳率**埋点 `dc_action_submit_total`(`apps/datacore/src/metrics.ts:58`) 标签**只有 `{action_type, outcome}`**（`:100`）**无 tenant** ⇒ 跨租户混算 | 追到发布门：`server.ts:1301 deps.evals.runSkillProbe` → `evals.ts:53-60` → `skill-probe.ts:96 runSkill`；`passRate<1` 则 `422 SKILL_EVAL_FAILED`。**收益（金额）维度全无** |
| SK-SPEC-L12-2 | Human Feedback 闭环（AI 建 20% → 人改 10% → 系统学习） | ❌ | 无「人工修正值」回写通道（见 L5-3）；`/metrics` 两服务**均无鉴权**（`agentcore/src/server.ts:207` 裸 handler；`datacore/src/app.ts:848` `/metrics` 在 `PUBLIC_PATHS` 白名单里、`:927` 直接 render） | SPEC §2-⑫「这条通道确实不存在」复验成立 |

#### 工业级 Skill vs 普通 Prompt 对比表（9 条）

| 编号 | 维度 | 档 | 证据 |
|---|---|---|---|
| SK-SPEC-T-1 | 目标：完成业务任务（非回答问题） | 🔗 | `capability` 枚举含 prescription/approval（`agentcore.ts:143-155`），`approvalGate` 能拉起 action_draft；但无 Business Intent 说明"完成什么任务" |
| SK-SPEC-T-2 | 输入：业务对象（非文本） | 🔗 | `inputSchema` 是 JSON Schema，**不是对象引用类型**；`kind:"ontologyType"` 只声明"需要哪个类型"，不绑定到入参 |
| SK-SPEC-T-3 | 知识：Ontology（非 RAG） | 🔗 | `ontologyType` 引用可声明并被发布门校验（`server.ts:1272`）；但检索侧是 DRIL 混合检索（`retrieve_knowledge`），本质仍是 RAG 打分 |
| SK-SPEC-T-4 | 推理：LLM + 规则 + Solver | ✅ | 三者齐：`engine.ts:364`(规则预检) + `:106`(solver 前置) + `runAgentLoop`(LLM)。触发条件已在 L8-1/L9-1 追到 |
| SK-SPEC-T-5 | 执行：Workflow | 🔗 | 见 L10-1：`approvalGate` 通，`kind:"workflow"` 引用不通 |
| SK-SPEC-T-6 | 结果：结构化决策 | 🔗 | 见 L11-1：schema 在，不校验 |
| SK-SPEC-T-7 | 复用：高 | ⚠ | `dependsOn` 字段在（`agentcore.ts:257`）、消费方在（`skill-lint.ts:254/348`、`resource-projector.ts:334`），但**7/7 值为空**（实测）⇒「接了线没数据」。**注意与 `references` 区分**：`references` 7 条种子 6 条非空，是"接了线有数据、会触发" |
| SK-SPEC-T-8 | 治理：有 | ✅ | 发布双门禁真串在 `POST /b/v1/skills/:id/publish`（`server.ts:1250` lint → `:1272` 引用探针 → `:1285/1291/1301` 评测三关） |
| SK-SPEC-T-9 | 学习：闭环 | ❌ | 见 L12-2 |

---

### §2 · 审核方对照映射（15 条 · 复验「文档自己的判定今天还成不成立」）

| 编号 | SPEC 原判 | 今日复验 | 档 | 证据 |
|---|---|---|---|---|
| SK-SPEC-M1 | ① Identity 🟡 缺 domain/category/owner/risk_level/supersedes | **成立**（`supersedes` 全仓 0 处，金丝雀有效） | ❌ | `agentcore.ts:236-261` 18 字段 |
| SK-SPEC-M2 | ② Business Intent 🔴 四项全无 | **成立** | ❌ | `businessIntent` 0 处 |
| SK-SPEC-M3 | ③ Ontology Binding 🟡 Skill 侧零声明 | **已部分改善**：`kind:"ontologyType"` 可声明且**发布时真校验**（`server.ts:1272`）；但 7 种子中 0 条用它，且 `relations` 仍无 | 🔗 | `server.ts:1269-1281` |
| SK-SPEC-M4 | ③ 附：本体是平的（无 subClassOf / `WITH RECURSIVE` 全仓 0） | **成立**：`subClassOf` 0 处、`WITH RECURSIVE` 0 处 | ❌ | 金丝雀 `SkillDefinitionSchema`=7 |
| SK-SPEC-M5 | ④ Input Contract 🟡 两处并存无权威 + 数据来源零声明 | **成立** | 🔗 | 见 L4-3 / L4-2 |
| SK-SPEC-M6 | ⑤ Context 三项均非 Skill 字段 | **成立** | 🔗 | 见 L5-1..3 |
| SK-SPEC-M7 | ⑥ Reasoning 🔴 线性非图 | **部分过期**：图契约+编译器+调度器+HTTP 端点已落地（`skill-graph.ts` / `skill-orchestrator.ts` / `server.ts:1360`），**但 Skill 挂不上**（无 `execution` 字段） | 🔗 | `skill-graph.ts:347-353` 自述边界 |
| SK-SPEC-M8 | ⑦ Tool/MCP 🟡 Skill 不声明工具；`discover` 无 `intents` kind | **成立**：`tools/registry.ts:14` enum = `["object_types","slices","solvers","mcp_tools"]` 无 `intents` | ❌ | 缓解项：`retrieve_knowledge`(`registry.ts:26-36`) 的 kinds 描述里含 `intent` |
| SK-SPEC-M9 | ⑧ Rule 🟡 + `G-C08-EXPR-PARAM-SPLIT` 🔴 静默恒假 | **🔴 那半已过期**（params 已是一等操作数且缺失即抛错）；「Skill 不声明绑哪些规则」那半**不成立了**（`kind:"rule"` 已可声明且 engine 真执行） | ✅ | `ruledsl.ts:318-325/357-361`；`engine.ts:59-66` |
| SK-SPEC-M10 | ⑨ Solver 🟢；sidecar 无取消接口 | **sidecar 那半成立**：`services/optimizer/server.py:21/1121` 仍是 `ThreadingHTTPServer`；DataCore 侧已有 `cancellation.ts`（`solvers/service.ts:15`）但停的是调用不是求解进程 | 🔗 | — |
| SK-SPEC-M11 | ⑩ Workflow 🟡 串行 · `采纳经营方案` 唯一 NOT_IMPLEMENTED | **成立**：`workflow/executor.ts:104` 串行；`apps/datacore/src/actions.ts:59` `采纳经营方案: "NOT_IMPLEMENTED"` | 🔗 | — |
| SK-SPEC-M12 | ⑪ `outputSchema` **零消费方** | **过期**：有 2 个 src 消费方（见 L11-1），但都不做输出校验 | 🔗 | `skill-lint.ts:342`、`resource-projector.ts:149` |
| SK-SPEC-M13 | ⑫ 三个 🔴：①growth/run 无角色校验 ②发布 RBAC 直发不经 R4 ③无审批面 | **①成立**（`server.ts:243-244` 只有 `await auth(req)`）；**②成立**（`server.ts:530`/`:2507` 只查角色）；**③成立**（前端无 DRAFT 意图审批页） | ❌ | `grep -n "growth/run" -A 4 server.ts` |
| SK-SPEC-M14 | 汇总：🟢1 / 🟡8 / 🔴3 | **今日重算：✅ 2（⑨ Solver、⑧ Rule 引擎侧）· 🔗 7 · ❌ 3** | ⛔ | 文档自评，非需求 |
| SK-SPEC-M15 | 三条最该先做（⑫治理面 / ⑧params / ②BusinessIntent） | **第 2 条已完成**（params 已修）；第 1、3 条未动 | 🔗 | — |

---

### §3 · 语义修正（4 条）

| 编号 | 需求 | 档 | 证据 | 追的那一层调用 |
|---|---|---|---|---|
| SK-SPEC-3-1 | 场景入口 ──1:1──▶ 意图 | ✅ | `ScenarioSchema.intentKey`（`agentcore.ts:354`）必填 | `orchestrator.ts:606-626` 场景绑定意图跳过 classify |
| SK-SPEC-3-2 | 意图 ──1:1──▶ Skill | ❌ | `IntentDefinitionSchema`（`qos.ts:44-63`）**没有任何 skill 字段**（`grep -n "skill" qos.ts` = 0 行；金丝雀 `planRef`=2 行 ⇒ 工具有效）。意图绑的是 `planRef`(`:58`) | **D1「这条边根本不存在」复验成立** |
| SK-SPEC-3-3 | \|意图\| ≥ \|场景入口\| 且 \|Skill\| ≥ \|意图\| | ❌ | 7 Skill 远少于意图数；且无边可数 | — |
| SK-SPEC-3-4 | 「意图 = 客户需求场景」⇒ 角色/场景/触发/KPI 是**意图的定义本身** | ❌ | `IntentDefinition` 只有 `description`/`examples`/`slots`/`owner`/`riskLevel` | — |

---

### §4 · 现有 7 个 Skill 达标度（14 条）

| 编号 | 需求/判断 | 档 | 证据 | 追的那一层 |
|---|---|---|---|---|
| SK-SPEC-4-1 | 实测基线：7 个 Skill，body 387–522 字 | ✅ | 本文 §0 运行时实测表，与 SPEC 原表**逐字节一致** | 跑 `seedRegistry()` |
| SK-SPEC-4-2 | 已填 7 字段（capability/sideEffect/inputSchema/outputSchema/references/approvalGate/provenancePolicy） | ✅ | 实测 7/7 全有 | — |
| SK-SPEC-4-3 | `dependsOn` 7/7 全空 | ⚠ | 实测 `deps=0` ×7 | 消费方在（`skill-lint.ts:254/348`、`resource-projector.ts:334`）⇒「接了线没数据」 |
| SK-SPEC-4-4 | `maxBudgetRounds` 7/7 全空 | ❌ | 实测 `mbr=-` ×7（SPEC 记录属实） | 与 4-8 叠加：**既无数据也无消费方** ⇒ 比「接了线没数据」更弱 |
| SK-SPEC-4-5 | **D1** 与意图零绑定（意图绑 ExecutionPlan，无 intent→skill 引用） | ❌ | 见 SK-SPEC-3-2 | — |
| SK-SPEC-4-6 | **D2** body 应装 §1-⑥ Reasoning Graph + §1-⑧ 约束说明（今天均值 441 字，装不下） | ❌ | 实测均值 441.6（484+403+387+415+387+522+493)/7 | — |
| SK-SPEC-4-7 | **D3** `resources` 7/7 全空 | ⚠ | 实测 `res=0` ×7 | 消费方在：`read_skill_resource` 工具（`tools/registry.ts:258`）、`SkillResourceReader`（`engine.ts:19`）⇒「接了线没数据」 |
| SK-SPEC-4-8 | **D4** `maxBudgetRounds` **零消费方** | ❌ | `grep -rn maxBudgetRounds apps/*/src packages/*/src` 除契约声明外 **0**（金丝雀 `outputSchema`=10 命中 ⇒ 工具有效） | **没有任何 src 读它**，连测试也没有 ⇒ 比 ⚠ 更弱：纯声明 |
| SK-SPEC-4-9 | **D5** `outputSchema` 有值但零消费方 | 🔗 | **过期**，见 SK-SPEC-M12 | — |
| SK-SPEC-4-10 | 调整方向 1：先建 `意图 → Skill` 边 | ❌ | 未建 | — |
| SK-SPEC-4-11 | 调整方向 2：`maxBudgetRounds` 填值 + 接消费方（效果层：改这个数探索轮次真变） | ❌ | 两半都没有 | — |
| SK-SPEC-4-12 | 调整方向 3：`outputSchema` 要么接消费方要么删 | 🔗 | 接了 2 个消费方，但**都不是"拿它校验输出"** ⇒ 仍在制造"这件事做过了"的错觉 | — |
| SK-SPEC-4-13 | 调整方向 4：body 扩容=把 navSlice/DRIL/角色画像三处搬进来 | ❌ | body 长度与 SPEC 记录一字未变 | — |
| SK-SPEC-4-14 | 调整方向 5：`dependsOn` 表达 Skill 间复用 | ⚠ | 机制全在（环检测 `skill-lint.ts:238-274`、发布要求 PUBLISHED `:348` + `server.ts:1250 requirePublishedDeps:true`），**0 条数据** | 追到触发条件：`detectSkillDependencyCycle` 只在 `(skill.dependsOn??[]).some(d=>d.kind==="skill")` 为真时才报（`skill-lint.ts:351`）⇒ 数据为空 ⇒ **从未触发** |

---

### §5 · 引用而非内联（21 条）

| 编号 | 需求 | 档 | 证据 | 追的那一层 |
|---|---|---|---|---|
| SK-SPEC-G-5-1 | 总原则：Skill 引用规则/求解器/其他资源，不写死 | 🔗 | `SkillReferenceSchema`(`agentcore.ts:219-225`) 是引用不是副本；但只覆盖 8 种 kind | — |
| SK-SPEC-G-5-2 | `rules: ["C03","C09","C18"]` | ✅ | `kind:"rule"` 在词表 | `engine.ts:61-63` 预检/后验真执行；种子 `mocks/seed.ts:1061` 有 C03 |
| SK-SPEC-G-5-3 | `solvers: ["capacity_forecast"]` | ✅ | `kind:"solver"` | `engine.ts:65` + `unmetSolverPreconditions`(`:106`)；种子 `mocks/seed.ts:1337` |
| SK-SPEC-G-5-4 | `slices: ["model_capacity_network"]` | ⚠ | `kind:"slice"` 在词表 | 追一层：**无 engine 执行、无 probe 校验**（`skill-lint.ts:215-217` 自述 slice 无人校验）；只被 `resource-projector.ts:329` 投影成关系边。7 种子 0 条用它 |
| SK-SPEC-G-5-5 | `objectTypes: ["Model","Base","Line"]` | ✅ | `kind:"ontologyType"` | `server.ts:1269→1272` 发布探针；`resource-projector.ts:328` 显式**不**投影（避免悬挂边） |
| SK-SPEC-G-5-6 | `tools: ["invoke_solver","query_objects"]` | ❌ | 词表无 `tool` | 金丝雀见 L7-2 |
| SK-SPEC-G-5-7 | `mcp: ["mes.query"]` | ❌ | 词表无 `mcp` | 同上 |
| SK-SPEC-G-5-8 | `dependsOn: ["material_kitting_skill"]` | ⚠ | 字段+消费方在，数据 0 | 见 SK-SPEC-4-14 |
| SK-SPEC-G-5-9 | **C1** 不引入第二套规则语法（规则本体留 `ruledsl.ts` 唯一权威） | ⛔**不改不新造 → 反向断言通过** | 全仓无第二套规则 DSL；Skill 只存 rule key | 反查：`grep` 未发现 skill 侧规则语法解析器 |
| SK-SPEC-G-5-10 | **C2** 约束只在求解器定义一次 | ⛔**反向断言通过** | Skill 无 constraint 定义能力（`kind:"constraint"` 只是引用 key，且**无任何校验方**） | — |
| SK-SPEC-G-5-11 | **C5** Agent/MCP/Workflow/Human Node 全部是引用 | 🔗 | `kind:"agent"`/`"workflow"` 在词表但**零校验零执行**；MCP 不在词表 | `skill-lint.ts:215-217` 明写「constraint/slice/workflow/agent 今天仍无人校验」 |
| SK-SPEC-G-5-12 | 硬门：rule key ∈ RULES | ✅ | `server.ts:1268 refRuleKeys` → `:1272 probeMissingRefs` → `resources.ts:64` | 不存在 ⇒ `422 SKILL_REF_UNRESOLVED`（`server.ts:1279`）**且未落库**；`force` 不豁免（`:1263-1264`） |
| SK-SPEC-G-5-13 | 硬门：solver key ∈ 求解器注册表 | ✅ | `server.ts:1267` | 同上 |
| SK-SPEC-G-5-14 | 硬门：objectType ∈ 已发布本体 | ✅ | `server.ts:1269` | 同上 |
| SK-SPEC-G-5-15 | 硬门：tool ∈ `tools/registry.ts` | 🔗 | **不是引用清单校验**，而是 lint 从 **body 文本**里正则抓工具名反查（`skill-lint.ts:329-338`） | 追到触发：`registeredToolNames()`(`:54`) 取 `BUILTIN_TOOLS`+`final_answer`+`load_skill`；匹配形态仅「调用 \`x_y\`」「\`x_y\` 工具」两种 ⇒ 覆盖窄 |
| SK-SPEC-G-5-16 | 硬门：dependsOn ∈ skills | ✅ | `skill-lint.ts:192-235 validateRefResolution` + `server.ts:1250 requirePublishedDeps:true` | 发布路真传 `allSkills`（`server.ts:1250`），不像旧版本缺省 undefined 直接 return [] |
| SK-SPEC-G-5-17 | 「这道门今天做不了」→ 有引用清单后才可能 | ✅（已做成） | 上面 5 条中 3 条真做成了（rule/solver/objectType） | **SPEC 此句已过期**，见 §4 清单 |
| SK-SPEC-G-5-18 | 反向收益：「改 C08 影响哪些 Skill」一次查询 | 🔗 | `resource-projector.ts:322-335` 派生 `skill --references--> rule` 边写进 `resource_relations`；`GET /b/v1/…` 经 DRIL 可查 | 追到写点：`resource-registry.ts:218` 「仅保留两端资源均在册的边」。**但 7 种子只有 1 条 rule 引用（C03）**，查 C08 今天返空 |
| SK-SPEC-G-5-19 | 边界判据（变了是所有 Skill 跟着变→引用；只这一个变→内联） | ⛔ 原则性条款 | 已在 `skill-graph.ts`/`skill-lint.ts` 注释中被引用为设计依据 | — |
| SK-SPEC-G-5-20 | 引用列 5 项（规则/求解器+约束/本体切片/工具MCP/其他Skill） | 🔗 | 3/5 可声明且有校验（rule/solver/ontologyType）；slice 可声明无校验；工具MCP 无字段 | — |
| SK-SPEC-G-5-21 | 内联列 5 项（BusinessIntent / maxBudgetRounds / ReasoningGraph 拓扑 / provenancePolicy / antiExamples） | 🔗 | `provenancePolicy` ✅ 有真消费方（`engine.ts:360→458→loop.ts:1131`）；`maxBudgetRounds` 字段在零消费方；`businessIntent`/`antiExamples`/图拓扑 **三项无字段** | `antiExamples` 全仓 0（金丝雀有效） |

---

### §6 · Skill 开发模板与落地口径（27 条）

**包结构 13 项**（判据：是否有对应承载物；模板本身是"目标形态"）

| 编号 | 模板文件 | 档 | 证据 |
|---|---|---|---|
| SK-SPEC-G-6-1 | `skill.yaml`（主定义） | 🔗 | 承载物 = `SkillDefinition` 记录（非 YAML 文件）。§6 自己说「不需要新造承载机制」⇒ 判形态而非载体 |
| SK-SPEC-G-6-2 | `metadata.yaml`（business_owner/target_users/business_value/frequency） | ❌ | 四项均无字段（`businessIntent`=0、Skill 无 `owner`） |
| SK-SPEC-G-6-3 | `ontology/objects.yaml` | 🔗 | `kind:"ontologyType"` 可声明；**「必需属性」表达不了**（`SkillReferenceSchema` 无 `properties[]`） |
| SK-SPEC-G-6-4 | `ontology/relations.yaml` | ❌ | 词表无 `relation` |
| SK-SPEC-G-6-5 | `ontology/events.yaml`（声明发/收哪些事件） | ❌ | Skill 无 events 字段（`grep` 0）。**SPEC 自标「今天完全没有的一层」——复验成立** |
| SK-SPEC-G-6-6 | `context/context.yaml` | ❌ | 无 Skill 级 context 声明（见 L5-1） |
| SK-SPEC-G-6-7 | `context/memory.yaml` | ❌ | 同上 |
| SK-SPEC-G-6-8 | `reasoning/graph.yaml` | 🔗 | `SkillGraphSchema` 在（`skill-graph.ts:126`），**挂不到 Skill 上** |
| SK-SPEC-G-6-9 | `reasoning/prompts/*.md`（独立文件） | ❌ | 无。body 仍是单一字符串字段 |
| SK-SPEC-G-6-10 | `reasoning/strategies.yaml` | ❌ | 无 |
| SK-SPEC-G-6-11 | `agents/agents.yaml` + `roles.yaml` | 🔗 | `kind:"agent"` 可声明但零校验零执行；角色画像在 `prompts.ts:40-57 ROLE_SYSTEM_FRAGMENTS`（非 Skill 字段） |
| SK-SPEC-G-6-12 | `tools/mcp.yaml` + `api.yaml` | ❌ | 词表无 tool/mcp |
| SK-SPEC-G-6-13 | `rules/business_rules.yaml` + `constraints.yaml` | 🔗 | rule ✅ 有校验有执行；constraint 可声明**零校验** |
| SK-SPEC-G-6-14 | `solver/solver.yaml` + `model.lp` | 🔗 | solver key ✅；objective/weights ❌（见 L9-2）。`.lp` 按 §7 定案 2 **本就不该有** ⇒ 反向断言通过 |
| SK-SPEC-G-6-15 | `workflow/workflow.yaml` | 🔗 | `kind:"workflow"` 可声明零校验；种子 `sop_meeting` 真有一条（`mocks/seed.ts:1106`）—— **声明了但没人校验它存不存在** |
| SK-SPEC-G-6-16 | `evaluation/metrics.yaml` + `testcases.yaml` | 🔗 | `EvalCase(suite="skill_quality", skillKey)` 契约在（`agentcore.ts:387/396`）、发布门真读（`server.ts:1284`）；**但用例不随 Skill 包分发，seed 里 0 条** |
| SK-SPEC-G-6-17 | `output/schema.yaml` | 🔗 | `outputSchema` 见 L11-1 |
| SK-SPEC-G-6-18 | `README.md` | ⛔ 无需承载 | — |

**落地口径 8 行表**（一律读作「引用 + 需求声明」，不得实现成「包内定义」→ 反向断言：做了反是缺陷）

| 编号 | 模板文件 | 反向断言结果 | 证据 |
|---|---|---|---|
| SK-SPEC-G-6-19 | `rules/business_rules.yaml` 不得包内定义规则语法 | ⛔ **通过**（无人违规） | Skill 只存 rule key；规则语法唯一在 `apps/datacore/src/ruledsl.ts` |
| SK-SPEC-G-6-20 | `rules/constraints.yaml` 不得包内定义数学约束 | ⛔ **通过** | Skill 无 constraint 定义能力 |
| SK-SPEC-G-6-21 | `ontology/objects.yaml` 不得包内定义对象属性 | ⛔ **通过**，但"声明必需属性"这一正向能力**未实现** | `SkillReferenceSchema` 只有 kind/key/version/required/role |
| SK-SPEC-G-6-22 | `ontology/relations.yaml` 不得定义关系 | ⛔ **通过**（连声明都没有） | — |
| SK-SPEC-G-6-23 | `tools/mcp.yaml` 不得定义工具 schema | ⛔ **通过** | 工具 schema 唯一在 `tools/registry.ts` |
| SK-SPEC-G-6-24 | `agents/agents.yaml` 不得定义 agent | ⛔ **通过** | `AgentDefinition` 唯一在契约 |
| SK-SPEC-G-6-25 | `workflow/workflow.yaml` 不得定义工作流引擎语义 | ⛔ **通过** | 引擎唯一在 `workflow/executor.ts` |
| SK-SPEC-G-6-26 | `solver/solver.yaml` 列 solver key + 本 Skill 专属 objective/权重 | 🔗 | key ✅ / objective·weights ❌ |
| SK-SPEC-G-6-27 | 配套硬门：装载/发布校验每个被引用 key 真已注册，**不满足拒绝安装** | 🔗 | 3/8 kind 有校验（solver/rule/ontologyType，`server.ts:1272`）+ skill 本地解析（`skill-lint.ts:218`）；**constraint/slice/workflow/agent 4 种无人校验**，`skill-lint.ts:215-217` 自己写明 |

**四项值得直接采纳 + 接线点**（已在上表 G-6-5/9/16 覆盖 3 项，此处补 §17 与接线点）

| 编号 | 项 | 档 | 证据 |
|---|---|---|---|
| SK-SPEC-G-6-28 | §17 发布检查清单升格为发布门（推理图无环 / 异常路径已定义 / 审批节点已配 / Tool 权限已控） | ❌ | `catalog/service.ts:179-215 publishIntent` 只校验 slots 非空 / examples 非空 / plan 存在 / `validatePlanSteps`（含 render_answer 须最后）。四项新增**一项都没有** |
| SK-SPEC-G-6-29 | 包文件 → `SkillDefinitionSchema.resources[]`（不新造承载机制） | ⚠ | 字段在（`agentcore.ts:245`）、消费方在（`read_skill_resource` `tools/registry.ts:258`；`skill-lint.ts:320-326` 校验 `{{resource:name}}` 可解析），**7/7 全空** ⇒ 接了线没数据 |

---

### §7 · 两项定案（10 条）

| 编号 | 需求 | 档 | 证据 | 追的那一层 |
|---|---|---|---|---|
| SK-SPEC-G-7-1 | `ontology/requires.yaml` | ❌ | `requires` 在 Skill 侧全仓 0（`agentcore.ts`/`agentcore/src/*.ts` 唯一命中是 `auth.ts:115` 的报错文案）| 金丝雀 `references`=2 行 ⇒ 工具有效 |
| SK-SPEC-G-7-2 | `rules/requires.yaml`（且须已 PUBLISHED） | 🔗 | 无 `requires`；「须已 PUBLISHED」只对 `dependsOn` 的 **kind=skill** 生效（`skill-lint.ts:226-232`），对 rule 不生效 | `server.ts:1250 requirePublishedDeps:true` → `validateRefResolution` → `ref.kind!=="skill"` 直接 `continue`(`:218`) |
| SK-SPEC-G-7-3 | `tools/requires.yaml` | ❌ | 无 tool kind | — |
| SK-SPEC-G-7-4 | `solver/requires.yaml` | 🔗 | 无 `requires`，但 `kind:"solver"` 引用**发布期真校验存在性** | `server.ts:1272` |
| SK-SPEC-G-7-5 | `requires` 是契约不是副本；装载/发布校验宿主，不满足**拒绝安装** | 🔗 | 语义半实现：3 种 kind 拒绝发布（`422`），但**不是 `requires` 形状**，也表达不了 `minStatus`/`properties[]` | — |
| SK-SPEC-G-7-6 | 两目标同时成立：包自足可分发 + 定义单一真源 | 🔗 | 单一真源 ✅（无重复定义，见 G-6-19..25）；**包自足可分发 ❌**（无包格式、无 manifest、无签名，见 §8） | — |
| SK-SPEC-G-7-7 | 定案 2：`solver.ref` 引用已注册求解器 | ✅ | `kind:"solver"` + 发布探针 | `server.ts:1267/1272` |
| SK-SPEC-G-7-8 | 定案 2：`objective` 内联（本 Skill 专属） | ❌ | Skill 无 `objective` 字段 | 金丝雀有效 |
| SK-SPEC-G-7-9 | 定案 2：`weights` 内联 | ❌ | 全仓 `weights` 0 处（Skill 相关文件） | — |
| SK-SPEC-G-7-10 | 定案 2：**明确排除**包内 `.lp`/`.mps` 模型文件 | ⛔ **绝对不做 · 反向断言通过** | 无任何 Skill 侧模型文件；`services/optimizer` 是独立 sidecar，经注册表可发现 | — |

---

### §8 · Skill SDK + Runtime API（37 条）

**SDK 10 模块**

| 编号 | 模块 | 档 | 证据 |
|---|---|---|---|
| SK-SPEC-G-8-1 | Skill CLI | ❌ | `packages/` 只有 `contracts`、`llm-adapters`；`scripts/platform-cli.mjs` 中 `skill` **0 处**（金丝雀 `solver`=8 ⇒ 工具有效） |
| SK-SPEC-G-8-2 | DSL Parser | ❌ | 无 Skill DSL 解析器（规则 DSL 是另一回事） |
| SK-SPEC-G-8-3 | Ontology SDK | ⛔ **不新造 · 反向断言通过** | 无重复实现；经 DataCore `/a/v1/ontology/*` |
| SK-SPEC-G-8-4 | Agent SDK | ⛔ **反向断言通过** | 无重复；`AgentDefinition` + `runRegisteredAgent` |
| SK-SPEC-G-8-5 | MCP SDK | ⛔ **反向断言通过** | 无重复；B3 MCP |
| SK-SPEC-G-8-6 | Rule SDK | ⛔ **反向断言通过** | 无重复；`ruledsl.ts` |
| SK-SPEC-G-8-7 | Solver SDK | ⛔ **反向断言通过** | 无重复；求解器注册表 |
| SK-SPEC-G-8-8 | Workflow SDK | ⛔ **反向断言通过** | 无重复；`workflow/executor.ts` |
| SK-SPEC-G-8-9 | Test SDK | 🔗 | 半个：`SkillProbeRunner`(`skill-probe.ts:85`) 是真测试运行器，但**只能跑 `skill_quality` EvalCase**，无 SDK 面 |
| SK-SPEC-G-8-10 | Deploy SDK | ❌ | 无 |

**CLI 6 子命令**

| 编号 | 命令 | 档 | 证据 |
|---|---|---|---|
| SK-SPEC-G-8-11 | `dos skill create` | ❌ | CLI 无 skill（同 G-8-1）。**HTTP 替代存在**：`POST /b/v1/skills`(`server.ts:1210`) |
| SK-SPEC-G-8-12 | `dos skill validate` | ❌ | CLI 无。**HTTP 替代存在但前端不用**：`POST /b/v1/skills/lint`(`server.ts:1328`) —— 见 §4 清单 |
| SK-SPEC-G-8-13 | `dos skill compile` | ❌ | 无编译入口（`compileExecution` 只在 `/b/v1/skill-graphs/run` 内部调） |
| SK-SPEC-G-8-14 | `dos skill test` | ❌ | CLI 无。HTTP 替代 = 发布门内部的 `runSkillProbe`（`server.ts:1301`），无独立端点 |
| SK-SPEC-G-8-15 | `dos skill package` | ❌ | 无包格式 |
| SK-SPEC-G-8-16 | `dos skill deploy` | ❌ | CLI 无。HTTP 替代 `POST /b/v1/skills/:id/publish` |

**编译与运行时链**

| 编号 | 项 | 档 | 证据 |
|---|---|---|---|
| SK-SPEC-G-8-17 | 编译链 DSL→Parser→AST→Validator→Optimizer→Execution Graph→Runtime Package | 🔗 | 只有后半段：`compileExecution`(`skill-graph.ts:478`) → `compileGraph`(`:175`) 产出 `layers/entry/predecessors`。无 DSL/Parser/AST/Optimizer/Runtime Package |
| SK-SPEC-G-8-18 | Runtime 链 12 站（Intent 识别→Skill 匹配→Context→Ontology→Agent→Tool→Rule→Solver→Workflow→输出→Memory） | 🔗 | 链在但**顺序不同**：Skill 匹配靠 `selectSkills` 语义路由（`prompts.ts:71`）在 agent 内，不是 Intent 之后的独立站；Memory 更新缺写侧（L5-3） |

**API 面重复 8 行（⛔ 不新造 → 反向断言：建了反是缺陷）**

| 编号 | SDK 规格 API | 反向断言 | 证据 |
|---|---|---|---|
| SK-SPEC-G-8-19 | `/api/v1/ontology/object/{type}/{id}` | ⛔ **通过（0 命中）** | 金丝雀 `"/api/v1/queries` = 10 ⇒ 工具有效 |
| SK-SPEC-G-8-20 | `/api/v1/mcp/register` · `/invoke` | ⛔ **通过（0）** | 同上 |
| SK-SPEC-G-8-21 | `/api/v1/solver/run` | ⛔ **通过（0）** | 既有 `POST /b/v1/solvers/:key/run`(`server.ts:1930`) |
| SK-SPEC-G-8-22 | `/api/v1/rule/evaluate` | ⛔ **通过（0）** | 既有 `evaluate_rules` 工具 |
| SK-SPEC-G-8-23 | `/api/v1/workflow/start` · `/{id}` | ⛔ **通过（0）** | — |
| SK-SPEC-G-8-24 | `/api/v1/context/query` | ⛔ **通过（0）** | — |
| SK-SPEC-G-8-25 | `/api/v1/agent/task` | ⛔ **通过（0）** | 既有 `/api/v1/queries` |
| SK-SPEC-G-8-26 | `/api/v1/evaluation/feedback` | ⛔ **通过（0）** | — |
| SK-SPEC-G-8-27 | 建议：新增薄层 + 复用既有端点 | ✅ | Skill 层新增的 3 个端点（`/b/v1/skills*`、`/b/v1/skills/lint`、`/b/v1/skill-graphs/run`）都是薄层；Ontology/MCP/Rule/Solver/Workflow **一律走既有** |

**真新增 8 项**

| 编号 | 项 | 档 | 证据 |
|---|---|---|---|
| SK-SPEC-G-8-28 | Skill CLI | ❌ | 同 G-8-1 |
| SK-SPEC-G-8-29 | Skill Compiler（AST/Validator/Optimizer） | 🔗 | 只有图编译器（DAG/环检测/未实现 kind 拒绝），无 AST/Optimizer |
| SK-SPEC-G-8-30 | `.skill` 包 + `manifest.json` + `signature/` | ❌ | `manifest.json` 0、`SkillPackage` 0、`signature` 仅 2 处（JWT 报错文案 `auth.ts:48`、metrics 注释 `metrics.ts:109`）⇒ 与包签名无关 |
| SK-SPEC-G-8-31 | Manifest `runtime: ">=2.0"` + `dependencies` | ❌ | 无 |
| SK-SPEC-G-8-32 | `supersedes`（与 runtime 约束互补） | ❌ | 全仓 0 |
| SK-SPEC-G-8-33 | Skill Orchestrator API（Skill Graph 多 Skill 编排） | 🔗 | **端点真有**：`POST /b/v1/skill-graphs/run`(`server.ts:1360`)，`kind:"skill"` 节点真会解析并跑（`skill-orchestrator.ts:290-296 repos.skills.latestByKey`）。**但无 Skill 能声明图** ⇒ 只能由调用方每次手传图 |
| SK-SPEC-G-8-34 | Permission：data / tool / action 三面（per-Skill） | ❌ | `allowedTools`/`toolPermission`/`skillPermission`/`permittedActions` **全 0**（金丝雀 `scopeDeclaration`=59 ⇒ 工具有效）。今天只有 agent 级 `scopeToolNames`/`scopeObjectTypes`（`engine.ts:234-235`） |
| SK-SPEC-G-8-35 | Execution Trace 含 **Prompt Version** | 🔗 | Prompt **有版本**了：`PromptTemplateSchema.version`(`prompt-template.ts:27`)、`ResolvedPromptSchema.version`(`:38`)，经 `GET /a/v1/prompt-templates/:key/resolve` 下发。**但 `resolvePromptOverride`(`prompts.ts:240-255`) 只返回 `resolved.template` 字符串，把 `version` 丢掉了** ⇒ 版本存在但**进不了 trace**。追一层确认：`grep "resolved.version" prompts.ts` = 0 |
| SK-SPEC-G-8-36 | §24 生命周期角色（业务分析师/Skill 设计师/本体工程师/AI 工程师） | ❌ | `ROLE_PROFILES` 5 条（`mocks/seed.ts`），`ROLE_SYSTEM_FRAGMENTS`(`prompts.ts:40-57`) 无这四种 |
| SK-SPEC-G-8-37 | 前置 1：`/api/v1/evaluation/feedback` 依赖的人工采纳率今天跨租户混算 + `/metrics` 裸奔 | ❌（问题仍在） | `metrics.ts:100` 标签 `{action_type, outcome}` 无 tenant；`agentcore/src/server.ts:207` 与 `datacore/src/app.ts:848,927` 均无鉴权 |

> 补：**前置 2**（Runtime 链「Intent 识别→Skill 匹配」前有多道确定性门抢答）→ 🔗，`router/orchestrator.ts:606/643/667/676/690/744/749` 等多处在 classify 之前；未逐门计数（SPEC 说 10 道，本次不复核该数字，只复核「多门在前」这个事实成立）。

---

### §9 · 三项定案 + 推理图落位（22 条）

**9.1 定案 3 · `requires`（6 条）**

| 编号 | 需求 | 档 | 证据 |
|---|---|---|---|
| SK-SPEC-G-9-1 | 运行时唯一真源 = `skill.requires.{objectTypes,relations,slices,rules,solvers,tools,mcp,workflows,agents,dependsOn}` | ❌ | Skill 无 `requires` 字段；10 个子键中 4 个（relations/tools/mcp/workflows 复数形）连 kind 都没有 |
| SK-SPEC-G-9-2 | 每条带 `required` / `minStatus` / `properties[]` | 🔗 | `required` ✅（`agentcore.ts:223`）；`minStatus` ❌；`properties[]` ❌ |
| SK-SPEC-G-9-3 | `references[]`/`dependsOn[]` 降为**解析期别名**，不作为运行时字段 | ❌ | 二者仍是运行时字段且是唯一真源（`engine.ts:83` 直接读 `s.references`） |
| SK-SPEC-G-9-4 | migration §10.3 偏离理由不成立（`FeatureDef.requires` 是另一个对象的字段） | ✅（事实核对成立） | `packages/contracts/src/features.ts` 的 `requires` 属 `FeatureDef`，与 Skill 顶层无命名冲突 |
| SK-SPEC-G-9-5 | 扁平 `references[]` 表达不了「Factory 必须有 capacity」「rule 须 PUBLISHED」 | ✅（判断成立） | `SkillReferenceSchema` 5 字段无属性/状态约束；rule 的 PUBLISHED 要求今天确实不校验（G-7-2） |
| SK-SPEC-G-9-6 | 两道门合并为一道 `skill-refs:check` | ❌ | `skill-refs:check` / `skill-ref-closure:check` 在 `package.json`+`scripts/` **均 0 命中**（金丝雀 `ref-closure:check`=10 ⇒ 工具有效）。实际做成了**发布期运行态门**（`server.ts:1272`）+ 一个**已存在**的静态门 `scripts/check-ref-closure.mjs` |

**9.2 定案 4 · Business Intent 内部元数据（4 条）**

| 编号 | 需求 | 档 | 证据 |
|---|---|---|---|
| SK-SPEC-G-9-7 | 定为内部元数据，不作对外交付物 | ⛔ **本期不做/口径条款** | 无对外呈现面 ⇒ 未违规 |
| SK-SPEC-G-9-8 | ① 契约上**必填**，允许哨兵 `{status:"TODO", owner:"<待指派>"}`，不允许缺省为空 | ❌ | 无 `businessIntent` 字段（全仓 0） |
| SK-SPEC-G-9-9 | ② 棘轮门 `skill-business-intent:check`，TODO 只降不升，基线 = 32 | ❌ | `skill-business-intent:check` 0 命中；`scripts/` 无该文件 |
| SK-SPEC-G-9-10 | ③ `status:"TODO"` 不可 PUBLISHED | ❌ | `server.ts:1239-1305` 发布门无此校验 |

**9.3 定案 5 · body 上限 3000 不放开（3 条）**

| 编号 | 需求 | 档 | 证据 |
|---|---|---|---|
| SK-SPEC-G-9-11 | **不放开** 3,000 上限 | ✅ | `skill-lint.ts:47 BODY_MAX = 3000`，未改 |
| SK-SPEC-G-9-12 | 超限报错文案含「将静态数据块下沉至 resource」 | ✅ | `skill-lint.ts:303` 原文：`body 超 ${BODY_MAX} 字（当前 …）——将静态数据块下沉至 resource` |
| SK-SPEC-G-9-13 | 契约 `max(50_000)` 与 lint 3,000 **两者不冲突**（契约管存得下，lint 管该不该） | ✅ | `agentcore.ts:243` `z.string().max(50_000)` + `skill-lint.ts:47`。**派单里列的「已知冲突」不是缺陷，是 §9.3 明写的设计**（见 §4 清单） |

**9.4 推理图落位（9 条）**

| 编号 | 需求 | 档 | 证据 |
|---|---|---|---|
| SK-SPEC-G-9-14 | 图**骨架内联为结构化字段**（不是 body 散文） | 🔗 | `SkillGraphSchema`(`skill-graph.ts:126`) 是结构化字段，**但没挂到 `SkillDefinitionSchema`** |
| SK-SPEC-G-9-15 | 节点指向的资源走**引用**（`requires`） | ❌ | 图节点 `params` 是 `TemplateValue` 自由记录（`skill-graph.ts:86`），不与 `references` 交叉校验 |
| SK-SPEC-G-9-16 | 可复用子图提升为独立可寻址资源（被 ≥2 Skill 用即提升） | ❌ | 无子图资源类型 |
| SK-SPEC-G-9-17 | 提示词里每轮读**图目录**（节点 id + 一行意图 + 分支条件） | ❌ | `buildSkillSection`(`prompts.ts:69-78`) 只注入 `[id] name: summary`，无图目录 |
| SK-SPEC-G-9-18 | 按需 `load_reasoning_node(nodeId)` | ❌ | 全仓 0（金丝雀有效）。同族机制 `load_skill` 在（`tools/registry.ts:481`）但未下推一级 |
| SK-SPEC-G-9-19 | 没走到的分支永不进视野 | ❌ | 无图 ⇒ 无分支 |
| SK-SPEC-G-9-20 | 门 `skill-graph:check`（DAG / 无孤儿节点 / `solverRef`·`ruleRef` 在 `requires` 可解析） | 🔗 | **DAG + 环检测真有**且在生产路径上：`compileGraph`(`skill-graph.ts:245-272`) 三色 DFS 返回可读环路径 → `server.ts:1368` 经端点触发；**无孤儿节点检查 ❌**（`:297-305` 只检查分层是否覆盖全部节点）；**`requires` 可解析 ❌**（无 requires）；**门名 `skill-graph:check` 0 命中** |
| SK-SPEC-G-9-21 | 索引预算：图目录每节点 ≤80 字，与 body 3,000 分开计 | ❌ | 无 |
| SK-SPEC-G-9-22 | **效果层判据**：删某分支节点 → 该分支问句答案真的变（只断言"节点加载了"不算过） | ⚠ | 同族效果层判据**在别处已做到**：`skill-orchestrator.seam.test.ts` 靠"掐掉祖先输出 → 下游 `TEMPLATE_RESOLUTION_ERROR`"咬数据真流过边（`skill-orchestrator.ts:11-19` 注释）；但**推理图本身不存在**，这条判据无对象 |

---

## 2 · `PRD-addendum-skill-authoring.md` 逐条（77 条）

### §0 · 本体引用与影响（31 条）

| 编号 | 需求 | 档 | 证据 | 追的那一层 |
|---|---|---|---|---|
| SK-AUT-0-1 | `Skill` 有工业级字段 capability/sideEffect/inputSchema/outputSchema/references/dependsOn/approvalGate/provenancePolicy/maxBudgetRounds/resources | ✅（字段齐） | `agentcore.ts:252-260` 十字段全在 | 其中 `maxBudgetRounds` **零消费方**（SK-SPEC-4-8），`dependsOn`/`resources` **零数据** |
| SK-AUT-0-2 | 生命周期 DRAFT→PUBLISHED→RETIRED | ✅ | `agentcore.ts:247` | `server.ts:1220` 建即 DRAFT；`:1232` 非 DRAFT 改则 `409 IMMUTABLE_VERSION`；`:1306` 发布置 PUBLISHED；`POST /b/v1/skills/:id/retire`(`server.ts:1412-1423`) 经 `computeReferences`+`assertRetireOrDelete`(`resources.ts:239`) 置 RETIRED（有引用方须 `confirm`） |
| SK-AUT-0-3 | `SkillReference.kind ∈ {rule,constraint,slice,ontologyType,solver,skill,workflow,agent}` | ✅ | `agentcore.ts:216` 单一来源数组 | `skill-lint.ts:50` **import 而非手抄**（`VALID_REF_KINDS = new Set(SKILL_REFERENCE_KINDS)`）⇒ 新增 kind 不会漏 lint |
| SK-AUT-0-4 | `SkillReference` 含 `required`/`role`/`version` | ✅ | `agentcore.ts:222-224` | `engine.ts:84` 读 `r.required`；`skill-lint.ts:141-146` 校验 role/version |
| SK-AUT-0-5 | `SkillAttachment`（mime/description） | ⚠ | `agentcore.ts:228-233` | 消费方 `read_skill_resource`(`tools/registry.ts:258-266`)，**7/7 数据为空** |
| SK-AUT-0-6 | `AgentDefinition.skills[]` = skillId + version + arguments | ✅ | `agentcore.ts:38-45` | `engine.ts:270 resolveSkill`；`mocks/seed.ts:1382/1412/1430/1448/1542/1563` 6 个 agent 真挂了 skill |
| SK-AUT-0-7 | `EvalCase.suite` 新增 `skill_quality` | ✅ | `agentcore.ts:387` | `server.ts:1284 evalCases.listByTenant(tenantId,"skill_quality")` 发布门真读 |
| SK-AUT-0-8 | `EvalCase.skillKey` | ✅ | `agentcore.ts:396` | `server.ts:1284` `.filter(c=>c.skillKey===skill.key)`；`skill-probe.ts:123-125` 同 |
| SK-AUT-0-9 | `EvalCase.expect.behaviorGain` | ✅ | `agentcore.ts:420` | `skill-lint.ts:95` 计数 → `server.ts:1291` 覆盖门；`skill-probe.ts:293-330` 真跑 twin 差分 |
| SK-AUT-0-10 | `SkillResource`（DRIL 统一资源投影） | ✅ | `intelligence-resource.ts:162-168` | `resource-projector.ts:141 projectSkills` → `resource-registry.ts:188` → `retrieve_knowledge` 工具下发 |
| SK-AUT-0-11 | 链路 `Agent --binds--> Skill` | ✅ | `resource-projector.ts:316-320` 派生 `binds` 边 | 写进 `resource_relations`（`persistence/pg.ts:606`）；`resource-registry.ts:218` 过滤死路 |
| SK-AUT-0-12 | 链路 `Skill --references\|dependsOn--> {…}` | ✅ | `resource-projector.ts:322-335` | 同上；`ontologyType` 显式**不**投影（`:328`），避免悬挂边 |
| SK-AUT-0-13 | 链路 `Skill --evaluatedBy--> EvalCase(suite=skill_quality)` | 🔗 | 边**逻辑存在**（`skillKey` 外键）但**不在 `resource_relations` 里**，DRIL 查不到 | `resource-projector.ts:287-336` 派生边不含 evalCase |
| SK-AUT-0-14 | 链路 `Skill --projectedTo--> SkillResource` | ✅ | `projectSkills`(`resource-projector.ts:141`) | `resource-registry.ts:188` 唯一 src 调用方 → `ResourceRegistryService.search` → `engine.ts:245 retrieveResources` → `retrieve_knowledge` 工具 |
| SK-AUT-0-15 | 链路 + 事件 `Skill --published--> skill.published` | ✅ | `server.ts:1310 emitDomainEvent(tenantId,"skill.published",…)` | 发布成功后无条件 emit |
| SK-AUT-0-16 | 事件 `skill.published` 失效 `agent-editor.skill-bindings` | ✅ | `event-subscriptions.ts:41` `invalidates: ["agent-editor.skill-bindings","agent-editor.tool-bindings","skill-list"]` | 前端经 `/b/v1/outbox` 轮询失效 |
| SK-AUT-0-17 | R1 contracts-only-shared（Skill 契约在 `@platform/contracts`） | ✅ | `agentcore.ts` + `skill-graph.ts` 均在 contracts；`skill-lint.ts:1` 从 contracts import 词表 | `skill-graph.ts:5-6` 明写「契约留本包，agentcore 不得本地重定义」 |
| SK-AUT-0-18 | R3 entitlement：Skill 入口受 catalog_admin/authz 守护 | 🔗 | `requireCatalogAdmin` 守 create/put/publish/lint 四端点（`server.ts:1212/1228/1241/1330`）；**`GET /b/v1/skills` 只 `auth(req)`**（`:1191`）——列表任何登录用户可读 | 追一层：`applyListQuery(await repos.skills.listByTenant(a.tenantId))` 有租户隔离，无角色隔离 |
| SK-AUT-0-19 | R4 DRAFT 可编辑 / PUBLISHED 不可变 / RETIRED 退役 / 引用 latest 的 agent 下次加载即新内容 | ✅ | `server.ts:1232` 409；`engine.ts:270-283 resolveSkill(latest)` | `engine.ts:466` `loadSkill` 用 `agent.skills[].version ?? "latest"` |
| SK-AUT-0-20 | R6 确定性（探针行为增益对照 / lint 纯函数 / 依赖环检测稳定） | ✅ | `lintSkill`(`skill-lint.ts:276`) 纯函数无 IO；`detectSkillDependencyCycle`(`:238`) 按 key 归一忽略版本 | 92 个绿用例含 R6 断言（`skill-lint.test.ts`、`skill-probe.test.ts`） |
| SK-AUT-0-21 | R9 skills/evalCases/resource_relations memory+pg 双实现 | ✅ | `persistence/repos.ts:104` 接口；`persistence/pg.ts:603-624` pg 实现 | memory 实现在 `persistence/memory.ts`（同 repos 接口） |
| SK-AUT-0-22 | R13-a `provenancePolicy=required` 必须带 provenance | ✅ | `engine.ts:30-34 skillProvenancePolicy` → `:458` 传入 → `agent/loop.ts:1132-1134` **拒绝无 provenance 的 final_answer** | 触发条件：任一挂载 Skill 的 `provenancePolicy==="required"`；种子 `capacity_action_draft` 真是 required |
| SK-AUT-0-23 | R13-b WRITE/approvalGate 必须产 `action_draft` | ✅ | `isWriteModeSkill`(`agentcore.ts:201`) 单源（sideEffect **或** approvalGate≠none）→ `engine.ts:36-39` → `:459` → `loop.ts:1135-1139` | 契约注释 `:190-199` 记录了「探针只判一半 ⇒ 在更小工具集上发合格证」的旧病已收敛 |
| SK-AUT-0-24 | R13-c 无行为增益的技能被评测门禁拒 | ✅ | `skill-probe.ts:301-330`：`behaviorGain` 用例跑 twin（不挂 skill），twin 也含该内容 ⇒ `failures.push("behaviorGain: … twin also contains it")` | → `passRate<1` → `server.ts:1302-1304` `422 SKILL_EVAL_FAILED`。**且 `:271-272` 补了「behaviorGain 无 answerMust 直接判失败」**，堵住 `"".includes()` 恒 false 的假绿 |
| SK-AUT-0-25 | R14 零业务常数：Skill 资源投影不内联业务对象名 | ✅ | `resource-projector.ts:156-160 RESOURCE_REL_TARGET_KINDS` 从 `SKILL_REFERENCE_KINDS` **派生**（注释明说原稿是手写字面量） | — |
| SK-AUT-0-26 | R16 Skill 发布经 lint + eval 两门 | ✅ | `server.ts:1250`(lint) + `:1285/1291/1301`(eval 三关) | 串行在同一 handler，均在 `repos.skills.update` 之前 ⇒ 拒则未落库 |
| SK-AUT-0-27 | R16 跨资源 dependsOn/references 必须指向 PUBLISHED | 🔗 | **只对 `kind:"skill"` 生效**：`skill-lint.ts:226-232` + `server.ts:1250 requirePublishedDeps:true`；其余 kind 在 `:218` `continue` 掉 | 且 `references` 那一路硬传 `false`（`skill-lint.ts:347`）⇒ **references 的 skill 引用不要求 PUBLISHED**，只有 `dependsOn` 要求 |
| SK-AUT-0-28 | R16 无环 | ⚠ | `detectSkillDependencyCycle`(`skill-lint.ts:238-274`) 实现在、被 `lintSkill:350` 调、被 `server.ts:1250` 传 `allSkills` | **追到触发条件：`:351` `&& (skill.dependsOn??[]).some(d=>d.kind==="skill")`。7/7 `dependsOn` 为空 ⇒ 生产从未触发**（形态②的变体：链路接通、数据恒空） |
| SK-AUT-0-29 | 门禁 `skill-lint:check` | ❌（门名）/ ✅（能力） | `skill-lint:check` 在 `package.json`+`scripts/` **0 命中**（金丝雀 `ref-closure:check`=10）。能力真实存在于 `POST /b/v1/skills/:id/publish` | **`docs/SYSTEM-ONTOLOGY.md:946` 已诚实更正**：「二者没有 pnpm 门名……会误导为已进 CI 静态门」⇒ 本 PRD §0 的写法**是过期文案** |
| SK-AUT-0-30 | 门禁 `skill-eval:check`（≥3 用例 + SkillProbeRunner 挂真实 agent 全过） | ❌（门名）/ ✅（能力） | 同上。能力：`server.ts:1285/1291/1301` | `skill-probe.ts:119-120 ensureProbeAgent/ensureTwinAgent` —— 是**自动建的探针 agent**（真 `AgentDefinition` 记录、真 `ExecutionEngine`），不是复用某个已有生产 agent。措辞"挂载真实 agent"须理解为"真 agent 运行时"而非"真业务 agent" |
| SK-AUT-0-31 | 门禁 `ontology-writeback:check`（新增门须回写 §7·本次补录同步满足） | 🔗 | `scripts/check-ontology-writeback.mjs` **存在**，但**不在 `pnpm gates` 串里**（`package.json` 的 `gates` 26 个脚本中无它） | 回写本身**已做**：`SYSTEM-ONTOLOGY.md:946` 有条目且已含更正 |
| SK-AUT-0-32 | 断点：无新增；诚实边界「mock LLM 下评测分数仅证管线与断言框架正确」 | ⛔ **诚实边界·成立** | 92 个绿用例全在 mock LLM 下 | 与 §5 出厂范例缺失叠加 ⇒ 真实质量分今天不存在 |

### §1 · 三级职责铁律（6 条）

| 编号 | 需求 | 档 | 证据 | 追的那一层 |
|---|---|---|---|---|
| SK-AUT-1-1 | summary **≤200 字**，常驻 agent 系统提示词 | 🔗 | lint `SUMMARY_MAX=200`(`skill-lint.ts:46`) ✅ 且发布门真执行；**但契约是 `max(400)`**(`agentcore.ts:242`)，**前端输入框 `maxLength={400}` 且标签写「≤400 字」**(`SkillsPage.tsx:77-78`) | 三处口径 200/400/400。发布时 lint 拦得住，但**编辑期给用户的是 400** ⇒ 写到 350 字才在发布时被拒 |
| SK-AUT-1-2 | summary 只做**触发器**（删任何一句都会漏/误触发） | 🔗 | lint 强制「当…时使用」(`:289`) + 「不适用：」(`:292`) + 禁用词(`:295`)，是**结构**判据 | "删任何一句都会漏触发"这条**语义判据机器判不了**，无对应检查 |
| SK-AUT-1-3 | body **≤3000 字**，`load_skill` 按需加载 | ✅ | `BODY_MAX=3000`(`:47`) + `LOAD_SKILL_TOOL`(`tools/registry.ts:481`) | `engine.ts:462 loadSkill` 回调真取全文；`prompts.ts:73` 提示语「调用 load_skill(skillId) 获取全文」 |
| SK-AUT-1-4 | body 是**操作规程**，全文可执行；出现「介绍/背景/众所周知」即违规 | 🔗 | 禁用词表 `FORBIDDEN_WORDS`(`skill-lint.ts:41`) 含「介绍」，**但只查 summary**(`:295-299` 循环在 summary 分支内)，**body 不查禁用词** | 追一层：`lintSkill` 的 body 段(`:301-317`)只查长度/七段/正反例/resource 引用/工具名。「背景」「众所周知」**根本不在词表里** |
| SK-AUT-1-5 | resources 经 `read_skill_resource` 按需读取 | ⚠ | 工具在（`tools/registry.ts:258`）、reader 端口在（`engine.ts:19/243`），**7/7 数据为空** | — |
| SK-AUT-1-6 | body 中超过 **10 行**静态数据必须下沉 resources | ❌ | lint **无行数判据**，只有 3000 字上限 | 金丝雀：同文件的 `BODY_SECTIONS` 判据在 `:305-310` 真执行 ⇒ lint 是活的，10 行规则是真没有 |

### §2 · Summary 规范（6 条）

| 编号 | 需求 | 档 | 证据 | 追的那一层 |
|---|---|---|---|---|
| SK-AUT-2-1 | 强制模板 `[能力] 当 [场景1]、[场景2]、[场景3] 时使用。不适用：[排除]（此时应 [替代]）` | 🔗 | `skill-lint.ts:289` 正则 `/当[\s\S]+时使用/`、`:292` `/不适用[:：]/` | **只校验两个句式存在**，不校验「≥3 个触发场景」、不校验「（此时应 …）」替代做法。种子 7 条 summary 多数只有 1–2 个场景，照样过 |
| SK-AUT-2-2 | 触发场景必须是**业务动词短语**，禁止抽象名词 | ❌ | 无对应检查 | — |
| SK-AUT-2-3 | 「不适用」句**强制存在** | ✅ | `skill-lint.ts:292-294`，违反即 `summary.exclusion` | `server.ts:1251-1253` `!lint.ok && force!=="true"` ⇒ `422 SKILL_LINT_FAILED` |
| SK-AUT-2-4 | 禁用词 lint：`有用\|强大\|全面\|各种\|帮助你\|介绍` | ✅ | `skill-lint.ts:41` 六词一字不差 | `:295-299` 逐词 includes（仅 summary，见 SK-AUT-1-4） |
| SK-AUT-2-5 | 多技能互斥：同一 agent 的 summary 两两触发场景重叠检查（编辑器警告） | ❌ | `checkSkillMutualExclusion`/「重叠」/`overlap` 在 `skill-lint.ts`+`server.ts` **0 命中**（金丝雀 `lintSkill` 同文件命中 ⇒ 工具有效）。前端 `SkillsPage.tsx` 无警告面 | `docs/PASS2-wave4-finishing-tasks.md:23` 把它列为 P0 未完成项 |
| SK-AUT-2-6 | 重叠场景必须在各自「不适用」句中互相让渡 | ❌ | 依赖 2-5，无实现 | — |

### §3 · Body 规范（11 条）

| 编号 | 需求 | 档 | 证据 | 追的那一层 |
|---|---|---|---|---|
| SK-AUT-3-1 | 七段骨架存在性校验（目的/适用边界/前置检查/步骤/示例/失败处理/输出要求） | ✅ | `skill-lint.ts:44 BODY_SECTIONS` 七段一字不差；`:305-310` 逐段正则 `^#{1,4}\s*<段名>` | 发布门 `server.ts:1250` 真调；7 种子 body 全部含七段（实测均含 `## 目的`…） |
| SK-AUT-3-2 | 适用边界：适用/不适用各 ≥1 条（比 summary 展开） | ❌ | 只校验段落标题存在，不校验段内条数 | — |
| SK-AUT-3-3 | 前置检查含「用哪个工具确认」 | ❌ | 无校验 | — |
| SK-AUT-3-4 | 步骤：祈使句编号 + 每步含「做什么+用什么工具+判定标准」+ 分支「若 X → 步骤 N」 | ❌ | 无校验 | — |
| SK-AUT-3-5 | 示例：≥1 正例 + ≥1 反例 | 🔗 | `skill-lint.ts:312-317` 查 body 是否 `includes("正例")`/`includes("反例")` | **是关键词存在性，不是"≥1 条示例"**；写「正例反例」四个字即过 |
| SK-AUT-3-6 | 失败处理：每类可预见失败的明确动作，**禁止「酌情处理」** | ❌ | 「酌情」不在 `FORBIDDEN_WORDS`(`:41`) | 金丝雀：同词表的「介绍」在 `:295` 真被查 ⇒ 词表是活的 |
| SK-AUT-3-7 | 输出要求：交付物形态（溯源/block 类型/语气） | ❌ | 只校验段落标题存在 | — |
| SK-AUT-3-8 | 写作纪律：祈使句，禁叙事体与第一人称 | ❌ | 无校验 | — |
| SK-AUT-3-9 | 具体值优先于形容词（「≤6 周」而非「较短时间」） | ❌ | 无校验 | — |
| SK-AUT-3-10 | 工具名/字段名与注册表**逐字符一致**（lint 反查注册表） | 🔗 | `skill-lint.ts:329-338`：从 body 抓「调用 \`x_y\`」「\`x_y\` 工具」两种形态，反查 `registeredToolNames()`(`:54`) | **只覆盖工具名，不覆盖字段名**；且只覆盖两种书写形态。`registeredToolNames` 追到源：`BUILTIN_TOOLS`+`FINAL_ANSWER_TOOL`+`LOAD_SKILL_TOOL`（真注册表，非手抄） |
| SK-AUT-3-11 | 超 3000 字 → 拒绝发布并提示「将 [识别出的静态内容块] 下沉至 resource」 | 🔗 | `skill-lint.ts:302-304` 拒绝 ✅ + 提示语 ✅，**但不"识别出"具体内容块**（文案是固定串，不含定位） | — |

### §4 · 质量门禁（14 条）

| 编号 | 需求 | 档 | 证据 | 追的那一层 |
|---|---|---|---|---|
| SK-AUT-4-1 | 门一：summary 模板匹配（「当…时使用」+「不适用」） | ✅ | `skill-lint.ts:289/292` | `server.ts:1250-1253` |
| SK-AUT-4-2 | 门一：禁用词 | ✅ | `:295-299` | 同上 |
| SK-AUT-4-3 | 门一：字数 | ✅ | `:286`(summary 200) + `:302`(body 3000) | 同上 |
| SK-AUT-4-4 | 门一：body 七段骨架齐全 | ✅ | `:305-310` | 同上 |
| SK-AUT-4-5 | 门一：示例含正反例 | 🔗 | 见 SK-AUT-3-5（关键词存在性） | 同上 |
| SK-AUT-4-6 | 门一：工具/字段名注册表反查 | 🔗 | 见 SK-AUT-3-10（只工具名） | 同上 |
| SK-AUT-4-7 | 门一：`{{resource:name}}` 可解析 | ✅ | `skill-lint.ts:320-326` 正则 `\{\{resource:([^}]+)\}\}` 比对 `skill.resources[].name` | 发布路真跑；**但 7/7 resources 为空且 body 无 `{{resource:}}` ⇒ 生产从未命中**（接了线没数据） |
| SK-AUT-4-8 | 门二：每技能发布必附 **≥3 条** EvalCase | 🔗 | `server.ts:1284-1287` `<3` ⇒ `422 SKILL_EVAL_INSUFFICIENT`（`force=true` 审计豁免） | **追一层发现旁门**：`main.ts:29` `repos.skills.insert(sk)` 把种子**直插仓储**，完全绕过 `POST /b/v1/skills/:id/publish` ⇒ 出厂 **5 个 `status:PUBLISHED`** 的 Skill **从未过这道门**。亲手实测：7/7 过 lint（逐个跑 `lintSkill`，0 violation），但 `skill_quality` 用例 **0 条** ⇒ 若走正门 **7/7 会被 `422 SKILL_EVAL_INSUFFICIENT` 拦下**。见 F14 |
| SK-AUT-4-9 | 门二 · **应触发**：toolSequence 含 `load_skill(本技能)` 且回答符合"输出要求"段（answerMust） | 🔗 | `skill-lint.ts:92` 计数 + `server.ts:1291-1298` 覆盖门 ✅；`skill-probe.ts` 真跑 toolSequence 断言 ✅ | **「含 `load_skill(本技能)`」只判工具名不判实参**（`skill-lint.ts:92` `s.name === LOAD_SKILL_TOOL.name`）；「回答符合输出要求段」无结构化校验，靠 `answerMust` 人写字符串 |
| SK-AUT-4-10 | 门二 · **不应触发**：toolSequence 不含本技能加载 | 🔗 | `skill-lint.ts:93` `else shouldNotTrigger++` | 判据是「声明了 toolSequence 且不含 load_skill」⇒ **一条根本不加载任何技能的普通用例也算"不应触发"**，判别较宽 |
| SK-AUT-4-11 | 门二 · **行为增益**：挂载/不挂载两态跑，挂载态在指定断言上更优 | ✅ | `skill-probe.ts:293-330` 真跑 twin agent | `ensureTwinAgent`(`:120`/`:208`) 建不挂 skill 的对照 agent；`:329-330` twin 也含该内容 ⇒ 判失败。`:271-272` 补了「无 answerMust 直接失败」 |
| SK-AUT-4-12 | 发布流程：lint 过 → 评测套件过 → PUBLISHED | ✅ | `server.ts:1250 → 1272 → 1285 → 1291 → 1301 → 1306` 顺序严格 | 引用探针插在 lint 之后评测之前（`:1261` 注释说明理由），且 `force` **不豁免**探针（`:1263-1264`） |
| SK-AUT-4-13 | 任一不过给出**定位与修改建议** | 🔗 | lint 失败只回 `violations.map(x=>x.rule).join(", ")`（`server.ts:1252`）——**只给规则名，不给 message**；`SkillLintViolation` 有 `message`+`location`(`skill-lint.ts:12-16`) 但发布响应丢掉了 | 干跑端点 `POST /b/v1/skills/lint`(`:1340`) 返回完整 violations —— **但前端零调用**（见 §4 清单） |
| SK-AUT-4-14 | 改已发布技能 = 新版本重过两门；引用 latest 的 agent 自动获得，回归保护由评测承担 | ✅ | `server.ts:1232` PUBLISHED 不可改 → 必须新版本；`engine.ts:270-283 resolveSkill("latest")` | `server.ts:1312-1323` 发布后算 `impact.agents`（引用同 key 任一版本的未退役 agent） |

### §5 · 出厂范例（4 条）

| 编号 | 需求 | 档 | 证据 | 追的那一层 |
|---|---|---|---|---|
| SK-AUT-5-1 | 电池场景包内置正例 `production-capacity-interpretation` | ❌ | 全仓 `production-capacity-interpretation`/`production_capacity_interpretation` **只在 2 个 md 文档里**（本 PRD `:94` + `docs/PASS2-wave4-finishing-tasks.md:23` 标为未完成 P0），**代码 0** | 金丝雀：`capacity_analysis` 在 `apps/*/src` 命中 2 ⇒ 工具有效 |
| SK-AUT-5-2 | 该范例 summary 形态（能力句 + 三触发场景 + 不适用+替代） | ❌ | 无该 Skill | — |
| SK-AUT-5-3 | 该范例 body 七段齐全（前置检查=snapshotVersion / 步骤=口径差异三连查 / 反例=分位数不可平均 / 输出要求=溯源角标） | 🔗 | 该 Skill 不存在；**但语义已散落进 `capacity_analysis` 种子**（`mocks/seed.ts:1028-1045`：前置检查含 snapshotVersion、反例含「直接平均 P50 和 P90…分位数不可平均」、输出要求含 ⟦ref:N⟧） | ⇒ 内容在，**载体名与"可发布范例"身份不在**；且它 `resources=0`、无配套 EvalCase |
| SK-AUT-5-4 | 反例对照并排展示 + 标注每处违规对应的 lint 规则 | ❌ | 无。文档里的反例串（`本技能介绍产能相关的各种知识，帮助你更好地回答产能问题…`）在代码/测试 fixture 中 0 命中 | — |

### §6 · 验收用例 SA1–SA5（5 条）

| 编号 | 用例 | 档 | 证据 | 追的那一层 |
|---|---|---|---|---|
| SK-AUT-6-1 | **SA1** 反例技能提交 → lint 逐条定位拒绝（禁用词/缺不适用句/骨架缺段） | 🔗 | 能力有且测试绿（`skill-lint.test.ts:32-49`）；发布路真拒（`server.ts:1251`）。**但"逐条定位"在发布响应里丢了 message/location**（SK-AUT-4-13） | 追到：干跑端点有完整定位，前端不调 |
| SK-AUT-6-2 | **SA2** 应触发/不应触发评测全过；**删「不适用」句后误触发用例转红** | ⚠ | `classifySkillEvalCases` + `SkillProbeRunner` 全在、92 用例绿 | **追到触发条件：`skill_quality` EvalCase 在 seed 中 0 条**（`seedRegistry()` 返回键只有 agents/workflows/skills）⇒ **该验收在生产数据上无法执行**。"删不适用句 → 转红"的变异反证只在测试 fixture 里成立 |
| SK-AUT-6-3 | **SA3** 行为增益：挂载态含口径溯源、未挂载态不含；无增益技能发布被拒 | ⚠ | `skill-probe.ts:293-330` twin 差分真实现且绿 | 同 6-2：无出厂用例 ⇒ 生产从未跑过。**范例技能（5-1）也不存在** |
| SK-AUT-6-4 | **SA4** body 写错工具名 → lint 反查拒绝**并提示正确名** | 🔗 | 拒绝 ✅（`skill-lint.ts:334-338`，测试 `skill-lint.test.ts:53`）；**"提示正确名"❌** —— 文案是「请核对工具注册表的准确名」，**不给出建议名**（无编辑距离匹配） | — |
| SK-AUT-6-5 | **SA5** 改坏已发布技能步骤段 → 新版本评测红 → 发布阻断，线上 latest 不受影响 | 🔗 | 阻断链完整：`server.ts:1232`(不可改) → 新版本 → `:1301 runSkillProbe` → `:1302 passRate<1` ⇒ `422`；未落库 ⇒ 旧 PUBLISHED 仍是 latest（`resolveSkill` 取未退役最高版本） | **但 `passRate` 在 0 用例时返 1**（`skill-probe.ts:156` `total===0 ? 1 : …`）⇒ 若 `skillCases.length<3` 已被 `:1285` 先拦，逻辑闭合；**`force=true` 可一路豁免**（`:1285/1290/1300`）⇒ 阻断可被审计豁免绕过 |

---

## 3 · 汇总统计

### 按档（274 条 · 脚本统计，非目测）

| 档 | SPEC（196） | 增量 PRD（78） | 合计 | 占比 |
|---|---|---|---|---|
| ✅ 实体层真满足 | 30 | 35 | **65** | 23.7% |
| 🔗 有实现·接线不全 | 58 | 21 | **79** | 28.8% |
| ⚠ 只有 test 引用 / 接了线没数据 | 8 | 5 | **13** | 4.7% |
| ❌ 无承载物 | 72 | 16 | **88** | 32.1% |
| ⛔ 文档自标非目标 | 28 | 1 | **29** | 10.6% |

> 统计口径：脚本按「行首 `| SK-SPEC` / `| SK-AUT`」取行，取该行第一个以档位符号开头的单元格。
> 校验：274 = 65+79+13+88+29 ✓；编号无重复 ✓；未定档行 0 ✓。
> 注意**增量 PRD 的 ✅ 比例（45%）远高于 SPEC（15%）** —— 因为增量 PRD 写的是**已实施过的 WO**（lint/eval 双门），
> SPEC 写的是**目标形态**（12 层工业级 Skill）。两份文档不在同一个成熟度上，合并算总分会掩盖这个差别。

### ⛔ 的三分（29 条）

| 类别 | 条数 | 编号 |
|---|---|---|
| **绝对不做**（不算缺口） | 1 | `G-7-10`（包内 `.lp`/`.mps` 模型文件） |
| **不改/不新造 → 反向断言**（做了反是缺陷） | 23 | `G-5-9` `G-5-10` · `G-6-19`…`G-6-25`(7) · `G-8-3`…`G-8-8`(6) · `G-8-19`…`G-8-26`(8) —— **23/23 全部通过，无人违规** |
| **本期不做 / 口径条款 / 诚实边界 / 文档自评** | 5 | `G-5-19`（边界判据）· `G-9-7`（BI 内部元数据）· `SK-AUT-0-32`（mock LLM 诚实边界）· `M14`（SPEC 自评汇总）· `G-6-18`（README 无需承载） |

### ⚠ 的 13 条（「已排练不是已实现」/「接了线没数据」）逐条

`T-7`(dependsOn 复用) · `4-3`(dependsOn 空) · `4-7`(resources 空) · `4-14`(Skill 间复用) ·
`G-5-4`(slice 引用无校验) · `G-5-8`(dependsOn) · `G-6-29`(resources 承载) · `G-9-22`(推理图效果层判据无对象) ·
`SK-AUT-0-5`(SkillAttachment) · `SK-AUT-0-28`(依赖环检测**生产从未触发**) · `SK-AUT-1-5`(read_skill_resource) ·
`SK-AUT-6-2`/`6-3`(SA2/SA3 无出厂用例可跑)

**共同形态**：机制齐、消费方齐、测试绿，**数据恒空 ⇒ 分支从未进入**。修法是**补数据**（种子 resources / dependsOn / skill_quality 用例），
不是"接线"——两者混了必修错地方。

**反向断言全部通过**：无任何一处出现「Skill 包内自带规则语法 / 数学约束 / 对象定义 / 工具 schema / agent 定义 / 工作流引擎语义 / 模型文件」，也**没有**任何一条重复的 SDK API 端点（8/8 均 0 命中，金丝雀 10 命中）。这是本次复验里**唯一全绿**的一族。

---

## 4 · ⛔ 里「宣称做了但其实没做」逐条清单（最毒的一类）

> 判据：文档**正面陈述某物已存在/已生效**，而复验发现承载物不在、或在的不是它说的那个东西。
> 「本期不做」不算缺口，**「宣称做了」才是**。

| # | 出处 | 文档原话（宣称） | 复验事实 | 危害 |
|---|---|---|---|---|
| **F1** | `PRD-addendum-skill-authoring.md:37` §0 | 「**触及门禁**：`skill-lint:check`（结构 lint：summary/body/契约字段/依赖解析/无环）」 | **`skill-lint:check` 在 `package.json` 与 `scripts/` 中 0 命中**（金丝雀 `ref-closure:check`=10）。真实形态是 `POST /b/v1/skills/:id/publish` 的运行态门。`docs/SYSTEM-ONTOLOGY.md:946` 已诚实更正过，**但本 PRD 未同步** | 下一个人 `pnpm skill-lint:check` 会得到「命令不存在」，或误以为 CI 已守住而不看发布路 |
| **F2** | 同上 `:38` | 「`skill-eval:check`（评测门禁：≥3 skill_quality 用例 + SkillProbeRunner 挂载真实 agent 全过）」 | 门名同样 0 命中；且「挂载真实 agent」实为 `ensureProbeAgent`/`ensureTwinAgent` **自动创建的探针 agent**（`skill-probe.ts:119-120`），不是任何业务 agent | 同 F1；且"真实 agent"的措辞会让人以为覆盖了生产 agent 的挂载组合 |
| **F3** | 同上 `:39` | 「`ontology-writeback:check`（新增门须回写 §7，**本次补录同步满足**）」 | 脚本 `scripts/check-ontology-writeback.mjs` 存在，但**不在 `package.json` 的 `gates` 串里**（26 个脚本无它）⇒ 「同步满足」这件事**没有机器在守**，只是人写了一次 | 回写与门名漂移下次不会被机器抓到（正是铁律 0.6 要治的） |
| **F4** | 同上 `:14` §0 | 「Skill 工业级字段 …/**maxBudgetRounds**/resources」列为已触及对象字段 | 字段确实在契约里，但 **`maxBudgetRounds` 全仓零消费方零数据**（`grep` 除契约声明外 0 命中，金丝雀 `outputSchema`=10）；`resources` **7/7 空** | 「字段在」被读成「这件事做过了」——SPEC §4-D4/D5 亲自警告过的那种危险 |
| **F5** | 同上 `:33` R13 | 「无行为增益的技能**被评测门禁拒**」 | 机制真实且绿，**但 seed 中 `skill_quality` 用例 0 条**（`seedRegistry()` 返回键只有 agents/workflows/skills）⇒ 出厂 7 个 Skill **一个都跑不到这道门**（会先被 `:1285` 的「≥3 用例」拦，或被 `force=true` 全程豁免） | 门是真的，门后没有人走过；"已生效"与"已排练"混同 |
| **F6** | 同上 `:95` §5 | 「**出厂范例**（`production-capacity-interpretation`）」以既成事实语气列出 summary/body 细节 | **代码中 0 命中**（金丝雀 `capacity_analysis`=2）。语义散落在 `capacity_analysis` 种子里，但**该名字的 Skill 不存在，配套 EvalCase 不存在，反例对照不存在** | SA2/SA3 两条验收的**被测对象不存在** ⇒ 两条验收在生产上不可执行（本表 SK-AUT-6-2/6-3 标 ⚠ 的根因） |
| **F7** | 同上 `:98` §5 | 「反例对照（**文档内并排展示**，标注每处违规对应的 lint 规则）」 | 文档里只有一句反例串，**没有并排展示，没有标注对应 lint 规则**；代码/fixture 里 0 命中 | 「编写代理的模仿基准」实际不存在 |
| **F8** | `SPEC-industrial-skill.md:231` §5 | 「（引用可校验）**这道门今天做不了**（无任何一处声明），有引用清单后才成为可能」 | **已过期（反向）**：2026-08-09 起 rule/solver/ontologyType 三种 kind 的存在性探针已接上 skill 发布路（`server.ts:1272`），死路引用 `422 SKILL_REF_UNRESOLVED` 且未落库 | 照此文安排工作会**重复造一道已存在的门**（CLAUDE.md 铁律 0.5 记载的第三类错原样复发） |
| **F9** | `SPEC-industrial-skill.md:113` §2-⑧ | 「`G-C08-EXPR-PARAM-SPLIT` 🔴 —— DSL 的 expression **不能引用 params** …**静默恒假不报错**」并在「三条最该先做」列第 2 位 | **已修**：`ruledsl.ts:318-325` `params.<名>` 是一等操作数；`:357-361` 未提供 params 时**抛错**而非静默 false；`:414-420 collectParamRefs` 供发布期校验 | 按 SPEC 排期会把已完成项当"最该先做"，挤掉真缺口（②Business Intent、⑫治理面） |
| **F10** | `SPEC-industrial-skill.md:116` §2-⑪ | 「`outputSchema` **零消费方** —— 没有任何地方拿它校验实际输出」 | **前半过期**：有 2 个 src 消费方（`skill-lint.ts:342` 形状校验、`resource-projector.ts:149` 投影 `outputSpec`）。**后半仍成立**：确实无人拿它校验实际输出 | 「零消费方」会被下一个人读成"删了没影响"，而删掉会断 DRIL 检索的 `outputSpec` |
| **F11** | `SPEC-industrial-skill.md:117` §2-⑫ | 「**生长回路真的会写**」（对上一版「只报不写」的更正） | **复验成立**，此条**不是**假宣称，列此仅为闭环记录 | — |
| **F12** | `SPEC-industrial-skill.md:110` §2-⑤ | 「5.3 记忆：`search_experience` 50 案例」「**5.3 只读不写**」 | **复验成立，非假宣称**（本条曾被我误判为"部分不成立"，追一层后自纠）：`distillExperienceCases`(`mocks/seed.ts:1741`) 的唯一 src 调用方是 `main.ts:44` —— **启动时灌常量 `LIVED_IN_SCENE_HISTORY`**，不是从真实 task 蒸馏。写侧确实不存在 | 列此仅为记录一次自纠：**「有个函数叫 distill」不是「有回写通道」的证据** |
| **F13** | 派单给的「已知冲突」 | 「契约 `body: max(50_000)` vs `skill-lint.ts:47 BODY_MAX=3000`」列为冲突 | **不是冲突**：`SPEC §9.3`（`:461-462`）明写「契约管存得下，lint 管该不该这么写」，是**设计**。两者今天字节一致于文档 | 按"冲突"去修会放开 lint 或收紧契约，两者都违反 §9.3 定案 5 |
| **F14** | `PRD-addendum-skill-authoring.md:35` R16 | 「**发育闭环：Skill 发布经 lint+eval 两门**」 | 门是真的，**但出厂数据走旁门**：`apps/agentcore/src/main.ts:29` `repos.skills.insert(sk)` 直插仓储，5 个种子以 `status:PUBLISHED` 落库，**一次也没经过 `POST /b/v1/skills/:id/publish`**。亲手实测：7/7 能过 lint（0 violation），但 `skill_quality` 用例 0 条 ⇒ 走正门 **7/7 会被评测门拦** | 「门装上了」被读成「库里的东西都过了门」。任何拿出厂 Skill 当「达标样例」的推理都不成立 |

### 附：**真冲突**（文档之间口径不一致，非上表的"宣称做了"）

| # | 冲突 | 三方口径 | 复验 |
|---|---|---|---|
| **X1** | summary 长度 | PRD §1「≤200 字」· 契约 `agentcore.ts:242` `max(400)` · 前端 `SkillsPage.tsx:77-78` 标签与 `maxLength` 均 **400** | lint 200 在发布期拦得住，但**编辑期给用户 400** ⇒ 用户写到 350 字保存成功、发布被拒。三处口径应收敛（与 body 的 50000/3000 不同：那是 §9.3 明确的两层语义；summary 这里**没有对应定案**） |

---

## 5 · 金丝雀证据（报否定结论的前提）

本文所有 ❌ 判定所用命令，均先跑过下列已知必中样例；**任一金丝雀不中即报「工具坏了」而非「代码没有」**。

| 用于判定 | 金丝雀命令 | 命中 |
|---|---|---|
| `businessIntent` / `supersedes` / `maxBudgetRounds` / `allowedTools` / `promptVersion` / `subClassOf` / `WITH RECURSIVE` / `load_reasoning_node` / `weights` = 0 | `grep -rn "SkillDefinitionSchema" apps/*/src packages/*/src` | **7** |
| Skill 无 `domain`/`owner`/`riskLevel`/`requires`/`objective` | `grep -c "references" packages/contracts/src/agentcore.ts` | **2 行** |
| 意图无 skill 引用（`grep -n "skill" qos.ts` = 0） | `grep -c "planRef" packages/contracts/src/qos.ts` | **2 行** |
| CLI 无 skill 子命令（`grep "skill" platform-cli.mjs` = 0） | `grep -c "solver" scripts/platform-cli.mjs` | **8** |
| 8 个 SDK 重复 API 端点全 0 | `grep -rn '"/api/v1/queries' apps/agentcore/src/server.ts` | **10** |
| `skill-refs:check` / `skill-lint:check` / `skill-eval:check` / `skill-graph:check` / `skill-business-intent:check` = 0 | `grep -rn "ref-closure:check" package.json scripts/ apps/*/package.json packages/*/package.json apps/*/src packages/*/src` | **10** |
| `production-capacity-interpretation` 代码 0 命中 | `grep -rn "capacity_analysis" apps/*/src packages/*/src` | **2** |
| `checkSkillMutualExclusion`/重叠检查 = 0 | `grep -c "lintSkill" apps/agentcore/src/skill-lint.ts` | **1** |
| per-Skill 权限字段全 0 | `grep -rn "scopeDeclaration" apps/*/src packages/*/src` | **59** |

**运行时金丝雀**（不靠 grep）：`node -e "require('./apps/agentcore/dist/mocks/seed.js').seedRegistry()"` 打印出 7 个 Skill 的逐字段值，
与 SPEC §4 记录的 body 长度表**逐字节一致**（484/403/387/415/387/522/493）⇒ 反证「我读的是同一份种子」。

---

## 6 · 复验命令（别信本文，亲手跑）

```bash
git checkout claude/inspiring-gates-aqczjg && git rev-parse HEAD   # b50f42a…
pnpm install --prefer-offline
pnpm --filter @platform/contracts build
pnpm --filter @platform/llm-adapters build
pnpm --filter agentcore build

# ① 7 个 Skill 的真实字段（不是 grep）
node -e "const{seedRegistry}=require('./apps/agentcore/dist/mocks/seed.js');
const r=seedRegistry('2026-01-01T00:00:00.000Z');
for(const s of r.skills)console.log(s.key,s.status,'body='+s.body.length,'res='+s.resources.length,
 'deps='+(s.dependsOn?.length??0),'mbr='+(s.maxBudgetRounds??'-'),'exec='+(s.execution?'y':'n'));
console.log('seed keys=',Object.keys(r).join(','));"

# ② Skill 相关测试（10 文件 92 用例）
cd apps/agentcore && npx vitest run test/skill-*.test.ts test/skill-*.seam.test.ts

# ③ 门名是否真存在（应全 0；金丝雀 ref-closure:check 应 =10）
for n in skill-refs:check skill-lint:check skill-eval:check skill-graph:check \
         skill-business-intent:check ref-closure:check; do
  echo -n "$n => "; grep -rn "$n" package.json scripts/ apps/*/src packages/*/src 2>/dev/null | wc -l
done

# ④ 引用探针是否真接在 skill 发布路（摘掉 server.ts:1272 那行 → skill-ref-closure.seam 应转红）
grep -n "probeMissingRefs" apps/agentcore/src/server.ts   # 应见 694 / 1012 / 1272 三处
```

---

## 7 · 结论（一句话）

**274 条里，真正「实体层满足」的只有 65 条（23.7%）；最大的一块是 ❌ 88 条（32.1%）——
而最该先看的不是这 103 条，是 13 条「宣称做了其实没做」（F1–F13）**：其中 **F8/F9/F10 三条是「已经做完了但文档还写着没做」**
（照文档排期会重复造门），**F1/F2/F3/F5/F6/F7/F14 七条是「文档说有其实没有 / 有门但库里的东西没走过」**（照文档验收会验空气）。
两个方向的错都源自同一个形态：**拿文档里的一句话当作事实的证据，而那句话并不度量那个事实。**
