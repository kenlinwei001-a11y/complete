import fs from "fs";
const p = "/home/user/complete/docs/work-queue.json";
const q = JSON.parse(fs.readFileSync(p, "utf8"));
const add = (o) => {
  let it = q.items.find(x => x.id === o.id);
  if (!it) { it = { at: {} }; q.items.push(it); }
  Object.assign(it, o);
  it.at = (it.at && typeof it.at === "object") ? it.at : {};
};
add({ id: "WO-SWEEP-01-SCENE-SEED", title: "种子完整性:6场景(S05/S12/S13/S14/S17/S19)缺defaultAgent→断链不可启动",
  doc: "docs/REVIEW-full-click-sweep-2026-07-11.md", priority: "P3", status: "TODO", owner: "", deps: [],
  note: "复验agent a3251764真跑:42 PUBLISHED场景中6个AGENT_FIRST缺defaultAgent→启动器断链、启动按钮已诚实禁用(非死链非假值)。demo这6卡不可用。",
  acceptance: { goal: "6场景可诚实启动或诚实降级。", criteria: [
    { id: "C1", type: "真跑", assert: "S05/S12/S13/S14/S17/S19补defaultAgent(绑真PUBLISHED agent)或降级DRAFT。真渲染场景启动器→6卡或可启动或不再PUBLISHED显断链。" },
    { id: "C2", type: "gate", assert: "scene-agent-config门绿·frontend回归绿·additive。" }], discipline: "additive·KILL-MOCK-RED·审核方扫描出单·dev建·reviewer复验。" } });
add({ id: "WO-SWEEP-02-STUDIO-STATE", title: "UX:DataBuilder本体建模工作流studio刷新丢失所选工作流(auto-select workflows[0])",
  doc: "docs/REVIEW-full-click-sweep-2026-07-11.md", priority: "P3", status: "TODO", owner: "", deps: [],
  note: "复验agent a0989369真跑:编辑'本体工作流2'后刷新落到'1'(后端已落库6节点·非数据丢失·仅UI选中态丢)。易误以为编辑丢失。",
  acceptance: { goal: "刷新/返回保持上次所选工作流。", criteria: [
    { id: "C1", type: "真跑", assert: "OntologyWorkflowStudio selectWorkflow记忆(localStorage或URL ?wf=)。真渲染:选工作流2→刷新→仍工作流2。" },
    { id: "C2", type: "gate", assert: "frontend回归绿·additive。" }], discipline: "additive·审核方扫描出单·dev建·reviewer复验。" } });
add({ id: "WO-SWEEP-03-NAV-GROUP", title: "IA:6 admin页落兜底'其它'导航组(ShellLayout.NAV_GROUPS vs adminRegistry漂移)",
  doc: "docs/REVIEW-full-click-sweep-2026-07-11.md", priority: "P3", status: "TODO", owner: "", deps: [],
  note: "复验agent a0989369真跑:knowledge/schema-reconcile/decisions/audit-log/boundary/prototype-intake落兜底'其它'组(ShellLayout.NAV_GROUPS未列·adminRegistry.ADMIN_NAV_GROUPS已列·两处漂移)。页正常渲染·仅归组。",
  acceptance: { goal: "6 admin页归入正确域组。", criteria: [
    { id: "C1", type: "真跑", assert: "ShellLayout.NAV_GROUPS补齐6项到对应域组(对齐adminRegistry.ADMIN_NAV_GROUPS)。真渲染:6页不再落'其它'。" },
    { id: "C2", type: "gate", assert: "frontend回归绿·additive。" }], discipline: "additive·审核方扫描出单·dev建·reviewer复验。" } });
fs.writeFileSync(p, JSON.stringify(q, null, 2) + "\n");
const c = {}; q.items.forEach(x => c[x.status] = (c[x.status] || 0) + 1);
console.log("counts:", JSON.stringify(c));
console.log("新增:", ["WO-SWEEP-01-SCENE-SEED","WO-SWEEP-02-STUDIO-STATE","WO-SWEEP-03-NAV-GROUP"].join(", "));
