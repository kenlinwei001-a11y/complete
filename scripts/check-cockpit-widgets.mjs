#!/usr/bin/env node
/**
 * 门A · 经营驾驶舱 PRD↔widget 覆盖对账（防"PRD 要求的区块没上页"遗漏 + 后端/mock 两套 DASH_LAYOUT 漂移）。
 * 由来：曾判"经营驾驶舱完成"却漏了 order-ledger/plan-drill 整块 widget（PRD §2.1/§3.3 明确要求）——
 * jsdom 测试只测"渲染了的"，测不出"该有却没有的"。本门静态对账 PRD 必备区块 vs 实际下发/渲染。
 *
 * 校验三处一致：① 后端 DASH_LAYOUT（datacore service.ts）② mock DASH_LAYOUT（前端 fixtures.ts）
 * ③ 渲染器（DashboardView.tsx 渲染分支 + 组件区块）。任一缺失即红。
 */
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
