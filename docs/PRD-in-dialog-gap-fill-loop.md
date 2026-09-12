# PRD · 对话坞内"缺口 → 触发生成 → 反馈 → 续推"HITL 闭环（in-dialog gap-fill loop）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-22 · 前端为主 + 轻后端 wiring |
| 取代/扩展 | 新建 · 把已建的**需求拉动自成长发动机**（后端）暴露为**对话坞内 HITL 交互**；复用 `PRD-demand-pulled-growth-engine` 端点 + `PRD-inference-process-enhancement` 过程可视化 + `PRD-data-closure-spec`（单一上传口/R4）|
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§2.D7/D1 · §4 事件 · §5 R4/R6/R13 · §8 G-3 · §10.3 `sys.orch.query_to_answer`）· `apps/agentcore/src/growth/probe.ts`（`classifyGap`）· `apps/agentcore/src/growth/loop.ts` · `apps/agentcore/src/server.ts:168`（`/api/v1/growth/probe`）`:183`（`/api/v1/growth/run`）`:198`（fill 分派 → `ontology.fillData` / scaffold）· `apps/frontend-shell/src/components/QueryDock/*.tsx`（现仅 suggestedQuestions，无缺口卡）|

> 一句话：用户在经营驾驶舱对话框提问，命中"信息不足以定位分析对象"等缺口时，系统**应在对话框内给出一个可点击的"触发生成缺失数据"卡片**——点一下触发对应模块产数据（自成长 `fill-data` / 合成 / 数据构建发动机）、生成过程**流式回灌对话框**、（需写真值则就地 R4 审批）、完成后出现**"继续推演"**按钮、点击重跑原问句完成答案。**后端这套 LOOP 已建**（`growth/probe|run|fill`、`classifyGap`→GapReport 7 码、`fillData` 确定性补数据），缺的是**把它接进对话坞（QueryDock）的前端交互**——现在它只活在 `/admin/growth`，对话框里看不到可点的触发。本质 = 把 `growth/run` LOOP 做成对话坞内 HITL（缺口卡→触发→SSE 反馈→续推），不造新引擎。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2）：`QueryTask`/`GapReport`（D7 编排，已有 7 码）·`AnswerBlock`（新增"缺口块"类型）·`Connector/RawDataset/SyntheticJob/BuildPlan`（D1 接入，被触发产数据）·`ActionDraft`（R4 就地审批）·`GrowthTicket`（无法即时补→出工单）。
- **触及链路**（§3 / §10.3 `sys.orch.query_to_answer`）：`对话坞问句 → QOS 答案命中缺口 → classifyGap(GapReport) 并入答案流 → 对话坞渲染缺口卡 → 用户触发 → fill 分派(fillData/synthetic/databuilder) → SSE 进度回灌 → (R4 就地审批) → 续推(probe 重跑) → 答案+溯源`。
- **触及事件/数据流**（§4，D-29）：复用 `raw_dataset.uploaded`/`syntheticJob`/`storybuild.run_recorded`/`action.executed`；新增对话内进度走 **SSE**（不新增持久事件，复用 useTaskStream 通道）。
- **触及不变量**（§5）：
  - **R4**：触发生成若写真值 → 就地 Action 审批（对话框内批，复用 DataBuilderPage §6.4 范式），不旁路。
  - **R13**：补出的数据可溯源（lineage），续推答案带溯源。
  - **R6**：`fillData` 确定性生成（seed），同缺口同补法字节一致。
  - **R14 / 单一上传口**：补数据经**唯一 DataCategory/上传门**入管线（数据闭环规范 T1/I1），不在前端写死、不双口写同字段。
  - **R3**：触发的模块先过 entitlement。
- **关闭/影响断点**（§8）：**G-3（对话坞未消费结构化缺口/presetContext）**——本 PRD 让 GapReport 进答案流 + 对话坞渲染可执行缺口卡，是 G-3 的对话侧闭合；守"诚实暴露断点（绿测试≠能用）"——补不出就显示"不可达：断在 <缺口码>"。
- **门禁**（§7）：`chain:check`（触发命中真实端点）· `debattery:check`（缺口卡文案/补法配置化，前端零写死）· 前端回归（QueryDock 缺口卡 testid）· 跨服务冒烟（对话坞→AgentCore→DataCore 真触发）· FDE 亲手跑（命中缺口→触发→反馈→续推全程）。
- **数据闭环合规**（`PRD-data-closure-spec.md §6`）：触发产出的数据**必须**走 I1 三模式/单一上传口 + M1 物化 R4 + V2 溯源 + C3 缺口诚实；前端零写死（V1/R14）。其余维（模版/求解器/CLI）随被触发模块各自满足。
- **回写承诺**：新增"缺口块" AnswerBlock 类型 + 对话坞触发链 → 回写本体 §2.D7（答案块）+ §3（链路）+ §8（G-3 对话侧闭合记一笔）。

## 1. 目标 / 非目标
### 目标
1. **答案流携带结构化缺口**：QOS 答案命中缺口时，把 `classifyGap` 产出的 `GapReport`（7 码 + 缺哪个对象/切片/求解器）**并进答案流**（现 `probe` 是单独调用，需并入 ask 答案）。
2. **对话坞缺口卡**：QueryDock 渲染【缺口卡】= 缺口码 + 人话解释 + **"▶ 触发生成缺失数据"** 按钮（按缺口码选目标：EMPTY_DATA→`fill-data`/合成；NO_SLICE→建切片；SOLVER_NOT_FOUND→scaffold/工单；NO_DATA 域→数据构建发动机 `build`）。
3. **流式反馈**：点击触发 → SSE 把生成过程（行数/物化/节点图状态）**回灌对话框**（复用 `useTaskStream` + inference-process DAG 文本化）。
4. **就地 R4 审批**：补数据写真值前，对话框内弹**就地审批面板**（复用 DataBuilderPage §6.4），批了才落真值。
5. **续推按钮**：生成+物化完成 → 显示 **"继续推演"** → 重跑原问句（probe/ask）→ 出答案 + 溯源，闭合。
6. **诚实兜底**：补不出（BOUNDARY/MAX_ROUNDS/需人工）→ 显示"不可达：断在 <缺口码>" + 出 GrowthTicket（带已建骨架），不假装成功。

### 非目标
- 不改自成长发动机后端算法（`probe/run/fill/classifyGap` 复用）。
- 不在对话坞重造数据构建发动机全 UI（只做"触发+进度+续推"的轻交互，深度配置仍深链 `/admin/growth` 或数据构建发动机页）。
- 不旁路单一上传口/R4（补数据仍走管线 + 审批）。

## 2. 现状与缺口（带 file:line）
| 元素 | 现状 | 缺口 |
|---|---|---|
| 缺口分类 | ✅ `classifyGap`（probe.ts）→ GapReport 7 码（确定性 R6）| — |
| 触发产数据 | ✅ `/api/v1/growth/{probe,run}`（server.ts:168/183）+ fill 分派 `ontology.fillData`/scaffold（:198）| 仅端点 + `/admin/growth`，**未进对话坞** |
| 答案流带缺口 | ❌ probe 是单独调用 | **GapReport 未并入 ask 答案流** |
| 对话坞缺口卡 + 触发 | ❌ QueryDock 仅 suggestedQuestions（QueryDock.tsx:29/58）| **新增缺口卡 + 触发按钮 + SSE 进度 + 续推按钮** |
| 就地审批 | ◐ DataBuilderPage 有页内审批（§6.4）| 对话坞内复用 |
| 现象 | agent 干叙述"让我检索知识库…"（LLM 自由文本，非结构化缺口）| 没回退到 GapReport → 没可点触发 |

## 3. 设计
### 3.1 答案流并入缺口（轻后端）
- QOS `ask` 终态命中缺口时，在答案流附 `AnswerBlock{type:"gap", report:GapReport}`（复用 `classifyGap`，不重算）；路径 B agent 自由文本"信息不足"时，**回退**产一份 GapReport（探针口径），避免只剩叙述。
### 3.2 对话坞缺口卡（前端）
- QueryDock 渲染 `<GapCard report>`：缺口码 + 人话 + 触发按钮（目标端点按码映射，配置化 R14）：
  - `EMPTY_DATA` → `POST /api/v1/growth/fill-data`（或 `/a/v1/synthetic/jobs`）
  - `NO_DATA/未建域` → 数据构建发动机 `/a/v1/databuilder/runs`（故事=原问句）
  - `NO_SLICE` → 建切片；`SOLVER_NOT_FOUND` → scaffold/工单（深链）。
### 3.3 流式反馈 + 就地审批
- 触发 → SSE（`useTaskStream`）把进度/节点图状态回灌对话气泡；写真值前 → 对话内 `<ApprovalPanel>`（复用 §6.4）。
### 3.4 续推
- 物化完成事件 → 缺口卡变 **"继续推演"** → 点击 = 重跑原问句（携 presetContext，闭 G-3）→ 答案 + 溯源。
- 失败/边界 → "不可达：断在 <码>" + GrowthTicket 链接。

## 4. 契约 / 端点
- `contracts`：`AnswerBlock` 增 `gap` 类型（含 GapReport）。复用 `GapReport`/`GrowthFillResult`/`GrowthRunReport`。
- 端点：复用 `/api/v1/growth/{probe,run,fill-data}` · `/a/v1/synthetic/jobs` · `/a/v1/databuilder/runs` · `/a/v1/action-drafts/:id/approve`。无新增真值源。

## 5. 关键流程
问句→QOS 命中缺口→答案流带 GapReport→对话坞缺口卡→触发(按码选模块)→SSE 反馈→(R4 就地批)→物化→"继续推演"→重跑→答案+溯源；补不出→诚实断点+工单。

## 6. 非功能（§5）
R4/R13/R6/R14/R3；单一上传口；SSE 不新增持久事件；诚实兜底（守 G-3/绿测试≠能用）。

## 7. 验收（DoD）
- 命中缺口的问句 → 对话坞出**可点缺口卡**（非干叙述）；按码触发命中真实端点。
- 触发 → 进度**流式回灌对话框**；写真值经**就地 R4 审批**；补数据走**单一上传口 + 溯源**。
- **"继续推演"** 重跑出答案 + 溯源；补不出显示"断在 <码>" + 工单（不假装成功）。
- 前端零写死（`debattery:check`）；同缺口补法字节一致（R6）；`chain:check`/跨服务冒烟过；FDE 亲手跑全程。
- 回写本体 §2.D7/§3/§8。

## 8. 分期
- **GF.1** 答案流并入 GapReport（轻后端）+ QueryDock `<GapCard>` + 按码触发（fill-data/synthetic）。
- **GF.2** SSE 进度回灌 + 就地 R4 审批面板（复用 §6.4）+ "继续推演"重跑。
- **GF.3** 数据构建发动机/scaffold 触发 + 诚实断点 + GrowthTicket 链 + presetContext 闭 G-3。

> 依赖：自成长发动机后端（已建）；与 `PRD-inference-process-enhancement`（过程 DAG 文本化复用）、`PRD-data-closure-spec`（单一上传口/R4）同源。基线分支：前端(QueryDock)为主 + 轻后端(答案流带缺口)，冲突小。
