import { chromium } from "playwright-core";
const EV = "/home/user/complete/docs/evidence";
const BASE = "http://127.0.0.1:5205";
const log = (...a) => console.log(...a);
const browser = await chromium.launch({ headless: true, executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1560, height: 1000 } })).newPage();

await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.waitForSelector("#login-username", { timeout: 15000 });
await page.fill("#login-tenant", "demo"); await page.fill("#login-username", "admin"); await page.fill("#login-password", "demo1234");
await page.click("button[type=submit]"); await page.waitForTimeout(3500);
await page.goto(BASE + "/v/sim-sandbox", { waitUntil: "networkidle" });
await page.waitForTimeout(6500);

// find the sandbox DAG node for Base (data-testid ends with -node-Base)
const readBaseNode = async () => {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid$="-node-Base"]');
    if (!el) return "(Base node not found)";
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  });
};
const readTile = async (label) => page.evaluate((lbl) => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n; while ((n = walker.nextNode())) {
    if ((n.textContent||"").trim() === lbl) {
      // climb to a container and read numeric siblings
      let p = n.parentElement; for (let i=0;i<3 && p;i++){ const t=(p.innerText||"").replace(/\s+/g," ").trim(); if (/\d/.test(t)) return t; p=p.parentElement; }
    }
  }
  return "(tile "+lbl+" not found)";
}, label);

const baseBefore = await readBaseNode();
const loadIdxBefore = await readTile("负载指数");
const demandLoadBefore = await readTile("需求负荷");
log("=== BEFORE TICK ===");
log("Base DAG node:", JSON.stringify(baseBefore));
log("负载指数 tile:", JSON.stringify(loadIdxBefore));
log("需求负荷 tile:", JSON.stringify(demandLoadBefore));

// crop the DAG region
const dag = page.locator('[data-testid$="-node-Base"]').first();
try { await dag.scrollIntoViewIfNeeded(); } catch {}
await page.screenshot({ path: `${EV}/usability-realrun-04-dag-base-before.png` });

const tickBtn = page.locator('[data-testid="sandbox-tick-btn"]');
for (let i=0;i<3;i++){ if(await tickBtn.isDisabled().catch(()=>true)) break; await tickBtn.click(); await page.waitForTimeout(2200); }
await page.waitForTimeout(1200);

const baseAfter = await readBaseNode();
const loadIdxAfter = await readTile("负载指数");
const demandLoadAfter = await readTile("需求负荷");
log("\n=== AFTER 3 TICKS ===");
log("Base DAG node:", JSON.stringify(baseAfter));
log("负载指数 tile:", JSON.stringify(loadIdxAfter));
log("需求负荷 tile:", JSON.stringify(demandLoadAfter));

try { await dag.scrollIntoViewIfNeeded(); } catch {}
await page.screenshot({ path: `${EV}/usability-realrun-05-dag-base-after.png` });

log("\n=== VERDICT: Base DAG node changed? ", baseBefore !== baseAfter, "===");
await browser.close();
