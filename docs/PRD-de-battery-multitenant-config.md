# PRD · 去电池锁死 / 多租户配置层（G-5 合并）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-16 |
| 取代/扩展 | 合并并量化本体 §8 **G-5**（"应用层电池锁死"）。基于本轮三次审计（视图结构 / 业务数据 / 文案 / Agent 配置） |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§2/§3 本体→应用链 / §5 R2/R3/R6 / §8 G-5 / §10 D8） · `packages/contracts/src/workspace.ts`（ViewConfig/Workspace 契约） |

## 0. 本体引用与影响（强制 · 不填即未读本体）

- **触及对象类型**（§2）：`ViewConfig`（`workspace.ts:8`，含 `layout`/`options` 声明式配置）· `Workspace`（`theme`/`views`/`scenarioPackages` catchall config/`features`）· `ScenarioPackage`（catchall 承载 solverParams/industry）· `ObjectType/ObjectInstance`（Base/Model 等，需补 geo/logistics 等属性）· `SolverParam` · `Agent/Skill/Workflow`（systemPrompt/tools/model）· `Rule` · `IndustryTemplate`。
- **触及链路**（§3 "本体→生成应用→推演"）：当前断在"应用层把结构/数据/文案/Agent 配置**写死在前端代码**"，与"本体/配置"脱节。本 PRD 把这条链接通：**结构←ExecutionPlan+ViewConfig.layout · 数据←API/WorkspaceConfig · 文案←i18n+行业别名 · Agent 配置←agent 表/LLM Provider 绑定**。
- **触及事件/数据流**（§4）：复用 `features.updated`（L12，配置变更刷新 workspace/navigation）；配置改动经 workspace 响应 `configVersion` 递增驱动前端失效。**不新增事件**（ontology:check 事件计数不变）。
- **触及不变量**（§5）：
  - **R2 tenant_id**：所有配置（视图布局/数据/文案别名/Agent/求解器参数）按租户隔离，从 workspace（已带 tenant）/对象库（行级过滤）取。
  - **R3 entitlement 先于 authz**：视图/功能按 features 裁剪不变。
  - **R6 确定性**：配置驱动后仍确定性（同配置同渲染；DAG 从 plan 派生是纯函数）。
  - **新原则 R14「应用层无业务常数」**（建议入 §5）：前端组件**不得**内联业务数据/结构/租户专属文案；一律来自本体/WorkspaceConfig/ViewConfig/i18n。配 `debattery:check` 门禁。
- **关闭/影响的已知断点**（§8）：**收敛 G-5**（量化为 8a 结构 / 8b 数据 / 8c 文案 / 8d Agent 配置 / 8e generic-inference）；与 G-6（rawin）协同。
- **需走的检测门禁**（§7）：新增 `debattery:check`（静态扫描：推演视图组件内联业务常数 / i18n 租户专属串 → 红）· entitlement 门 · A6 行级过滤（数据来自对象库）· `ontology:check`。
- **回写承诺**：落地后回写本体 §3（本体→应用链去断点）· §5（新增 R14）· §8（G-5 标进度，引本 PRD）· §10 D8（场景域：应用由配置/本体生成）。

## 1. 目标 / 非目标

**目标**：让系统**撑得起其他租户/行业**——同一套代码，换租户=换配置/数据，不改代码。具体：
1. **结构配置化（8a）**：推演视图（project-sim/plan-audit/plan-generate/sop-balance/risk/geo/order-chain/…≈9 个）的结构不再硬编码，改由 **ExecutionPlan 派生 + `ViewConfig.layout` 声明**（学 DashboardView 标杆）。
2. **数据外部化（8b）**：基地坐标/型号/物流/目标/阈值/分段等，从 **API（对象库 Base/Model）/ WorkspaceConfig / SolverParams** 取，不进前端代码。
3. **文案统一（8c）**：内联中文归集 `zh.ts`；i18n 去租户专属串；按 `industry` 做**术语别名映射**（如"化成通道"→可配）。
4. **Agent 配置可覆盖（8d）**：Agent `systemPrompt`/tools/scope 经 admin 可编辑（核实并补编辑通路）；模型走 **LLM Provider 用途绑定**，非代码常量。
5. **通用推演（8e）**：`generic-inference` 通用 what-if，不绑电池求解器。
6. **门禁防回潮**：`debattery:check` 让"再往组件里写业务常数"即红。

**非目标**：不改 DashboardView/LedgerView（已是标杆）；不动出厂种子机制（场景目录/意图/计划/场景入口/经验库——经核实**租户可 DRAFT→PUBLISH 覆盖 = 可接受**）；mock 数据保持（隔离良好、不进生产）。

## 2. 现状与缺口（对照代码，本轮审计）

| 类 | 现状（file:line） | 缺口 |
|---|---|---|
| 8a 结构 | `ProjectSimView.tsx:770 buildDag()` 硬编码 6 层；PlanAudit/PlanGenerate/SopBalance/Risk/Geo/OrderChain 各有写死的字段组/方案/状态机/色阶/坐标/分类 | 无 ViewConfig.layout / plan 派生；换行业整页报废 |
| 8b 数据 | `GeoMapView` 基地坐标×8；`ProjectSimView:20-23` 型号/地址/物流；`PlanGenerateView:32-41` 目标；`SopBalanceView:21,24-28` 阈值+三段；`CalibrationPage:19` 基地(4/12) | 进生产、租户锁死；应从 API/WorkspaceConfig |
| 8c 文案 | ~35 处内联中文绕过 `zh.ts`；`zh.ts:569 "如 常州"`、`:377 "扩化成通道"` | i18n 混租户/行业专属；无别名映射 |
| 8d Agent | `seed.ts:539-576` systemPrompt/tools/scope；`:538` 模型 `claude-opus-4-8`；`battery.ts:49-267` BATTERY_SOLVER_PARAMS | 编辑既有 Agent 的通路待核实；模型应走 Provider 绑定 |
| 8e 推演 | 求解器全为电池域（22 个 SOLVER_KEYS） | 无 `generic-inference` |
| — 标杆 | `DashboardView.tsx`（`view.layout.widgets` 声明式）/`LedgerView`（`layout.columns`） | ✅ 正确范式，推广对象 |

## 3. 设计（复用优先；标清 复用 / 绿地 / 门禁）

### 3.1 结构：ViewConfig.layout 声明 + DAG 从 plan 派生（8a）
- **复用** `ViewConfig.layout`（`workspace.ts:14` 已是 `record`）：给推演 renderer 定义各自 layout schema——
  - `plan-audit`：`layout.fieldGroups: [{ group, fields:[{key,label,unit,step}] }]`、`layout.verdicts`。
  - `plan-generate`：`layout.goals:[…]`、`layout.schemes:[…]`。
  - `sop-balance`：`layout.segments`、`layout.kpiThresholds`、`layout.steps`。
  - `risk/geo/order-chain`：`layout.thresholds`/`layout.positions`/`layout.categories`。
- **DAG（project-sim）= ExecutionPlan 的可视化**（绿地）：新 `deriveDag(plan, ontology, out)` —— DAG 层/节点/边**从意图绑定的 plan 步骤 + 本体**生成，数值来自 `out`。一举去电池锁死 + 图=真实执行（消漂移）。
- 前端组件改为"读 layout/plan + 渲染"，结构零硬编码（学 DashboardView）。

### 3.2 数据：API + WorkspaceConfig（8b）【复用对象库 + workspace catchall】
- **对象库**：基地坐标→`Base.props.lat/lon`（本体补属性）；型号→`Model` 对象；筛选列表→对象查询（A6 行级过滤）。
- **WorkspaceConfig**：`scenarioPackages[].catchall` 承载 `solverParams`（logistics/targets/segments/kpiThresholds）+ `industry`；前端从 `GET /a/v1/me/workspace` 取，组件用配置初值而非常量。

### 3.3 文案：i18n 归集 + 行业别名（8c）【复用 zh.ts + 绿地别名层】
- 内联中文迁入 `zh.ts`。
- 去 i18n 里的租户串（`"如 常州"`→`"如 地区/基地名"`）。
- 新 `termAlias(industry)`：`{"化成通道":"生产通道", "基地":"工厂", …}` 由 `industry`/WorkspaceConfig 驱动，渲染时套用。

### 3.4 Agent 配置（8d）【核实 + 绿地编辑通路 + 复用 Provider 绑定】
- 核实/补：admin 可编辑既有 Agent 的 `systemPrompt`/tools/scope（已有 Agent 仓储；补 PUT 通路 + UI）。
- 模型：Agent `model` 字段改由 **LLM Provider 用途绑定**（`agent` 用途）解析，去 `claude-opus-4-8` 常量。
- `BATTERY_SOLVER_PARAMS`：迁为 IndustryTemplate 驱动的行业参数（合成用，已有模板机制，补按行业取）。

### 3.5 通用推演（8e）【绿地】
- `generic-inference` 求解器：通用 what-if（输入对象+Δ+约束→重算），不绑电池字段；注册进 SOLVER_KEYS + chain:check。

### 3.6 门禁（防回潮）【门禁新增】
- `debattery:check`：静态扫描 `apps/frontend-shell/src/views|pages` 内联业务常数（中文业务名/数字阈值数组）与 `zh.ts` 租户专属串 → 红。白名单标杆视图。

## 4. 契约 / 端点 / 数据模型（双仓储四处同改；contracts-only-shared）
- `ViewConfig.layout` 各推演 renderer 的 layout 子 schema（contracts 声明，前端按 renderer 解析）。
- `Workspace`/`ScenarioPackage` 的 config catchall 显式化（`solverParams`/`industry`/`logistics`/`targets`/`segments`/`thresholds`）。
- `Base/Model` 对象补属性（lat/lon/…）：本体类型定义 + 合成生成。
- Agent：`systemPrompt`/tools/scope/model 可写端点（若缺）。
- 新求解器 `generic-inference`（DataCore，R9 不涉表则仅 service）。

## 5. 关键流程（端到端）
```
租户登录 → GET /a/v1/me/workspace（theme + views[ViewConfig.layout] + scenarioPackages[solverParams,industry] + features）
  → 前端按 renderer + layout 渲染结构（零硬编码）
  → 业务数据：对象库查询(Base/Model, A6 过滤) + WorkspaceConfig 初值
  → 文案：zh.ts + termAlias(industry)
  → 推演 DAG：deriveDag(意图绑定的 ExecutionPlan + 本体 + out)
  → Agent：systemPrompt/tools 来自 agent 表(可编辑) · model 来自 Provider 绑定
换租户/行业 = 换 workspace 配置 + 对象数据，代码不变
```

## 6. 非功能与约定（§5 不变量逐条）
- **R2/R3**：配置/数据/Agent 全程 tenantId + entitlement + A6。
- **R6**：配置驱动仍确定性；DAG 从 plan 派生是纯函数。
- **R14（新）**：应用层无业务常数，`debattery:check` 守护。
- **R1**：前端引契约类型，不重定义。

## 7. 验收（DoD）
- `pnpm -r build && test` 全绿 + `debattery:check` 绿（标杆视图白名单外无内联业务常数）。
- **多租户样板验证**：构造第二个 industry 的 workspace 配置（非电池术语/数据），ProjectSim/PlanAudit 等正常渲染、无电池串泄漏。
- DAG 由 plan 派生：改 plan 步骤 → DAG 变；图与实际执行一致。
- Agent systemPrompt/model 可经 admin 改并生效。
- `ontology:check` 绿；本体 §3/§5(R14)/§8(G-5)/§10 已回写。

## 8. 分期
- **P1（样板）**：ProjectSimView 数据（型号/地址/物流）→ API/WorkspaceConfig + `debattery:check` 第一版（守 project-sim）。证明范式。
- **P2（结构）**：DAG 从 ExecutionPlan 派生 `deriveDag`；plan-audit/plan-generate/sop-balance 结构改 `ViewConfig.layout`。
- **P3（数据+文案）**：Geo 坐标/Calibration 列表→对象库；i18n 归集 + `termAlias` 行业别名；去 i18n 租户串。
- **P4（Agent）**：Agent systemPrompt/tools/model 可编辑 + 模型走 Provider 绑定；BATTERY_SOLVER_PARAMS→行业模板。
- **P5（通用推演）**：`generic-inference` + 接 chain:check。
