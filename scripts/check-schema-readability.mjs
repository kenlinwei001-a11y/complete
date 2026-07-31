#!/usr/bin/env node
/**
 * WO-63-SCHEMA-READABILITY · 本体可读性门（"业务专家 1 小时读懂 80%"的可校验代理）。
 *
 * 判据不是"字段存在"，而是**字段有数据、且数据诚实**。四项覆盖率从 datacore dist 的**真实出厂本体**
 * 算出（不估算、不抽样），低于门槛即非零退出：
 *   ① 属性口径覆盖率 = 有非空 description 的 PropertyDef ÷ 总 PropertyDef
 *   ② 单位覆盖率     = 有非空 unit 的**有量纲**数值属性 ÷ 有量纲数值属性
 *                      （分母已剔除 unitExempt 标注的无量纲/随行量纲属性——诚实豁免，不是分母注水）
 *   ③ 中文名覆盖率   = 有 displayName（且 ≠ propKey）的 PropertyDef ÷ 总 PropertyDef
 *   ④ 概念定义覆盖率 = 有 businessDefinition 的对象类型 ÷ 总对象类型
 *
 * 另有五条硬校验（覆盖率达标也可能不诚实）：
 *   H1 核心类型必须有 businessDefinition.statement（≥10 字）
 *   H2 statement 不得含空泛词——词表**单源自 @platform/contracts**（见 H3）
 *   H3 空泛词表同源守恒：agentcore skill-lint 的 FORBIDDEN_WORDS 必须与契约常量逐字一致
 *      （真单源 import 需改 apps/agentcore/**，本单 🚦 边界禁止 → 以同源守恒门等价堵漏：改一处不同步即红）
 *   H4 unit 与 unitExempt 互斥（给比率硬塞个单位 = 编造，比留空更坏）
 *   H5 出厂本体用到的每个 unit 必须在治理单位字典内（否则管理页再存同一类型会被字典拒绝 → 接缝断）
 *
 * 用法：node scripts/check-schema-readability.mjs   （package.json: "schema-readability:check"）
 * 前置：datacore 与 contracts 已 build（读 dist，非源码）。
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const load = async (p) => import(pathToFileURL(resolve(p)).href);

let battery, extended, governance, contracts;
try {
  battery = await load("apps/datacore/dist/synthetic/battery.js");
  extended = await load("apps/datacore/dist/synthetic/battery-extended.js");
  governance = await load("apps/datacore/dist/ontology-governance.js");
  contracts = await load("packages/contracts/dist/index.js");
} catch (e) {
  console.error("✗ 可读性门无法加载 dist（先 `pnpm -r build`）：" + (e?.message ?? e));
  process.exit(2);
}

const THRESHOLDS = JSON.parse(readFileSync("scripts/schema-readability-baseline.json", "utf8"));

const types = [...battery.batteryObjectTypes(), ...extended.extendedObjectTypes()];
const fail = [];

// ---- 四项覆盖率（真实计数，不估算） -------------------------------------------
let props = 0, withDesc = 0, withDisplay = 0;
let dimensional = 0, dimensionalWithUnit = 0;
const missingDesc = [], missingUnit = [], missingDisplay = [];

for (const t of types) {
  for (const p of t.properties ?? []) {
    props++;
    const where = `${t.key}.${p.propKey}`;
    if (p.description && p.description.trim()) withDesc++;
    else missingDesc.push(where);
    if (p.displayName && p.displayName.trim() && p.displayName !== p.propKey) withDisplay++;
    else missingDisplay.push(where);

    // H4 互斥
    if (p.unitExempt && p.unit) {
      fail.push(`H4 ${where}：既标 unitExempt=${p.unitExempt} 又填 unit='${p.unit}'——无量纲属性不得硬凑单位`);
    }
    if (p.dataType === "number" && !p.unitExempt) {
      dimensional++;
      if (p.unit && String(p.unit).trim()) dimensionalWithUnit++;
      else missingUnit.push(where);
    }
  }
}
const typesWithDef = types.filter((t) => t.businessDefinition?.statement).length;

const pct = (a, b) => (b === 0 ? 1 : a / b);
const metrics = {
  propDescription: pct(withDesc, props),
  numericUnit: pct(dimensionalWithUnit, dimensional),
  propDisplayName: pct(withDisplay, props),
  typeBusinessDefinition: pct(typesWithDef, types.length),
};

// ---- H1 核心类型业务定义 -------------------------------------------------------
const byKey = new Map(types.map((t) => [t.key, t]));
for (const key of THRESHOLDS.coreTypes) {
  const t = byKey.get(key);
  if (!t) { fail.push(`H1 核心类型 ${key} 不在出厂本体（门槛清单与本体漂移）`); continue; }
  const s = t.businessDefinition?.statement ?? "";
  if (s.trim().length < 10) fail.push(`H1 核心类型 ${key} 缺 businessDefinition.statement（或短于 10 字）`);
  if (!t.businessDefinition?.excludes) fail.push(`H1 核心类型 ${key} 缺 excludes（"谁不算"比正面定义更能防歧义）`);
}

// ---- H2 空泛词 ---------------------------------------------------------------
const FORBIDDEN = contracts.BUSINESS_DEFINITION_FORBIDDEN_WORDS;
if (!Array.isArray(FORBIDDEN) || FORBIDDEN.length === 0) {
  fail.push("H2 契约未导出 BUSINESS_DEFINITION_FORBIDDEN_WORDS（空泛词表单源丢失）");
} else {
  for (const t of types) {
    const s = t.businessDefinition?.statement;
    if (!s) continue;
    for (const w of FORBIDDEN) {
      if (s.includes(w)) fail.push(`H2 ${t.key}.businessDefinition.statement 含空泛词「${w}」——只占字数不增信息`);
    }
  }
}

// ---- H3 空泛词表同源守恒：**副本不得存在**（强于「两份副本逐字一致」） ----------------
//
// 旧版要求 skill-lint.ts 里存在 `const FORBIDDEN_WORDS = [...]` 字面量并与契约逐字比对——
// 那是在**容忍副本存在**的前提下做一致性校验（当时 🚦 范围边界不许改 agentcore，只能等价堵漏）。
// 词表现已真正单源（skill-lint 直接 import 契约常量），故门升级为消灭副本本身：
//   ① skill-lint.ts 不得再出现词表字面量（副本重现即红）
//   ② 必须从 @platform/contracts import SKILL_SUMMARY_FORBIDDEN_WORDS 并绑定给 FORBIDDEN_WORDS
//   ③ 基集词仍须同时落在两张契约词表里（两处 lint 共用同一基集）
// ⚠ 此段语义与 datacore/test/schema-readability-seam.test.ts 的同名断言必须保持一致：
//    门与齿一旦分叉，就会重演「门要求副本、代码消灭副本，门红在自己的成果上」这次事故。
{
  const src = readFileSync("apps/agentcore/src/skill-lint.ts", "utf8");

  const literal = src.match(/const\s+FORBIDDEN_WORDS\s*=\s*\[([^\]]*)\]/);
  if (literal) {
    fail.push(
      `H3 apps/agentcore/src/skill-lint.ts 又出现字面量词表副本 [${literal[1].trim()}]` +
        "——单一来源是契约 SKILL_SUMMARY_FORBIDDEN_WORDS，此处只能 import，不得留副本",
    );
  }

  const imported =
    /import\s*\{[^}]*\bSKILL_SUMMARY_FORBIDDEN_WORDS\b[^}]*\}\s*from\s*["']@platform\/contracts["']/.test(src);
  const bound = /const\s+FORBIDDEN_WORDS\s*=\s*SKILL_SUMMARY_FORBIDDEN_WORDS\b/.test(src);
  if (!imported || !bound) {
    fail.push(
      `H3 apps/agentcore/src/skill-lint.ts 词表单源接线断开（import=${imported} · bind=${bound}）` +
        "——必须从 @platform/contracts 取 SKILL_SUMMARY_FORBIDDEN_WORDS 并绑定给 FORBIDDEN_WORDS",
    );
  }

  const canon = contracts.SKILL_SUMMARY_FORBIDDEN_WORDS ?? [];
  if (!canon.length) fail.push("H3 契约未导出 SKILL_SUMMARY_FORBIDDEN_WORDS（技能摘要词表单源丢失）");

  const base = contracts.VAGUE_WORDS_BASE ?? [];
  for (const w of base) {
    if (!canon.includes(w)) fail.push(`H3 基集词「${w}」未出现在契约 SKILL_SUMMARY_FORBIDDEN_WORDS（两处 lint 不再共用同一基集）`);
    if (!(FORBIDDEN ?? []).includes(w)) fail.push(`H3 基集词「${w}」未出现在业务定义词表（两处 lint 不再共用同一基集）`);
  }
}

// ---- H6 无量纲名形校验（S5：给比率硬凑单位即红） ---------------------------------
//
// 覆盖率查不出"填错"——`lon` 标个 "个" 照样 100%。故按**名形**判天然无量纲：
// 比率/概率后缀 + 一批公认无量纲键；确实带量纲的同名字段走**逐条带理由的例外表**（不许悄悄放过）。
const DIMENSIONLESS_SHAPED = /(?:Rate|Pct|Ratio|Prob)$/;
const DIMENSIONLESS_KEYS = new Set([
  "lon", "lat", "yield", "utilization", "attendance", "availability", "performance", "quality",
  "oee", "oeeA", "oeeP", "oeeQ", "oee_current", "availFactor", "irr", "winProb", "totalYield",
  "target_yield", "schedule_attainment", "elasticity", "weight", "baselineShare", "util24",
  "netMargin", "lossRate", "samplingRate",
]);
/** 名字像比率、实则有量纲 —— 每条必须写清为什么（防"加一行例外"当消音器用）。 */
const UNIT_EXCEPTIONS = {
  "Base.util": "基地口径存的是百分数 0–100（与 Line.utilization 的 0–1 小数不同），% 是真单位",
  "Model.weight": "此处 weight 是单体净重而非权重，克是真单位",
  "Segment.gmRate": "细分段毛利率按百分数存（C15 底线比较同口径）",
  "DemandSegment.marginPct": "毛利率按百分数存，毛利额公式显式 ÷100",
  "DemandSegment.floorPct": "毛利底线按百分数存，与 marginPct 同口径",
  "MaterialBalance.ltaPct": "长协覆盖率按百分数存",
  "CompetitorShare.sharePct": "市场份额按百分数存",
};
for (const t of types) {
  for (const p of t.properties ?? []) {
    if (p.dataType !== "number" || !p.unit) continue;
    const where = `${t.key}.${p.propKey}`;
    const shaped = DIMENSIONLESS_SHAPED.test(p.propKey) || DIMENSIONLESS_KEYS.has(p.propKey);
    if (shaped && !(where in UNIT_EXCEPTIONS)) {
      fail.push(`H6 ${where} 名形属无量纲（比率/系数/坐标）却填了单位 '${p.unit}'——硬凑单位即编造；确有量纲请在门的例外表逐条写明理由`);
    }
  }
}

// ---- H5 单位字典覆盖（数据 × 治理接缝） ------------------------------------------
{
  const dict = new Set(governance.UNIT_DICTIONARY ?? []);
  const used = new Set();
  for (const t of types) for (const p of t.properties ?? []) if (p.unit) used.add(p.unit);
  const outside = [...used].filter((u) => !dict.has(u)).sort();
  if (outside.length > 0) {
    fail.push(
      `H5 出厂本体用了字典外单位 [${outside.join(", ")}]——POST /a/v1/ontology/types 会以「未知单位」拒绝同一类型，` +
        "本体自己存不回自己（接缝断）。请同步扩 UNIT_DICTIONARY。",
    );
  }
}

// ---- 报告 ---------------------------------------------------------------------
const fmt = (x) => (x * 100).toFixed(1) + "%";
console.log("· 本体可读性度量（出厂本体真实计数，非估算）");
console.log(`  对象类型 ${types.length} · PropertyDef ${props} · 有量纲数值属性 ${dimensional}（已剔除 ${
  (() => { let e = 0; for (const t of types) for (const p of t.properties ?? []) if (p.dataType === "number" && p.unitExempt) e++; return e; })()
} 个诚实豁免）`);
console.log(`  ① 属性口径覆盖率 ${fmt(metrics.propDescription)}  (${withDesc}/${props})   门槛 ${fmt(THRESHOLDS.thresholds.propDescription)}`);
console.log(`  ② 单位覆盖率     ${fmt(metrics.numericUnit)}  (${dimensionalWithUnit}/${dimensional})   门槛 ${fmt(THRESHOLDS.thresholds.numericUnit)}`);
console.log(`  ③ 中文名覆盖率   ${fmt(metrics.propDisplayName)}  (${withDisplay}/${props})   门槛 ${fmt(THRESHOLDS.thresholds.propDisplayName)}`);
console.log(`  ④ 概念定义覆盖率 ${fmt(metrics.typeBusinessDefinition)}  (${typesWithDef}/${types.length})   门槛 ${fmt(THRESHOLDS.thresholds.typeBusinessDefinition)}`);

for (const [k, v] of Object.entries(metrics)) {
  const min = THRESHOLDS.thresholds[k];
  if (typeof min !== "number") { fail.push(`门槛表缺 ${k}`); continue; }
  if (v + 1e-9 < min) fail.push(`覆盖率 ${k} = ${fmt(v)} 低于门槛 ${fmt(min)}（不许倒退）`);
}

const sample = (arr) => arr.slice(0, 8).join(", ") + (arr.length > 8 ? ` …(共 ${arr.length})` : "");
if (missingDesc.length) console.log(`  · 未填口径：${sample(missingDesc)}`);
if (missingUnit.length) console.log(`  · 未填单位（有量纲）：${sample(missingUnit)}`);
if (missingDisplay.length) console.log(`  · 未填中文名：${sample(missingDisplay)}`);

// R13：定义可溯源清单（未溯源不阻断，但必须报出——"填了"不等于"有出处"）
const unsourced = types.filter((t) => t.businessDefinition && !t.businessDefinition.decidedBy).map((t) => t.key);
console.log(`  · 业务定义可溯源 ${typesWithDef - unsourced.length}/${typesWithDef}${unsourced.length ? `（未溯源：${unsourced.join(", ")}）` : ""}`);

if (fail.length) {
  console.error("✗ 本体可读性门未通过：");
  for (const f of fail) console.error("  - " + f);
  process.exit(1);
}
console.log("✓ 本体可读性门通过（四项覆盖率达标 + 核心概念定义齐 + 词表同源 + 单位字典自洽）。");
