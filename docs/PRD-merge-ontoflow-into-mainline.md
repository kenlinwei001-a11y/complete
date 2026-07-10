# PRD · 合并 OntoFlow 进主线（两条零共祖分支 → 一个 dev 一个项目）

> 用户 2026-07-10 定：两条并行分支合并为一个 dev（可多 agent）开发的**单一项目**。审核方据结构性摸底定方案（无需用户裁决）。
> **背景**：`claude/vigilant-knuth-b1nmxn`（主线·M）与 `claude/parallel-agent-tasks-d3xmzn`（OntoFlow·O）**零共同祖先**（不能 `git merge`·天量冲突）。

## §0 决策：主干 = 主线 M（据超集 + 治理·不可逆理由）
| 维度 | 主线 M | OntoFlow O |
|---|---|---|
| 文件数 | **1961** | 553 |
| 治理 | work-queue LOOP · SYSTEM-ONTOLOGY 母体 · gates(no-fake-done/solver-coverage/…) · 审核方复验纪律 | 无 work-queue · 无 collab 工具 |
| 功能/测试/迁移 | 绝大多数（147+126+82 测·64+25 源·24 迁移）· 产能推演/QOS/沙盘/upgrade | 少（~40 独有文件） |
| 独有价值 | 全套系统 + 治理 | **仅 `pipeline/` Data Builder Studio 功能** |
→ **M 为唯一主干**；O 的价值以"移植 pipeline 功能"并入 M；O 分支合并后退役。

## §1 移植范围（O 独有源码·精确清单·11 源 + 12 测）
**后端**（`apps/datacore/src/pipeline/`）：`generic-inference.ts`(通用推演·**已复验真算**) · `readiness.ts`(准备度·**已复验真算**) · `scaffold.ts`(生成应用) · `processing.ts`(数据处理/Excel) · `service.ts`(pipeline 服务) · `subgraph.ts`(子图)。
**契约**：`packages/contracts/src/pipeline.ts`（OntologyWorkflow / EntityNode / ProcessingSpec / readiness / scaffold zod）。
**前端**（`apps/frontend-shell/src/components/pipeline/`）：`WorkflowCanvas.tsx`(可编辑画布·**已复验真落后端**) · `NodeConfigPanel.tsx`(三页签+存储模式) · `ReadinessGauge.tsx`(准备度·**已复验逐值忠实**) + `pages/admin/DataBuilderPage.tsx` 集成。
**测试随迁**：pipeline/readiness/scaffold/processing/generic-inference/workflow/xlsx-parser/connector-incremental + f41.ontoflow-databuilder + packages/contracts pipeline.test。
**端点**：`/a/v1/ontology-workflows/*`（CRUD/readiness/scaffold/inference）+ 迁移（ontology_workflows 表·双实现 memory+pg）。

## §2 不移植（明确排除）
- `apps/frontend-shell/src/views/plan/GeoMapView.tsx` + f24.geo-map/f25.graph-viewpoints 测：**主线已主动退役 geo-map**（App.tsx:149 「geo-map 退役·302→/v/risk」）——移植=倒退，排除。
- O 的 deliverables/*.zip/xls（构建产物·非源码）：不入库（gitignore 快照）。
- O 与 M 同路径但内容不同的共享文件（service.ts/app.ts 等）：**以 M 为准**（M 更演进）·仅在集成点适配，不反向覆盖。

## §3 调和：pipeline 画布 与 主线 databuilder 引擎（协同非替代）
主线 `apps/datacore/src/databuilder/`（comprehend/closure/fde-graph/entity-catalog/prototype-intake…）= **数据构建引擎**；O 的 `pipeline/` = **可视化建模画布 + 准备度/scaffold/通用推演**。二者**互补**：pipeline 画布做"两模式统一建模 + 发布 + 通用推演"，可消费 databuilder 引擎的接入/派生能力。
- **DataBuilderPage 统一**：主线已有 DataBuilderPage（驱动 databuilder/）·O 有 DataBuilderPage（驱动 pipeline/）→ 合并为**一个入口**：画布为主视图，databuilder 引擎能力作为节点级数据处理/接入的后端（不双页并列）。集成时 adminRegistry 单一「本体建模工作流」入口。

## §4 4 fix 并入移植（O 分支复验出的 BLOCK·主线落地时一并做对）
移植时**直接做对**这 4 处（不再带病移植）——详见 `docs/REVIEW-ontoflow-p4-p6-verdict.md`：
- **B1 门控**：注册 `feature.data-builder` 到主线 FEATURE_REGISTRY(features.ts) + `/a/v1/ontology-workflows/*` 挂 requireFeature(关→404)。
- **B2 scaffold 真落库**：buildScaffold 蓝图经 Action 门控真落库（seedViewConfigs/scene-entries/agents 泛化）·发布后应用真产可查产物。
- **B3 通用推演前端入口**：前端加「推演」入口·消费 `/:id/inference`·Δ+前后对比 UI。
- **B4 契约对齐**：WfPublishResult 与真后端 `string[]` 对齐 + MSW 同形 + f41 校验类型值（堵"绿测试≠能用"）。

## §5 WO（入主线 work-queue·dev 多 agent 建·审核方真跑复验）
- **WO-MERGE-01（P1·后端）**：移植 pipeline 契约 + datacore/pipeline/*（readiness/scaffold/generic-inference/processing/subgraph/service）进主线，适配主线 service.ts/app.ts/迁移；**含 B1 门控 + B2 scaffold 真落库**。验收：真跑 readiness/scaffold/inference 端点真值（generic-inference 四跳真重算·scaffold 真落库可查·feature 关→404）+ R6 + 迁移 down→up + 四包测绿。
- **WO-MERGE-02（P1·前端·依赖 01）**：移植 pipeline 前端组件（WorkflowCanvas/NodeConfigPanel/ReadinessGauge）+ DataBuilderPage 统一入口（调和主线既有）+ **B3 推演入口 + B4 契约对齐**。验收：真浏览器双模式端到端（图谱先行/数据先行→发布真产本体→scaffold 真产物→推演前后对比）逐值对照后端·既有前端测不破。
- **WO-MERGE-03（P2·收口）**：pipeline 画布与 databuilder 引擎协同接线（节点级数据处理走 databuilder 能力）+ 本体母体回写（§7）+ OntoFlow 分支退役标记。

## §6 退役 OntoFlow 分支 + 统一 LOOP
- 移植验收 DONE 后，`claude/parallel-agent-tasks-d3xmzn` **停止独立发展**（不再 push 新功能到该分支）。已推的 `docs/WO-ontoflow-fixes-p4-p6.md`（4 fix）被本 PRD 的 WO-MERGE-01/02 取代（同内容·落主线）。
- **统一**：一条分支 `claude/vigilant-knuth-b1nmxn` · 一个 `docs/work-queue.json` · 一个 dev（多 agent）。dev 全部经 `collab-queue.mjs next-dev` 取单、主线 push、审核方真跑复验。

## §7 本体引用与影响（铁律0）
- **新增对象类型**：OntologyWorkflow（画布）· EntityNode · ProcessingSpec · ReadinessScore · ScaffoldBlueprint。
- **新增链路**：数据源/图谱 → OntologyWorkflow → 提升本体 → scaffold 生成应用 → 发布 → 通用推演；pipeline 画布 ↔ databuilder 引擎（数据处理/接入）。
- **不变量**：R6 确定性(readiness/inference/scaffold byte-identical) · R2/R3 租户隔离 · R14 配置驱动 · Entitlement 先于 authz(B1) · KILL-MOCK-RED(B2/B4)。
- **回写母体**：WO-MERGE-03 回写 SYSTEM-ONTOLOGY.md §2(新对象类型)/§3(新链路)/§4(数据流) + 跑 `pnpm ontology:slices`（门 ontology-slices:check）。
