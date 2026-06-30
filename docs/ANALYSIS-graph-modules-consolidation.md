# 分析 · 「图谱」相关模块的融合与分散

> 用户问：系统里与「图谱」相关的功能模块有多个，哪些可融合为一个模块、哪些需分散到其他入口（例：基于本体建模 + 本体切片完成实时的图谱）。
> 审核方按铁律0 沿本体走查（已读 `SYSTEM-ONTOLOGY.md` §2.B/§10.3/§10.4）+ 真盘点前端模块后给分析。**结论先行**：当前把**三种本质不同的"图"**混在一堆散件里——分清它们，融合/分散自然成立。

## §0 真盘点（前端现存图谱/DAG 件）

| 模块 | 文件 | 本质 | 数据源 |
|---|---|---|---|
| 本体结构图 | `views/OntologyGraphView.tsx`（`/v/graph`·力导 `forceLayout`+`MappingOverlay`） | 类型/链路图 | **实时** `fetchOntologyGraph`（已派生自已发布本体·域配色） |
| 本体切片 | `pages/admin/SlicesPage.tsx`（SliceSpec root→hops） | 本体子图选择 | 本体链路图 BFS（slice-planner） |
| 实例血缘 | `Object360`/`LineageChain` | 实例级子图 | 对象 origin→数据集→派生 |
| KSF/指标图 | `components/KsfGraph.tsx` | Metric→KSF→Principal | = 本体的一个切片（决策域对象+链路） |
| 数据管道 DAG | `pages/admin/ModelingPage`（`DataPipelineDag`） | 连接器→数据集→类型→对象 | = `sys.ingest.data_to_object` 切片 |
| 元本体图 | `pages/admin/MetaPage`（dogfooding） | 系统自身作对象图 | 同形态·换数据源（平台自我本体） |
| 边界影响图 | `pages/admin/BoundaryPage`（BOUNDARY_IMPACT） | 业务册→消费端依赖 | 半本体依赖图 |
| 沙盘传导拓扑 | `views/sim/PmDag.tsx`/`SandboxView` | 类型节点+传导规则边+tick态 | = 本体图 + PropagationRule 叠加 + state |
| **推演过程编排 DAG** | `components/InferenceProcessDag.tsx` | **步骤/求解器/事件**（par/conv/seq/aux/fb） | QOS 编排轨迹（§10.3 `sys.orch.query_to_answer`） |
| **根因归因 DAG** | `components/ProvenanceDag.tsx` | **KPI→因子→证据** | 求解器 `plan_rootcause` 输出 |
| **任务/分层 DAG** | `components/Dag/LayeredDag.tsx`+`taskDag.ts` | 任务编排步骤 | 任务流 |
| **FDE 建域节点图** | `DataBuilderPage`（`FdeGraph`） | 7 建域步 | BuildWorkflowRun |
| **推演验证痕迹** | `components/Answer/ValidationTracePanel.tsx` | 一致/交叉验证链 | Answer.validationTrace |
| 低代码图查询 | `PlatformConsole`（U12·RESERVED） | 图上构建查询 | 后端未建 |

## §1 关键判据：节点语义 = 域归属（§10.4）

把上表按**节点是什么**分三类（与本体 §10.2 的系统自我域对齐）——这是融合/分散的唯一判据：

- **类型 A·本体图**：节点=**对象类型/实例**，边=**本体链路 OntologyLink**（域 **D2 本体域**）。→ 本体结构图 / 切片 / 实例血缘 / KSF图 / 数据管道DAG / 元本体图 / 边界影响图 / 沙盘传导拓扑（=本体图+叠加）。**全是同一张图（OntologyType/Link）的不同视图/子图/叠加。**
- **类型 B·过程/因果 DAG**：节点=**步骤/求解器/事件/因子**，边=**par/conv/seq/aux/fb**（域 **D7 编排 / D4 推演**）。→ 推演过程编排DAG / 根因归因DAG / 任务DAG / FDE建域图 / 验证痕迹。**和本体无关，是"怎么算出来的"。**
- **类型 C·图上交互层**：在图上**编辑/查询**。→ 本体建模工作台（图的编辑态）/ 低代码图查询（U12）。

> 本体 §10.4 已把 `SliceSpec`（D2↔D7↔D6）与 `InferenceProcess`（D7）登记为**不同跨域节点、不同域**——它们语义不同、不该塞进同一模块。这就是分散线。

## §2 建议：融合什么

### ✅ 融合为一个「本体图谱」模块（统一图引擎 + 实时派生）= 用户的洞察

把**类型 A 全部**收敛为**一个图引擎 + 一个主入口**：

- **一个图引擎**（统一 节点/边/布局[力导或分层]/下钻抽屉 `DagNodeDrawer`/域配色[14 域 R14 配置驱动]/缩放/框选）。当前 OntologyGraphView 的 `forceLayout` 是它的雏形。
- **数据实时派生**（用户原话「基于本体建模、本体切片完成实时的图谱」精确成立）：
  `本体建模发布(D2 OntologyType/Link)` → `切片(SliceSpec root→hops·§10.3 子图)` → `实例物化(lineage)` → **图就是这三者的实时投影**（R13 渲染派生·非新真值；R6 同本体同图）。
- **视图模式（同引擎切换·非各做一个页）**：① 全局结构 ② 切片子图（选 root+hops/复用 slice-planner）③ 实例血缘（钻到对象）④ 域过滤/分组 ⑤ 沙盘传导（叠加 PropagationRule 边 + tick state 着色）⑥ 元本体（换数据源=系统自身·dogfooding）。
- **建模工作台 = 这张图的"编辑态"**（ModelingPage 不再是另一套渲染，而是图引擎的编辑模式：拖类型/连链路/设派生→发布）。**切片 = 保存的子图选择**（SlicesPage 降为图引擎里"我的切片"侧栏）。

> 收益：消除 8+ 套手搓图渲染的重复；"改一处本体→所有图谱视图实时同步"（呼应 G-5 去电池——视图结构不写死、配置/派生驱动）。

### ✅ 融合为一个「过程 DAG」共享渲染组件（语义分散、渲染复用）

类型 B 的**渲染**抽成一个共享组件（统一 par/conv/seq/aux/fb 边样式 + 节点 IPO 抽屉 + 缺口红标），消除 `InferenceProcessDag`/`ProvenanceDag`/`LayeredDag`/`FdeGraph` 各自手搓 SVG 的重复——**但不合并入口**（见 §3）。

## §3 建议：分散什么（到各自语义入口）

类型 B 的**入口**必须分散——它们是"过程/因果"，挂在结果旁才有意义：

- **推演过程编排 DAG** → 留 **QueryDock 答案块"推演过程"折叠**（§10.3 `sys.orch.query_to_answer`）。不进本体图谱模块。
- **根因归因 DAG** → 留 **驾驶舱"未达成指标下钻"**（KPI→因子→证据）。
- **FDE 建域节点图** → 留 **数据构建发动机页**。
- **验证痕迹** → 留 **答案 ValidationTracePanel**。
- 四者**共用 §2 的过程 DAG 渲染组件**，语义/入口不动。

类型 C：
- **图查询低代码（U12）** → 作为**本体图谱模块的一个"查询模式"**（图上框选 root→hops→生成切片/平台查询→绑 Skill/MCP），**不是独立模块**。后端建好后接入。

类型 A 里两个**入口保留独立、但渲染复用统一引擎**（语义是"治理/自省"，受众不同）：
- **边界影响图**（治理·"改 X 影响什么"）→ 留管理台·边界治理，但底层用同图引擎（它本质是本体依赖视图）。
- **元本体图**（dogfooding·平台自省）→ 留管理台·元本体，同引擎换数据源（§10.5.4 已规划"用平台 executeSlice 切系统自己"）。

## §4 一句话决策表

| 模块 | 处置 |
|---|---|
| 本体结构图 / 切片 / 实例血缘 / KSF图 / 数据管道DAG | **融合**→「本体图谱」模块（同引擎·模式切换） |
| 建模工作台 | **融合为图谱"编辑态"** |
| 沙盘传导拓扑 | 复用图引擎 + 传导/state 叠加层（沙盘入口保留） |
| 元本体图 / 边界影响图 | 入口独立、**渲染复用同引擎** |
| 低代码图查询(U12) | **并入图谱模块**作"查询模式"（后端待建） |
| 推演过程DAG / 根因DAG / FDE图 / 验证痕迹 | **分散到各自结果入口**，但**共用一个过程DAG渲染组件** |

## §5 本体引用与影响

- **对象类型**：OntologyType/Link/Version/**SliceSpec**/DerivationSpec(D2)·ObjectInstance(血缘)·**SystemObjectType/Link**(元本体)·**PropagationRule**(沙盘)·Metric/KSF/Principal(KSF切片)；过程侧 Intent/ExecutionPlan/Solver/Task(D7/D4)。
- **链路/切片**：`sys.ontology.type_lineage`(§10.3·本体图骨架)·`sys.ingest.data_to_object`(数据管道DAG)·`sys.orch.query_to_answer`(过程DAG·**另一域**)·`sys.meta.change_loop`(元本体)。**§10.3「域内切片=可追溯子图」即本体图谱的数据契约——图谱数据模型本体里已有，融合不需新建数据层、只统一渲染+模式。**
- **不变量**：R2(租户图隔离)·R13(图渲染=派生投影非新真值)·R14(域配色/拓扑配置驱动·零写死电池)·R6(同本体同图字节一致)。
- **断点**：**G-5**(应用层电池锁死——图谱视图结构若写死违此；融合后配置/派生驱动正解之)·**U12**(图查询 RESERVED·并入图谱模块为其找到归属)·dogfooding(§10.5.4 元本体落库·融合后元本体=同引擎)。
- **回写**：若实施融合 → 回写 §2.B（本体图谱视图统一）+ §10.3（切片=图谱子图渲染契约）+ §8（G-5 图谱侧关闭进度）。

## §6 落地建议（分阶段·若采纳再转 HANDOFF）

1. **抽统一图引擎组件**（节点/边/布局/下钻抽屉/域配色），`OntologyGraphView` 先迁入。
2. **融合主入口「本体图谱」**：SlicesPage/实例血缘/KsfGraph 接入同引擎（模式切换），建模工作台改为"编辑态"。
3. **抽统一过程DAG渲染组件**，`InferenceProcessDag`/`ProvenanceDag`/`FdeGraph`/`taskDag` 各入口复用（语义不动）。
4. **沙盘传导**=图引擎+叠加层；**元本体/边界**=同引擎换数据源。
5. **图查询(U12)** 后端建好后并入图谱"查询模式"。

> **边界（诚实）**：这是**架构分析+建议**，非施工单。融合是中等规模重构（动 8+ 模块的渲染层 + 入口信息架构），建议先小步：① 先抽两个共享引擎（本体图/过程DAG），② 再渐进迁各页入同引擎，③ 入口信息架构调整(融合主入口)最后做。**不要一次性大重构**（违 START-HERE §3 警告）。

---
*审核方架构分析（design+review）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
