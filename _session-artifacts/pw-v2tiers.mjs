import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const SHOT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

// each tier: inject a pre-analysis with the given coverageScore + N WARNING gaps (real frontend renders it)
async function runTier({ score, warnCount, expectColor, label }) {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.route("**/growth/pre-analysis/**", async (route) => {
    const taskId = decodeURIComponent(route.request().url().split("/pre-analysis/")[1].split(/[?#]/)[0]);
    const items = Array.from({ length: warnCount }, (_, i) => ({ key: `Gap${i}`, status: "TO_CREATE", severity: "WARNING" }));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      taskId, tenantId: "demo", query: "q", status: "DONE",
      gapAnalysis: { entries: [{ kind: "ontology_type", side: "structure", needed: warnCount, existing: 0, toCreate: warnCount, missing: 0, items }], totals: { needed: warnCount, existing: 0, toCreate: warnCount, missing: 0, coverageScore: score }, generatedAt: "2026-01-01T00:00:00Z" },
      summary: { totalGaps: warnCount, autoFixable: warnCount, manualRequired: 0, developRequired: 0, coverageScore: score, executionSteps: 1 },
      createdAt: "2026-01-01T00:00:00Z" }) });
  });
  let out = {};
  try {
    await page.goto("http://127.0.0.1:5201", { waitUntil: "networkidle" });
    await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
    await page.click('button[type="submit"]');
    await page.waitForSelector('[data-testid="nav-business"]', { timeout: 15000 });
    await page.click('[data-testid="nav-business"]');
    await page.waitForSelector('input[aria-label="查询输入"]', { timeout: 15000 });
    await sleep(2000);
    await page.fill('input[aria-label="查询输入"]', "常州基地的瓶颈根因是什么");
    await page.press('input[aria-label="查询输入"]', "Enter");
    await page.waitForSelector('[data-testid="intent-none"]', { timeout: 20000 });
    await page.click('[data-testid="intent-none"]');
    await page.waitForSelector('[data-testid="gap-panorama"][data-status="DONE"]', { timeout: 20000 });
    out = await page.evaluate(() => {
      const ring = document.querySelector('[data-testid="coverage-ring"]');
      const prog = ring?.querySelectorAll("circle")[1];
      const badges = [...document.querySelectorAll('[data-testid^="gap-panorama-sev-"]')].map(b => b.textContent.trim());
      return {
        ringDataColor: ring?.getAttribute("data-color"),
        ringPct: ring?.querySelector("text")?.textContent,
        progressStroke: prog ? getComputedStyle(prog).stroke : null,
        badges,
        gapTriggerPresent: !!document.querySelector('[data-testid="gap-trigger"]'),
        gapTriggerDisabled: document.querySelector('[data-testid="gap-trigger"]')?.disabled ?? null,
        gapCode: document.querySelector('[data-testid="gap-code"]')?.textContent,
      };
    });
    await (await page.$('[data-testid="gap-card"]'))?.screenshot({ path: `${SHOT}/pw-v2-${label}.png` });
  } catch (e) { out.error = e.message; }
  await browser.close();
  const pass = out.progressStroke === expectColor;
  console.log(`\n[${label}] score=${score} warnCount=${warnCount} => ringColorVar=${out.ringDataColor} pct=${out.ringPct} stroke=${out.progressStroke} (expect ${expectColor}) ${pass?"COLOR-PASS":"COLOR-FAIL"}`);
  console.log(`   badges=${JSON.stringify(out.badges)} | reactive body: gapCode=${out.gapCode} trigger=${out.gapTriggerPresent}/disabled=${out.gapTriggerDisabled}`);
  if (out.error) console.log("   ERROR:", out.error);
  return { pass, badgeCount: out.badges?.length, out };
}

const ok = await runTier({ score: 0.9, warnCount: 1, expectColor: "rgb(98, 190, 119)", label: "ok" });     // >0.8 -> --ok
const warn = await runTier({ score: 0.65, warnCount: 2, expectColor: "rgb(232, 181, 74)", label: "warn" }); // 0.5-0.8 -> --warn
const danger = await runTier({ score: 0.3, warnCount: 3, expectColor: "rgb(224, 98, 108)", label: "danger" }); // <0.5 -> --danger
console.log("\n===== V2 THREE-TIER (real ring, injected scores) =====");
console.log("ok(>0.8)->#62be77:", ok.pass, "| warn(0.5-0.8)->#e8b54a:", warn.pass, "| danger(<0.5)->#e0626c:", danger.pass);
console.log("V3 @ danger(score 0.3<0.5): reactive trigger present & enabled:", danger.out.gapTriggerPresent && danger.out.gapTriggerDisabled === false);
console.log("badge-count matches injected WARNING count: ok(1)=", ok.badgeCount===1, "warn(2)=", warn.badgeCount, "danger(3)=", danger.badgeCount);
