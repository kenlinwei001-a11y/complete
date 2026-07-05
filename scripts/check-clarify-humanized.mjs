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

// ---------------------------------------------------------------------------
// CLARIFY-CHAIN-FIX（审计簇⑨·治 G-3 澄清**传输链**断点）：人话在服务端存在还不够——
// 此前 payload 只发 `{name,type,prompt}` 而前端读 `clarifyPrompt` → 配了中文也永远裸 key；
// enum 槽不带 enumValues → 下拉零选项不可作答。以下守传输链两端逐字段对齐（revert → 红）。
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";

// ④ 编译产物级：toClarificationSlot 存在，且对 enum/objectRef 槽产出过契约 schema、全量携带。
const contracts = await import("../packages/contracts/dist/qos.js").catch((e) => {
  console.error(`✗ clarify-humanized:check 导入 contracts dist 失败（先 pnpm --filter @platform/contracts build）：${e.message}`);
  process.exit(1);
});
if (typeof slots.toClarificationSlot !== "function") {
  fail("router/slots.toClarificationSlot 缺失——澄清 payload 失去契约单一产出口（簇⑨断①回潮风险）。");
} else if (!contracts.ClarificationSlotSchema || !contracts.ClarificationRequiredPayloadSchema) {
  fail("contracts ClarificationSlotSchema / ClarificationRequiredPayloadSchema 缺失——澄清传输失去单一契约。");
} else {
  const enumSlot = { name: "solutionName", type: "enum", required: true, enumValues: ["三班制", "外协"], clarifyPrompt: "请选择处置方案", description: "处置方案名" };
  const refSlot = { name: "base", type: "objectRef", required: true, refType: "Base", clarifyPrompt: "请指明基地", description: "基地对象引用" };
  for (const s of [enumSlot, refSlot]) {
    const out = slots.toClarificationSlot(s);
    const parsed = contracts.ClarificationSlotSchema.safeParse(out);
    if (!parsed.success) fail(`toClarificationSlot(${s.name}) 产出不过契约 ClarificationSlotSchema：${parsed.error.message}`);
  }
  const enumOut = slots.toClarificationSlot(enumSlot);
  if (!Array.isArray(enumOut.enumValues) || enumOut.enumValues.length !== 2) fail("toClarificationSlot 丢失 enumValues——enum 槽用户又将零选项不可作答（簇⑨断②回潮）。");
  if (enumOut.clarifyPrompt !== "请选择处置方案") fail("toClarificationSlot 未携带人话 clarifyPrompt——前端将回落裸 key。");
  const refOut = slots.toClarificationSlot(refSlot);
  if (refOut.objectType !== "Base") fail("toClarificationSlot 未把 refType 归一为 objectType——objectRef 搜索选择器将盲落默认类型。");
}

// ⑤ 源码级两端对齐：服务端发的字段 == 前端读的字段（同一契约，禁 fork）。
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const orch = src("apps/agentcore/src/router/orchestrator.ts");
if (!/slots:\s*stillMissing\.map\(\(s\)\s*=>\s*toClarificationSlot\(s\)\)/.test(orch)) {
  fail("orchestrator SLOT_FILLING payload 未经 toClarificationSlot 单一产出（自拼形状 = 传输链再断风险）。");
}
if (/prompt:\s*clarifyPromptFor\(/.test(orch)) {
  fail("orchestrator 澄清 payload 回潮旧 `prompt:` 错位字段名——前端读 clarifyPrompt，人话将再次到不了用户（簇⑨断①）。");
}
const clarTsx = src("apps/frontend-shell/src/components/QueryDock/Clarification.tsx");
if (!clarTsx.includes("slot.clarifyPrompt")) {
  fail("前端 Clarification.tsx 不再读 slot.clarifyPrompt——与服务端实发字段错位（簇⑨断①）。");
}
if (!clarTsx.includes("enumValues")) {
  fail("前端 Clarification.tsx 不再渲染 enumValues——enum 槽零选项不可作答（簇⑨断②）。");
}
const reducer = src("apps/frontend-shell/src/sse/taskStreamReducer.ts");
if (!/ClarificationRequiredPayload/.test(reducer)) {
  fail("前端 taskStreamReducer 不再引用契约 ClarificationRequiredPayload——payload 形状被 fork（违 contracts-only-shared）。");
}

if (red) {
  console.error("\n✗ clarify-humanized:check 未过：存在面向用户泄漏裸内部参数名的澄清反问，或澄清传输链两端字段错位（服务端有的人话必须逐值到达用户）。修法：为该必填槽补 clarifyPrompt（人话+单位+示例+取值域），payload 走 toClarificationSlot + 契约 ClarificationSlotSchema，前端读 clarifyPrompt/渲 enumValues。");
  process.exit(1);
}
console.log(`✓ clarify-humanized:check 通过（${allIntents.length} 个 PUBLISHED Intent · ${checked} 个必填槽均有人话澄清·零裸内部 key · 传输链两端 clarifyPrompt/enumValues/objectType 契约对齐）。`);
