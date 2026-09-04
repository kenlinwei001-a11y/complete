import { chromium } from "playwright-core";
import fs from "node:fs";
const BASE = "http://localhost:5847";
const OUT = process.env.OUT4 || "/tmp/scb/out4";
fs.mkdirSync(OUT + "/text", { recursive: true });
const MD = /\*\*[^*\n]{1,120}\*\*/g;
// 金丝雀：一段**必定**含此形态的串 —— 正则/流程坏了就不会命中它，届时报「工具坏了」而不是「屏上干净」。
const CANARY = "屏上**不该有**这两个星号";
if ([...CANARY.matchAll(MD)].length !== 1) { console.log("CANARY-FAIL 正则坏了"); process.exit(2); }

const nav = JSON.parse(fs.readFileSync("/tmp/scb/out/nav.json", "utf8"));
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 1600, height: 1400 } });
const page = await ctx.newPage();
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo");
await page.fill("#login-username", "admin");
await page.fill("input[type=password]", "demo1234");
await page.click("button[type=submit]");
await page.waitForTimeout(4000);

async function expandNavGroups() {
  // 侧边栏分组是折叠的（▾），组内链接在展开前 DOM 里不存在 —— 全部点开
  const toggles = await page.locator("nav button, aside button").all();
  for (const t of toggles.slice(0, 40)) { try { await t.click({ timeout: 800 }); await page.waitForTimeout(60); } catch {} }
}
const hits = [];
let scanned = 0;
for (const l of nav) {
  const href = l.href;
  try {
    let lk = page.locator(`a[href="${href}"]`).first();
    if ((await lk.count()) === 0) {
      await page.goto(BASE + "/v/dash", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1800);
      await expandNavGroups();
      lk = page.locator(`a[href="${href}"]`).first();
    }
    if ((await lk.count()) === 0) { console.log("SKIP", href); continue; }
    await lk.click({ timeout: 10000 });
  } catch { console.log("CLICKFAIL", href); continue; }
  await page.waitForTimeout(3500);
  try { await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; })); } catch {}
  await page.waitForTimeout(600);
  let t = "", ti = "";
  try {
    const r = await page.evaluate(() => ({
      t: document.body.innerText,
      ti: [...document.querySelectorAll("[title]")].map((e) => e.getAttribute("title")).join("\n"),
    }));
    t = r.t; ti = r.ti;
  } catch {}
  scanned++;
  fs.writeFileSync(`${OUT}/text/${href.replace(/\//g, "_")}.txt`, t + "\n\n<<<TITLES>>>\n" + ti);
  const m = [...new Set([...t.matchAll(MD)].map((x) => x[0]))];
  const mt = [...new Set([...ti.matchAll(MD)].map((x) => x[0]))];
  if (m.length || mt.length) { hits.push({ href, innerText: m, title: mt }); console.log("MDLEAK", href, JSON.stringify(m), "TITLE", JSON.stringify(mt)); }
}
fs.writeFileSync(OUT + "/hits.json", JSON.stringify(hits, null, 2));
console.log("PAGES-SCANNED", scanned, "/", nav.length, "LEAK-PAGES", hits.length, "（金丝雀命中：1）");
await b.close();
