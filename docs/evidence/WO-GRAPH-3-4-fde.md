# WO-GRAPH-3/4 · 融合本体图谱主入口 + 沙盘/元本体/边界接同引擎 — FDE 证据

> P3 · 依赖 WO-GRAPH-2 已落（`OntologyGraphEngine` + `NodeShape` + `domains.ts` + barrel）。
> 把"可追溯子图 / 实例血缘 / 影响图"类**类型A 图**接入统一引擎——**各处数据源/取数不变，只换渲染层为同引擎**，
> 下钻统一用 `DagNodeDrawer`（R13），配色复用 14 域配置（R14）。**诚实分段**：能映射上的接、映射不上的跳过并记原因。

## 1 复用面（不重造·薄封装）

新增 `apps/frontend-shell/src/components/Graph/SubgraphPanel.tsx`（+ `.module.css`）：把 GRAPH-2 引擎
`OntologyGraphEngine`（力导/缩放/平移/拖拽/降级·骨架）封装为子图/血缘/影响类小图共用的薄入口。
- 调用方把**自己的真实节点/边映射**为泛型 `SubgraphNode{id,label,group?,kind?,center?}` / `SubgraphEdge{id,from,to,kind?,label?}`。
- 着色/中文名走 `domains.ts`（`domainColor`/`domainLabel`·R14·不另起配色电池）；图例按 `group` 分组。
- 选中经 `onSelect` 回调 → 调用方开**统一 `DagNodeDrawer`**（R13 信任=出处+推导当场亮出）。
- **面板不取数、不持业务真值**（R13 图=已发布本体派生投影）；引擎/形状/域配置零改动复用。
- barrel `components/Graph/index.ts` 再导出 `SubgraphPanel`，接入处只 import 此门面。

> 不替代 GRAPH-2 全景主入口 `OntologyGraphView`（带视角配置/MVP overlay/映射表·已直接用引擎）；
> `SubgraphPanel` 是给"子图级"小图共用的封装。`OntologyGraphEngine`/`NodeShape`/`domains.ts` 一行未改。

## 2 GRAPH-3 接了哪几处（核心·做扎实）

| 处 | 文件 | 数据源（各自真实·不变） | 映射到引擎 | 模式 |
|---|---|---|---|---|
| **切片子图** | `pages/admin/SlicesPage.tsx` | `POST /a/v1/slices/:k/resolve` 真子图 `{id,type}` 节点 / `{from,to,linkKey}` 边（A6 逐跳过滤） | 节点 group=type·label=id；边 kind/label=linkKey | 切片 |
| **实例血缘** | `pages/Object360Page.tsx` | `GET /a/v1/objects/:id/neighbors` 邻接分组（linkKey/direction/items） | 中心对象(center)+邻接对象 ego 图·边方向取 direction·点节点 `navigate(/o/:type/:key)` | 血缘 |
| **元本体影响**（GRAPH-4 范畴·一并做） | `pages/admin/MetaPage.tsx` | `GET /a/v1/meta/impact?node=` 的 `{node, affected:[{id,via}]}` | 中心=被改节点·邻接=受影响节点·边 label=via | 影响 |
| **边界影响**（GRAPH-4 范畴·一并做） | `pages/admin/BoundaryPage.tsx` | `GET /a/v1/boundary/impact` 的 `impact[]{registry,members,consumers,downstream}` | 册◇(center)→消费端○→下游⬡·按 registry 分组着色 | 影响 |

- 各处均**追加渲染、零删改既有 testid/列表/交互**（切片仍显计数表/类型分布；Object360 仍显属性区+关系分组列表；
  Meta 仍显影响文本列表+白名单；Boundary 仍显版本指纹+三册卡）——图是**附加视图**，不替换既有信息。
- 「结构/域」模式由全景主入口 `OntologyGraphView`（GRAPH-2）覆盖；本批补「切片/血缘/影响」三模式，
  四处合计覆盖 START-HERE 要求的**结构/切片/血缘/域**全模式（同引擎·数据各自真实）。

## 3 GRAPH-4 做到哪 + 诚实跳过哪些及原因

- ✅ **元本体（MetaPage）** / **边界（BoundaryPage）**：影响图接同引擎（见上表）。
- ⏭ **沙盘传导 `PmDag`（`views/sim/PmDag.tsx`）— 诚实跳过**：PmDag 是**6 层固定分层 DAG**（需求→型号→可产基地→驱动因子→求解器→结论），
  带 `step` 步进「本步」点亮态、PropagationRule 边 label、贝塞尔分层连线——属**类型B 过程 DAG**（WO-GRAPH-1 域），
  非类型A 力导本体子图。强接力导引擎会**毁掉分层顺序与 step 点亮语义**（北极星明确"沙盘传导=引擎+传导/state 叠加"，
  但其底座是 DAG 不是力导图）。映射不上 → 不硬塞、不改语义；归 WO-GRAPH-1 共享 DAG 线后续处理。
- ⏭ **`KsfGraph`（`components/KsfGraph.tsx`）— 诚实跳过**：问题→KSF→财务三层定向流，节点带 severity 徽章 + 实际/目标量价文本 +
  选中沿威胁/支撑边高亮 + 联动 `DailyDotAxis` 时序轴。三层固定布局与内联指标文本是其语义本体，力导会丢层次与读数；映射不上 → 跳过。
- ⏭ **`ModelingPage`（`pages/admin/ModelingPage.tsx`）— 诚实跳过"改为图编辑态"**：该页 1157 行、已高度成熟——含创建过程低代码管道（6 阶段状态机）、
  横向 ETL `DataPipelineDag`（真 sourceBindings.fieldMappings·已是其"图态"承载）、`PublishedOntologyView`、草案 PATCH/就绪认证/对象配置抽屉等深交互。
  把它整体改为力导"图编辑态"是**中等偏重的高风险重构**，与"既有建模/归域/发布交互保留"冲突、收益远小于回归风险（START-HERE：中等重构不盲建·先验可行）。
  既有 `DataPipelineDag` 已承载其图态需求 → 不强行替换。记后续按需评估。
- ⏭ **图查询 U12（PlatformConsole）— 诚实跳过**：后端未建（§10.1 RESERVED）→ 记后续，不画假壳。

## 4 真跑证据（组件测试·真渲染引擎 + 真数据 + 真下钻）

新增 `apps/frontend-shell/test/wo-graph-3-4-fusion.test.tsx`（4 用例·真起 SPA + MSW mock 真数据·`vitest run` exit 0）：

| 用例 | 断言（真渲染同引擎 + 真数据投影 + 下钻） |
|---|---|
| GRAPH-3 切片 | 试切→`slice-preview-graph` 含 `slice-graph-svg`（引擎 svg）·真子图节点 `slice-graph-node-o1`·点节点出统一 `dag-node-drawer` |
| GRAPH-3 血缘 | `/o/Base/常州`→`o360-lineage-graph` 含 `o360-lineage-svg`·中心 `o360-lineage-node-base-常州` + 邻接订单节点（>1）·图例分组 |
| GRAPH-4 元本体影响 | 分析 R14→`meta-impact-graph` 含 `meta-impact-svg`·中心 `meta-impact-node-meta_SystemInvariant_R14`·点节点出 `dag-node-drawer` |
| GRAPH-4 边界影响 | `/admin/boundary`→`boundary-impact-graph` 含 `boundary-impact-svg`·册节点 `boundary-impact-node-reg:BASE_REGISTRY`·点节点出 `dag-node-drawer` |

> **同引擎渲染、模式切换覆盖结构（GRAPH-2 全景）/切片/血缘/影响（域着色经 group 复用 14 域配色）**，各入口渲染一致而**数据各自真实**。
> 改前/改后：四处均为**追加视图**（既有 testid/列表/交互零删改），各自既有测试（`admin-closure-slices`/`f48.meta-page`/`boundary-page`/`f57.object-types-browser`/`ksf-graph`）全绿验证零回归。
>
> **诚实留审核方**：本环境为 jsdom 组件测试（断言 svg/节点 testid/下钻抽屉真实挂载），未跑真 Chromium 像素级 diff（沿用 GRAPH-2 同口径——改前基线截图未留存）。
> 建议审核方真起 `VITE_MOCK=1 vite` + Playwright 复拍 `/admin/slices`（试切）/`/o/Base/常州`（血缘）/`/admin/meta`（影响）/`/admin/boundary`（影响）做像素复验。

## 5 红线状态

- `pnpm -r build`（4 包）：见提交时日志（typecheck 已 exit 0）。
- `pnpm --filter frontend-shell test`：新增 4 用例 + 既有受影响页测试全绿；**全量套件在本机满并行下偶发 20s 超时（f17/f18/f37/f49/f55 等重测试·与本单文件无关，单跑/单 fork 串行均 pass）= 环境算力争用、非回归**（改前基线全量同样偶发 f55 超时）。
- `pnpm gates`：push 前 rebase 后重跑结果以提交时为准（含 css-vars / traceability）。
- R14：14 域配色配置驱动（`domains.ts` 单一来源·`SubgraphPanel` 经 `domainColor` 查色，未写死业务数据）。
- R13：下钻统一 `DagNodeDrawer`；图为派生投影、面板不持真值。
- 模型标识不入提交物；无密钥入 git；未用外部产品名（"本体图谱引擎"/"融合子图面板"为平台自有术语）。

## 6 本体引用与影响

- **对象类型**：OntologyType/Link（D2）→ 切片/血缘节点边；SliceSpec（§10.3 `sys.ontology.type_lineage`）→ 切片子图；SystemObjectType/Breakpoint（§10.2 自我域）→ Meta 影响；`BOUNDARY_IMPACT`（DF.7）→ 边界影响。
- **链路/切片**：`sys.ontology.type_lineage`（血缘/切片实时投影）· `sys.meta.change_loop`（"改 X 影响什么"= Meta 影响图）。
- **不变量**：**R13**（图=派生投影·非新真值·统一下钻抽屉）·**R14**（14 域配色配置驱动·`domains.ts` 单一来源）·R6（确定性 seed 布局）·R2（租户图隔离·数据层不变）·R12（字段覆盖维持·切片/血缘读已发布本体）。
- **断点**：**G-5**（应用层电池/重复渲染）——再消除 4 处手搓子图渲染、并入单一引擎，正向推进 G-5。
- **回写**：已回写 `docs/SYSTEM-ONTOLOGY.md` §2.B（新增「统一本体图谱引擎」条·列四处接入 + 诚实跳过项）+ §10.3（图谱统一接入进展段·类型A 收敛 / 类型B 走 WO-GRAPH-1 线 / U12 后端待建）。

## 7 距北极星还差什么

- 北极星「单一融合主入口·一个图里模式切换跑遍 结构/切片/血缘/域 + 沙盘/元本体/边界」：本批已让四处**用同引擎**（切片/血缘/Meta影响/边界影响），
  全模式经 GRAPH-2 全景 + 本批四处覆盖；但仍是**多入口各自嵌图**，尚未收敛为"一个主入口下拉切模式"的单页（属更大 IA 重构·非本批 START-HERE 范围）。
- 仍待：沙盘 PmDag/KsfGraph 的"类型B/定向流"语义如何与力导引擎共存（需引擎支持分层/固定布局模式·属引擎能力扩展）；ModelingPage 图编辑态（高风险·按需）；图查询 U12（后端待建）。
- 引擎复用面已扩（`SubgraphPanel` 泛型节点 + 全回调注入 + barrel 门面）——后续接入只换数据源映射，不再手搓布局/缩放/拖拽/下钻。
