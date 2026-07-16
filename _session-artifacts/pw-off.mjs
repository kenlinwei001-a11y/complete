import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const SHOT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", headless: true, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
let preRespStatus = null;
page.on("response", (res) => { if (res.url().includes("/growth/pre-analysis/")) preRespStatus = res.status(); });
try {
  await page.goto("http://127.0.0.1:5201", { waitUntil: "networkidle" });
  await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="nav-business"]', { timeout: 15000 });
  await page.click('[data-testid="nav-business"]');
  await page.waitForSelector('input[aria-label="查询输入"]', { timeout: 15000 });
  await sleep(2500);
  await page.fill('input[aria-label="查询输入"]', "常州基地的瓶颈根因是什么");
  await page.press('input[aria-label="查询输入"]', "Enter");
  await page.waitForSelector('[data-testid="intent-none"]', { timeout: 20000 });
  await page.click('[data-testid="intent-none"]');
  await page.waitForSelector('[data-testid="gap-card"]', { timeout: 25000 });
  await sleep(3000); // give panorama a chance to (not) appear
  const rep = await page.evaluate(() => ({
    hasPanorama: !!document.querySelector('[data-testid="gap-panorama"]'),
    hasCoverageRing: !!document.querySelector('[data-testid="coverage-ring"]'),
    hasSevBadge: !!document.querySelector('[data-testid^="gap-panorama-sev-"]'),
    gapCode: document.querySelector('[data-testid="gap-code"]')?.textContent,
    gapVerdict: document.querySelector('[data-testid="gap-card"] [class*="gapVerdict"]')?.textContent,
    gapTriggerPresent: !!document.querySelector('[data-testid="gap-trigger"]'),
    gapTriggerText: document.querySelector('[data-testid="gap-trigger"]')?.textContent?.trim(),
    gapCardText: document.querySelector('[data-testid="gap-card"]')?.innerText,
    gapCardHtml: document.querySelector('[data-testid="gap-card"]')?.innerHTML?.length,
  }));
  await (await page.$('[data-testid="gap-card"]'))?.screenshot({ path: `${SHOT}/pw-off-gapcard.png` });
  console.log("===== FEATURE-OFF (V7 / rollback) REPORT =====");
  console.log("pre-analysis network status seen:", preRespStatus, "(expect 404 or none)");
  console.log(JSON.stringify(rep, null, 2));
  console.log("\nV7/ROLLBACK browser PASS:", !rep.hasPanorama && !rep.hasCoverageRing && !rep.hasSevBadge && !!rep.gapCode && rep.gapTriggerPresent);
} catch (e) {
  console.log("ERROR:", e.message);
  await page.screenshot({ path: `${SHOT}/pw-off-error.png`, fullPage: true }).catch(()=>{});
} finally { await browser.close(); }
