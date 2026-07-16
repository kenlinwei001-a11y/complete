import pw from "/home/user/complete/node_modules/playwright-core/index.js";
const { chromium } = pw;
const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1100 } })).newPage();

// capture sim tick API responses (real propagation trace + state)
const tickResponses = [];
page.on("response", async (resp) => {
  const u = resp.url();
  if (u.includes("/sim/") && (u.includes("/tick") || u.includes("/sessions"))) {
    try { const j = await resp.json(); tickResponses.push({ url: u.split("/a/v1")[1] || u, status: resp.status(), body: j }); } catch {}
  }
});

// 1) login once
await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
await page.fill("#login-tenant", "demo");
await page.fill("#login-username", "admin");
await page.fill("#login-password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15000 });
await sleep(1500);

// 2) SPA-nav to sandbox (page.goto would wipe in-memory token)
await page.evaluate(() => { window.history.pushState({}, "", "/v/sim-sandbox"); window.dispatchEvent(new PopStateEvent("popstate")); });
await page.waitForSelector('[data-testid="sandbox-tick-btn"]', { timeout: 12000 });
await sleep(3000); // let init() + first render settle

// helper: read all node Σ labels from the DOM (buildNodes sets sub=`Σ <v>`)
async function readNodeSigmas() {
  return await page.evaluate(() => {
    const txt = document.body.innerText || "";
    const m = [...txt.matchAll(/Σ\s*(\d+)/g)].map((x) => Number(x[1]));
    return m;
  });
}

const before = await readNodeSigmas();
await page.screenshot({ path: `${OUT}/tickfix-before.png`, fullPage: true });

// 3) click tick a few times
for (let i = 0; i < 3; i++) { await page.click('[data-testid="sandbox-tick-btn"]'); await sleep(1200); }

const after = await readNodeSigmas();
await page.screenshot({ path: `${OUT}/tickfix-after.png`, fullPage: true });

// 4) compare
const changed = before.length === after.length
  ? before.map((b, i) => b !== after[i]).filter(Boolean).length
  : -1; // length mismatch
console.log("NODE Σ before:", JSON.stringify(before));
console.log("NODE Σ after :", JSON.stringify(after));
console.log("changed count:", changed, "(>0 = tick 真传导→节点真变)");

// 5) dump a tick API response showing real propagation
const tickBodies = tickResponses.filter((r) => r.url.includes("/tick"));
const last = tickBodies[tickBodies.length - 1];
if (last) {
  const b = last.body || {};
  const traceLen = (b.trace || b.contributions || b.propagation || []).length;
  console.log("\nTICK API", last.url, "status", last.status, "| trace/contrib len:", traceLen);
  const sampleTrace = (b.trace || b.contributions || b.propagation || []).slice(0, 3);
  console.log("sample trace:", JSON.stringify(sampleTrace).slice(0, 400));
  // look for a real obj id with a moved state value
  const stateKeys = b.state ? Object.keys(b.state).slice(0, 3) : [];
  console.log("state sample keys:", JSON.stringify(stateKeys));
} else {
  console.log("\n(no /tick API response captured; sessions responses:", tickResponses.map(r=>r.url+":"+r.status).slice(0,4).join(", "), ")");
}
await browser.close();
