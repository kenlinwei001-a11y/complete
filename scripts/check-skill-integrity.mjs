#!/usr/bin/env node
/**
 * 门 `skill-integrity:check`（SKILL-LIB-POLISH ①②·SKILL-LIBRARY-EVERYWHERE 引用完整性静态守）。
 *
 * 此前 engine.ts / seed.ts 注释宣称"门 skill-integrity:check 守孤儿引用"，但根 package.json 无此脚本——
 * 实际把关的仅是 skill-library.test.ts（经 pnpm -r test）。本门补齐命名门，与其它 check-*.mjs 一致的静态门形态：
 *
 * ① 引用完整性（孤儿引用）：agent.skills / workflow.skillRefs / plan.skillRefs / materializedIntent.bindings.skillId
 *    引用的每个 skillId 必**存在且 status=PUBLISHED**——指向缺失/草稿 skill 即孤儿 → 红（exit 1）。
 * ② 目录卡显式映射（防静默漏配）：每张 SCENARIO_CATALOG 卡的 intentKey 必在 INTENT_SKILL **显式**挂对口方法论——
 *    未映射即"将来新增卡静默回落产能方法论而非报错"的隐患 → 红。（skillIdForIntent 运行期亦对目录卡漏配抛错。）
 *
 * 依赖 agentcore 已构建（gates 链 pnpm -r build 在前）。导入编译产物静态校验（不起服务）。
 * 注：与 skill-library.test.ts 齿同源双保——命名门给 gates 链一处快速静态关卡，单测给逐机制 revert 演练。
 */
const base = "../apps/agentcore/dist";
const seed = await import(`${base}/mocks/seed.js`).catch((e) => {
  console.error(`✗ skill-integrity:check 导入 agentcore dist 失败（先 pnpm --filter agentcore build）：${e.message}`);
  process.exit(1);
});
const mat = await import(`${base}/intents/materialize.js`);
const cat = await import(`${base}/scenarios-catalog.js`);

let red = false;
const fail = (m) => { console.error("✗ " + m); red = true; };

// materializeIntents / seedIntentsAndPlans 内部经 skillIdForIntent——目录卡漏配会在此抛错（运行期守卫），
// 用 try 包裹给出门级诊断（而非裸栈）。
let agents, workflows, skills, plans, intents;
try {
  ({ agents, workflows, skills } = seed.seedRegistry());
  ({ plans } = seed.seedIntentsAndPlans());
  intents = mat.materializeIntents();
} catch (e) {
  fail(`播种/物化抛错（多半是目录卡缺 INTENT_SKILL 显式映射·守卫已触发）：${e.message}`);
  console.error("\n✗ skill-integrity:check 未过（上）。");
  process.exit(1);
}

// ---- ① 引用完整性门（孤儿引用） ----
const publishedSkillIds = new Set(skills.filter((s) => s.status === "PUBLISHED").map((s) => s.id));
const isValid = (skillId) => publishedSkillIds.has(skillId);

for (const a of agents) {
  for (const ref of a.skills ?? []) {
    if (!isValid(ref.skillId)) fail(`agent ${a.id} → skillId「${ref.skillId}」孤儿（不存在或未发布）`);
  }
}
for (const w of workflows) {
  for (const ref of w.skillRefs ?? []) {
    if (!isValid(ref.skillId)) fail(`workflow ${w.id} → skillId「${ref.skillId}」孤儿（不存在或未发布）`);
  }
}
for (const p of plans) {
  for (const ref of p.skillRefs ?? []) {
    if (!isValid(ref.skillId)) fail(`plan ${p.id} → skillId「${ref.skillId}」孤儿（不存在或未发布）`);
  }
}
for (const it of intents) {
  const sid = it.bindings?.skillId;
  if (!isValid(sid)) fail(`intent ${it.key} → bindings.skillId「${sid}」孤儿（不存在或未发布）`);
}

// ---- ② 目录卡显式映射门（防静默漏配·SKILL-LIB-POLISH②） ----
const unmapped = mat.unmappedCatalogIntentKeys();
if (unmapped.length > 0) {
  fail(`场景卡缺显式 INTENT_SKILL 映射（会静默回落 ${mat.DEFAULT_SKILL_ID}）：${unmapped.join(", ")}——请在 intents/materialize.ts INTENT_SKILL 逐卡显式挂对口方法论。`);
}
const catalogCount = cat.SCENARIO_CATALOG.length;

if (red) {
  console.error("\n✗ skill-integrity:check 未过：上述 skill 引用孤儿 / 目录卡漏配。修法：孤儿→挂已发布 skillId；漏配→INTENT_SKILL 显式映射。");
  process.exit(1);
}
console.log(`✓ skill-integrity:check 通过（${skills.length} skill · ${agents.length} agent / ${workflows.length} workflow / ${plans.length} plan / ${intents.length} intent 引用零孤儿 · ${catalogCount} 目录卡全显式映射无静默回落）。`);
