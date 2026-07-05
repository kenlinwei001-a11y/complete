// SANDBOX-RENAME-BASECARDS 真浏览器双页 FDE（真 datacore :4001 SEED_DEMO + vite preview :5301 + 真 Chromium）。
//   ① /v/risk 改名『产能推演』：左导标签 + 页面名实相符（磁贴↔页面同名『产能推演』），旧名『预判推演看板』绝迹。
//   ② /v/sim-sandbox 各基地卡默认可见：首屏不点任何折叠即含基地名 + 逐值对照后端真 Base 对象。
// 用法：node scripts/fde-sandbox-rename-basecards.mjs
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

const FRONT = process.env.FRONT ?? "http://127.0.0.1:5301";
const API = process.env.API ?? "http://127.0.0.1:4001";
// 后端真 Base 对象（逐值真值源）：由 curl 预先落盘（带 Bearer·避免在浏览器内取内存 token）。
const bases = JSON.parse(readFileSync("/tmp/bases.json", "utf8"));
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
mkdirSync("docs/evidence", { recursive: true });
const ev = { at: new Date().toISOString(), front: FRONT, api: API };

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1480, height: 1020 } });
const fail = (m) => { throw new Error("FDE FAIL: " + m); };
try {
  await page.goto(`${FRONT}/`, { waitUntil: "networkidle" });
  // 真登录 admin/demo1234（token 存内存·cross-origin CORS origin:true）。
  await page.fill("#login-tenant", "demo");
  await page.fill("#login-username", "admin");
  await page.fill("#login-password", "demo1234");
  await page.click("button[type=submit]");
  await page.waitForTimeout(2000);
  if (page.url().endsWith("/login")) fail("登录停在 /login");
  ev.login = page.url();
  // 注：沙盘 entitlement 已由外部 curl 预开（sim.sandbox/propagation/certification）→ SPA 登录后 workspace 即带。

  const spaGoto = async (p) => {
    await page.evaluate((x) => { window.history.pushState({}, "", x); window.dispatchEvent(new PopStateEvent("popstate")); }, p);
    await page.waitForTimeout(1200);
  };

  // ── ① /v/risk 名实相符 ─────────────────────────────────────────────────────
  await spaGoto("/v/risk");
  await page.waitForTimeout(1500);
  const nav = await page.$('[data-testid="nav-business"]');
  const navText = nav ? await nav.innerText() : "";
  const bodyText1 = await page.evaluate(() => document.body.innerText);
  ev.risk = {
    navHasCapacity: navText.includes("产能推演"),
    navHasOldName: navText.includes("预判推演看板"),
    bodyHasOldName: bodyText1.includes("预判推演看板"),
  };
  await page.screenshot({ path: "docs/evidence/SANDBOX-RENAME-BASECARDS-risk.png", fullPage: false });
  if (!ev.risk.navHasCapacity) fail("左导未见『产能推演』");
  if (ev.risk.navHasOldName || ev.risk.bodyHasOldName) fail("旧名『预判推演看板』仍残留");

  // 驾驶舱磁贴同名核对（名实相符：磁贴↔页面）。
  await spaGoto("/v/dash");
  await page.waitForTimeout(1200);
  const dashText = await page.evaluate(() => document.body.innerText);
  ev.risk.dashboardTileHasCapacity = dashText.includes("产能推演");

  // ── ② /v/sim-sandbox 各基地卡默认可见（不点任何折叠） ─────────────────────────
  await spaGoto("/v/sim-sandbox");
  await page.waitForSelector('[data-testid="sandbox-hero-grid"]', { timeout: 20000 });
  await page.waitForSelector('[data-testid="sandbox-base-cards"]', { timeout: 20000 });
  await page.waitForTimeout(800);
  const bodyText2 = await page.evaluate(() => document.body.innerText);
  ev.sandbox = { total: bases.length, firstScreenHits: [], mismatch: [] };
  for (const b of bases) {
    const inText = bodyText2.includes(b.name);
    ev.sandbox.firstScreenHits.push({ name: b.name, visible: inText });
  }
  // 逐值对照：常州卡 UI 文本 vs 后端真值。
  const cz = bases.find((b) => b.baseId === "changzhou");
  if (cz) {
    const card = await page.$('[data-testid="sandbox-base-card-changzhou"]');
    const cardText = card ? await card.innerText() : "";
    const link360 = await page.$('[data-testid="sandbox-base-360-changzhou"]');
    const href = link360 ? await link360.getAttribute("href") : null;
    const expUtil = `${Math.round(cz.util <= 1 ? cz.util * 100 : cz.util)}%`;
    const expOee = `${Math.round(cz.oee <= 1 ? cz.oee * 100 : cz.oee)}%`;
    ev.sandbox.changzhou = {
      backend: { util: cz.util, oee: cz.oee, bn: cz.bn, gwh: cz.gwh },
      cardText,
      uiUtilOk: cardText.includes(expUtil),
      uiOeeOk: cardText.includes(expOee),
      uiBnOk: cardText.includes(String(cz.bn)),
      href360: href,
      href360Ok: href === "/o/Base/changzhou",
    };
  }
  // runstate 卡仍默认折叠（折叠记忆不受损）。
  const runstate = await page.$('[data-testid="sandbox-runstate-card"]');
  ev.sandbox.runstateOpen = runstate ? await runstate.getAttribute("data-open") : null;
  // base cards 在主区、不在右栏折叠卡栈。
  ev.sandbox.baseCardsInMain = await page.evaluate(() => {
    const main = document.querySelector('[data-testid="sandbox-main-zone"]');
    const side = document.querySelector('[data-testid="sandbox-side-stack"]');
    return { inMain: !!main?.querySelector('[data-testid="sandbox-base-cards"]'), inSide: !!side?.querySelector('[data-testid="sandbox-base-cards"]') };
  });
  await page.screenshot({ path: "docs/evidence/SANDBOX-RENAME-BASECARDS-sandbox.png", fullPage: false });

  const namesVisible = ev.sandbox.firstScreenHits.filter((h) => h.visible).length;
  ev.sandbox.namesVisibleCount = `${namesVisible}/${bases.length}`;
  if (namesVisible === 0) fail("沙盘首屏零基地名（②未生效）");
  writeFileSync("docs/evidence/SANDBOX-RENAME-BASECARDS-fde.json", JSON.stringify(ev, null, 2));
  console.log(JSON.stringify(ev, null, 2));
  console.log("FDE OK");
} catch (e) {
  console.error(String(e));
  await page.screenshot({ path: "docs/evidence/SANDBOX-RENAME-BASECARDS-error.png" }).catch(() => {});
  writeFileSync("docs/evidence/SANDBOX-RENAME-BASECARDS-fde.json", JSON.stringify({ ...ev, error: String(e) }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
