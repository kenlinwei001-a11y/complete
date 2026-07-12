// WO-CAPSIM-IA-UNIFY M1 · 真浏览器：①左导航无「推演沙盘」 ②裸访问 /v/sim-sandbox → 302 产能推演(/v/risk)。
import { chromium } from "playwright-core";
const FRONT = process.env.FRONT ?? "http://localhost:5175";
const CHROME = process.env.CHROME;
const results = []; const ok = (m) => { results.push(1); console.log("✅", m); }; const bad = (m) => { results.push(0); console.log("❌", m); };
const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  await page.goto(`${FRONT}/`, { waitUntil: "networkidle" });
  await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
  await page.click("button[type=submit]"); await page.waitForTimeout(2000);
  page.url().endsWith("/login") ? bad("登录失败") : ok("真登录成功");
  // ① 左导航无「推演沙盘」/「推演初始化向导」（demo battery all-on·sim.sandbox 开也应无）
  await page.waitForSelector("[data-testid=nav-business]", { timeout: 10000 });
  const navSandbox = await page.locator("[data-testid=nav-sim-sandbox]").count();
  const navInit = await page.locator("[data-testid=nav-sim-init]").count();
  const navText = await page.locator("[data-testid=nav-business]").innerText();
  (navSandbox === 0 && navInit === 0 && !navText.includes("推演沙盘"))
    ? ok("左导航无「推演沙盘/推演初始化向导」（验收①·唯一 surface 收敛）")
    : bad(`左导航仍有沙盘项：sandbox=${navSandbox} init=${navInit}`);
  // 产能推演仍在推演组
  navText.includes("产能推演") ? ok("推演组仍含「产能推演」（唯一 surface 入口在）") : bad("产能推演入口缺失");
  await page.screenshot({ path: "docs/evidence/CAPSIM-IA-UNIFY-M1-nav.png", clip: { x: 0, y: 0, width: 260, height: 1000 } });
  ok("截图 nav（无沙盘项）docs/evidence/CAPSIM-IA-UNIFY-M1-nav.png");
  // ② 裸访问 /v/sim-sandbox → 落回产能推演 /v/risk
  await page.goto(`${FRONT}/v/sim-sandbox`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const landed = page.url();
  landed.includes("/v/risk")
    ? ok(`裸访问 /v/sim-sandbox → 302 落回产能推演（${landed.split("#").pop() || landed}·验收②）`)
    : bad(`裸访问未重定向：${landed}`);
  await page.screenshot({ path: "docs/evidence/CAPSIM-IA-UNIFY-M1-redirect.png", fullPage: false });
  ok("截图重定向落地 docs/evidence/CAPSIM-IA-UNIFY-M1-redirect.png");
  // ③ /v/risk?focus=changzhou → 看板真裁剪到该基地（scope=该基地）
  await page.goto(`${FRONT}/v/risk?focus=changzhou`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  const focusBar = await page.locator("[data-testid=risk-scope-focus]").count();
  const focusBase = focusBar ? await page.locator("[data-testid=risk-scope-focus]").getAttribute("data-focus-base") : null;
  (focusBar > 0 && focusBase === "changzhou")
    ? ok(`/v/risk?focus=changzhou → 看板真裁剪到常州（聚焦提示 data-focus-base=changzhou·验收③ scope=该基地）`)
    : bad(`focus scope 未生效：bar=${focusBar} base=${focusBase}`);
  await page.screenshot({ path: "docs/evidence/CAPSIM-IA-UNIFY-M2-focus-scope.png", fullPage: false });
  ok("截图 focus scope docs/evidence/CAPSIM-IA-UNIFY-M2-focus-scope.png");
} catch (e) { bad("异常：" + (e?.message ?? e)); } finally { await browser.close(); }
const pass = results.filter(Boolean).length;
console.log(`\n${pass === results.length ? "✅ 全绿" : "❌ 有红"}：${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
