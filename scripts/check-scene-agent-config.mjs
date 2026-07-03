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
const { agents, skills, workflows } = seed.seedRegistry();
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

// ---- C. AGENT-UNIVERSAL-FALLBACK：兜底终点 = 一等全域探索智能体（非写死白名单）·防退回 ----
//  ⑪ 出厂注册表含 agt_universal 且 status=PUBLISHED（兜底终点是可配置一等对象·D1）；
//  ⑫ tools 含全部 BUILTIN（全工具面，退回「只 READ/COMPUTE 白名单」即缺 sim_*/build_domain 等→红·green→red 自证）；
//  ⑬ tools 含全部出厂已发布 workflow 一条 {kind:WORKFLOW}（WORKFLOW-as-tool 触达兜底·D2）；
//  ⑭ scopeDeclaration=全域（"*"）（触达动态 MCP 全名·非静态白名单可穷举）。
//  注：MCP 一条/已绑定配置由运行期 reconcileUniversalAgent 随增删同步（跨系统·运行期·留 FDE/单测），本门守静态出厂骨架。
const UNIVERSAL_ID = "agt_universal";
const uni = agentById.get(UNIVERSAL_ID);
if (!uni) {
  fail(`兜底终点缺失：出厂注册表无 ${UNIVERSAL_ID}（全域探索智能体）——兜底终点必须是一等可配置 agent，非代码写死白名单（D1）。`);
} else {
  if (uni.status !== "PUBLISHED") fail(`${UNIVERSAL_ID} status=${uni.status}（兜底终点须 PUBLISHED）`);
  const uniBuiltin = new Set((uni.tools ?? []).filter((t) => t.kind === "BUILTIN").map((t) => t.name));
  const missingBuiltin = [...builtinNames].filter((n) => !uniBuiltin.has(n));
  if (missingBuiltin.length > 0) {
    fail(`${UNIVERSAL_ID} 工具面不全（缺 BUILTIN：${missingBuiltin.join(",")}）——「超级兜底 agent」须全工具面，退回 READ/COMPUTE 白名单即红。`);
  }
  const uniWorkflowIds = new Set((uni.tools ?? []).filter((t) => t.kind === "WORKFLOW").map((t) => t.workflowId));
  const publishedWorkflowIds = workflows.filter((w) => w.status === "PUBLISHED").map((w) => w.id);
  const missingWf = publishedWorkflowIds.filter((id2) => !uniWorkflowIds.has(id2));
  if (missingWf.length > 0) fail(`${UNIVERSAL_ID} 缺已发布 workflow-as-tool：${missingWf.join(",")}（D2·WORKFLOW 须触达兜底）`);
  const st = uni.scopeDeclaration?.toolNames ?? [];
  if (!st.includes("*")) fail(`${UNIVERSAL_ID} scopeDeclaration.toolNames 非全域（"*"）——兜底须触达动态 MCP 全工具面，静态白名单穷举不了。`);
}

if (red) {
  console.error("\n✗ scene-agent-config:check 未过：上述对话入口/一等 Intent 全绑定链/兜底终点不完整/半截。修法：mode≠WORKFLOW_ONLY；AGENT_FIRST 配 defaultAgentId；每 Intent 6 项绑定齐；兜底终点须一等 PUBLISHED agt_universal（全 BUILTIN + 已发布 workflow + scope 全域，非写死白名单）。");
  process.exit(1);
}
console.log(`✓ scene-agent-config:check 通过（${scenes.length} 个对话入口配置一致 + ${intents.length} 个一等 Intent 全绑定链 6 项齐 + 兜底终点 ${UNIVERSAL_ID} 全工具面 PUBLISHED·scope 全域）。`);
