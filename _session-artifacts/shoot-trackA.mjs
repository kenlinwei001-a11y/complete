import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGES = [
  ["/v/sim-sandbox", "trackA-sandbox.png", '[data-testid="sandbox-adopt-btn"]'],
  ["/v/sim-init", "trackA-initwizard.png", null],
  ["/admin/modeling", "trackA-modeling.png", null],
];
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
const page = await ctx.newPage();
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 140)); });
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 });
await sleep(2000);
async function spaGoto(r){ await page.evaluate((x)=>{window.history.pushState({},"",x);window.dispatchEvent(new PopStateEvent("popstate"));}, r); }
const report = [];
for (const [route, file, anchor] of PAGES) {
  try {
    await spaGoto(route);
    if (anchor) { try { await page.waitForSelector(anchor, { timeout: 9000 }); } catch {} }
    await sleep(2500); // let session init + tick + charts settle
    await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
    const body = ((await page.locator("body").textContent()) || "");
    // probe key sandbox elements
    const has = {};
    for (const sel of ["sandbox-adopt-btn","sandbox-branch-btn","sandbox-tick-btn","sandbox-compare","sim-cert-level"]) {
      has[sel] = await page.locator(`[data-testid="${sel}"]`).count();
    }
    report.push({ route, file, bodyLen: body.length, has, url: page.url() });
    console.log(`OK ${route} -> ${file} | bodyLen=${body.length} testids=${JSON.stringify(has)}`);
  } catch (e) { report.push({ route, file, ok:false, err:String(e).slice(0,120) }); console.log(`FAIL ${route}: ${String(e).slice(0,120)}`); }
}
console.log("\nconsole errors:", [...new Set(errs)].slice(0,8).join(" | ")||"(none)");
console.log(JSON.stringify(report,null,2));
await browser.close();
