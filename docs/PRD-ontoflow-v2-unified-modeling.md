# PRD v2 — OntoFlow 统一本体建模工作流（数据先行 ⊕ 图谱先行）

> 版本 v2.0 · 状态 DRAFT · 取代并扩展 `PRD-ontoflow-data-builder.md`(v1，仅数据先行)。
> 目标读者：在本仓库（DataCore A + AgentCore B + frontend-shell）上开发的实现 agent。
> 先读：根 `CLAUDE.md`(约定铁律)、`docs/DATA-BUILDER-PIPELINE.md`(现有数据管线节点图)、v1 PRD。
> 本文把 **模式一(数据先行)** 与 **模式二(图谱先行)** 统一成**一套数据模型 + 一张画布**，并把每项能力锚定到**现有模块**(复用/扩展)。

---

## 0. 核心思想：两模式 = 同一本体的两个入口

```
                ┌──────────────── 同一产物：本体(types/links/slices) + 对象库 ────────────────┐
模式一 数据先行 ─┤ 数据选择→源表→数据处理→实体/关系→本体库  (数据长出本体)                       │
模式二 图谱先行 ─┤ 先画实体/关系→每节点补 数据源+数据处理→提升为本体图谱→生成应用→发布→推演    │
                └──────────────────────────────────────────────────────────────────────────┘
```

**统一关键**：两模式都落到同一个 `OntologyWorkflow`(画布) + 同一个 `EntityNode`。区别只是**起点/填充顺序**：
- 数据先行：先有上游 `SOURCE→PROCESS`，实体由其"长出来"。
- 图谱先行：先放 `EntityNode`(画结构)，再在每个实体节点上**内嵌** `数据源 + 数据处理`(= 模式一的能力),最后"提升为本体图谱"。

**两处一等开关**：
- 画布级 `entryMode: DATA_FIRST | GRAPH_FIRST`(默认入口体验，可混用)。
- 节点级 `storageMode: STATIC | ONTOLOGY`(静态图谱 ↔ 本体图谱) + `promote` 动作。

> 因此每个 `EntityNode` 含**三类配置**(对应第二张截图)：`数据源`(数据从哪来) / `数据处理`(清洗/聚合) / `子图建模`(属性·派生·函数·行动·安全·状态变量)。这三类正是模式一管线被"折叠进节点"的结果——**这就是融合**。

---

## 1. 目标 / 非目标

### 1.1 目标
1. 一张可视化画布同时支持 **数据先行** 与 **图谱先行**，并可混用；产物统一为本体 + 对象库。
2. 每个实体节点三配置：数据源 / 数据处理(逐属性映射+聚合 Last/Sum/Max/Min/Avg/Count、分组+窗口、失效、脱敏、行动) / 子图建模(属性·类型·派生·函数·行动·安全·状态变量)。
3. 节点级 `storageMode` 静态/本体切换 + `promote` 提升(静态图谱 → 本体图谱)。
4. **生成应用功能**：从已发布本体 scaffold 视图 / 场景入口 + 默认 Agent / 场景包 / 求解器绑定。
5. **推演立即可用**：发布后通用推演(切片检索 + 规则评估 + 聚合 + 通用 what-if)对任意本体可用；领域求解器可插拔。
6. 支持 Excel(.xlsx) 源；局部仿真准备度评分。
7. **全程复用并融入现有模块**(连接器/建模/本体/切片/聚合/Action/A6/视图/Agent/场景)，真值写入经 Action 审批，多租户隔离，确定性可重跑。

### 1.2 非目标
- 实时流式摄取(本期批量增量折叠)；多人实时协同画布；跨租户模板市场；自动发明领域求解器(仅通用推演 + 可插拔领域求解器)。

---

## 2. 统一数据模型（契约 `packages/contracts/src/pipeline.ts`，zod；`index.ts` export *）

```
OntologyWorkflow {                       // 一条命名本体工作流（= 画布）
  id, tenantId, name, entryMode: "DATA_FIRST"|"GRAPH_FIRST",
  status: "DRAFT"|"PUBLISHED", nodes: WfNode[], edges: {from,to}[], updatedAt
}
WfNode = SourceSelectNode | SourceTableNode | ProcessNode | EntityNode | LinkNode | OntologySinkNode

EntityNode {                              // 两模式共用的核心节点
  id, kind:"SUBGRAPH_ENTITY", label, position{x,y},
  storageMode: "STATIC"|"ONTOLOGY",       // 静态图谱 ↔ 本体图谱
  modeling: {                             // 子图建模（本体构建 6 页）
    typeKey, displayName, domain, primaryKey, entityType?,   // entityType=如 人/传感器/银行卡
    properties: PropertyDef[],            // 属性（复用 domain.ts PropertyDef）
    stateVariables: StateVarDef[],        // 状态变量（事件折叠产物）
    derived: DerivedPropertyDef[],        // 派生（复用）
    functions?: FnDef[],                  // 函数（如 adjustCapacity）—— 新增
    actions?: { actionTypeKey: string }[],// 行动（绑定 S2 ActionType）—— 新增
    security?: MaskRule[],                // 安全/脱敏（逐属性）—— 新增
    readinessTarget?: number
  },
  dataSource?: { rawDatasetId?: string, connId?: string, role:"event"|"master" },  // 数据源（复用 sourceBindings 语义）
  processing?: ProcessingSpec             // 数据处理（见 §2.1；图谱先行内嵌、数据先行来自上游 PROCESS）
}
LinkNode { id, kind:"SUBGRAPH_LINK", linkKey, fromTypeKey, toTypeKey, cardinality, fk, storageMode }
```

### 2.1 ProcessingSpec（数据处理，v1 §4.3 沿用）
```
ProcessingSpec {
  mappings: AttributeMapping[]   // sourceField→targetProp + dataType + fn(Last/First/Sum/Max/Min/Avg/Count) + isPrimaryKey? + isStateVariable?
  groupBy?: { fields:[], window?:{field,step} }   // 选择分组(event_date+1)
  expiry?: { field, ttlDays }                      // 失效规则
  masking?: MaskRule[]                             // 属性脱敏
  actionBindings?: { actionTypeKey, on:"GROUP"|"ENTITY" }[]  // 选择行动(delayOrder)
  mode: "BATCH"|"INCREMENTAL"   // 本期 BATCH；INCREMENTAL 预留
}
StateVarDef { propKey, fromField, fn, dataType }   // 由事件表折叠（如 order_risk = Max(event.risk)）
FnDef { name, returns, expr|builtin }              // 类型级函数（推演可调用）
MaskRule { prop, strategy:"HASH"|"REDACT"|"PARTIAL", scopeRoles? }
```

---

## 3. 模块关联（本体工作流 ↔ 现有系统）—— 实现 agent 必须复用这些接缝

```
OntologyWorkflow(新)
  ├ SOURCE_SELECT/TABLE ──复用──> connectors/{registry,parsers(+xlsx),profiler}.ts  → RawDataset
  ├ PROCESS ─────────────复用──> 抽 timeseries reducer 为 fold() ；+ ProcessingEngine(新)
  ├ EntityNode.modeling ─复用──> modeling.ts(draft/publish/materialize) + ontology.upsertType + domain.ts ObjectTypeDef(扩展)
  ├ EntityNode.derived ──复用──> A4 派生 DSL(runDerivations)
  ├ EntityNode.stateVar ─复用──> timeseries 折叠语义 / object_prop_history(temporal)
  ├ LinkNode ────────────复用──> ontology.upsertLinkType
  ├ ONTOLOGY_SINK/切片 ──复用──> ontology-core.putSliceSpec + 对象库 repos.objects
  ├ 物化(写真值) ────────复用──> app.ts domainExecutor(Phase9B「对象数据变更」范式) + Action 审批
  ├ 异常行 ──────────────复用──> quarantine.ts + /quarantine/:id/reprocess
  ├ 数据源凭据 ──────────复用──> AES-GCM(CREDENTIAL_KEY) + credentialRef
  ├ 安全/脱敏读出 ───────复用──> authz(A6 rowFilter) + 新增 masking 读出切面
  ├ 生成应用功能 ────────复用──> synthetic/service.ts seedViewConfigs / scenarioPackages / 场景入口(/b/v1/scene-entries) / Agent(/b/v1/agents)（泛化为 scaffold）
  └ 推演 ────────────────复用──> ontology/slices resolve + rules evaluate + objects/aggregate + 通用 what-if(新) ；领域求解器 solvers(可插拔)
```

**对照「现状(✓/◐/✗)」(已实查)**：

| 能力 | 现状 | 锚点 |
|---|---|---|
| 图谱先行：直接建类型/链路(无数据) | ✓ | `ontology.upsertType/upsertLinkType/publishVersion`、`POST /a/v1/ontology/object-types` |
| 数据源绑定到类型 | ✓ | `ObjectTypeDef.sourceBindings` |
| 派生 | ✓ | `ObjectTypeDef.derivedProperties` + A4 |
| 属性/枚举/temporal | ✓ | `PropertyDef` |
| 数据先行管线(连接器→源表→建模→本体) | ◐ 批量/表单 | connectors + modeling + ontology |
| Excel 解析 | ✗ | `parsers.ts`/`registry.ts:172` TODO |
| 数据处理(聚合/分组/失效/脱敏/行动) | ✗ | 无；TS_AGGREGATE 仅时序 |
| 状态变量(事件折叠 + writeback) | ✗ | 仅 temporal 历史 |
| 类型级 函数/行动/安全 | ✗ | 行动是独立 ActionType；无类型级函数/脱敏 |
| storageMode 静态/本体 + promote | ✗ | `ObjectTypeDef` 无 storageMode |
| 生成应用功能(从图谱) | ◐ 种子化 | seedViewConfigs(电池专用)，非任意图谱生成 |
| 推演通用化(任意本体) | ◐ 受限 | 切片/规则/聚合通用；22 求解器电池专用 |
| 可编辑画布 | ✗ | `OntologyGraphView` 只读 |

---

## 4. 端点（DataCore A，前缀 `/a/v1`，错误信封统一，`feature.data-builder` 门控）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/a/v1/ontology-workflows` | 列/建工作流(DRAFT) |
| GET/PUT | `/a/v1/ontology-workflows/:id` | 取/改(节点·边·配置) |
| POST | `/a/v1/ontology-workflows/:id/validate` | DAG/类型/映射/storageMode 一致性校验 |
| POST | `/a/v1/ontology-workflows/:id/preview` | dry-run：取样跑 PROCESS → 实体/状态变量预览(不落库) |
| POST | `/a/v1/ontology-workflows/:id/nodes/:nodeId/promote` | **STATIC→ONTOLOGY 提升**(补派生/状态/行动校验) |
| POST | `/a/v1/ontology-workflows/:id/readiness` | 各实体/子图准备度评分 |
| POST | `/a/v1/ontology-workflows/:id/publish` | 发布：产出/更新本体(types/links/slices) + **Action 门控物化对象** |
| POST | `/a/v1/ontology-workflows/:id/scaffold` | **生成应用功能**：视图/场景入口+默认 Agent/场景包/求解器绑定 |
| POST | `/a/v1/connections/:id/upload` | 上传文件(含 xlsx)→RawDataset(复用连接器) |

> 设计：图谱先行 = 先 PUT 含 EntityNode/LinkNode 的工作流(storageMode 默认 STATIC) → 逐节点 PUT `dataSource`+`processing` → `promote` → `publish` → `scaffold`。数据先行 = 先 SOURCE/PROCESS 链 → EntityNode 由上游推导 → `publish`。两条路同一端点集。

---

## 5. 关键流程

### 5.1 图谱先行(模式二)端到端
1. 新建工作流 `entryMode=GRAPH_FIRST` → 画 Supplier/Factory/Order(EntityNode, storageMode=STATIC) + SUPPLIES/FULFILLS(LinkNode)。
2. 每实体配 `modeling`(属性/主键/类型)。此时 = **静态图谱**(纯结构，可视化、可查询，不可推演)。
3. 每实体补 `dataSource`(选 RawDataset/连接器) + `processing`(映射+聚合+分组+失效+脱敏+行动) → 适配数据 + 状态变量。
4. `promote` 实体 STATIC→ONTOLOGY(校验：有主键映射、状态变量/派生/行动齐备到阈值)。
5. `publish`：经 modeling 底层产出对象类型/链路 + SliceSpec；对象物化经 Action 审批落库；异常行入隔离区。
6. `scaffold`：生成视图(驾驶舱/台账/图谱) + 场景入口 + 默认 Agent + 场景包 + 通用求解器绑定。
7. 推演立即可用：切片 resolve + 规则 + 聚合 + 通用 what-if（领域求解器可后续插拔）。

### 5.2 数据先行(模式一)端到端
与 v1 一致：SOURCE_SELECT→SOURCE_TABLE→PROCESS→EntityNode(由上游 PROCESS 提供 dataSource+processing)→ONTOLOGY_SINK；publish/scaffold 同上。

### 5.3 融合用法
同一画布：部分实体数据先行(已有源)，部分图谱先行(先画后补)；节点级 storageMode 混合(结构骨架 STATIC，核心实体 ONTOLOGY)。

---

## 6. 后端模块（新增，全部复用现有底座）
- `pipeline/service.ts` — WorkflowService(CRUD/validate/preview/promote/readiness/publish/scaffold)。
- `pipeline/processing.ts` — ProcessingEngine(分组折叠/失效/脱敏，复用抽出的 `fold()`)。
- `pipeline/subgraph.ts` — 工作流 → modeling draft + ontology types/links + SliceSpec。
- `pipeline/scaffold.ts` — 从已发布本体生成 视图/场景/Agent/场景包/求解器绑定(泛化 seedViewConfigs)。
- `pipeline/readiness.ts` — 准备度评分。
- `pipeline/generic-inference.ts` — 通用 what-if(对任意本体：切片子图 + 规则评估 + 聚合 + 单因子增量)。
- `connectors/parsers.ts` — 补 `parseXlsx`。
- **契约/类型扩展**(domain.ts + contracts)：`ObjectTypeDef` 加 `storageMode`、`stateVariables`、`functions`、`actions`、`security`；`ObjectOrigin` 加 `PIPELINE`(四处同步：domain/pg/memory/迁移)。

### 6.1 存储（双实现 + 迁移）
```
ontology_workflows(id, tenant_id, doc jsonb, updated_at)   -- doc=OntologyWorkflow
```
四处同改：`migrations/0NN_workflow.sql`、`repo/pg.ts`、`repo/memory.ts`、`repo/repo.ts`。

---

## 7. 前端（frontend-shell，新增）
- `views/OntologyWorkflowView.tsx`(或 admin `DataBuilderPage`) + renderer/route + `ADMIN_NAV` 加「本体建模工作流」。
- `components/pipeline/WorkflowCanvas.tsx` — 可编辑画布(拖拽节点/连线/选中；复用 `OntologyGraphView` 的 pan/zoom/SVG 边经验)。
- `components/pipeline/NodeConfigPanel.tsx` — 右侧逐节点配置：
  - 顶部 `存储模式` 切换(STATIC/ONTOLOGY) + `提升`按钮。
  - EntityNode 三页签：**数据源**(选 RawDataset/连接器/上传) / **数据处理**(逐属性映射表+函数下拉+分组/失效/脱敏/行动) / **子图建模**(本体构建 6 页：属性/类型/函数/行动/派生/安全)。
- `components/pipeline/ReadinessGauge.tsx` — 准备度 67/100 + 等级。
- 顶部模式切换：`本体工作流`(数据先行) / `架构本体设计`(图谱先行)（对应截图右上）。
- `endpoints.ts` 增工作流 CRUD/validate/preview/promote/readiness/publish/scaffold/upload；`VITE_MOCK=1` + MSW 覆盖。
- 画布选型：默认自研轻量；评估 `@xyflow/react`(体积/mock)写实现说明。

---

## 8. 生成应用功能 & 推演通用化（模式二尾段，本期重点取舍）

### 8.1 scaffold（生成应用功能）
从已发布本体派生：
- 视图：每实体类型 → 台账(ledger)；全局 → 驾驶舱(dashboard KPI from 聚合) + 本体图谱(graph)。
- 场景入口 + 默认 Agent：每核心实体 → 一个 `AGENT_FIRST` 场景 + 绑定通用工具(query_objects/resolve_slice/invoke_solver/evaluate_rules/aggregate_objects)。
- 场景包 + 求解器绑定：通用求解器默认启用；领域求解器按需绑定。
- 复用 `seedViewConfigs`/`scenarioPackages`/`/b/v1/scene-entries`/`/b/v1/agents`，泛化为"按本体生成"。

### 8.2 推演通用化
- **通用推演**(对任意发布本体即可用)：切片子图检索 + 规则评估(C-rules) + 聚合 + **通用 what-if**(对某属性施加 Δ → 沿派生/链路重算受影响对象，输出前后对比)。
- **领域求解器**(如电池 22 个)：保持 `solverKeys` 特征绑定 + scenario pack 注入，作为可选增强；不强求任意本体自动获得。
- 取舍写明：「立即可用」= 通用推演；领域级深推演需配求解器。

---

## 9. 非功能与约定（违反即返工）
1. contracts-only-shared；前端不重定义契约类型。
2. tenant_id everywhere；跨租户 403/404。
3. entitlement 先于 authz：`feature.data-builder` 关 → 404 FEATURE_NOT_FOUND。
4. 真值写入(对象物化/已发布本体变更)经 Action 审批(复用 Phase9B domainExecutor)。
5. no-secrets-echo：连接器凭据 AES-GCM，仅 credentialRef/hasApiKey。
6. 确定性：同输入(含排序键/seed)字节级一致；测试不依赖网络/时钟/随机；LLM mock。
7. 错误信封 `{error:{code,message,requestId}}`。
8. 仓储双实现 memory+pg；新表四处同改；启动幂等迁移。
9. A6 行级 + 脱敏读出贯穿预览/物化/推演。
10. storageMode=STATIC 节点不参与派生/时序/推演(轻量)；promote 后才纳入。

---

## 10. 验收标准（DoD）

后端：
- `workflow.test.ts`：双模式 CRUD/validate(环/类型/storageMode 一致性)/preview。
- `processing.test.ts`：聚合函数 + group-by + 窗口 + expiry + masking 手算可验、确定性。
- `promote.test.ts`：STATIC→ONTOLOGY 校验(缺主键/状态变量则拒)。
- `publish.test.ts`：图谱先行 & 数据先行 都 → modeling draft + SliceSpec + Action 门控物化 + 隔离区。
- `scaffold.test.ts`：从本体生成 视图/场景/Agent；`generic-inference.test.ts`：通用 what-if 确定性。
- `parseXlsx` 测试。既有 datacore 248 / agentcore 192 / parity 129 不破。

前端：画布/配置面板/准备度单测；`VITE_MOCK=1` 全流程；既有 frontend 106 不破。

契约：`pipeline.ts` schema 单测；ObjectTypeDef 扩展不破既有断言(注意 storageMode/origin PIPELINE 默认值兼容)。

端到端(两条都验)：
- 图谱先行：画 Supplier/Factory/Order+关系(STATIC) → 配数据源+处理 → promote → publish(Action) → scaffold → 通用 what-if 可用。
- 数据先行：上传 Excel → 源表 → 处理(Sum/Max/Last+分组) → Order(状态变量) → publish → 同一本体可被既有切片/求解器消费。

---

## 11. 分期（建议里程碑）

| 期 | 范围 |
|---|---|
| P1 | 契约 `pipeline.ts` + `ObjectTypeDef` 扩展(storageMode/stateVars/functions/actions/security) + `ontology_workflows` 表 + WorkflowService CRUD/validate |
| P2 | ProcessingEngine + parseXlsx + preview（数据处理可预览实体/状态变量） |
| P3 | subgraph→本体 + publish(Action 物化) + promote(STATIC→ONTOLOGY) + 隔离区接入 |
| P4 | readiness + scaffold(生成应用) + generic-inference(通用 what-if) |
| P5 | 前端 WorkflowCanvas + NodeConfigPanel(三页签+存储模式) + ReadinessGauge + 路由/导航/endpoints/MSW |
| P6 | 双模式端到端联调 + 文档(更新 DATA-BUILDER-PIPELINE) + 全绿交付 |

每期：`pnpm -r build && pnpm -r test` 全绿 + parity 129 + 该期回归锁。

---

## 12. 风险与开放问题
1. 画布库自研 vs `@xyflow/react`(体积/mock)——P5 前定。
2. Excel 手解最小子集 vs 引库——P2 定。
3. `ObjectTypeDef` 扩字段对既有快照断言的兼容(给默认值：storageMode 缺省 ONTOLOGY，functions/actions/security 缺省空)——回归注意。
4. 物化 Action 粒度：整条 publish 一个 Action(payload 含变更摘要)，EXECUTED 批量物化。
5. 通用 what-if 的语义边界(只沿派生/链路单因子增量；复杂时序/容量推演仍需领域求解器)——文档讲清"立即可用"的范围。
6. 与现有 modeling/connectors 表单页关系：画布为统一入口，表单页保留；publish 统一走 modeling 底层，避免双真相。

---

## 13. 参考锚点（仓库内）- v1：`docs/PRD-ontoflow-data-builder.md`；现状图：`docs/DATA-BUILDER-PIPELINE.md` / `data-builder-pipeline.html`
- 连接器：`connectors/{registry,parsers,profiler,service}.ts`；隔离区 `quarantine.ts`
- 建模：`modeling.ts`；本体：`ontology.ts`/`ontology-core.ts`(SliceSpec)；类型：`domain.ts ObjectTypeDef/PropertyDef`
- 聚合：`timeseries.ts` + `synthetic/battery.ts BATTERY_TS_AGG_SPECS`
- Action 物化范式：`app.ts domainExecutor`(Phase9B)、`actions.ts`
- 生成应用素材：`synthetic/service.ts seedViewConfigs`、scenarioPackages、`/b/v1/scene-entries`、`/b/v1/agents`
- 求解器：`solvers/service.ts SOLVER_KEYS`、`catalog.ts`
- 前端画布范例：`views/OntologyGraphView.tsx`；renderer `views/registry.ts`；路由 `App.tsx`
- 约定：根 `CLAUDE.md`

---

## 附录 A — 截图字段逐项价值评估（是否加入 / 配套模块改动）

> 对截图右侧「基本信息栏 / 基础图谱 / 存储模式 / 本体构建(属性·类型·函数·行动·派生·安全) / 数据处理 / 局部仿真准备度 / 顶部执行」逐字段评估。
> 价值：⭐⭐⭐ 必加 · ⭐⭐ 建议加 · ⭐ 可选 · ✓已有。优先级 P0/P1/P2。

### A.1 基础图谱 / 实体元数据

| 字段 | 含义 | 价值 | 现状 | 是否加入 | 配套模块改动 |
|---|---|---|---|---|---|
| 对象标签 displayName | 实体显示名 | ✓已有 | `ObjectTypeDef.displayName` | 用现有 | — |
| 对象类型 Entity/Event/Relation | 节点角色(实体/事件/关系) | ⭐⭐ | 无显式角色 | 加 `nodeRole`(实体/事件) | `domain.ts ObjectTypeDef.nodeRole?` + profiler(ENTITY/TIMESERIES 可映射) |
| 实体字段(主键) | primaryKey | ✓已有 | `PropertyDef.isPrimaryKey` | 用现有 | — |
| 实体类型(如 人/传感器/银行卡) | 语义分类标签 | ⭐ | 无 | 可选加 `entityCategory`(自由文本/字典) | `ObjectTypeDef.entityCategory?`；利于检索/scaffold 分组 |
| 对象描述(含"行动函数 adjustCapacity 用于推演") | 文档 + agent 提示 | ⭐⭐ | 无 | 加 `description` | `ObjectTypeDef.description?`；scaffold 注入 agent systemPrompt |
| 状态(正在设计) | 节点设计生命周期 | ⭐ | 工作流有 DRAFT/PUBLISHED | 加 节点级 `status`(DESIGNING/READY) | `WfNode.status`(工作流 doc 内) |

### A.2 存储模式（细粒度切换）

| 字段 | 含义 | 价值 | 现状 | 是否加入 | 配套模块改动 |
|---|---|---|---|---|---|
| 静态图谱 ↔ 本体图谱 | 轻量纯图 vs 完整本体 | ⭐⭐⭐ P0 | 无 storageMode(总是本体) | 加 `storageMode: STATIC\|ONTOLOGY` + promote | `domain.ts ObjectTypeDef.storageMode`；`ontology.runDerivations` 跳过 STATIC；`generic-inference`/求解读取仅 ONTOLOGY；promote 端点 |

### A.3 数据处理（逐属性 + 全局）

| 字段 | 含义 | 价值 | 现状 | 是否加入 | 配套模块改动 |
|---|---|---|---|---|---|
| 原类型 → 新类型 | 属性类型转换(String→Double 等) | ⭐⭐⭐ P1 | 无(materialize 1:1 不转型) | 加 `mapping.dataType` cast | `ProcessingEngine` 类型转换(失败→隔离区) |
| 函数 Last/First/Sum/Max/Min/Avg/Count | 分组内折叠 | ⭐⭐⭐ P1 | 仅时序 TS_AGGREGATE | 加 `mapping.fn` | 抽 `fold()`(复用 timeseries reducer) + `ProcessingEngine` |
| 选择分组(event_date + 1) | group-by + 窗口步长 | ⭐⭐⭐ P1 | 无建模期分组 | 加 `groupBy{fields,window}` | `ProcessingEngine` 分组/窗口 |
| 选择行动(delayOrder) | 把行动绑到分组/实体 | ⭐⭐ P2 | ActionType 独立,不绑类型 | 加 `actionBindings` + 类型级 actions | `actions.ts` 绑定 + `ObjectTypeDef.actions` |
| 失效规则(TTL/过期) | 数据时效 | ⭐⭐ P2 | 仅时序 retention | 加 `expiry{field,ttlDays}` | `ProcessingEngine` 标记 + 读出过滤(A6 切面) |
| 属性脱敏(同属性名跨实体过滤) | 逐属性脱敏 + 跨实体同名规则 | ⭐⭐ P2 | A6 行级 + 凭据 redaction,无逐属性 | 加 `MaskRule(prop,strategy,scopeRoles)` | 读出切面(`getObject`/`queryObjects`/`executeSlice`) + `ObjectTypeDef.security` |
| 事件窗口字段(event_date/event_end_date) | 事件时间窗 | ⭐⭐ | profiler 识别 timeField | 用现有 + 窗口聚合 | profiler / ProcessingEngine 窗口 |

### A.4 本体构建（属性 / 类型 / 函数 / 行动 / 派生 / 安全 六页）

| 页 | 价值 | 现状 | 是否加入 | 配套模块改动 |
|---|---|---|---|---|
| 属性 | ✓已有 | `PropertyDef` | 用现有 | — |
| 类型(枚举/转换) | ⭐⭐ | `PropertyDef.enumValues` ◐ | 补类型转换 UI | PropertyDef 已支持 enum；转换见 A.3 |
| 派生 | ✓已有 | `derivedProperties`+A4 | 用现有 | — |
| **函数(adjustCapacity 等)** | ⭐⭐⭐ P2 | 无类型级函数 | 加 `FnDef`(builtin/expr) | `ObjectTypeDef.functions` + `generic-inference` 可调(what-if) |
| **行动(绑定 ActionType)** | ⭐⭐ P2 | 行动独立 | 加 `actions[]` | `ObjectTypeDef.actions` + 执行经 Action 审批 |
| **安全(脱敏/可见性)** | ⭐⭐ P2 | A6 策略级 | 加 `security` | 读出切面(同 A.3 脱敏) |

### A.5 状态变量 / writeback / 准备度

| 字段 | 含义 | 价值 | 现状 | 是否加入 | 配套模块改动 |
|---|---|---|---|---|---|
| 状态变量(状态变量10) | 事件折叠成的实体属性 | ⭐⭐⭐ P2 | 仅 temporal 历史 | 加 `stateVariables[]` | `ObjectTypeDef.stateVariables` + `ProcessingEngine` 折叠 |
| writeback(=1) | 状态变量回写对象 | ⭐⭐ | 无 | 加 `writeback` 标记 | 物化时把状态变量写为对象属性 |
| 局部仿真准备度 67/100 + 字段/状态变量/行动 breakdown | 实体/子图成熟度门 + 引导 | ⭐⭐ P2 | `bootstrapReadiness` 无关 | 加 `readiness` | `pipeline/readiness.ts`(纯函数评分) |

### A.6 顶部执行 / 节点页签（开发体验）

| 字段 | 含义 | 价值 | 现状 | 是否加入 | 配套模块改动 |
|---|---|---|---|---|---|
| 执行节点 / 单链执行 | 跑单节点 / 单条链 dry-run 调试 | ⭐⭐ P2 | preview 是整图 | 扩 preview 支持 `nodeId?`/`chainFrom?` | `/preview` 入参加 nodeId/chain；前端按钮 |
| 数据 页签 | 节点输出数据预览 | ⭐⭐ | 无 | = preview 结果展示 | 前端 NodeConfigPanel「数据」页 |
| 单测 页签 | 节点级断言(给定样例→期望实体) | ⭐ P2 | 无 | 可选加 `nodeTests[]` | 工作流 doc 存断言 + preview 比对 |
| 日志 页签 | 运行/校验日志 | ⭐ | outbox 事件 | 可选(读 run 事件) | 复用 outbox/run 记录 |
| 指南 页签 | 节点帮助文档 | ⭐ | 无 | 静态文案 | 前端静态 |

### A.7 配套模块改动汇总（按文件）

| 文件/模块 | 改动 | 期 |
|---|---|---|
| `packages/contracts/src/pipeline.ts`(新) | OntologyWorkflow / WfNode / ProcessingSpec(cast+fn+groupBy+window+expiry+masking+actionBindings) / StateVarDef / FnDef / MaskRule | P1 |
| `apps/datacore/src/domain.ts` | `ObjectTypeDef` 加 storageMode/stateVariables/functions/actions/security/nodeRole?/entityCategory?/description；`ObjectOrigin` 加 `PIPELINE`(给默认值保兼容) | P1 |
| `repo/{repo,pg,memory}.ts` + `migrations/0NN_*.sql` | `ontology_workflows` 表 + ObjectTypeDef 新字段持久化(四处同改) | P1 |
| `pipeline/processing.ts`(新) + `fold()`(抽自 timeseries) | 类型转换 + 折叠 + 分组/窗口 + 失效 + 脱敏 | P2 |
| `connectors/parsers.ts` | `parseXlsx` | P2 |
| `pipeline/{service,subgraph,scaffold,readiness,generic-inference}.ts`(新) | 工作流编排/发布/生成应用/准备度/通用推演 | P3–P4 |
| `modeling.ts` / `ontology.ts(runDerivations)` | 接受富类型；派生跳过 STATIC；调用 functions | P3 |
| 读出切面 `ontology.getObject/queryObjects` + `ontology-core.executeSlice` + solver invoke | 应用 masking + expiry 过滤 | P3 |
| `actions.ts` + `app.ts domainExecutor` | 类型级 actions 绑定 + publish 物化经 Action(Phase9B 范式) | P3 |
| 前端 `WorkflowCanvas/NodeConfigPanel(三配置+六页+存储模式)/ReadinessGauge` + endpoints + MSW + 路由/导航 | 可视化 + 执行节点/单链执行 + 数据/单测/日志/指南页签 | P5 |

### A.8 取舍结论
- **必加(P0/P1，高价值且当前缺)**：存储模式 + promote、原→新类型转换、聚合函数、选择分组+窗口、状态变量折叠。这些是"数据处理 + 静/本体分层"的核心，当前完全没有。
- **建议加(P2)**：失效、脱敏、类型级 函数/行动/安全、writeback、准备度、执行节点/单链执行/数据页签。价值中高，多可复用现有(Action/A6/outbox)。
- **可选/低成本(P2 或后补)**：实体类型语义标签、对象描述、节点状态、单测/日志/指南页签。锦上添花，不阻断主干。
- **已有直接复用**：displayName、主键、属性、派生、enum、数据源绑定(sourceBindings)、时序识别(profiler)。
