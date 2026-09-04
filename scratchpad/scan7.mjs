import { chromium } from "playwright-core";
import fs from "node:fs";
const BASE = "http://localhost:5847";
const OUT = "/tmp/scb/out7";
fs.mkdirSync(OUT + "/text", { recursive: true });
const MD = /\*\*[^*\n]{1,120}\*\*/g;
const CANARY = "屏上**不该有**这两个星号";
if ([...CANARY.matchAll(MD)].length !== 1) { console.log("CANARY-FAIL"); process.exit(2); }
const GRAPH = ["/v/graph-all", "/v/graph-backbone", "/v/graph-flow", "/v/graph-source", "/v/graph-solver", "/v/graph-mvp", "/v/graph-agent", "/v/graph-loop"];
const REST = ["/v/chain-line-map", "/v/transit-flow", "/v/physical-topology", "/v/node-inspector", "/v/chain-impediments", "/v/process-wait", "/v/procurement-legs", "/v/sim-console", "/v/sim-conduction", "/v/sim-attribution", "/v/sim-optimize"];
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await (await b.newContext({ viewport: { width: 1600, height: 1400 } })).newPage();
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo");
await page.fill("#login-username", "admin");
await page.fill("input[type=password]", "demo1234");
await page.click("button[type=submit]");
await page.waitForTimeout(4000);
const hits = []; let ok = 0;
async function visit(href) {
  const lk = page.locator(`a[href="${href}"]`).first();
  if ((await lk.count()) === 0) { console.log("NO-LINK", href, "on", page.url()); return false; }
  try { await lk.scrollIntoViewIfNeeded({ timeout: 3000 }); } catch {}
  try { await lk.click({ timeout: 8000 }); } catch (e) { console.log("CLICKFAIL", href, String(e).slice(0, 45)); return false; }
  await page.waitForTimeout(5000);
  try { await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; })); } catch {}
  await page.waitForTimeout(700);
  const r = await page.evaluate(() => ({ t: document.body.innerText, ti: [...document.querySelectorAll("[title]")].map((e) => e.getAttribute("title")).join("\n") }));
  ok++;
  fs.writeFileSync(`${OUT}/text/${href.replace(/\//g, "_")}.txt`, r.t + "\n\n<<<TITLES>>>\n" + r.ti);
  const m = [...new Set([...r.t.matchAll(MD)].map((x) => x[0]))];
  const mt = [...new Set([...r.ti.matchAll(MD)].map((x) => x[0]))];
  if (m.length || mt.length) { hits.push({ href, innerText: m, title: mt }); console.log("MDLEAK", href, JSON.stringify(m), "TITLE", JSON.stringify(mt)); }
  else console.log("CLEAN", href, page.url(), r.t.length);
  return true;
}
// ① 展开「图谱体系」分组后逐个进
for (const g of GRAPH) {
  if ((await page.locator(`a[href="${g}"]:visible`).count()) === 0) {
    const tog = page.locator("nav button", { hasText: "图谱体系" }).first();
    try { await tog.click({ timeout: 4000 }); await page.waitForTimeout(800); } catch (e) { console.log("TOGGLE-FAIL", String(e).slice(0, 40)); }
  }
  await visit(g);
}
// ② 其余 11 个从「场景启动器」页面进
for (const h of REST) {
  if ((await page.locator(`a[href="${h}"]:visible`).count()) === 0) {
    try { await page.locator('a[href="/scenarios"]').first().click({ timeout: 5000 }); await page.waitForTimeout(3000); } catch {}
  }
  if ((await page.locator(`a[href="${h}"]:visible`).count()) === 0) {
    // 沙盘内嵌的路由：从推演沙盘进
    try { await page.locator('a[href="/v/sim-sandbox"]').first().click({ timeout: 5000 }); await page.waitForTimeout(4000); } catch {}
  }
  await visit(h);
}
fs.writeFileSync(OUT + "/hits.json", JSON.stringify(hits, null, 2));
console.log("SCANNED", ok, "/", GRAPH.length + REST.length, "LEAK-PAGES", hits.length);
await b.close();
