#!/usr/bin/env node
/**
 * 门 `genuine-sim:check`（HANDOFF-three-boards §3 R1 + AUDIT-fake-simulation-inventory §5.6）：
 * 真推演 not 假推演——推演输出（红/黄/财务数字）**绝不裸渲染当真值**：① 推演求解器输出 schema 必须有
 * `dataMode`（透 LIVE/MOCK）② 前端推演红/黄渲染必须消费 dataMode/live（显"估算/实测"）→ 防"mock/哈希/
 * 写死冒充真算"回潮。
 *
 * 诚实边界（保守哨兵，非全量静态分析）：钉死轨M 增量1/1b 已闭合的诚实通道——risk_timeline /
 * capacity_forecast 输出带 dataMode + 前端 RiskBoardView/ProjectSimView 消费之。假3(OrderChainView
 * hashN 库存)/假4(PropagationTimeline 写死)待其增量修后扩入本门断言。
 */
/* ── 退出码纪律 · 顶层兜底（WO-GATE-RC2-DISCIPLINE）─────────────────────────────
 * 本仓门的退出码是**三分**约定（docs/SOP-reviewer-claim-discipline.md §3）：
 *   0 = 干净 · 1 = **真有问题**（先修代码）· 2 = **工具自己坏了**（只许说「我没查出来」）。
 * 而 node 对**未捕获异常一律退 1** —— 恰好撞上「真有问题」这个码。于是「门根本没跑起来」
 * （缺依赖 / 只读 FS / 权限 / OOM / node 版本差异 / dist 没构建）会被 gate.sh 和人一起
 * 读成「你的代码有问题」，方向**正好相反**。2026-08-11 一天之内两道门各撞一次，故建此机制。
 * 形态（铁律 0.6 句式）：「我用『进程非 0 退出』当作『代码有问题』的证据，而前者并不度量后者。」
 *
 * 这段只**加**默认失败方向，**不动**任何既有 exit(0)/exit(1)：兜底若把真违规也吞成 2，
 * 那是拿一个更糟的假绿换掉一个假红。RC=1 仍然只由主判据明确判负产生。
 * 守门的门：scripts/check-gate-exit-discipline.mjs（新加的门不带兜底会被它当场判红）。 */
process.on("uncaughtException", (e) => gateToolBroken(e));
process.on("unhandledRejection", (e) => gateToolBroken(e));
function gateToolBroken(e) {
  console.error(`⛔ check-genuine-sim.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


import { readFileSync } from "node:fs";

const read = (rel) => {
  try { return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8"); }
  catch { console.error(`✗ genuine-sim:check 读不到 ${rel}`); process.exit(1); }
};

let red = false;
const fail = (m) => { console.error("✗ " + m); red = true; };

// ① 推演求解器输出 schema 必须带 dataMode（透 LIVE/MOCK）。
const solvers = read("packages/contracts/src/solvers.ts");
for (const [schema, label] of [
  ["RiskTimelineOutputSchema", "risk_timeline 顶层"],
  ["RiskCardSchema", "risk_timeline 逐卡"],
  ["CapacityForecastOutputSchema", "capacity_forecast"],
  ["BottleneckMatrixOutputSchema", "bottleneck_matrix"],
]) {
  // 取该 schema 块（到下一个 export const ...Schema），断言其中含 dataMode。
  const m = solvers.match(new RegExp(`export const ${schema}[\\s\\S]*?(?=export const \\w+Schema|export type)`));
  if (!m || !/dataMode/.test(m[0])) fail(`${label} 输出 schema (${schema}) 缺 dataMode —— 推演红/黄无诚实披露字段（假推演回潮）`);
}

// ② risk_timeline 求解器逐卡透 dataMode + 实测当前张力（liveTightness），不裸用 mockTightness 当真值。
const risk = read("apps/datacore/src/solvers/risk.ts");
if (!/dataMode:\s*lt\.live/.test(risk) || !/currentTightness/.test(risk)) {
  fail("risk.ts riskTimeline 未逐卡透 dataMode/currentTightness（liveTightness 实测当前张力）");
}

// ③ capacity_forecast 紧张度改用 liveTightness（真 OEE/利用率/良率），不再裸 import mockTightness 绕真数据。
const cap = read("apps/datacore/src/solvers/capacity.ts");
if (/import\s*\{[^}]*\bmockTightness\b/.test(cap)) {
  fail("capacity.ts 仍裸 import mockTightness（应改用 risk.ts 的 liveTightness LIVE/MOCK 判别）");
}
if (!/liveTightness/.test(cap) || !/dataMode:/.test(cap)) {
  fail("capacity.ts 未用 liveTightness + 透 dataMode（紧张度/主瓶颈真推演）");
}

// ④ 前端推演红/黄渲染必须逐卡消费诚实位 + 显"估算/实测"，不裸渲染当真值。
// WO-DATAMODE-UNIFY-PROVENANCE 后前端两正交维披露：measurement 维（card.dataMode/card.currentTightness 实测当前张力）
// 与 provenance 维（card.provenanceSynthetic「合成·未接实测」灰徽章）——比旧单一 card.dataMode 更细。三者任一被消费即诚实
// 披露；三者全无 = 裸渲染回潮（此哨兵旧版只认 card.dataMode 已随前端演进为 stale 误判，本次校正为认全部诚实位）。
const riskBoard = read("apps/frontend-shell/src/views/RiskBoardView.tsx");
if (!/card\.(dataMode|provenanceSynthetic|currentTightness)/.test(riskBoard) || !/估算|实测/.test(riskBoard)) {
  fail("RiskBoardView 未消费 card 诚实位(dataMode/provenanceSynthetic/currentTightness) 显估算/实测（风险红/黄裸渲染回潮）");
}
const projSim = read("apps/frontend-shell/src/views/sim/ProjectSimView.tsx");
if (!/r\.live/.test(projSim) || !/估算|实测/.test(projSim)) {
  fail("ProjectSimView 未消费紧张度 r.live 显估算/实测（紧张度色块裸渲染回潮）");
}
// bottleneck_matrix 前端必须传 LIVE（否则永远 MOCK）。
if (!/bottleneck_matrix"[\s\S]{0,160}dataMode:\s*"LIVE"/.test(projSim)) {
  fail("ProjectSimView 调 bottleneck_matrix 未传 dataMode:LIVE（永远 MOCK 回潮·AUDIT 真值判据③）");
}

// ⑤ audit_timeline 去哈希诚实标（AUDIT 2026-07-24 P0·假·哈希冒充回潮防线）：
//    (a) 契约 AuditTimelineOutputSchema 带 dataMode；(b) risk.ts auditTimeline 输出标 dataMode:MOCK + provenanceSynthetic
//    —— series/peak/crossDay 由 hashString(kind) 派生（无实测源）须诚实披露，不裸渲染当真值。
{
  const m = solvers.match(/export const AuditTimelineOutputSchema[\s\S]*?(?=export const \w+Schema|export type)/);
  if (!m || !/dataMode/.test(m[0])) fail("audit_timeline 输出 schema (AuditTimelineOutputSchema) 缺 dataMode —— 逐日 series/峰值裸渲染当真值（假·哈希冒充回潮）");
}
if (!/function auditTimeline/.test(risk) || !/dataMode:\s*"MOCK"/.test(risk) || !/provenanceSynthetic:\s*true/.test(risk)) {
  fail("risk.ts auditTimeline 未标 dataMode:MOCK + provenanceSynthetic（series/peak/crossDay hash 派生须诚实披露·不裸渲染当实测）");
}

// ⑥ extended 求解器缺真数据不静默现编（AUDIT P2·假6·KILL-MOCK-RED）：
//    (a) 删写死 series（yield_diagnosis 40 天 day-33 突变 / maintenance_stagger loadByWeek 常量）；
//    (b) 缺关键真对象时出 dataMode:EMPTY / provenanceSynthetic 披露，不冒充真算（抄 capex 缺数抛错）。
const extended = read("apps/datacore/src/solvers/extended.ts");
if (/yield:\s*d\s*<\s*33\s*\?/.test(extended) || /"6":\s*20,\s*"7":\s*5/.test(extended)) {
  fail("extended.ts 仍含写死 series（yield_diagnosis day-33 突变 / maintenance_stagger loadByWeek 常量）—— 缺真时序时现编假数据冒充真算（假6 回潮）");
}
if (!/dataMode:\s*"EMPTY"/.test(extended) || !/provenanceSynthetic:\s*true/.test(extended)) {
  fail("extended.ts 缺关键真对象时未标 dataMode:EMPTY/provenanceSynthetic（yield_diagnosis/maintenance_stagger 须诚实披露·抄 capex 缺数抛错）");
}

// ⑦ hollow recompute 诚实化（AUDIT P0·头号病·generic_inference apply 无下游派生边不静默 0）：
//    service.ts genericInference apply 命中但 dryRunDeltas 空 → dataMode:EMPTY + note，不静默返 deltas:[] 冒充"重算了没变"。
const svc = read("apps/datacore/src/solvers/service.ts");
if (!/dataMode\s*=\s*deltas\.length\s*>\s*0\s*\?\s*"LIVE"\s*:\s*"EMPTY"/.test(svc) || !/无下游派生边/.test(svc)) {
  fail("service.ts genericInference 未对'apply 命中但无下游派生边(dryRunDeltas 空)'标 dataMode:EMPTY + note（静默 0 冒充重算回潮·hollow recompute）");
}

if (red) {
  console.error("\n✗ genuine-sim:check 未过：推演红/黄/数字疑似裸渲染当真值（假推演回潮）。修法：输出 schema 加 dataMode + 前端消费显估算/实测（抄 capex_scenario 缺数抛错 / LedgerView 逐格 Provenance）。");
  process.exit(1);
}
console.log("· genuine-sim：risk_timeline/capacity_forecast/bottleneck_matrix 输出带 dataMode；前端 RiskBoardView/ProjectSimView 消费 dataMode/live 显估算/实测；bottleneck 前端传 LIVE。");
console.log("· genuine-sim（AUDIT 2026-07-24 扩门）：audit_timeline 契约+求解器标 dataMode:MOCK/provenanceSynthetic；extended 删写死 series+缺数标 EMPTY；generic_inference 无派生边标 dataMode:EMPTY 不静默 0。");
console.log("✓ genuine-sim:check 通过（保守哨兵：钉死轨M 增量1/1b 诚实通道 + AUDIT P0-P2 假·哈希/写死/静默 0 回潮防线）。");
