# WO-SCENE-A + WO-CSS（+ WO-SHARE17 已闭说明）— FDE 真值证据

> 源单 `docs/WO-design-landing-items-1-2-3.md`。三工单并行批。

## WO-SHARE17 = 已完成（同 H·commit 317cb7d）

WO-SHARE17（份额/收入显示与求解器闸门自相矛盾）**与本轮已交付的 H 完全同项**：`plan.ts` outcome 下发 `shareDelta(outcome.share−base.share)/revGrowth`、契约 `GenScheme.outcome` 补字段、`PlanGenerateView` 渲染该字段删 -17/-100 魔数、`simSolvers` 镜像。真跑实证方案叁 shareDelta=22=闸门值（见 `docs/evidence/WO-hollow-data-H-Astar-fde.md`）。**字段名差异**：本实现命名 `revGrowth`（WO 文案写 `revGrowthPct`），值/语义一致（=（rev/base.rev−1)×100）。无需重做。

## WO-SCENE-A · 规划体检入口不再拒答

**根因**：`scn_plan_audit` SceneEntry `mode:"WORKFLOW_ONLY"`（`seed.ts:512`）——全表唯一 WORKFLOW_ONLY；开放式管理问句无意图命中 → `completeWorkflowOnlyMiss`「请换个问法」拒答。

**修**：改 `WORKFLOW_FIRST`（命中预设走 Path A·命不中 `runPathB` 回落 agent）。审计其余入口：dash/risk/order/plan-generate/project-sim/sop-balance/review 皆 WORKFLOW_FIRST·graph=AGENT_FIRST(带 defaultAgentId)·catalog 默认 WORKFLOW_FIRST → 仅此一处需改。加哨兵测试 `seedSceneEntries().every(mode!=="WORKFLOW_ONLY")`。

**真跑证据**（真起 datacore+agentcore·`POST /api/v1/queries` view=plan-audit 开放问句「要达成规划目标需要哪些管理事项」）：
```
status: FAILED（非 COMPLETED+「请换个问法」）
answer.blocks: ['gap']  trustLevel: AGENT_EXPLORATORY  verdict: BLOCKED  path: "AGENT"
gapCode: OTHER「路径 B agent 推演中断（LLM…）」
含「请换个问法」: False
```
→ 判据过：**不再拒答**，路由进 **PathB agent**（`path:"AGENT"`），agent 因 demo 无 LLM key 优雅降级为 gap 缺口卡（CL.7/GF.2·非红错·非死路）。**富答案是 WO-SCENE-B 范围**（配场景 agent + 真 Kimi）。

## WO-CSS · DAG 深字深底 + 立门

**①根因**：`InferenceProcessDag.module.css:60` `fill: var(--text)`——`--text` 全仓零定义（仅 `--txt`=#e9eef5）→ 解析空 → fill 回落浏览器默认黑 → 深底 DAG 标签黑字不可读。修 `var(--text)→var(--txt)`。

**②门 `css-vars:check`**（`scripts/check-css-vars.mjs`·并入 `pnpm gates`）：扫所有 .css 的 `var(--X)`——**无 fallback** 的 X 必须 ∈ 全仓 CSS 定义集（tokens.css + 局部并集）；带 fallback `var(--X,…)` 放行。自证 green→red(`var(--nope)`)→green。扫 31 css·26 定义变量全绿。

**③对比度审计**：扫 .css 深 hex 作 fill/color——唯一深色 `SimViews.module.css:745 .bnCell color:#0c1118` 是**瓶颈热力格亮底深字**（亮红/黄/青背景 inline·深字高对比·正确），非低对比 bug，不改。除 `--text` typo 外无同类深字深底问题。

## 门

`pnpm -r build` 全绿；`pnpm -r test` contracts3/llm-adapters15/agentcore354/frontend289/datacore786 全绿（lived-in 测试更新断言 plan-audit=WORKFLOW_FIRST + 无 WORKFLOW_ONLY 哨兵）；`css-vars:check` + `ontology:check` 绿。本体 §8 G-3 回写（WO-SCENE-A）。

## 距北极星（诚实）

- WO-SCENE-A 只解「拒答」；规划体检**接地富答案**（引本页规划/财务/物料真值+真调 plan_audit）是 **WO-SCENE-B**（配 SceneAgentSpec + 真 Kimi env-gated），未含。
- WO-CSS 三浏览器可视证据（DAG 标签浅色清晰）建议审核方补真浏览器实拍；本单做了 css-vars 门 green→red 自证 + 静态对比度审计。
