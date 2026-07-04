// FDE 实拍：INDUSTRY-PACK-CONVERGE C3 非电池行业活体。真后端(datacore:4051·logi 租户)+真浏览器(vite:5200)。
// 登录 logi/admin/demo1234 → 渲染其 pack 驱动的非电池视图（配送网络看板 + 决策场景）→ KPI 逐值对后端聚合。
import { chromium } from "playwright-core";
const FRONT = process.env.FRONT || "http://127.0.0.1:5200";
const EVID = process.env.EVID || "docs/evidence";
// 后端权威值（curl /a/v1/objects/aggregate 实测）——UI 逐值须等于这些。
const BACKEND = {
  "store-count": { raw: 10, disp: "10" },
  "wh-count": { raw: 6, disp: "6" },
  "demand-total": { raw: 1330, disp: "1,330" },
  "capacity-total": { raw: 12410, disp: "12,410" },
  "avg-serve-cost": { raw: 12.866667, disp: "12.87" },
  "avg-open-cost": { raw: 209.5, disp: "209.50" },
};
let failed = false;
const ok = (m) => console.log("✅", m);
const bad = (m) => { console.log("❌", m); failed = true; };

const b = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
try {
  await p.goto(`${FRONT}/`, { waitUntil: "networkidle" });
  await p.fill("#login-tenant", "logi");
  await p.fill("#login-username", "admin");
  await p.fill("#login-password", "demo1234");
  await p.click("button[type=submit]");
  await p.waitForTimeout(2500);
  ok(`已登录 logi/admin（url=${p.url()}）`);

  // SPA 内导航到配送网络看板（token 在内存·pushState 不整页重载）
  await p.evaluate(() => window.history.pushState({}, "", "/v/logi-network"));
  await p.waitForTimeout(500);
  await p.evaluate(() => window.dispatchEvent(new PopStateEvent("popstate")));
  await p.waitForTimeout(3500);

  const bodyTxt = await p.locator("body").innerText();
  // 非电池断言：不得出现电池业务词
  for (const t of ["乘用车", "储能", "商用车", "规划体检", "订单全链"]) {
    if (bodyTxt.includes(t)) bad(`页面泄露电池业务词「${t}」（应为纯非电池物流视图）`);
  }
  if (!failed) ok("非电池断言过：无 乘用车/储能/商用车/规划体检/订单全链 泄露");
  // 页面应含物流 KPI 标题
  for (const t of ["配送仓", "门店", "配送需求"]) {
    if (bodyTxt.includes(t)) ok(`物流 KPI 标题在页：「${t}」`); else bad(`缺物流 KPI 标题「${t}」`);
  }

  // 逐 KPI 值对后端
  for (const [key, exp] of Object.entries(BACKEND)) {
    const w = p.locator(`[data-testid="widget-${key}"]`);
    if (await w.count() === 0) { bad(`缺 widget-${key}`); continue; }
    const txt = (await w.innerText()).replace(/\s+/g, " ").trim();
    // KPI 值节点
    const valNode = w.locator(".kpiValue, [class*=kpiValue]");
    const valTxt = (await valNode.count()) ? (await valNode.first().innerText()).replace(/\s+/g, " ").trim() : txt;
    if (valTxt.includes(exp.disp)) ok(`KPI ${key} UI 显示「${valTxt}」== 后端 ${exp.raw}（逐值一致）`);
    else bad(`KPI ${key} UI「${valTxt}」≠ 后端期望「${exp.disp}」(raw ${exp.raw})`);
  }
  await p.screenshot({ path: `${EVID}/industry-pack-logi-network.png`, fullPage: true });
  ok("截图 industry-pack-logi-network.png");

  // 决策场景视图
  await p.evaluate(() => window.history.pushState({}, "", "/v/decision-scenarios"));
  await p.waitForTimeout(500);
  await p.evaluate(() => window.dispatchEvent(new PopStateEvent("popstate")));
  await p.waitForTimeout(3000);
  const scTxt = await p.locator("body").innerText();
  const q1 = "全网需覆盖多少月度配送需求量";
  const q2 = "各候选配送仓的开仓成本";
  if (scTxt.includes(q1)) ok(`决策场景卡1问句在页：「${q1}…」`); else bad("缺场景卡1问句");
  if (scTxt.includes(q2)) ok(`决策场景卡2问句在页：「${q2}…」`); else bad("缺场景卡2问句");
  // 场景1答案 = sum(Store.demand)=1330 应可见
  const sc1 = p.locator('[data-testid="widget-sc-network-demand"]');
  if (await sc1.count()) {
    const v = (await sc1.innerText()).replace(/\s+/g, " ").trim();
    if (v.includes("1,330") || v.includes("1330")) ok(`场景卡1答案 UI「${v}」== 后端 sum(demand)=1330（可答·逐值一致）`);
    else bad(`场景卡1答案「${v}」≠ 1330`);
  } else bad("缺场景卡1 widget");
  await p.screenshot({ path: `${EVID}/industry-pack-logi-scenarios.png`, fullPage: true });
  ok("截图 industry-pack-logi-scenarios.png");
} catch (e) {
  bad(`异常：${e.message}\n${e.stack}`);
} finally {
  await b.close();
}
process.exit(failed ? 1 : 0);
