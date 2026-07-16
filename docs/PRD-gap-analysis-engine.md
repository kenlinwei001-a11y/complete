# PRD：统一 GapAnalysis 引擎与补齐闭环治理

> 状态：草案待审
> 作者：Claude
> 日期：2026-07-08

---

## 1. 现状（As-Is）

### 1.1 补齐入口地图

当前系统存在 **15+ 个"补齐"入口**，分散在前端 10+ 个页面，横跨 AgentCore 和 DataCore 两个后端系统：

| 入口 | 前端页面 | 后端服务 | 补齐哲学 | 诊断深度 |
|---|---|---|---|---|
| In-Dialog GapCard | `GapCard.tsx` | AgentCore growth | 反应式：撞墙再补 | 单缺口/轮 |
| 工单中心 | `TicketCenterPage.tsx` | AgentCore growth | 反应式沉淀+人工 | 单缺口/轮 |
| 数据构建发动机 | `DataBuilderPage.tsx` | DataCore databuilder | 完整预分析 | 全量盘点 |
| 合成数据向导 | `SyntheticPage.tsx` | DataCore synthetic | 用户主动 | 无诊断 |
| 数据连接同步 | `ConnectionsPage.tsx` | DataCore connector | 用户主动 | 无诊断 |
| 字段对账 | `SchemaReconcilePage.tsx` | DataCore intake | 交互式人工 | 无诊断 |
| 本体建模发布 | `ModelingPage.tsx` | DataCore modeling | 用户主动 | 无诊断 |
| 意图目录 reconcile | `CatalogPage.tsx` | AgentCore catalog | 用户主动 | 无诊断 |
| Action 审批 | `ActionsPage.tsx` | AgentCore action | 审批流 | 无诊断 |
| 场景生长 | `ScenesPage.tsx` | AgentCore growth | 混合：验证+反应式 | 单缺口/轮 |
| 沙盘预检查 | `SimInitWizard.tsx` | AgentCore sim | 预检查 | 单点验证 |
| 闭环验证 | `ValidationPage.tsx` | AgentCore validation | 事后验证 | 无前置诊断 |

### 1.2 两套并行的补齐哲学

**哲学 A：完整预分析（DataBuilder）**
- 先 comprehensively 理解需求脚本，生成完整 `BuildPlan`
- 做一次全量现状盘点（`GapAnalysis`），输出 needed/existing/toCreate/missing
- 按 7 阶段瀑布流系统性执行
- 有持久化 checkpoint，失败可 resume

**哲学 B：反应式撞墙再补（Growth Loop）**
- 没有预推演，直接提交问题给编排器执行
- 执行到某步阻塞，停下来取 `findings[0]`
- 补完这一个后重新跑完整 QOS，看是否还有下一个缺口
- 最多 K 轮（默认 4），每轮只处理一个缺口

**哲学 C：用户主动操作（Connections/Synthetic/Modeling/Catalog）**
- 没有系统级诊断
- 用户凭经验决定"我要同步数据/合成数据/发布模型"
- 系统不判断"这个操作是否必要"

### 1.3 当前数据流

```
用户提问 ──→ QOS 编排 ──→ 撞墙 ──→ GapReport (findings[0])
                            ↓
                     ┌──────┴──────┐
                     ↓             ↓
              triggerable    non-triggerable
                     ↓             ↓
            growthTrigger    TicketCenter
            (B1/B2/B3)       (WorklistItem)
                     ↓             ↓
              自动补齐        人工认领→fill
                     ↓             ↓
              重跑 QOS        补齐后重跑
                     ↓
              CONVERGED? MAX_ROUNDS? BOUNDARY?
```

DataBuilder 的流是完全独立的：
```
用户脚本 ──→ comprehend ──→ BuildPlan ──→ GapAnalysis (全量 diff)
                                              ↓
                                    7 阶段瀑布流执行
                                              ↓
                                    ClosureReport 验证
```

---

## 2. 痛点（Pain Points）

### 2.1 用户视角：不知道系统到底缺什么

- 工单中心只显示"缺数据"，但不显示"还缺求解器/规则/意图"
- 用户认领了一个 DATA_GAP 工单，补完数据后发现还有 SOLVER_GAP
- 没有"补齐全景图"，用户像盲人摸象

### 2.2 用户视角：不知道先补哪个

- Growth Loop 的补齐顺序是"发现顺序"（哪一步先撞墙就先补哪）
- 但发现顺序不等于依赖顺序
- 例：先补数据后发现缺求解器，但如果先 scaffold 求解器，可能数据需求会不同

### 2.3 用户视角：重复补齐

- ConnectionsPage 同步没有"必要性判断"，用户可能重复同步同一连接
- SyntheticPage 合成没有"影响分析"，用户可能合成系统不需要的数据
- ModelingPage 发布没有"下游影响警告"，用户可能破坏已有工作流

### 2.4 系统视角：两套 Gap 数据结构不互通

| 维度 | DataBuilder GapAnalysis | Growth Loop GapReport |
|---|---|---|
| 范围 | 全局（所有模块） | 单查询路径 |
| 输出 | needed/existing/toCreate/missing | findings[]（阻塞点列表） |
| 驱动 | 自然语言脚本 | 真实用户查询 |
| 持久化 | StoryBuildRun | GrowthLedger（rounds） |
| 用途 | 建域 | 对话补数 |

**两套数据从不交叉引用**。DataBuilder 知道的全景，Growth Loop 看不到；Growth Loop 在真实查询中发现的缺口，DataBuilder 也不知道。

### 2.5 系统视角：补齐后验证不一致

| 入口 | 验证方式 | 验证维度 |
|---|---|---|
| GapCard | `terminalState === "CONVERGED"` | 单查询可答 |
| DataBuilder | `ClosureReport`（5 维度） | 全局完整性 |
| ValidationPage | VLE 断言矩阵 | 数据质量 |
| 其他入口 | **无验证** | — |

没有统一的"补齐完成标准"。补了数据就算完成？还是必须能回答原问题？还是必须不影响下游？

### 2.6 系统视角：没有补齐影响分析

- 修改模型后，哪些已发布的意图/工作流会失效？
- 新增数据集后，哪些求解器的输入契约需要更新？
- 发布新规则后，哪些 Action Drafts 需要重新审批？
- **系统不回答这些问题**。

---

## 3. 根因分析（Root Cause）

### 根因 1：补齐被当作"故障修复"而非"系统建设"

Growth Loop 的设计假设是：系统大部分已就绪，只是某个具体查询路径上缺了某样东西。所以它的策略是"发现→修补→继续"。

但这个假设在以下场景不成立：
- 冷启动租户（什么都没有）
- 新增业务域（需要系统性建设）
- 复杂查询涉及多模块协同（缺 A 导致 B 也缺）

在这些场景下，"撞墙再补"会导致：补了 A 发现缺 B，补了 B 发现缺 C，循环 K 轮后 `MAX_ROUNDS` 退出，用户拿到一堆半成品。

### 根因 2：缺乏"系统状态快照"能力

DataBuilder 能做 complete diff 是因为它有一张 `BuildPlan`（蓝图），可以逐项对比系统现状。

Growth Loop 没有蓝图。它只有"当前查询"，而当前查询只能暴露这条路径上的缺口，不能暴露系统全局缺口。

**关键缺失**：系统没有一个"当前租户能力全景"的注册表，可以回答：
- 这个租户有哪些对象类型？
- 每个对象类型有哪些字段？数据来源？
- 有哪些规则？覆盖了哪些场景？
- 有哪些求解器？输入/输出契约是什么？
- 有哪些意图？绑定了哪些计划？
- 有哪些工作流？引用了哪些 Skill/Agent/MCP？

### 根因 3：Gap 分类是症状分类，不是病因分类

当前 `GapCode` 分类：
```
NO_INTENT, NO_PLAN, NO_SLICE, EMPTY_DATA,
NO_RULE, SOLVER_NOT_FOUND, SHAPE_MISMATCH,
NO_CAPABILITY, LLM_PURPOSE_UNBOUND, OTHER
```

这些是**症状**（用户看到了什么），不是**病因**（系统缺什么）。

例：
- `EMPTY_DATA` 的症状是"数据为空"
- 但病因可能是：没有连接、连接断了、连接有数据但没物化、物化了但规则过滤掉了……
- 不同病因需要不同的补齐策略

当前系统没有"病因分析"，只有"症状标签"。

### 根因 4：补齐动作与系统状态变更没有统一事件流

- 连接同步成功后，哪些模块应该被通知？
- 建模发布后，哪些工作流应该重新验证？
- 规则审批后，哪些求解器缓存应该失效？

当前这些通知是**点对点硬编码**的（如 DataCore 发 `{kind}.updated` 事件给 AgentCore），不是**基于影响图的全量传播**。

---

## 4. 设计目标（Design Goals）

| 目标 | 描述 | 优先级 |
|---|---|---|
| G1：统一缺口诊断 | 所有补齐入口共享同一个 GapAnalysis 引擎，输出统一的全景缺口报告 | P0 |
| G2：补齐优先级排序 | 基于依赖关系和影响面，自动计算补齐顺序 | P0 |
| G3：补齐前影响分析 | 任何补齐操作执行前，系统能预测会影响哪些下游 | P1 |
| G4：补齐后统一验证 | 所有补齐操作完成后，用同一套标准验证是否真正解决问题 | P1 |
| G5：补齐入口归集 | 所有补齐触发统一收口到工单系统，但保留快捷执行路径 | P2 |

---

## 5. GapAnalysis 引擎设计

### 5.1 核心概念

**System Capability Registry（系统能力注册表）**

一个只读的聚合视图，汇总当前租户的所有系统能力：

```typescript
interface SystemCapabilityRegistry {
  // 数据层
  connections: ConnectionCapability[];
  datasets: DatasetCapability[];
  
  // 本体层
  objectTypes: ObjectTypeCapability[];
  slices: SliceCapability[];
  
  // 规则层
  rules: RuleCapability[];
  
  // 求解层
  solvers: SolverCapability[];  // 含 ioContract
  
  // 编排层
  intents: IntentCapability[];  // 含绑定的 plan/workflow
  plans: PlanCapability[];
  workflows: WorkflowCapability[];
  skills: SkillCapability[];
  agents: AgentCapability[];
  mcps: McpCapability[];
  scenes: SceneCapability[];
  
  // 知识层
  kbDocs: KbDocCapability[];
  
  // 依赖图
  dependencyGraph: DependencyGraph;  // 谁依赖谁
}
```

**GapAnalysis（缺口分析）**

基于 Registry 和目标需求，计算完整缺口报告：

```typescript
interface GapAnalysis {
  // 目标描述
  target: {
    kind: "query" | "script" | "scenario";
    description: string;
  };
  
  // 全量缺口清单
  entries: GapEntry[];
  
  // 统计
  totals: {
    needed: number;      // 目标需要
    existing: number;    // 系统已有
    toCreate: number;    // 需要新建
    missing: number;     // 无法自动建（需开发/人工）
    reusable: number;    // 可复用
  };
  
  // 依赖排序后的执行计划
  executionPlan: ExecutionStep[];
  
  // 影响分析
  impactAnalysis: ImpactReport;
}

interface GapEntry {
  kind: ModuleKind;           // dataset | ontology_type | rule | solver | intent | ...
  ref: string;                // 具体标识
  status: "EXISTS" | "TO_CREATE" | "MISSING" | "NEEDS_UPGRADE";
  
  // 病因（不只是症状）
  rootCause: {
    symptom: GapCode;         // EMPTY_DATA / NO_RULE / ...
    cause: "NOT_EXISTS" | "INCOMPLETE" | "VERSION_MISMATCH" | "DEPENDENCY_MISSING" | "MANUAL_REQUIRED";
    detail: string;
  };
  
  // 补齐策略
  remediation: {
    strategy: "AUTO" | "AUTO_WITH_APPROVAL" | "MANUAL" | "DEVELOP";
    action: string;           // 具体动作描述
    estimatedEffort: "SECONDS" | "MINUTES" | "HOURS" | "DAYS";
    canBeParallel: boolean;   // 是否可并行
    prerequisites: string[];  // 前置条件（其他 GapEntry refs）
  };
  
  // 影响面
  downstream: string[];       // 补齐后会影响哪些下游模块
}

interface ExecutionStep {
  step: number;
  entries: string[];          // 本轮可并行执行的 GapEntry refs
  rationale: string;          // 为什么先执行这些
}
```

### 5.2 引擎输入

引擎接受三种类型的目标：

**类型 1：Query 目标**
```typescript
{ kind: "query", query: "常州影响哪些订单？", context?: { base?: string; segment?: string } }
```
用于：Growth Loop、GapCard、TicketCenter 诊断

**类型 2：Script 目标**
```typescript
{ kind: "script", script: "构建一个电池产能规划域，包含...", seed?: 42 }
```
用于：DataBuilder

**类型 3：Scenario 目标**
```typescript
{ kind: "scenario", scenarioId: "scn_xxx", triggerQuestion: "..." }
```
用于：ScenesPage、SimInitWizard

### 5.3 引擎处理流程

```
┌─────────────────────────────────────────────────────────────┐
│                    GapAnalysis Engine                       │
├─────────────────────────────────────────────────────────────┤
│  Input: target (query/script/scenario)                      │
│                    ↓                                        │
│  Step 1: Intent Analysis                                    │
│  - 解析目标需要什么意图/计划/工作流                           │
│  - 如果不明确，返回 CLARIFY（需要用户补充槽位）               │
│                    ↓                                        │
│  Step 2: Requirement Derivation                             │
│  - 根据意图推导完整需求树                                     │
│    - 需要哪些对象类型？                                       │
│    - 每个对象类型需要哪些字段？                               │
│    - 需要哪些规则？                                           │
│    - 需要哪些求解器？                                         │
│    - 求解器需要什么数据？                                     │
│    - 意图需要什么槽位？                                       │
│    - 工作流需要什么 Skill/Agent/MCP？                         │
│                    ↓                                        │
│  Step 3: Registry Snapshot                                  │
│  - 拉取当前租户 SystemCapabilityRegistry                     │
│  - 构建依赖图                                                 │
│                    ↓                                        │
│  Step 4: Complete Diff                                      │
│  - 需求树 vs Registry 逐项对比                                │
│  - 生成 GapEntry[]（含 rootCause）                           │
│                    ↓                                        │
│  Step 5: Remediation Strategy                               │
│  - 为每个 GapEntry 匹配补齐策略                               │
│    - AUTO: 系统自动补齐（合成/脚手架）                        │
│    - AUTO_WITH_APPROVAL: 自动但需审批                         │
│    - MANUAL: 需要人工操作（导入/配置）                        │
│    - DEVELOP: 需要开发（新求解器/新功能）                     │
│                    ↓                                        │
│  Step 6: Dependency Sorting                                 │
│  - 基于 prerequisites 拓扑排序                                │
│  - 生成 ExecutionStep[]（并行分组）                           │
│                    ↓                                        │
│  Step 7: Impact Analysis                                    │
│  - 计算补齐后会影响哪些下游模块                               │
│  - 标记风险等级                                               │
│                    ↓                                        │
│  Output: GapAnalysis                                         │
└─────────────────────────────────────────────────────────────┘
```

### 5.4 引擎输出示例

**输入**：`query: "常州影响哪些订单？"`

**输出**：
```json
{
  "target": { "kind": "query", "description": "常州影响哪些订单？" },
  "entries": [
    {
      "kind": "ontology_type",
      "ref": "order",
      "status": "EXISTS",
      "rootCause": { "symptom": "ANSWERABLE", "cause": "NOT_EXISTS", "detail": "对象类型已存在" },
      "remediation": { "strategy": "AUTO", "action": "无需补齐", "canBeParallel": true }
    },
    {
      "kind": "dataset",
      "ref": "order_snapshots",
      "status": "TO_CREATE",
      "rootCause": { "symptom": "EMPTY_DATA", "cause": "INCOMPLETE", "detail": "对象类型存在但无数据源连接" },
      "remediation": { 
        "strategy": "MANUAL", 
        "action": "创建连接器导入订单数据", 
        "estimatedEffort": "MINUTES",
        "canBeParallel": false,
        "prerequisites": []
      },
      "downstream": ["solver_order_impact", "rule_lta_compliance"]
    },
    {
      "kind": "solver",
      "ref": "order_impact",
      "status": "MISSING",
      "rootCause": { "symptom": "SOLVER_NOT_FOUND", "cause": "NOT_EXISTS", "detail": "没有订单影响分析求解器" },
      "remediation": { 
        "strategy": "DEVELOP", 
        "action": "开发 order_impact 求解器（ioContract: 输入[base,orderId] 输出[riskLevel,affectedOrders]）", 
        "estimatedEffort": "DAYS",
        "canBeParallel": false,
        "prerequisites": ["dataset_order_snapshots"]
      }
    },
    {
      "kind": "intent",
      "ref": "intent_order_impact",
      "status": "TO_CREATE",
      "rootCause": { "symptom": "NO_INTENT", "cause": "DEPENDENCY_MISSING", "detail": "求解器存在但无对应意图覆盖" },
      "remediation": { 
        "strategy": "AUTO_WITH_APPROVAL", 
        "action": "脚手架生成意图草稿并绑定求解器", 
        "estimatedEffort": "SECONDS",
        "canBeParallel": true,
        "prerequisites": ["solver_order_impact"]
      }
    }
  ],
  "totals": { "needed": 4, "existing": 1, "toCreate": 2, "missing": 1, "reusable": 0 },
  "executionPlan": [
    { "step": 1, "entries": ["dataset_order_snapshots"], "rationale": "数据是基础，必须先有数据" },
    { "step": 2, "entries": ["solver_order_impact"], "rationale": "求解器依赖数据就绪" },
    { "step": 3, "entries": ["intent_order_impact"], "rationale": "意图依赖求解器就绪" }
  ],
  "impactAnalysis": {
    "risks": [
      { "module": "workflow_sop_balance", "risk": "求解器变更后工作流需重新验证", "severity": "MEDIUM" }
    ]
  }
}
```

### 5.5 与 Growth Loop 的集成

当前 Growth Loop 的执行流：
```
probe() → gapReport → fill(topFinding) → (advanced?) → probe() → ...
```

集成 GapAnalysis 引擎后的新流：

```
┌─────────────────────────────────────────────────────────┐
│  Round 0: PRE_ANALYSIS（新增）                           │
│  - 调用 GapAnalysisEngine({ kind: "query", query })      │
│  - 如果返回 CLARIFY → 走 B1 澄清门                       │
│  - 否则拿到完整 GapAnalysis                              │
│  - 向用户展示：                                          │
│    "系统诊断发现 4 项缺口：1 项已有 · 2 项可自动补 ·      │
│     1 项需开发。预计执行 3 步。是否开始补齐？"            │
└─────────────────────────────────────────────────────────┘
                          ↓ 用户确认
┌─────────────────────────────────────────────────────────┐
│  Round 1..N: SYSTEMATIC_FILL（替代原 reactive fill）     │
│  - 按 ExecutionPlan 逐 step 执行                         │
│  - 每 step 内并行执行 AUTO 项                            │
│  - MANUAL/DEVELOP 项生成工单                             │
│  - 每轮结束后更新 Registry Snapshot                      │
│  - 如果全部完成 → CONVERGED                              │
│  - 如果有 MANUAL/DEVELOP 未完成 → NEEDS_HUMAN            │
└─────────────────────────────────────────────────────────┘
```

**关键变化**：
- 不再是"撞墙→补一个→再撞墙"，而是"先全景诊断→按依赖顺序系统性补齐"
- `MAX_ROUNDS` 不再重要，因为缺口在开始前就已经知道了
- `NEEDS_HUMAN` 是有意义的终态（确实有缺失的开发能力），而不是"没跑完"

### 5.6 与 DataBuilder 的集成

DataBuilder 已经在做 complete diff（`GapAnalysis`），但用的是自己的实现。统一后：

- DataBuilder 的 `gap` 阶段调用 **同一个 GapAnalysisEngine**
- 输入从 `script` 改为 `{ kind: "script", script }`
- 输出复用统一的 `GapAnalysis` 数据结构
- DataBuilder 保留自己的 7 阶段执行引擎（因为建域需要更复杂的加工派生）
- 但缺口诊断标准与 Growth Loop 统一

### 5.7 Registry Snapshot 的构建与缓存

**构建来源**：
```
Connections        → GET /a/v1/connections
Datasets           → GET /a/v1/raw-datasets
ObjectTypes        → GET /a/v1/object-types
Rules              → GET /a/v1/rules
Solvers            → GET /a/v1/solvers
Intents/Plans/...  → GET /b/v1/intents, /b/v1/workflows, ...
```

**缓存策略**：
- Registry 缓存在 AgentCore 内存（或 Redis），TTL 60s
- 任何配置变更（建模发布、规则审批、求解器注册）发 domain event 失效缓存
- GapAnalysisEngine 每次执行前检查缓存，miss 时重建

---

## 6. 与工单系统的衔接

### 6.1 工单模型的扩展

当前 `WorklistItem`：
```typescript
{ id, kind, status, owner, fillPlan? }
```

扩展后：
```typescript
interface UnifiedWorkOrder {
  id: string;
  
  // 来源
  triggerSource: "gap_card" | "data_builder" | "scenario" | "sim_precheck" | "manual" | "validation";
  triggeredBy: { query?: string; script?: string; scenarioId?: string };
  
  // 关联的 GapAnalysis
  gapAnalysisId: string;
  
  // 本工单负责的具体缺口
  targetEntry: GapEntry;
  
  // 状态机（按 strategy 不同）
  status: "OPEN" | "CLAIMED" | "IN_PROGRESS" | "PENDING_APPROVAL" | "DONE" | "BLOCKED";
  
  // 执行上下文
  executionContext: {
    step: number;           // 在 ExecutionPlan 中的位置
    prerequisitesDone: boolean;
    autoFillResult?: any;
  };
  
  owner?: string;
  createdAt: string;
  updatedAt: string;
}
```

### 6.2 工单页面的增强

**当前 TicketCenter 展示**：
- 问题 / 来由 / 缺口码 / 类型 / 状态 / 认领人 / 操作

**增强后展示**：
- **触发点**：哪个入口触发的（对话/场景/预检查/手动）
- **缺口全景**：本查询涉及 N 项缺口，这是第 X 项
- **补齐内容**：具体补什么（对象类型/数据集/求解器/意图）
- **推演过程**：ExecutionPlan 步骤图（当前在第几步）
- **依赖关系**：前置条件是否满足（灰色/高亮）
- **影响分析**：补齐后会影响哪些下游
- **执行操作**：按 strategy 显示不同按钮（自动补/去审批/去导入/需开发）

### 6.3 快捷执行路径

对于 `strategy: "AUTO"` 且 `estimatedEffort: "SECONDS"` 的缺口：
- 允许在工单页面直接点击"自动补齐"（不强制下钻到原页面）
- 后端自动执行，前端轮询状态

对于 `strategy: "MANUAL"` 的缺口：
- 显示操作指引（如"去连接器导入订单数据"）
- 提供深链到对应页面
- 用户完成后，系统检测到 Registry 变更，自动推进工单状态

---

## 7. 实施建议（分阶段）

### Phase 1：GapAnalysis 引擎 MVP（2 周）

**后端**：
- [ ] 设计 `SystemCapabilityRegistry` 聚合查询（AgentCore 代调 DataCore API）
- [ ] 实现 `GapAnalysisEngine` 核心（Step 1-4：Intent Analysis → Requirement Derivation → Registry Snapshot → Complete Diff）
- [ ] 对接 Query 目标类型（服务 Growth Loop）
- [ ] 对接 Script 目标类型（服务 DataBuilder）

**前端**：
- [ ] 在 TicketCenter 新增"诊断新缺口"流程：输入查询 → 展示 GapAnalysis 全景 → 确认后生成工单

### Phase 2：补齐策略与排序（1 周）

**后端**：
- [ ] 实现 Step 5-6：Remediation Strategy + Dependency Sorting
- [ ] 定义各 module kind 的默认策略映射（dataset→MANUAL, solver→DEVELOP, intent→AUTO_WITH_APPROVAL 等）

**前端**：
- [ ] 工单页面展示 ExecutionPlan 步骤图

### Phase 3：影响分析与验证（1 周）

**后端**：
- [ ] 实现 Step 7：Impact Analysis
- [ ] 统一补齐后验证标准（所有补齐完成后自动跑一次 QOS 验证）

**前端**：
- [ ] 工单页面展示影响分析

### Phase 4：入口归集（1 周）

**前端**：
- [ ] GapCard 改为：检测到缺口 → 展示"诊断全景"按钮 → 用户确认后创建工单 → 不再直接 trigger
- [ ] ConnectionsPage/SyntheticPage/ModelingPage 等保留原入口，但执行后自动生成追溯工单（只读）

---

## 8. 附录

### 8.1 术语表

| 术语 | 定义 |
|---|---|
| **GapAnalysis** | 全量缺口分析报告，含 needed/existing/toCreate/missing |
| **GapEntry** | 单个缺口项，含病因、补齐策略、依赖、影响 |
| **ExecutionPlan** | 按依赖排序后的补齐执行步骤 |
| **SystemCapabilityRegistry** | 当前租户系统能力的聚合快照 |
| **Reactive Discovery** | 执行中撞墙再补（当前 Growth Loop 模式） |
| **Complete Pre-Analysis** | 先完整盘点再系统性补齐（当前 DataBuilder 模式） |
| **Root Cause** | 病因（NOT_EXISTS/INCOMPLETE/VERSION_MISMATCH/...） |
| **Symptom** | 症状（GapCode：EMPTY_DATA/NO_RULE/...） |

### 8.2 相关代码文件

| 文件 | 作用 |
|---|---|
| `packages/contracts/src/growth.ts` | Growth Loop 契约 |
| `packages/contracts/src/databuilder.ts` | DataBuilder 契约（含 GapAnalysis） |
| `apps/agentcore/src/growth/loop.ts` | Growth Loop 后端实现 |
| `apps/frontend-shell/src/components/Answer/GapCard.tsx` | In-Dialog 补齐入口 |
| `apps/frontend-shell/src/pages/admin/TicketCenterPage.tsx` | 工单中心 |
| `apps/frontend-shell/src/pages/admin/DataBuilderPage.tsx` | 数据构建发动机 |

---

**待确认事项**：
1. Phase 1 范围是否接受（先做 Query + Script 目标，Scenario 目标延后）？
2. `SystemCapabilityRegistry` 由 AgentCore 聚合还是 DataCore 提供统一端点？
3. 是否接受"AUTO 秒级补齐保留快捷路径，MANUAL/DEVELOP 走工单"的分层策略？

确认后进入详细设计和开发。