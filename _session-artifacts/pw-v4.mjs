import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const SHOT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", headless: true, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();

// V4: force the pre-analysis endpoint to return status FAILED (this state is real per backend
// catch-branch but hard to trigger naturally with mock LLM). We intercept at the network boundary
// to render the frontend FAILED branch against the REAL built component.
await page.route("**/growth/pre-analysis/**", async (route) => {
  const url = route.request().url();
  const taskId = decodeURIComponent(url.split("/pre-analysis/")[1].split(/[?#]/)[0]);
  await route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ taskId, tenantId: "demo", query: "常州基地的瓶颈根因是什么", status: "FAILED", error: "forced-failed-for-V4", createdAt: new Date().toISOString() }) });
});

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
  await page.waitForSelector('[data-testid="gap-panorama"][data-status="FAILED"]', { timeout: 15000 });
  const rep = await page.evaluate(() => {
    const pano = document.querySelector('[data-testid="gap-panorama"]');
    const retry = [...(pano?.querySelectorAll("button") ?? [])].find(b => /重试/.test(b.textContent));
    // QOS answer body still present?
    return {
      panoStatus: pano?.getAttribute("data-status"),
      panoText: pano?.querySelector("span")?.textContent,
      retryBtnPresent: !!retry, retryBtnText: retry?.textContent?.trim(),
      hasCoverageRing: !!document.querySelector('[data-testid="coverage-ring"]'),
      hasSevBadge: !!document.querySelector('[data-testid^="gap-panorama-sev-"]'),
      // QOS answer照常: reactive gap body present
      gapCode: document.querySelector('[data-testid="gap-code"]')?.textContent,
      gapTriggerPresent: !!document.querySelector('[data-testid="gap-trigger"]'),
      answerBodyText: document.querySelector('[data-testid="gap-card"]')?.innerText?.slice(0,200),
    };
  });
  await (await page.$('[data-testid="gap-card"]'))?.screenshot({ path: `${SHOT}/pw-v4-failed.png` });
  console.log("===== V4 FAILED REPORT =====");
  console.log(JSON.stringify(rep, null, 2));
  console.log("\nV4 PASS:", rep.panoStatus === "FAILED" && rep.retryBtnPresent && /暂时不可用/.test(rep.panoText||"") && !!rep.gapCode && rep.gapTriggerPresent && !rep.hasCoverageRing && !rep.hasSevBadge);
} catch (e) {
  console.log("ERROR:", e.message);
  await page.screenshot({ path: `${SHOT}/pw-v4-error.png`, fullPage: true }).catch(()=>{});
} finally { await browser.close(); }
