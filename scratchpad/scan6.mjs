import { chromium } from "playwright-core";
import fs from "node:fs";
const BASE = "http://localhost:5847";
const OUT = "/tmp/scb/out6";
fs.mkdirSync(OUT + "/text", { recursive: true });
const MD = /\*\*[^*\n]{1,120}\*\*/g;
const CANARY = "屏上**不该有**这两个星号";
if ([...CANARY.matchAll(MD)].length !== 1) { console.log("CANARY-FAIL"); process.exit(2); }
const REST = process.argv.slice(2);
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 1600, height: 1400 } });
const page = await ctx.newPage();
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo");
await page.fill("#login-username", "admin");
await page.fill("input[type=password]", "demo1234");
await page.click("button[type=submit]");
await page.waitForTimeout(4000);
console.log("URL", page.url(), "links", await page.locator("a[href^='/']").count());
const hits = [];
let ok = 0;
for (const href of REST) {
  let lk = page.locator(`a[href="${href}"]`).first();
  if ((await lk.count()) === 0) {
    console.log("NO-LINK-ON", page.url(), "for", href);
    // 回到有全量导航的落地页：点侧栏第一条链接（经营驾驶舱）
    try { await page.locator('a[href="/v/dash"]').first().click({ timeout: 5000 }); await page.waitForTimeout(2500); } catch {}
    lk = page.locator(`a[href="${href}"]`).first();
    if ((await lk.count()) === 0) { console.log("STILL-NO-LINK", href); continue; }
  }
  try { await lk.scrollIntoViewIfNeeded({ timeout: 3000 }); } catch {}
  try { await lk.click({ timeout: 8000 }); } catch (e) { console.log("CLICKFAIL", href, String(e).slice(0, 50)); continue; }
  await page.waitForTimeout(5000);
  try { await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; })); } catch {}
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => ({
    t: document.body.innerText,
    ti: [...document.querySelectorAll("[title]")].map((e) => e.getAttribute("title")).join("\n"),
  }));
  ok++;
  fs.writeFileSync(`${OUT}/text/${href.replace(/\//g, "_")}.txt`, r.t + "\n\n<<<TITLES>>>\n" + r.ti);
  const m = [...new Set([...r.t.matchAll(MD)].map((x) => x[0]))];
  const mt = [...new Set([...r.ti.matchAll(MD)].map((x) => x[0]))];
  if (m.length || mt.length) { hits.push({ href, innerText: m, title: mt }); console.log("MDLEAK", href, JSON.stringify(m), "TITLE", JSON.stringify(mt)); }
  else console.log("CLEAN", href, "url", page.url(), "len", r.t.length);
}
fs.writeFileSync(OUT + "/hits.json", JSON.stringify(hits, null, 2));
console.log("SCANNED", ok, "/", REST.length, "LEAK-PAGES", hits.length);
await b.close();
