#!/usr/bin/env node
/**
 * 门A · 经营驾驶舱 PRD↔widget 覆盖对账（防"PRD 要求的区块没上页"遗漏 + 后端/mock 两套 DASH_LAYOUT 漂移）。
 * 由来：曾判"经营驾驶舱完成"却漏了 order-ledger/plan-drill 整块 widget（PRD §2.1/§3.3 明确要求）——
 * jsdom 测试只测"渲染了的"，测不出"该有却没有的"。本门静态对账 PRD 必备区块 vs 实际下发/渲染。
 *
 * 校验三处一致：① 后端 DASH_LAYOUT（datacore service.ts）② mock DASH_LAYOUT（前端 fixtures.ts）
 * ③ 渲染器（DashboardView.tsx 渲染分支 + 组件区块）。任一缺失即红。
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
  console.error(`⛔ check-cockpit-widgets.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


import { readFileSync } from "node:fs";

// PRD-cockpit §2.1/§3.3 经营驾驶舱必备 widget type（声明式下发 + 渲染分支须有）。
const REQUIRED_WIDGET_TYPES = ["kpi", "metric-strip", "dag", "counterfactual", "version-toggle", "order-ledger", "plan-drill"];
// PRD §2.1 必备组件区块（DashboardView 内非 widget 的专用区块，testid 锚定）。
const REQUIRED_COMPONENTS = ["dash-problems", "dash-feedback-chain", "dash-modules", "dash-export"];

const read = (f) => {
  try {
    return readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  } catch {
    return null;
  }
};
const backend = read("apps/datacore/src/synthetic/service.ts");
const mock = read("apps/frontend-shell/src/mocks/fixtures.ts");
const view = read("apps/frontend-shell/src/views/DashboardView.tsx");

let red = false;
const fail = (m) => {
  console.error(`✗ ${m}`);
  red = true;
};
if (!backend) fail("读不到后端 service.ts");
if (!mock) fail("读不到前端 fixtures.ts");
if (!view) fail("读不到 DashboardView.tsx");

for (const t of REQUIRED_WIDGET_TYPES) {
  const re = new RegExp(`type:\\s*"${t}"`);
  if (backend && !re.test(backend)) fail(`后端 DASH_LAYOUT 缺必备 widget type「${t}」（PRD §3.3）`);
  if (mock && !re.test(mock)) fail(`mock DASH_LAYOUT（fixtures.ts）缺 widget type「${t}」（与后端漂移）`);
  if (view && !view.includes(`"${t}"`)) fail(`DashboardView 渲染分支缺 widget type「${t}」`);
}
for (const c of REQUIRED_COMPONENTS) {
  if (view && !view.includes(c)) fail(`DashboardView 缺必备组件区块「${c}」（PRD §2.1）`);
}

if (red) {
  console.error("\n✗ cockpit-widgets:check 未通过：经营驾驶舱缺 PRD 必备区块，或后端/mock 两套 DASH_LAYOUT 漂移。");
  process.exit(1);
}
console.log(`✓ cockpit-widgets:check：${REQUIRED_WIDGET_TYPES.length} 必备 widget type（后端/mock/渲染三处齐）+ ${REQUIRED_COMPONENTS.length} 组件区块全覆盖，无漂移。`);
