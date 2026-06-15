# PRD — OntoFlow 可视化数据建模流水线（Data Builder Studio）

> 版本 v1.0 · 状态 DRAFT · 面向：实现 agent / 工程师
> 目标读者：在本仓库（`/home/user/complete`，DataCore System A + AgentCore System B + frontend-shell）上开发的其他 agent。
> 本文是「可独立施工」的开发文档：每节给出**复用点(现有文件/端点)**、**新增点(契约/表/端点/组件)**、**验收标准**、**测试要求**。
> 先读仓库根 `CLAUDE.md`（约定即铁律）与 `docs/DATA-BUILDER-PIPELINE.md`（现有数据管线节点图）。

---

## 0. 背景

参照 AbutionGraph OntoFlow：用一张**可视化画布**把「数据选择 → 数据源表 → 数据处理 → 子图建模 → 本体库」串成可拖拽连线的流水线，右侧逐节点配置（逐属性映射 + 聚合函数 Last/Sum/Max、选择分组、选择行动、失效规则、属性脱敏），并有「局部仿真准备度 67/100」评分。

**现状结论（已实查，见对照表）**：后端「数据→本体」主干能力大半已有，但是**批量 + 1:1 映射 + 表单驱动**；缺：① 可视化画布编辑器；② 数据处理层的实体聚合/分组/事件溯源(状态变量+writeback)/失效/脱敏/行动绑定；③ Excel 解析；④ 准备度评分。本 PRD 把这些补齐并**复用**现有连接器/建模/本体/聚合/Action/A6 地基。

### 0.1 复用 ↔ 新增 速查

| 流水线阶段 | 复用（现有） | 新增 |
|---|---|---|
| 数据选择 / 数据源表 | `connectors/registry.ts`(file_upload/rest_api/mock_erp/mock_crm)、`parsers.ts`、`profiler.ts`、`RawDataset`、`POST /a/v1/connections`、`/:id/sync` | **Excel(.xlsx) 解析器** |
| 数据处理 | `timeseries` TS_AGGREGATE 引擎(avg/sum/min/max/p95/weighted_avg)、`modeling.ts` 字段映射、A6 `authz` | **ProcessingSpec**(逐属性聚合函数 + group-by/窗口 + 失效 + 脱敏 + 行动绑定)、**实体聚合执行器**、**事件溯源状态变量+writeback** |
| 子图建模 | `modeling.ts`(suggest/draft/publish/materialize)、`ontology-core` SliceSpec、`ontology` types/links | **PipelineGraph→本体物化编排**（把画布产物转 modeling draft + SliceSpec） |
| 本体库 | ontology types/links/slices + 对象库 | — |
| 画布编辑器 | `views/OntologyGraphView.tsx`（手写 canvas/力导向，可拖拽，但**只读**）、`views/registry.ts` renderer 注册、`App.tsx` 路由、`endpoints.ts` | **PipelineCanvas 可编辑流程图组件**（拖拽节点/连线 + 逐节点配置面板 + 准备度仪表） |
| 准备度 | — | **ReadinessScore 计算** |

---

## 1. 目标与非目标

### 1.1 目标
1. 提供一张**可保存、可发布、可重跑**的可视化数据建模流水线（PipelineGraph），节点类型：`SOURCE_SELECT / SOURCE_TABLE / PROCESS / SUBGRAPH_ENTITY / SUBGRAPH_LINK / ONTOLOGY_SINK`。
2. **数据处理**支持：逐属性 `映射 + 类型转换 + 聚合函数(Last/First/Sum/Max/Min/Avg/Count)`、`选择分组(group-by + 可选窗口)`、`失效规则(TTL/过期)`、`属性脱敏规则`、`行动绑定`。
3. **子图建模**：把事件源表折叠成实体（含**状态变量**）与关系，写入本体库；支持「事件表→实体状态(增量聚合/event-sourcing) + writeback」。
4. **本体库落地**：复用现有 ontology + 对象库 + SliceSpec；流水线发布即产出（或更新）对象类型、链路、切片。
5. **局部仿真准备度评分**：每实体/子图按「字段/状态变量/行动/writeback/映射完整度」给 0–100 分 + 等级。
6. 支持 **Excel(.xlsx) 上传** 作为源。
7. 全程**与现有系统融合**：复用连接器/RawDataset/建模/本体/聚合/Action/A6；真值写入**经 Action 审批**（C10/C22）；多租户隔离；确定性可重跑。

### 1.2 非目标（本期不做）
- 实时流式摄取（Kafka/CDC）——本期事件源是**批量事件表**的增量折叠，不是真流。
- 跨租户共享流水线模板市场。
- 画布的多人实时协同编辑。
- 替换现有表单页（连接器/建模页可保留，画布是新增的统一入口）。

---

## 2. 名词

| 术语 | 定义 |
|---|---|
| PipelineGraph | 一条命名的可视化流水线（节点 + 边 + 各节点 spec），租户级，DRAFT/PUBLISHED |
| Node | 画布节点，6 种 kind（见 §4.2） |
| RawDataset | 现有原始数据集（连接器 sync 产物），数据源表节点指向它 |
| ProcessingSpec | 数据处理节点的配置（映射/聚合/分组/失效/脱敏/行动） |
| StateVariable | 实体上的"状态变量"——由事件表按聚合函数折叠而来的属性（如 Order.order_risk = Max(event.risk)） |
| Readiness | 局部仿真准备度（0–100 + 等级），实体/子图级 |
| Sink | 本体库落地节点（产出对象类型/链路/切片 + 物化对象） |

---

## 3. 总体架构

```
[前端 PipelineCanvas(可编辑)]  ──REST──>  [DataCore A: PipelineService]
   节点面板/连线/逐节点配置面板                 ├ 校验(validate) / 预览(dry-run preview)
   准备度仪表                                  ├ 复用 connectors / parsers(+xlsx) / profiler → RawDataset
                                              ├ ProcessingEngine(实体聚合/分组/失效/脱敏)  ← 复用 TS_AGGREGATE 折叠算法
                                              ├ SubgraphBuilder → modeling draft + SliceSpec
                                              ├ publish → Action 门控物化(对象/链路) + ontology
                                              └ ReadinessScorer
```

- **存储**：双仓储（memory + pg），新增表 `pipeline_graphs`（见 §5.4）。迁移 `migrations/0NN_pipeline.sql` + `repo/pg.ts` + `repo/memory.ts` + `repo/repo.ts` 接口（仓库约定：四处同改）。
- **契约**：`packages/contracts/src/pipeline.ts`（zod），`index.ts` `export *`。前端**不得重定义**已在契约里的类型（contracts-only-shared）。
- **执行**：`PipelineService.run()` 是确定性纯计算（同输入同输出，无时钟/随机），LLM（若用于 suggest）一律走现有 `TenantRoutedLlmClient`，测试 mock。

---

## 4. 节点模型

### 4.1 通用
- 每节点：`id`、`kind`、`label`、`position{x,y}`、`spec`（按 kind 不同）、`inputs[]`（上游 node id）。
- 边：`{ from, to }`，DAG（禁环，validate 校验）。

### 4.2 六种节点 kind

| kind | 作用 | spec 关键字段 | 上游 | 下游 |
|---|---|---|---|---|
| `SOURCE_SELECT` | 选源/上传入口 | `{ connId?, upload?: {format: csv|json|xlsx}, datasetName }` | — | SOURCE_TABLE |
| `SOURCE_TABLE` | 指向 RawDataset（事件表/主数据表） | `{ rawDatasetId, role: "event"|"master" }` | SOURCE_SELECT | PROCESS |
| `PROCESS` | 数据处理（核心新增） | `ProcessingSpec`（§4.3） | SOURCE_TABLE | SUBGRAPH_ENTITY / SUBGRAPH_LINK |
| `SUBGRAPH_ENTITY` | 实体节点（折叠成对象类型 + 状态变量） | `{ typeKey, primaryKey, properties[], stateVariables[], actions[], readinessTarget? }` | PROCESS | SUBGRAPH_LINK / ONTOLOGY_SINK |
| `SUBGRAPH_LINK` | 关系节点（如 SUPPLIES/FULFILLS） | `{ linkKey, fromTypeKey, toTypeKey, cardinality, fk }` | SUBGRAPH_ENTITY | ONTOLOGY_SINK |
| `ONTOLOGY_SINK` | 本体库落地 | `{ ontologyDomain, sliceKey? }` | SUBGRAPH_* | — |

### 4.3 ProcessingSpec（数据处理 — 本期最大新增）

```
ProcessingSpec {
  mappings: AttributeMapping[]        // 逐属性
  groupBy?: { fields: string[], window?: { field: string, step: number } }  // 选择分组(event_date + 1)
  expiry?: { field: string, ttlDays: number }                              // 失效规则
  masking?: MaskRule[]                                                      // 属性脱敏
  actionBindings?: { actionTypeKey: string, on: "GROUP"|"ENTITY" }[]        // 选择行动(delayOrder)
}
AttributeMapping {
  sourceField: string
  targetProp: string
  dataType: "String"|"Double"|"Int"|"Boolean"|"Date"|"Json"
  fn: "Last"|"First"|"Sum"|"Max"|"Min"|"Avg"|"Count"   // 聚合函数(对分组内多行折叠)；主数据表用 "Last"
  isPrimaryKey?: boolean
  isStateVariable?: boolean                              // 标记为"状态变量"
}
MaskRule { prop: string, strategy: "HASH"|"REDACT"|"PARTIAL", scopeRoles?: string[] }
```

**语义**：PROCESS 把上游事件表按 `groupBy`（缺省按目标实体主键）分组，组内每属性用 `fn` 折叠 → 一个实体记录的属性/状态变量。`expiry` 标记超 `ttlDays` 的记录为失效（不参与物化/推演）。`masking` 在读出/物化时按策略脱敏。`actionBindings` 把 ActionType 关联到实体（产出可选「建议行动」）。

> 复用提示：折叠算法直接复用 `timeseries` 的聚合实现（`BATTERY_TS_AGG_SPECS` 用的 avg/sum/min/max/p95/weighted_avg 同款 reducer），抽出公共 `fold(rows, fn, field)` 工具供 PROCESS 与 TS_AGGREGATE 共用，避免两套。

---

## 5. 后端（DataCore A）

### 5.1 新增模块
- `apps/datacore/src/pipeline/service.ts` — PipelineService（CRUD/validate/preview/run/publish/readiness）。
- `apps/datacore/src/pipeline/processing.ts` — ProcessingEngine（分组折叠/失效/脱敏，复用 fold 工具）。
- `apps/datacore/src/pipeline/subgraph.ts` — SubgraphBuilder（PipelineGraph → modeling draft + SliceSpec）。
- `apps/datacore/src/pipeline/readiness.ts` — ReadinessScorer。
- `apps/datacore/src/connectors/parsers.ts` — **补 `parseXlsx`**（见 §7.1）。

### 5.2 端点（REST，前缀 `/a/v1`，错误信封 `{error:{code,message,requestId}}`）

| 方法 | 路径 | 说明 | 权限 |
|---|---|---|---|
| GET | `/a/v1/pipelines` | 列租户流水线 | catalog_admin/admin |
| POST | `/a/v1/pipelines` | 建流水线(DRAFT) | catalog_admin |
| GET | `/a/v1/pipelines/:id` | 取流水线 | catalog_admin |
| PUT | `/a/v1/pipelines/:id` | 改(节点/边/spec) | catalog_admin |
| POST | `/a/v1/pipelines/:id/validate` | DAG/类型/映射校验 → 错误清单 | catalog_admin |
| POST | `/a/v1/pipelines/:id/preview` | dry-run：取样 N 行跑 PROCESS → 实体预览(不落库) | catalog_admin |
| POST | `/a/v1/pipelines/:id/readiness` | 计算各实体/子图准备度 | catalog_admin |
| POST | `/a/v1/pipelines/:id/publish` | 发布：产出/更新 ontology + **Action 门控物化对象** | catalog_admin（物化经 Action 审批） |
| POST | `/a/v1/connections/:id/upload` | 上传文件(含 xlsx) → RawDataset（复用连接器；若无则新增） | catalog_admin |

**约定**：
- `entitlement 先于 authz`：流水线功能挂 feature key `feature.data-builder`；关闭 → 404 `FEATURE_NOT_FOUND`。
- `tenant_id everywhere`：所有读写/事件带 tenantId；跨租户 403/404。
- **真值写入经 Action**：`publish` 的"物化对象/改本体已发布版本"走 Action（复用 Phase9B `domainExecutor`，新增 ActionType `流水线发布物化`），不直改真值。本体**草稿/切片**可直接写（与现有 modeling draft 一致），但**对象物化**与已发布本体变更经审批。
- 凭据（连接器 apiKey）AES-GCM 落库（`CREDENTIAL_KEY`），响应仅 `hasApiKey`。

### 5.3 与现有模块的接缝（务必复用，不要另起炉灶）
- 源解析 → 复用 `connectors/registry.ts` 适配器 + `parsers.ts`；profiler 判 ENTITY/TIMESERIES。
- 折叠聚合 → 抽 `timeseries` 的 reducer 为公共 `fold()`。
- 子图→本体 → 复用 `modeling.ts` 的 draft/publish/materialize + `ontology-core.putSliceSpec`；**不要**绕过 modeling 直写对象类型。
- 物化落库 → 复用 `repos.objects.put` + `ontology.runDerivations`；异常行进**现有隔离区**（`quarantine.record` + `/quarantine/:id/reprocess`）。
- 行级权限/脱敏 → 复用 `authz`（A6 rowFilter）+ 新增 masking 在读出层。

### 5.4 存储（双实现 + 迁移）
```
pipeline_graphs(id, tenant_id, doc jsonb, updated_at)   -- doc = PipelineGraph
```
四处同改：`migrations/0NN_pipeline.sql`、`repo/pg.ts`、`repo/memory.ts`、`repo/repo.ts`（`pipelines: Store<PipelineGraphRecord>`）。

---

## 6. 前端（frontend-shell）

### 6.1 新增
- `src/views/PipelineStudioView.tsx`（或 admin 页 `pages/admin/DataBuilderPage.tsx`）+ 注册 renderer/route（`views/registry.ts` 或 `App.tsx` `admin("data-builder", ...)`）+ 管理导航项（DataCore `seedViewConfigs` 的 `ADMIN_NAV` 加 `{ key: "data-builder", label: "数据建模流水线" }`）。
- `src/components/pipeline/PipelineCanvas.tsx` — 可编辑画布：拖拽节点、连线、选中。
- `src/components/pipeline/NodeConfigPanel.tsx` — 右侧逐节点配置（按 kind 渲染：PROCESS 显示逐属性映射表 + 函数下拉 + 分组/失效/脱敏/行动）。
- `src/components/pipeline/ReadinessGauge.tsx` — 准备度仪表（67/100 + 等级）。
- `src/api/endpoints.ts` 新增 `fetch/create/update/validatePipeline`、`previewPipeline`、`pipelineReadiness`、`publishPipeline`、`uploadDataset`。

### 6.2 画布技术选型
- **优先**自研轻量画布，复用 `OntologyGraphView.tsx` 的 pan/zoom/拖拽与 SVG 边绘制经验（已有手写实现），扩展为"可加节点/连线/配置"。
- 若引第三方（如 `@xyflow/react`）：需评估包体（现 `index-*.js` 已 1MB+）与 MSW mock 模式兼容；**默认不引**，除非自研成本过高。判定写进实现说明。
- 前端 `VITE_MOCK=1` mock 模式必须可跑（MSW handler 覆盖新端点）。

### 6.3 交互
- 左侧节点面板拖入画布 → 连线成 DAG → 选中节点右侧配置 → 「校验」「预览」「准备度」「发布」按钮。
- 预览：调 `/preview` 显示折叠后的实体样例（前 N 行）。
- 发布：若涉及对象物化 → 弹出"将生成 Action 草稿待审批"提示（不直接落账）。

---

## 7. 缺口实现细则

### 7.1 Excel(.xlsx) 解析
- 现 `connectors/registry.ts:172` 是 TODO 桩。补 `parseXlsx(buf): Record<string,unknown>[]`。
- 依赖：评估极简方案（xlsx 是 zip+XML，可手解 sharedStrings + sheet1）或引 `xlsx`/`exceljs`（注意体积与 license）。**首选**手解最小子集（单 sheet、首行表头），与现有"无重依赖"风格一致；复杂表格再引库。判定与实现写进 PR 说明。
- 验收：上传 `.xlsx` → RawDataset 行数/字段与 csv 等价。

### 7.2 实体聚合执行器（ProcessingEngine）
- 输入：RawDataset 行 + ProcessingSpec。输出：实体记录数组（确定性）。
- 步骤：① 按 `groupBy`（或目标实体主键）分组；② 组内每 mapping 用 `fn` 折叠（`Last`=按时间/出现序末值，需稳定排序；`Sum/Max/Min/Avg/Count` 数值折叠）；③ 应用 `expiry`（标记/剔除过期）；④ 标记 `isStateVariable` 的属性为状态变量。
- 复用 `fold()` 公共工具（与 TS_AGGREGATE 同源）。
- 确定性：分组顺序、`Last` 的排序键必须确定（同输入字节级一致），写回归测试。

### 7.3 事件源 → 实体状态（event-sourcing 折叠 + writeback）
- `SOURCE_TABLE.role="event"` 的表经 PROCESS 折叠进 `SUBGRAPH_ENTITY.stateVariables`。
- `writeback`：实体物化时把状态变量写为对象属性（与截图 `writeback=1` 对应）。本期是**批量重算**（每次 run 全量折叠），非增量流；增量留作后续。
- 与现有对象库融合：物化走 `repos.objects.put`（origin 标记 `MATERIALIZED` 或新增 `PIPELINE`，需在 `ObjectOrigin` 加类型并四处同步）。

### 7.4 失效规则 / 属性脱敏 / 行动绑定
- 失效：`expiry.ttlDays` → 物化时给对象加 `_expired` 标记或不物化；切片/求解读取时过滤（复用 A6 读出层钩子）。
- 脱敏：`MaskRule` 在 `getObject`/查询读出层按 `scopeRoles` 应用（HASH/REDACT/PARTIAL）；与 A6 同一读出切面。新增 `masking` 配置存本体类型属性元数据上。
- 行动绑定：`actionBindings` 引用现有 ActionType；产出"建议行动"挂在实体（不自动执行，执行走 Action 审批）。

### 7.5 准备度评分（ReadinessScorer）
- 每实体 0–100：建议权重 `字段完整度40 + 状态变量30 + 主键10 + writeback10 + 行动绑定10`（与截图"字段10/状态变量10/行动1/writeback1"语义对齐，权重可配）。
- 子图分 = 实体分均值；输出 `{ entityKey, score, level: 良好/合格/不足, breakdown }`。
- 纯函数、确定性。

---

## 8. 非功能与约定（必须遵守，违反即返工）

1. **contracts-only-shared**：跨包仅依赖 `@platform/contracts`；前端不重定义契约类型。
2. **tenant_id everywhere**：仓储/事件/缓存键带 tenantId；跨租户 403/404。
3. **Entitlement 先于 authz**：`feature.data-builder` 关 → 404 `FEATURE_NOT_FOUND`。
4. **真值写入经 Action**：对象物化 / 已发布本体变更 → Action 草稿审批后落账（复用 Phase9B 执行器）。
5. **no-secrets-echo**：连接器凭据 AES-GCM；响应仅 credentialRef/hasApiKey。
6. **确定性**：同输入（含 seed/排序键）→ 字节级一致；测试不依赖网络/时钟/随机；LLM mock。
7. **错误信封**统一 `{error:{code,message,requestId}}`。
8. **仓储双实现**：memory（测试默认）+ pg（DATABASE_URL，启动幂等迁移）；新表四处同改。
9. **A6 行级**：流水线读出/预览同样过行级过滤。

---

## 9. 验收标准（Definition of Done）

后端（datacore 测试）：
- `pipeline.test.ts`：CRUD + validate（环/类型/缺映射报错）+ preview（折叠样例正确）+ readiness（分数确定）。
- `processing.test.ts`：各聚合函数(Last/Sum/Max/Min/Avg/Count) + group-by + 窗口 + expiry + masking 手算可验、确定性重跑一致。
- `pipeline-publish.test.ts`：publish → 生成 modeling draft + SliceSpec；对象物化经 Action（草稿→审批→EXECUTED 后对象入库），异常行入隔离区。
- `parseXlsx` 测试：xlsx 与等价 csv 行/字段一致。
- 既有 `datacore` 全绿（当前 248）+ `parity` 129 不破。

前端（frontend 测试 + 手测）：
- `PipelineCanvas` 渲染/连线/配置面板单测；`VITE_MOCK=1` 可跑全流程；新增 MSW handler。
- 既有 `frontend` 全绿（当前 106）。

契约：
- `packages/contracts` 新增 `pipeline.ts` schema + 单测；`agentcore`/`frontend` 引用不破。

端到端：上传 Excel → 画布建「订单事件表→数据处理(Sum/Max/Last+按 event_date 分组)→Order 实体(状态变量 order_risk=Max)→FULFILLS→本体库」→ 校验通过 → 预览出实体 → 准备度≥阈值 → 发布(Action 审批后)对象入库 → `resolve_slice`/`invoke_solver` 能用新对象（与现有推演融合）。

---

## 10. 分期实施计划（建议给实现 agent 的里程碑）

| 期 | 范围 | 产出 | 依赖 |
|---|---|---|---|
| **P1 契约+存储** | `contracts/pipeline.ts`、`pipeline_graphs` 表(四处)、PipelineService CRUD+validate | 可建/存/校验流水线 | — |
| **P2 数据处理引擎** | `processing.ts`(fold/group/expiry/mask) + `parseXlsx` + `/preview` | 折叠+预览出实体 | P1 |
| **P3 子图→本体+发布** | `subgraph.ts`→modeling draft+SliceSpec、`/publish` 经 Action 物化、隔离区接入 | 发布落本体库 | P2 |
| **P4 准备度** | `readiness.ts` + `/readiness` | 评分 | P2 |
| **P5 前端画布** | PipelineCanvas + NodeConfigPanel + ReadinessGauge + 路由/导航/endpoints/MSW | 可视化编辑器 | P1–P4 |
| **P6 联调+文档** | 端到端 + 更新 `DATA-BUILDER-PIPELINE.md` + DEPLOY 说明 | 全绿交付 | 全部 |

每期：`pnpm -r build && pnpm -r test` 全绿 + `parity` 129 不破 + 该期回归锁。

---

## 11. 风险与开放问题

1. **画布库选型**：自研 vs `@xyflow/react`（体积/mock 兼容）——P5 开工前定，写进实现说明。
2. **Excel 解析**：手解最小子集 vs 引库——P2 定。
3. **增量 vs 批量折叠**：本期批量全量重算；真增量/流式（state 累积）留后续，契约预留 `mode: "BATCH"|"INCREMENTAL"`。
4. **物化经 Action 的粒度**：整批物化一个 Action 还是按实体类型多个？建议整条 publish 一个 Action（payload 含变更摘要），EXECUTED 时批量物化。
5. **ObjectOrigin 扩 `PIPELINE`**：需在 `domain.ts` ObjectOrigin 加类型 + pg/memory/迁移同步（影响既有断言，注意回归）。
6. **与现有 modeling 页关系**：画布是新增统一入口，modeling/connectors 表单页保留；避免两套真相，publish 统一走 modeling 底层。

---

## 12. 参考（仓库内现有实现锚点）

- 数据管线现状图：`docs/DATA-BUILDER-PIPELINE.md`、`docs/data-builder-pipeline.html`
- 连接器：`apps/datacore/src/connectors/{registry,parsers,profiler,service}.ts`
- 建模：`apps/datacore/src/modeling.ts`；隔离区 `quarantine.ts`
- 本体/切片：`apps/datacore/src/ontology.ts`、`ontology-core.ts`（SliceSpec）
- 聚合引擎：`apps/datacore/src/timeseries.ts` + `synthetic/battery.ts` `BATTERY_TS_AGG_SPECS`
- Action 门控物化：`apps/datacore/src/app.ts` `domainExecutor`（Phase9B「对象数据变更」可作范例）、`actions.ts`
- 前端图谱画布范例：`apps/frontend-shell/src/views/OntologyGraphView.tsx`；renderer 注册 `views/registry.ts`；路由 `App.tsx`
- 约定总则：根 `CLAUDE.md`
