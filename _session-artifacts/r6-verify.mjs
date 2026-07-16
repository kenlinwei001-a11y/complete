// Independent R6 determinism + retrieval harness against BUILT dist (no mocks of the module itself).
import * as M from "/home/user/complete/.claude/worktrees/agent-ae5ccd0af850a5b79/apps/datacore/dist/memory/decision-case.js";

const artifact = {
  source: "DECISION",
  refId: "dec_real_1",
  title: "常州基地PACK02降产20%·哪些订单延期",
  context: "未来30天常州基地PACK02产线降低20%产能 交付风险 2026-08-01 窗口 45 天",
  options: [{ key: "delay", label: "延期" }, { key: "outsource", label: "外协" }, { key: "expedite", label: "加急" }],
  chosen: "delay",
  rejectedRationale: [{ optionKey: "outsource", rationale: "外协比过高" }],
  predicted: { summary: "延期5天", metrics: { deliveryRate: 0.92, cost: 1200 } },
  ctx: { intentKey: "affected_orders", entities: ["BASE_CZ", "Line:PACK02"], metrics: ["deliveryRate"] },
};
const opts = { tenantId: "demo", now: "2026-07-11T00:00:00.000Z" };

let pass = 0, failN = 0;
const ok = (c, msg) => { c ? (pass++, console.log("  PASS " + msg)) : (failN++, console.log("  FAIL " + msg)); };

// ── (A) projectCase R6 double-run byte identical ─────────────────────────────
const c1 = M.projectCase(artifact, opts);
const c2 = M.projectCase(artifact, opts);
ok(JSON.stringify(c1) === JSON.stringify(c2), "projectCase same input double-run byte-identical");
console.log("    caseId=" + c1.caseId + " origin=" + c1.origin + " problemClass=" + c1.problem.problemClass + " embDim=" + c1.embedding.length);
console.log("    features=" + JSON.stringify(c1.problem.features));

// ── (B) order-independence: shuffled entities/options → same case (deterministic sort) ─
const shuffled = { ...artifact,
  options: [{ key: "expedite", label: "加急" }, { key: "delay", label: "延期" }, { key: "outsource", label: "外协" }],
  ctx: { ...artifact.ctx, entities: ["Line:PACK02", "BASE_CZ"] } };
const c3 = M.projectCase(shuffled, opts);
ok(JSON.stringify(c1) === JSON.stringify(c3), "projectCase order-independent (shuffled entities/options → identical case)");

// ── (C) now injection: different now changes ONLY createdAt/updatedAt (no hidden clock) ─
const c4 = M.projectCase(artifact, { ...opts, now: "2030-01-01T00:00:00.000Z" });
const c1b = { ...c1, createdAt: "X", updatedAt: "X" };
const c4b = { ...c4, createdAt: "X", updatedAt: "X" };
ok(JSON.stringify(c1b) === JSON.stringify(c4b), "projectCase: only createdAt/updatedAt depend on injected now (no hidden Date.now)");
ok(c4.createdAt === "2030-01-01T00:00:00.000Z", "projectCase createdAt = injected now (byte)");

// ── (D) build a 3-case corpus, retrieval R6 double-run byte-identical ─────────
const caseMargin = M.projectCase({ ...artifact, refId: "dec_real_2", title: "毛利率下降归因", context: "财务毛利 2026-09 下降", options: [{ key: "cutcost", label: "降本" }], chosen: "cutcost", ctx: { intentKey: "margin_attribution_q", entities: ["SEG_A"], metrics: ["grossMargin"] } }, opts);
const caseCap = M.projectCase({ ...artifact, refId: "dec_real_3", title: "南京基地扩产决策", context: "南京基地 2026-08 扩产 60 天", ctx: { intentKey: "affected_orders", entities: ["BASE_NJ", "Line:PACK02"], metrics: ["deliveryRate"] } }, opts);
const corpus = [c1, caseMargin, caseCap];

const query = { tenantId: "demo", text: "常州PACK02降产 订单 延期 交付", problemClass: c1.problem.problemClass, entities: ["BASE_CZ", "Line:PACK02"], metrics: ["deliveryRate"], topK: 5, weightsVersion: "v1" };
const r1 = M.retrieveSimilarCases(corpus, query);
const r2 = M.retrieveSimilarCases(corpus, query);
ok(JSON.stringify(r1) === JSON.stringify(r2), "retrieveSimilarCases same (query,corpus,weightsVersion) double-run byte-identical hit order");
console.log("    top-K order: " + r1.hits.map(h => `${h.caseId}=${h.score}[e${h.breakdown.embed},s${h.breakdown.scenario},b${h.breakdown.business}]`).join("  "));
console.log("    total=" + r1.total + " disclaimer=" + JSON.stringify(r1.disclaimer));

// ── (E) explainable ranking: the CZ/PACK02 case must rank #1 for a CZ/PACK02 query ─
ok(r1.hits[0].caseId === c1.caseId, "known CZ/PACK02 query → CZ/PACK02 case ranks #1 (explainable, not constant)");
ok(r1.hits.every(h => h.breakdown && typeof h.breakdown.embed === "number" && typeof h.breakdown.scenario === "number" && typeof h.breakdown.business === "number"), "every hit carries 3-dim breakdown (R13 explainable)");
ok(r1.hits.every(h => typeof h.disclaimer === "string" && h.disclaimer.length > 0), "every hit carries disclaimer (KILL-MOCK-RED)");

// ── (F) discrimination: an off-domain query must NOT rank CZ case #1 (non-constant) ─
const offQuery = { tenantId: "demo", text: "毛利率 财务 归因 下降", problemClass: caseMargin.problem.problemClass, entities: ["SEG_A"], metrics: ["grossMargin"], topK: 5, weightsVersion: "v1" };
const ro = M.retrieveSimilarCases(corpus, offQuery);
console.log("    off-domain top-K: " + ro.hits.map(h => `${h.caseId}=${h.score}`).join("  "));
ok(ro.hits[0].caseId === caseMargin.caseId, "off-domain (margin) query → margin case ranks #1 (retrieval discriminates, not constant)");

// ── (G) weightsVersion determinism: unknown version falls back to v1 deterministically ─
const rUnknown = M.retrieveSimilarCases(corpus, { ...query, weightsVersion: "vZZZ" });
ok(JSON.stringify(rUnknown.hits.map(h=>h.caseId)) === JSON.stringify(r1.hits.map(h=>h.caseId)), "unknown weightsVersion → deterministic v1 fallback (same order)");

// ── (H) tenant is baked into caseId (R2 at projection) ───────────────────────
const cOther = M.projectCase(artifact, { ...opts, tenantId: "tenantB" });
ok(cOther.caseId !== c1.caseId && cOther.tenantId === "tenantB", "same artifact under different tenant → different caseId + tenantId (R2)");

console.log(`\nRESULT: ${pass} pass / ${failN} fail`);
process.exit(failN ? 1 : 0);
