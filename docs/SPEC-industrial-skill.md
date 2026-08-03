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
| 6 | **Reasoning Logic** | 🔴 **是线性步骤，不是图** | `ExecutionPlan.steps[]` 1–12 步（`resolve_slice`→`invoke_solver`→`evaluate_rules`→`render_answer`） | **无 Reasoning Graph**。今天是**线性管线**，不能表达"瓶颈识别的结果决定要不要走扩产建议"这类**条件分支/汇流**。探索态则相反 —— 完全自由 ReAct，无强制序（Track A Phase 4 要治） |
| 7 | **Tool / MCP Binding** | 🟡 **有物无声明** | 30 个工具（`tools/registry.ts`）+ MCP 配置（B3） | Skill 不声明自己用哪些工具 → 今天 agent 首轮**注入全部 30 个 schema**（Track B4 要按 DRIL 预选裁剪）。另 **`discover` 的 kind 无 `intents`**（E7）—— agent 按提示"先 discover"时看不见意图池 |
| 8 | **Rule & Constraint** | 🟡 **引擎在·绑定缺·且有真缺陷** | 规则 DSL（`ruledsl.ts`）+ 28 条业务规则（C01–C33）+ `RULE_PARAM_BINDINGS` 投影 | Skill 不声明绑哪些规则。**且规则引擎自身有实缺**：`G-C08-EXPR-PARAM-SPLIT` 🔴 —— DSL 的 expression **不能引用 params**，写 `params.cashFloor` 会被当 field path、双 undefined → **静默恒假不报错**（C09/C18/C21 同病）。改 params 不改规则判定 |
| 9 | **Solver Integration** | 🟢 **有真物** | 57 个注册求解器 + CP-SAT sidecar（`services/optimizer`）+ `SOLVER_ARGS_SCHEMAS` | Skill 不声明绑哪个 solver / objective / constraints。**sidecar 无取消接口**（D1 已查实：`ThreadingHTTPServer`，不感知客户端断开——我们取消的是"调用"不是"求解进程"） |
| 10 | **Workflow Execution** | 🟡 **有物·但审批与 Skill 不连** | `workflow/executor.ts`（**串行 for…await·无 `Promise.all`** ← E5：三角色 203s 的成因）+ Action 审批链（`approvalChain` 1–3 级） | Skill 无 workflow 绑定。**长流程里的"专家审核/审批"今天只在 Action 层有**，Skill 层不声明"我这一步需要人审"。另 `采纳经营方案` 仍是唯一 `NOT_IMPLEMENTED` 的 ActionType（#81） |
| 11 | **Output Contract** | 🟡 **有形无约束** | Skill 有 `outputSchema`（可选）；答案是 `blocks[] + provenance[] + trustLevel + unverifiedNumerics` | `outputSchema` **零消费方** —— 没有任何地方拿它校验实际输出。**结构化决策（risk[]/recommendation[]）今天靠 LLM 自由生成 blocks**，不受 schema 约束 |
| 12 | **Governance & Learning** | 🔴 **有传感器·无执行器** | Evaluation：`EvalService` 在；埋点 `ActionMetrics` 在<br>Feedback：`growth/probe.ts` 能精确判出 `NO_INTENT` 并给 `suggestedFill` | **闭环断在最后一步**：全仓 `intents.insert` 调用点里**没有生长回路** —— 它只报缺口，从不建意图（E8）。**人工采纳率**：埋点在但 **跨租户混算**（`dc_action_submit_total` 标签只有 `{action_type,outcome}`，两租户合成一条曲线）且 `/metrics` **两服务均 200 无鉴权**（#65 实测）。**"人工改 20%→10% 后系统学习"这条通道完全不存在** |

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

1. **⑫ Learning 闭环的最后一步** —— 生长回路只报不写，是全系统唯一一处「系统自己知道缺什么，却没有手去补」。而且埋点跨租户混算 + `/metrics` 裸奔，等于**采纳率这个最关键的治理指标今天是错的**。
2. **⑧ 规则 expression 引用 params** —— `G-C08-EXPR-PARAM-SPLIT` 会**静默恒假**。静默错答比跑不通更糟，这是本仓的一级红线。
3. **② Business Intent** —— 全缺，且它是 ①③④⑥⑪ 的语义前提（不知道服务谁、成功指标是什么，就无法判断输出契约该长什么样）。

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
**这道门今天做不了**（无任何一处声明），有引用清单后才成为可能 —— 是本条设计的**直接新增能力**，不是附带好处。

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
