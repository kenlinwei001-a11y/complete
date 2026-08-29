# PRD · Agent ReAct Harness 与「理解-计划-分解-执行-反思」推理闭环

> **这份 PRD 解决的是"Agent 怎么想、怎么用好资源"。** 姊妹篇 `docs/PRD-decision-resource-intelligence-layer.md`（DRIL）
> 解决"Agent 怎么精准找到该用的资源"。两份靠一根线接起来：**DRIL 负责"选对"，本 PRD 负责"用好+想对+验对"。**
>
> 核心一句话：现有 agent 已有 ReAct 循环，但**缺一个显式的"反思/重规划"步骤**——循环只靠模型自己调
> `final_answer` 收尾，失败时没有"复盘→重试"。本 PRD 把循环从「计划→执行→收尾」升级为
> **「理解→计划→分解→执行→反思」完整闭环**，并把系统提示词升级到企业级 **七要素 Harness 标准**。
>
> 遵铁律 0：见文末《本体引用与影响》。

---

## §0 先说人话：现在的 Agent 缺哪一环

### 0.1 三句现状（有代码为证，不粉饰）

1. **急救点已定位**（真实 Kimi 实测）：LLM 主要就用在**意图分类+抽槽位**这一步；一旦分类成功，多数问题走**确定性工作流（path-A）**不再需要 LLM。"绑了 Kimi 还不行"= 分类器那步没真接上 LLM（#1 接线漏），**不是** ReAct/切片坏。→ 急救归急救（NL-ROBUST 在做），本 PRD 谈的是**升级**。

2. **现有循环没有"反思"**（`apps/agentcore/src/agent/loop.ts` 现状）：循环是 **plan（一轮批量 `invoke_solver`）→ execute → synthesize（一次综合）**，靠模型自己调 `final_answer` 或**预算耗尽**（`synthesizePartialFindings`）收尾。**没有一个显式步骤去问"我到底答对了没、数字有没有落地、有没有工具悄悄失败了、还缺不缺"**。

3. **失败时缺"复盘-重试"**：现在工具报错/空数据时，要么硬失败，要么把不完整的东西综合出去。没有"发现不对 → 重新规划 → 换条路再试一次"的机制。

### 0.2 现有提示词七要素诚实体检

读 `apps/agentcore/src/agent/prompts.ts` 现状（`AGENT_SYSTEM_CORE` + `CEO_DEEP_QUESTION_SYSTEM` + `ROLE_SYSTEM_FRAGMENTS`）：

| 要素 | 评级 | 证据 | 差在哪 |
|---|---|---|---|
| ① 角色 Role | ✅ | 五角色片段 + 对象域声明「越界会被拒」 | — |
| ② 目标 Objective | ◑ | CEO 段要「根因+方案+溯源」 | 通用 core 只说"用工具答题"，无"决策级目标"定义 |
| ③ 推理循环 ReAct | ❌ | 【工作方式】= "导航图选好型→一步到位"，**刻意压制多跳** | 无显式 Think→Act→Observe→**Reflect** 协议；导航图为空/选错时退化含糊 |
| ④ 工具协议 Tool | ✅ | 【写降级】唯一写出口 create_action_draft；只读可并行；预算 4 轮 | — |
| ⑤ 状态管理 State | ✅ | `pageContextSummary` 注入焦点/选中/前情/沙盘；`agentPriorSummary` 指代消解 | — |
| ⑥ 错误恢复 Recovery | ❌ | 【答不了就明说】只覆盖"能力边界"一种 | 工具失败/空数据/越界/预算耗尽**无分类恢复 + 无复盘重试** |
| ⑦ 结果规范 Final | ◑ | 【收尾纪律】final_answer + ⟦ref:N⟧ | 无决策结构模板（结论/分析/证据/建议/风险） |

**结论**：红线（数字/写降级/注入防护）与状态管理很硬，但**③推理循环、⑥错误恢复、⑦结果规范三项欠账**——
而这三项恰好合起来就是"缺一个反思/重规划闭环"。本 PRD 就补这个闭环。

---

## §1 目标与非目标

### 1.1 目标

- **G1 · 完整闭环**：把 agent loop 从「计划→执行→收尾」升级为**「理解→计划→分解→执行→反思」**——新增显式 **Reflect（反思/重规划）步骤**。
- **G2 · 七要素达标**：`AGENT_SYSTEM_CORE` 补齐 ③推理循环 / ⑥错误恢复 / ⑦结果规范三段（叠加式，保测试锁定红线短语）。
- **G3 · Solver-first 硬纪律**：涉及排产/优化/最大收益/最低成本/资源分配/产能约束的问题，**禁止 LLM 直接算，必须调 Solver**（把现有隐性纪律显性化为 prompt 硬约束 + 执行期门）。
- **G4 · Critic 验证前置**：最终答案出口前有一道**批判性自检**（Critic）——数字是否落地、是否真答了、是否有工具静默失败、是否越 scope——不过关就重规划或诚实标注。
- **G5 · 不破坏确定性优先**：反思/重规划只在 **path-B 真开放题**生效；path-A 确定性命中题仍秒级直出，字节兼容零回归。

### 1.2 非目标

- ❌ 不训练模型；反思用**确定性检查（R6）为主 + LLM critic 为辅**（可 fail-open 退回纯确定性）。
- ❌ 不把 path-A 变慢：Reflect 只挂在 path-B 的 `runAgentLoop`，确定性单跳/compose 路径不进反思。
- ❌ 不无限重试：重规划**硬预算有界**（默认 ≤1 次重规划），耗尽即诚实收尾（复用现有 `synthesizePartialFindings`）。

---

## §1.5 ★关键定位：全模式只在"内置工具失效"时才启动（三级路由）

> 大白话：不是每个问题都要跑完整的 harness+react+router——那太重、太慢。平台先走便宜的路，
> **只有当用户意图谁都没命中（没有预设 agent 能兜底、导航图是空的），才落到 harness+react+router 全模式。**
> 你这句话点破了本 PRD 的**触发边界**：全模式是**兜底路**，不是主路。

```
用户问句
  │
  ├─① 命中确定性 solver（domainResolve conf≥0.6）──→ path-A：直接算·秒级·不进 agent
  │
  ├─② 命中某预设 agent/场景（NavigationSlice 充实）─→ 精简 agent：拿"选好型的导航图"一步到位
  │        ↑ 现有强项（真实 Kimi 实测：分类命中→path-A→P50 12.3GWh 真答案）
  │
  └─③ 谁都没命中：没有预设 agent、导航图空 ─────→ ★harness+react+router 全模式★
           = 你说的「内置工具都失效了」的情况
```

**三级对照**：

| 级 | 触发条件 | 用什么 | 现状 |
|---|---|---|---|
| ① path-A | 命中确定性 solver | domainResolve → invoke_solver | ✅ 强（秒级·R6） |
| ② 精简 agent | 命中预设 agent/场景 → 导航图充实 | NavigationSlice 选好型 + 一步到位 | ✅ 强（导航图对时） |
| ③ **全模式** | **无预设 agent·导航图空**（内置工具失效） | **router 检索补位 + 完整 ReAct + 反思** | ❌ **今天这里是脆弱点** |

**为什么第③级是脆弱点（本 PRD + PRD#2 联手补的正是这里）**：
- 今天第③级的退化路径 = **`discover` 盲扫**——没有预设导航图时，agent 只能瞎试，这就是"点了没反应/答非所问"的根。
- 全模式把盲扫换成两样东西：
  - **router（= DRIL 向量检索·PRD#2 的 `retrieve_knowledge`）补位缺失的 NavigationSlice**——
    既然没人预先替你选好资源，就用"问句→最相关规则/求解器/切片"的向量检索**现场找**，而不是盲扫。
  - **完整 ReAct + 反思（§7）**——开放题没有捷径，靠「理解→计划→分解→执行→反思」硬推，且**收尾前复盘重试**。
- **前置依赖**：第③级本质要 LLM（既做意图理解，也做开放推理）——所以 §0.1 的**急救（LLM 接线）是第③级能不能启动的前提**。急救不做，全模式是死的。

> **一句话**：①②是"有预设兜底"的快路，**③是"没预设兜底"的慢路（全模式）**。本 PRD 让③从"盲扫翻车"
> 变成"router 检索 + ReAct + 反思"的可靠兜底；PRD#2 提供那个 router。下面 §2 的九阶段流水线，**讲的就是第③级全模式内部长什么样**。

---

## §2 目标推理架构：九阶段流水线（= 第③级全模式的内部展开）

> 大白话：把你给的 `User Intent → Planner → Reasoning Graph → Skill Selector → MCP Tool Router →
> Ontology Query → Solver/Sim → Critic → Decision Output` 这条链，逐段对照"平台已有什么 / 要补什么"。
> **绝大多数已经有了**，真正要补的是 **Planner 的显式分解** 和 **Critic 反思** 两段。

```
用户问句
  │
  ①【理解 · User Intent】意图分类 + 抽槽位
  │     已有：classifier（needs LLM·§0.1 急救点）→ intent + slots
  │     要补：无（急救接线即可）
  ▼
  ②【计划 · Planner Agent】把问题拆成"要几步、每步查什么/算什么"
  │     已有：domainResolve（R6 单跳选型）+ compileSolverPlan（Phase2-C 多 solver 编排）
  │     要补：真开放题的**显式分解**（reasoning graph 落成 plan·非隐式）
  ▼
  ③【分解 · Reasoning Graph】子问题 DAG（哪些能并行、哪些有依赖）
  │     已有：executePlan 按 parallelGroup 升序（组内并发/组间串行）
  │     要补：把"分解"从 compose 专用泛化到 path-B 开放题
  ▼
  ④【技能路由 · Skill Selector】选相关技能
  │     已有：selectSkills（skill-router·语义 top-k）
  │     要补：接入 DRIL 向量检索（见 PRD#2·retrieve_knowledge）
  ▼
  ⑤【工具路由 · MCP Tool Router】选/调工具
  │     已有：tools/executor（query_objects/invoke_solver/evaluate_rules/discover…）
  │     要补：新增 retrieve_knowledge 工具（PRD#2）·资源 MCP 化（PRD#2）
  ▼
  ⑥【本体查询 · Ontology Query Engine】按本体取对象/口径
  │     已有：query_objects（A6 过滤）+ type-semantics（口径语义锚定）
  │     要补：无（PRD#2 让它可被向量检索命中）
  ▼
  ⑦【求解/推演 · Solver & Simulation】确定性算
  │     已有：invoke_solver（46+ solver·R6）+ sim_*（沙盘模拟态）
  │     要补：Solver-first **硬纪律**（§6）——禁止 LLM 直接算
  ▼
  ⑧【反思 · Critic Agent】★本 PRD 核心新增★
  │     已有：ValidationTrace（一致性+交叉验证·输出侧）· EvalSuite parity（离线）
  │     要补：**loop 内的 reflect 步骤**——出口前复盘，不过关→重规划重试
  ▼
  ⑨【决策输出 · Decision Output】结构化交卷
  │     已有：final_answer（结构化 blocks + ⟦ref:N⟧）
  │     要补：五段决策结构模板（结论/分析/证据/建议/风险·§8）
  ▼
最终答案
```

**一句话**：九段里 ①③④⑤⑥⑦⑨ 都已有（①待急救接线，④⑤靠 PRD#2 增强），本 PRD 的真正净新增是
**② Planner 显式分解**（把 compose 泛化到开放题）和 **⑧ Critic 反思闭环**（loop 内 reflect 步骤）。

---

## §3 七要素 Harness 标准 · 提示词改造

> ⚠ **硬约束**（探测自测试）：prompt 必须继续 `包含"本题导航图"`（`qos-agent-slice-seam.test.ts`）、
> `包含"注入防护"`（`qos-b.test.ts:172`）、`包含 ["数字红线","写降级","能力边界","注入防护"]`（`lived-in.test.ts:49`），
> 预算耗尽仍出 `[预算耗尽·诚实摘要]`（`agent-budget.test.ts`）。**改造只能叠加，不能删改这些短语。**

在 `AGENT_SYSTEM_CORE` 现有段之后，**追加三段**（补 ③⑥⑦）：

**补 ③ 推理循环**（含反思触发点）：
```
【推理循环】按 Think→Act→Observe→Reflect 转：
① Think：看本题导航图，判断"够不够答"。够→选对口 solver 一步到位；不够→明确还缺哪类证据。
② Act：同一轮能并行的只读工具一次发起（invoke_solver/query_objects/retrieve_knowledge）。
③ Observe：读工具结果，判"还缺不缺"。
④ Reflect：收尾前自检一次——真答了问题吗？每个数字都 ⟦ref:N⟧ 了吗？有工具报错/空数据被我忽略吗？
   不过关 → 回 ① 补证或换路（最多再规划 1 次）；过关 → 立即 final_answer。
导航图为空/无对口 solver（真开放题）：先 retrieve_knowledge 或 discover 一次补候选，再按上面转，最多约 4 轮。
```

**补 ⑥ 错误恢复**（分类恢复 + 复盘重试）：
```
【错误恢复】按错因分类，绝不静默失败也绝不编造：
- 工具报错/超时：换一条等价取证路径再试一次；仍失败→结论里诚实标"该环节取证失败"。
- 空数据 EMPTY_DATA：不要把空当 0 或编数；说明"该口径当前无数据"+ 需补什么数据。
- 越界被拒 SCOPE_VIOLATION：说明"超出我的授权对象域"，建议改由对口角色（供应链/生产/质量）回答。
- 预算将尽：立即 final_answer 给当前最可靠结论，诚实标注"信息不足处"。
```

**补 ⑦ 结果结构**（五段决策模板）：
```
【结果结构】决策级问题的 final_answer 建议五段（简单问题可合并）：
① 结论：一句话可行动判断（能/不能、缺多少、该做什么）。
② 关键分析：2–3 条支撑推理，每条挂数字并 ⟦ref:N⟧。
③ 证据：用到的对象/求解器/规则（可核对来源）。
④ 建议：下一步动作；涉写 → create_action_draft 出草稿。
⑤ 风险/不确定：数据缺口、假设、需人判断处。
```

> CEO 深问段 / 五角色 / Coordinator 全部以 `${AGENT_SYSTEM_CORE}` 为底 → **自动继承**这三段。

---

## §4 Ontology Awareness — 所有推理基于业务本体

> 你的要求："所有推理必须基于业务本体；Business Object: Customer/Product/Factory/Line/Equipment/Material/Order；
> Relationship: produces/supplies/consumes/depends_on"。→ 平台**已经是本体驱动**，本 PRD 只把它写进硬纪律。

- **已有**：① NavigationSlice 进 agent 前投影「相关对象类型+关键属性 / 对口 solver / 链路 / 规则」；
  ② type-semantics（口径语义锚定）注入「实体/指标口径 description/unit/派生 formula + 规则 expression」。
- **硬纪律（写进 prompt）**：
  - 业务实体只认本体对象类型（Customer/Product/Factory/Line/Equipment/Material/Order → 平台对应
    `Order/Model/Base/Line/Process/Equipment/Material/Supplier/DemandSegment` 等，以本体 §2 为准）。
  - 关系只认本体链路（produces/supplies/consumes/depends_on → 平台 OntologyLink，以 §3 为准）。
  - **不认识的实体/关系不臆造**——查不到就走【错误恢复】诚实标缺，不用"常识"编。

---

## §5 Skill / Tool Routing

- **已有**：`selectSkills`（skill-router 语义 top-k 注入相关技能全文 summary，其余降级为 id）。
- **要补（靠 PRD#2）**：技能/求解器/切片的选择从"LLM 看描述自选"升级为 **DRIL 向量检索直接映射**——
  agent 调 `retrieve_knowledge("<问句>")` 拿到排好序的候选，而不是 `discover` 盲扫。**本 PRD 只负责在 loop/prompt
  里"用"这个工具**，索引与检索实现在 PRD#2。
- **技能清单**（你列的 ProductionPlanning/CapacitySimulation/DemandForecast/ContractRiskAnalysis/
  SupplierRiskPrediction/CostOptimization）→ 平台以 `SkillDefinition` 一等注册，DRIL 5 层标签的 L2 决策类型对齐这些能力名。

---

## §6 Solver-first 硬纪律（禁止 LLM 直接算）

> 你的要求："如果问题包含排产/优化/最大收益/最低成本/资源分配/产能约束，禁止 LLM 直接计算，必须调用 Solver"。

- **已有隐性纪律**：【数字红线】要求每个业务数字来自本轮工具结果并 ⟦ref:N⟧；preferDeterministicSolver 优先确定性。
- **本 PRD 显性化为两道门**：
  1. **Prompt 硬约束**（追加进【工作方式】）：
     ```
     【求解纪律】凡涉及排产/优化/最大收益/最低成本/资源分配/产能约束/可行性判断的问题——
     禁止你自己心算或估算，必须调对口 solver（如 capacity_feasibility/portfolio_optimize/
     multi_objective/cross_object_occupancy）。你只负责把 solver 的结果解释成决策语言。
     ```
  2. **执行期门（R6·非靠自律）**：Critic 反思（§7）检查——若 final_answer 里出现**未挂 ⟦ref:N⟧ 的业务数字**，
     或**该类问题却没调过任何 solver**，判"数字红线违规"→ 打回重规划（强制走 solver）或诚实降级。
- **SEAM**：一道"排产优化"问句 → 断言执行轨迹里**真出现 invoke_solver**、答案数字**全部 ⟦ref⟧**（漏调 solver 即红）。

---

## §7 ★核心：Critic / Reflect 反思闭环★

> 大白话：这是本 PRD 的心脏。现在循环靠模型"自我感觉答完了"就调 final_answer 收尾——**没人复核**。
> 我们加一道**反思步**：收尾前，先让系统（确定性检查为主、LLM critic 为辅）问一串"你真答对了吗"，
> 不过关就**重新规划、换条路再试一次**，而不是把半成品发出去。

### 7.1 Reflect 步骤挂在哪

- 挂在 `loop.ts` 的**收尾判定处**：当模型调用 `final_answer`（或将触发收尾）时，**先不直接返回**，
  过一遍 **`reflectAnswer(task, runRecord, answer)`**（新增，R6 纯函数为主）。
- **仅 path-B `runAgentLoop` 生效**；path-A 确定性/compose 直出路径**不进反思**（字节兼容）。

### 7.2 复盘清单（确定性 R6 为主）

`reflectAnswer` 逐条确定性检查（不需 LLM 就能判的先判）：

| 检查项 | 判据 | 不过关动作 |
|---|---|---|
| **答了吗** | final_answer blocks 非空 + 不是"未能产出回答"占位 | 重规划：补一轮取证 |
| **数字落地** | 每个业务数字都有 ⟦ref:N⟧ 且 N 在 provenance 范围内 | 打回：强制走 solver 补溯源（接 §6） |
| **工具静默失败** | runRecord 里有 tool error/EMPTY 但答案没体现 | 打回：按【错误恢复】显式处理 |
| **越 scope** | 答案引用了 agent scopeDeclaration 外的对象域 | 拒：诚实标"超授权域"+ 建议对口角色 |
| **口径一致** | 结论对象断言 vs 知识图谱（复用 `ontology.crossValidate`） | 标 CONFLICT/NO_EVIDENCE（不静默） |

> **可选 LLM Critic（fail-open）**：确定性检查全过后，若开了 `agent.critic` entitlement，再叫一次轻量 LLM
> 做"逻辑自洽/是否答非所问"的软判（advisory）；无 provider/关闭 → 跳过，只靠确定性检查（**不阻断**）。

### 7.3 重规划-重试（硬有界）

```
final_answer 触发
  → reflectAnswer 复盘
    · 全过 → 放行，真收尾
    · 不过关 ∧ 重规划预算未尽（默认 replanBudget=1）→
        把"不过关原因"作为一条系统提示回注 loop → 模型重新规划一轮（换 solver/补取证）→ 再 reflect
    · 不过关 ∧ 重规划预算已尽 →
        走现有 synthesizePartialFindings：诚实收尾，standardMd 明标"反思发现的缺口：<原因>"
```

- **预算纪律**：重规划**最多 1 次**（可配），与现有 4 轮工具预算共账——不新增无界循环风险。
- **观测**：`AgentRunRecord` 加 `reflected?: boolean` + `replanReason?: string[]`（观测用·不改数字/溯源，
  对齐现有 `planFellBackToReAct` 的观测手法）。

### 7.4 为什么这样接（不推倒现有）

- **复用** `ontology.crossValidate` / `ValidationTrace`（已有的交叉验证）做"口径一致"检查——不新造校验逻辑。
- **复用** `synthesizePartialFindings`（已有的诚实兜底）做重规划耗尽后的收尾。
- **对齐** EvalSuite parity 的 failKind 分类法（INTENT/TOOLSEQ/ANSWER）——reflect 的复盘项与 parity 失因同构，
  这样"离线 eval 发现的失因"和"在线 reflect 拦的失因"是同一套语言，可互相回灌（喂 PRD#2 质量分）。

---

## §8 Decision Output — 五段决策结构

`final_answer` 的 blocks 建议五段（§3 补⑦已进 prompt；这里定契约层可选校验）：

| 段 | 内容 | 溯源 |
|---|---|---|
| 结论 | 一句话可行动判断 | — |
| 关键分析 | 2–3 条推理 | 每条数字 ⟦ref:N⟧ |
| 证据 | 用到的对象/solver/规则 | 列 provenance |
| 建议 | 下一步动作 | 涉写→action draft |
| 风险 | 缺口/假设/需人判断 | 诚实标注 |

- **软约束**：不强制死结构（简单问题可合并），但 Critic（§7.2「答了吗」）确保**至少有结论 + 溯源**。

---

## §9 落地 WO 拆分

> 每张 WO 一条 handoff 分支；SEAM 驱动接缝；保测试锁定红线短语。

**WO-HARNESS-PROMPT** 🚦边界：`agentcore/src/agent/prompts.ts` + 对应 test
- 叠加 §3 三段（推理循环/错误恢复/结果结构）+ §6 求解纪律段。保 `本题导航图`/四红线/`注入防护`/`[预算耗尽·诚实摘要]`。
- SEAM：新增 `harness-elements.test.ts` 断七要素齐 + 旧断言全绿。

**WO-REFLECT-LOOP** 🚦边界：`agentcore/src/agent/loop.ts` + `agentcore/src/agent/reflect.ts`(新) + test
- 新增 `reflectAnswer`（R6 复盘清单 §7.2）+ 收尾前挂钩 + 重规划有界（§7.3）+ `AgentRunRecord.reflected/replanReason`。
- entitlement `agent.critic`（defaultOff·暗发）守可选 LLM critic。
- SEAM（**头号判据**）：构造"工具静默失败"场景 → 断言 reflect **拦下并重规划**（对比关闭 reflect 时会把半成品发出）；
  且**关 reflect / path-A 命中题字节兼容零回归**。

**WO-SOLVER-FIRST-GATE** 🚦边界：`agentcore/src/agent/reflect.ts`（与 REFLECT-LOOP 同 dev 整单，避免拆两半）
- 「排产/优化类问题却没调 solver」或「数字未 ⟦ref⟧」→ reflect 打回。
- SEAM：排产优化问句 → 轨迹真出现 invoke_solver + 数字全溯源（漏调即红）。

> **注意**：REFLECT-LOOP 与 SOLVER-FIRST-GATE **必须一个 dev 整单做**（都改 reflect.ts + loop.ts，拆两半会接缝炸）。

---

## §10 《本体引用与影响》（铁律 0）

### 10.1 对象类型（§2 目录）
- **H 交互/编排域**：`Task/Query`（QOS 任务）· `Skill/Agent`（loop 宿主）· `ExecutionPlan/Workflow`（规划产物）·
  `AgentRole/Coordinator`（继承 harness）· `EvalSuite/EvalRunReport`（parity 与 reflect 失因同构·互灌）·
  `ValidationTrace`（reflect 复用其交叉验证）。
- **B/E 域**：`ObjectType`/`OntologyLink`（Ontology Awareness §4）· `SOLVER_CATALOG`（Solver-first §6）。

### 10.2 链路（§3）
- **编排链（问句→答案）**：本 PRD 在 **path-B `runAgentLoop` 的收尾处**插入 Reflect 步（§7）——
  **不改分水岭**：path-A 命中仍不落 agent、compose 命中仍 early-return，Reflect 只作用于真进 agent 的开放题。
- **NavigationSlice 注入 + 规划式执行**：Reflect 的"重规划"回注复用现有 plan-then-execute 的回退路径（`planFellBackToReAct` 手法）。

### 10.3 事件（§4）
- 新增 `agent.reflected`（reflect 触发重规划时发·观测/审计用）。

### 10.4 不变量（§5，R1–R16）
- **R6 确定性地板**：reflect 复盘清单以**确定性检查为主**；LLM critic 为可 fail-open 的 advisory，**不进确定性求解路径**。
- **R4 写降级**：reflect 不产生写；发现涉写需求→仍走 create_action_draft。
- **R13 输出侧纪律**：五段决策结构 + ⟦ref:N⟧ 是 R13 的"可视化成品"。
- **R2/R3**：reflect 的 scope 检查复用 agent scopeDeclaration 越界拒 + A6 行级过滤；`agent.critic` 关=不存在（R3）。

### 10.5 断点（§8）
| 断点 | 现状 | 本 PRD 推进 |
|---|---|---|
| **G-AGENT-BLIND-REACT** | 已"半修"（NavigationSlice+domainResolve） | **补成全修的关键一步**：加 Reflect 让"导航图为空/选错"时能复盘重规划，而非翻车 |
| **G-DECISION 决策推演引擎** | 有方案候选无引擎 | 五段决策结构（结论/建议/风险）+ Critic 验证 = 决策输出的质量地基 |
| **G-CAPACITY-INFER-PROCESS** | 结论无过程·信任缺口 | Reflect 强制"证据段列 solver/规则来源" = 过程可溯，补信任 |

### 10.6 回写计划
落地后回写 `docs/SYSTEM-ONTOLOGY.md`：§3 编排链补 **Reflect 步骤插入点**；§4 新增 `agent.reflected` 事件；
§8 更新 **G-AGENT-BLIND-REACT** 状态（半修→随 WO-REFLECT-LOOP 推进）；§7 新增门 `harness-elements:check`。

---

## §11 验收（SEAM 驱动·非各半绿）

1. **七要素**：`harness-elements.test.ts` 七项齐 + `lived-in`/`qos-b`/`qos-agent-slice-seam`/`agent-budget` 旧断言全绿。
2. **Reflect 拦截 SEAM**（头号判据）：工具静默失败场景 → reflect 拦下并重规划一次 → 对比关闭时会漏发半成品。
3. **Solver-first SEAM**：排产优化问句 → 轨迹真出现 invoke_solver + 数字全 ⟦ref⟧（漏调 solver 即红）。
4. **字节兼容**：path-A 命中题 / 关 reflect 时行为零回归。
5. **四包全绿**：`pnpm -r build && pnpm -r --workspace-concurrency=1 test`（datacore 勿并发 vitest）。

---

> **一句话收尾**：现有 Agent 会"想一步、算一下、就交卷"；本 PRD 让它学会**"交卷前先复盘，发现不对就重做一遍"**，
> 并把这套想法写进达标的七要素提示词里。配合姊妹篇 DRIL（让它"精准找到该用的资源"），对话推演能力才真正上一个台阶。
