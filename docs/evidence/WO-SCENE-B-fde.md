# WO-SCENE-B（规划体检完整场景 agent·试点模板）— FDE 真值证据

> 源单 DISPATCH §WO-SCENE-B + HANDOFF-scene-entry-agent-config §3。WO-SCENE-A 已解「拒答」；本单解「答得接地」——把规划体检配成配置完整的场景级 agent。

## 实现

| 项 | 落地 |
|---|---|
| 场景级 agent | `seedRegistry` 出厂幂等播种 `agt_plan_audit`（PUBLISHED）：systemPrompt=规划体检助手（基于本页规划/财务/物料数据·优先调 plan_audit/plan_generate/mrp_netting·给结论+管理事项+依据·数字红线⟦ref⟧+诚实位+写降级+注入防护）；tools=invoke_solver/query_objects/get_object/evaluate_rules/resolve_slice/search_knowledge；`ruleBindings.ruleKeys=[C15,C16,C18,C21,C23]`（POST_CHECK·G-10 真裁决）；skills=解读；scopeDeclaration=plan 域类型。model 复用既有默认（不在提交物新增模型标识）。 |
| 场景绑定 | `scn_plan_audit.defaultAgentId="agt_plan_audit"`（保 WO-SCENE-A 的 WORKFLOW_FIRST）。 |
| **路由根接缝修** | `runPathB`（WORKFLOW_FIRST 命不中预设意图的回落）此前恒跑**通用** path-B agent（package 白名单·忽略 scene.defaultAgentId）。改：先查 `scene.defaultAgentId` 且 agent 已发布 → 委派 `runSceneAgent`（配置完整场景 agent），否则照旧通用 path-B。单点修覆盖全部 4 个 WORKFLOW_FIRST-miss 站点。 |

## 真值证据（真起 datacore+agentcore）

plan-audit 入口开放问句「要达成规划目标需要做哪些管理事项」→
```
routing.completed  note: "场景入口模式 WORKFLOW_FIRST"
```
此 note 由 `runSceneAgent` 发（通用 path-B 发「进入探索模式」）→ 证明命不中预设意图后**回落到配置完整的 agt_plan_audit 场景 agent**（非通用 agent）。

## 门
`pnpm -r build` 全绿；`pnpm -r test` agentcore 353（lived-in/qos/resources/growth-probe 含 scene 断言全绿·新 agent additive 不破）/datacore786/frontend289 全绿；`ontology:check` 绿。本体 §8 G-3 回写（SCENE-B 路由委派 + 场景 agent）。

## 距北极星（诚实）
- **接地富答案需真 Kimi**：mock 环境只验路由/接线/配置 plumbing（已证回落到 agt_plan_audit）；「真调 plan_audit + 透出 C15/C18 裁决 + 三条管理事项」的结构化富答复需真 Kimi env-gated → **审核方 FDE 实拍**复验。demo 无 LLM key 时 agent 优雅降级为 gap 卡（非死路）。
- **presetContext/sliceTargets 接地**：本单接了 defaultAgentId + ruleBindings + tools 子集；`presetContext`(planVersion)/`sliceTargets`(plan 域切片) 的精细接地是增量（agent 现经 query_*/discover 在本租户本体内接地，CL.3 真类型名）。
- **WO-SCENE-C/D**：以本单为模板铺到 dash/risk/order/sop-balance + `scene-agent-config:check` 上架门——下一单。
