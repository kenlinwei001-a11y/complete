import { chromium } from "playwright-core";
import fs from "node:fs";
const BASE = "http://localhost:5847";
const OUT = "/tmp/scb/out8";
fs.mkdirSync(OUT + "/text", { recursive: true });
const MD = /\*\*[^*\n]{1,120}\*\*/g;
const TARGETS = process.argv.slice(2);
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 1600, height: 1400 } });
const page = await ctx.newPage();
const hits = []; let ok = 0;
for (const href of TARGETS) {
  // 每个目标都从登录走起 —— 落地页是这批链接唯一可见的地方
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  if ((await page.locator("#login-tenant").count()) > 0) {
    await page.fill("#login-tenant", "demo");
    await page.fill("#login-username", "admin");
    await page.fill("input[type=password]", "demo1234");
    await page.click("button[type=submit]");
  }
  await page.waitForTimeout(5000);
  let vis = await page.locator(`a[href="${href}"]:visible`).count();
  if (vis === 0) {
    // 折叠分组：逐个点开侧栏分组标题，直到该链接可见
    const tgs = await page.locator("nav button").all();
    for (const t of tgs) {
      const label = ((await t.innerText().catch(() => "")) || "").trim();
      if (!label.startsWith("▾") && !label.startsWith("▸")) continue;
      try { await t.click({ timeout: 1500 }); await page.waitForTimeout(400); } catch {}
      vis = await page.locator(`a[href="${href}"]:visible`).count();
      if (vis > 0) break;
    }
  }
  if (vis === 0) { console.log("UNREACHABLE", href); continue; }
  try { await page.locator(`a[href="${href}"]:visible`).first().click({ timeout: 8000 }); } catch (e) { console.log("CLICKFAIL", href, String(e).slice(0, 40)); continue; }
  await page.waitForTimeout(6000);
  try { await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; })); } catch {}
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => ({ t: document.body.innerText, ti: [...document.querySelectorAll("[title]")].map((e) => e.getAttribute("title")).join("\n") }));
  ok++;
  fs.writeFileSync(`${OUT}/text/${href.replace(/\//g, "_")}.txt`, r.t + "\n\n<<<TITLES>>>\n" + r.ti);
  const m = [...new Set([...r.t.matchAll(MD)].map((x) => x[0]))];
  const mt = [...new Set([...r.ti.matchAll(MD)].map((x) => x[0]))];
  if (m.length || mt.length) { hits.push({ href, innerText: m, title: mt }); console.log("MDLEAK", href, JSON.stringify(m), "TITLE", JSON.stringify(mt)); }
  else console.log("CLEAN", href, page.url(), r.t.length);
}
fs.writeFileSync(OUT + "/hits.json", JSON.stringify(hits, null, 2));
console.log("SCANNED", ok, "/", TARGETS.length, "LEAK-PAGES", hits.length);
await b.close();
