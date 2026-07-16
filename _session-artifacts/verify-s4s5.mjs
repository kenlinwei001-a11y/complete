// Independent reviewer verification for S4 (RADAR-COLLAPSE) + S5 (TICK-CALENDAR).
// Real browser, real 3 services, login demo/admin, compare UI values to intercepted backend responses.
import { chromium } from "playwright-core";

const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const FRONT = "http://127.0.0.1:5217";
const SHOT = "/tmp/s4s5-ux";
const USER = "admin", PASS = "demo1234";

const log = (...a) => console.log(...a);
const captured = { cert: [], tick: [], session: [] };

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1300 } });

// intercept backend responses for KILL-MOCK-RED value comparison
page.on("response", async (res) => {
  const u = res.url();
  try {
    if (/\/sim\/sessions\/[^/]+\/certification/.test(u)) captured.cert.push({ u, body: await res.json() });
    else if (/\/sim\/sessions\/[^/]+\/tick/.test(u)) captured.tick.push({ u, body: await res.json() });
    else if (/\/sim\/sessions(\?|$)/.test(u) && res.request().method() === "POST") captured.session.push({ u, body: await res.json() });
  } catch { /* non-json */ }
});

try {
  // 1. login
  await page.goto(`${FRONT}/`, { waitUntil: "networkidle" });
  await page.fill("#login-username", USER);
  await page.fill("#login-password", PASS);
  await page.click("button[type=submit]");
  await page.waitForTimeout(2500);
  log("LOGIN url:", page.url());

  // 2. sandbox
  await page.goto(`${FRONT}/v/sim-sandbox`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-testid=sandbox-view]", { timeout: 20000 });
  await page.waitForSelector("[data-testid=sim-readiness-panel]", { timeout: 20000 }).catch(() => log("!! no readiness panel"));
  await page.waitForTimeout(2500);

  const humanized = await page.locator("[data-testid=sim-readiness-panel]").getAttribute("data-humanized");
  log("READINESS data-humanized:", humanized);

  // ---------- S4 ----------
  const verdictN = await page.locator("[data-testid=sim-cert-verdict]").count();
  let domLevel = null, verdictText = "";
  if (verdictN > 0) {
    domLevel = await page.locator("[data-testid=sim-cert-verdict]").getAttribute("data-cert-level");
    verdictText = ((await page.locator("[data-testid=sim-cert-verdict-text]").count()) > 0
      ? await page.locator("[data-testid=sim-cert-verdict-text]").first().textContent()
      : await page.locator("[data-testid=sim-cert-verdict]").first().textContent())?.trim() ?? "";
  }
  log("S4 verdict count:", verdictN, "domLevel:", domLevel, "text:", verdictText.slice(0, 60));

  // radar axes human labels (no raw structure/knowledge/behavior)
  const axisEls = await page.locator("[data-testid^=sandbox-][data-testid*=-axis-], [data-testid^=sandbox-radar-axis-]").allTextContents();
  log("S4 radar axis labels:", JSON.stringify(axisEls));
  const radarN = await page.locator("svg[data-testid$=-radar]").count();
  log("S4 radar svg count:", radarN);

  // screenshot readiness/trust bar region (S4 value)
  const panel = page.locator("[data-testid=sim-readiness-panel]");
  await panel.screenshot({ path: `${SHOT}/s4-trust-bar.png` }).catch((e) => log("panel shot fail", e.message));
  await page.screenshot({ path: `${SHOT}/s4-fullpage.png`, fullPage: false });

  // switch to LOCAL scope to force sim-cert-target (the FIXED element) to render
  const localBtn = page.locator("[data-testid=sim-cert-scope-LOCAL]");
  if (await localBtn.count() > 0) {
    await localBtn.click();
    await page.waitForTimeout(2000);
    const tgtN = await page.locator("[data-testid=sim-cert-target]").count();
    const tgtText = tgtN > 0 ? (await page.locator("[data-testid=sim-cert-target]").first().textContent())?.trim() : null;
    log("S4 sim-cert-target(after LOCAL) count:", tgtN, "text:", tgtText);
    await panel.screenshot({ path: `${SHOT}/s4-radar.png` }).catch(() => {});
  } else {
    log("S4 !! no sim-cert-scope-LOCAL button");
  }

  // ---------- S5 ----------
  const tcN = await page.locator("[data-testid=sandbox-tick-calendar]").count();
  const tc0 = tcN > 0 ? (await page.locator("[data-testid=sandbox-tick-calendar]").first().textContent())?.trim() : null;
  log("S5 tick-calendar count:", tcN, "@tick0:", tc0);

  // set advance = 7 days then push (to cross into week label)
  const daysInput = page.locator("[data-testid=sandbox-tick-days]");
  if (await daysInput.count() > 0) {
    await daysInput.fill("7");
  }
  const tickBtn = page.locator("[data-testid=sandbox-tick-btn]");
  if (await tickBtn.count() > 0) {
    await tickBtn.click();
    await page.waitForTimeout(4000);
  } else log("S5 !! no sandbox-tick-btn");
  const tc7 = (await page.locator("[data-testid=sandbox-tick-calendar]").count()) > 0
    ? (await page.locator("[data-testid=sandbox-tick-calendar]").first().textContent())?.trim() : null;
  log("S5 tick-calendar @after push:", tc7);
  await page.screenshot({ path: `${SHOT}/s5-tick-calendar.png`, fullPage: false });

  // click a Base dag node -> attribution popover
  const nodeEls = page.locator("[data-testid^=sandbox-dag-node-]");
  const nodeCount = await nodeEls.count();
  log("S5 dag node count:", nodeCount);
  let attrTexts = [];
  if (nodeCount > 0) {
    // prefer a Base node
    let clicked = false;
    for (let i = 0; i < nodeCount; i++) {
      const tid = await nodeEls.nth(i).getAttribute("data-testid");
      if (/base/i.test(tid || "")) { await nodeEls.nth(i).click({ force: true }); clicked = true; log("S5 clicked node:", tid); break; }
    }
    if (!clicked) { await nodeEls.first().click({ force: true }); log("S5 clicked first node:", await nodeEls.first().getAttribute("data-testid")); }
    await page.waitForTimeout(1500);
    const attrN = await page.locator("[data-testid^=sandbox-attribution-]").count();
    attrTexts = await page.locator("[data-testid^=sandbox-attribution-]").allTextContents();
    log("S5 attribution rows:", attrN, "texts:", JSON.stringify(attrTexts.map(t => t.slice(0, 80))));
    const popover = page.locator("[data-testid=sandbox-attribution]");
    if (await popover.count() > 0) await popover.screenshot({ path: `${SHOT}/s5-attribution.png` }).catch((e) => log("attr shot fail", e.message));
    else await page.screenshot({ path: `${SHOT}/s5-attribution.png` });
  }

  // ---------- backend comparison ----------
  log("\n=== BACKEND CAPTURED ===");
  const lastCert = captured.cert[captured.cert.length - 1]?.body;
  log("cert.level:", lastCert?.level, "cert.dims.composite:", lastCert?.dims?.composite, "cert.targetRef:", lastCert?.targetRef, "scope:", lastCert?.scope);
  log("cert responses seen:", captured.cert.length, "levels:", captured.cert.map(c => `${c.body?.scope}:${c.body?.level}:${c.body?.targetRef}`));
  const traces = captured.tick.map(t => t.body?.trace).filter(Boolean);
  const flatTrace = [].concat(...traces.map(t => Array.isArray(t) ? t : []));
  log("tick responses:", captured.tick.length, "total trace entries:", flatTrace.length);
  log("sample trace[0]:", JSON.stringify(flatTrace[0] || null));
  log("trace ruleKeys:", JSON.stringify([...new Set(flatTrace.map(t => t.ruleKey))].slice(0, 8)));
  log("trace amounts sample:", JSON.stringify(flatTrace.slice(0, 5).map(t => t.amount)));

  // write a machine summary
  const summary = { humanized, domLevel, verdictText, radarAxes: axisEls, radarN, tc0, tc7,
    attrCount: attrTexts.length, attrTexts,
    backend: { certLevel: lastCert?.level, composite: lastCert?.dims?.composite, targetRef: lastCert?.targetRef,
      traceEntries: flatTrace.length, traceRuleKeys: [...new Set(flatTrace.map(t => t.ruleKey))], traceSample: flatTrace.slice(0, 6) } };
  console.log("\n=== SUMMARY_JSON ===");
  console.log(JSON.stringify(summary, null, 1));
} catch (e) {
  log("FATAL", e.message, e.stack);
  await page.screenshot({ path: `${SHOT}/error.png` }).catch(() => {});
} finally {
  await browser.close();
}
