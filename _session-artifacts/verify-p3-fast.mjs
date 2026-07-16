import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1700, height: 1200 } })).newPage();
const TO = { timeout: 1500 };
const txt = async (sel) => { try { return ((await page.locator(sel).first().textContent(TO)) || "").trim(); } catch { return "<缺>"; } };
const txtIn = async (root, sel) => { try { return ((await root.locator(sel).first().textContent(TO)) || "").trim(); } catch { return "<缺>"; } };
const val = async (sel) => { try { return (await page.locator(sel).first().inputValue(TO)) || ""; } catch { return "<缺>"; } };
const at = async (root, sel, a) => { try { return await root.locator(sel).first().getAttribute(a, TO); } catch { return "?"; } };
const cnt = async (sel) => await page.locator(sel).count();

await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 }); await sleep(1000);

const oracle = { Order: { wc: 83, lvl: "L1_CONFIGURED" }, Base: { wc: 65, lvl: "L4_CERTIFIED" }, Line: { wc: 100, lvl: "L4_CERTIFIED" } };
const R = {};
for (const K of ["Order", "Base", "Line"]) {
  await page.evaluate(() => { window.history.pushState({}, "", "/admin/modeling"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await sleep(3200);
  // DAG details 默认折叠 → 幂等确保展开（pushState 不重挂·open 跨轮残留，故按实际 open 态决定，不盲 toggle）
  const details = page.locator('[data-testid="modeling-pipeline-dag"]');
  const isOpen = await details.evaluate((el) => el.open).catch(() => false);
  if (!isOpen) { await page.locator('[data-testid="modeling-pipeline-dag"] summary').click().catch(() => {}); await sleep(700); }
  const node = page.locator(`[data-testid="pp-ty-${K}"]`);
  if (!(await node.count())) { R[K] = { err: "DAG节点缺" }; continue; }
  await node.click({ force: true });
  // 等抽屉就绪面板里的 gauge 出现（最多 ~4s）
  const drawer = page.locator(`[data-testid="objcfg-readiness"]`);
  let ok = false;
  for (let i = 0; i < 16; i++) { if (await drawer.locator('[data-testid="sim-cert-gauge-pct"]').count()) { ok = true; break; } await sleep(250); }
  const gauge = ok ? await txtIn(drawer, '[data-testid="sim-cert-gauge-pct"]') : "<gauge未现>";
  const dims = await txtIn(drawer, 'text=综合');
  const lvlCur = await at(drawer, `[data-testid="sim-cert-step-${oracle[K].lvl}"]`, "data-current");
  const drawerBox = await cnt(`[data-testid="obj-config-${K}"]`);
  const label = await val('[data-testid="objcfg-label"]');
  const keyv = await val('[data-testid="objcfg-key"]');
  const propRows = await cnt('[data-testid="objcfg-prop-table"] tbody tr');
  const editNote = (await txt('[data-testid="objcfg-edit-note"]')).slice(0, 70);
  const domainEdit = await cnt('[data-testid="objcfg-domain-edit"]');
  const domainRO = await cnt('[data-testid="objcfg-domain-ro"]');
  const reservedTabs = await cnt('[data-testid^="objcfg-tab-reserved-"]');
  const reservedFields = await cnt('[data-testid="objcfg-reserved-fields"]');
  R[K] = { gauge, dims, lvlCur, drawerBox, label, keyv, propRows, editNote, domainEdit, domainRO, reservedTabs, reservedFields };
  if (K === "Order") await page.screenshot({ path: `${OUT}/p3-order.png`, fullPage: true });
  // 关抽屉：Escape
  await page.keyboard.press("Escape").catch(() => {});
  await sleep(400);
}
await browser.close();
console.log("=== 轨P 增量3 取证（快版）===");
for (const K of ["Order", "Base", "Line"]) {
  const r = R[K]; if (r.err) { console.log(`【${K}】${r.err}`); continue; }
  const o = oracle[K];
  console.log(`【${K}】box=${r.drawerBox} gauge=${r.gauge}(oracle ${o.wc}%)${r.gauge === o.wc + "%" ? "✓" : "✗"} lvl当前=${r.lvlCur}(${o.lvl}) | ${r.dims}`);
  console.log(`      label=${r.label} key=${r.keyv} 属性行=${r.propRows} | domain edit${r.domainEdit}/ro${r.domainRO} | RESERVED tab${r.reservedTabs}/字段${r.reservedFields}`);
  console.log(`      编辑说明: ${r.editNote}`);
}
const g = ["Order", "Base", "Line"].map((K) => R[K]?.gauge);
console.log("三 gauge:", JSON.stringify(g), "全不同:", new Set(g).size === 3 ? "✓逐对象真差异" : "✗有重复");
