#!/usr/bin/env node
/**
 * 门 `link-stabilize:check`（WO-DB-LINK-STABILIZE · 链路派生稳定 · KILL-MOCK-RED · R6 · 堵 §8 G-BUILD-LINK）：
 * 守建域 comprehend 的切片 hops **不再恒 []**——从对象 refToTypeKey（+ FK 名启发兜底补 LLM 丢的链）经
 * `slice-planner.planSlice` 真 BFS 多跳派生真实 hops，每切片不再退化为"取该类型对象"单根。
 *
 * 静态哨兵：① comprehend.ts deriveBStack/comprehendScript 用 `deriveSliceHops`（非硬编码 `hops: []`）·接 planSlice。
 * 动态测谎（经已构 dist · green→red 有牙）：
 *  ② 显式 refToTypeKey → deriveSliceHops 产非空 hops；
 *  ③ **LLM 丢链**（ref 缺·仅属性名 <Type>ref）+ FK 兜底开 → hops 非空（补回·门绿）；
 *  ④ 关兜底（fkFallback:false）+ 丢链 → hops 空（门红侧·证兜底真生效·非死板）；
 *  ⑤ R6：同 objectTypes 双跑字节一致。
 *
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7 门 + §8 G-BUILD-LINK。用法：node scripts/check-link-stabilize.mjs
 */
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const abs = (rel) => new URL(rel, root);
const read = (rel) => (existsSync(abs(rel)) ? readFileSync(abs(rel), "utf8") : null);
const stripComments = (s) => s.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const fail = [];

// ── 静态：comprehend.ts 用 deriveSliceHops·接 planSlice·无硬编码 hops:[] 残留 ──
const src = read("apps/datacore/src/databuilder/comprehend.ts");
if (src == null) fail.push("缺 apps/datacore/src/databuilder/comprehend.ts");
else {
  const code = stripComments(src);
  if (!/export function deriveSliceHops\b/.test(code)) fail.push("comprehend.ts 缺 deriveSliceHops（链路派生器未在位）");
  if (!/const hopsByRoot = deriveSliceHops\(objectTypes\)/.test(code) || (code.match(/deriveSliceHops\(objectTypes\)/g) ?? []).length < 2)
    fail.push("deriveBStack/comprehendScript 未双双用 deriveSliceHops（LLM+地板路应共享·R6）");
  if (/rootType:\s*t\.typeKey,\s*hops:\s*\[\]\s*\}/.test(code)) fail.push("comprehend.ts 仍有硬编码 hops:[]（恒空切片回潮）");
  if (!/planSlice\(/.test(code)) fail.push("deriveSliceHops 未接 slice-planner.planSlice（未复用真 BFS）");
}

// ── 动态测谎（经 dist · green→red）──
async function dynamic() {
  const dist = abs("apps/datacore/dist/databuilder/comprehend.js");
  if (!existsSync(dist)) { fail.push("comprehend dist 未构建——先 pnpm --filter datacore build 再跑本门（含动态测谎）"); return; }
  const m = await import(dist.href);
  if (typeof m.deriveSliceHops !== "function") { fail.push("dist 未导出 deriveSliceHops"); return; }
  const ot = (typeKey, domain, props) => ({ typeKey, displayName: typeKey, domain, sourceDataset: typeKey.toLowerCase(),
    properties: props.map((p) => ({ propKey: p.propKey, sourceField: p.propKey, dataType: p.ref ? "ref" : "string", isPrimaryKey: !!p.pk, refToTypeKey: p.ref ?? null })) });
  const explicit = [ot("Order", "sales", [{ propKey: "order_id", pk: true }]), ot("Process", "factory", [{ propKey: "proc_id", pk: true }, { propKey: "orderRef", ref: "Order" }])];
  // ② 显式 ref → 非空。
  if (!(m.deriveSliceHops(explicit).get("Process")?.length > 0)) fail.push("显式 refToTypeKey 未派生非空 hops（洞未收口）");
  // ③ 丢链 + 兜底开 → 补回非空。
  const dropped = [ot("Order", "sales", [{ propKey: "order_id", pk: true }]), ot("Process", "factory", [{ propKey: "proc_id", pk: true }, { propKey: "orderRef" }])];
  if (!(m.deriveSliceHops(dropped).get("Process")?.length > 0)) fail.push("LLM 丢链 FK 兜底未补回 hops（门绿失效）");
  // ④ 关兜底 + 丢链 → 空（证兜底真生效·green→red）。
  const noFb = m.deriveSliceHops(dropped, { fkFallback: false }).get("Process");
  if (!(Array.isArray(noFb) && noFb.length === 0)) fail.push("关 FK 兜底后丢链仍非空——兜底死板无牙（green→red 失效）");
  // ⑤ R6 双跑一致。
  const a = JSON.stringify([...m.deriveSliceHops(explicit)].sort());
  const b = JSON.stringify([...m.deriveSliceHops(explicit)].sort());
  if (a !== b) fail.push("R6 违例：deriveSliceHops 同输入双跑非字节一致");
}
await dynamic();

if (fail.length) {
  console.error("✗ link-stabilize:check 失败：");
  for (const f of fail) console.error("  - " + f);
  process.exit(1);
}
console.log("✓ link-stabilize:check 通过（切片 hops 真 BFS 多跳·FK 兜底补丢链·green→red 有牙·R6）");
