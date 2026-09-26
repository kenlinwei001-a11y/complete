# 工业级 PRD · 编排推演 DAG（story）· 1:1 复刻（UI + UX + 数据）

| 项 | 值 |
|---|---|
| 版本 | v1.0 · 状态 READY-FOR-DEV · 日期 2026-06-22 · 全栈自包含 |
| 读者 | 研发人员（前端 + 后端 + 契约）。**只读本文 + 像素参照 HTML 即可 1:1 实现**。 |
| 1:1 真相源 | `docs/reference-prototype-decision-platform.html`：`STORY_SHORT`/`STORY_POS`/`STORY_EDGES` **L5118–5131** · `buildStoryDAG` **L5135** · `showStoryNode`/`storyDetailHTML`/`storyAsk` **L5168–5246** · 逐步 IPO `VIEWS.story.steps[]` **L1390–1468** · DAG 样式 CSS **L252–257 / L499–509** · `chip()` **L5217–5220** · `linkRules`/`showRulePop` **L5198–5216**。本文已把全部常量/坐标/边/IPO 文案转录；研发以本文为准、HTML 仅作像素核对。 |
| 落点（**横切增强,融入,不新建导航**） | 性质 = roadmap §0 裁决的"推演过程展示"横切组件,**不占导航**。新增可复用前端组件 `apps/frontend-shell/src/components/InferenceDag/InferenceProcessDag.tsx`（图基座复用 `apps/frontend-shell/src/views/sim/PmDag.tsx`）· 抽屉 `NodeIpoDrawer.tsx` · trace 投影 hook（从 `useTaskStream` 状态 + decision-trace 端点派生）· 挂载点 `apps/frontend-shell/src/components/QueryDock/TaskRun.tsx`（+ risk/project/order/audit/generate 各推演答案）· 后端轨迹投影端点 `apps/agentcore/src/server.ts`（复用 `GET /api/v1/queries/:taskId/decision-trace` L407 + 新增 `…/trace`）· 契约 `packages/contracts/src/qos.ts` 新增 `InferenceTraceSchema`。 |
| 复用结构 PRD | `docs/PRD-inference-process-enhancement.md`（同方向 DRAFT,提出 `<InferenceProcessDag>` + par/conv/aux/fb + 缺口红 + 横切挂载）——本文是其**工业级落地实现**,取代其 §3–§8 的粗粒度。 |
| 不变量 | **R14**（前端零写死:DAG 拓扑/IPO 来自真实 QueryTask 轨迹,非写死 10 步）· **R13**（每节点 IPO + 对象/求解器/Agent 可溯到真实运行）· **R6**（同一次运行轨迹确定）· R-一致（与 PmDag / A5 FDE 节点图 / order 11 节点 DAG 同图渲染族）· 守 **G-3 / G-8**（缺口节点红=GapReport,诚实暴露"断在哪一步"）· 1:1=结构/数据/交互 100%,**唯色调/字体可调**。 |

---

## 1. 视图概述

HTML 的"决策推演模拟 · 编排 DAG"是一张 **10 节点非线性编排图**，演示一次完整决策推演的全过程：场景 = "重点客户追加 20% 的 4680 PACK 订单、要求 6 周交付——能否接？瓶颈在哪？要不要加夜班/扩化成通道/外协？"。

10 节点：**①解析场景 · ②检索切片 · ③装载因子 · ④聚合产能 · ⑤识别瓶颈 · ⑥情景推演 · ⑦方案比对 · ⑧校验解释 · ⑨写回行动 · ⑩执行回采**。关键：**不是 1→10 顺序流**——②检索切片 与 ③装载因子 **并行（par）**取数 → ④聚合 **汇聚（conv）**；②→⑤ 有一条 **历史校正旁路（aux）**；⑩执行回采是 **跨周期反馈（fb）**，回流 ②记忆库 与 ④聚合系数。点任一节点看该步 **输入(Input) / 过程(Process) / 输出(Output)** + 涉及的 **引用数据 / 求解器 / Agent**，缺口数据项标红（⊕）。

**本质（本体）**：HTML 这 10 步与系统真实 QOS 链路同构——`意图分类 →（路径A 工作流编排 ∥ 路径B Agent）→ 切片召回 ∥ 因子装载 → 聚合求解 → 瓶颈/情景 → 校验解释 → 写回行动 → 执行回采`。系统侧 QOS **真实跑了**这条链（`apps/agentcore/src/router/orchestrator.ts`，`QueryTask` + SSE `step.started/step.completed` + `ExecutionPlan.steps`），但前端只渲染成**线性 SSE 时间线**（`Timeline.tsx`），丢了并行/汇聚/反馈拓扑与逐节点 IPO。

**本 PRD 落地**：新增可复用 `<InferenceProcessDag>`，把 QueryTask 真实轨迹**投影**为 HTML 同构的编排 DAG（10 节点骨架 + par/conv/aux/fb 边 + 逐节点 IPO + 缺口红），横切挂到任意推演答案块。**轨迹来自真实运行，非写死**；无真实轨迹的节点显式标"未跑/未接入"，不伪造（守"绿测试≠能用"）。

> ⚠ 诚实边界：HTML 的 10 步是**叙事脚本**（手写 IPO 文案 + cmp 表 + qa 对话）。系统的真实 `ExecutionPlan` 步骤集是 9 类（`resolve_slice/query_objects/invoke_solver/evaluate_rules/llm_compose/render_answer/create_action_draft/invoke_agent/invoke_mcp_tool`，契约 `qos.ts:85`），**不天然等于 10 个叙事节点**。本 PRD 的核心工程 = 定义一个**确定性投影映射**（§4.3）把真实步骤折叠/铺开为 10 节点骨架,并以真实 `data/solvers/agents/gapCode` 填充;映射缺位处节点诚实降级,**不补造 HTML 文案**。这是 1:1 的"结构/交互 1:1 + 数据来自真实轨迹"，而非把 HTML 脚本写死进前端。

## 2. UI 规格（布局 · 像素结构）

### 2.1 整页骨架（`buildStoryDAG` L5135 / 容器 `#storywrap` L5156）

```
┌ rk-top ────────────────────────────────────────────────────────────┐
│ <h3>决策推演模拟 · 编排 DAG</h3>                                       │
│ rk-sub: "不是单纯 1→10 顺序流：②检索切片 与 ③装载因子 并行 取数 →     │
│   ④聚合 汇聚；⑩执行回采是 跨周期反馈，回流②记忆库与④聚合系数。         │
│   点节点看该步 输入/过程/输出。"                                       │
└─────────────────────────────────────────────────────────────────────┘
<div class="scenario">场景：{v.scenario}</div>                （L5159, margin 6px 0 14px）
┌ sdag-wrap（panel,border line2,radius 12,padding 10/14,阴影） ────────┐
│  <svg viewBox="0 0 1180 300" class="sdag-svg"                        │
│       preserveAspectRatio="xMidYMid meet">                          │
│     <defs> marker#sarrow(muted2) · marker#sarrowG(quality) </defs>  │
│     {edges}  {nodes}                                                 │
│  </svg>                                                              │
│  <div class="sdag-leg"> 4 图例项 </div>                              │
└─────────────────────────────────────────────────────────────────────┘
<div id="storyDetail"></div>     ← showStoryNode(i) 写入,见 §2.4
```

### 2.2 DAG 几何（`_SD` L5132 · `_sdx`/`_sdy` L5133-5134）—**逐值精确**

| 常量 | 值 | 含义 |
|---|---|---|
| W | 1180 | viewBox 宽 |
| H | 300 | viewBox 高 |
| x0 | 78 | 第 0 列 x 起点 |
| xg | (1180−156)/8 = **128.0** | 列间距（rank 步长） |
| ymid | 128 | 中线 y |
| rg | 78 | 行偏移（row 步长） |
| `_sdx(i)` | `x0 + rank[i]*xg` | 节点 x |
| `_sdy(i)` | `ymid + row[i]*rg` | 节点 y |

**节点坐标表（`STORY_POS` L5119-5123，i=0..9，1-based 序号=i+1）**：

| i | 序号 | 短名(`STORY_SHORT`) | rank | row | x=78+rank·128 | y=128+row·78 | 色 `c`(CSS var → 值) |
|---|---|---|---|---|---|---|---|
| 0 | ① | 解析场景 | 0 | 0 | 78 | 128 | `--factory` #5E8FE8 |
| 1 | ② | 检索切片 | 1 | −1 | 206 | 50 | `--capacity` #43B7D7 |
| 2 | ③ | 装载因子 | 1 | +1 | 206 | 206 | `--capacity` #43B7D7 |
| 3 | ④ | 聚合产能 | 2 | 0 | 334 | 128 | `--solver` #C470B8 |
| 4 | ⑤ | 识别瓶颈 | 3 | 0 | 462 | 128 | `--solver` #C470B8 |
| 5 | ⑥ | 情景推演 | 4 | 0 | 590 | 128 | `--solver` #C470B8 |
| 6 | ⑦ | 方案比对 | 5 | 0 | 718 | 128 | `--agent` #5FC2AE |
| 7 | ⑧ | 校验解释 | 6 | 0 | 846 | 128 | `--agent` #5FC2AE |
| 8 | ⑨ | 写回行动 | 7 | 0 | 974 | 128 | `--forecast` #E8B54A |
| 9 | ⑩ | 执行回采 | 8 | 0 | 1102 | 128 | `--quality` #62BE77 |

**节点圆形（`STORY_POS.forEach` L5146-5150）**：`<circle r={on?23:20} fill={c} opacity={on?1:.92} stroke={on?'var(--txt)':'#fff'} stroke-width={on?2.4:1.6}/>`；圆心白色 700 字号 13 的数字 `i+1`；圆下 y+34 处 10.5px 短名（选中 font-weight 700，否则 400）。`.sdag-n:hover circle{filter:brightness(1.08)}`（L254）。

### 2.3 边（`STORY_EDGES` L5124-5129 + 绘制 L5138-5144）—**逐边精确**

12 条边。绘制规则：
- **fb（反馈）边** L5139-5140：从 `(x1, y1+22)` 三次贝塞尔下绕到底部 `my=H−26=274` 再回 `(x2, y2+22)`，`stroke=--quality #62BE77 width 1.4 dash"5 4" opacity .7 marker=sarrowG`；中点 `((x1+x2)/2, my+13)` 处 9.5px quality 色 `{lab}`。
- **其余边** L5141-5143：水平三次贝塞尔 `M x1+22 y1 C mx y1, mx y2, x2−22 y2`；`width = seq?2.2:1.8`；色 = par→`--factory`、conv→`--capacity`、aux→`--muted`、seq→`--line2`；aux 额外 `dash"4 3" opacity .55`；`marker=sarrow`；若有 `lab`，在 `(mx,(y1+y2)/2−5)` 处 9px muted 色标签。

| # | f→t | 序号 | ty | lab | 色 | 线型 |
|---|---|---|---|---|---|---|
| 1 | 0→1 | ①→② | par | 分叉 | factory #5E8FE8 | 实 1.8 |
| 2 | 0→2 | ①→③ | par | — | factory | 实 1.8 |
| 3 | 1→3 | ②→④ | conv | 本体子图 | capacity #43B7D7 | 实 1.8 |
| 4 | 2→3 | ③→④ | conv | 驱动因子 | capacity | 实 1.8 |
| 5 | 1→4 | ②→⑤ | aux | 历史校正 | muted | 虚 4/3 op.55 1.8 |
| 6 | 3→4 | ④→⑤ | seq | — | line2 | 实 2.2 |
| 7 | 4→5 | ⑤→⑥ | seq | — | line2 | 实 2.2 |
| 8 | 5→6 | ⑥→⑦ | seq | — | line2 | 实 2.2 |
| 9 | 6→7 | ⑦→⑧ | seq | — | line2 | 实 2.2 |
| 10 | 7→8 | ⑧→⑨ | seq | — | line2 | 实 2.2 |
| 11 | 8→1 | ⑨→② | fb | 案例回流 | quality #62BE77 | 虚 5/4 op.7 1.4 底绕 |
| 12 | 8→3 | ⑨→④ | fb | 系数校准 | quality | 虚 5/4 op.7 1.4 底绕 |

> ⚠ HTML 真相核对：`STORY_EDGES` 的 fb 边 `f:8`（即第 9 节点"写回行动"）而非第 10 节点"执行回采"。rk-sub 文案说"⑩执行回采是跨周期反馈"，但代码连线源是 ⑨。**1:1 复刻以代码 `STORY_EDGES` 为准（f:8→t:1 / f:8→t:3）**；投影映射（§4.3）保留此真相，文案沿用 HTML。

### 2.4 节点详情区（`storyDetailHTML` L5175-5195）—`rk-det` 卡，挂 `#storyDetail`

```
┌ rk-det (margin-top 6) ──────────────────────────────────────────┐
│ rk-det-h: <b><span class=sn>{i+1}</span> {s.t}</b>  右"该步 输入 / 过程 / 输出" │
│ crow 📊 引用数据  : s.data.map(chip(d,'data'))      ← 若非空        │
│ crow ⚙ 求解器     : s.solvers.map(chip(d,'solver')) ← 若非空        │
│ crow 🤖 Agent     : s.agents.map(chip(d,'agent'))   ← 若非空        │
│ ssec.ipo-in   「输入 Input」 {s.in}                  ← 若非空(左框 factory) │
│ ssec.ipo-proc 「过程 Process」 linkRules({s.proc})   ← 若非空(左框 solver) │
│ ssec.out.ipo-out 「输出 Output」 {s.out}             (左框 capacity) │
│ [仅 ⑦] crow 📋 多方案比对·对症瓶颈 + table.cmp(7 列×5 行,见 §4.2) │
│ [仅 ⑦] chat: 💬 人机对话 · 4 问题 chip(storyAsk) + chat-a 答案区  │
│ ssec(muted) 「编排关系」 上游依赖 | 下游 | 可并行                 │
└──────────────────────────────────────────────────────────────────┘
```

- **chip**（`chip(id,kind)` L5217-5220）：色 = solver→#C470B8 / agent→#5FC2AE / 其他→`nodeMap[id]` 域色或 #888；若 `nodeMap[id].missing` 前缀 `⊕`（缺口）；样式 `.chip-s`（11px,radius 6,border 1px,`color:col;border-color:col55;background:col14`，L501）。
- **ssec**（L502-509）：12px line-height 1.55，左 2px 边框；`ipo-in` 边框/标签 factory、`ipo-proc` 边框/标签 solver、`out`/`ipo-out` 边框/标签 capacity、编排关系行 muted。`.lb` 标签 600 字重。
- **linkRules**（L5198-5199）：正则把 `C01..C23` 包成 `.rule-link`，悬停 `showRulePop`（L5201-5215）弹规则卡（id·sev色·expr·scope·owner·ver·提示"规则是本体一等对象,由解释校验Agent执行"）。
- **编排关系行**（L5189-5194，**派生自 `STORY_EDGES`，零写死**）：
  - 上游依赖 = `edges.filter(t===i)` → `短名(f+1)` + (aux→`·校正` / fb→`·反馈`)；空 → "无（起点）"。
  - 下游 = `edges.filter(f===i && ty!=='fb')` → `短名(t+1)`；空 → "无（终点）"。
  - 可并行 = 同 rank 的其他节点 → `<b factory>可并行：短名(k+1)…</b>`（②③ 互为可并行）。

### 2.5 图例（`legend` L5151-5155 · CSS `.sdag-leg` L255-257）

4 项，10px muted，flex gap16：`■并行分叉`(factory 方块) · `■汇聚`(capacity 方块) · `┄历史校正(旁路)`(muted 虚线) · `┄跨周期反馈`(quality 虚线)。方块 `i` 11×11 radius3；线 `i.ln` 宽 16、`border-top 2px dashed`。

### 2.6 系统侧组件结构（`<InferenceProcessDag>` 落地，复用 PmDag 基座）

```
<InferenceDagPanel>  ← QueryDock/各推演答案下"▸ 推演过程"折叠区
 ├ <header> 决策推演模拟 · 编排 DAG  +  rk-sub(同 §2.1)  + scenario(=task.query)
 ├ <InferenceProcessDag nodes edges selected onPick mode legend/>   ← SVG 基座=PmDag 风格
 │    · 自由布局(rank/row→x/y, 非分层均分),节点圆形 r20/23,边 par/conv/aux/fb 着色虚实
 │    · marker sarrow/sarrowG; fb 边底绕; 图例同 §2.5
 │    · 节点状态: pending(灰 op.4)/running(脉冲)/done(实)/gap(红描边⊕)
 ├ <NodeIpoDrawer node>   ← 点节点 → rk-det 同构: data/solvers/agents chip + in/proc/out + 编排关系
 │    · 缺口节点: 红 + GapReport 码 + "断在 <atStep>:<gapCode>" 诚实文案(linkRules 复用)
 │    · [⑦类节点] cmp 比对表 + qa 对话(若 trace 有候选方案集)
 └ legend(同 HTML)
```

复用 `PmDag.tsx` 的：viewBox 直接操纵（拖拽平移 + 滚轮/按钮缩放 L52-108）、`marker` 箭头、节点 click 抑制拖穿（`movedRef` L166）。**差异**：PmDag 是 6 层均分横排（`layers[][]`），story 是 rank/row 自由坐标——抽出布局策略为 prop（`layout:"layered"|"coords"`），或新增轻量 `DagCanvas` 共享 viewBox/缩放/箭头逻辑，story 与 PmDag 各传节点/边/坐标。**不重写图引擎**。

## 3. UX 规格（交互 · 状态 · 流）

| 交互 | 触发（HTML） | 行为 | 系统落地 |
|---|---|---|---|
| 点节点 | `<g onclick=showStoryNode(i)>` L5147 | `storySel=i;stepIdx=i` → 重画选中态(r/op/stroke/字重 L5170-5173) + 写 `#storyDetail`=`storyDetailHTML(v,i)` | `onPick(nodeId)` → `setSelected` → 渲染 `<NodeIpoDrawer>`；轨迹无该节点 → 抽屉显"未跑/未接入" |
| 选中态高亮 | `on=i===storySel` | 选中圆 r23 不透明 txt 描边 2.4；短名 700 | `data-selected` + 同样式 |
| 点问题(仅⑦) | `.qq onclick=storyAsk(k)` L5187 | `chatA.innerHTML=s.qa[k].a` L5245-5246 | 若 trace 含方案候选集 → 抽屉 chat 区切答案；否则不渲染 chat |
| 悬停规则码 | `.rule-link onmouseenter=showRulePop` L5198 | 弹规则卡(id/sev/expr/scope/owner/ver) L5201-5215 | 复用现有规则弹层 / `linkRules` 端口（A5 规则注册表）|
| 编排关系 | 派生 `STORY_EDGES` L5189-5194 | 上游/下游/可并行(零写死) | trace 的 edges 派生(同算法) |
| 节点状态流转 | （HTML 无,静态） | — | 消费 `useTaskStream` SSE：step.started→running、step.completed(OK)→done、(ERROR/GapReport)→gap |
| 缺口标红 | `nodeMap[id].missing→⊕` L5219 | data chip 前缀 ⊕ | 节点 gap 态红描边 + chip ⊕ + GapReport 码（§4.5） |
| 折叠/展开过程区 | （横切新增） | "▸ 推演过程"折叠（默认收起,展开懒加载 trace） | QueryDock 答案块下;risk/project/order/audit/generate 各"查看推演过程"入口 |
| 缩放/平移 | （横切新增,复用 PmDag） | viewBox 拖拽 + 滚轮/按钮缩放 + 复位 | `PmDag` L52-117 逻辑 |

**状态机（节点）**：`pending`（轨迹未到该步，灰 op.4）→ `running`（step.started，脉冲）→ `done`（step.completed outcome=OK，实色）/ `gap`（step.completed ERROR 或 GapReport.findings 命中该步，红描边 ⊕）。终态由 `QueryTask.status` + `GapReport.verdict`(ANSWERABLE/BLOCKED/BOUNDARY) 收束。

## 4. 数据规格（值 + 来源 + 系统字段级落地）

> 前端**零写死**(R14)；所有值来自：① 真实 QueryTask 轨迹（step + toolCalls + GapReport）② ExecutionPlan 步骤定义 ③ 求解器/对象 lineage ④ i18n 文案（节点短名/rk-sub/图例/IPO 模板）⑤ 投影映射表（步骤类型→DAG 节点骨架）。

### 4.1 10 节点 IPO 全文（`VIEWS.story.steps[]` L1394-1468）—**研发逐字录入为 i18n 模板 + trace 占位**

> 说明：`in/proc/out` 是 HTML 叙事文案。系统侧 = 节点**骨架文案模板**（④i18n，含 `{占位}`），运行时以真实 trace 值（data/solvers/agents/gapCode/求解器 I/O 形状）填充；无运行则显模板的"未跑/未接入"降级版。`scenario`=`task.query`（真实问句）。

**scenario**（L1393）：`重点客户追加 20% 的 4680 PACK 订单，要求 6 周交付——能否接？瓶颈在哪？要不要加夜班 / 扩化成通道 / 外协？`（`b` 包裹关键短语）。

| i | t（标题） | data（引用数据） | solvers | agents |
|---|---|---|---|---|
| 0 | 接收意图 · 解析场景 | 需求/订单, 预测场景 | — | 编排Agent, 意图解析Agent |
| 1 | 检索业务建模切片 · 召回历史(仅作校正) | 工厂, 产线1, 产线2, 电芯, 4680 | — | 检索Agent, 经验记忆库 |
| 2 | 装载量化驱动因子 · 暴露缺口 | OEE指标, OEE历史, 良率, 可用工时, 物料齐套, 换型时间, 生产工单MO | — | 建模求解Agent |
| 3 | 逐级聚合产能 · 算清现状 | 设备产能, 工序产能, 产线产能, 工厂产能 | 聚合求解器 | 建模求解Agent |
| 4 | 识别瓶颈 · 多维根因诊断 | 化成, 老化, 瓶颈, 物料齐套 | 瓶颈求解器 | 瓶颈诊断Agent |
| 5 | 情景推演 · 多方案求解 | 预测场景, 需求/订单, 产能预测 | 场景求解器 | 建模求解Agent |
| 6 | 方案比对 · 人机对话 | 预测场景, 产能预测 | 场景求解器 | 编排Agent, 解释校验Agent |
| 7 | 校验与可解释 · 守护防错 | 产能预测 | — | 解释校验Agent, 约束规则 |
| 8 | 决策建议 · 写回行动 | 产能预测, 生产工单MO | — | 行动Agent, 编排Agent |
| 9 | 执行回采 · 自学习闭环 | 实际产出, 产能预测, 良率, OEE历史 | 精度校准器 | 学习Agent, 经验记忆库 |

> ⚠ 节点序号映射：`STORY_SHORT`（DAG 短名）与 `steps[].t`（详情标题）是**同序 10 项**（i 对齐），短名 = 标题的浓缩。`steps[i].nodes` 是该步在 A5 全图里点亮的对象集（HTML 用于 `applyStory` L5247，本 PRD 的 DAG 不直接用，但作 lineage 候选）。

**逐节点 in/proc/out（逐字，L1394-1467；`proc` 内 `Cxx` 由 `linkRules` 高亮）**：

- **① 解析场景**　in:`原始问句（重点客户 4680 PACK +20%、6周交付）+ 在手订单 + 当前产能基线`　proc:`意图解析Agent 将自然语言映射为结构化预测场景对象（需求量 / 交付窗口 / 候选对策集）；按规则 C10 校验场景必填字段完整性`　out:`结构化预测场景：需求+20% · 窗口6周 · 候选对策{加夜班, 扩化成通道, 外协}`
- **② 检索切片**　in:`预测场景对象 · 业务本体全图 · 经验记忆库历史案例`　proc:`检索Agent 以 resolveSlice 声明式按『型号→可产基地→产线→工序』取子图（非语义搜索）；经验记忆库按时效加权召回相似案例，仅用于残差校正与不确定性估计，不参与点估计；带概念漂移检测，换线/换体系/大修后旧案例降权`　out:`相关业务建模子图 + 时效加权的相似历史案例（校正用）`
- **③ 装载因子**　in:`OEE指标/OEE历史/良率/可用工时/物料齐套/换型时间/生产工单MO（各带来源系统与采集时间）`　proc:`建模求解Agent 装载带时序的量化驱动因子；对未接入项（⊕ 换型时间 / 物料齐套 / OEE历史）显式标红为缺口`　out:`带时序的驱动因子集；显式标红缺失项`
- **④ 聚合产能**　in:`设备级 节拍×OEE×良率×人力 + 工序串并联结构`　proc:`聚合求解器按『设备产能→工序产能(串行取 min / 并行 Σ通道)→产线产能→工厂产能』逐级核算；引用规则 C01(产线≤设计上限) / C02(串并联口径)`　out:`现状各级产能基线(设备→工序→产线→工厂)，每级可下钻到公式与输入因子`
- **⑤ 识别瓶颈**　in:`各级产能基线 + 7 维约束因素当前值（取自多维瓶颈矩阵）`　proc:`瓶颈求解器按工艺链最小割定位主瓶颈；瓶颈诊断Agent 并扫 设备OEE/人力工时/物料齐套/物流时长 等维度，结论链接到 基地·产线·设备·班次；引用规则 C05(利用率>95%持续3日升级告警)`　out:`多维瓶颈定位：4680-NCM 可产的 常州/合肥 卡在【化成通道】、成都 卡在【老化库位】，物料齐套 为次约束（可在『瓶颈』节点→详情看完整矩阵）`
- **⑥ 情景推演**　in:`预测场景(需求+20%/6周) + 瓶颈定位结果 + 候选对策集`　proc:`场景求解器对每个对策在 live 数据上前向重算 产能/缺口/交期，计入化成新通道≈2周 ramp-up；引用规则 C03(产能≤物理上限) / C08(外协≤20%)；每方案假设与约束显式列出、可复算`　out:`按瓶颈对症的多套方案：①加2夜班 ②化成扩4通道 ③成都老化扩库位 ④正极提前备料·近端供应 ⑤部分外协（各自产能/缺口/交期均算清）`
- **⑦ 方案比对**　in:`各对策的推演结果（产能/缺口/交期/成本/风险）`　proc:`解释校验Agent 生成并排比对表；编排Agent 接受追问/调参/要替代方案，结果实时由场景求解器重算`　out:`多套方案并排比对 + 人机对话（可追问、调参、要替代方案）`　+ **cmp 表**（§4.2）+ **qa 4 问**（§4.2）
- **⑧ 校验解释**　in:`候选预测结果 + 约束规则注册表(C01–C12)`　proc:`解释校验Agent 逐条执行约束校验并留痕；超物理上限等违规结论被规则 C03 拦截并说明；输出 P50/P90 置信区间`　out:`通过校验的预测 + 置信区间 + 自然语言解释`
- **⑨ 写回行动**　in:`通过校验的推荐组合 + Action 类型『采纳产能保障方案』参数 schema`　proc:`行动Agent 生成结构化工单(MO)，按规则 C10 要求审批人并留审计；编排Agent 编排发起→审批链路`　out:`对症组合建议：『化成扩4通道(解主瓶颈) + 加2夜班(过渡) + 正极提前备料(消次约束) → 6周缺口归零、交期可达』，写回工单(Action)`
- **⑩ 执行回采**　in:`实际产出/OEE历史/良率 回采值 + 上一轮预测值`　proc:`精度校准器比对 预测↔实际，按规则 C12(|MAPE|>8% 触发重校)反向校准 节拍/良率/OEE基线 并调参求解器；案例入经验记忆库`　out:`校准后的参数 + 入库案例 + 偏差→精度提升的量化趋势`

### 4.2 ⑦节点专属：cmp 比对表 + qa 对话（L1437-1448，逐字）

**cmp 表**（7 列 `<table class=cmp>` L5183-5185；列序固定）：`方案 | 针对瓶颈(solver色) | 新增产能 | 6周缺口 | 投入 | 交期 | 风险`，`td b` forecast 色。

| 方案 n | 针对瓶颈 bn | 新增产能 cap | 6周缺口 gap | 投入 cost | 交期 due | 风险 risk |
|---|---|---|---|---|---|---|
| 加 2 夜班 | 化成/老化利用率 | +12% | −60% | 低·人力 | 可达 | 夜班良率波动 |
| 化成扩 4 通道 | 化成通道(主瓶颈) | +20% | 归零 | 中·设备投资 | 可达 | 新通道爬坡期 |
| 成都老化扩库位 | 老化库位 | +8% | −25% | 中·设备 | 可达 | 库位爬坡 |
| 正极提前备料·近端供应 | 物料齐套/物流时长 | +6%(解约束) | −15% | 低·库存 | 可达 | 占用周转资金 |
| 部分外协 | 绕过瓶颈·补总量 | +15% | −30% | 中·外协费 | 可达 | 外协质量管控 |

**qa（4 问答，`.qq onclick=storyAsk(k)`，默认显 a[0]）**：
1. Q`针对主瓶颈，最优解是什么？` A`主瓶颈是 化成通道（常州/合肥）。化成扩 4 通道 直击该瓶颈，6 周缺口归零；约 2 周爬坡期已由场景求解器计入 ramp-up。成都侧另需 老化扩库位 对症。`
2. Q`最快、最省的稳妥选择？` A`加 2 夜班：仅靠人力、当周见效、投入最低，提升化成/老化利用率、补 60% 缺口；夜班良率波动建议配合质量域监控。`
3. Q`瓶颈不在工序怎么办？` A`瓶颈诊断显示本单 物料齐套 是次约束——对症方案是 正极提前备料 + 近端供应，缩短物流时长、抬高齐套率。若换基地，矩阵会把瓶颈指向物流/人力，方案随之切换。`
4. Q`综合推荐？依据是什么？` A`推荐 扩化成通道为主 + 夜班过渡 + 正极提前备料 组合：扩通道解主瓶颈、夜班填补爬坡期、备料消除次约束。依据全部可溯源到多维瓶颈矩阵与场景求解器。`

> 系统落地：cmp/qa 是 ⑥情景推演 + ⑦方案比对的**叙事化**。真实 trace 中对应 = 场景求解器对候选对策的多次 `invoke_solver` 输出（每对策一行）。若 trace 含该结构 → 渲染 cmp 表（行=对策、列=产能/缺口/交期）；qa = 解释校验 Agent 的预设追问（若 Answer 含）。**无该结构则不渲染 cmp/qa**（不写死 HTML 5 行），节点仍显 in/proc/out 模板 + 真实 data/solver chip。

### 4.3 ★投影映射：真实步骤 → 10 节点骨架（**本 PRD 核心工程，零写死的关键**）

DAG 拓扑（10 节点 + 12 边）是**编排叙事骨架**（④i18n 常量，非"写死步骤数据"——是视图模板，类比 ViewDef）。真实 `QueryTask` 轨迹经下表**确定性映射**填充各节点的 `status / data / solvers / agents / gapCode`：

| DAG 节点 | 真实步骤类型(`PlanStep.type`)/事件源 | 状态判定 | data/solvers/agents 来源 |
|---|---|---|---|
| ① 解析场景 | `classification` + 意图分类（`routing.completed`） | task.classification 存在→done；无→pending | classification.intentKey；agents=编排/意图解析（routing） |
| ② 检索切片 | `resolve_slice` / `query_objects` | step OK→done；NO_SLICE/EMPTY_DATA→gap | params.sliceKey/objectType；data=lineage 对象 |
| ③ 装载因子 | `query_objects`（因子类对象）/ solver 入参 | step OK→done；EMPTY_DATA→gap(红⊕) | 求解器入参对象形状（lineage）|
| ④ 聚合产能 | `invoke_solver`（聚合类 solverKey） | step OK→done；SOLVER_NOT_FOUND→gap | solvers=solverKey；data=输出对象 |
| ⑤ 识别瓶颈 | `invoke_solver`（瓶颈类） | 同上 | solvers=瓶颈求解器 |
| ⑥ 情景推演 | `invoke_solver`（场景类，可多次→cmp 行） | 同上 | solvers=场景求解器；cmp=多次输出 |
| ⑦ 方案比对 | `llm_compose` / `invoke_agent`（解释校验） | step OK→done | agents=解释校验/编排；qa=Answer 追问 |
| ⑧ 校验解释 | `evaluate_rules` | OK→done；NO_RULE→gap | data=规则集；ruleIds |
| ⑨ 写回行动 | `create_action_draft`（`action_draft.created`） | draft 生成→done | actionType |
| ⑩ 执行回采 | （无同步步骤；跨周期）`growth/loop` 回采 | 通常 pending（"未跑/未接入"诚实） | 学习 Agent / 精度校准器（若有回采记录） |

- **多步并归一节点**：②③ 若真实是多个 `query_objects`/`resolve_slice` → 折叠进对应节点（节点抽屉列全部子步）。
- **节点缺位**：真实计划无对应步骤（如纯 AGENT 路径无 `invoke_solver`）→ 该节点 `status=pending` 显"本次未执行该步"（不伪造 done）。
- **GapReport 接线**：`GapReport.findings[].atStep`（`qos`/`growth.ts:24`）映射到节点 → `status=gap` + `gapCode` 红 chip + "断在 {atStep}:{gapCode}"。7+码：NO_INTENT(①)/NO_PLAN(①)/NO_SLICE(②)/EMPTY_DATA(②③)/NO_RULE(⑧)/SOLVER_NOT_FOUND(④⑤⑥)/SHAPE_MISMATCH(⑦渲染)/NO_CAPABILITY(任意,需开发)/OTHER。
- **path 差异**：`task.path=WORKFLOW`→走 ExecutionPlan.steps 精确投影；`AGENT`→按 toolCalls 序列近似投影（`invoke_solver`/`invoke_mcp_tool`/`invoke_agent`），无明确步骤的骨架节点标 pending。

> 投影是**纯派生函数** `projectTrace(task, plan, toolCalls, gapReport, answer): InferenceTrace`，确定性（R6），不新增真值（R13）。骨架 10 节点 + 12 边的拓扑/短名/IPO 模板 = i18n 常量（视图定义级），**这不违反 R14**（同 ViewDef/renderer 模板不算"写死数据"）；违反 R14 的是把 HTML 的具体 data 值/cmp 5 行/qa 答案硬编码进前端——本 PRD 明确禁止，这些必须来自 trace。

### 4.4 色板（CSS 变量 L17-19，1:1 必须语义一致，**色值可调**）

`--factory:#5E8FE8`(①+par) · `--capacity:#43B7D7`(②③节点+conv+out) · `--solver:#C470B8`(④⑤⑥节点+ipo-proc+solver chip) · `--agent:#5FC2AE`(⑦⑧节点+agent chip+chat-a b) · `--forecast:#E8B54A`(⑨节点+scenario b+sn) · `--quality:#62BE77`(⑩节点+fb 边) · `--muted`(aux 边+编排关系) · `--line2`(seq 边)。规则 sev 色：阻断 #DD7E9E / 告警 forecast / 其他 capacity（L5205）。

### 4.5 ★系统字段级落地（现状 → 须改/须加，精确）

> 现状（已读源）：QOS 真实跑该链（`orchestrator.ts` L139 建 `QueryTask`、`ExecutionPlanSchema.steps` 9 类、SSE `step.started/completed` 经 `taskStreamReducer.ts` L137 `selectStepRows`、`GapReportSchema` 7+码已在 `growth.ts:37`、`decision-trace` 端点已在 `server.ts:407`、`toolCalls.listByTask` 已在 `repos.ts:137`）。前端仅 `Timeline.tsx` 线性渲染，**无 DAG / 无逐节点 IPO / 无投影**。缺口与改法：

**A. 契约（`packages/contracts/src/qos.ts`，additive）**
- 新增 `InferenceTraceSchema`：
  ```
  nodes: array({ id, ordinal(1..10), label, shortLabel, kind(factory|capacity|solver|agent|forecast|quality),
                 rank, row, in?, proc?, out?, data:string[], solvers:string[], agents:string[],
                 status(pending|running|done|gap), gapCode?, atStep?,
                 cmp?:[{n,bn,cap,gap,cost,due,risk}], qa?:[{q,a}] })
  edges: array({ from, to, type(par|conv|seq|aux|fb), label? })
  scenario: string                  // = task.query
  taskId, path, verdict?            // GapReport.verdict
  ```
  （口径与结构 PRD `docs/PRD-inference-process-enhancement.md §4` 对齐，本文细化字段。）
- StoryBuildRun 复用同 schema（建域期 comprehend/closure/scaffold → 节点），见 `storybuildrun.ts`。

**B. 后端投影端点（`apps/agentcore/src/server.ts`，新增）**
- `GET /api/v1/queries/:taskId/trace`（别名 `/b/v1/...`）：`auth` + tenant 隔离（同 decision-trace L408-411）→ 取 `task` + `repos.toolCalls.listByTask`(L412) + `task.answer` + GapReport（growth/probe 已产，或 task.error）→ 调 `projectTrace(...)` → `InferenceTraceSchema.parse`。**纯投影，不碰编排逻辑**。
- 投影函数新建 `apps/agentcore/src/router/traceProjection.ts`：实现 §4.3 映射（确定性，R6）。骨架常量（10 节点 IPO 模板 + 12 边）置 `apps/agentcore/src/router/orchestrationSkeleton.ts`（i18n/ViewDef 级常量，单一来源）。

**C. 前端组件（新建目录 `apps/frontend-shell/src/components/InferenceDag/`）**
- `InferenceProcessDag.tsx`：props `{nodes,edges,selected,onPick,mode:"orchestration"|"model-network"}`；SVG 基座复用 `PmDag.tsx` 的 viewBox 缩放/平移/箭头/防拖穿（抽 `DagCanvas` 或加 `layout` prop）。边按 par/conv/aux/fb 着色虚实（§2.3），fb 底绕，图例（§2.5）。
- `NodeIpoDrawer.tsx`：rk-det 同构（data/solvers/agents chip + in/proc/out + 编排关系派生 + ⑦的 cmp/qa + 缺口红+gapCode+linkRules）。
- `useInferenceTrace(taskId)`：拉 `/api/v1/queries/:id/trace` + 叠加 `useTaskStream` 实时 SSE 状态（step.started→running 等，`taskStreamReducer.ts`）。
- 挂载：`TaskRun.tsx`(L12-16，AnswerCard 旁加"▸ 推演过程"折叠) + risk/project/order/audit/generate 各推演答案/过程面板加入口（传该次 taskId）。

**D. SSE → 节点状态映射（`taskStreamReducer.ts` 扩 selector，不改 reducer）**
- 新增 `selectInferenceNodes(state, skeleton)`：把 `selectStepRows`(L137) 的 step 类型经 §4.3 表归一到节点 → 状态。复用 `STEP_ICONS`(Timeline L7-18) 的步骤类型集。

**E. 不需改的（已就位，复用）**：`GapReportSchema`(growth.ts)、`decision-trace`/`lineage` 端点（server.ts L407/L442）、`toolCalls` 仓储、规则弹层、`PmDag` 缩放基座、`AnswerCard`。

### 4.6 数据资产（完整，研发逐字录入 i18n/骨架常量）

- **STORY_SHORT**（10 短名，L5118）· **STORY_POS**（10 坐标/色，L5119-5123，§2.2 表）· **STORY_EDGES**（12 边，L5124-5129，§2.3 表）：录入 `orchestrationSkeleton.ts`。
- **steps[].{t,in,proc,out,data,solvers,agents,nodes}**（L1394-1468，§4.1 全文）：IPO 文案作骨架模板（i18n），data/solvers/agents 作**默认占位**（真实 trace 覆盖）。
- **steps[6].cmp**（5×7，§4.2）+ **steps[6].qa**（4 问答，§4.2）：作 ⑦节点叙事模板；真实仅在 trace 含候选方案集时渲染。
- **scenario**（L1393）：=`task.query`（真实问句覆盖示例文案）。
- **rk-sub / 图例 4 项 / 编排关系标签**（L5152-5158、L5189-5194）：i18n 文案。
- **色板**（L17-19，§4.4）：CSS 变量。

## 5. 契约 / 端点

- `contracts/qos.ts`：新增 `InferenceTraceSchema`（§4.5.A）；`QueryTask`/`ExecutionPlan`/`GapReport` 不改（已含投影所需全部字段）。
- 端点：**新增** `GET /api/v1/queries/:taskId/trace`（+ `/b/v1` 别名，编排轨迹投影，server.ts）。**复用** `GET /api/v1/queries/:taskId/decision-trace`(L407，已有，作 trace 的证据补充)、`GET /api/v1/queries/:taskId/lineage`(L442，节点 data 对象溯源)、`GET /api/v1/queries/:taskId`(L399)。建域期复用 `GET /a/v1/databuilder/runs/:id`（StoryBuildRun → 同 schema）。
- 鉴权：生产 Bearer JWT（JWKS 验签）/ 开发 `X-Debug-User`；tenant 隔离（trace 端点照搬 decision-trace L408-411 的 `task.tenantId !== a.tenantId → 404`）。

## 6. 融合集成点（不绕过）

1. **QueryDock 答案块**（`TaskRun.tsx` L12-16）：AnswerCard 旁"▸ 推演过程"折叠区挂 `<InferenceProcessDag>`（主挂点）。
2. **各推演答案/过程面板**：RiskBoard(产能推演) / ProjectSim(项目推演,`PmDag` 同族) / OrderChain(订单全链) / PlanAudit(规划体检) / PlanGenerate(方案生成) 各加"查看推演过程"入口（≥5 横切挂点，传该次 taskId/solver 轨迹）。
3. **后端投影**：`server.ts` 新端点 + `traceProjection.ts` + `orchestrationSkeleton.ts`（**不碰 `orchestrator.ts` 编排逻辑**，纯读投影）。
4. **图渲染族归一**：与 `PmDag.tsx` 共享 `DagCanvas`（viewBox/缩放/箭头），model 收敛网络为 `mode:"model-network"` 子模式（型号→认证产线→基地，复用 PmDag perBase）。
5. **SSE 状态**：`taskStreamReducer.ts` 加 selector（不改 reducer/事件名，QOS-PRD §8.2 一字不差）。
6. **建域期复用**：`StoryBuildRun`(comprehend/closure/scaffold) → 同组件同 schema。

## 7. 验收（DoD = 真 1:1）

- **像素核对**：与 HTML story 页并排，逐元素勾——10 节点（坐标/色/序号/短名/选中态 r23 op1 txt 描边）、12 边（par 蓝实/conv 青实带 lab/aux 灰虚/seq 灰粗/fb 绿虚底绕带 lab）、图例 4 项、rk-sub、scenario、节点详情（data/solvers/agents chip ⊕、in/proc/out 三 ssec 色框、编排关系上游/下游/可并行、⑦ cmp 7 列 5 行 + qa 4 问）。**结构/坐标/边/字符串/交互全一致**（色/字可调）。漏一项不过。
- **交互**：点节点切高亮 + 详情、点问题(⑦)切答案、悬停规则码弹卡、编排关系派生正确（②③ 互显可并行、⑨ fb 边、①无上游、⑩无下游）、缩放/平移、折叠展开——逐项 FDE 亲手跑。
- **真实轨迹（R13/R14 关键）**：DAG 由真实 QueryTask trace 投影，**非写死 10 步**；跑一条真实 QOS 推演 → 各节点 status/data/solver/agent/gapCode 对得上运行轨迹；纯 AGENT 路径或无 solver 时对应节点诚实显"未跑/未接入"，不伪造 done；缺口节点红=GapReport 7+码 + "断在 atStep:gapCode"。`debattery:check`/前端零写死步骤检查过。
- **确定性**：同一次运行轨迹投影确定（R6）；tenant 隔离（跨租户 trace 404）。
- `pnpm -r build && pnpm -r test` 全绿（trace 投影单测 + 组件回归 + 各视图嵌入不破）；`prd:check`/`chain:check`/`ontology:check` 过。
- 回写本体 §3（链路可视化约定:par/conv/aux/fb 边语义）+ §4（SSE→DAG 节点状态映射）。

## 8. 实施任务（研发可直接拆）

1. **契约**：`qos.ts` 加 `InferenceTraceSchema`（§4.5.A）+ 导出类型；StoryBuildRun 复用声明。
2. **骨架常量**：`orchestrationSkeleton.ts` 录入 STORY_SHORT/POS/EDGES（§2.2/§2.3）+ steps IPO 模板（§4.1）+ cmp/qa（§4.2）+ rk-sub/图例（i18n）。
3. **投影函数**：`traceProjection.ts` 实现 §4.3 映射（task+plan+toolCalls+gapReport+answer → InferenceTrace），确定性单测（多 path/缺口/纯 AGENT 各 fixture）。
4. **端点**：`server.ts` 加 `GET /api/v1/queries/:taskId/trace`（+ `/b/v1` 别名，鉴权/tenant 照搬 decision-trace）。
5. **图基座归一**：从 `PmDag.tsx` 抽 `DagCanvas`（viewBox/缩放/平移/箭头/防拖穿）或加 `layout` prop（layered|coords）。
6. **组件**：`InferenceProcessDag.tsx`（10 节点 coords 布局 + par/conv/aux/fb 边 + fb 底绕 + 图例 + 选中态）+ `NodeIpoDrawer.tsx`（rk-det 同构 + ⑦ cmp/qa + 缺口红 + linkRules）。
7. **SSE 叠加**：`taskStreamReducer.ts` 加 `selectInferenceNodes`（step 类型→节点状态）；`useInferenceTrace(taskId)` 合并端点 + 实时 SSE。
8. **挂载**：`TaskRun.tsx` "▸ 推演过程"折叠 + risk/project/order/audit/generate ≥5 入口。
9. **model 子模式**：`mode:"model-network"` 复用 PmDag perBase（型号→认证产线→基地）。
10. **i18n**：节点短名/标题/IPO 模板/rk-sub/图例/编排关系标签逐字入 locales。
11. **建域复用**：StoryBuildRun → 同组件同 schema（comprehend/closure/scaffold 节点）。

> **诚实声明（不确定性）**：HTML story 是叙事原型（手写 IPO + cmp 5 行 + qa 4 问 + 静态节点高亮 `applyStory`）。系统真实 `ExecutionPlan` 是 9 类步骤、不天然=10 叙事节点；本 PRD 的 1:1 = **DAG 结构/坐标/边/交互 100% 复刻 + 数据来自真实 QueryTask 投影**（§4.3 映射），而非把 HTML 脚本写死。10 节点骨架/12 边/IPO 模板作视图定义级 i18n 常量（不违反 R14）；具体 data/cmp/qa 值必须来自 trace（违反即返工）。⑩执行回采多数推演为跨周期、同步轨迹无该步 → 诚实标 pending。结构 PRD `docs/PRD-inference-process-enhancement.md` 已立同方向（DRAFT），本文为其工业级落地实现，取其 §3–§8 而细化到字段/行号。
