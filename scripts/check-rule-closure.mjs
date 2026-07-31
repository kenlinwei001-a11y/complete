#!/usr/bin/env node
/**
 * 门 `rule-closure:check`（PRD-rules-as-references §6.1 · WO-66-RULES-FIRST-CLASS P2 升级）：
 * 规则**引用闭包**——引用侧的每个 ruleKey 都必须在规则库里有定义（含 params），否则前端显
 * "（当前库中未找到定义）"、规则闸空过、`coeff()` 恒走兜底（= 死代码，测试还全绿）。
 *
 * ── 本门此前的四个盲区（台账 `docs/rule-threshold-ledger.md` §5.3 查明），P2 逐条堵上 ──
 *   ① 正则只认 `"Cxx"` → **命名 ruleKey**（`gap_attribution_coeffs` 那批）完全不在视野：
 *      6 条规则被求解器读取却从未播种，门全绿。→ 段 B：命名 ruleKey 闭包。
 *   ② 不校验 `params` 有无 → 规则播种了但 params 空、求解器照样走兜底。→ 段 C：params 非空断言。
 *   ③ 不校验 `extended.ts` 返回体里的**第二份** `ruleRefs` 数组（12 处）。→ 段 D。
 *   ④ **不校验数据侧绑定**（P2 目标）：绑定表才是运行期真相源，业务方绑一个不存在的规则键门不会红。
 *      → 段 E：数据侧绑定闭包（种子物化路径 + 双向校验 ruleKey ∈ 定义 ∧ solverKey ∈ SOLVER_KEYS）。
 *
 * 静态读源（与 boundary-singlesource:check 同范式，不起服务不查库）：
 *   - 定义集 = `battery.ts` 模板 rules[]（出厂即 PUBLISHED 播种，规则库单一来源）。
 *   - 引用集 = `contracts SOLVER_RULE_REFS`（出厂 seed）∪ `scenarios-catalog.ts` 卡 rules
 *             ∪ 求解器源码里经唯一入口 `rp.num("<ruleKey>", "<paramKey>", …)` 声明的引用
 *             ∪ `extended.ts` 返回体的第二份 ruleRefs。
 *   - 绑定集 = 种子物化路径（`synthetic/service.ts seedSolverRuleBindings` 把 SOLVER_RULE_REFS 写成
 *             `SolverRuleBinding` 行）→ 故绑定闭包 ⊇ SOLVER_RULE_REFS 闭包，且双向校验 solverKey。
 * 仅匹配带引号的 "Cxx"，避开颜色码 #4C90F0 等误报（PRD 附录已注 C90 系误报）。
 */
import { readFileSync } from "node:fs";

const read = (rel) => {
  try {
    return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
  } catch {
    console.error(`✗ rule-closure:check 读不到 ${rel}`);
    process.exit(1);
  }
};

const errors = [];

// ─────────────────────────────────────────────────────────────────────────────
// 定义集：battery.ts 规则定义（`{ key: "…", name: … }`）。key 现含 Cxx **与命名系数规则**。
// ─────────────────────────────────────────────────────────────────────────────
const batterySrc = read("apps/datacore/src/synthetic/battery.ts");
const ruleBlock = batterySrc.match(/\n  rules:\s*\[([\s\S]*?)\n  \],\n/);
if (!ruleBlock) {
  console.error("✗ rule-closure:check：battery.ts 里定位不到 rules[] 块（结构漂移）。");
  process.exit(1);
}
/**
 * ruleKey → 该条定义的**完整原文**（用于 params 断言）。
 * 花括号配平扫描而非按行正则 —— 规则条目可跨多行（新增的系数规则 params 就是多行），
 * 按行截断会把 params 整段看丢 → 误报"params 为空"。
 */
const defs = new Map();
{
  const body = ruleBlock[1];
  const startRe = /\{\s*key:\s*"([A-Za-z0-9_]+)",\s*name:/g;
  let m;
  while ((m = startRe.exec(body)) !== null) {
    let depth = 0;
    let i = m.index;
    for (; i < body.length; i++) {
      if (body[i] === "{") depth++;
      else if (body[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    defs.set(m[1], body.slice(m.index, i + 1));
  }
}
const defined = new Set(defs.keys());
const definedCodes = new Set([...defined].filter((k) => /^C\d+$/.test(k)));

// ─────────────────────────────────────────────────────────────────────────────
// 段 A（原有）：Cxx 码闭包 —— SOLVER_RULE_REFS ∪ 场景卡。
// ─────────────────────────────────────────────────────────────────────────────
const contractsSrc = read("packages/contracts/src/datacore.ts");
const refBlock = contractsSrc.match(/SOLVER_RULE_REFS[^{]*\{([\s\S]*?)\n\};/);
if (!refBlock) {
  console.error("✗ rule-closure:check：contracts 里定位不到 SOLVER_RULE_REFS 块（结构漂移）。");
  process.exit(1);
}
const solverRefs = new Set([...refBlock[1].matchAll(/"(C\d+)"/g)].map((m) => m[1]));
/** solverKey → [ruleKey…]（出厂 seed，也是种子物化成绑定行的来源）。 */
const seedBindings = new Map();
for (const m of refBlock[1].matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
  seedBindings.set(m[1], [...m[2].matchAll(/"([A-Za-z0-9_]+)"/g)].map((x) => x[1]));
}

const catalogSrc = read("apps/agentcore/src/scenarios-catalog.ts");
const cardRefs = new Set([...catalogSrc.matchAll(/"(C\d+)"/g)].map((m) => m[1]));

const referencedCodes = new Set([...solverRefs, ...cardRefs]);
const missingCodes = [...referencedCodes].filter((k) => !definedCodes.has(k)).sort();
if (missingCodes.length > 0) {
  errors.push(
    `[A] 被引用但未定义的规则码（致前端"未找到定义"/规则闸空过）：${missingCodes.join(", ")}\n` +
      `    → 在 battery.ts rules[] 补齐定义（含 expression/severity/params），或修正引用。`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 段 B（P2 新增 · 堵盲区①）：**命名 ruleKey 闭包**。
// 求解器经唯一入口 `rp.num("<ruleKey>", "<paramKey>", <dflt>)` / `rp.scoped("<ruleKey>")` 声明的引用，
// 必须在 battery.ts 里有一等定义 —— 否则就是「读规则但规则从不存在 → coeff() 恒走兜底」的死代码
// （这正是本单 ☠ 头号发现：6 条 `*_coeffs` 规则从未播种，两道旧门都抓不到）。
// ─────────────────────────────────────────────────────────────────────────────
const SOLVER_FILES = [
  "apps/datacore/src/solvers/service.ts",
  "apps/datacore/src/solvers/extended.ts",
  "apps/datacore/src/solvers/risk.ts",
  "apps/datacore/src/solvers/capex.ts",
  "apps/datacore/src/solvers/capacity.ts",
  "apps/datacore/src/solvers/portfolio.ts",
  "apps/datacore/src/solvers/base-outlook.ts",
  "apps/datacore/src/solvers/sop-reschedule.ts",
  "apps/datacore/src/solvers/plan.ts",
];
/** ruleKey → Set(paramKey)（引用侧声明的 param 名，用于段 C 精确断言）。 */
const namedRefs = new Map();
const addRef = (rk, pk) => {
  if (!namedRefs.has(rk)) namedRefs.set(rk, new Set());
  if (pk) namedRefs.get(rk).add(pk);
};
for (const rel of SOLVER_FILES) {
  const src = read(rel);
  for (const m of src.matchAll(/\brp\w*\.num\(\s*"([A-Za-z0-9_]+)"\s*,\s*"([A-Za-z0-9_]+)"/g)) addRef(m[1], m[2]);
  for (const m of src.matchAll(/\.scoped\(\s*"([A-Za-z0-9_]+)"\s*\)/g)) addRef(m[1], null);
  // service.ts 里仍以整条 params 消费的命名规则（metric_causal_binding / trigger_thresholds）。
  for (const m of src.matchAll(/r\.key === "([a-z_]+)"/g)) addRef(m[1], null);
}
const missingNamed = [...namedRefs.keys()].filter((k) => !defined.has(k)).sort();
if (missingNamed.length > 0) {
  errors.push(
    `[B] 求解器读取但规则库**从未定义/从未播种**的命名 ruleKey：${missingNamed.join(", ")}\n` +
      `    → 这类洞的症状是「架构上可校准、运行时是死代码」，且相关测试会因自己先建规则而全绿。\n` +
      `    → 在 battery.ts rules[] 补齐定义 + params（值 = 代码内联兜底，保 R6 锚不动），并在 BATTERY_RULE_SCOPES 给 []。`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 段 C（P2 新增 · 堵盲区②）：**params 非空 + 引用的 paramKey 真存在**。
// 「规则播种了但 params 空、求解器仍走兜底」= 段 B 修完还会留下的第二个坑。
// 诚实豁免：显式登记的「按需配置」规则（无出厂默认，缺省即正常语义）。
// ─────────────────────────────────────────────────────────────────────────────
const PARAMS_OPTIONAL = new Set([
  "metric_causal_binding", // 每租户的指标→因果根绑定，无出厂默认；缺省 = 走通用因果遍历
  "trigger_thresholds", // 缺省 = 不覆盖 TriggerRule 自带 threshold（decision_play 已诚实透 thresholdSource）
  "C01", "C10", // 无阈值型规则（纯谓词）
]);
const emptyParams = [];
const missingParamKeys = [];
for (const [rk, pks] of [...namedRefs.entries()].sort()) {
  const def = defs.get(rk);
  if (!def) continue; // 段 B 已报
  const pi = def.indexOf("params:");
  let body = "";
  if (pi >= 0) {
    const open = def.indexOf("{", pi);
    let depth = 0;
    let j = open;
    for (; j < def.length; j++) {
      if (def[j] === "{") depth++;
      else if (def[j] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    body = def.slice(open + 1, j).trim();
  }
  if (!body && !PARAMS_OPTIONAL.has(rk)) {
    emptyParams.push(rk);
    continue;
  }
  for (const pk of [...pks].sort()) {
    if (body && !new RegExp(`\\b${pk}\\s*:`).test(body)) missingParamKeys.push(`${rk}.${pk}`);
  }
}
if (emptyParams.length > 0) {
  errors.push(
    `[C1] 被求解器读取、但规则定义的 params 为空的规则：${emptyParams.join(", ")}\n` +
      `    → 空 params ≡ 没播种：求解器恒走代码兜底，"改规则即改推演"不成立。`,
  );
}
if (missingParamKeys.length > 0) {
  errors.push(
    `[C2] 求解器读取的 param 在规则定义里不存在（该阈值恒走代码兜底）：${missingParamKeys.join(", ")}\n` +
      `    → 补进 battery.ts 对应规则的 params（值 = 代码内联兜底，保 R6 锚不动）；\n` +
      `      若确属"无出厂默认·按需配置"，登记进本门的 PARAMS_OPTIONAL 并写理由（诚实豁免，不许默默放过）。`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 段 D（P2 新增 · 堵盲区③）：`extended.ts` 返回体里的**第二份** ruleRefs 数组。
// 它与 contracts 的 SOLVER_RULE_REFS 构成"同一概念两套"；不在 SOLVER_RULE_REFS 里的求解器
// （如 countermeasure_combo）自称引用 C08/C23/C29 却永不被 evaluateRuleRefs 评估 = 装饰标签。
// ─────────────────────────────────────────────────────────────────────────────
const extendedSrc = read("apps/datacore/src/solvers/extended.ts");
const inlineRefCodes = new Set(
  [...extendedSrc.matchAll(/ruleRefs:\s*\[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/"(C\d+)"/g)].map((x) => x[1])),
);
const inlineUndefined = [...inlineRefCodes].filter((k) => !definedCodes.has(k)).sort();
if (inlineUndefined.length > 0) {
  errors.push(`[D] extended.ts 返回体 ruleRefs 里引用了未定义的规则码：${inlineUndefined.join(", ")}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 段 E（P2 新增 · 堵盲区④ = 本单目标）：**数据侧绑定闭包 + 双向校验**。
// 运行期真相源已从 contracts 常量迁到 `SolverRuleBinding` 表；种子物化路径见
// `synthetic/service.ts seedSolverRuleBindings`（SOLVER_RULE_REFS → 绑定行）。故此处校验：
//   ① 每条绑定的 ruleKey 有一等定义（否则业务方绑一个不存在的规则键，门不会红 —— 就是本段要堵的）；
//   ② 每条绑定的 solverKey ∈ SOLVER_KEYS（否则绑到一个不存在的求解器上，永不评估）；
//   ③ 物化路径确实存在（seedSolverRuleBindings 在种子里被调用），否则绑定表恒空 → 永远回落常量。
// ─────────────────────────────────────────────────────────────────────────────
const synthSrc = read("apps/datacore/src/synthetic/service.ts");
if (!/seedSolverRuleBindings\(ctx\)/.test(synthSrc) || !/SOLVER_RULE_REFS/.test(synthSrc)) {
  errors.push(
    `[E0] 绑定表**物化路径缺失**：synthetic/service.ts 未由 SOLVER_RULE_REFS 播种 SolverRuleBinding。\n` +
      `    → 绑定表恒空 → 运行期永远回落出厂常量 → "改绑定即改评估面"（G-10 验收语义）不成立。`,
  );
}
const solverServiceSrc = read("apps/datacore/src/solvers/service.ts");
if (!/solverRuleBindings\.list\(/.test(solverServiceSrc)) {
  errors.push(
    `[E0b] 运行期**未读绑定表**：solvers/service.ts 没有 solverRuleBindings.list(...)。\n` +
      `    → 评估面又退回编译期常量（G-10 断点回潮）。`,
  );
}
const solverKeysBlock = solverServiceSrc.match(/SOLVER_KEYS\s*=\s*\[([\s\S]*?)\]\s*as const/);
const solverKeys = new Set(solverKeysBlock ? [...solverKeysBlock[1].matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]) : []);
// 门自检钩子（S4）：注入一条绑定，验证本段真会红 —— 否则「门存在」只是摆设。
// 形如 `WO66_INJECT_BINDING=inventory_optimize:C999`（仅测试用；生产运行不设此变量即完全无影响）。
const inject = process.env.WO66_INJECT_BINDING;
if (inject) {
  const [sk, rk] = inject.split(":");
  seedBindings.set(sk, [...(seedBindings.get(sk) ?? []), rk]);
}
let bindingRuleMissing = [];
let bindingSolverMissing = [];
for (const [sk, rks] of [...seedBindings.entries()].sort()) {
  if (solverKeys.size > 0 && !solverKeys.has(sk)) bindingSolverMissing.push(sk);
  for (const rk of rks) if (!defined.has(rk)) bindingRuleMissing.push(`${sk}→${rk}`);
}
if (bindingRuleMissing.length > 0) {
  errors.push(`[E1] 绑定的 ruleKey 无一等定义：${bindingRuleMissing.sort().join(", ")}`);
}
if (bindingSolverMissing.length > 0) {
  errors.push(
    `[E2] 绑定的 solverKey 不在 SOLVER_KEYS（该绑定永不被评估）：${bindingSolverMissing.sort().join(", ")}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(
  `· rule-closure：定义 ${defined.size}（Cxx ${definedCodes.size} + 命名 ${defined.size - definedCodes.size}）` +
    ` · Cxx 引用 ${referencedCodes.size}（SOLVER_RULE_REFS ${solverRefs.size} ∪ 卡 ${cardRefs.size}）` +
    ` · 命名 ruleKey 引用 ${namedRefs.size} · 绑定 seed ${seedBindings.size} 求解器/${[...seedBindings.values()].reduce((a, v) => a + v.length, 0)} 条`,
);

if (errors.length > 0) {
  for (const e of errors) console.error(`✗ rule-closure:check ${e}`);
  process.exit(1);
}
console.log(
  "✓ rule-closure:check：Cxx 闭包 + 命名 ruleKey 闭包 + params 非空/键存在 + extended 第二份 ruleRefs + 数据侧绑定双向校验 全通过。",
);
