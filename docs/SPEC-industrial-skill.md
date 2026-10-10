# SPEC · 工业级 Skill 完整结构（仓主给定 · 12 层）

> 本文是 **Track E（Skill 吞并 ExecutionPlan）的目标形态定义**，由仓主给定。
> 配套：`docs/WO-ROUTING-RETRIEVAL-FIRST.md` Track E（决策与迁移约束）。
>
> **本文分两部分**：§1 仓主给定的 12 层结构（原样记录，不改写）；
> §2 **审核方对照映射** —— 每一层今天在仓里有没有、在哪、缺什么（附证据）。
> 只存结构不做映射 = 又一份没有消费方的声明（#92 同族），故 §2 是本文的交付重点。

---

## §1 · 12 层结构（仓主给定 · 原样记录）

```
Industrial Skill
│
├── 1. Skill Identity（技能身份）
├── 2. Business Intent（业务意图）
├── 3. Ontology Binding（本体绑定）
├── 4. Input Contract（输入契约）
├── 5. Context Manager（上下文管理）
├── 6. Reasoning Logic（推理逻辑）
├── 7. Tool / MCP Binding（工具调用）
├── 8. Rule & Constraint Engine（规则约束）
├── 9. Solver Integration（求解器）
├── 10. Workflow Execution（流程执行）
├── 11. Output Contract（输出结果）
└── 12. Governance & Learning（治理学习）
```

### 1. Skill Identity（技能身份）
Skill 的基本信息，类似软件包 metadata。
`skill_id` · `name` · `domain` · `category` · `version` · `owner` · `risk_level`
**作用**：Skill 注册 · 生命周期管理 · 权限控制 · 版本升级。

### 2. Business Intent（业务意图）
这个 Skill 解决什么**业务问题** —— 不是技术描述，是业务目标。
包含：用户角色 · 决策场景 · 触发条件 · KPI。
例：用户=制造副总裁 · 场景=S&OP 会议 · 目标=提高订单交付准确率 · 指标=OTD / 产能利用率。

### 3. Ontology Binding（本体绑定）
**工业 Skill 最关键部分**。Skill 不操作数据库，操作**业务对象**。
声明 `objects[]` 与 `relations[]`（如 `Factory -HAS_LINE-> ProductionLine`、`Order -REQUEST_PRODUCT-> Product`）。
**作用**：让 Agent 理解"工厂是什么 / 产线是什么 / 订单如何影响产能"。

### 4. Input Contract（输入契约）
Skill 需要什么输入：参数定义（`factory_id`/`product_id`/`time_range`/`scenario`）+ **数据来源**（ERP/MES/WMS/PLM/CRM）。
例：用户说「预测一下明年宁德基地产能」→ Skill 自动需要 `{factory:"宁德基地", period:"2027", product_family:"全部"}`。

### 5. Context Manager（上下文管理）
- **5.1 Context Retrieval**：当前项目 / 用户身份 / 历史分析 / 当前任务
- **5.2 Context Compression**：百万 token 企业知识 → 当前决策所需的 5000 token
- **5.3 Context Memory**：决策历史 / 人工修正 / 最终结果

### 6. Reasoning Logic（推理逻辑）
Skill 的大脑。**不是"请分析"，而是 Reasoning Graph**。
例：需求增长 → 订单预测 → 产能需求 → 产线能力 → 瓶颈识别 → 扩产建议。

### 7. Tool / MCP Binding（工具调用）
Skill → MCP Registry → {ERP, MES, Solver}。声明 `tools[]`（`query_inventory`/`query_capacity`/`run_solver`/`generate_report`）。

### 8. Rule & Constraint Engine（规则约束）
**工业场景不能只靠 LLM**，必须有 Business Rules。
例：同一产品不能跨基地生产 · A 级客户优先级最高 · 设备换型时间 ≥4 小时 · 良率 <95% 禁止承诺。

### 9. Solver Integration（求解器）
复杂问题必须调数学模型：LLM 生成问题 → OR Solver → 最佳方案 → LLM 解释。
OR-Tools / Gurobi / CP-SAT / MILP；声明 `type` · `objective` · `constraints`。

### 10. Workflow Execution（流程执行）
Skill 不是回答一次，工业场景需要长流程：
Trigger → 数据准备 → 模型计算 → **专家审核** → 生成方案 → **审批** → 执行。（BPM + Agent）

### 11. Output Contract（输出结果）
**不是"分析完成"，而是结构化输出**。
例：`{risk:[{line:"A03", type:"capacity shortage", impact:"5000吨"}], recommendation:["增加夜班","调整订单"]}`
承载面：Dashboard / Report / API / Workflow Action。

### 12. Governance & Learning（治理学习）
- **Skill Evaluation**：准确率 · 响应时间 · **人工采纳率** · 收益
- **Human Feedback**：AI 建议「增加 B 线 20%」→ 人工改为 10% → 系统学习 → 优化下一次

### 工业级 Skill vs 普通 Prompt

| | Prompt | 工业 Skill |
|---|---|---|
| 目标 | 回答问题 | 完成业务任务 |
| 输入 | 文本 | 业务对象 |
| 知识 | RAG | Ontology |
| 推理 | LLM | LLM + 规则 + Solver |
| 执行 | 无 | Workflow |
| 结果 | 文本 | 结构化决策 |
| 复用 | 低 | 高 |
| 治理 | 无 | 有 |
| 学习 | 无 | 闭环 |

---

## §2 · 审核方对照映射（今天仓里有没有 · 在哪 · 缺什么）

判定口径：**「已有」= 机制在且有真消费方**；「有机制无消费方」单独标 ⚠ ——
本仓反复吃亏的正是后者（#90 Skill 对默认路径不可达、#92 账本零调用方、E9 旁白多角色不可达）。

| # | 层 | 今天状态 | 在哪 / 证据 | 缺什么 |
|---|---|---|---|---|
| 1 | **Skill Identity** | 🟡 **部分** | `SkillDefinitionSchema`（agentcore.ts:236）有 `id/key/version/name/status/tenantId` | 缺 `domain` · `category` · `owner` · **`risk_level`**；缺 `supersedes`（E8：意图池按 id 幂等、PUBLISHED 后 PUT 409，演进只能建新版顶旧版 → "顶替谁"必须是一等字段） |
| 2 | **Business Intent** | 🔴 **几乎全缺** | Intent 有 `description`/`examples`；`ScenarioCard` 有 `summary` | **用户角色 / 决策场景 / 触发条件 / KPI 四项全无**。今天无处声明"这个 Skill 服务谁、在哪个会议上用、成功指标是什么" |
| 3 | **Ontology Binding** | 🟡 **有物无声明** | 对象类型 91 个 ACTIVE / 11,087 对象；关系是一等行（`ontology_links`/`links`）；`NavigationSlice.objectTypes` 有 | **Skill 侧零声明**。今天"这个题涉及哪些对象/关系"散在 navSlice 投影 + DRIL 组包 + 角色画像**三处**，无一处是权威。另：本体是**平的**（无 subClassOf/传递/逆关系），`WITH RECURSIVE` 全仓 **0 次**，图遍历全在应用内存 |
| 4 | **Input Contract** | 🟡 **两处未统一** | Skill 有 `inputSchema`（可选）；Intent 有 `slots[]`（名/类型/必填/defaultFrom） | 两份并存、无一为权威 —— 正是 Track E 要收敛的。**数据来源（ERP/MES/WMS/PLM/CRM）零声明**：连接器 A1 有，但 Skill 不声明自己依赖哪个源 |
| 5 | **Context Manager** | 🟡 **三项各有各的问题** | 5.1 检索：`conversationSummary` + DRIL 组包（真·确定性·无 LLM）<br>5.2 压缩：`estimateTokensChars` + 8KB 工具结果截断 + maxToolCalls=40<br>5.3 记忆：`search_experience` 50 案例 | **5.2 实测在默认阈值下是死代码**（#91：最坏上下文 102,785 tok vs 软线 140,000 → 在 Anthropic 路径上不可达）；**5.3 只读不写** —— 决策历史/人工修正没有回写通道（见 §12）。三项**均非 Skill 字段**，无法按题型配置 |
| 6 | **Reasoning Logic** | 🔴 **是线性步骤，不是图** | `ExecutionPlan.steps[]` 1–12 步（`resolve_slice`→`invoke_solver`→`evaluate_rules`→`render_answer`） | **无 Reasoning Graph**。今天是**线性管线**，不能表达"瓶颈识别的结果决定要不要走扩产建议"这类**条件分支/汇流**。探索态则相反 —— 完全自由 ReAct，无强制序（Track A Phase 4 要治 〔⚠️ **2026-08-09：此处「Phase 4」是 C5 改名后的残留裸 Phase，按命名空间应读作 Track A 路由线 `R…` 期；见文末订正表**〕） |
| 7 | **Tool / MCP Binding** | 🟡 **有物无声明** | 30 个工具（`tools/registry.ts`）+ MCP 配置（B3） | Skill 不声明自己用哪些工具 → 今天 agent 首轮**注入全部 30 个 schema**（Track B4 要按 DRIL 预选裁剪）。另 **`discover` 的 kind 无 `intents`**（E7）—— agent 按提示"先 discover"时看不见意图池 |
| 8 | **Rule & Constraint** | 🟡 **引擎在·绑定缺·且有真缺陷** | 规则 DSL（`ruledsl.ts`）+ 28 条业务规则（C01–C33）+ `RULE_PARAM_BINDINGS` 投影 | Skill 不声明绑哪些规则。**且规则引擎自身有实缺**：`G-C08-EXPR-PARAM-SPLIT` 🔴 —— DSL 的 expression **不能引用 params**，写 `params.cashFloor` 会被当 field path、双 undefined → **静默恒假不报错**（C09/C18/C21 同病）。改 params 不改规则判定 〔🔁 **2026-08-09：本格的 🔴 半已过期·见表后订正 F9**〕|
| 9 | **Solver Integration** | 🟢 **有真物** | 57 个注册求解器 + CP-SAT sidecar（`services/optimizer`）+ `SOLVER_ARGS_SCHEMAS` | Skill 不声明绑哪个 solver / objective / constraints。**sidecar 无取消接口**（D1 已查实：`ThreadingHTTPServer`，不感知客户端断开——我们取消的是"调用"不是"求解进程"） |
| 10 | **Workflow Execution** | 🟡 **有物·但审批与 Skill 不连** | `workflow/executor.ts`（**串行 for…await·无 `Promise.all`** ← E5：三角色 203s 的成因）+ Action 审批链（`approvalChain` 1–3 级） | Skill 无 workflow 绑定。**长流程里的"专家审核/审批"今天只在 Action 层有**，Skill 层不声明"我这一步需要人审"。另 `采纳经营方案` 仍是唯一 `NOT_IMPLEMENTED` 的 ActionType（#81） |
| 11 | **Output Contract** | 🟡 **有形无约束** | Skill 有 `outputSchema`（可选）；答案是 `blocks[] + provenance[] + trustLevel + unverifiedNumerics` | `outputSchema` **零消费方** —— 没有任何地方拿它校验实际输出。**结构化决策（risk[]/recommendation[]）今天靠 LLM 自由生成 blocks**，不受 schema 约束 〔⚠️ **2026-08-09：「零消费方」已过期（有 2 个）·「不校验输出」仍成立·见表后订正 F10**〕|
| 12 | **Governance & Learning** | 🔴 **写得了·治不住** | Evaluation：`EvalService` 在；埋点 `ActionMetrics` 在<br>Feedback：`growth/probe.ts` 能精确判出 `NO_INTENT` 并给 `suggestedFill`<br>**生长回路真的会写**（见右） | ⚠️ **本格原稿有错，此处更正**：原写「生长回路只报不写 / 从不建意图（E8）」**是错的**——写链真实存在且已核到底：`growth/scenario-grow.ts:98` → `scaffoldDraftIntent`(`growth/scaffold.ts:54`) → `catalog.createIntent`(`catalog/service.ts:139`) → `intents.insert`(`catalog/service.ts:159`)。错因是**只 grep 了 `intents.insert` 的直接调用方，漏了一层间接**（与本文档另外两处更正同一种病）。**真正的三个 🔴（均亲手核对 file:line）**：① **RBAC 不对称**——`/api/v1/growth/run`（`server.ts:235`）只有 `await auth(req)`，**无角色校验**；而人走正门建同一个对象 `POST /api/v1/catalog/packages/:packageId/intents`（`server.ts:512`）要 `requireRole(a,"catalog_admin")`（`:514`）→ **任何已登录用户都能让 AI 往目录里写 DRAFT 意图，人自己写反而要管理员**（缓解项：`createIntent` 恒落 `status:"DRAFT"`，DRAFT 不进分类候选，故污染有界——是**越权建草稿**，不是越权上线）；② **发布是 RBAC 直发、不在 R4 上**——`publishIntent`（`server.ts:530-532`）与 `publish-chain`（`server.ts:2507`·`requireCatalogAdmin` 于 `:2509`）都只查角色，注释虽写"经审批 R4"，实际**不经 Action 审批对象**，所以没有审批留痕/可追溯链；③ **没有审批面**——前端唯一碰生长回路的是 `components/Answer/GapCard.tsx`，它是**触发面**（「▶ 触发生成缺失数据」调 `/b/v1/growth/run`），**没有任何界面把 AI 建出的 DRAFT 意图列出来供人审**。**人工采纳率**：埋点在但 **跨租户混算**（`dc_action_submit_total` 标签只有 `{action_type,outcome}`，两租户合成一条曲线）且 `/metrics` **两服务均 200 无鉴权**（#65 实测）。**"人工改 20%→10% 后系统学习"这条通道确实不存在**（这半条原判成立） |

> ## 2026-08-09 逐条复验 · 本表两格的订正（`WO-DOCFIX-SKILL-CLAIMS`）
>
> 依据 `docs/CHECK-SPEC-AUT.md` §4。**原文一律保留在上表格子里，不抹掉** —— 抹掉就看不出「这里曾经骗过人」。
>
> ### 🔁 F9 · 第 ⑧ 层「`G-C08-EXPR-PARAM-SPLIT` 🔴 静默恒假」 —— **【反向过期·危害最大的一类】**
>
> **⛔ 读到这里请停一下**：这一条的危害不是"文档写错了"，而是**它会让下一个人去修一个已经修好的东西**。
> CLAUDE.md 铁律 0.5 记载的第三类错（把「接一条线」错报成「造一道门」）就是这个形态，本仓已真实发生过。
>
> **新事实：`params` 已经是 DSL 的一等操作数，且未声明时是抛错不是静默恒假**（`WO-RULE-EXPR-PARAMS` 已落地）：
>
> | 环节 | 证据 | 行为 |
> |---|---|---|
> | 词法/类型 | `apps/datacore/src/ruledsl.ts:39` `\| { kind: "param"; name: string }` | `params.<名>` 是**独立 operand 类型**，不再被当 field path |
> | 解析 | `ruledsl.ts:318-324` `return { kind: "param", name: path[1] }` | 必须恰好两段（`params` 裸用 / `params.a.b` 都不合法） |
> | 求值 | `ruledsl.ts:491-499` | 未在 `rule.params` 声明 ⇒ **`throw new DslError`**，注释原文：「诚实缺席：未声明的阈值**抛错**，不回退载荷、不取 0/undefined」 |
> | 发布期校验 | `ruledsl.ts:414-420 collectParamRefs` | 供「expression 引用的阈值 ⊆ rule.params 声明的阈值」校验 |
>
> 原文描述的那条病灶链（`resolveField` 返 undefined → `compare()` 两边非数 → 恒 false 无异常）
> **对 `params.x` 这个形态已不成立**。
>
> **仍然成立的那一半（别一起划掉）**：`kind:"field"` 拼错**仍会静默恒假** ——
> `resolveField` 带前缀回退，写错字段名不报错。⇒ 「解析期门」这件事只做了一半。
> 见 `docs/PRD-skill-migration.md` §1.5 G2 的同步订正。
>
> **复验（金丝雀：同文件 `grep -c "kind"` 应 =36；若金丝雀也 0 那是 grep 坏了）**：
> `grep -n "param" apps/datacore/src/ruledsl.ts` → `:39 / :318-324 / :414-420 / :491-499` 全部命中。
>
> ### ⚠️ F10 · 第 ⑪ 层「`outputSchema` **零消费方**」 —— 前半过期，后半仍成立
>
> **必须拆成两句说**，合成一句会把人引向错误的修法：
>
> | 原文的两半 | 今日复验 | 证据 |
> |---|---|---|
> | 「**零消费方**」 | **❌ 已过期** —— 有 **2 个** `src/` 生产消费方 | ① `apps/agentcore/src/skill-lint.ts:342` `validateJsonSchemaShape(skill.outputSchema, ...)`（只校验「是不是 JSON Schema 形状」）② `apps/agentcore/src/dril/resource-projector.ts:149` `outputSpec: s.outputSchema ? ioSpecFromJsonSchema(...)` → 投影给 DRIL 检索 |
> | 「没有任何地方拿它**校验实际输出**」 | **✅ 仍成立** | 答案形状仍由 `Answer.blocks[]` 自由生成，无一处拿 `outputSchema` 断言实际输出 |
>
> **形态定性**（照 CLAUDE.md 铁律 0.5 三分表）：不是「没接线」，是「**接了线接错地方**」——
> 线接上了，但接在 lint 与检索投影上，没接在输出校验上。**修法完全不同**。
>
> **危害**：「零消费方」会被下一个人读成「删了没影响」，而删掉会**断掉 DRIL 检索的 `outputSpec`**。
> 同时它也让 §4 的调整方向 3（「要么接消费方要么删」）看起来还没做，其实已经做了一半——
> **真正没做的是"拿它校验输出"这件事**。
>
> **复验**：`grep -n "outputSchema" apps/agentcore/src/skill-lint.ts apps/agentcore/src/dril/resource-projector.ts`
> （金丝雀：`grep -rn "outputSchema" apps/*/src packages/*/src | wc -l` = **11**）。

### 汇总

| 判定 | 层 |
|---|---|
| 🟢 有真物 | ⑨ Solver（唯一一项） |
| 🟡 有机制但 Skill 侧无声明 / 有缺陷 / 无消费方 | ① ③ ④ ⑤ ⑦ ⑧ ⑩ ⑪（八项） |
| 🔴 几乎全缺 | ② Business Intent · ⑥ Reasoning Graph · ⑫ Learning 闭环（三项） |

**结论**：12 层里**没有一层是从零开始**，但也**只有一层（求解器）算完整**。
绝大多数是「零件在仓里、但不归 Skill 管、也没人读」—— 这正是 Track E 的价值所在：
**不是造新东西，是把已有的零件收进一份可校验、可门控、自带验收的声明**。

### 三条最该先做（按"今天真在流血"排序）

1. **⑫ Learning 闭环的治理面（原稿定性有误，此处改正）** —— 原写「生长回路只报不写…系统自己知道缺什么却没有手去补」**是错的**：它**有手，而且这只手没戴手套**。写链已核到底（`scenario-grow.ts:98 → scaffoldDraftIntent → catalog.createIntent → intents.insert`），真正在流血的是**权限不对称**：`/api/v1/growth/run`（`server.ts:235`）只 `auth(req)` 无角色，人走正门建同一个对象却要 `catalog_admin`（`server.ts:514`）→ **任何已登录用户都能驱动 AI 往目录写 DRAFT**；发布侧（`server.ts:530`/`:2507`）是 **RBAC 直发不经 R4 Action 审批**（无留痕）；且**没有任何审批界面**列出 AI 建的草稿供人过目（`GapCard.tsx` 只是触发面）。缓解项：草稿恒 `DRAFT` 且不进分类候选，故污染有界。另埋点跨租户混算 + `/metrics` 裸奔，等于**采纳率这个最关键的治理指标今天是错的**（这半条原判成立）。
2. ~~**⑧ 规则 expression 引用 params** —— `G-C08-EXPR-PARAM-SPLIT` 会**静默恒假**。静默错答比跑不通更糟，这是本仓的一级红线。~~
   > 🔁 **2026-08-09 复验：【反向过期】这一条已经做完了 —— 照本表排期会把已完成项当"最该先做"**
   > （`docs/CHECK-SPEC-AUT.md` §4 **F9**）。**危害是挤占排期**：它会挤掉真正的缺口（本表第 1 条治理面、第 3 条 Business Intent）。
   > 详细订正见下文 §2 第 ⑧ 层表格的就地标注。**这一条从"最该先做"名单里划掉。**
3. **② Business Intent** —— 全缺，且它是 ①③④⑥⑪ 的语义前提（不知道服务谁、成功指标是什么，就无法判断输出契约该长什么样）。
   > ⚠️ **2026-08-09 复验：本条仍然成立**（`businessIntent` 全仓 0 命中，金丝雀 `SkillDefinitionSchema` = 7 命中）。
   > 第 2 条已划掉后，**本条与第 1 条并列为今天真正的两个头号缺口**。

> **诚实边界**：以上映射基于本会话实测与源码核对；标 🟡/🔴 的每一项都给了证据位置。
> 未逐项跑真部署验证（如 ERP/MES 连接器在真环境的可达性），那部分只据仓内代码判定。

---

## §3 · 语义修正（仓主）

**「意图」= 一种客户的需求场景**，不是技术意图。故：

```
场景入口  ──1:1──▶  意图（= 一种客户需求场景）  ──1:1──▶  Skill
                          |意图| ≥ |场景入口|
                          |Skill| ≥ |意图|
```

这条修正不是措辞问题，它改变 §1-② `Business Intent` 的地位：**意图本身就是业务需求场景**，
于是"用户角色 / 决策场景 / 触发条件 / KPI"不再是 Skill 的可选装饰，而是**意图的定义本身**。
今天意图只有 `description`/`examples`/`slots` —— 即目录里存的是**技术触发条件**，不是**客户需求场景**。
这是 §2 把 ② 判为 🔴 的更深原因。

---

## §4 · 现有 7 个 Skill 的达标度实测（仓主：「目前的 skill 未达到工业级要求，需要调整」）

**实测（跑 `seedRegistry()`，非 grep）**：

```
capacity_analysis        body= 484字  resources=0  有值字段 7/9
sop_meeting              body= 403字  resources=0  有值字段 7/9
risk_analysis            body= 387字  resources=0  有值字段 7/9
supply_chain_mgmt        body= 415字  resources=0  有值字段 7/9
quality_control          body= 387字  resources=0  有值字段 7/9
mcp_integration          body= 522字  resources=0  有值字段 6/9
capacity_action_draft    body= 493字  resources=0  有值字段 7/9
```
已填：`capability` · `sideEffect` · `inputSchema` · `outputSchema` · `references` · `approvalGate` · `provenancePolicy`
未填：**`dependsOn`（7/7 全空）** · **`maxBudgetRounds`（7/7 全空）**

**结论：差距不在"字段没填"（骨架填了 78%），而在下面五条 —— 每条都比缺字段严重。**

| # | 真差距 | 证据 | 为什么比缺字段严重 |
|---|---|---|---|
| **D1** | **与意图零绑定** | 7 Skill vs 32 意图；意图绑的是 `ExecutionPlan`（32/32），**没有任何 intent→skill 的引用** | 仓主要求的 `意图 1:1 Skill` **今天一条都不成立**。这不是"少 25 个"，是**这条边根本不存在** |
| **D2** | **body 平均 441 字 ≈ 一段话** | 上表实测（契约上限 50,000 字，用了 0.9%） | 工业级 Skill 的 body 要装 §1-⑥ Reasoning Graph + §1-⑧ 约束说明；441 字装不下，说明今天的 body 是"角色设定"不是"推理逻辑" |
| **D3** | **`resources` 7/7 全空** | 上表实测 | §1-③ 本体绑定、§1-④ 数据来源、§1-⑧ 规则清单本该挂在这里；全空 = 这三层在 Skill 侧**零落地** |
| **D4** | **`maxBudgetRounds` 7/7 全空 · 且零消费方** | 上表实测 + 全仓无读取点 | **这正是 203 s 的成因之一**（探索预算是全局常数不分题型）。字段早在、值没填、也没人读 —— **#92 同族三连** |
| **D5** | **`outputSchema` 有值但零消费方** | §2-⑪ | 声明了输出形状却不拿它校验实际输出 = 又一处「声明了没接线」（#90 同族）。**填了字段却没有消费方，比不填更危险**——它让人以为这件事做过了 |

**调整方向（与 Track E 迁移合并执行）**

1. **先建边，再补量**：`意图 → Skill` 这条引用必须先存在（D1），否则补再多 Skill 也不落到查询链上。
2. **`maxBudgetRounds` 必须同时"填值 + 接消费方"**：Track E 验收已写死 —— 改 Skill 里的这个数，
   该类题的**实际探索轮次要真变**（效果层），只读出来不算。
3. **`outputSchema` 要么接消费方要么删**：留着一个不校验的形状声明 = 制造"这件事做过了"的错觉。
4. **body 的扩容不是写更多字**，是把今天散在 navSlice/DRIL/角色画像三处的推理与资源声明**搬进来**（§2-③⑥⑦⑧）。
5. **`dependsOn` 用于表达 Skill 间复用**（如"产能预测"依赖"物料齐套"），这是 |Skill| > |意图| 的正当来源之一
   —— 超出的那部分 Skill 是**被复用的子能力**，不是多余的重复声明。

---

## §5 · 引用而非内联（仓主定案 · 解 C1/C2/C5）

> 仓主原话：「在 skill 里面引用规则，引用求解器，引用其他资源，而不是把规则写死在 skill 里面，
> 否则规则变化了，就无需修改所有 skill 的内容。」

**这条原则在本仓已有先例**：WO-76 的 `boundary-singlesource` 门守的正是「基地集必须从
`BASE_REGISTRY` 派生、不许内联字面量」（实测抓出 9 处真漂移）；而 C08「外协红线 20% vs 30%
三个消费方打架」正是**同一条约束被内联在多处**的后果。**故本条不是新规矩，是把已有铁律推广到 Skill 层。**

### 形态

```yaml
skill:
  rules:       ["C03", "C09", "C18"]       # 引用 key·规则本体留在 ruledsl 注册表（唯一权威）
  solvers:     ["capacity_forecast"]       # 引用 key·数学约束留在求解器实现里
  slices:      ["model_capacity_network"]
  objectTypes: ["Model", "Base", "Line"]
  tools:       ["invoke_solver", "query_objects"]
  mcp:         ["mes.query"]
  dependsOn:   ["material_kitting_skill"]  # 引用其他 skill（|Skill| > |意图| 的正当来源）
```

### 直接解掉的三处撞车

| 撞车 | 如何消解 |
|---|---|
| **C1** PRD §9.7 Rule DSL vs 既有 `ruledsl.ts` + 28 条规则 | **不引入第二套规则语法**。Skill 只列 rule key，规则本体与语法保持 `ruledsl.ts` 唯一权威。（既有的 `G-C08-EXPR-PARAM-SPLIT` 🔴 仍须单独修——它是既有引擎的实缺，与本条无关） |
| **C2** PRD §9.8 Constraint DSL vs §9.9 Solver DSL | **约束只在求解器里定义一次**，Skill 只说用哪个求解器。同一条约束不再有两处声明 |
| **C5** Agent / MCP Tool / Workflow / Human Node | **全部是引用**（`AgentDefinition`/30 工具+MCP/`workflow` 定义/Action `approvalChain` 均已存在）。PRD 若按"新建定义"写会造重复 |

### 必配硬门：引用可校验（否则引用退化成空指针）

加门断言**每个被引用的 key 真的已注册**：rule key ∈ `RULES` · solver key ∈ 求解器注册表 ·
objectType ∈ 已发布本体 · tool ∈ `tools/registry.ts` · dependsOn ∈ skills。
~~**这道门今天做不了**（无任何一处声明），有引用清单后才成为可能 —— 是本条设计的**直接新增能力**，不是附带好处。~~

> ## 🔁 2026-08-09 复验：**【反向过期 · 最高危害】这道门已经建好了，5 项里 4 项已生效**
>
> 依据 `docs/CHECK-SPEC-AUT.md` §4 **F8** + `docs/CHECK-DSL-CMP.md` §5 **X-03/X-04**。
>
> **⛔ 照上面那句划掉的原文去排期，会重复造一道已经存在的门。**
> 这正是 CLAUDE.md 铁律 0.5「来历」第 ③ 条记载的错误形态（把「接一条线」错报成「造一道门」，
> **当时直接把工作量估歪、排期歪掉**）。它今天在本文里原样复发了一次 —— 所以这条订正必须最醒目。
>
> ### 5 项硬门的今日真实状态（逐项，不许合成一句）
>
> | # | 断言 | 状态 | 证据 · 追到的触发条件 |
> |---|---|---|---|
> | 1 | **rule key ∈ 规则库** | ✅ **已生效** | `apps/agentcore/src/server.ts:1268` 抽 `refRuleKeys` → `:1272 probeMissingRefs` → `apps/agentcore/src/resources.ts:64`。不存在 ⇒ `422 SKILL_REF_UNRESOLVED`（`server.ts:1279`） |
> | 2 | **solver key ∈ 求解器注册表** | ✅ **已生效** | 同上，`server.ts:1267` 抽 `refSolverKeys` |
> | 3 | **objectType ∈ 已发布本体** | ✅ **已生效** | 同上，`server.ts:1269` 抽 `refObjectTypes` |
> | 4 | **dependsOn ∈ skills** | ✅ **已生效**（本地解析，非跨系统探针） | `apps/agentcore/src/skill-lint.ts:218` `if (ref.kind !== "skill") continue;` + `:347/348 validateRefResolution`；发布路真传 `allSkills` 与 `requirePublishedDeps:true`（`server.ts:1251`） |
> | 5 | **tool ∈ `tools/registry.ts`** | 🔗 **只做了一半** | **不是引用清单校验**（`SKILL_REFERENCE_KINDS` 里**根本没有 `tool` 这个 kind**），而是 lint 从 **body 正文文本**里正则抓工具名反查（`skill-lint.ts:329-338`）。匹配形态仅「调用 \`x_y\`」「\`x_y\` 工具」两种 ⇒ **覆盖窄，且换个写法就绕过去了** |
>
> ### 这道门的三条关键性质（都不是附带的，落地时逐条守住了）
>
> 1. **fail-closed**：注册表读不出来或返回空集 ⇒ 抛 `503 REF_PROBE_UNAVAILABLE`（`resources.ts:59-68`），
>    **不是静默放行**。旧实现两层 fail-open 已关死。判据原文：「**我没找到 ≠ 它不存在**」。
> 2. **拦在落库之前**：探针在 `repos.skills.update` 之前，拒发布 = **未落库**。
> 3. **`force` 不豁免**：`force` 豁免的是**质量门**（lint 没写好 / 用例没补齐），
>    而死路引用是**事实错误** —— 审计签字不能让一个不存在的求解器变成存在。
>
> ### 仍然没有的那部分（**这才是真缺口，排期请对准这里**）
>
> - `SKILL_REFERENCE_KINDS` 8 个 kind 里，探针只覆盖 **solver / rule / ontologyType** 三种；
>   **`constraint` / `slice` / `workflow` / `agent` 四种今天仍无人校验** ——
>   `apps/agentcore/src/skill-lint.ts:215-217` 的注释自己写明了这一点。
>   其中 `constraint` 属 `docs/PRD-skill-runtime-orchestrator.md` §8.3 明令禁止的
>   「**校验不了但看起来能校验**」状态（见该文同日订正）。
> - **`tool` / `mcp` 两个 kind 根本不在词表里** ⇒ 第 5 项不是"门没接"，是"**声明不了**"。
> - 出厂 7 个 Skill **走旁门直插仓储**（`apps/agentcore/src/main.ts:29`），**门够不着它们** ——
>   「没有存量被挡」不等于「存量干净」（同一事实见 `docs/PRD-skill-compiler-registry.md` §14.4-1 的 **X-12** 订正）。
>
> **复验（别信本段，亲手跑）**：
> ```bash
> grep -n "probeMissingRefs" apps/agentcore/src/server.ts   # 应见 694(agent) / 1012(workflow) / 1272(skill) 三处
> node scripts/check-ref-closure.mjs                         # RC=0；摘掉 skill 那行探针 → 该门当场红
> ```

### 反向收益（比正向更值钱）

有了引用，**「改 C08 会影响哪些 Skill」变成一次查询**。今天回答这个问题只能 grep，
而 grep 会骗人（本会话已两次据 grep 下错定性、靠真跑纠正）。
这正是系统本体存在的理由（"改 X 会影响什么"）—— **引用清单等于让 Skill 层也进了本体的可追溯图**。

### 边界判据：哪些引用、哪些内联

> **判据：这个东西变了，是所有用它的 Skill 都该跟着变（→ 引用），还是只有这一个 Skill 该变（→ 内联）？**

| 引用（可复用资源） | 内联（本 Skill 独有语义） |
|---|---|
| 规则 C01–C33 | Business Intent（用户角色 / 决策场景 / KPI） |
| 求解器 + 其数学约束 | `maxBudgetRounds`（这类题给几轮） |
| 本体对象类型 / 切片 | Reasoning Graph 拓扑 |
| 工具 / MCP | `provenancePolicy`（这类题要不要强制出处） |
| 其他 Skill（`dependsOn`） | `antiExamples`（这类问句不归我） |

**防另一个极端**：没有这条判据，会走到"什么都引用、Skill 变成空壳"。内联那一列是 Skill 的**本体**。

### 对升级路径的影响

Phase 0 的「自动导出」因此**更机械**：导出的是**引用清单**（solver key / rule key / objectType 名），
今天都能从 `navSlice` 投影与 plan steps 直接读出，**不需要理解语义**。

> ⚠️ **2026-08-09：上一段的「Phase 0」是 C5 改名后的残留裸 Phase**（`docs/CHECK-MIG-XR.md` §5-2）。
> `docs/PRD-skill-crossreview.md` §9 的 **C5 行标 ✅** 并宣称「两份 PRD 均已全文替换…**残留裸「Phase N」= 0**（机械核过）」——
> 该断言**对两份 PRD 成立**，但**同批一起改的本文（SPEC）没被扫到**：本文今天仍有 **2 处**裸 Phase
> （本节的「Phase 0」·§2 第 ⑥ 层表格的「Track A Phase 4」）。
> **形态**：「我用『两份 PRD 扫描为 0』当作『裸 Phase 已清零』的证据，而前者并不度量后者」——
> **「机械核过」的扫描范围小于读者会理解的范围**，这正是 CLAUDE.md 铁律 0.6 要治的病。
> **按 C5 的命名空间**：迁移线 = `M0–M3` · 路由线（Track A）= `R0–R4` · 运行时线 = `T1–T2`。
> 本处的「Phase 0」指**迁移线的自动导出期**，应读作 **`M0`**。
> **复验（含金丝雀，2026-08-09 实测）**：
> ```
> grep -c "Phase [0-9]" docs/PRD-skill-migration.md            → 0   ← C5 宣称的两份之一，属实
> grep -c "Phase [0-9]" docs/PRD-skill-runtime-orchestrator.md → 0   ← C5 宣称的两份之二，属实
> grep -c "Phase [0-9]" docs/SPEC-industrial-skill.md          → 2   ← 同批改的第三份，漏扫
> grep -c "Phase [0-9]" docs/PRD-skill-crossreview.md          → 6   ← 全在 §5 讨论「Phase 2 三义」本身，属**元讨论非残留**，不计
> ```
> 最后一行是**金丝雀救场**：如果只看数字会以为 crossreview 也漏了 6 处 ——
> 点开看才知道那是在讨论这个词本身。**「命中」不等于「违规」，计数前必须点开看一眼。**
真正需要人填的缩小到"内联"那一列，其中大头是 Business Intent 四字段。

---

## §6 · Skill 开发模板（仓主给定 · 包结构）与「读作引用」的落地口径

仓主给定的工业级 Skill 开发模板：一个 Skill 不是一个 YAML，而是**一个完整软件包**。

```
skill_package/
├── skill.yaml                  # Skill 主定义
├── metadata.yaml               # 元数据（business_owner / target_users / business_value / frequency）
├── ontology/{objects,relations,events}.yaml
├── context/{context,memory}.yaml
├── reasoning/{graph.yaml, prompts/, strategies.yaml}
├── agents/{agents,roles}.yaml
├── tools/{mcp,api}.yaml
├── rules/{business_rules,constraints}.yaml
├── solver/{solver.yaml, model.lp}
├── workflow/workflow.yaml
├── evaluation/{metrics,testcases}.yaml
├── output/schema.yaml
└── README.md
```

### ⚠ 落地口径（仓主确认：**目标一致，都是引用模式，不是写死模式**）

模板里 `rules/business_rules.yaml` 的 `condition:`/`action:`、`rules/constraints.yaml` 的 `formula:`、
`ontology/objects.yaml` 的 `properties:`、`tools/mcp.yaml` 的 `input/output:` —— **写法看起来像定义**。

**统一口径：一律读作「引用 + 需求声明」，不得实现成「在 Skill 包内定义」。**
仓主已确认目标是引用模式；此口径写在这里是为了**防实现时走样**——本仓今天整天在修的病，
标准形状正是「原则定了、下游没跟」。

| 模板文件 | ❌ 不得实现成 | ✅ 必须实现成 | 权威在哪 |
|---|---|---|---|
| `rules/business_rules.yaml` | 在包内定义规则语法 | 列 rule key（`["C03","C09"]`）+ 声明所需前置（如"必须已 PUBLISHED"） | `ruledsl.ts` + C01–C33 |
| `rules/constraints.yaml` | 在包内定义数学约束 | 声明所依赖求解器的约束集须包含哪些 | 求解器实现 |
| `ontology/objects.yaml` | 在包内定义对象与属性 | 声明**所需**对象类型及其**必需属性**（契约式：`Factory` 须有 `capacity`） | 已发布本体（91 类型 / 771 属性） |
| `ontology/relations.yaml` | 定义关系 | 声明所需关系（`Factory -HAS_LINE-> Line` 须存在） | `ontology_links` / `links` |
| `tools/mcp.yaml` | 定义工具 schema | 列 tool key + 所需能力 | `tools/registry.ts`（30 个）+ MCP 配置 |
| `agents/agents.yaml` | 定义 agent | 列 agentId + 所需 scope | `AgentDefinition` / 角色画像 |
| `workflow/workflow.yaml` | 定义工作流引擎语义 | 列 step 引用（skill / solver / agent / approval） | `workflow/executor.ts` + Action `approvalChain` |
| `solver/solver.yaml` | — | 列 solver key + **本 Skill 专属的 objective/权重**（这部分是内联，见 §5 判据） | 求解器注册表（57 个） |

**配套硬门（§5 已定）**：装载/发布时校验**每个被引用的 key 真已注册**；不满足则**拒绝安装**，
而非带着自己那份定义偷偷跑。这道门今天做不了（无任何声明），有引用清单后才成为可能。

### 模板里仓内完全没有、且值得直接采纳的四项

| 模板项 | 价值 | 今天状态 |
|---|---|---|
| `evaluation/testcases.yaml` | **与 §2-⑧「自带验收」完全一致**。skill 自带用例 → **门可从注册表生成**，新增 skill 自动被测、漏配即红，「金标集与目录漂移」问题从此不存在 | 无。今天测措辞鲁棒性要在测试文件手写 80 条并特意从 catalog 派生防漂移 |
| `reasoning/prompts/*.md` **独立文件** | 今天 7 个 skill 的 `body` 平均 **441 字**（上限 50,000·用了 0.9%）——塞在单一字符串字段里没人愿意写长。拆文件才写得下 Reasoning Graph 与约束说明 | 无 |
| `ontology/events.yaml` | **今天完全没有的一层**：skill 声明"我发哪些事件、消费哪些事件"。仓里有领域事件 + 失效钩子，但没有任何一处声明"谁发谁收" | 无 |
| §17 **发布检查清单** | 可直接升格成发布门。仓里 `publishIntent` 有校验（plan refs / render_answer 须最后 / slots 非空），但**没有**"推理图无环 / 异常路径已定义 / 审批节点已配 / Tool 权限已控" | 部分 |

### 现成接线点：包文件 → `SkillDefinitionSchema.resources[]`

模板的多文件包结构**天然映射到既有 `resources[]`**（`SkillAttachment`，带 mime/description，
agent 经 `read_skill_resource` 渐进披露）。该字段今天 **7/7 全空**。
**故不需要新造承载机制** —— 包里每个文件就是一条 resource。

---

## §7 · 两项定案（仓主）

### 定案 1 · `requires` 改造 —— **采纳**

包内四类文件一律改为**需求声明**（`requires`），不得实现成定义：

```
skill_package/
├── ontology/requires.yaml   # 我需要 Factory，且它必须有 capacity 属性
├── rules/requires.yaml      # 我需要 C03、C09，且必须已 PUBLISHED
├── tools/requires.yaml      # 我需要 invoke_solver、mes.query
└── solver/requires.yaml     # 我需要 capacity_forecast
```

**`requires` 是契约，不是副本。** 装载/发布时一道门校验宿主系统是否满足；
**不满足则拒绝安装**，而不是带着自己那份定义偷偷跑。

两个目标由此同时成立：**包自足可分发**（完整声明依赖）+ **定义单一真源**（规则/本体/工具/求解器各只有一处）。

### 定案 2 · `solver/model.lp` —— **求解器引用 + 参数内联，不带独立模型文件**

```yaml
solver:
  ref: capacity_forecast          # 引用已注册求解器（57 个之一）
  objective:                       # ← 本 Skill 专属·内联
    maximize: [delivery_rate, profit]
  weights: { delivery_rate: 0.7, profit: 0.3 }
```

**理由**：不同 Skill 可以用同一求解器但不同目标函数 —— 目标/权重是 Skill 专属语义（符合 §5 判据：
"变了只有这一个 Skill 该变"），故**内联**；而求解器本身（引擎、变量、结构性约束）是共享资源，故**引用**。

**明确排除**：包内不带独立 `.lp` / `.mps` 等模型文件。**带模型文件等于绕过求解器注册表自带一个引擎** ——
那会让「哪个数学模型在跑」失去单一真源，且脱离 `SOLVER_ARGS_SCHEMAS` 的入参校验与
求解器注册表的可发现性（`discover(kind=solvers)` / DRIL 检索都看不见它）。

> **诚实边界**：此定案覆盖"同引擎不同目标"这一主流用法。
> 若将来出现**真正需要自带模型结构**的 Skill（新变量族/新约束族），
> 正解是**向求解器注册表新增一个求解器**并被引用，而不是在 Skill 包里夹带模型文件。

---

## §8 · Skill SDK + Runtime API（仓主给定 V1.0）与对照

**SDK 模块**：Skill CLI · DSL Parser · Ontology SDK · Agent SDK · MCP SDK · Rule SDK · Solver SDK ·
Workflow SDK · Test SDK · Deploy SDK
**CLI**：`dos skill create|validate|compile|test|package|deploy`
**编译**：DSL → Parser → AST → Validator → Optimizer → Execution Graph → Runtime Package
**Runtime 链**：请求 → Intent 识别 → Skill 匹配 → Context 加载 → Ontology 查询 → Agent 推理 →
Tool 调用 → Rule 校验 → Solver 计算 → Workflow 执行 → 输出 → Memory 更新

### ⚠ 头号风险：**API 面重复** —— 12 组 API 里多数在仓里已有对应端点

| SDK 规格 API | 仓里已有 | 若各建一套的后果 |
|---|---|---|
| `/api/v1/ontology/object/{type}/{id}` | DataCore `/a/v1/ontology/*`（91 类型 / 11,087 对象） | 两条本体读路径，权限/租户过滤各判一次 |
| `/api/v1/mcp/register` · `/invoke` | B3 MCP（配置 + 调用已通） | 工具注册两处 |
| `/api/v1/solver/run` | `/b/v1/solvers/{key}/run`（57 求解器·**D1 刚接通取消**） | 取消/超时语义要维护两份 |
| `/api/v1/rule/evaluate` | `evaluate_rules` 工具 + `ruledsl.ts`（28 条） | 规则两处解释 |
| `/api/v1/workflow/start` · `/{id}` | `workflow/executor.ts` + Action `approvalChain` | 流程状态两处 |
| `/api/v1/context/query` | `conversationSummary` + DRIL 组包 | 上下文两处 |
| `/api/v1/agent/task` | `/api/v1/queries` + `runRegisteredAgent` | agent 入口两处 |
| `/api/v1/evaluation/feedback` | `EvalService` + `ActionMetrics` | 评价两处（且现有指标**跨租户混算**·`/metrics` **裸奔 200**） |

> **建议**：SDK 的 API 面按「**新增薄层 + 复用既有端点**」实现 —— Skill 层的 Registry/Compiler/
> Orchestrator/Package 是真新增；Ontology/MCP/Rule/Solver/Workflow/Context/Agent **一律代理到既有端点**，
> 不另起实现。理由与 §5 同：**同一能力两处实现 = 两处会漂**。

### 真新增（仓里完全没有，值得做）

| SDK 项 | 价值 | 今天状态 |
|---|---|---|
| **Skill CLI**（create/validate/compile/test/package/deploy） | 把"写 Skill"变成有工具链的工程活动 | 无 |
| **Skill Compiler**（AST/Validator/Optimizer） | 发布前静态校验（引用是否存在、推理图有无环） | 无 |
| **`.skill` 包 + `manifest.json` + `signature/`** | **包签名**是 Marketplace 分发的前提 | 无 |
| **Manifest `runtime: ">=2.0"` + `dependencies`** | 运行时兼容性声明 —— 与 §2-① 的 `supersedes` 互补 | 无（Skill 有 version 无 runtime 约束） |
| **Skill Orchestrator API**（Skill Graph） | 多 Skill 编排 | 无 |
| **Permission：data / tool / action 三面** | **per-Skill 的工具与动作权限** | 🔴 **真缺口**。今天有 A6 行级 + entitlement + RBAC，但**没有"这个 Skill 能用哪些工具、能发哪些 Action"** |
| **Execution Trace（含 Prompt Version）** | 可复盘 | 🟡 有 events + provenance + agentRuns，但**Prompt 无版本**——今天 prompt 在代码里，改了无从追溯 |
| **§24 生命周期角色**（业务分析师→Skill 设计师→本体工程师→AI 工程师） | 组织分工 | 无对应角色（今天只有 admin/planner/catalog_admin/base_manager） |

### 两处必须先解决的前置（否则 SDK 建在流沙上）

1. **`/api/v1/evaluation/feedback` → Learning Loop**：依赖的「人工采纳率」今天**跨租户混算**
   （`dc_action_submit_total` 标签仅 `{action_type,outcome}`）且 `/metrics` **两服务均 200 无鉴权**。
   **在错的指标上建学习闭环，学到的也是错的。**
2. **Runtime 链的「Intent 识别 → Skill 匹配」**：顺序正确，**但仓里分类器排第 11 站、前有 10 道正则门抢答**
   （Track A 的病根）。不拆门，新 Runtime 照样被劫持 —— SDK 规格未提及这一层。

---

## §9 三项定案（仓主 2026-08-03 拍板）+ 推理图落位

### 9.1 定案 3 · `requires` 改名偏离 —— **采纳 `requires`，旧名降为解析期别名**

仓主已批「采纳」。落地口径（防止又变成两套活词表）：

- **运行时唯一真源 = `skill.requires.{objectTypes, relations, slices, rules, solvers, tools, mcp, workflows, agents, dependsOn}`**，
  每条带 `required` / `minStatus` / `properties[]`（contract PRD §4.5 的形状）。
- **`references[]` / `dependsOn[]` 保留为「解析期输入别名」**：读入即归一折进 `requires`，
  **不作为运行时字段存在**。既不破坏 7 个存量 Skill 与 `skill-lint.ts:212/302`、
  `resource-projector.ts:334` 的现有读取，也不产生第二套**活的**词表（别名是入口，不是真源）。
- **migration PRD §10.3 的偏离理由不成立，已核**：`FeatureDef.requires`（`packages/contracts/src/features.ts:15`）
  确实存在，但那是**另一个对象的字段**，不是顶层导出撞车——与 `ExecutionPlanSchema` 那次
  （真·同命名空间导出冲突，故 `execution-plan.ts:6-7` 改名 ComposePlan）**性质不同**，先例不适用。
- **更要紧的是表达力**：扁平 `references[]`（`{kind,key}`）**表达不了**
  「Factory 必须有 capacity 属性」「rule 必须已 PUBLISHED」——
  而这正是定案 1「`requires` 是契约、装载期校验、不满足拒装」的核心。
  照 migration 写法，**定案 1 的语义落不了地**。
- **连带**：contract 的 `skill-refs:check` 与 migration 的 `skill-ref-closure:check` 是同一道门，
  **合并为一道 `skill-refs:check`**。

### 9.2 定案 4 · Business Intent 口径 —— **内部元数据（加固版）**

定为**内部元数据**，不作对外交付物。理由与加固措施：

- 对外交付物意味着要为它做**呈现、翻译、版本对外可见**——今天 32 个意图**一个都还没填**，
  先立对外承诺 = 立刻欠 32 笔债。
- 但「内部」不等于「可以糊弄」。加固三件（缺一即回潮）：
  ① **契约上必填**，允许值为显式哨兵 `{ status: "TODO", owner: "<待指派>" }`——
     **不允许缺省为空**（空字段会被下一个人读成"这题不需要"）；
  ② **棘轮门** `skill-business-intent:check`：TODO 数**只许降不许升**
     （同 `scripts/debattery-baseline.json` 模式），基线在 Phase M0 结束时 = 32；
  ③ **哨兵不得进发布**：`status:"TODO"` 的 Skill 可存在、可测试，**不可 PUBLISHED**。
- 证据支撑「必须上棘轮」：本仓"以后再填"的历史成功率极低——
  7 个既有 Skill 的 `dependsOn` **7/7 空**、`maxBudgetRounds` **7/7 空**。

### 9.3 定案 5 · `body` 上限 3,000 —— **不放开**

**实测（本会话现算，非引述）**：7 个 Skill 的 body 长度 最长 **522** / 中位 **415** / 最短 **387**，
**最长仅占上限 17.4%，超限 0 个**。上限**今天根本不构成约束**——放开一个不生效的上限，
零收益、纯风险。

更关键：`skill-lint.ts:260` 超限时的报错原文是
> 「body 超 3000 字——**将静态数据块下沉至 resource**」

**这道 lint 已经把「引用而非内联」写进错误信息里了**。放开上限 = 把这句话作废，
等于官方批准「把推理图写成散文塞进 body」。

> 注：契约层 `SkillDefinitionSchema.body` 是 `z.string().max(50_000)`（`agentcore.ts:243`），
> lint 的 3,000 是**更严的治理线**。两者不冲突：契约管"存得下"，lint 管"该不该这么写"。

**真正该做的不是放开 body，而是给结构化字段配预算**（见 §9.4）。

### 9.4 推理图落位 —— **它一半就该是引用，而且不该进 body**

**先澄清事实**：推理图**今天不在 body 里，因为它今天根本不存在**——
12 层里 🔴 全缺的三层之一（§2-⑥）。compiler PRD 把 `SkillReasoningGraph` 定为**编译产物**，
但**没说清它运行时存在哪、怎么进提示词**。仓主这一问正好把这个缺口钉死。

**用仓主自己的判据（§5）逐部件拆**——「这个东西变了，是所有用它的 Skill 都该跟着变（→引用），
还是只有这一个 Skill 该变（→内联）」：

| 部件 | 变了谁跟着变 | 结论 |
|---|---|---|
| **图的骨架**（这道题分几步、在哪分支、汇流点在哪、异常路径走哪） | 只有这个 Skill | **内联**——但必须是**结构化字段**，**不是 body 散文** |
| **节点指向的资源**（solver / rule / slice / objectType / tool） | 所有用它的 Skill 都跟着变 | **引用**（`requires`）——改 C08 红线，所有引它的图自动跟着变 |
| **可复用子图**（如「产能瓶颈归因」被多个 Skill 复用） | 所有用它的 Skill 都跟着变 | **引用**——提升为独立可寻址资源。**判据：被 ≥2 个 Skill 用即提升** |

**所以「为何不是引用模式」的答案是：它一半就该是引用模式，是 PRD 没拆开说。**
骨架内联 + 资源引用 + 可复用子图提升为引用——三层各按判据走，不是二选一。

**至于「进提示词的方式」——仓主提的目录+按需读取是对的，而且机制已经有了，不用新造。**

已核实：同一模式**在 Skill 这一层已经在跑**——
`buildSkillSection`（`apps/agentcore/src/agent/prompts.ts:69`）只把 top-k 注入全文，
其余降级为 `[id]名`（`:75`），模型需要时调 `load_skill(skillId)` 取全文
（`skill-router.ts:9/69` 注释即写「保留渐进式披露」）。

**把同一模式下推一级即可**：

```
提示词里（每轮都读）  : 图目录 —— 节点 id + 一行意图 + 分支条件
                        （够模型判断"这题该往哪走"，不够它照着执行）
按需拉取（走到才读）  : load_reasoning_node(nodeId) → 该节点全文
                        （复用 load_skill 的同一机制，不新造工具族）
永不读                : 没走到的分支 —— 一个 token 都不烧
```

**为什么这比"省 token"重要得多**：参照 203 秒那次实测——三段 LLM 烧掉 60s/82s/60s，
而真正有效的计算 `invoke_solver` 只有 **527ms = 0.26%**。
把所有分支的推理全文每轮塞进提示词，不只是浪费预算，
**是给模型更多可以走偏的地面**。没走到的分支不该出现在视野里。

**配套的门（否则又是"声明了没接线"）**：

1. `skill-graph:check`（静态）——图必须是 DAG、无孤儿节点、每个 `solverRef`/`ruleRef` 在 `requires` 里可解析。
   **散文进不了这道门，结构化字段才进得来**——这正是不许把图塞 body 的机械理由。
2. **索引预算**：图目录进提示词的部分单独设上限（建议每节点 ≤80 字），
   与 body 的 3,000 **分开计**——两个预算管两件事，混在一起必然互相挤。
3. **效果层判据**（不接受运输层断言）：删掉某分支节点 → 该分支的问句**答案真的变**；
   只断言"节点加载了"不算过。

