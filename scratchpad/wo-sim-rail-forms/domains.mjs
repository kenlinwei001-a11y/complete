// 现算：42 条传导规则各自落在哪个流程域（照 seed.ts `resolveRuleDomain` 的口径：域 = target 承载物的域）。
// 金丝雀：先抽一个已知必中的样例（procurementDelay → shortageRisk 三条），抽不到就是工具坏了。
import { readFileSync } from "node:fs";
const src = readFileSync("apps/datacore/src/seed.ts", "utf8");

// ① 规则：抓 { ... sourceTypeKey/sourceStateVar/targetTypeKey/targetStateVar ... }
const ruleRe =
  /sourceTypeKey:\s*"([^"]+)",[\s\S]{0,400}?sourceStateVar:\s*"([^"]+)"[\s\S]{0,900}?targetTypeKey:\s*"([^"]+)",[\s\S]{0,200}?targetStateVar:\s*"([^"]+)"/g;
const rules = [];
for (const m of src.matchAll(ruleRe)) rules.push({ sT: m[1], sV: m[2], tT: m[3], tV: m[4] });

// ② 流程册：carrierTypeKey → domainKey（取最小 domainKey，同 seed 的 `p.domainKey < cur.key`）
const procRe = /key:\s*"(P\d+)",\s*domainKey:\s*"(D\d+)"[\s\S]{0,300}?carrierTypeKey:\s*"([^"]+)"/g;
const carrier = new Map();
for (const m of src.matchAll(procRe)) {
  const [, , dk, ct] = m;
  const cur = carrier.get(ct);
  if (cur === undefined || dk < cur) carrier.set(ct, dk);
}
const domRe = /\{\s*key:\s*"(D\d+)",\s*name:\s*"([^"]+)",\s*businessDomainKey:\s*"([^"]+)"\s*\}/g;
const domName = new Map(), domBiz = new Map();
for (const m of src.matchAll(domRe)) { domName.set(m[1], m[2]); domBiz.set(m[1], m[3]); }

// 金丝雀
const canary = rules.filter((r) => r.sV === "procurementDelay");
console.log(`金丝雀 procurementDelay 规则数 = ${canary.length}（期望 3；0 ⇒ 工具坏了）`);
console.log(`金丝雀 流程册条数 = ${carrier.size}（0 ⇒ 工具坏了） · 域册 = ${domName.size}`);
if (canary.length === 0 || carrier.size === 0 || domName.size === 0) { console.error("⛔ 工具坏了"); process.exit(2); }

console.log(`\n规则总数 = ${rules.length}`);
const byDomain = new Map();
for (const r of rules) {
  const dk = carrier.get(r.tT) ?? null;
  const k = dk ?? "(未归域)";
  if (!byDomain.has(k)) byDomain.set(k, new Set());
  byDomain.get(k).add(`${r.tV}←${r.sV}`);
}
for (const [dk, set] of [...byDomain].sort()) {
  console.log(`\n${dk} ${domName.get(dk) ?? ""} [${domBiz.get(dk) ?? "-"}]  边 ${set.size}`);
  console.log("   " + [...set].sort().join(" · "));
}

// 每个 stateVar 落在哪些域（作为 source / 作为 target）
console.log("\n════ stateVar → 域（按 target 域，= 屏上分片口径）════");
const svDom = new Map();
for (const r of rules) {
  const dk = carrier.get(r.tT) ?? "(未归域)";
  if (!svDom.has(r.tV)) svDom.set(r.tV, new Set());
  svDom.get(r.tV).add(dk);
}
for (const [sv, ds] of [...svDom].sort()) console.log(`${sv.padEnd(26)} ${[...ds].sort().join(",")}`);
console.log("\n════ 只作 source（根源候选）的 stateVar ════");
const srcs = new Set(rules.map((r) => r.sV)), tgts = new Set(rules.map((r) => r.tV));
console.log([...srcs].filter((v) => !tgts.has(v)).sort().join(" · "));
