import { chromium } from "playwright-core";
import fs from "node:fs";
const BASE = "http://localhost:5847";
const OUT = "/tmp/scb/mo";
fs.mkdirSync(OUT, { recursive: true });

const targets = process.argv.slice(2);
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 1600, height: 1400 } });
const page = await ctx.newPage();
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo");
await page.fill("#login-username", "admin");
await page.fill("input[type=password]", "demo1234");
await page.click("button[type=submit]");
await page.waitForTimeout(4000);

for (const href of targets) {
  const link = page.locator(`a[href="${href}"]`).first();
  if ((await link.count()) === 0) { console.log("NO-NAV-LINK", href); continue; }
  await link.click({ timeout: 15000 });
  await page.waitForTimeout(6000);
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; }));
  await page.waitForTimeout(1200);
  const t = await page.evaluate(() => document.body.innerText);
  const name = href.replace(/\//g, "_");
  fs.writeFileSync(`${OUT}/${name}.txt`, t);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  // 权重控件盘点
  const w = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll("input[type=range]").forEach((e) => out.push({ kind: "range", label: e.getAttribute("aria-label") || e.closest("label")?.innerText?.slice(0, 60) || "", value: e.value }));
    document.querySelectorAll("[data-testid]").forEach((e) => { const id = e.getAttribute("data-testid"); if (/weight|objective|pareto|multiobj/i.test(id)) out.push({ kind: "testid", label: id, value: (e.textContent || "").slice(0, 60) }); });
    return out;
  });
  console.log("==", href, "len", t.length);
  console.log(JSON.stringify(w, null, 1).slice(0, 3000));
  await page.goto(BASE + "/v/dash", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
}
await b.close();
