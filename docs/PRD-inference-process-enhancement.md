# PRD · 推演过程展示增强（story 编排 DAG + model 收敛网络，横切融入各推演入口）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-22 · 前端组件 + 后端编排轨迹 |
| 性质 | **横切增强**（roadmap §0 裁决）——story(编排推演 DAG) 与 model(型号产能推演收敛网络) **不做独立导航**，作为"推演过程展示"组件**融入每个推演入口**（QOS 答案块 / 产能推演 / 项目推演 / 规划体检 / 方案生成）；复用 A5 FDE 节点图 + QOS 答案 DAG block + order PRD 的 11 节点 DAG，**不重复造图引擎**。 |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§3 链路 / §4 事件 / §5 R13/R14 / §8 G-3 缺场景启动器·G-8 数据构建闭包 / GapReport 7 码 §2.D）· `docs/reference-prototype-decision-platform.html`（`STORY_SHORT` 10 步 L5118 · `STORY_POS`/`STORY_EDGES`(par/conv/aux/fb) L5119-5131 · `buildStoryDAG` L5132 · 逐步 IPO `steps[].{in,proc,out,nodes,data,solvers,agents}` L1394+ · `pmDagSVG` 型号收敛 L3773）· `apps/frontend-shell/src/components/QueryDock/`（`TaskRun.tsx`/`Timeline.tsx` QOS SSE 线性时间线）· `apps/frontend-shell/src/views/sim/PmDag.tsx`（型号步进 DAG）· `apps/frontend-shell/src/sse/useTaskStream.ts` |

> 一句话：HTML 的"决策推演编排 DAG"是一张 **10 节点非线性编排图**（②检索切片 ∥ ③装载因子 **并行**→④聚合 **汇聚**；⑩执行回采是**跨周期反馈**回流②记忆库/④系数），每节点可点开看 **输入/过程/输出 + 涉及对象/求解器/Agent + 缺口标红**。系统侧 QOS 真实跑了这条链（意图分类→路径A工作流/路径B Agent→求解器→SSE 答案），但前端只把它渲染成 **线性 SSE 时间线**（`Timeline.tsx`），丢了"并行/汇聚/反馈"的编排拓扑与逐节点 IPO。本 PRD 增一个**可复用 `<InferenceProcessDag>`**：把 QOS **真实编排轨迹**（QueryTask 阶段 + 涉及对象/求解器/Agent + GapReport 缺口）渲染为 HTML 同构的编排 DAG，挂到任意推演答案；缺口节点**红**取自 GapReport 7 码（守"绿测试≠能用"）。model 收敛网络作为该组件的"型号驱动"子模式（型号→认证产线→基地 点亮）。**轨迹来自真实运行，非写死**（R13/R14）。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2）：`QueryTask`（QOS 编排轨迹源，已在 agentcore）·`ExecutionPlan/Workflow/Agent/Skill/Solver`（节点类型，已在）·`GapReport`（缺口节点红，7 码，已在 growth/probe）·`Model→Line(认证关系)→Base`（型号收敛网络，已在本体）·`StoryBuildRun`（建域期推演轨迹，可复用同组件，已在 databuilder）。
- **触及链路**（§3）：把 QOS 链路 `意图分类 → (路径A 工作流编排 ∥ 路径B Agent) → 切片召回 ∥ 因子装载 → 聚合求解 → 校验解释 → 写回行动 → 执行回采(反馈)` **可视化为 DAG**——节点=阶段/制品，边=`par(并行)/conv(汇聚)/seq(序列)/aux(旁路校正)/fb(跨周期反馈)`（口径同 HTML `STORY_EDGES`）。
- **触及事件/数据流**（§4）：消费 QOS SSE 事件流（`useTaskStream`）映射为 DAG 节点状态（pending/running/done/gap）；不新增真值，纯渲染投影。
- **触及不变量**（§5）：R13（每节点 IPO + 涉及对象/求解器/Agent 可溯到真实运行轨迹，非编造）· R14（节点文案/拓扑由轨迹与编排定义派生，前端零写死步骤）· R-一致（与 A5 FDE 节点图、order 11 节点 DAG、PmDag 同一图渲染族）· **守 G-3/G-8**：缺口节点红=GapReport，诚实暴露"断在哪一步"。
- **关闭/影响断点**（§8）：**G-3（无场景启动器/presetContext 未注入 QOS）**——推演过程组件让 QOS 轨迹可见，辅助场景上下文回填；**G-8（数据构建闭包不验全链）**——建域期 StoryBuildRun 复用同组件，逐段闭包（CHAIN/SHAPE/OBJECT/DATA/FORWARD）可视化。
- **门禁**（§7）：`prd:check`·前端回归（推演各视图嵌入组件不破）·`debattery:check`（无写死步骤）·FDE 亲手跑（一条真实 QOS 推演 → DAG 各节点 IPO 对得上运行轨迹）。
- **回写承诺**：编排边语义（par/conv/aux/fb）+ `<InferenceProcessDag>` 作为推演过程标准展示 → 回写本体 §3（链路可视化约定）+ §4（SSE→DAG 映射）。

## 1. 目标 / 非目标（1:1=100%，色调/字体可调）
### 目标
1. **可复用 `<InferenceProcessDag>` 组件**：渲染编排 DAG（10 节点骨架：解析场景/检索切片/装载因子/聚合产能/识别瓶颈/情景推演/方案比对/校验解释/写回行动/执行回采），边含 `par/conv/aux/fb` 语义 + 图例（并行分叉/汇聚/历史校正旁路/跨周期反馈）。
2. **逐节点 IPO 抽屉**：点节点看 `输入(in)/过程(proc)/输出(out)` + `涉及对象(data)/求解器(solvers)/Agent(agents)`（口径同 HTML `steps[]`），数据取**真实 QOS 轨迹**。
3. **缺口标红**：未接入/未跑通节点红（取 GapReport 7 码 + StoryBuildRun.gapReport），如 HTML"⊕ 换型时间/物料齐套/OEE历史 标红"。
4. **横切挂载**：嵌入 QOS 答案块（QueryDock）、产能推演、项目推演、规划体检、方案生成——**任一推演答案均可展开"推演过程"**。
5. **model 收敛网络子模式**：型号驱动时，组件切"型号→已认证产线→基地 收敛网络"（只点亮相关网络，pmDagSVG 同构），复用 PmDag。
6. **真实轨迹驱动**：DAG 拓扑/节点状态/IPO 全由 QueryTask + SSE + 编排定义派生，前端零写死步骤（R13/R14）。

### 非目标
- 不新建独立导航视图（横切融入）。
- 不重写 QOS 编排逻辑（只把已有轨迹可视化）。
- 不造新图引擎（复用 A5 FDE 节点图 / PmDag / order 11 节点 DAG 的 SVG 渲染族）。
- 不写死 10 步（无真实轨迹的节点显式标"未跑/未接入"，不伪造）。

## 2. 现状与缺口（HTML vs 系统）
| HTML 元素 | 系统 | 缺口 |
|---|---|---|
| 10 节点编排 DAG（par/conv/aux/fb） | ◐ QOS 线性 SSE 时间线（`Timeline.tsx`） | **缺非线性编排拓扑可视化** |
| 逐节点 IPO（in/proc/out+对象/求解器/Agent） | ◐ TaskRun 显示阶段事件，无逐节点 IPO 抽屉 | 补 IPO 抽屉（取真实轨迹） |
| 缺口节点标红 | ✅ GapReport 7 码已在（growth/probe；StoryBuildRun.gapReport） | 接入 DAG 节点状态 |
| 跨周期反馈边（⑩→②/④） | ❌ | 补 fb 边语义 |
| 型号收敛网络（型号→认证产线→基地） | ✅ `PmDag`/ProjectSimView | 作为组件子模式归一 |
| 横切挂载到各推演答案 | ❌ 仅 QueryDock | 嵌入 risk/project/order/audit/generate |
| A5 FDE 节点图 | ✅ 已有图渲染族 | 复用其 SVG 基座 |

## 3. 设计
### 3.1 后端：编排轨迹投影（不新增真值）
- QOS `QueryTask` 增"轨迹投影"派生（或前端从 SSE 事件 + ExecutionPlan 组装）：节点列表（阶段/制品 + 涉及对象/求解器/Agent）+ 边（par/conv/seq/aux/fb，由编排定义与并行/反馈关系派生）+ 节点状态（pending/running/done + gap←GapReport）。纯投影，R13。
- 建域期复用 `StoryBuildRun`（comprehend/closure/scaffold 阶段 → 同结构节点）。
### 3.2 前端：`<InferenceProcessDag>`（复用图渲染族）
- props：`{nodes, edges, selected, onPick, mode: "orchestration"|"model-network"}`；SVG 基座复用 PmDag/A5 FDE 节点图；边样式按 par/conv/aux/fb 着色虚实 + 图例（同 HTML `legend`）。
- 节点抽屉：`in/proc/out` + `data/solvers/agents` 列表（点对象/求解器深链到本体/求解器页）；缺口节点红 + GapReport 码 + "断在<码>"诚实文案。
- `model-network` 子模式：渲染型号→认证产线→基地收敛（复用 PmDag perBase）。
### 3.3 横切挂载点
- QueryDock 答案块下"推演过程"折叠区；RiskBoard/ProjectSim/OrderChain/PlanAudit/PlanGenerate 答案/过程面板各加"查看推演过程"入口，传入该次推演的 QueryTask/solver 轨迹。
### 3.4 数据管线（R13/R14）
- 节点 IPO 取真实运行：QueryTask 阶段 + 求解器输入输出形状 + 涉及对象（lineage）；无运行则显式"未跑/未接入"，不伪造。

## 4. 契约 / 端点
- `contracts/`：`InferenceTraceSchema{nodes[{id,label,kind,in,proc,out,data[],solvers[],agents[],status,gapCode?}], edges[{from,to,type(par|conv|seq|aux|fb),label?}]}`（QOS 投影 + StoryBuildRun 共用）。
- 端点：`GET /api/v1/qos/tasks/:id/trace`（编排轨迹投影）· 复用 `GET /a/v1/databuilder/runs/:id`（建域轨迹）· 复用 lineage/solver 形状端点。

## 5. 关键流程
任一推演产生 QueryTask → trace 投影(节点+par/conv/fb 边+状态) → `<InferenceProcessDag>` 渲染 → 点节点看真实 IPO + 涉及对象/求解器/Agent → 缺口节点红(GapReport) → 型号驱动切收敛网络子模式。

## 6. 非功能（§5）
R13（轨迹真实可溯，非编造）· R14（拓扑/文案派生，零写死步骤）· R-一致（同一图渲染族）· R6（同一次运行轨迹确定）· 守 G-3/G-8（诚实暴露断点）。

## 7. 验收（DoD = 100% 1:1，色字可调）
- `<InferenceProcessDag>` 渲染 10 节点编排 + par/conv/aux/fb 边 + 图例，结构=HTML `buildStoryDAG`。
- 逐节点 IPO 抽屉（in/proc/out + 对象/求解器/Agent）取**真实 QOS 轨迹**；无运行节点诚实标"未跑/未接入"。
- 缺口节点红=GapReport 7 码；型号收敛网络子模式复用 PmDag。
- 横切挂载 ≥5 入口（QueryDock/risk/project/order/audit/generate）；前端零写死步骤（`debattery:check`）。
- `pnpm -r build && pnpm -r test` 全绿（trace 投影 + 各视图嵌入回归）；`prd:check` 过。FDE 亲手跑一条真实推演核对 DAG。
- 回写本体 §3/§4。

## 8. 分期
- **IPE.1** `InferenceTrace` 投影（QOS QueryTask + SSE → 节点/边/状态）+ `<InferenceProcessDag>` 组件（复用图基座）+ QueryDock 挂载。
- **IPE.2** 逐节点 IPO 抽屉（真实轨迹 + 对象/求解器/Agent 深链）+ 缺口红（GapReport）。
- **IPE.3** 横切挂载到 risk/project/order/audit/generate + model 收敛网络子模式 + 跨周期反馈边 + 建域期 StoryBuildRun 复用。

> 依赖：order PRD 的 11 节点 DAG 与本组件同图族（建议先有 ≥1 推演视图就绪再横切，roadmap §0）；A5 FDE 节点图基座复用。基线分支：前端组件 + QOS 轻投影端点，冲突小（不碰编排逻辑）。
