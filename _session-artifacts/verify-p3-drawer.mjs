import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1700, height: 1200 } })).newPage();
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(1200);

const oracle = { Order: { wc: 83, comp: 100, know: 100, beh: 100, lvl: "L1_CONFIGURED" },
                 Base:  { wc: 65, comp: 100, know: 100, beh: 100, lvl: "L4_CERTIFIED" },
                 Line:  { wc: 100, comp: 45, know: 17, beh: 0, lvl: "L4_CERTIFIED" } };
const results = {};
for (const K of ["Order", "Base", "Line"]) {
  // 每对象新导航（避免 modal 关闭依赖）
  await page.evaluate(() => { window.history.pushState({}, "", "/admin/modeling"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await sleep(3500);
  // 点 DAG 实体节点开抽屉
  const node = page.locator(`[data-testid="pp-ty-${K}"]`);
  const nodeExists = await node.count();
  if (!nodeExists) { results[K] = { err: "DAG节点不存在" }; continue; }
  await node.click({ force: true }); await sleep(2500); // 等抽屉 + 逐对象 cert 加载
  const drawer = page.locator(`[data-testid="objcfg-readiness"]`);
  const drawerExists = await drawer.count();
  // 严格 scope 到抽屉内的 gauge / dims（非全局面板）
  const gauge = drawerExists ? ((await drawer.locator('[data-testid="sim-cert-gauge-pct"]').first().textContent().catch(() => "")) || "").trim() : "<无抽屉>";
  const dims = drawerExists ? ((await drawer.locator('text=综合').first().textContent().catch(() => "")) || "").trim() : "";
  const lvlCur = drawerExists ? await drawer.locator(`[data-testid="sim-cert-step-${oracle[K].lvl}"]`).getAttribute("data-current").catch(() => "?") : "?";
  const target = drawerExists ? ((await page.locator(`[data-testid="obj-config-${K}"]`).count()) ? "obj-config-"+K : "") : "";
  // 抽屉表单 + 表
  const label = ((await page.locator('[data-testid="objcfg-label"]').inputValue().catch(() => "")) || "");
  const key = ((await page.locator('[data-testid="objcfg-key"]').inputValue().catch(() => "")) || "");
  const propRows = await page.locator('[data-testid="objcfg-prop-table"] tbody tr').count();
  const editNote = ((await page.locator('[data-testid="objcfg-edit-note"]').textContent().catch(() => "")) || "").slice(0, 60);
  const domainEdit = await page.locator('[data-testid="objcfg-domain-edit"]').count();
  const domainRO = await page.locator('[data-testid="objcfg-domain-ro"]').count();
  const reservedTabs = await page.locator('[data-testid^="objcfg-tab-reserved-"]').count();
  results[K] = { gauge, dims, lvlCur, target, label, key, propRows, editNote, domainEdit, domainRO, reservedTabs };
  if (K === "Order") await page.screenshot({ path: `${OUT}/p3-drawer-order.png`, fullPage: true });
}
await browser.close();

console.log("=== 轨P 增量3 真浏览器取证（逐对象抽屉）===");
for (const K of ["Order", "Base", "Line"]) {
  const r = results[K]; const o = oracle[K];
  if (r.err) { console.log(`【${K}】${r.err}`); continue; }
  const gOk = r.gauge === `${o.wc}%`;
  console.log(`【${K}】抽屉=${r.target} | gauge=${r.gauge}(oracle ${o.wc}%)${gOk ? "✓" : "✗"} | lvl当前=${r.lvlCur}(${o.lvl}) | ${r.dims}`);
  console.log(`      标签=${r.label} key=${r.key} 属性行=${r.propRows} | 归域:edit${r.domainEdit}/ro${r.domainRO} reservedTab=${r.reservedTabs}`);
  console.log(`      编辑说明: ${r.editNote}`);
}
const gauges = ["Order", "Base", "Line"].map(K => results[K]?.gauge);
console.log("三对象 gauge:", JSON.stringify(gauges), "| 全不同:", new Set(gauges).size === 3 ? "✓ 逐对象真差异" : "✗ 有重复");
