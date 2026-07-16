import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5201";
const AC = "http://127.0.0.1:4102";
const SHOT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => { if (m.type() === "error") logs.push("CONSOLE.ERR: " + m.text()); });

// capture the pre-analysis response the UI actually consumed
let preResp = null;
page.on("response", async (res) => {
  if (res.url().includes("/growth/pre-analysis/")) {
    try { preResp = { url: res.url(), status: res.status(), body: await res.json() }; } catch {}
  }
});

function sevCounts(rep) { const c = {}; for (const e of rep?.gapAnalysis?.entries ?? []) for (const it of e.items) if (it.severity && it.status !== "EXISTS") c[it.severity] = (c[it.severity] ?? 0) + 1; return c; }

try {
  // 1) login
  await page.goto(APP, { waitUntil: "networkidle" });
  await page.fill("#login-tenant", "demo");
  await page.fill("#login-username", "admin");
  await page.fill("#login-password", "demo1234");
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="nav-business"]', { timeout: 15000 });
  await page.click('[data-testid="nav-business"]'); // go to 经营驾驶舱 (dash view w/ QueryDock)
  await page.waitForSelector('input[aria-label="查询输入"]', { timeout: 15000 });
  await sleep(2500); // let workspace/scene load (packageId)
  console.log("STEP1 login OK, dock ready on dash view");

  // 2) submit the badge-producing query
  const t0 = Date.now();
  await page.fill('input[aria-label="查询输入"]', "常州基地的瓶颈根因是什么");
  await page.press('input[aria-label="查询输入"]', "Enter");
  console.log("STEP2 query submitted");

  // 3) clarification -> click 都不是 (intent-none)
  await page.waitForSelector('[data-testid="intent-none"]', { timeout: 20000 });
  console.log("STEP3 clarification appeared (INTENT_CHOICE), clicking 都不是 @", Date.now() - t0, "ms");
  await page.click('[data-testid="intent-none"]');

  // 4) wait for gap-card + panorama
  await page.waitForSelector('[data-testid="gap-card"]', { timeout: 25000 });
  const tGap = Date.now();
  console.log("STEP4 gap-card rendered @", tGap - t0, "ms");
  await page.waitForSelector('[data-testid="gap-panorama"]', { timeout: 25000 });
  const tPano = Date.now();
  console.log("STEP4 gap-panorama rendered @", tPano - t0, "ms (<=20000 required)");

  // 5) read panorama DOM + computed styles
  const report = await page.evaluate(() => {
    const pano = document.querySelector('[data-testid="gap-panorama"]');
    const ring = document.querySelector('[data-testid="coverage-ring"]');
    const circles = ring ? [...ring.querySelectorAll("circle")] : [];
    const cs = (el) => (el ? getComputedStyle(el) : null);
    const progressCircle = circles[1] || null;
    const trackCircle = circles[0] || null;
    const badges = [...document.querySelectorAll('[data-testid^="gap-panorama-sev-"]')].map((b) => ({
      testid: b.getAttribute("data-testid"), sev: b.getAttribute("data-sev"), text: b.textContent.trim(),
      color: getComputedStyle(b).color, borderColor: getComputedStyle(b).borderColor,
    }));
    const link = document.querySelector('[data-testid="gap-panorama-tickets"]');
    // probe token resolution for all three tiers in the real page CSS context
    const probe = (v) => { const d = document.createElement("div"); d.style.color = v; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; };
    return {
      panoStatus: pano?.getAttribute("data-status"),
      panoTotal: pano?.getAttribute("data-total"),
      ringDataScore: ring?.getAttribute("data-score"),
      ringDataColor: ring?.getAttribute("data-color"),
      ringCenterText: ring?.querySelector("text")?.textContent,
      progressStroke: cs(progressCircle)?.stroke,
      trackStroke: cs(trackCircle)?.stroke,
      summaryText: document.querySelector('[data-testid="gap-panorama"] span')?.textContent,
      badges,
      linkHref: link?.getAttribute("href"),
      linkText: link?.textContent?.trim(),
      tokenOk: probe("var(--ok)"),
      tokenWarn: probe("var(--warn)"),
      tokenDanger: probe("var(--danger)"),
      tokenLine2: probe("var(--line2)"),
      // reactive body still present (V3)
      gapCodeText: document.querySelector('[data-testid="gap-code"]')?.textContent,
      gapTriggerPresent: !!document.querySelector('[data-testid="gap-trigger"]'),
      gapTriggerDisabled: document.querySelector('[data-testid="gap-trigger"]')?.disabled ?? null,
    };
  });

  await page.screenshot({ path: `${SHOT}/pw-v1-panorama.png`, fullPage: false });
  // tight screenshot of the gap card
  const card = await page.$('[data-testid="gap-card"]');
  if (card) await card.screenshot({ path: `${SHOT}/pw-v1-gapcard.png` });

  const taskId = report.linkHref ? decodeURIComponent(report.linkHref.split("taskId=")[1] || "") : null;
  const backendSev = sevCounts(preResp?.body);
  const backendTotal = preResp?.body?.summary?.totalGaps;

  console.log("\n===== V1/V2 REPORT =====");
  console.log("elapsed submit->panorama (ms):", tPano - t0);
  console.log(JSON.stringify(report, null, 2));
  console.log("\nderived taskId from deeplink:", taskId);
  console.log("pre-analysis response UI consumed: status", preResp?.status, "totalGaps", backendTotal, "sevCounts", JSON.stringify(backendSev));
  console.log("UI badge count (WARNING):", report.badges.filter(b=>b.sev==="WARNING").length, "text:", report.badges.map(b=>b.text));
  console.log("\nCROSS-CHECK: UI WARNING badge text vs backend WARNING count:", JSON.stringify(backendSev));
  console.log("console errors:", logs.length ? logs : "none");
} catch (e) {
  console.log("ERROR:", e.message);
  await page.screenshot({ path: `${SHOT}/pw-v1-error.png`, fullPage: true }).catch(()=>{});
  const html = await page.content().catch(()=>"");
  console.log("page has gap-card:", html.includes("gap-card"), "has clarification:", html.includes("clarification"), "has intent-none:", html.includes("intent-none"));
} finally {
  await browser.close();
}
