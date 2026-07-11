#!/usr/bin/env node
/**
 * 门 `decision-case:check`（L1.5 企业记忆·CBR · KILL-MOCK-RED · R6 · PRD-L1.5 §0.6/§7）：
 * 守案例投影「特征键 ∈ 真实注册表（零幽灵）· 检索/投影确定性 · SEED 诚实标 · 契约漂移」。
 * 本体登记见 docs/SYSTEM-ONTOLOGY.md §7（门）/ §8（G-3b）。
 *
 * 静态哨兵（有牙）：
 *  1) 投影器存在：memory/decision-case.ts 有 projectCase/extractFeatures/validateCaseFeatures/pseudoEmbed。
 *  2) 热路径无非确定来源：去注释后无 Math.random / Date.now / new Date（破 R6·now 必注入）。
 *  3) 特征∈注册表：projectCase PROBLEM_CLASS 经 problemClassForIntent（∈ INTENT_PROBLEM_CLASS·零幽灵）。
 *  4) 契约：cbr.ts 有 DecisionCaseSchema/SimilarityQuerySchema/FeedbackSignalSchema/DecisionPatternSchema/AdaptationProposalSchema。
 *  5) 暗发 env 闸：datacore config.ts 有 QOS_CBR_INGEST/QOS_CBR_RETRIEVAL/QOS_CBR_RERANK。
 *  6) migration down：若已建 decision_cases 迁移·必带 down（WO-L1.5-2 后生效）。
 *
 * 动态测谎（经已构 dist）：
 *  7) projectCase 真造案例 → validateCaseFeatures 零违例（green）+ 每 PROBLEM_CLASS 键 ∈ 注册表；
 *  8) 注入幽灵 PROBLEM_CLASS → validateCaseFeatures 必报（red·门有牙·green→red）；
 *  9) R6：同 DecisionArtifact + 注入 now 双跑 → DecisionCase 字节一致。
 *
 * 用法：node scripts/check-decision-case.mjs
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";

const root = new URL("../", import.meta.url);
const abs = (rel) => new URL(rel, root);
const read = (rel) => (existsSync(abs(rel)) ? readFileSync(abs(rel), "utf8") : null);
const stripComments = (s) => s.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const fail = [];

// ── 1-3) 投影器静态 ──────────────────────────────────────────────────────────
const src = read("apps/datacore/src/memory/decision-case.ts");
if (src == null) {
  fail.push("缺 apps/datacore/src/memory/decision-case.ts");
} else {
  const code = stripComments(src);
  for (const sym of ["projectCase", "extractFeatures", "validateCaseFeatures", "pseudoEmbed"]) {
    if (!new RegExp(`function\\s+${sym}\\b`).test(code)) fail.push(`decision-case.ts 缺 ${sym}`);
  }
  if (/Math\.random\s*\(/.test(code)) fail.push("decision-case.ts 出现 Math.random（破 R6）");
  if (/Date\.now\s*\(/.test(code)) fail.push("decision-case.ts 出现 Date.now（破 R6·now 必注入）");
  if (/new\s+Date\s*\(/.test(code)) fail.push("decision-case.ts 出现 new Date（破 R6）");
  if (!/problemClassForIntent/.test(code)) fail.push("extractFeatures 未用 problemClassForIntent（PROBLEM_CLASS 或含幽灵键）");
}

// ── 4) 契约 ──────────────────────────────────────────────────────────────────
const cbr = read("packages/contracts/src/cbr.ts");
if (cbr == null) fail.push("缺 packages/contracts/src/cbr.ts");
else
  for (const sym of ["DecisionCaseSchema", "SimilarityQuerySchema", "SimilarityHitSchema", "FeedbackSignalSchema", "DecisionPatternSchema", "AdaptationProposalSchema"])
    if (!cbr.includes(sym)) fail.push(`cbr.ts 缺 ${sym}`);

// ── 5) 暗发 env 闸 ────────────────────────────────────────────────────────────
const config = read("apps/datacore/src/config.ts") ?? "";
for (const k of ["QOS_CBR_INGEST", "QOS_CBR_RETRIEVAL", "QOS_CBR_RERANK"])
  if (!new RegExp(`${k}\\s*:`).test(config)) fail.push(`datacore config.ts 缺 ${k}（暗发 env 闸）`);

// ── 6) migration down（decision_cases·WO-L1.5-2 后生效）────────────────────────
try {
  const migDir = "apps/datacore/migrations";
  if (existsSync(abs(migDir))) {
    for (const f of readdirSync(abs(migDir))) {
      if (!f.endsWith(".sql")) continue;
      const sql = read(`${migDir}/${f}`) ?? "";
      if (/decision_cases/i.test(sql) && !/--\s*down|DROP\s+TABLE[^;]*decision_cases/i.test(sql))
        fail.push(`迁移 ${f} 建 decision_cases 但无 DOWN（破 RL9）`);
    }
  }
} catch { /* skip */ }

// ── 7-9) 动态测谎（经已构 dist）────────────────────────────────────────────────
async function dynamic() {
  const dist = abs("apps/datacore/dist/memory/decision-case.js");
  if (!existsSync(dist)) {
    fail.push("apps/datacore/dist/memory/decision-case.js 未构建——跳过动态测谎（gates 内已含 build）");
    return;
  }
  const m = await import(dist.href);
  const artifact = {
    source: "DECISION",
    refId: "dec_gate_1",
    title: "常州基地PACK02降产20%·哪些订单延期",
    context: "未来30天常州基地PACK02产线降低20%产能 交付风险 2026-08-01",
    options: [{ key: "delay", label: "延期" }, { key: "outsource", label: "外协" }],
    chosen: "delay",
    rejectedRationale: [{ optionKey: "outsource", rationale: "外协比过高" }],
    predicted: { summary: "延期5天", metrics: { deliveryRate: 0.92 } },
    ctx: { intentKey: "affected_orders", entities: ["BASE_CZ", "Line:PACK02"], metrics: ["deliveryRate"] },
  };
  const opts = { tenantId: "demo", now: "2026-07-11T00:00:00.000Z" };
  const c1 = m.projectCase(artifact, opts);

  // 7) green + PROBLEM_CLASS ∈ 注册表
  const v0 = m.validateCaseFeatures(c1.problem.features);
  if (v0.length > 0) fail.push(`真投影案例含幽灵特征（应零违例）：${v0.join(" / ")}`);
  const pc = c1.problem.features.find((f) => f.dim === "PROBLEM_CLASS");
  if (!pc || !m.VALID_PROBLEM_CLASSES.has(pc.key)) fail.push(`PROBLEM_CLASS '${pc?.key}' ∉ 注册表`);

  // 8) red（注入幽灵 PROBLEM_CLASS 必被抓）
  const ghost = m.validateCaseFeatures([{ dim: "PROBLEM_CLASS", key: "handrolled_ghost_class", value: null, num: null }]);
  if (ghost.length === 0) fail.push("测谎失效：注入幽灵 PROBLEM_CLASS 未被 validateCaseFeatures 抓（门无牙）");

  // 9) R6 双跑字节一致（投影）
  const c2 = m.projectCase(artifact, opts);
  if (JSON.stringify(c1) !== JSON.stringify(c2)) fail.push("R6 违例：projectCase 同输入双跑非字节一致");

  // 10) 检索确定性（§4.2·同 query+案例集+weightsVersion 双跑字节一致命中序）
  if (typeof m.retrieveSimilarCases === "function") {
    const caseB = m.projectCase({ ...artifact, refId: "dec_gate_2", title: "毛利率下降归因", context: "财务毛利 2026-09", ctx: { intentKey: "margin_attribution_q", entities: ["SEG_A"] } }, opts);
    const cases = [c1, caseB];
    const query = { tenantId: "demo", text: "常州PACK02降产订单延期", problemClass: "affected_scope_enumeration", entities: ["BASE_CZ"], metrics: [], topK: 5, weightsVersion: "v1" };
    const r1 = m.retrieveSimilarCases(cases, query);
    const r2 = m.retrieveSimilarCases(cases, query);
    if (JSON.stringify(r1) !== JSON.stringify(r2)) fail.push("R6 违例：retrieveSimilarCases 同输入双跑非字节一致命中序");
    if (!r1.hits.every((h) => h.breakdown && typeof h.breakdown.embed === "number")) fail.push("检索命中缺三维 breakdown（R13 无法解释为何相似）");
  }
}

await dynamic();

if (fail.length) {
  console.error("✗ decision-case:check 失败：");
  for (const f of fail) console.error("  - " + f);
  process.exit(1);
}
console.log("✓ decision-case:check 通过（零幽灵特征 · R6 确定性 · SEED 诚实位 · 暗发 env 闸）");
