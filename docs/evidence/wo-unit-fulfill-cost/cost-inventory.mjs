/**
 * WO-UNIT-FULFILL-COST · 步骤① 成本量清单
 * 从**编译后的真实本体定义**枚举每一个数值属性，标出：本体声明的单位 · 命中哪些词库角色。
 * 金丝雀：Base.serveCost（确定存在的成本量）与 Material.unitPrice 必须命中，不中即工具坏了。
 */
import { batteryObjectTypes } from "../../../apps/datacore/dist/synthetic/battery.js";
import { extendedObjectTypes } from "../../../apps/datacore/dist/synthetic/battery-extended.js";
import { ROLE_LEXICON, currencyScaleOf } from "../../../apps/datacore/dist/solvers/field-role-lexicon.js";

// ⚠ 两个来源缺一不可 —— 只读 batteryObjectTypes 会漏掉 Material 等全部扩展类型，
//   金丝雀 Material.unitPrice 当场报 NOT_FOUND 把这个漏洞抖了出来。
//   生产侧的并法见 synthetic/service.ts 的 `[...batteryObjectTypes(), ...extendedObjectTypes()]`。
const types = [...batteryObjectTypes(), ...extendedObjectTypes()];
const roles = Object.keys(ROLE_LEXICON);

const rows = [];
for (const t of types) {
  for (const p of t.properties) {
    if (p.dataType !== "number" || p.isPrimaryKey) continue;
    const hit = roles.filter((r) => ROLE_LEXICON[r].test(p.propKey));
    rows.push({
      type: t.key,
      prop: p.propKey,
      unit: p.unit ?? "",
      currencyScale: currencyScaleOf(p.unit) ?? "",
      roles: hit.join("+"),
      desc: (p.description ?? "").slice(0, 60),
    });
  }
}

// ── 金丝雀（先自证工具，再报否定结论）──────────────────────────────────
const canaries = [
  ["Base", "serveCost", "cost"],
  ["Material", "unitPrice", "revenue"],
];
console.log("═══ 金丝雀 ═══");
let canaryOk = true;
for (const [ty, pr, wantRole] of canaries) {
  const r = rows.find((x) => x.type === ty && x.prop === pr);
  const ok = r && r.roles.split("+").includes(wantRole);
  if (!ok) canaryOk = false;
  console.log(`  ${ok ? "命中" : "**未命中(工具坏了)**"} ${ty}.${pr} → roles=${r ? r.roles : "NOT_FOUND"} unit=${r ? r.unit || "未声明" : "-"}`);
}
console.log(`  数值属性总数 = ${rows.length}（类型 ${types.length} 个）`);
if (!canaryOk) { console.log("⛔ 金丝雀不中 —— 工具坏了，下面的结论一律不作数"); process.exit(2); }

// ── ① 命中 cost 词库的全部量 ───────────────────────────────────────────
const costRows = rows.filter((r) => r.roles.split("+").includes("cost"));
console.log(`\n═══ ① 命中 cost 词库的数值属性：${costRows.length} 条 ═══`);
console.log("类型.属性 | 声明单位 | 折元倍数 | 命中角色 | 描述");
for (const r of costRows.sort((a, b) => (a.type + a.prop).localeCompare(b.type + b.prop))) {
  console.log(`${r.type}.${r.prop} | ${r.unit || "—未声明—"} | ${r.currencyScale || "折不动"} | ${r.roles} | ${r.desc}`);
}

// ── ② 同时命中 cost + unitRate 的（= 按件计价的成本，本单要找的东西）──────
const perUnitCost = costRows.filter((r) => r.roles.split("+").includes("unitRate"));
console.log(`\n═══ ② 同时命中 cost+unitRate（按件计价的成本候选）：${perUnitCost.length} 条 ═══`);
for (const r of perUnitCost) console.log(`${r.type}.${r.prop} | 单位=${r.unit || "—未声明—"} | 折元倍数=${r.currencyScale || "折不动"}`);
if (perUnitCost.length === 0) console.log("（空）");

// ── ③ 声明了货币单位的全部量（不论词库）──────────────────────────────
const money = rows.filter((r) => r.currencyScale !== "");
console.log(`\n═══ ③ 声明了可折算货币单位的数值属性：${money.length} 条 ═══`);
for (const r of money.sort((a, b) => (a.type + a.prop).localeCompare(b.type + b.prop))) {
  console.log(`${r.type}.${r.prop} | ${r.unit} | ×${r.currencyScale} | roles=${r.roles || "—"}`);
}

// ── ④ 全体属性里声明了任何单位的（看单位字典覆盖面）────────────────────
const anyUnit = rows.filter((r) => r.unit !== "");
console.log(`\n═══ ④ 声明了任意单位的数值属性：${anyUnit.length} / ${rows.length} ═══`);
const byUnit = {};
for (const r of anyUnit) (byUnit[r.unit] ??= []).push(`${r.type}.${r.prop}`);
for (const u of Object.keys(byUnit).sort()) console.log(`  ${u}: ${byUnit[u].length} 条 — ${byUnit[u].slice(0, 6).join("、")}${byUnit[u].length > 6 ? "…" : ""}`);
