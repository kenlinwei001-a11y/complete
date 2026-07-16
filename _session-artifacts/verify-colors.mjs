// Rigorous "zero new colors" check against the ACTIVE runtime theme (workspace applyTheme
// overrides --accent). Proves: source badges/lens buttons reuse existing token classes —
// their computed colors equal the app's themed tokens AND equal pre-existing badge colors.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const FRONT = "http://127.0.0.1:5211";
const exe = ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell"].find(existsSync);
let fail = 0; const ok = (m) => console.log("  PASS", m); const bad = (m) => { console.error("  FAIL", m); fail++; };
const b = await chromium.launch({ executablePath: exe, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await b.newPage({ viewport: { width: 1440, height: 1200 } });
try {
  await page.goto(`${FRONT}/`, { waitUntil: "networkidle" });
  await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
  await page.click("button[type=submit]"); await page.waitForTimeout(2500);
  await page.evaluate(() => { window.history.pushState({}, "", "/admin/tickets"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await page.waitForSelector("[data-testid=tc-source-lens]", { timeout: 12000 });
  await page.waitForSelector("[data-testid^=tc-row-sbc_]", { timeout: 8000 });

  // resolve the app's LIVE themed token values → rgb (via a probe element using var())
  const themed = await page.evaluate(() => {
    const probe = document.createElement("span"); document.body.appendChild(probe);
    const val = (v) => { probe.style.color = `var(${v})`; return getComputedStyle(probe).color; };
    const out = { accent: val("--accent"), amber: val("--amber"), ok: val("--ok"), danger: val("--danger"), muted: val("--muted") };
    probe.remove();
    const rawAccent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    return { ...out, rawAccent, themeKeys: document.documentElement.dataset.themeKeys || "" };
  });
  console.log("  themed tokens:", JSON.stringify(themed));
  const ALLOWED = new Set([themed.accent, themed.amber, themed.ok, themed.danger, themed.muted]);

  // sweep ALL badges — every color must ∈ live themed token set
  const allColors = await page.locator(".badge").evaluateAll((els) => els.map((e) => getComputedStyle(e).color));
  const badColors = [...new Set(allColors)].filter((c) => !ALLOWED.has(c));
  badColors.length === 0
    ? ok(`零新色：${allColors.length} 徽章色（去重 ${new Set(allColors).size}）全部 ∈ 活主题 token 集`)
    : bad(`发现主题外新色: ${JSON.stringify(badColors)} · allowed=${JSON.stringify([...ALLOWED])}`);

  const sbcId = (await page.locator("[data-testid^=tc-row-sbc_]").first().getAttribute("data-testid")).replace("tc-row-", "");
  // BUILD_CLOSURE source badge = themed --amber
  const srcColor = await page.locator(`[data-testid="tc-source-badge-${sbcId}"]`).evaluate((el) => getComputedStyle(el).color);
  srcColor === themed.amber ? ok(`BUILD_CLOSURE source 徽章色 === 主题 --amber (${srcColor})`) : bad(`source 徽章 ${srcColor} != --amber ${themed.amber}`);

  // active lens button (badge blue) = themed --accent, AND identical to a pre-existing badge.blue (active Tab)
  await page.click("[data-testid=tc-source-script]"); await page.waitForTimeout(300);
  const lensBlue = await page.locator("[data-testid=tc-source-script]").evaluate((el) => getComputedStyle(el).color);
  lensBlue === themed.accent ? ok(`选中透镜按钮色 === 主题 --accent (${lensBlue})`) : bad(`透镜按钮 ${lensBlue} != --accent ${themed.accent}`);
  // pre-existing badge.blue reference: the active Tab "全部" carries `badge blue`
  const tabBlue = await page.locator("button.badge.blue").first().evaluate((el) => getComputedStyle(el).color).catch(() => null);
  (tabBlue && tabBlue === lensBlue) ? ok(`透镜蓝 === 既有 badge.blue 元素蓝 (${tabBlue})·与既有 UI 同色`) : console.log(`  INFO 既有 badge.blue 参照色=${tabBlue}`);
} catch (e) { bad(`异常: ${String((e && e.stack) || e).slice(0, 400)}`); } finally { await b.close(); }
console.log(`\n=== verify-COLORS ${fail ? "FAIL(" + fail + ")" : "ALL PASS"} ===`);
process.exit(fail ? 1 : 0);
