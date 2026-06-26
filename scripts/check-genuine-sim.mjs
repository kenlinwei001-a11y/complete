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

// ④ 前端推演红/黄渲染必须消费 dataMode（显"估算/实测"），不裸渲染当真值。
const riskBoard = read("apps/frontend-shell/src/views/RiskBoardView.tsx");
if (!/card\.dataMode/.test(riskBoard) || !/估算|实测/.test(riskBoard)) {
  fail("RiskBoardView 未消费 card.dataMode 显估算/实测（风险红/黄裸渲染回潮）");
}
// 复审修：MOCK 卡基线是 mockTightness 启发值，绝不叫"实测"——MOCK 分支须含"无实测"且不得在 MOCK 分支叫"实测当前"。
{
  const mock = riskBoard.match(/dataMode === "MOCK"[\s\S]{0,400}?\}\)/);
  if (mock && (/实测当前/.test(mock[0]) || !/无实测/.test(mock[0]))) {
    fail('RiskBoardView MOCK 卡把 mock 基线标成"实测"（必修文案：MOCK 须"无实测"，不得叫"实测当前"）');
  }
}
const projSim = read("apps/frontend-shell/src/views/sim/ProjectSimView.tsx");
if (!/r\.live/.test(projSim) || !/估算|实测/.test(projSim)) {
  fail("ProjectSimView 未消费紧张度 r.live 显估算/实测（紧张度色块裸渲染回潮）");
}
// bottleneck_matrix 前端必须传 LIVE（否则永远 MOCK）。
if (!/bottleneck_matrix"[\s\S]{0,160}dataMode:\s*"LIVE"/.test(projSim)) {
  fail("ProjectSimView 调 bottleneck_matrix 未传 dataMode:LIVE（永远 MOCK 回潮·AUDIT 真值判据③）");
}

// ⑤ 假4：PropagationTimeline 财务击穿敞口必须用真营收（revenueWan，后端 affected_orders qty×真细分单价），
// 不再以前端写死 0.6 万/套现编财务为主路径。
const propTl = read("apps/frontend-shell/src/views/sim/PropagationTimeline.tsx");
if (!/revenueWan/.test(propTl) || !/hasRealRevenue/.test(propTl)) {
  fail("PropagationTimeline 财务击穿未用真营收 revenueWan（疑似前端写死 0.6 万/套现编财务回潮·假4）");
}

// ⑥ 假3：OrderChainView 经营数据看板不得用 hashN 现编财务/库存；库存列须诚实标"估算"。
const orderChain = read("apps/frontend-shell/src/views/plan/OrderChainView.tsx");
if (/function hashN|hashN\(/.test(orderChain)) {
  fail("OrderChainView 仍含 hashN 现编财务/库存（假3 回潮）——库存无实测数据须营收×固定系数估算 + 诚实标");
}
if (!/估算/.test(orderChain)) {
  fail("OrderChainView 经营数据看板库存列未诚实标'估算'（无实测库存数据·假3）");
}
// 复审修（RL5 系数 config 化）：库存系数须从后端 view.layout.econ 下发（deliveredEcon.coef），不得用前端写死 ECON_DEFAULT.coef 当主路径。
if (!/view\.layout\?\.econ|deliveredEcon/.test(orderChain)) {
  fail("OrderChainView 库存系数未从 view.layout.econ 下发（前端写死系数·RL5 回潮·假3 复审）");
}
const svc = read("apps/datacore/src/synthetic/service.ts");
if (!/ORDER_CHAIN_ECON|econ:\s*ORDER_CHAIN_ECON/.test(svc)) {
  fail("service.ts order-chain view-config 未下发 econ 系数（config 化未落·假3 复审）");
}

if (red) {
  console.error("\n✗ genuine-sim:check 未过：推演红/黄/数字疑似裸渲染当真值（假推演回潮）。修法：输出 schema 加 dataMode + 前端消费显估算/实测（抄 capex_scenario 缺数抛错 / LedgerView 逐格 Provenance）。");
  process.exit(1);
}
console.log("· genuine-sim：risk_timeline/capacity_forecast/bottleneck_matrix 输出带 dataMode；前端 RiskBoardView/ProjectSimView 消费 dataMode/live 显估算/实测；bottleneck 前端传 LIVE。");
console.log("✓ genuine-sim:check 通过（保守哨兵：钉死轨M 增量1/1b 诚实通道；假3/假4 修后扩入）。");
