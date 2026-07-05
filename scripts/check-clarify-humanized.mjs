#!/usr/bin/env node
/**
 * 门 `clarify-humanized:check`（WO-SLOT-CLARIFY-HUMANIZE·治 G-3 澄清人话化·铁律 0.4 零裸内部 key）。
 *
 * 用户亲报：点场景卡后改写问句 → 澄清弹「请提供demandDelta」裸英文内部参数名，用户不知何物。
 * 根因①：clarifyPromptFor 无视 slot.description、直接落兜底裸名 `请提供${name}`。
 *
 * 本门遍历**全部 PUBLISHED 一等 Intent + 出厂种子 Intent**的**必填槽**，断言：
 *  ① 每个必填槽有 clarifyPrompt 或非空 description（缺→红，防新增槽回潮裸 key）；
 *  ② clarifyPromptFor(slot) 不是裸名兜底形态 `请提供${name}`（即真出人话，不泄漏内部参数名）；
 *  ③ 面向用户的澄清文案不得整体等于某个 camelCase 内部 key（如 demandDelta）——双保险。
 *
 * 依赖 agentcore 已构建（gates 链 pnpm -r build 在前）。导入编译产物静态校验（green→red 自证）。
 */
const base = "../apps/agentcore/dist";
const imp = async (p) =>
  import(`${base}/${p}`).catch((e) => {
    console.error(`✗ clarify-humanized:check 导入 agentcore dist 失败（先 pnpm --filter agentcore build）：${e.message}`);
    process.exit(1);
  });

const seed = await imp("mocks/seed.js");
const mat = await imp("intents/materialize.js");
const slots = await imp("router/slots.js");
const { clarifyPromptFor } = slots;

let red = false;
const fail = (m) => { console.error("✗ " + m); red = true; };

// PUBLISHED 一等 Intent（materializeIntents）+ 出厂种子 Intent（seedIntentsAndPlans）——两条上架源都覆盖。
const seeded = seed.seedIntentsAndPlans("demo").intents ?? [];
const materialized = mat.materializeIntents("demo");
const allIntents = [...seeded, ...materialized].filter((i) => i.status === "PUBLISHED");

const CAMEL = /^[a-z][a-zA-Z0-9]*$/; // 纯拉丁 camelCase 内部 key 形态

let checked = 0;
for (const it of allIntents) {
  for (const slot of it.slots ?? []) {
    if (!slot.required) continue;
    checked++;
    const id = `intent(${it.key}).slot(${slot.name})`;
    const hasClarify = typeof slot.clarifyPrompt === "string" && slot.clarifyPrompt.trim().length > 0;
    const hasDesc = typeof slot.description === "string" && slot.description.trim().length > 0;
    // ① 必填槽须有 clarifyPrompt 或 description
    if (!hasClarify && !hasDesc) {
      fail(`${id}: 必填槽既无 clarifyPrompt 又无 description → 澄清会甩裸内部 key「请提供${slot.name}」。补人话 clarifyPrompt（含单位/示例/取值域）。`);
      continue;
    }
    // ② clarifyPromptFor 不得落裸名兜底
    const prompt = clarifyPromptFor(slot);
    if (prompt === `请提供${slot.name}`) {
      fail(`${id}: clarifyPromptFor 落裸名兜底「${prompt}」——面向用户泄漏内部参数名。补 clarifyPrompt/description。`);
    }
    // ③ 澄清文案整体不得就是个 camelCase 内部 key
    if (CAMEL.test(prompt) && prompt.length > 3) {
      fail(`${id}: 澄清文案「${prompt}」形如内部 camelCase key（面向用户）。改人话。`);
    }
  }
}

if (checked === 0) fail("未遍历到任何 PUBLISHED 必填槽——门无效（导入路径/播种漂移？）。");

if (red) {
  console.error("\n✗ clarify-humanized:check 未过：存在面向用户泄漏裸内部参数名的澄清反问。修法：为该必填槽补 clarifyPrompt（人话+单位+示例+取值域，如『请提供需求增量比例(0~1 小数·如 0.2=+20%)』），或至少补人话 description。");
  process.exit(1);
}
console.log(`✓ clarify-humanized:check 通过（${allIntents.length} 个 PUBLISHED Intent · ${checked} 个必填槽均有人话澄清·零裸内部 key）。`);
