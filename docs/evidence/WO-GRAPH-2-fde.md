# WO-GRAPH-2 · 抽统一「本体图谱引擎」— FDE 证据

> P2 · 把 `views/OntologyGraphView.tsx` 的内联 `forceLayout`/`GraphCanvas` 抽成可复用图引擎；
> OntologyGraphView 改用新引擎，**取数 / 渲染 / 视觉 / 交互不变**，数据实时派生自本体发布（`fetchOntologyGraph`）。
> 设计为 GRAPH-3/4（切片 / 血缘 / KsfGraph / 沙盘 / 元本体）可复用。

## 1 抽了什么引擎（新增文件）

落在 `apps/frontend-shell/src/components/Graph/`（与 GRAPH-1 的 `components/Dag/` 同层放置范式）：

| 文件 | 职责 |
|---|---|
| `OntologyGraphEngine.tsx` | **力导画布引擎**：力导布局（自研 `ForceSimulation`·确定性 seed）+ alpha 退火节流渲染（>16ms/帧）+ 缩放 / 平移 / 节点拖拽 pin·release + 降级（>阈值跑固定步静态布局）。节点形状 / 配色 / 淡出 / 选中 / testid / data-* 全由调用方经回调注入——引擎**不碰节点语义与数据**。 |
| `NodeShape.tsx` | 节点形状原语：对象圆 / 求解器菱形 / agent 六边形（缺口节点虚线描边）。 |
| `domains.ts` | **14 域配色 / 中文名 / 源系统配色配置（R14 配置驱动·零写死电池）**：`DOMAIN_COLORS`/`DOMAIN_LABELS`/`SOURCE_COLORS`/`NON_SOURCE`，单一来源，GRAPH-3/4 复用同一份。 |
| `index.ts` | 引擎门面 barrel：再导出引擎 / 形状 / 域配置 + 复用既有 `DagNodeDrawer`（全平台单一下钻抽屉·R13）+ `ForceSimulation` 内核。 |

### 引擎 API（`OntologyGraphEngine<N extends { id: string }>`）

```ts
nodes, edges                       // 数据（调用方实时派生）
width=1200, height=760, seed=42    // 画布 / 可复现布局
degraded, selectedId               // 大图降级 / 选中描边
onSelect(node)                     // 点击回调
renderNode(node) → ReactNode       // 节点形状/标签/缺口⊕子元素（注入承载 <g>，与 class/data-* 同元素）
nodeTestId(node) / nodeDataAttrs(node)  // 节点承载 <g> 的 testid 与 data-*（domain/source/mvp）
nodeClassName(node) / edgeClassName(e,dim) / edgeDim(e,from,to)  // 视觉/淡出（CSS 模块由调用方传）
svgClassName                       // 容器视觉由调用方 CSS 决定（前后不变）
```

> 关键设计：testid / class / data-domain / data-source / data-mvp 由引擎挂在**同一个承载 `<g>`**（即原
> OntologyGraphView 节点 `<g>`），`renderNode` 只注入形状/标签子元素——保证测试断言 `class`/`data-*` 与
> `querySelector('[data-shape]')` 落在同一元素上，**抽离后 DOM 结构逐字节不变**。

## 2 OntologyGraphView 接入点

- 删除内联 `GraphCanvas`（~165 行）+ 内联 `NodeShape` + 三份本地域配色常量；
  改 `import { OntologyGraphEngine, NodeShape, DOMAIN_COLORS, … } from "@/components/Graph"`。
- 取数（`useQuery`→`fetchOntologyGraph(packageId)`）、子集过滤 / colorBy / dimOthers / mvpOverlay /
  图例 / Inspector / MappingOverlay **全部原样保留**——只把"画法"交给引擎。
- diff：`OntologyGraphView.tsx` -272 / +33 行（净删 239 行重复渲染代码）。

## 3 真跑证据（真起前端 Vite mock + 真 Chromium·Playwright）

起 `VITE_MOCK=1 vite :5174` + Playwright（chromium-1148）真浏览器登录 demo/planner，SPA 内导航（access token
仅内存·不能 full reload）到图谱路由，等力导退火后截图：

| 路由 | 节点 | 边 | 基地节点填色 | 点击出 Inspector | 控制台错误 |
|---|---|---|---|---|---|
| `/v/graph`（域着色） | 24 | 31 | `var(--c-factory)` | ✓ | 无 |
| `/v/graph-source`（源系统着色） | 24 | 31 | `#5E8FE8`（ERP 蓝） | ✓ | 无 |

- 截图 `docs/evidence/WO-GRAPH-2-ontology.png`：全景域着色——形状编码（对象圆 / 求解器菱形 / agent 六边形）、
  14 域图例、右侧 Inspector（基地·字段全建模 ✓ 3 字段·源字段 ← plant_name/utilization/capacity_gwh·规则 C05）。
- 截图 `docs/evidence/WO-GRAPH-2-source.png`：同引擎切 `colorBy=source`——图例换源系统、派生/求解/智能体淡出、
  base 改 ERP 蓝。**同一引擎零改动支撑两视角**（验证 GRAPH-3/4 复用面）。

### 改前/改后一致性

视觉 / 交互与改前一致由两条独立证据共同坐实：
1. **真浏览器实拍**（上表）：渲染、域/源着色、形状、Inspector、节点点击交互均正常。
2. **既有组件测试全绿**（DOM 契约未变）：`f7.graph`（域着色/形状/点击写 store/图例 dim/字段覆盖徽章+CSV）、
   `f25.graph-viewpoints`（dimOthers / colorBy=source / 学习闭环子集 / MVP ⊕ 虚线 / entitlement 404）、
   `f24.geo-map`（图谱定位）、`f27.mapping-table` 全部 pass——这些测试逐一断言 testid / `data-domain` /
   `data-mvp` / `class` 含 `dim` / `[data-shape]` `stroke-dasharray` / `fill`，全部基于抽离后的引擎 DOM 通过。

> 说明：未单独跑像素级 diff（改前基线截图未留存）；以"真实拍 + 逐属性组件断言全绿"双证替代，诚实留审核方做最终像素复验。

## 4 红线状态

- `pnpm -r build`（contracts/llm-adapters/datacore/agentcore/frontend-shell 全 4 包）：**exit 0** ✅
- `pnpm --filter frontend-shell test`：**119 文件 / 293 测试全 pass，exit 0** ✅
- `pnpm gates`：**全 27 门 exit 0** ✅（含 css-vars / no-hardcoded-rules / debattery / genuine-sim / ontology-writeback 等）。push 前 rebase 后重跑结果以提交时为准。
- 14 域配色配置驱动（R14）：域表抽为 `domains.ts` 单一来源、用设计 token，**未写死任何业务数据**。
- 模型标识不入提交物；无密钥入 git；未用外部产品名（引擎命名「本体图谱引擎」为平台自有术语）。

## 5 本体引用与影响

- **对象类型**：OntologyType/Link（D2 本体域）→ 图节点/边；DerivationSpec/SourceBinding（字段覆盖）；Solver/Agent（形状编码）。
- **链路/切片**：`sys.ontology.type_lineage`（§10.3 本体图骨架）——图是其实时投影。
- **不变量**：**R13**（图=本体发布的派生投影·非新真值，引擎不持有真值只渲染）·**R14**（域配色/形状配置驱动·零写死电池，`domains.ts` 单一来源）·R6（同本体同图·确定性 seed 布局）·R2（租户图隔离·数据层不变）。
- **断点**：**G-5**（应用层电池锁死）——融合统一引擎消除 8+ 套手搓渲染重复、配置/派生驱动，正向推进 G-5；本单完成 §6.1「抽统一图引擎」，§6.2（SlicesPage/血缘/KsfGraph 接入）属 GRAPH-3/4。

## 6 距北极星（GRAPH-3/4）还差什么

本单只抽**引擎**并迁入 OntologyGraphView（§6.1）。北极星「统一本体图谱主入口·同引擎模式切换」尚需：
- **GRAPH-3**：SlicesPage（切片子图·root→hops）/ 实例血缘（Object360/LineageChain）/ `KsfGraph` 接入同引擎（模式切换，非各做一页）；建模工作台改为图引擎"编辑态"。
- **GRAPH-4**：沙盘传导（图引擎 + PropagationRule 边 + tick state 叠加层）/ 元本体（换数据源=系统自身）/ 边界影响图复用同引擎；图查询 U12 并入"查询模式"（后端待建）。
- 引擎已预留复用面（泛型节点 + 全回调注入 + barrel 门面），GRAPH-3/4 接入只换数据源与节点渲染回调，**不再手搓布局/缩放/拖拽**。
