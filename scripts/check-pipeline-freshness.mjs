#!/usr/bin/env node
/**
 * 门 `pipeline-freshness:check`（WO-FRESHNESS · 置信度三维贯通 · PRD-decision-support-maturity §3.0④⑤）。
 *
 * 守"关键数据源新鲜度 + 真实↔合成 必须接进决策置信度，缺即红"——根除"求解器在滞后/合成数据上算结论却
 * 不告诉用户"整类（与 no-silent-mock 同纲，但把诚实位从二维[实测↔估算]扩到三维）：
 *  ① 契约层：SolverDataModeSchema 含 STALE + SYNTHETIC（追加枚举·不破 LIVE/MOCK/PARTIAL）+ SolverConfidenceSchema 三维。
 *  ② 运行层：service.ts invoke 统一叠加 applyConfidenceDimensions——关键源 dataHealth(critical) lagHours>staleHours → STALE，
 *     纯合成对象决策(isSyntheticDecision) → SYNTHETIC（与 domainTrustLevel=UNVERIFIED 同源）。
 *  ③ 展示层：DataModeBadge 标 STALE/SYNTHETIC；决策视图（RiskBoardView）消费 confidence 显三维。
 *
 * 诚实边界（保守哨兵，非全量静态分析）：钉死已闭合的诚实通道；运行时行为由 datacore solvers.test
 * WO-FRESHNESS①②③ 真跑覆盖（合成→SYNTHETIC·关键源滞后→STALE·MOCK 不被洗白）。
 */
import { readFileSync } from "node:fs";

const read = (rel) => {
  try { return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8"); }
  catch { console.error(`✗ pipeline-freshness:check 读不到 ${rel}`); process.exit(1); }
};

let red = false;
const fail = (m) => { console.error("✗ " + m); red = true; };

// ① 契约层：追加枚举 + 三维 schema。
const solvers = read("packages/contracts/src/solvers.ts");
if (!/SolverDataModeSchema\s*=\s*z\.enum\(\[[^\]]*"STALE"[^\]]*"SYNTHETIC"/.test(solvers)
  && !/SolverDataModeSchema\s*=\s*z\.enum\(\[[^\]]*"SYNTHETIC"[^\]]*"STALE"/.test(solvers)) {
  fail("contracts/solvers.ts SolverDataModeSchema 未追加 STALE + SYNTHETIC 枚举（新鲜度/合成维无契约承载）");
}
// 既有 LIVE/MOCK/PARTIAL 不可被破（追加非替换）。
for (const v of ["LIVE", "MOCK", "PARTIAL"]) {
  if (!new RegExp(`SolverDataModeSchema\\s*=\\s*z\\.enum\\(\\[[^\\]]*"${v}"`).test(solvers)) {
    fail(`contracts/solvers.ts SolverDataModeSchema 缺既有枚举值 "${v}"（扩枚举须追加·不可破既有消费）`);
  }
}
if (!/export const SolverConfidenceSchema/.test(solvers)) {
  fail("contracts/solvers.ts 缺 SolverConfidenceSchema（置信度三维 structured 单一来源）");
}
for (const dim of ["synthetic", "stale", "measurement"]) {
  if (!new RegExp(`${dim}:`).test(solvers.match(/SolverConfidenceSchema[\s\S]*?\}\);/)?.[0] ?? "")) {
    fail(`SolverConfidenceSchema 缺 ${dim} 维（三维：真实↔合成 × 新鲜↔陈旧 × 实测↔估算）`);
  }
}

// ② 运行层：invoke 统一叠加新鲜度 + 合成维（关键源 dataHealth 接进决策置信度）。
const svc = read("apps/datacore/src/solvers/service.ts");
if (!/applyConfidenceDimensions/.test(svc)) {
  fail("service.ts 缺 applyConfidenceDimensions（置信度三维未跨求解器统一叠加）");
}
// invoke 必须调用之（否则三维不下发）。
if (!/await this\.applyConfidenceDimensions\(/.test(svc)) {
  fail("service.ts invoke 未调用 applyConfidenceDimensions（求解器输出未叠加新鲜度/合成维·诚实位漏标）");
}
// 新鲜度维：关键源 dataHealth.critical + lagHours>staleHours → STALE。
if (!/DataSourceHealth/.test(svc) || !/critical\s*===\s*true/.test(svc) || !/lagHours/.test(svc) || !/staleHours/.test(svc)) {
  fail("service.ts applyConfidenceDimensions 未接关键源 dataHealth(critical) lagHours>staleHours（新鲜度维未进决策置信度·门红挡未接的关键源）");
}
if (!/"STALE"/.test(svc)) {
  fail("service.ts 未据新鲜度滞后置 STALE（LIVE 但滞后→STALE 未落）");
}
// 真实↔合成维：纯合成对象决策 → SYNTHETIC。
if (!/isSyntheticDecision/.test(svc) || !/"SYNTHETIC"/.test(svc)) {
  fail("service.ts 未据 origin=SYNTHETIC 置 SYNTHETIC（真实↔合成维未进决策置信度）");
}
// MOCK 不被横切维洗白（最审慎优先）。
if (!/measurement === "MOCK"/.test(svc)) {
  fail("service.ts 未保 MOCK 不被 SYNTHETIC/STALE 覆盖（纯估算最审慎·防洗白）");
}

// ③ 展示层：徽章标 STALE/SYNTHETIC + 决策视图消费 confidence。
const badge = read("apps/frontend-shell/src/components/DataModeBadge.tsx");
if (!/STALE:/.test(badge) || !/SYNTHETIC:/.test(badge)) {
  fail("DataModeBadge 未为 STALE/SYNTHETIC 配标签（前端无从标'基于 N 小时前 / 合成数据'）");
}
if (!/合成数据/.test(badge) || !/(滞后|小时|较早)/.test(badge)) {
  fail("DataModeBadge STALE/SYNTHETIC 文案缺'合成数据 / 滞后(N 小时)'（用户看不懂三维诚实位）");
}
const riskBoard = read("apps/frontend-shell/src/views/RiskBoardView.tsx");
if (!/confidence/.test(riskBoard) || !/DataModeBadge/.test(riskBoard)) {
  fail("RiskBoardView 未消费 confidence/DataModeBadge 显置信度三维（决策视图裸渲染回潮）");
}

// ④ P0·CONCERN 6cc1f97 修（防回潮）：合成判定缓存 syntheticByTenant 必须被真实写路径失效——否则接真实数据后
// 仍误标 SYNTHETIC（诚实位失真·长跑越久越假）。守 invalidateConfidenceCache 有生产调用方（对象写路径收口点
// ontology.runDerivations）。此前该方法零调用方 = 缓存永不失效 = 诚实位谎报，正是本门要挡死的整类。
if (!/invalidateConfidenceCache/.test(svc)) {
  fail("service.ts 缺 invalidateConfidenceCache（合成判定缓存无失效口）");
}
const ontologySrc = read("apps/datacore/src/ontology.ts");
if (!/invalidateConfidenceCache\(/.test(ontologySrc)) {
  fail("ontology.ts runDerivations 未调 solvers.invalidateConfidenceCache（合成判定缓存零失效 → 接真实数据后仍误标 SYNTHETIC·诚实位失真·CONCERN 6cc1f97 回潮）");
}

if (red) {
  console.error("\n✗ pipeline-freshness:check 未过：新鲜度/真实↔合成维未接进决策置信度（关键源滞后/合成数据冒充真实接入回潮）。修法：契约追加 STALE/SYNTHETIC + SolverConfidenceSchema；service.ts invoke 叠加 applyConfidenceDimensions（关键源 dataHealth + origin=SYNTHETIC）；前端 DataModeBadge/决策视图消费三维。");
  process.exit(1);
}
console.log("· pipeline-freshness：契约 STALE/SYNTHETIC + 三维 schema；service.ts invoke 叠加新鲜度(关键源 dataHealth)+合成维；DataModeBadge/RiskBoardView 消费三维。");
console.log("✓ pipeline-freshness:check 通过（关键源新鲜度 + 真实↔合成 已接进决策置信度·缺即红）。");
