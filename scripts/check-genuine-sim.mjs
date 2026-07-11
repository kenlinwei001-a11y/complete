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
 *
 * ── GENUINE-SIM-GATE-HARDEN（C1 覆盖加固·§⑩）─────────────────────────────────────────
 * 上述①–⑨ 为**具体哨兵**（钉死若干求解器+视图的逐行文案/守卫）。§⑩ 在其之上加一层**登记驱动的全量覆盖**：
 * 遍历派发单一来源 `SOLVER_REGISTRY`，把每个【决策级】求解器都强制归入「有专属前端决策视图·消费 dataMode」
 * 或「无专属视图·经通用答案渲染器消费诚实位」——**完整性缺口即红**（新增决策求解器必须表态，防覆盖窄漏）。
 *
 * ── 与 `no-silent-mock:check` 的边界（读该门确认·不重叠不打架）────────────────────────
 *   no-silent-mock = **后端契约层·全量存在性**权威门：每个 SOLVER_KEY 的 `SOLVER_OUTPUT_SHAPES` 含 dataMode 字段。
 *   genuine-sim   = **端到端·决策级子集的消费闭环**：分类口径 + 前端消费面覆盖 + 「无真源不伪造决策红」行为(§⑧)。
 *   二者**同向不打架**：若某求解器后端漏 dataMode → no-silent-mock 红（存在性）；genuine-sim 侧其前端消费/
 *   分类同样立不住。genuine-sim **不复检后端 shape 存在性**（归 no-silent-mock），只借读 shape 把「后端有位→
 *   前端消费」串成一条决策级链。职责分层清晰：一个守后端全量，一个守决策级端到端。
 *
 * ── C2 牙齿自证（green→red·可复现）─────────────────────────────────────────────────
 *  齿A｜新增决策求解器未表态：在 apps/datacore/src/solvers/solver-registry.ts 追加
 *      `{ key: "fake_decision_solver", route: "extended", outputShape: ["verdict","gap","recommended","ruleRefs"] }`
 *      → `pnpm --filter datacore build` → `node scripts/check-genuine-sim.mjs` ⇒ EXIT=1「C1 覆盖缺口：…未归类前端消费面」。
 *  齿B｜前端漏消费 dataMode：把某 MAPPED 视图（如 SopBalanceView.tsx 之 finance_pnl/mrp_netting）的
 *      dataMode/isLiveDecision/.live 消费全数抹除 → `node scripts/check-genuine-sim.mjs`
 *      ⇒ EXIT=1「C1 前端漏消费：…未读 dataMode/live 分档」。SopBalanceView 超出①–⑨ 哨兵覆盖，证扩齿有效。
 *  （二齿均已实测：植假即红·git 还原(+重建)即绿。）
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
//    WO-KILL-MOCK-RED v2：无真源不伪造——liveTightness 返回 value:null/live:false（删 mockTightness 决策级回落），
//    无真源卡出 hasData:false + noDataReason + crossDay/peak 空；决策级越线/planRows 只来自 live===true。
const risk = read("apps/datacore/src/solvers/risk.ts");
if (!/currentTightness/.test(risk)) {
  fail("risk.ts riskTimeline 未逐卡透 currentTightness（liveTightness 实测当前张力）");
}
if (!/return\s*\{\s*value:\s*null,\s*live:\s*false\s*\}/.test(risk)) {
  fail("risk.ts liveTightness 无真源未返回 {value:null,live:false}（治本删 mockTightness 决策级回落·G-DM-1 回潮）");
}
if (!/hasData:\s*false/.test(risk) || !/noDataReason/.test(risk)) {
  fail("risk.ts riskTimeline 无真源卡缺 hasData:false + noDataReason（无真源诚实空态未落·假红回潮）");
}
if (/return\s*\{\s*value:\s*mockTightness\(/.test(risk)) {
  fail("risk.ts 仍有 `return { value: mockTightness(...) }` 决策级回落（G-DM-1 假红根断点回潮）");
}
// buildRiskPlanRows / 卡循环：hasData===false 的卡不进决策级 planRows / 不产越线。
if (!/card\.hasData === false/.test(risk) && !/hasData: false/.test(risk)) {
  fail("risk.ts buildRiskPlanRows 未跳过 hasData===false 卡（无真源卡进处置工单·伪造可行动结论）");
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

// ④.b（WO-SANDBOX-TRUST-BADGE·S2）：沙盘每个可见数字必须绑诚信位徽标（补沙盘唯一缺的数据血缘披露面·G-DM-1 沙盘侧）。
//   SandboxView 须消费 SimDataModeBadge + 汇总位 overallDataMode（顶部可信度）——防"沙盘裸渲染数字当真值"回潮。
//   UNCALIBRATED 必须由 propRules 真派生（coefficientRef 空·非造）；SimDataModeBadge 派生层绝不假标 LIVE（无真源退 UNKNOWN）。
const sandbox = read("apps/frontend-shell/src/views/sim/SandboxView.tsx");
if (!/SimDataModeBadge/.test(sandbox) || !/overallDataMode/.test(sandbox)) {
  fail("SandboxView 未消费 SimDataModeBadge/overallDataMode（沙盘数字裸渲染当真值·诚信位缺失·G-DM-1 沙盘侧回潮）");
}
const badge = read("apps/frontend-shell/src/views/sim/SimDataModeBadge.tsx");
if (!/coefficientRef/.test(badge) || !/UNCALIBRATED/.test(badge)) {
  fail("SimDataModeBadge 未由 coefficientRef 真派生 UNCALIBRATED（未校准诚信位非真派生·造位回潮）");
}
if (!/return\s*"UNKNOWN"/.test(badge)) {
  fail("SimDataModeBadge 无真源未退 UNKNOWN（诚实'来源待披露'·绝不假标 LIVE·KILL-MOCK-RED 沙盘侧回潮）");
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

// ⑦ A0（空洞数据冰山结构性根因）：dataMode 诚实位推广到 audit_timeline + extended 全族——防"哈希/魔数静默冒充真算"回潮。
// audit_timeline 必透 dataMode。FILL-AUDIT-TIMELINE-REAL 治本后：有真日序→dataMode:"LIVE"、无真源→hasData:false+dataMode:"MOCK"+noDataReason
// （不再哈希造曲线）；口径由旧 `dataMode: orders.length` 升级为「auditTimeline 函数体透 dataMode + 无真源诚实空态 hasData:false」。
const auditTimelineBody = (risk.match(/function auditTimeline[\s\S]{0,3000}/) ?? [""])[0];
if (!/dataMode:/.test(auditTimelineBody) || !/hasData:\s*false/.test(auditTimelineBody)) {
  fail("risk.ts auditTimeline 未透 dataMode / 无真源未退诚实空态（hasData:false）——审计逐日曲线诚实位缺失·A1 回潮");
}
const ext = read("apps/datacore/src/solvers/extended.ts");
if (!/export function extendedDataMode/.test(ext)) {
  fail("extended.ts 缺 extendedDataMode（13 求解器无诚实位分类·A2-A4 哈希/魔数静默回潮）");
}
const svcSolver = read("apps/datacore/src/solvers/service.ts");
if (!/extendedDataMode\(c,\s*solverKey/.test(svcSolver)) {
  fail("service.ts 扩展求解器分发未附 extendedDataMode（dataMode 未随输出下发·UI 无从标）");
}
// 共用诚实位徽章组件 + 单一来源枚举。
if (!/SolverDataModeSchema/.test(solvers)) {
  fail("contracts/solvers.ts 缺 SolverDataModeSchema（诚实位枚举单一来源·A0 契约层根因）");
}
const auditView = read("apps/frontend-shell/src/views/sim/PlanAuditView.tsx");
if (!/DataModeBadge/.test(auditView) || !/dataMode/.test(auditView)) {
  fail("PlanAuditView 未用 DataModeBadge 消费 audit_timeline dataMode（审计曲线裸渲染回潮·A1）");
}

// ⑨ WO-KILL-MOCK-RED 退回窄修（C7 扩齿·覆盖驾驶舱决策面）：DashboardView 决策组件（ProblemPanel/PlanDrill/
//    OrderLedger）渲染 danger 红前必有 dataMode 守卫——审核方 curl 硬证 affected_orders 返 dataMode:SYNTHETIC，
//    ProblemPanel 曾无守卫 → 8 张合成硬红决策卡。破守卫→门红（保守哨兵漏此洞的教训）。
const dash = read("apps/frontend-shell/src/views/DashboardView.tsx");
// ProblemPanel：affected_orders dataMode → notLive 守卫，danger 边框据此降级。
if (!/const notLive = data\?\.dataMode != null && !isLiveDecision\(data\.dataMode\)/.test(dash)) {
  fail("DashboardView 决策组件缺 `notLive = data?.dataMode!=null && !isLiveDecision(...)` 守卫（ProblemPanel/PlanDrill/OrderLedger 合成硬红回潮·C7）");
}
// ProblemPanel danger 边框必被 notLive 门控（非无脑 var(--danger)）。
if (/borderLeft: "3px solid var\(--danger\)"/.test(dash)) {
  fail("DashboardView ProblemPanel 仍硬编码 `borderLeft:\"3px solid var(--danger)\"`（未据 dataMode 降级·SYNTHETIC 硬红决策卡回潮·C7）");
}
if (!/notLive \? "var\(--muted2\)" : "var\(--danger\)"/.test(dash)) {
  fail("DashboardView ProblemPanel danger 边框未据 notLive 降级为中性灰（C7 治本）");
}
// PlanDrill offTarget 红 + OrderLedger delay 红须被 notLive 门控。
if (!/k\.offTarget && !notLive \? "#DD7E9E"/.test(dash)) {
  fail("DashboardView PlanDrillWidget offTarget「未达成」红未据 notLive 门控（C7）");
}
if (!/r\.delay > 0 && !notLive \? "var\(--danger\)"/.test(dash)) {
  fail("DashboardView OrderLedgerWidget delay 红未据 notLive 门控（C7）");
}

// ⑧ WO-KILL-MOCK-RED v2 语义门（治本·牙齿自证）：从「存在性」升级为「行为」——导入 dist，构造**零真数据**
//    SolverContext（一个基地对象但无 Equipment/Line/Process/DemandSegment/SopVersion·无真源），真调
//    riskTimeline，断言无真源因子决策级字段为空/中性（crossDay===null·peak===null·hasData===false·planRows===[]）。
//    把 risk.ts 治本行（liveTightness 返 null）改回 mockTightness → 该因子会出红 crossDay → 本门必红（牙齿）。
try {
  const { riskTimeline } = await import("../apps/datacore/dist/solvers/risk.js");
  const { BATTERY_SOLVER_PARAMS } = await import("../apps/datacore/dist/synthetic/battery.js");
  const zeroCtx = {
    tenantId: "gate-zero", params: BATTERY_SOLVER_PARAMS,
    bases: [{ props: { baseId: "zbase", name: "零数据基地", util: 0 } }],
    lines: [], processes: [], equipment: [], maintPlans: [], models: [], orders: [],
    shipments: [], segments: [], dataHealth: [], certByModel: new Map(),
    demandSegments: [], sopVersions: [], materials: [], materialBatches: [],
    customers: [], arInvoices: [], certifications: [],
  };
  // 无真源因子（非设备OEE/瓶颈工序/良率·非需求驱动·无真产能）→ 必须诚实空态（不伪造决策级红）。
  for (const factor of ["物流时长", "换型损失"]) {
    const out = riskTimeline(zeroCtx, { base: "零数据基地", factor, horizon: 30 });
    const card = (out.cards || [])[0] || {};
    if (card.hasData !== false) fail(`v2 语义门：零数据 riskTimeline(${factor}) 卡 hasData!==false（无真源仍伪造数据·G-DM-1）`);
    if (card.crossDay !== null && card.crossDay !== undefined) fail(`v2 语义门：零数据 riskTimeline(${factor}) crossDay=${card.crossDay}!==null（无真源伪造越线红·G-DM-1 回潮）`);
    if (card.peak !== null && card.peak !== undefined) fail(`v2 语义门：零数据 riskTimeline(${factor}) peak=${card.peak}!==null（无真源伪造峰值·G-DM-1）`);
    if ((out.planRows || []).length !== 0) fail(`v2 语义门：零数据 riskTimeline(${factor}) planRows.length=${(out.planRows||[]).length}!==0（无真源伪造处置工单·可行动结论）`);
  }
} catch (e) {
  fail(`v2 语义门：无法导入 dist 真调 riskTimeline（先 pnpm --filter datacore build）：${e.message}`);
}

// ⑧b C2（WO-FAKE-05 堵根·**dataMode 值诚实·行为断言**）：声称 measured/LIVE 的因子，其值必须**随真业务输入变**——
//    扁平（改输入不动）却标 LIVE = 假推演（审计 docs/AUDIT-solver-fake-residues.md R1/R2：设备OEE/良率扁平标 LIVE 的病根）。
//    构造两份**仅业务输入不同**的 SolverContext，真调 riskTimeline，断言其峰值张力 peak 随输入变；
//    若因子出了非空决策峰值(measured)却两份相同 → 与真输入零耦合的扁平冒充 → 红。
//    牙齿：把 risk.ts 设备OEE/良率分支改成忽略 oee_current/yield_baseline 返回常量 → 两份 peak 相同 → 本门必红。
try {
  const { riskTimeline } = await import("../apps/datacore/dist/solvers/risk.js");
  const { BATTERY_SOLVER_PARAMS } = await import("../apps/datacore/dist/synthetic/battery.js");
  const mkCtx = (oeeVals, yieldVals) => ({
    tenantId: "gate-behav", params: BATTERY_SOLVER_PARAMS,
    bases: [{ props: { baseId: "b1", name: "行为基地", util: 0 } }],
    lines: [{ props: { baseId: "b1", lineId: "L1", utilization: 0.8 } }],
    processes: yieldVals.map((y, i) => ({ props: { baseId: "b1", processId: `P${i}`, yield_baseline: y } })),
    equipment: oeeVals.map((o, i) => ({ props: { baseId: "b1", equipmentId: `E${i}`, oee_current: o } })),
    maintPlans: [], models: [], orders: [], shipments: [], segments: [], dataHealth: [],
    certByModel: new Map(), demandSegments: [], sopVersions: [], materials: [], materialBatches: [],
    customers: [], arInvoices: [], certifications: [],
  });
  const peakOf = (ctx, factor) => ((riskTimeline(ctx, { base: "行为基地", factor, horizon: 30 }).cards || [])[0] || {}).peak;
  // 每项：{因子, 两份仅该因子真输入不同的 ctx, 真输入名}——高健康 vs 低健康应产生不同峰值张力。
  const behav = [
    { factor: "设备OEE", a: mkCtx([0.90, 0.90, 0.90], [0.95]), b: mkCtx([0.50, 0.55, 0.52], [0.95]), input: "Equipment.oee_current" },
    { factor: "良率波动", a: mkCtx([0.85], [0.985, 0.985]), b: mkCtx([0.85], [0.900, 0.880]), input: "Process.yield_baseline" },
  ];
  for (const t of behav) {
    const pa = peakOf(t.a, t.factor), pb = peakOf(t.b, t.factor);
    if (pa !== null && pa !== undefined && pa === pb) {
      fail(`C2 dataMode值诚实：riskTimeline(${t.factor}) 峰值 ${pa} 不随真输入 ${t.input} 变（扁平冒充·声称 measured 却与业务输入零耦合·G-DM-1 假推演回潮·须读真属性或诚实标 PARTIAL）`);
    }
  }
} catch (e) {
  fail(`⑧b C2 行为断言：无法导入 dist 真调 riskTimeline（先 pnpm --filter datacore build）：${e.message}`);
}

// ⑩ C1（GENUINE-SIM-GATE-HARDEN）：覆盖从哨兵名单扩为 SOLVER_REGISTRY 全量【决策级】求解器。
// ── 决策级判定口径（门内声明·可复现）──────────────────────────────────────────────────
//  「决策级」= 求解器输出被渲染给人以驱动 go/no-go：红/黄状态、越阈、财务敞口、裁决(verdict)、
//   或可行动处置(planRows/plans/recommended/gap/optimal…)。判定采【默认决策级·白名单豁免】口径：
//   `SOLVER_REGISTRY` 全部键**默认视为决策级**，仅 NON_DECISION_KEYS（纯拓扑/描述性读出·不渲染红/裁决）显式豁免。
//   反向口径（默认非决策级、命中信号字段才算）会**漏判**——如 bottleneck_matrix 无显式信号字段却是决策面——
//   故取「默认决策级」求宽覆盖（宽 = 更难作假）。每个决策级键必须落入 FRONTEND_MAPPED（有专属前端决策视图·
//   消费 dataMode/live 分档）或 FRONTEND_EXEMPT（无专属视图·经 QOS/Agent 通用答案渲染器 + 共享诚实位徽章消费·
//   前端 grep 0 专属引用）二者之一——完整性缺口即红（新增决策求解器强制表态·治覆盖窄漏）。
try {
  const { SOLVER_REGISTRY } = await import("../apps/datacore/dist/solvers/solver-registry.js");
  const { SOLVER_OUTPUT_SHAPES } = await import("../apps/datacore/dist/solvers/service.js");
  const allKeys = SOLVER_REGISTRY.map((d) => d.key);

  // 纯描述性/拓扑读出——不渲染红/裁决/财务敞口，非 go/no-go 决策面（每项附豁免理由）。
  const NON_DECISION_KEYS = {
    capacity_rollup: "纯产能拓扑读出（A6 readout：bases+ruleRefs）·不渲染红/黄/裁决·非 go/no-go 决策面",
  };

  // 有专属前端决策视图·必**读 dataMode/live 分档**（消费点文件·破其 dataMode 消费即红）。
  const FRONTEND_MAPPED = {
    capacity_forecast: ["apps/frontend-shell/src/views/sim/ProjectSimView.tsx"],
    bottleneck_matrix: ["apps/frontend-shell/src/views/sim/ProjectSimView.tsx"],
    risk_timeline: ["apps/frontend-shell/src/views/RiskBoardView.tsx", "apps/frontend-shell/src/views/sim/ProjectSimView.tsx"],
    affected_orders: ["apps/frontend-shell/src/views/DashboardView.tsx", "apps/frontend-shell/src/views/plan/OrderChainView.tsx"],
    audit_timeline: ["apps/frontend-shell/src/views/sim/PlanAuditView.tsx"],
    plan_audit: ["apps/frontend-shell/src/views/sim/PlanAuditView.tsx"],
    plan_generate: ["apps/frontend-shell/src/views/sim/PlanGenerateView.tsx"],
    plan_rootcause: ["apps/frontend-shell/src/views/DashboardView.tsx"],
    metric_rollup: ["apps/frontend-shell/src/views/DashboardView.tsx"],
    order_fullchain: ["apps/frontend-shell/src/views/plan/OrderChainView.tsx", "apps/frontend-shell/src/views/sim/ProjectSimView.tsx"],
    ksf_graph: ["apps/frontend-shell/src/components/KsfGraph.tsx"],
    finance_pnl: ["apps/frontend-shell/src/views/sim/SopBalanceView.tsx"],
    mrp_netting: ["apps/frontend-shell/src/views/sim/SopBalanceView.tsx"],
    mitigation_select: ["apps/frontend-shell/src/views/RiskBoardView.tsx"],
  };

  // 决策级但无专属前端视图——诚实位经 QOS/Agent 通用答案渲染器 + 共享 DataModeBadge 消费（前端 grep 0 专属引用）。
  const VIA_PROJECTION = "经 QOS/Agent 通用答案渲染器 + 共享 DataModeBadge 消费诚实位·无专属前端决策视图（前端 grep 0 专属引用）";
  const FRONTEND_EXEMPT = {
    capex_scenario: VIA_PROJECTION, cockpit_kpi: VIA_PROJECTION, quarterly_gap: VIA_PROJECTION,
    counterfactual_timeline: VIA_PROJECTION, cert_schedule: VIA_PROJECTION,
    kit_readiness: VIA_PROJECTION, lta_gap: VIA_PROJECTION, inventory_optimize: VIA_PROJECTION,
    changeover_sequence: VIA_PROJECTION, yield_diagnosis: VIA_PROJECTION, maintenance_stagger: VIA_PROJECTION,
    outsourcing_split: VIA_PROJECTION, quote_margin: VIA_PROJECTION, credit_exposure: VIA_PROJECTION,
    carbon_footprint: VIA_PROJECTION, countermeasure_combo: VIA_PROJECTION, what_if_displacement: VIA_PROJECTION,
    generic_inference: VIA_PROJECTION, shared_bottleneck: VIA_PROJECTION, concentration_risk: VIA_PROJECTION,
    margin_attribution: VIA_PROJECTION, supplier_disruption_radius: VIA_PROJECTION, selection_optimize: VIA_PROJECTION,
    assignment_optimize: VIA_PROJECTION, sequencing_optimize: VIA_PROJECTION, packing_optimize: VIA_PROJECTION,
    facility_location: VIA_PROJECTION, min_cost_flow: VIA_PROJECTION, set_cover: VIA_PROJECTION,
    independent_set: VIA_PROJECTION, combinatorial_auction: VIA_PROJECTION, optimize_whatif: VIA_PROJECTION,
    multisource_fusion: VIA_PROJECTION,
    // QUERY30 求解器·无专属前端决策视图（前端 grep 0 引用）·同 what_if_displacement/generic_inference 归类。
    multi_plan_compare: VIA_PROJECTION, causal_attribution: VIA_PROJECTION,
    // QUERY30-ORCH 横铺 A/B（Q30-P2/P3·8 求解器）·均无专属前端决策视图（前端 grep 0 引用）·经 QOS/Agent 通用答案渲染器 + DataModeBadge 消费诚实位。
    capex_alternatives: VIA_PROJECTION, full_cost_rollup: VIA_PROJECTION, signal_propagation: VIA_PROJECTION,
    cash_projection: VIA_PROJECTION, labor_balance: VIA_PROJECTION, energy_cost_schedule: VIA_PROJECTION,
    reroute_decision: VIA_PROJECTION, multi_constraint_schedule: VIA_PROJECTION,
  };

  const decisionKeys = allKeys.filter((k) => !(k in NON_DECISION_KEYS));

  // (a) 分类完整性：每个决策级键恰好落入 MAPPED 或 EXEMPT 其一（缺口=新增决策求解器未表态·红）。
  for (const k of decisionKeys) {
    const inMapped = k in FRONTEND_MAPPED;
    const inExempt = k in FRONTEND_EXEMPT;
    if (!inMapped && !inExempt) {
      fail(`C1 覆盖缺口：决策级求解器「${k}」未归类前端消费面 —— 补 FRONTEND_MAPPED['${k}']（有专属决策视图·须消费 dataMode）或 FRONTEND_EXEMPT['${k}']（无专属视图·经通用答案渲染器消费·附理由）；若非决策级则加入 NON_DECISION_KEYS 并注理由。`);
    }
    if (inMapped && inExempt) fail(`C1：决策级求解器「${k}」同时在 MAPPED 与 EXEMPT（分类冲突）。`);
  }
  // (b) 反漂移：MAPPED/EXEMPT/NON_DECISION 引用的键必须真在 registry（删/改名求解器即红）。
  for (const map of [FRONTEND_MAPPED, FRONTEND_EXEMPT, NON_DECISION_KEYS]) {
    for (const k of Object.keys(map)) {
      if (!allKeys.includes(k)) fail(`C1 漂移：覆盖表引用「${k}」已不在 SOLVER_REGISTRY（求解器删/改名·同步覆盖表）。`);
    }
  }
  // (c) 决策级子集端到端链：借读 SOLVER_OUTPUT_SHAPES 确认后端有 dataMode 位（存在性权威归 no-silent-mock；
  //     此处只把「后端有位→前端消费」串成决策级链，同向不打架）。
  for (const k of decisionKeys) {
    const shape = SOLVER_OUTPUT_SHAPES[k];
    if (shape && !shape.includes("dataMode")) {
      fail(`C1 链断：决策级「${k}」后端输出形状无 dataMode（前端无从分档；存在性权威门 no-silent-mock 亦应红）。`);
    }
  }
  // (d) MAPPED 前端消费面必读 dataMode/live 分档（破消费即红·扩齿超出①–⑨ 哨兵覆盖的视图如 SopBalanceView/KsfGraph）。
  for (const [k, files] of Object.entries(FRONTEND_MAPPED)) {
    for (const f of files) {
      const src = read(f);
      if (!/dataMode|isLiveDecision|notLiveDecision|\.live\b/.test(src)) {
        fail(`C1 前端漏消费：决策级「${k}」映射视图 ${f} 未读 dataMode/live 分档（诚实位裸渲染回潮）。`);
      }
    }
  }
  // (e) 中央决策门完整性：isLiveDecision 必严格 `dataMode === "LIVE"`（放宽如 !=="MOCK" 会放 SYNTHETIC 出决策红）。
  const decisionValue = read("apps/frontend-shell/src/components/DecisionValue.tsx");
  if (!/export function isLiveDecision[\s\S]{0,220}?return dataMode === "LIVE";/.test(decisionValue)) {
    fail('C1 中央门被放宽：DecisionValue.isLiveDecision 非严格 `return dataMode === "LIVE";`（放行非 LIVE 出决策红·全站决策面同时失守）。');
  }

  const mappedN = Object.keys(FRONTEND_MAPPED).length;
  const exemptN = Object.keys(FRONTEND_EXEMPT).length;
  if (!red) {
    console.log(`· genuine-sim §⑩ 覆盖：SOLVER_REGISTRY ${allKeys.length} 求解器 → 决策级 ${decisionKeys.length}（豁免非决策 ${Object.keys(NON_DECISION_KEYS).length}）；其中前端专属视图 ${mappedN} 个（消费 dataMode/live）+ 通用渲染器 ${exemptN} 个；分类完整无缺口。`);
  }
} catch (e) {
  fail(`C1 覆盖门：无法导入 dist SOLVER_REGISTRY/SOLVER_OUTPUT_SHAPES（先 pnpm --filter datacore build）：${e.message}`);
}

if (red) {
  console.error("\n✗ genuine-sim:check 未过：推演红/黄/数字疑似裸渲染当真值（假推演回潮）。修法：输出 schema 加 dataMode + 无真源不伪造决策红（risk.ts liveTightness 返 null·卡 hasData:false·planRows 只 live）+ 前端消费显估算/实测/空态；§⑩ 决策级求解器须归类前端消费面。");
  process.exit(1);
}
console.log("· genuine-sim：risk_timeline/capacity_forecast/bottleneck_matrix 输出带 dataMode；前端 RiskBoardView/ProjectSimView 消费 dataMode/live 显估算/实测；bottleneck 前端传 LIVE。");
console.log("✓ genuine-sim:check 通过（哨兵①–⑨ + §⑩ SOLVER_REGISTRY 全量决策级覆盖·分类完整）。");
