# WO-GRAPH-1 · 抽统一「过程 DAG」渲染组件 — FDE 真跑证据

> 母单：`docs/ANALYSIS-graph-modules-consolidation.md`（类型 B·过程 DAG 渲染复用）· 施工单：`docs/WO-design-landing-batch2.md` WO-GRAPH-1。
> 红线：只换渲染层·四处入口/数据/语义严格不动；`InferenceProcessDag` 的对比度修（`--txt` 非 `--text`）随迁不回潮（css-vars:check 守）。

## 1. 抽出的共享组件 + API

### 1.1 `components/Dag/dagStyles.ts`（视觉语言单一来源）
把类型 B 过程 DAG 散在四处的视觉语言收敛为单一来源：
- `EDGE_STYLE: Record<EdgeType, {color,dash?,label}>` —— 五类边 `par`(并行分叉 `#54B5C4`) / `conv`(汇聚 `#7CC4A0`) / `seq`(序列 `#6B7886`) / `aux`(历史校正旁路 `#E8B54A` dash) / `fb`(跨周期反馈 `#C470B8` dash)。原 `InferenceProcessDag` 内联表迁此。
- `GAP_COLOR = "#DD7E9E"` —— 缺口/越线统一红（"缺口红标"单一来源；`ProvenanceDag` 的 RED 改引此值，与原 `#DD7E9E` 字节相同→零视觉变化）。
- `bezierPath(x1,y1,x2,y2)` —— 水平贝塞尔连线 d（四处同形 `M x1,y1 C mx,y1 mx,y2 x2,y2`）。
- `nodeFillAlpha()` —— 节点透明面板底色（原 LayeredDag `cssColorAlpha`）。

### 1.2 `components/Dag/ProcessDag.tsx`（共享 SVG 渲染骨架）
```ts
<ProcessDag
  nodes={ProcessDagNode[]}          // {id,x,y,w,h?}  调用方算坐标
  edges={ProcessDagEdge[]}          // {from,to,type?,testId?,color?,className?,…}
  width height viewBox?             // viewBox→自适应缩放；否则固定宽高+横向滚动
  showLegend? legendTypes? legendTestId?
  renderNode={(node)=>ReactNode}    // 节点 DOM 由调用方注入（保留各自 testid/语义/交互）
  svgExtras? footer?                // 泳道标题 / IPO 抽屉面板
  showArrow? ariaLabel? testId? containerClassName? svgClassName? dataAttrs?
/>
```
职责边界：ProcessDag 只管**坐标系/类型化连线(EDGE_STYLE)/箭头 marker/缩放/图例/容器**；
节点 DOM、状态语义、点击交互、数据全部留在调用方 `renderNode`/`footer`——**只换渲染层，语义/数据不碰**。

## 2. 四处接入点

| 渲染件 | 文件 | 接入方式 | DOM 契约保持 |
|---|---|---|---|
| 推演过程编排 DAG | `components/InferenceProcessDag.tsx` | orchestration 模式经 `<ProcessDag>`（viewBox 缩放 + 类型边 + 图例 + footer=IPO 面板）；model-network 模式不动 | `inference-node-{id}` / `inference-edge-{from}-{to}-{t}` / `inference-legend` / `inference-ipo-{id}` / `data-status` / `data-mode` 全保留；连线锚点用半宽 56→逐像素一致 |
| 任务/分层 DAG | `components/Dag/LayeredDag.tsx` | 分层布局算法保留，渲染经 `<ProcessDag>`（固定宽高 + `.edge` CSS 边 + `svgExtras`=泳道标题 + 无箭头） | `${testId}-node-{id}` / `data-layer` / `data-state` / `data-layers` / `<rect stroke>` / `fill="var(--txt)"` 全保留 |
| 根因归因 DAG | `components/ProvenanceDag.tsx` | 嵌套 HTML 树布局不动（非 SVG）；仅把越线红 `RED` 接 `GAP_COLOR` 单一来源（字节相同） | `provenance-dag` / `dag-node-{id}` / `data-kind` / KSF/event 层全保留 |
| FDE 建域节点图 | `pages/admin/DataBuilderPage.tsx` `FdeGraph` | **未改**（横向 flex `→` 链布局，build-status 调色板与过程 DAG 不同语义）——见 §5 诚实说明 | `fde-node-{key}` / `data-status` / gapcode 全保留 |

> 说明：`InferenceProcessDag`/`LayeredDag` 两处本就是 SVG 贝塞尔过程图——做了**真正的渲染骨架抽取**（同走 `<ProcessDag>`）。
> `ProvenanceDag`（嵌套树）与 `FdeGraph`（flex 链）布局形态与 SVG 骨架不同、且各被严格测试钉死 DOM——
> 强行塞进 SVG 骨架会改视觉/破语义（违 WO「视觉前后一致·语义不动」红线）。故对这两处采"共享**视觉语言**（dagStyles）而非共享 SVG 骨架"的诚实做法：ProvenanceDag 接 `GAP_COLOR` 单一来源。

## 3. 截图对比（真起前端·真浏览器 Playwright）

- 环境：`VITE_MOCK=1` 真起 frontend dev server（:5199）+ Playwright（chromium，真浏览器），planner 登录走真 UI。
- 方法：同一脚本对 **stash 前（before=未改）** 与 **stash pop 后（after=已抽组件）** 各跑一遍，逐页 SPA 导航截图。
- 结果（`cmp -s` 字节比对）：

| 页面 / 渲染件 | before | after | 比对 |
|---|---|---|---|
| `/v/plan-audit` 推演过程 DAG（InferenceProcessDag，点开 IPO node-4） | 234452B | 234452B | **字节完全一致** |
| `/v/order-chain` 订单全链 DAG（LayeredDag ofc-dag） | 265730B | 265730B | **字节完全一致** |
| `/v/dash` 根因归因 DAG（ProvenanceDag，RED 越线根） | 279628B | 279628B | **字节完全一致** |
| `/admin/data-builder`（FdeGraph 区·未改） | 309155B | 309155B | **字节完全一致** |

四处 before/after **逐像素字节相同**——抽组件后输出与原渲染完全等价（视觉/交互零差异）。
留档截图：`docs/evidence/wo-graph-1/{inference-dag,layered-ofc-dag,provenance-dag}-after.png`。

## 4. 语义/数据未变的核对

- **入口不变**：四处仍由原视图/页挂载（plan-audit/order-chain/dashboard/data-builder），nav 不动。
- **数据不变**：未触任何 mock fixtures / API / solver 输出；节点/边/状态仍由各自原数据派生（InferenceProcessDag 由 `deriveStatus(TaskStreamState)`、LayeredDag 由调用方 nodes/edges、ProvenanceDag 由 `plan_rootcause` 输出）。
- **DOM 契约不变**：8 个 DAG 相关测试文件全绿（见 §6），其中逐项断言 `inference-edge-*`/`inference-ipo-*`、`task-dag-node-*` rect stroke 着色、`data-layers`/`data-state`、`provenance-dag` 三层 `data-kind`、`fde-node-*` 状态/gapcode。
- **对比度修不回潮**：`InferenceProcessDag.module.css` 仍用 `--txt`；LayeredDag/ProcessDag 文字均 `fill="var(--txt)"`；`css-vars:check` 通过（扫 32 个 .css 含新增 `ProcessDag.module.css`，裸 var() 均有定义）。

## 5. 诚实说明（FDE·不报喜不报忧）

- **FdeGraph 未迁**：它是横向 flex `→` 链（非 SVG），且 build-status 调色板（DONE/RUNNING/FAILED/SKIPPED/PENDING，FAILED 用 `--danger #E5484D`）与过程 DAG 的 done/running/pending/gap 语义不同。把它强行套进 SVG `<ProcessDag>` 会改其视觉与破 f58 测试契约——**违 WO 红线**，故诚实不动。它与共享视觉语言的对齐（gap 红统一、可选迁 flex→SVG）留给北极星阶段评估。
- **ProvenanceDag 是"渲染语言共享"而非"渲染骨架共享"**：它的嵌套缩进树 + DagNodeDrawer 点穿 + KSF/event 多层结构与 SVG 骨架正交，本次只单一来源化越线红（真去重·零视觉变化），未把树塞进 SVG。

## 6. 红线核对（真跑为据）

- `pnpm --filter frontend-shell typecheck`：**0 错**（我改的 6 文件无类型错）。
- `pnpm --filter frontend-shell test`：**118 文件 / 289 测试全绿**（与抽组件前基线 118/289 完全一致·零回归）。
- 八个 DAG 相关测试单独复跑全绿：`inference-dag` `f26.task-dag` `f58.fde-graph` `cockpit-rootcause-dag` `f23.order-chain` `order-fullchain` `f18.project-sim` `sandbox-view`（34 测试）。
- `pnpm -r build`（4 包）：全绿（contracts/llm-adapters/datacore/agentcore/frontend 均 Done）。
- `pnpm gates`：**全 27 门绿**（含 `css-vars:check`、`no-silent-mock`、`traceability` 等）。

## 7. 距北极星（GRAPH-2/3/4）还差什么

- **WO-GRAPH-2（本体图谱引擎）**：本单只做了类型 B（过程 DAG）渲染复用；类型 A（本体结构图/切片/血缘/KSF/数据管道）的力导图引擎抽取（`OntologyGraphView.forceLayout` → 可复用引擎 + 14 域配色 + 框选）尚未做。
- **WO-GRAPH-3/4（融合主入口）**：SlicesPage/Object360 血缘/KsfGraph 接同引擎、建模工作台改"编辑态"、沙盘传导/元本体/边界换数据源、图查询(U12)并入——均依赖 GRAPH-2 先落，未动。
- **过程 DAG 侧剩余**：FdeGraph（flex 链）若要真正"四处共用一个 SVG 组件"，需把它改为 SVG 布局 + 调色板对齐——属视觉变更，须先与设计/审核方确认再做（本单按红线诚实不动）。

---
*dev 实装（worktree 隔离）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
