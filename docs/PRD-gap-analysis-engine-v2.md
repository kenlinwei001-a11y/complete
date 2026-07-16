# PRD：统一 GapAnalysis 引擎 v2（工业级规格）

> 状态：评审稿（待开发确认）
> 作者：Claude
> 日期：2026-07-08
> 版本：v2.0
> 依赖：PRD-gap-analysis-engine.md（v1 草案）

---

## 1. 修订说明（v1 → v2）

v1 定义了「统一缺口诊断」的方向和工单归集策略，但在**引擎算法内核**上仍显粗糙。v2 吸收外部「Requirement Graph Engine」的成熟设计，将缺口分析从「症状比对」升级为「图验证 + 规则改写 + 优化排序」的工业化流水线。

**v2 核心变更**：
- 引入 **Requirement Graph** 替代原「需求树」，支持关系推导与自动扩展
- 引入 **7-Layer Graph Validator** 替代原「Complete Diff」，输出连续 Coverage Score
- 引入 **Graph Rewrite Engine** 替代原「Remediation Strategy」人工映射，用规则驱动自动补齐推演
- 引入 **Node Importance Score** 解决「先补哪个」的优先级问题
- 引入 **Auto Repair Loop** 统一补齐后验证标准
- 保留 v1 的跨系统架构、工单闭环、前端集成、渐进实施路线

---

## 2. 现状与痛点（精简版）

> 详见 v1 §1–§3。此处仅罗列驱动本 PRD 的 5 条核心痛点：

| 编号 | 痛点 | 根因 |
|---|---|---|
| P1 | 用户不知道系统缺什么 | 无全局能力快照 |
| P2 | 不知道先补哪个 | 补齐顺序=发现顺序≠依赖/重要性顺序 |
| P3 | 重复补齐/无效补齐 | 无补齐必要性判断与影响分析 |
| P4 | 两套 Gap 数据结构不互通 | DataBuilder 与 Growth Loop 各写各的 |
| P5 | 补齐后验证不一致 | 无统一「补完标准」|

---

## 3. 设计目标（G1–G5）

| 目标 | 描述 | 优先级 | v2 解决方式 |
|---|---|---|---|
| **G1** | 统一缺口诊断 | 所有入口共享同一个引擎，输出统一全景报告 | P0 | 7-Layer Validator + Requirement Graph |
| **G2** | 补齐优先级排序 | 基于依赖+影响面+业务重要性自动计算 | P0 | Graph Optimization（Importance Score）|
| **G3** | 补齐前影响分析 | 任何操作执行前预测下游影响 | P1 | Impact Analyzer（基于改写后的全图）|
| **G4** | 补齐后统一验证 | 同一套标准验证是否真正解决 | P1 | Auto Repair Loop（Coverage Score = 1.0）|
| **G5** | 补齐入口归集 | 统一收口到工单系统，保留快捷路径 | P2 | UnifiedWorkOrder + 快捷执行通道 |

---

## 4. 核心概念

### 4.1 System Capability Registry（SCR）

当前租户系统能力的**只读聚合快照**，由 AgentCore 代调 DataCore API 聚合而成。

```typescript
interface SystemCapabilityRegistry {
  tenantId: string;
  snapshotAt: string; // ISO8601

  // 数据层
  connections: ConnectionCapability[];
  datasets: DatasetCapability[];

  // 本体层
  objectTypes: ObjectTypeCapability[];
  slices: SliceCapability[];

  // 规则层
  rules: RuleCapability[];

  // 求解层
  solvers: SolverCapability[]; // 含 ioContract, version

  // 编排层
  intents: IntentCapability[]; // 含绑定的 plan/workflow
  plans: PlanCapability[];
  workflows: WorkflowCapability[];
  skills: SkillCapability[];
  agents: AgentCapability[];
  mcps: McpCapability[];
  scenes: SceneCapability[];

  // 知识层
  kbDocs: KbDocCapability[];

  // 依赖图（由 AgentCore 根据引用关系预计算）
  dependencyGraph: DependencyGraph;
}

interface DependencyGraph {
  nodes: Array<{ id: string; kind: ModuleKind; ref: string }>;
  edges: Array<{ from: string; to: string; relation: "depends_on" | "consumes" | "produces" | "binds_to" }>;
}
```

**构建来源**：
- Connections → `GET /a/v1/connections`
- Datasets → `GET /a/v1/raw-datasets`
- ObjectTypes → `GET /a/v1/object-types`
- Rules → `GET /a/v1/rules`
- Solvers → `GET /a/v1/solvers`
- Intents/Plans/Workflows/Skills/Agents/MCPs → AgentCore 内部状态 / `GET /b/v1/...`

**缓存策略**：
- Registry 缓存在 AgentCore Redis，`key = scr:{tenantId}`，TTL 60s
- 任何配置变更（建模发布、规则审批、求解器注册）发 domain event 失效缓存
- 事件传播路径：DataCore / AgentCore 内部变更 → `kind.updated` event → `POST /b/v1/internal/invalidate` → Redis DEL

### 4.2 Requirement Graph（需求图）

引擎内部的核心数据结构，取代 v1 的「需求树」。

```typescript
interface RequirementGraph {
  target: TargetDescriptor;
  nodes: ReqNode[];
  edges: ReqEdge[];
  metadata: {
    derivationTrace: string[]; // 推导日志，用于可解释性
    confidence: number; // 0~1，LLM 推导置信度
  };
}

interface ReqNode {
  id: string; // 内部节点标识，如 "req://ontology_type/order"
  kind: ModuleKind;
  ref: string; // 目标标识，如 "order"
  layer: LayerKind; // SCHEMA | ONTOLOGY | RELATION | PROPERTY | DATA | CONSTRAINT | SOLVER
  description: string;
  // 业务上下文
  scenarioHint?: string; // 来自 Query/Script/Scenario 的上下文
  // 可复用标记（由 Validator 填充）
  reusableFrom?: string; // 如 "sys://ontology_type/order"
}

interface ReqEdge {
  from: string;
  to: string;
  relation: "requires" | "produces" | "constrains" | "binds_to";
  cardinality: "1:1" | "1:N" | "N:1";
}

type LayerKind = "SCHEMA" | "ONTOLOGY" | "RELATION" | "PROPERTY" | "DATA" | "CONSTRAINT" | "SOLVER";
type ModuleKind =
  | "connection" | "dataset" | "ontology_type" | "slice"
  | "rule" | "solver" | "intent" | "plan" | "workflow"
  | "skill" | "agent" | "mcp" | "scene" | "kb_doc";
```

### 4.3 Coverage Score（覆盖度评分）

**定义**：Requirement Graph 中每个节点在每一层的满足程度，用 0~1 连续值表示。

```typescript
interface CoverageScore {
  overall: number; // 全图加权平均
  nodeScores: Record<string, NodeCoverage>; // key = node.id
}

interface NodeCoverage {
  nodeId: string;
  layerScores: Record<LayerKind, number>; // 各层得分
  overall: number; // 本节点加权平均 = Π(layerScores)（连乘，缺一层即为 0）
  status: "FULL" | "PARTIAL" | "MISSING";
}
```

**计算规则**：
- `layerScores[layer] = 1.0`：该层完全满足
- `layerScores[layer] = 0.0`：该层完全缺失
- `layerScores[layer] ∈ (0,1)`：部分满足（如 Schema 存在但 Property 不完整）
- `NodeCoverage.overall = Π(layerScores)` —— **连乘模型**，强调短板效应
- `CoverageScore.overall = weightedAvg(nodeScores, weight = ImportanceScore)`

**示例**：
- 节点 `ontology_type/order`：Schema=1.0, Property=0.8, Data=0.0 → overall = 0.0（缺数据即不可用）
- 节点 `solver/order_impact`：Schema=1.0, Solver=1.0, Data=1.0 → overall = 1.0（完全可用）

### 4.4 GapEntry（缺口项）

```typescript
interface GapEntry {
  id: string; // 全局唯一，如 "gap://dataset/order_snapshots"
  kind: ModuleKind;
  ref: string;
  layer: LayerKind;

  // 病因分析（双维度）
  rootCause: {
    symptom: GapCode; // v1 兼容：EMPTY_DATA / NO_RULE / SOLVER_NOT_FOUND / ...
    cause: "NOT_EXISTS" | "INCOMPLETE" | "VERSION_MISMATCH" | "DEPENDENCY_MISSING" | "MANUAL_REQUIRED";
    detail: string; // 可解释文本
  };

  // 覆盖度（v2 新增）
  coverage: NodeCoverage;

  // 补齐策略（v2 引入 Rewrite Rule）
  remediation: {
    strategy: "AUTO" | "AUTO_WITH_APPROVAL" | "MANUAL" | "DEVELOP";
    rewriteRule?: string; // 规则标识，如 "ontology.expansion.from_relation"
    action: string; // 人类可读动作描述
    estimatedEffort: "SECONDS" | "MINUTES" | "HOURS" | "DAYS";
    canBeParallel: boolean;
    prerequisites: string[]; // GapEntry.id 列表
  };

  // 影响面
  downstream: string[]; // 补齐后会影响哪些下游模块 ref

  // 可复用性（v2 新增）
  reusableFrom?: string; // 系统已有可复用项的 ref
  reusableSavings?: string; // 复用可节省的动作描述
}
```

### 4.5 ExecutionStep（执行计划）

```typescript
interface ExecutionStep {
  step: number;
  entries: string[]; // GapEntry.id 列表
  rationale: string; // 为什么先执行这些
  parallelGroup: number; // 同 step 内可进一步并行分组（用于前端展示）
  estimatedDurationSeconds: number; // 基于 effort 估算
}
```

---

## 5. GapAnalysis Engine 架构

### 5.1 引擎概览

```
┌─────────────────────────────────────────────────────────────────────┐
│                    GapAnalysis Engine v2                            │
├─────────────────────────────────────────────────────────────────────┤
│  Input: Target (query / script / scenario)                          │
│                     ↓                                               │
│  Step 1: Intent Analysis & Requirement Derivation                   │
│  - 解析目标 → 初始 Requirement Graph                                │
│  - 不明确 → 返回 CLARIFY                                            │
│                     ↓                                               │
│  Step 2: Graph Rewrite（规则驱动扩展）                              │
│  - 应用本体扩展规则、业务规则扩展、因果扩展、数据扩展                 │
│  - 输出补全后的 Requirement Graph                                   │
│                     ↓                                               │
│  Step 3: Registry Snapshot & Graph Assembly                         │
│  - 拉取 SCR，将系统能力挂载为 Graph 中的「已有节点」                │
│  - 构建「需求 vs 现状」对比图                                       │
│                     ↓                                               │
│  Step 4: 7-Layer Graph Validator                                    │
│  - 逐层验证：Schema → Ontology → Relation → Property → Data →       │
│             Constraint → Solver                                     │
│  - 输出 Coverage Score + GapEntry[]                                 │
│                     ↓                                               │
│  Step 5: Remediation Matching                                       │
│  - 为每个 GapEntry 匹配 rewriteRule + strategy                      │
│  - 标记可复用项                                                     │
│                     ↓                                               │
│  Step 6: Graph Optimization（依赖排序 + 重要性排序）                │
│  - 拓扑排序生成 ExecutionStep                                       │
│  - 同层内按 Node Importance Score 降序排列                          │
│                     ↓                                               │
│  Step 7: Impact Analysis                                            │
│  - 基于改写后的全图计算补齐后影响面                                  │
│  - 标记风险等级：HIGH / MEDIUM / LOW                                │
│                     ↓                                               │
│  Step 8: Auto Repair Loop（可选推演）                               │
│  - 模拟执行 AUTO 策略 → 更新虚拟 Registry → 重新验证                │
│  - 输出：哪些缺口可被自动闭合，哪些必须人工介入                      │
│                     ↓                                               │
│  Output: GapAnalysis Report                                         │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 Step 1：Intent Analysis & Requirement Derivation

**输入**：
```typescript
type TargetDescriptor =
  | { kind: "query"; query: string; context?: { base?: string; segment?: string } }
  | { kind: "script"; script: string; seed?: number }
  | { kind: "scenario"; scenarioId: string; triggerQuestion: string };
```

**处理**：
1. **Query 目标**：调用 QOS 的意图识别模块（复用现有 `classify` 逻辑），提取：
   - 目标意图（intent）
   - 涉及的对象类型（object types）
   - 涉及的属性/字段（properties）
   - 隐含的求解需求（solver hints）
2. **Script 目标**：调用 DataBuilder 的 `comprehend` 模块，输出 `BuildPlan`，再转换为 Requirement Graph
3. **Scenario 目标**：加载场景定义，提取场景涉及的全部对象、规则、求解器、工作流

**输出**：初始 Requirement Graph（仅有目标相关的节点和边，尚未扩展）

**边界**：
- 如果意图不明确（如 query 缺少关键槽位），返回 `CLARIFY` 而非继续推导
- 所有推导步骤记录 `derivationTrace`，用于前端「为什么诊断出这个缺口」的可解释性展示

### 5.3 Step 2：Graph Rewrite Engine（规则驱动扩展）

**设计目的**：从「初始需求图」自动推导出「完整需求图」。人类只声明「我要分析订单影响」，系统应自动推导出：订单对象 → 订单数据 → 影响求解器 → 影响规则 → 工作流绑定。

**Rewrite Rule 分类**：

| 规则类别 | 规则标识示例 | 触发条件 | 扩展动作 |
|---|---|---|---|
| 本体扩展 | `ontology.expansion.from_relation` | 图中存在对象类型 A，且 A 与 B 有已知关系 | 自动添加对象类型 B 节点 |
| 本体扩展 | `ontology.expansion.from_solver_contract` | 图中存在求解器 S，S.ioContract 输入类型为 T | 自动添加对象类型 T 节点 |
| 业务规则扩展 | `rule.expansion.from_intent` | 图中存在意图 I，I 的 domain 有已发布规则模板 | 自动添加规则节点 |
| 数据扩展 | `data.expansion.from_ontology` | 图中存在对象类型 T，但无对应数据集 | 自动添加数据集节点 + 连接节点 |
| 因果扩展 | `causal.expansion.from_scenario` | 场景涉及 KSF 关键成功因素 | 自动添加 KSF 关联的求解器/规则 |
| 编排扩展 | `orchestration.expansion.from_solver` | 图中新增求解器 S | 自动检查是否需要绑定意图/计划 |

**规则引擎实现**：
```typescript
interface RewriteRule {
  id: string;
  priority: number; // 规则优先级，高优先先执行
  preconditions: (graph: RequirementGraph) => boolean;
  apply: (graph: RequirementGraph) => ReqNode[]; // 返回新增节点
}
```

**执行策略**：
- 规则按优先级排序，迭代应用直到没有新节点产生（不动点）
- 最大迭代次数 10 次，防止循环扩展
- 新增节点自动与触发节点建立 `requires` 边

**Phase 1 限制**：
- 规则库预置 6 条基础规则（上表）
- 规则扩展结果标记 `confidence < 1.0`，前端展示时带「系统推测」提示
- 租户可自定义规则（Phase 3+）

### 5.4 Step 3：Registry Snapshot & Graph Assembly

1. 从缓存/重建获取 `SystemCapabilityRegistry`
2. 将 Registry 中的每个能力项转换为 Graph 中的「系统节点」（`sys://` 前缀）
3. 对比「需求节点」（`req://` 前缀）与「系统节点」：
   - 完全匹配 → 标记为 `reusableFrom = sys://...`
   - 部分匹配 → 标记为 `NEEDS_UPGRADE`（版本不匹配或属性缺失）
   - 无匹配 → 标记为 `MISSING`

### 5.5 Step 4：7-Layer Graph Validator

**验证层次**（严格自上而下，上层不满足下层不验证）：

```
Layer 1: Schema        — 数据库表/连接器结构是否存在
Layer 2: Ontology      — 对象类型是否已定义
Layer 3: Relation      — 对象间关系是否已定义
Layer 4: Property      — 对象属性/字段是否完整
Layer 5: Data          — 实际数据是否非空/可达
Layer 6: Constraint    — 规则/约束是否覆盖
Layer 7: Solver        — 求解器是否注册且契约满足
```

**逐层验证逻辑**：

| 层 | 通过条件 | 失败时的 GapCode | 权重 |
|---|---|---|---|
| Schema | 连接器配置中存在对应表/主题 | EMPTY_DATA | 0.10 |
| Ontology | `objectTypes` 中存在该类型 | NO_SLICE / SHAPE_MISMATCH | 0.15 |
| Relation | `slices` 中存在该关系定义 | NO_SLICE | 0.10 |
| Property | 字段数 ≥ 需求字段数的 80% | SHAPE_MISMATCH | 0.15 |
| Data | 数据集 rowCount > 0 且最后同步 < 7d | EMPTY_DATA | 0.20 |
| Constraint | 规则覆盖率 ≥ 需求场景的 80% | NO_RULE | 0.15 |
| Solver | 求解器存在 + ioContract 输入满足 | SOLVER_NOT_FOUND | 0.15 |

**Coverage Score 计算**：
```typescript
function computeNodeCoverage(node: ReqNode, registry: SCR): NodeCoverage {
  const layerScores: Record<LayerKind, number> = {
    SCHEMA: validateSchema(node, registry),
    ONTOLOGY: validateOntology(node, registry),
    RELATION: validateRelation(node, registry),
    PROPERTY: validateProperty(node, registry),
    DATA: validateData(node, registry),
    CONSTRAINT: validateConstraint(node, registry),
    SOLVER: validateSolver(node, registry),
  };

  // 连乘模型（缺一层即整体不可用）
  const overall = Object.values(layerScores).reduce((a, b) => a * b, 1);

  return {
    nodeId: node.id,
    layerScores,
    overall,
    status: overall >= 1.0 ? "FULL" : overall > 0 ? "PARTIAL" : "MISSING",
  };
}
```

**GapEntry 生成**：
- 对 `overall < 1.0` 的节点，按「最深层失败」原则生成 GapEntry
- 如果同一节点多层失败，只生成一个 GapEntry，`rootCause.detail` 列出所有失败层

### 5.6 Step 5：Remediation Matching

**默认策略映射**（可按租户配置覆盖）：

| ModuleKind | 默认 Strategy | RewriteRule | Effort |
|---|---|---|---|
| connection | MANUAL | — | MINUTES |
| dataset | MANUAL | `data.expansion.from_ontology` | MINUTES |
| ontology_type | AUTO | `ontology.expansion.from_relation` | SECONDS |
| slice | AUTO | `ontology.expansion.from_relation` | SECONDS |
| rule | AUTO_WITH_APPROVAL | `rule.expansion.from_intent` | SECONDS |
| solver | DEVELOP | — | DAYS |
| intent | AUTO_WITH_APPROVAL | `orchestration.expansion.from_solver` | SECONDS |
| plan | AUTO | — | SECONDS |
| workflow | AUTO_WITH_APPROVAL | — | MINUTES |
| skill | MANUAL | — | HOURS |
| agent | MANUAL | — | HOURS |
| mcp | MANUAL | — | MINUTES |

**可复用优先**：
- 如果 `reusableFrom` 存在，strategy 降级为 `AUTO`（无需审批），`action` 改为「复用已有...」

### 5.7 Step 6：Graph Optimization

**两步排序**：

1. **拓扑排序**：基于 `prerequisites`（GapEntry 间的依赖）生成 DAG，按拓扑层分组
2. **重要性排序**：同层内按 Node Importance Score 降序

**Node Importance Score 计算**：
```typescript
function computeImportance(node: ReqNode, graph: RequirementGraph): number {
  const businessWeight = node.scenarioHint ? 1.5 : 1.0; // 是否被场景直接引用
  const centrality = computeBetweennessCentrality(node.id, graph); // 图中介中心性
  const solverWeight = node.kind === "solver" ? 2.0 : 1.0; // 求解器节点权重更高
  const historicalWeight = getHistoricalQueryFrequency(node.ref); // 历史上被查询命中次数（Phase 2+）

  return businessWeight * centrality * solverWeight * historicalWeight;
}
```

**Phase 1 简化**：historicalWeight 默认为 1.0（不接入 QOS 日志）

### 5.8 Step 7：Impact Analysis

**计算逻辑**：
1. 假设当前 GapEntry 被补齐（在虚拟 Graph 中标记为 FULL）
2. 重新计算所有下游节点的 Coverage Score
3. 找出「因补齐本项而状态改变」的下游节点
4. 标记风险：
   - **HIGH**：下游工作流/意图从 FULL 变为 NEEDS_UPGRADE（破坏性变更）
   - **MEDIUM**：下游求解器缓存需失效
   - **LOW**：仅统计数字变化，无功能影响

### 5.9 Step 8：Auto Repair Loop（可选推演）

**目的**：在正式执行前，模拟跑完所有 `strategy: "AUTO"` 的补齐动作，提前发现「自动补齐后是否还有缺口」。

```typescript
function autoRepairLoop(
  gaps: GapEntry[],
  registry: SCR,
  maxIterations = 3
): AutoRepairResult {
  let virtualRegistry = cloneDeep(registry);
  let remaining = gaps.filter(g => g.remediation.strategy === "AUTO");
  let iterations = 0;

  while (remaining.length > 0 && iterations < maxIterations) {
    // 模拟执行 AUTO 项
    for (const gap of remaining) {
      virtualRegistry = simulateApply(gap, virtualRegistry);
    }

    // 重新验证
    const revalidated = validator.validate(graph, virtualRegistry);
    remaining = revalidated.filter(g => g.remediation.strategy === "AUTO");
    iterations++;
  }

  return {
    wasAutoRepaired: iterations > 0,
    repairIterations: iterations,
    remainingGaps: remaining, // 仍需人工/开发的缺口
    converged: remaining.length === 0,
  };
}
```

**启用条件**：
- 默认关闭（`autoRepair: false`）
- DataBuilder / Scenario 预检查场景可开启（`autoRepair: true`）

---

## 6. 输出结构

### 6.1 GapAnalysis Report

```typescript
interface GapAnalysis {
  id: string; // 报告唯一标识（用于关联工单）
  target: TargetDescriptor;
  createdAt: string;

  // 覆盖度总览
  coverage: CoverageScore;

  // 缺口清单
  entries: GapEntry[];

  // 统计
  totals: {
    needed: number;
    existing: number;
    toCreate: number;
    missing: number;
    reusable: number;
    autoRepairable: number; // v2 新增：AUTO 策略可闭合的数量
  };

  // 执行计划
  executionPlan: ExecutionStep[];

  // 影响分析
  impactAnalysis: ImpactReport;

  // 自动推演结果（仅当 autoRepair=true 时存在）
  autoRepair?: AutoRepairResult;

  // 可解释性
  derivationTrace: string[];
}

interface ImpactReport {
  risks: Array<{
    module: string;
    moduleKind: ModuleKind;
    risk: string;
    severity: "HIGH" | "MEDIUM" | "LOW";
    mitigation?: string;
  }>;
  affectedWorkflows: string[];
  affectedIntents: string[];
  affectedSolvers: string[];
}

interface AutoRepairResult {
  wasAutoRepaired: boolean;
  repairIterations: number;
  remainingGaps: GapEntry[];
  converged: boolean;
}
```

---

## 7. 与现有系统集成

### 7.1 与 Growth Loop 集成（对话补齐）

**当前流**：
```
probe() → gapReport → fill(topFinding) → probe() → ...（最多 K 轮）
```

**集成后流**：
```
┌─────────────────────────────────────────────────────────────────┐
│  Round 0: PRE_ANALYSIS                                          │
│  - 调用 GapAnalysisEngine({ kind: "query", query })             │
│  - 返回 CLARIFY → 走 B1 澄清门                                  │
│  - 返回 GapAnalysis → 展示诊断全景                              │
│    "系统诊断：涉及 7 项能力，2 项就绪，3 项可自动补，             │
│     2 项需人工。预计 4 步完成。是否开始补齐？"                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓ 用户确认
┌─────────────────────────────────────────────────────────────────┐
│  Round 1..N: SYSTEMATIC_FILL                                    │
│  - 按 ExecutionPlan 逐 step 执行                                │
│  - Step 内并行执行 AUTO 项                                      │
│  - MANUAL/DEVELOP 项生成 UnifiedWorkOrder                       │
│  - 每轮结束后刷新 Registry Snapshot                             │
│  - CoverageScore.overall === 1.0 → CONVERGED                   │
│  - 存在未完成 MANUAL/DEVELOP → NEEDS_HUMAN                     │
└─────────────────────────────────────────────────────────────────┘
```

**关键变化**：
- `MAX_ROUNDS` 从「硬止损」变为「防呆兜底」（默认 8 轮，实际应提前收敛）
- `NEEDS_HUMAN` 是终态而非失败态
- GapCard UI 从「直接 trigger」改为「展示诊断全景 → 用户确认 → 创建工单」

### 7.2 与 DataBuilder 集成（域级构建）

**当前**：DataBuilder 自有 `GapAnalysis` 实现，7 阶段瀑布流独立运行。

**集成后**：
1. DataBuilder 的 `gap` 阶段调用 **GapAnalysisEngine**，输入 `{ kind: "script", script }`
2. 复用统一的 Coverage Score / GapEntry / ExecutionStep 数据结构
3. DataBuilder 保留 7 阶段执行引擎（建域需要复杂的加工派生）
4. DataBuilder 的 ClosureReport 增加 Coverage Score 验证（`overall >= 0.95` 视为通过）

### 7.3 与 TicketCenter / 工单系统集成

**UnifiedWorkOrder 扩展**：

```typescript
interface UnifiedWorkOrder {
  id: string;
  triggerSource: "gap_card" | "data_builder" | "scenario" | "sim_precheck" | "manual" | "validation";
  triggeredBy: { query?: string; script?: string; scenarioId?: string };
  gapAnalysisId: string; // 关联完整报告
  targetEntry: GapEntry; // 本工单负责的缺口

  // 状态机（按 strategy 不同流转）
  status: "OPEN" | "CLAIMED" | "IN_PROGRESS" | "PENDING_APPROVAL" | "DONE" | "BLOCKED" | "CANCELLED";

  // 执行上下文
  executionContext: {
    step: number;
    prerequisitesDone: boolean;
    autoFillResult?: any;
    coverageBefore: number; // 补齐前覆盖度
    coverageAfter?: number; // 补齐后覆盖度
  };

  owner?: string;
  createdAt: string;
  updatedAt: string;
  dueDate?: string; // 基于 estimatedEffort 计算
}
```

**工单页面增强**：
- **缺口全景**：本查询涉及 N 项缺口，这是第 X 项
- **执行步骤图**：ExecutionPlan 可视化（当前在第几步）
- **依赖关系**：前置工单状态（灰色/高亮）
- **影响分析**：补齐后会影响哪些下游（带风险等级）
- **快捷操作**：
  - `AUTO` + `SECONDS` → 工单页直接点击「自动补齐」
  - `MANUAL` → 显示操作指引 + 深链到对应页面
  - `DEVELOP` → 显示开发需求模板（可一键复制到 Jira/Linear）

### 7.4 与 Scenario / SimInitWizard 集成

场景预检查（沙盘启动前）调用 GapAnalysisEngine：
- 输入 `{ kind: "scenario", scenarioId, triggerQuestion }`
- 开启 `autoRepair: true`
- 输出展示：场景涉及的全部缺口 + 自动推演结果
- 用户可一键「补齐并启动沙盘」（按 ExecutionPlan 自动执行 AUTO 项，MANUAL 项并行生成工单）

---

## 8. 前端 UI 设计

### 8.1 GapAnalysis 结果展示组件

**GapAnalysisDashboard**（复用于 GapCard / TicketCenter / DataBuilder / Scenario 预检查）：

```
┌─────────────────────────────────────────────────────────────┐
│  诊断目标：「常州影响哪些订单？」                              │
│  覆盖度：[████████░░] 71% (5/7 层)                          │
├─────────────────────────────────────────────────────────────┤
│  缺口清单（按执行步骤分组）                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Step 1 · 数据层（必须先有数据）                       │   │
│  │ ⚠️  dataset/order_snapshots    状态: TO_CREATE      │   │
│  │     病因：对象类型存在但无数据源连接                   │   │
│  │     策略：MANUAL · 预计 5 分钟                        │   │
│  │     [去导入数据]                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Step 2 · 求解层                                       │   │
│  │ 🔴 solver/order_impact          状态: MISSING       │   │
│  │     病因：无订单影响分析求解器                        │   │
│  │     策略：DEVELOP · 预计 2 天                         │   │
│  │     [复制开发需求] [创建工单]                         │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Step 3 · 编排层（可并行）                             │   │
│  │ ⚠️  intent/order_impact         状态: TO_CREATE     │   │
│  │     病因：求解器存在但无对应意图覆盖                  │   │
│  │     策略：AUTO_WITH_APPROVAL · 预计 10 秒            │   │
│  │     [自动生成草稿并审批]                             │   │
│  └─────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│  影响分析                                                     │
│  ⚠️ 补齐 solver/order_impact 后，workflow/sop_balance     │
│     需重新验证（风险等级：MEDIUM）                          │
├─────────────────────────────────────────────────────────────┤
│  [开始系统性补齐]  [仅处理 AUTO 项]  [导出诊断报告]          │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 ExecutionPlan 可视化

复用项目已有的 DAG 组件（`LayeredDag` / `ProcessDag`）：
- 节点 = GapEntry
- 颜色 = status（FULL=绿, TO_CREATE=琥珀, MISSING=红, NEEDS_UPGRADE=蓝）
- 边 = prerequisites 依赖
- 层级 = step 编号
- 点击节点 → 下钻 GapEntry 详情面板

### 8.3 各入口改造对照

| 入口 | 当前行为 | 改造后行为 |
|---|---|---|
| GapCard | 检测到缺口 → 直接 trigger 补齐 | 检测到缺口 → 展示「诊断全景」按钮 → 跳转 GapAnalysisDashboard → 确认后创建工单 |
| TicketCenter | 展示单条工单，无全局视图 | 工单列表 + 点击后展示关联的 GapAnalysisDashboard（带步骤图） |
| DataBuilder | 自有 GapAnalysis，7 阶段瀑布 | 复用 GapAnalysisEngine，保留 7 阶段执行，ClosureReport 增加 Coverage Score |
| Scenario/Sim | 无预检查 | 启动前调用 GapAnalysisEngine（autoRepair=true），展示缺口全景 |
| ConnectionsPage | 无诊断，直接同步 | 保留直接同步，但执行后生成追溯工单（只读） |
| SyntheticPage | 无诊断，直接合成 | 保留直接合成，但执行后生成追溯工单（只读） |

---

## 9. API 契约

### 9.1 GapAnalysis Engine 服务接口

由 AgentCore 提供（端口 4002）：

```typescript
// POST /b/v1/gap-analysis
interface GapAnalysisRequest {
  target: TargetDescriptor;
  options?: {
    autoRepair?: boolean; // 默认 false
    maxRepairIterations?: number; // 默认 3
    includeDerivationTrace?: boolean; // 默认 false（调试开）
  };
}

// Response: GapAnalysis（见 §6.1）
// Error: { error: { code: "CLARIFY_NEEDED" | "TARGET_TOO_VAGUE" | "REGISTRY_UNAVAILABLE", message, requestId } }
```

### 9.2 Registry 刷新接口

```typescript
// POST /b/v1/internal/invalidate
// Body: { kinds: ModuleKind[], tenantId: string }
// 由 DataCore / AgentCore 内部变更时调用，失效 SCR 缓存
```

### 9.3 工单创建接口（扩展）

```typescript
// POST /b/v1/workorders
interface CreateWorkOrderRequest {
  triggerSource: UnifiedWorkOrder["triggerSource"];
  triggeredBy: UnifiedWorkOrder["triggeredBy"];
  gapAnalysisId: string;
  targetEntryId: string; // GapEntry.id
  owner?: string;
}
```

---

## 10. 数据持久化

### 10.1 GapAnalysis Report 存储

```sql
-- AgentCore 数据库新增表
create table gap_analysis_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  target_kind text not null, -- query / script / scenario
  target_query text,
  target_script text,
  target_scenario_id text,
  coverage_overall numeric(3,2), -- 0.00 ~ 1.00
  totals jsonb not null, -- { needed, existing, toCreate, missing, reusable, autoRepairable }
  execution_plan jsonb not null,
  impact_analysis jsonb,
  auto_repair_result jsonb,
  derivation_trace jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_gap_reports_tenant on gap_analysis_reports(tenant_id, created_at desc);
```

### 10.2 UnifiedWorkOrder 表改造

```sql
-- 扩展现有 work_orders 表（或新建 unified_work_orders）
-- 新增字段：
-- gap_analysis_id uuid references gap_analysis_reports(id)
-- target_entry jsonb -- 序列化的 GapEntry
-- execution_context jsonb
-- coverage_before numeric(3,2)
-- coverage_after numeric(3,2)
```

---

## 11. 实施路线图

### Phase 1：GapAnalysis Engine Core（3 周）

**Week 1：Registry + Requirement Graph**
- [ ] 实现 `SystemCapabilityRegistry` 聚合查询（AgentCore 代调 DataCore API）
- [ ] 实现 Registry Snapshot 缓存（Redis，TTL 60s + 事件失效）
- [ ] 定义 `RequirementGraph` / `ReqNode` / `ReqEdge` 数据结构
- [ ] 实现 `Intent Analysis & Requirement Derivation`（Query 类型）

**Week 2：Validator + Coverage Score**
- [ ] 实现 7-Layer Graph Validator（7 层验证逻辑）
- [ ] 实现 Coverage Score 计算（连乘模型）
- [ ] 实现 GapEntry 生成（含 rootCause + symptom 双维度）
- [ ] 对接 Script 目标类型（DataBuilder）

**Week 3：Rewrite + Optimization + API**
- [ ] 实现 Graph Rewrite Engine（预置 6 条基础规则）
- [ ] 实现 Graph Optimization（拓扑排序 + Importance Score）
- [ ] 实现 `POST /b/v1/gap-analysis` API
- [ ] 前端 `GapAnalysisDashboard` 基础组件（结果展示 + 步骤图）
- [ ] 回归测试：Growth Loop / DataBuilder / TicketCenter 原有功能不受损

### Phase 2：补齐闭环与工单集成（2 周）

**Week 4：Remediation + WorkOrder**
- [ ] 实现 Remediation Matching（策略映射 + 可复用检测）
- [ ] 扩展 `UnifiedWorkOrder` 数据模型
- [ ] 改造 TicketCenter 页面（展示 GapAnalysis 全景 + 步骤图 + 依赖关系）
- [ ] 实现快捷执行路径（AUTO 秒级补齐在工单页直接触发）

**Week 5：Impact Analysis + Auto Repair**
- [ ] 实现 Impact Analysis（虚拟补齐 → 下游重算）
- [ ] 实现 Auto Repair Loop（可选推演）
- [ ] 改造 GapCard（从直接 trigger 改为展示诊断全景 → 创建工单）
- [ ] 改造 Scenario / SimInitWizard（启动前预检查）

### Phase 3：入口归集与高级特性（2 周）

**Week 6：入口归集**
- [ ] ConnectionsPage / SyntheticPage / ModelingPage 执行后自动生成追溯工单
- [ ] 所有 Admin 操作（规则审批、模型发布）触发 Registry 缓存失效
- [ ] 前端统一「诊断新缺口」入口（TicketCenter 新增按钮）

**Week 7：高级特性**
- [ ] Historical Query Frequency 接入（Node Importance 的 historicalWeight）
- [ ] 租户级 Rewrite Rule 自定义接口
- [ ] Coverage Score 趋势看板（租户能力成熟度仪表盘）
- [ ] 性能优化：Registry 增量更新（避免全量重建）

**总计：7 周**

---

## 12. 验收标准

### 12.1 功能验收

| 编号 | 验收项 | 通过标准 |
|---|---|---|
| AC-1 | Query 目标诊断 | 输入「常州影响哪些订单？」，返回 GapAnalysis，包含 dataset + solver + intent 缺口，CoverageScore.overall < 1.0 |
| AC-2 | Script 目标诊断 | 输入 DataBuilder 脚本，返回 GapAnalysis，与 DataBuilder 原有 gap 阶段输出等价（Coverage Score 偏差 < 5%）|
| AC-3 | 执行计划排序 | ExecutionPlan 中 dataset 必须在 solver 之前，solver 必须在 intent 之前（拓扑正确）|
| AC-4 | AUTO 补齐闭环 | strategy=AUTO 的 GapEntry 在工单页点击后 5 秒内完成，工单状态变为 DONE |
| AC-5 | 影响分析准确 | 补齐 solver 后，ImpactReport 正确列出受影响的 workflow（与 dependencyGraph 一致）|
| AC-6 | Registry 缓存一致 | 建模发布后 60s 内，新 GapAnalysis 能反映最新模型（缓存失效生效）|
| AC-7 | Auto Repair 推演 | 开启 autoRepair 后，返回 converged=true 时 remainingGaps 中无 AUTO 项 |

### 12.2 性能验收

| 编号 | 验收项 | 通过标准 |
|---|---|---|
| AC-P1 | Query 诊断延迟 | P99 < 2s（含 Registry Snapshot + Validator + Optimization）|
| AC-P2 | Script 诊断延迟 | P99 < 5s（含 comprehend + Rewrite + Validator）|
| AC-P3 | Registry 重建 | 冷启动全量重建 < 10s |
| AC-P4 | 并发查询 | 100 并发 Query 诊断，AgentCore 内存 < 2GB，无 OOM |

### 12.3 兼容性验收

| 编号 | 验收项 | 通过标准 |
|---|---|---|
| AC-C1 | Growth Loop 回归 | 原有 `probe() → gapReport → fill()` 流在无 PRE_ANALYSIS 开关关闭时行为不变 |
| AC-C2 | DataBuilder 回归 | 原有 7 阶段瀑布流输出不变，ClosureReport 新增 Coverage Score 字段（向后兼容）|
| AC-C3 | TicketCenter 回归 | 原有 WorklistItem 列表/认领/状态机行为不变 |

---

## 13. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| Rewrite Rule 扩展过度 | 生成大量无效节点，诊断报告膨胀 | 限深 3 层，confidence < 0.7 的推测节点默认折叠 |
| Registry 全量重建过慢 | 大租户对象类型 1000+，重建 >10s | Phase 3 引入增量更新；Phase 1 允许 10s 内完成 |
| Coverage Score 计算不一致 | DataBuilder 与 Growth Loop 对同一系统状态评分不同 | 统一 Validator 实现，禁止各入口自定义评分逻辑 |
| 人工抗拒新流程 | GapCard 从一键补齐变为多步确认，用户觉得麻烦 | AUTO + SECONDS 的项保留「一键补齐」快捷按钮（在诊断页直接执行，不强制下钻工单）|
| 跨系统事件丢失 | DataCore 发了 updated 事件但 AgentCore 没收到，缓存 stale | Registry 增加 `snapshotAt` 字段，前端展示「数据快照时间」；超过 5 分钟可手动刷新 |

---

## 14. 附录

### 14.1 术语表

| 术语 | 定义 |
|---|---|
| **SCR** | System Capability Registry，当前租户系统能力聚合快照 |
| **Requirement Graph** | 需求图，引擎内部用图结构表达目标所需的全部能力节点及关系 |
| **Coverage Score** | 覆盖度评分，0~1 连续值，衡量需求节点各层满足程度 |
| **Layer** | 验证层，共 7 层：Schema / Ontology / Relation / Property / Data / Constraint / Solver |
| **Rewrite Rule** | 图改写规则，用于从已有节点自动推导扩展新需求节点 |
| **Node Importance Score** | 节点重要性分，决定同层补齐的优先级 |
| **Auto Repair Loop** | 自动修复推演，模拟执行 AUTO 策略后重新验证 |
| **Reactive Discovery** | 撞墙再补（原 Growth Loop 模式） |
| **Complete Pre-Analysis** | 先完整盘点再系统性补齐（原 DataBuilder 模式） |

### 14.2 相关文件索引

| 文件 | 作用 |
|---|---|
| `packages/contracts/src/growth.ts` | Growth Loop 契约 |
| `packages/contracts/src/databuilder.ts` | DataBuilder 契约 |
| `packages/contracts/src/qos.ts` | QOS 编排契约 |
| `apps/agentcore/src/growth/loop.ts` | Growth Loop 后端实现 |
| `apps/agentcore/src/qos/...` | QOS 编排器 |
| `apps/frontend-shell/src/components/Answer/GapCard.tsx` | In-Dialog 补齐入口 |
| `apps/frontend-shell/src/pages/admin/TicketCenterPage.tsx` | 工单中心 |
| `apps/frontend-shell/src/pages/admin/DataBuilderPage.tsx` | 数据构建发动机 |
| `docs/PRD-gap-analysis-engine.md` | v1 草案（本 PRD 的前置文档） |

### 14.3 待确认事项（阻塞开发）

1. **Phase 1 范围**：先做 Query + Script 目标，Scenario 目标延后到 Phase 2？
2. **Registry 托管**：由 AgentCore 聚合（本 PRD 假设）还是 DataCore 提供统一 `/a/v1/capability-registry` 端点？
3. **Rewrite Rule 库**：Phase 1 预置 6 条规则是否足够？租户自定义规则是否 Phase 3 再做？
4. **AUTO 快捷路径**：`AUTO` + `SECONDS` 的缺口允许在诊断页直接执行（不创建工单），是否接受？
5. **Coverage Score 短板模型**：当前用连乘（缺一层即为 0），是否接受？或改为加权平均？

---

**确认以上 5 项后，即可进入开发阶段。**
