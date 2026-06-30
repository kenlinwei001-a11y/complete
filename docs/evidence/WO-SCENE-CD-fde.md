# WO-SCENE-C/D（场景 agent 铺开 + scene-agent-config 门）— FDE 真值证据

> 源单 DISPATCH §WO-SCENE-C/D。依赖 WO-SCENE-B（agt_plan_audit 模板）已就绪。本单交付 **Phase D 防半截上架门**（结构性根问题解），Phase C（铺开到 20+ 入口）随门就位后渐进。

## Phase D · `scene-agent-config:check` 门（防半截上架·G-9 根问题解）

`scripts/check-scene-agent-config.mjs`（并入 `pnpm gates`·导入 agentcore 编译产物 seedSceneEntries+seedRegistry+BUILTIN_TOOLS）对每个出厂 SceneEntry 静态校验：
1. mode ≠ WORKFLOW_ONLY（开放入口拒答反模式·WO-SCENE-A 收口后防回潮）；
2. AGENT_FIRST/AGENT_ONLY 必有 defaultAgentId（否则运行期 fail）；
3. 凡设 defaultAgentId → 该 agent 在出厂注册表存在且 status=PUBLISHED（防指向缺失/草稿 agent 的半截配置）；
4. agent BUILTIN 工具名 ∈ 工具注册表 + ruleBindings 合法形态。

**真值证据 green→red→green**：
- 绿：9 个对话入口配置一致（无 WORKFLOW_ONLY·defaultAgentId 均指向已发布 agent·工具/规则合法）。
- 红（自证）：把 `scn_plan_audit.defaultAgentId` 改指 `agt_nonexistent` → 门红「defaultAgentId=agt_nonexistent 在出厂注册表中不存在（半截配置）」。
- 恢复绿。

> 跨系统的 rules⊆已发布（规则在 DataCore）属运行期校验，留审核方 FDE；本门守 agentcore 侧配置一致性。

## Phase C · 铺开（渐进·门已就位）

以 WO-SCENE-B 的 `agt_plan_audit` 为模板，给 dash/risk/order/sop-balance 各配场景级 agent（各自数据上下文/规则/求解器子集）是**机械复制 + 各需真 Kimi FDE**（接地富答案）。门 `scene-agent-config:check` 已就位——新配的入口自动受校验（指向已发布 agent + 工具/规则合法），半截上不了架。**当前未铺开属诚实缩范围**：现 dash/risk/order 等 WORKFLOW_FIRST 无 defaultAgentId → 命不中回落**通用** agent（不拒答·但非接地·WO-SCENE-A 已保证不拒答）；配专属场景 agent 是渐进增量。

## 门
`pnpm -r build` 全绿；`scene-agent-config:check` + `ontology:check` 绿；agentcore 测全绿（新门不改运行时·additive）。本体 §8 G-3/G-9 回写。
