#!/usr/bin/env node
/**
 * 门 `scene-agent-config:check`（WO-SCENE-C/D Phase D → WO-INTENT-MATERIALIZE-BINDING-COMPLETE 扩为
 * 「LLM 功能全绑定链门」·防半截上架·G-3/G-9）。
 *
 * A. 对每个出厂 SceneEntry 校验（既有）：
 *  ① mode ≠ WORKFLOW_ONLY（开放式入口拒答是反模式；WO-SCENE-A 已收口·此门防回潮）；
 *  ② AGENT_FIRST/AGENT_ONLY 必须有 defaultAgentId（否则运行期直接 fail）；
 *  ③ 凡设了 defaultAgentId → 该 agent 必须在出厂注册表中存在且 status=PUBLISHED（防指向缺失/草稿 agent 的半截配置）；
 *  ④ 该 agent 的 BUILTIN 工具名必须 ∈ 工具注册表（防绑不存在的工具）；其 ruleBindings 须为合法形态。
 *
 * B. 对每个一等 Intent（LLM 功能）校验全绑定链 6 项齐（WO-INTENT-MATERIALIZE-BINDING-COMPLETE ④）：
 *  ⑤ mode 合法且 = 审核方钉死表（INTENT_MODE）·status=PUBLISHED；
 *  ⑥ {agent|workflow} 按 mode 存在且 PUBLISHED（workflow-first→plan PUBLISHED·agent-first→agent PUBLISHED）；
 *  ⑦ ontologySlice 存在（∈ 一等切片注册表）；
 *  ⑧ ≥1 evaluation 规则（ruleKeys 非空）；
 *  ⑨ solver ∈ 注册表；⑩ skill 存在。任一缺 → 红（列名缺项）。且总数必须 = 20（物化齐）。
 *
 * 依赖 agentcore 已构建（gates 链 pnpm -r build 在前）。导入编译产物静态校验。
 * 注：rules⊆已发布 是跨系统（规则在 DataCore）运行期校验，留审核方 FDE；本门守 agentcore 侧配置一致性。
 */
const base = "../apps/agentcore/dist";
const seed = await import(`${base}/mocks/seed.js`).catch((e) => {
  console.error(`✗ scene-agent-config:check 导入 agentcore dist 失败（先 pnpm --filter agentcore build）：${e.message}`);
  process.exit(1);
});
const reg = await import(`${base}/tools/registry.js`);
const mat = await import(`${base}/intents/materialize.js`);

const scenes = seed.seedSceneEntries();
const { agents, skills } = seed.seedRegistry();
const agentById = new Map(agents.map((a) => [a.id, a]));
const builtinNames = new Set(reg.BUILTIN_TOOLS.map((t) => t.name));

let red = false;
const fail = (m) => { console.error("✗ " + m); red = true; };

for (const s of scenes) {
  const id = `${s.viewKey}(${s.id})`;
  // ① 禁 WORKFLOW_ONLY
  if (s.mode === "WORKFLOW_ONLY") {
    fail(`${id}: mode=WORKFLOW_ONLY（开放式入口拒答反模式）——用 WORKFLOW_FIRST + defaultAgentId 回落场景 agent`);
  }
  // ② AGENT_FIRST/AGENT_ONLY 必须有 defaultAgentId
  if ((s.mode === "AGENT_FIRST" || s.mode === "AGENT_ONLY") && !s.defaultAgentId) {
    fail(`${id}: ${s.mode} 缺 defaultAgentId（运行期直接 fail）`);
  }
  // ③④ defaultAgentId 一致性
  if (s.defaultAgentId) {
    const a = agentById.get(s.defaultAgentId);
    if (!a) {
      fail(`${id}: defaultAgentId=${s.defaultAgentId} 在出厂注册表中不存在（半截配置·指向缺失 agent）`);
      continue;
    }
    if (a.status !== "PUBLISHED") {
      fail(`${id}: 场景 agent ${s.defaultAgentId} 未发布（status=${a.status}）——草稿 agent 不可作入口默认`);
    }
    for (const t of a.tools ?? []) {
      if (t.kind === "BUILTIN" && !builtinNames.has(t.name)) {
        fail(`${id}: 场景 agent ${s.defaultAgentId} 绑定不存在的 BUILTIN 工具「${t.name}」`);
      }
    }
    const rb = a.ruleBindings;
    if (!rb || !(rb.ruleKeys === "ALL_APPLICABLE" || Array.isArray(rb.ruleKeys))) {
      fail(`${id}: 场景 agent ${s.defaultAgentId} ruleBindings 形态非法（须 ALL_APPLICABLE 或 ruleKeys[]）`);
    }
  }
}

// ---- B. 一等 Intent 全绑定链门（WO-INTENT-MATERIALIZE-BINDING-COMPLETE ④）----
const intents = mat.materializeIntents("demo");
const slices = mat.seedIntentSlices("demo");
const sliceKeys = new Set(slices.map((s) => s.sliceKey));
const solverKeys = mat.registeredSolverKeys();
const skillIds = new Set(skills.map((s) => s.id));
// workflow-first 绑定的执行计划：PUBLISHED 判定源 = seedIntentsAndPlans（与运行期播种同源）。
const { plans } = seed.seedIntentsAndPlans("demo");
const planById = new Map(plans.map((p) => [p.id, p]));

if (intents.length !== 20) {
  fail(`一等 Intent 物化数=${intents.length}，应为 20（20 场景 intentKey 全物化）。`);
}
for (const it of intents) {
  const id = `intent(${it.key})`;
  // ⑤ mode 合法 + = 审核方钉死表 + PUBLISHED
  const wantMode = mat.INTENT_MODE[it.key];
  if (it.mode !== "WORKFLOW_FIRST" && it.mode !== "AGENT_FIRST") fail(`${id}: mode 非法「${it.mode}」（须 WORKFLOW_FIRST/AGENT_FIRST）`);
  if (wantMode && it.mode !== wantMode) fail(`${id}: mode=${it.mode} ≠ 审核方钉死 ${wantMode}（mode 不可漂移）`);
  if (it.status !== "PUBLISHED") fail(`${id}: status=${it.status}（物化 Intent 须 PUBLISHED）`);
  const b = it.bindings ?? {};
  // ⑨ solver ∈ 注册表
  if (!b.solverKey || !solverKeys.has(b.solverKey)) fail(`${id}: solver「${b.solverKey}」∉ 求解器注册表`);
  // ⑧ ≥1 evaluation 规则
  if (!Array.isArray(b.ruleKeys) || b.ruleKeys.length === 0) fail(`${id}: 缺 evaluation 规则（ruleKeys 空）`);
  // ⑩ skill 存在
  if (!b.skillId || !skillIds.has(b.skillId)) fail(`${id}: skill「${b.skillId}」不存在于出厂 Skill 库`);
  // ⑦ ontologySlice 存在
  if (!b.ontologySliceKey || !sliceKeys.has(b.ontologySliceKey)) fail(`${id}: ontologySlice「${b.ontologySliceKey}」∉ 一等切片注册表`);
  // ⑥ {agent|workflow} 按 mode 存在且 PUBLISHED
  if (it.mode === "WORKFLOW_FIRST") {
    const p = b.workflowId ? planById.get(b.workflowId) : undefined;
    if (!b.workflowId) fail(`${id}: workflow-first 缺 workflowId`);
    else if (!p) fail(`${id}: workflowId=${b.workflowId} 无对应执行计划`);
    else if (p.status !== "PUBLISHED") fail(`${id}: 绑定执行计划 ${b.workflowId} 未发布（${p.status}）`);
  } else {
    const ag = b.agentId ? agentById.get(b.agentId) : undefined;
    if (!b.agentId) fail(`${id}: agent-first 缺 agentId`);
    else if (!ag) fail(`${id}: agentId=${b.agentId} 在出厂注册表中不存在`);
    else if (ag.status !== "PUBLISHED") fail(`${id}: 绑定 agent ${b.agentId} 未发布（${ag.status}）`);
  }
}

if (red) {
  console.error("\n✗ scene-agent-config:check 未过：上述对话入口/一等 Intent 全绑定链不完整/半截。修法：mode≠WORKFLOW_ONLY；AGENT_FIRST 配 defaultAgentId；每 Intent 6 项绑定齐（mode 钉死·{agent|workflow}按 mode PUBLISHED·slice 存在·≥1 eval 规则·solver∈注册·skill 存在）——缺项跑 POST /b/v1/intents/reconcile 自动 scaffold DRAFT。");
  process.exit(1);
}
console.log(`✓ scene-agent-config:check 通过（${scenes.length} 个对话入口配置一致 + ${intents.length} 个一等 Intent 全绑定链 6 项齐：mode 钉死 · {agent|workflow} PUBLISHED · slice/skill/solver/eval 规则齐）。`);
