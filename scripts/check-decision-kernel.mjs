#!/usr/bin/env node
/**
 * 门 `decision-kernel:check`（L2 决策内核 · KILL-MOCK-RED · R6 确定性地板 · PRD-L2 §7）：
 * 守决策制品 DecisionPackage「每数字有 provId · 方案键∈真求解器 · 反事实引擎∈白名单 ·
 * 热路径无 Math.random/Date.now · R6 双跑字节一致 · entitlement 注册 · env 暗发闸」。
 * 本体登记见 docs/SYSTEM-ONTOLOGY.md §7（门）/ §8（G-2/G-3）。
 *
 * 静态哨兵（有牙齿）：
 *  1) kernel/契约存在：kernel.ts 有 assembleDecisionPackage/validateDecisionPackage；契约有 DecisionPackageSchema。
 *  2) 热路径无非确定来源：kernel.ts 去注释后无 Math.random / Date.now / new Date（破 R6）。
 *  3) prov 确定性：kernel.ts 铸 prov 用 hashString(canonicalJson)（非 ULID newId）。
 *  4) 白名单钉死：SCENARIO_SOLVER_KEYS/CF_ENGINES 常量存在且与契约 CfEngine 对齐。
 *  5) 暗发双闸：datacore config.ts 有 QOS_DECISION_KERNEL；features.ts 有 decision.kernel（defaultOn:false）。
 *  6) migration down：若已建 decision_packages 迁移文件，必带 DOWN（可回退·RL9）。
 *
 * 动态测谎（真跑·经已构 dist）：
 *  7) 真组一份 DecisionPackage（喂真求解器形状 fixture）→ validateDecisionPackage 零违例（green）；
 *  8) 注入幽灵方案 / 无 provId 数字 / 越白名单引擎 → validateDecisionPackage 必报（red·证门有牙）；
 *  9) R6：同输入双跑 → 整包 JSON 字节一致。
 *
 * 用法：node scripts/check-decision-kernel.mjs
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";

const root = new URL("../", import.meta.url);
const abs = (rel) => new URL(rel, root);
const read = (rel) => (existsSync(abs(rel)) ? readFileSync(abs(rel), "utf8") : null);
const stripComments = (s) => s.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const fail = [];

// ── 1) kernel/契约存在 ───────────────────────────────────────────────────────
const kernelSrc = read("apps/datacore/src/decision/kernel.ts");
if (kernelSrc == null) {
  fail.push("缺 apps/datacore/src/decision/kernel.ts");
} else {
  const code = stripComments(kernelSrc);
  for (const sym of ["assembleDecisionPackage", "validateDecisionPackage", "buildReasoning", "buildCounterfactuals"]) {
    if (!new RegExp(`function\\s+${sym}\\b`).test(code)) fail.push(`kernel.ts 缺 ${sym}`);
  }
  // ── 2) 热路径无非确定来源 ─────────────────────────────────────────────────
  if (/Math\.random\s*\(/.test(code)) fail.push("kernel.ts 出现 Math.random（破 R6）");
  if (/Date\.now\s*\(/.test(code)) fail.push("kernel.ts 出现 Date.now（破 R6）");
  if (/new\s+Date\s*\(/.test(code)) fail.push("kernel.ts 出现 new Date（破 R6·generatedAt 必注入）");
  // ── 3) prov 确定性 ─────────────────────────────────────────────────────────
  if (!/hashString\s*\(\s*canonicalJson/.test(code)) fail.push("kernel.ts prov id 未用 hashString(canonicalJson)（确定性铸造缺失）");
  if (/newId\s*\(\s*["']prov/.test(code)) fail.push("kernel.ts 用 newId('prov')（ULID 时+随机·破 R6）");
  // ── 4) 白名单钉死 ──────────────────────────────────────────────────────────
  if (!/SCENARIO_SOLVER_KEYS\s*=/.test(code)) fail.push("kernel.ts 缺 SCENARIO_SOLVER_KEYS 白名单");
  if (!/CF_ENGINES\s*=/.test(code)) fail.push("kernel.ts 缺 CF_ENGINES 白名单");
}

const contractSrc = read("packages/contracts/src/decision-kernel.ts");
if (contractSrc == null) {
  fail.push("缺 packages/contracts/src/decision-kernel.ts");
} else {
  for (const sym of ["DecisionPackageSchema", "CounterfactualResultSchema", "ReasoningTraceSchema", "ExplanationChainSchema", "DecisionScenarioSchema"]) {
    if (!contractSrc.includes(sym)) fail.push(`decision-kernel.ts 缺 ${sym}`);
  }
  // CfEngine 白名单与 kernel 常量对齐
  const cfEnum = contractSrc.match(/CfEngineSchema\s*=\s*z\.enum\(\[([^\]]*)\]/);
  const engines = cfEnum ? cfEnum[1].match(/"[^"]+"/g)?.map((s) => s.slice(1, -1)) ?? [] : [];
  for (const e of ["counterfactual_timeline", "generic_inference", "sim_compare", "monte_carlo"]) {
    if (!engines.includes(e)) fail.push(`CfEngineSchema 缺引擎 ${e}`);
  }
}

// ── 5) 暗发双闸 ──────────────────────────────────────────────────────────────
const config = read("apps/datacore/src/config.ts");
if (config == null || !/QOS_DECISION_KERNEL\s*:/.test(config)) fail.push("datacore config.ts 缺 QOS_DECISION_KERNEL（暗发 env 闸）");
const features = read("apps/datacore/src/features.ts");
if (features == null) {
  fail.push("缺 datacore features.ts");
} else {
  const m = features.match(/key:\s*"decision\.kernel"[^}]*}/);
  if (!m) fail.push("features.ts 缺 decision.kernel（entitlement 未注册·触未注册键恒真陷阱）");
  else if (!/defaultOn:\s*false/.test(m[0])) fail.push("decision.kernel 必 defaultOn:false（暗发·RL2）");
}

// ── 6) migration down（若已建 decision_packages 迁移·WO-L2-4 后生效）────────────
try {
  const migDir = "apps/datacore/migrations";
  if (existsSync(abs(migDir))) {
    for (const f of readdirSync(abs(migDir))) {
      if (!f.endsWith(".sql")) continue;
      const sql = read(`${migDir}/${f}`) ?? "";
      if (/decision_packages/i.test(sql) && !/--\s*down|DROP\s+TABLE[^;]*decision_packages/i.test(sql)) {
        fail.push(`迁移 ${f} 建 decision_packages 但无 DOWN（不可回退·破 RL9）`);
      }
    }
  }
} catch { /* 迁移目录缺席时跳过 */ }

// ── 7-9) 动态测谎（经已构 dist·真跑）─────────────────────────────────────────
async function dynamic() {
  const kernelDist = abs("apps/datacore/dist/decision/kernel.js");
  if (!existsSync(kernelDist)) {
    fail.push("apps/datacore/dist/decision/kernel.js 未构建（先 pnpm -r build·gates 内已含）——跳过动态测谎");
    return;
  }
  const k = await import(kernelDist.href);
  const req = {
    taskId: "gate_task", tenantId: "demo", query: "gate check", intentKey: "risk_affected_orders",
    slots: { baseId: "BASE_CZ", base: "常州", factor: "capacity_drop", horizon: 30 },
    requirementGraphId: null, executionPlanId: null, generatedAt: "2026-07-11T00:00:00.000Z", builderVersion: "gate@1",
  };
  const wid = {
    base: "BASE_CZ",
    displacedOrders: [{ so: "SO-1", cust: "A", pri: "高", qty: 100, marginPct: 0.3, displaceDays: 4, penaltyWan: 5, reScheme: "延期", reSchemes: ["延期"] }],
    totalDisplaced: 1,
    schemes: [
      { key: "delay", name: "延期", feasible: true, displacedCount: 1, promiseDeltaDays: 4, marginPct: 0.30, outsourceRatio: 0, penaltyTotalWan: 5, cashOccupiedWan: 20, note: "" },
      { key: "outsource", name: "外协", feasible: true, displacedCount: 0, promiseDeltaDays: 1, marginPct: 0.25, outsourceRatio: 0.3, penaltyTotalWan: 2, cashOccupiedWan: 30, note: "" },
    ],
    recommended: "delay", dataMode: "LIVE",
  };
  const mpc = { matrix: [{ key: "delay", marginPct: 0.3 }, { key: "outsource", marginPct: 0.25 }], recommendedKey: "delay", dims: [], comparedCount: 2, note: "", dataMode: "LIVE" };
  const ct = { baselineSeries: [10, 20, 40], mitigatedSeries: [10, 15, 22], threshold: 30, factor: "capacity_drop", base: "常州", mitigation: "跨基地", delta: { peakCut: 18, crossDelayDays: 2, ordersSaved: 3 }, events: [], summary: "" };
  const deps = {
    invokeSolver: async (key) => {
      if (key === "what_if_displacement") return { ...wid };
      if (key === "multi_plan_compare") return { ...mpc };
      if (key === "counterfactual_timeline") return { ...ct };
      if (key === "affected_orders") return { problems: [], rows: [], affected: [] };
      if (key === "plan_rootcause") return { kpis: [], dag: { nodes: [], edges: [] } };
      throw new Error(`unexpected ${key}`);
    },
  };
  const pkg = await k.assembleDecisionPackage(deps, req);

  // 7) green
  const v0 = k.validateDecisionPackage(pkg);
  if (v0.length > 0) fail.push(`真 kernel 输出非干净（应零违例）：${v0.join(" / ")}`);

  // 8) red（注入坏值必被抓）
  const inject = [
    (p) => { p.scenarios.push({ key: "ghost", name: "x", sourceSolverKey: "handwritten", metrics: { deliveryRate: 0.9, grossMarginPct: null, costDelta: null, carbonDelta: null, displacedCount: null, cashOccupied: null, riskLevel: null }, feasible: true, hardViolations: [], affectedOrders: [], proposedActionDraftPayload: null, provIds: [] }); return "幽灵方案"; },
    (p) => { p.scenarios[0].provIds = []; return "无 provId 数字"; },
    (p) => { p.counterfactuals[0].engine = "handrolled"; return "越白名单引擎"; },
    (p) => { p.recommendation.recommendedKey = "nope"; return "幽灵推荐"; },
  ];
  for (const mut of inject) {
    const clone = JSON.parse(JSON.stringify(pkg));
    const label = mut(clone);
    if (k.validateDecisionPackage(clone).length === 0) fail.push(`测谎失效：注入「${label}」未被 validateDecisionPackage 抓（门无牙）`);
  }

  // 9) R6 双跑字节一致
  const p2 = await k.assembleDecisionPackage(deps, req);
  if (JSON.stringify(pkg) !== JSON.stringify(p2)) fail.push("R6 违例：同输入双跑 DecisionPackage 非字节一致");
}

await dynamic();

if (fail.length) {
  console.error("✗ decision-kernel:check 失败：");
  for (const f of fail) console.error("  - " + f);
  process.exit(1);
}
console.log("✓ decision-kernel:check 通过（KILL-MOCK 有牙 · R6 确定性 · 暗发双闸 · 白名单钉死）");
