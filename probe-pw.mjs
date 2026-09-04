import { chromium } from "playwright-core";
const BASE = "http://127.0.0.1:5401";
const RE = /(apps|packages|scripts|deploy|docs)\/[A-Za-z0-9@._\-\/]*\.(ts|tsx|mjs|js|json|sql|sh|md)(:\d+(-\d+)?)?|[A-Za-z0-9._-]+\.(ts|tsx|mjs)\:\d+/g;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1400 } })).newPage();
await page.goto(BASE + "/", { waitUntil: "networkidle" });
if (await page.locator('input[type="password"]').count()) {
  const inputs = page.locator("input");
  await inputs.nth(0).fill("demo"); await inputs.nth(1).fill("admin");
  await page.locator('input[type="password"]').fill("demo1234");
  await page.locator("button").filter({ hasText: /登录|登 录/ }).first().click();
  await page.waitForTimeout(2500);
}
await page.goto(BASE + "/v/process-wait", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const sels = page.locator("select");
const n = await sels.count();
console.log("selects", n);
let worst = 0, worstOpt = "";
for (let i = 0; i < n; i++) {
  const opts = await sels.nth(i).locator("option").evaluateAll((os) => os.map((o) => o.value));
  for (const v of opts.slice(0, 70)) {
    await sels.nth(i).selectOption(v).catch(() => {});
    await page.waitForTimeout(500);
    await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; d.dispatchEvent(new Event("toggle", { bubbles: true })); }));
    const btns = await page.locator('button[aria-expanded="false"]').all();
    for (const b of btns.slice(0, 30)) await b.click({ timeout: 500 }).catch(() => {});
    await page.waitForTimeout(400);
    const t = await page.evaluate(() => document.body.innerText + "\n" + [...document.querySelectorAll("[title]")].map((e) => e.getAttribute("title")).join("\n"));
    const m = t.match(RE) || [];
    if (m.length > worst) { worst = m.length; worstOpt = `sel${i}=${v}: ` + [...new Set(m)].slice(0, 8).join(" | "); }
  }
}
console.log("PROCESS_WAIT_MAX_HITS", worst, worstOpt);
await browser.close();
