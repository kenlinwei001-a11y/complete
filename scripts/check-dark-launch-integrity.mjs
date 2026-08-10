#!/usr/bin/env node
/**
 * `dark-launch:check` —— 守「投放意图」与「代码机制」是否一致。
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 本门于 2026-08-10 **换过判据**（WO-FIX-DARK-LAUNCH-GATE）。旧判据是错的，记账如下。
 *
 * **旧判据**：凡 `defaultOn:false` 的 feature，必须出现在某个 `*_DARK_LAUNCH_FEATURES` 集合里。
 * **形态（铁律 0.6 句式）**：
 *     「我用『是否 `defaultOn:false`』当作『是否暗发』的证据，而前者并不度量后者。」
 *
 * **错在哪**：`defaultOn:false` 底下藏着**四种意图**，形态一模一样：
 *   · dark     暗发 —— 没做完/没验收，任何租户都不该看见
 *   · explicit 显式启用 —— 已完成，但禁止模板顺带开，只能逐租户 override
 *   · tiered   产品分档 —— 已完成，随套餐/行业模板开是**正确**的
 *   · ga       全量 —— 已毕业为默认开
 * 靠「集合成员」不可能分开它们。实测：旧门报的 15 个「违规」**15 个全是误报**
 * （全是 tiered），且它给的修法会造成实际损害 —— 拿 `sim.sandbox` 照做一次：
 *
 *     照门修之前：demo 有效功能 75 个 · 出厂视图可见 14/14
 *     照门修之后：demo 有效功能 63 个 · 出厂视图可见  9/14
 *     丢失出厂视图：chain-line-map · transit-flow · physical-topology · node-inspector · chain-impediments
 *
 * 两个 dev 各自独立顶回来过这道门，他们是对的。全部证据见
 * `docs/AUDIT-dark-launch-vs-tiering.md`。
 *
 * **新判据**：意图**显式声明**在 `scripts/feature-rollout.json`，本门只断言
 * **「你声明的意图」与「代码的机制」是否一致**，不再从形态反推意图。
 * 未声明 = 红（**不猜**——两个方向的默认值都会错，且错法相反，理由见 AUDIT §7.1）。
 * ════════════════════════════════════════════════════════════════════════════
 *
 * 七条断言：
 *   A1 每个 `defaultOn:false` 必须有声明                       （未声明 → 红）
 *   A2 声明的 key 必须真实存在于 registry                       （悬空声明 → 红）
 *   A3 `ga` 必须已把 defaultOn 改成 true                        （毕业没改 → 红）
 *   A4 非 `ga` 的声明必须仍是 defaultOn:false                    （陈旧声明 → 红）
 *   A5 `dark` ⇒ 必须在某个暗发集合里 **且** 出厂种子不得点亮它    （任何模板/租户都不得打开）
 *   A6 `explicit` ⇒ 必须在某个暗发集合里                        （掉出去 = battery all-on 顺带开）
 *   A7 `tiered` ⇒ **不得**在任何暗发集合里                      （进去 = 删出厂视图，见上）
 *   A8 判据自证：`templateFeatures()` 的 battery 短路必须仍是
 *      「`ALL_FEATURE_KEYS` 减去**每一个**暗发集合」            （机制变了 → 红）
 *   A9 抽取器自证：静态抽取 ≡ 运行期真 registry（dist 在时）
 *
 * A6 与 A7 **互为镜像**，这是新门方向正确的原因：不再说「off 的都得进集合」，
 * 而是说「声明与机制必须一致」。旧门只有 A6 的方向，于是把 A7 的那 15 个全判成了违规。
 *
 * ⚠️ 金丝雀与主逻辑**共用同一个 `extract()` 函数对象**（见 §抽取器），不许各抄一份 ——
 *    抄了就是装饰品：改主逻辑时金丝雀拿旧的去测、照样绿。
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(ROOT, "apps/datacore/src/features.ts");
const SEED = resolve(ROOT, "apps/datacore/src/seed.ts");
const MANIFEST = resolve(ROOT, "scripts/feature-rollout.json");
const DIST = resolve(ROOT, "apps/datacore/dist/features.js");

const STAGES = ["dark", "explicit", "tiered", "ga"];
const errors = [];
const fail = (msg) => errors.push(msg);
/** 门自己瞎了 —— 报「工具坏了」，**不许**报「代码干净」。 */
const blind = (msg) => { console.error(`⛔ 门自己瞎了：${msg}\n   这不是「代码干净 / 无违规」，是门没量到东西。`); process.exit(2); };

// ─────────────────────────────────────────────────────────────────────────────
// §抽取器 —— **唯一一份实现**。主逻辑与金丝雀共用这一个函数对象。
// 用花括号配平的字符走查，不用「N 字窗口」正则 —— 后者在本仓真骗过人
// （铁律 0.6 #4：120 字窗口把 `G-NO-FREIGHT-COST` 截成 `-CO`）。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 去掉注释（行注释 + 块注释），保留字符串字面量。
 *
 * ⚠️ 这一步不是洁癖，是被自己的交叉核对逼出来的：本文件里 `defaultOn:false` 在**注释**里
 * 出现了 18 次（「R3 暗发·defaultOn:false·关=404」这类），原始子串计数因此报 48 而走查报 30。
 * 那两个数**测的不是同一件事** —— 正是铁律 0.6 那句「我用 X 当作 Y 的证据，而 X 并不度量 Y」。
 * 先剥注释，两次测量才可比。
 */
function stripComments(text) {
  let out = "", inStr = null, inLine = false, inBlock = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inLine) { if (c === "\n") { inLine = false; out += c; } continue; }
    if (inBlock) { if (c === "*" && n === "/") { inBlock = false; i++; } continue; }
    if (inStr) { out += c; if (c === "\\") { out += n ?? ""; i++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === "/" && n === "/") { inLine = true; i++; continue; }
    if (c === "/" && n === "*") { inBlock = true; i++; continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; out += c; continue; }
    out += c;
  }
  return out;
}

/** 从 idx 起找到第一个 open，返回配平到对应 close 为止的整段（跳过字符串与行注释）。 */
function balancedFrom(text, idx, open, close) {
  const start = text.indexOf(open, idx);
  if (start < 0) return null;
  let depth = 0, inStr = null, inLine = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inLine) { if (c === "\n") inLine = false; continue; }
    if (inStr) { if (c === "\\") { i++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === "/" && n === "/") { inLine = true; i++; continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

/** 切出一段里所有**顶层** {...} 块（同样跳过字符串与行注释）。 */
function topLevelObjects(text) {
  const out = [];
  let depth = 0, startIdx = -1, inStr = null, inLine = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inLine) { if (c === "\n") inLine = false; continue; }
    if (inStr) { if (c === "\\") { i++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === "/" && n === "/") { inLine = true; i++; continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "{") { if (depth === 0) startIdx = i; depth++; }
    else if (c === "}") { depth--; if (depth === 0 && startIdx >= 0) { out.push(text.slice(startIdx, i + 1)); startIdx = -1; } }
  }
  return out;
}

/**
 * 主抽取器。返回 features.ts 的结构化视图。
 * @returns {{entries:{key:string,defaultOn:boolean|null}[], offByDefault:string[],
 *            allKeys:Set<string>, darkSets:Record<string,string[]>, batteryBranch:string|null,
 *            rawFalseCount:number}}
 */
function extract(raw) {
  const text = stripComments(raw); // 先剥注释，下面所有测量才互相可比
  // ① FEATURE_REGISTRY 数组里的顶层对象字面量。
  //    ⚠️ 必须从 `=` 之后开始找 `[` —— 否则会撞上**类型标注**里的 `FeatureDef[]`，
  //    抽出一个空数组、报「0 个 feature」。写这行时就是这么错的，被本文件的金丝雀当场逮住
  //    （`⛔ 门自己瞎了：FEATURE_REGISTRY 抽到 0 个 feature`），而不是被误读成「注册表是空的」。
  const regIdx = text.indexOf("const FEATURE_REGISTRY");
  const regEq = regIdx < 0 ? -1 : text.indexOf("=", regIdx);
  const arr = regEq < 0 ? null : balancedFrom(text, regEq, "[", "]");
  const entries = [];
  for (const chunk of arr ? topLevelObjects(arr) : []) {
    const k = chunk.match(/key:\s*"([^"]+)"/);
    if (!k) continue;
    const d = chunk.match(/defaultOn:\s*(true|false)/);
    entries.push({ key: k[1], defaultOn: d ? d[1] === "true" : null });
  }

  // ② 所有 *_DARK_LAUNCH_FEATURES 集合（名 → 成员）
  const darkSets = {};
  for (const m of text.matchAll(/export const ([A-Z_]*DARK_LAUNCH_FEATURES)\b[^=]*=\s*new Set\(/g)) {
    const body = balancedFrom(text, m.index + m[0].length - 1, "(", ")");
    darkSets[m[1]] = body ? [...body.matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
  }

  // ③ templateFeatures() 的 battery 短路分支（A8 判据自证用）
  const bIdx = text.indexOf('industry === "battery-manufacturing"');
  const batteryBranch = bIdx < 0 ? null : balancedFrom(text, bIdx, "{", "}");

  // ④ 独立的第二次测量：剥注释后的 `defaultOn: false` 子串计数。
  //    与①的花括号走查**机制完全不同** —— 两个数字对不上 ⇒ 走查漏了条目 ⇒ 报「工具坏了」。
  const rawFalseCount = (text.match(/defaultOn:\s*false/g) ?? []).length;

  return {
    stripped: text,
    entries,
    offByDefault: entries.filter((e) => e.defaultOn === false).map((e) => e.key),
    allKeys: new Set(entries.map((e) => e.key)),
    darkSets,
    batteryBranch,
    rawFalseCount,
  };
}

/** 出厂种子点亮表（seed.ts `DEMO_LIGHTUP`）—— A5 用。共用 balancedFrom。 */
function extractSeedLightup(raw) {
  const text = stripComments(raw);
  const i = text.indexOf("const DEMO_LIGHTUP");
  const eq = i < 0 ? -1 : text.indexOf("=", i); // 同上：绕开类型标注
  const body = eq < 0 ? null : balancedFrom(text, eq, "{", "}");
  return body ? new Set([...body.matchAll(/"([^"]+)":\s*true/g)].map((m) => m[1])) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// §载入
// ─────────────────────────────────────────────────────────────────────────────
if (!existsSync(SRC)) blind(`找不到 ${SRC}`);
if (!existsSync(MANIFEST)) blind(`找不到投放声明表 ${MANIFEST}`);
if (!existsSync(SEED)) blind(`找不到 ${SEED}`);

const text = readFileSync(SRC, "utf8");
const model = extract(text); // ← 主逻辑用的就是这一个调用
const seedLit = extractSeedLightup(readFileSync(SEED, "utf8"));

let manifest;
try { manifest = JSON.parse(readFileSync(MANIFEST, "utf8")); }
catch (e) { blind(`投放声明表不是合法 JSON：${e.message}`); }
const declared = manifest.features ?? {};

// 运行期真 registry（dist 在时）—— A9 交叉核对用，并补齐静态走查看不见的条目。
// 静态走查读不到 `...builtInViewFeatureDefs()` 这种**展开调用**产出的 feature（它们不是对象字面量），
// 若不补齐，A2「悬空声明」会对这些 key 误报。dist 不在时明说未验证，不冒充已验证。
let runtime = null;
if (existsSync(DIST)) {
  try {
    const mod = await import(pathToFileURL(DIST).href);
    if (Array.isArray(mod.FEATURE_REGISTRY) && mod.FEATURE_REGISTRY.length > 0) runtime = mod.FEATURE_REGISTRY;
  } catch { /* 下方 runtimeNote 会如实说明「跳过·未验证」 */ }
}
const knownKeys = new Set([...model.allKeys, ...(runtime ?? []).map((f) => f.key)]);

// ─────────────────────────────────────────────────────────────────────────────
// §金丝雀 —— 报任何否定结论之前先自证工具。**共用上面 model 这同一次 extract() 结果**。
// ─────────────────────────────────────────────────────────────────────────────
// 剥注释这一步自己也要自证：别把代码一起吃了
for (const token of ["const FEATURE_REGISTRY", "QOS_DARK_LAUNCH_FEATURES", 'industry === "battery-manufacturing"']) {
  if (!model.stripped.includes(token)) blind(`剥注释后代码里找不到 \`${token}\` —— stripComments 把代码也吃了。`);
}
if (model.entries.length === 0) blind("FEATURE_REGISTRY 抽到 0 个 feature —— 抽取器坏了。");
if (model.offByDefault.length === 0) blind("抽到 0 个 defaultOn:false —— 抽取器坏了。");
if (Object.keys(model.darkSets).length === 0) blind("抽到 0 个 *_DARK_LAUNCH_FEATURES 集合 —— 抽取器坏了。");
if (model.batteryBranch === null) blind("抽不到 templateFeatures() 的 battery 短路分支 —— 抽取器坏了（或该机制已被删，那也必须人来看一眼）。");
if (seedLit === null || seedLit.size === 0) blind("seed.ts 抽到 0 个 DEMO_LIGHTUP 点亮项 —— 抽取器坏了。");
// 独立第二次测量交叉核对（走查 vs 原始子串计数，机制不同）
if (model.offByDefault.length !== model.rawFalseCount) {
  blind(`走查抽到 defaultOn:false ${model.offByDefault.length} 个，但原始子串计数是 ${model.rawFalseCount} 个 —— 两次独立测量对不上，走查漏了条目。`);
}
if (Object.keys(declared).length === 0) blind("投放声明表里 features 为空 —— 读错文件或表被清空了。");

console.log(
  `金丝雀：registry ${model.entries.length} 条 · defaultOn:false ${model.offByDefault.length} 条` +
  `（独立计数亦 ${model.rawFalseCount}）· 暗发集合 ${Object.keys(model.darkSets).length} 个` +
  `（${Object.entries(model.darkSets).map(([n, v]) => `${n}:${v.length}`).join(" ")}）` +
  ` · 种子点亮 ${seedLit.size} 条 · 声明 ${Object.keys(declared).length} 条 ⇒ 抽取器有效`,
);

const inAnyDarkSet = new Set(Object.values(model.darkSets).flat());
const offSet = new Set(model.offByDefault);

// ─────────────────────────────────────────────────────────────────────────────
// §断言
// ─────────────────────────────────────────────────────────────────────────────

// A1 每个 defaultOn:false 必须有声明（不猜默认档）
for (const k of model.offByDefault) {
  if (!declared[k]) {
    fail(`A1 未声明投放意图：${k}\n      → 在 scripts/feature-rollout.json 的 features 里加一条，stage 取 ${STAGES.join("/")}，并写 why。\n      → 本门**不给默认档**：dark 与 tiered 的期望行为相反，猜错任一方向都有害（见 docs/AUDIT-dark-launch-vs-tiering.md §7.1）。`);
  }
}

for (const [key, decl] of Object.entries(declared)) {
  const stage = decl?.stage;
  if (!STAGES.includes(stage)) { fail(`A0 声明的 stage 非法：${key} → ${JSON.stringify(stage)}（合法值：${STAGES.join(" / ")}）`); continue; }
  if (!decl.why || String(decl.why).trim().length < 8) fail(`A0 声明缺 why（判定依据）：${key}`);

  // A2 悬空声明
  if (!knownKeys.has(key)) { fail(`A2 悬空声明：${key} 在 FEATURE_REGISTRY 里不存在 —— feature 删了但声明没删。`); continue; }

  // A3 / A4 声明与 defaultOn 的一致性
  if (stage === "ga" && offSet.has(key)) {
    fail(`A3 声明为 ga（已毕业默认开）但 features.ts 仍是 defaultOn:false：${key}\n      → 二者必须一致：要么把 defaultOn 改 true，要么把 stage 改回 tiered/explicit。`);
  }
  if (stage !== "ga" && !offSet.has(key)) {
    fail(`A4 陈旧声明：${key} 已不是 defaultOn:false，但仍声明为 ${stage}\n      → 若已毕业为默认开，把 stage 改成 ga。`);
  }

  // A5 dark：任何模板都不得打开 + 出厂种子不得点亮
  if (stage === "dark") {
    if (!inAnyDarkSet.has(key)) {
      fail(`A5 声明为 dark（任何租户都不该看见），但**不在任何 *_DARK_LAUNCH_FEATURES 集合里**：${key}\n      → battery 行业模板是「全开减去这些集合」，不在集合里 = 模板会把它打开。\n      → 加进 features.ts 里某个 *_DARK_LAUNCH_FEATURES 集合。`);
    }
    if (seedLit.has(key)) {
      fail(`A5 声明为 dark（任何租户都不该看见），但出厂种子 seed.ts DEMO_LIGHTUP 把它点亮了：${key}\n      → 二者矛盾：要么它其实已完成（改 stage 为 explicit/tiered），要么种子不该点它。`);
    }
  }

  // A6 explicit：必须在暗发集合里（掉出去 = battery all-on 顺带开）
  if (stage === "explicit" && !inAnyDarkSet.has(key)) {
    fail(`A6 声明为 explicit（禁止模板顺带开，只能显式 override），但**不在任何 *_DARK_LAUNCH_FEATURES 集合里**：${key}\n      → battery「all on」会把它顺带打开，与声明相反。加回集合。`);
  }

  // A7 tiered：不得在暗发集合里（镜像断言 —— 守的是旧门推人去犯的那个错）
  if (stage === "tiered" && inAnyDarkSet.has(key)) {
    const which = Object.entries(model.darkSets).filter(([, v]) => v.includes(key)).map(([n]) => n);
    fail(`A7 声明为 tiered（随模板开是正确的），却被塞进了 ${which.join(" / ")}：${key}\n      → 进了排除集 = 行业模板不再打开它。若它有下游 requires，会**级联删掉出厂视图**\n        （实测：sim.sandbox 这么做 → demo 出厂视图 14→9，见 docs/AUDIT-dark-launch-vs-tiering.md §5）。\n      → 要么从集合里拿出来，要么把 stage 改成 explicit 并说明理由。`);
  }
}

// A8 判据自证 —— 本门的 A5/A6/A7 都建立在「battery 模板 = ALL_FEATURE_KEYS 减去每一个暗发集合」
// 这个机制上。机制若变了，上面三条断言就不再度量它们号称度量的东西 ⇒ 必须先红，让人来看。
{
  const b = model.batteryBranch;
  if (!b.includes("ALL_FEATURE_KEYS")) {
    fail(`A8 判据自证失败：templateFeatures() 的 battery 分支不再引用 ALL_FEATURE_KEYS。\n      → 本门 A5/A6/A7 的判据依赖「全开减去暗发集」这个机制，机制变了判据可能失效，请复核本门。`);
  }
  for (const name of Object.keys(model.darkSets)) {
    if (!b.includes(name)) {
      fail(`A8 判据自证失败：暗发集合 ${name} 存在，但 templateFeatures() 的 battery 分支**没有减去它**。\n      → 该集合里的 feature 会被 battery「all on」模板照样打开，集合形同虚设。\n      → 在 features.ts 的 battery 分支里补上 !${name}.has(k)。`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §A9 运行期交叉核对（dist 在时）—— 静态抽取必须 ≡ 真 registry。
//     dist 不在时**明说跳过**，不冒充「已验证」。
// ─────────────────────────────────────────────────────────────────────────────
let runtimeNote = "A9 运行期交叉核对：**跳过**（apps/datacore/dist 未构建或载入失败 —— 未验证，非「已通过」）";
if (runtime) {
  const rtOff = new Set(runtime.filter((f) => f.defaultOn === false).map((f) => f.key));
  const missed = [...rtOff].filter((k) => !offSet.has(k));
  const extra = model.offByDefault.filter((k) => !rtOff.has(k));
  if (missed.length || extra.length) {
    fail(
      `A9 静态抽取与运行期真 registry 不一致：静态漏 ${missed.length} 个（${missed.join(",") || "-"}）· 静态多 ${extra.length} 个（${extra.join(",") || "-"}）\n` +
      `      → 两种可能，**不许挑一个顺眼的信**，先分清：\n` +
      `        ① dist 陈旧：features.ts 改了但没重新 build ⇒ 跑 \`pnpm --filter datacore build\` 再来。\n` +
      `        ② 静态走查坏了：抽取器读漏了条目 ⇒ 本门所有结论作废，先修抽取器。\n` +
      `      判别：\`git status\` 看 features.ts 是否有未构建的改动；有 ⇒ 多半是①。`,
    );
    runtimeNote = "A9 运行期交叉核对：❌ 不一致";
  } else {
    runtimeNote = `A9 运行期交叉核对：✅ 静态 ${offSet.size} ≡ 运行期 ${rtOff.size}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §报告
// ─────────────────────────────────────────────────────────────────────────────
const tally = {};
for (const k of model.offByDefault) { const s = declared[k]?.stage ?? "(未声明)"; tally[s] = (tally[s] ?? 0) + 1; }
console.log(`\n投放意图分布（${model.offByDefault.length} 个 defaultOn:false）：` +
  Object.entries(tally).map(([s, n]) => `${s} ${n}`).join(" · "));
console.log(runtimeNote);

if (errors.length) {
  console.error(`\n❌ dark-launch:check 未通过 —— ${errors.length} 条：\n`);
  for (const e of errors) console.error(`   ${e}\n`);
  console.error("判据说明见本脚本头注与 docs/AUDIT-dark-launch-vs-tiering.md。");
  process.exit(1);
}
console.log("\n✅ dark-launch:check 通过：投放意图声明与代码机制一致。");
