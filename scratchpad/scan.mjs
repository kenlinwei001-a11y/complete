import { chromium } from "playwright-core";
import fs from "node:fs";

const BASE = "http://localhost:5847";
const OUT = "/tmp/scb/out";
fs.mkdirSync(OUT + "/text", { recursive: true });
const MD = /\*\*[^*\n]{1,120}\*\*/g;

const nav = JSON.parse(fs.readFileSync(OUT + "/nav.json", "utf8"));
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 1600, height: 1400 } });
const page = await ctx.newPage();

await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo");
await page.fill("#login-username", "admin");
await page.fill("input[type=password]", "demo1234");
await page.click("button[type=submit]");
await page.waitForTimeout(4000);

const report = [];
for (const l of nav) {
  const href = l.href;
  try {
    const link = page.locator(`a[href="${href}"]`).first();
    if ((await link.count()) === 0) { report.push({ href, text: l.text, err: "NAV-LINK-GONE" }); continue; }
    await link.click({ timeout: 8000 });
    await page.waitForTimeout(2600);
    const t1 = await page.evaluate(() => document.body.innerText);
    // 展开所有 details 后再扫一次（用户点得开 = 上屏）
    await page.evaluate(() => { document.querySelectorAll("details").forEach((d) => { d.open = true; }); });
    await page.waitForTimeout(700);
    const t2 = await page.evaluate(() => document.body.innerText);
    const m1 = [...t1.matchAll(MD)].map((m) => m[0]);
    const m2 = [...t2.matchAll(MD)].map((m) => m[0]);
    fs.writeFileSync(`${OUT}/text/${href.replace(/\//g, "_")}.txt`, t2);
    report.push({ href, text: l.text, visible: m1, afterDetails: m2.filter((x) => !m1.includes(x)) });
    if (m2.length) console.log("MDLEAK", href, JSON.stringify([...new Set(m2)]));
  } catch (e) {
    report.push({ href, text: l.text, err: String(e).slice(0, 120) });
    console.log("ERR", href, String(e).slice(0, 90));
    try { await page.goto(BASE + "/v/dash", { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500); } catch {}
  }
}
fs.writeFileSync(OUT + "/mdscan.json", JSON.stringify(report, null, 2));
const tot = report.reduce((a, r) => a + ((r.visible?.length || 0) + (r.afterDetails?.length || 0)), 0);
console.log("PAGES", report.length, "TOTAL-MD-OCCURRENCES", tot);
await b.close();
