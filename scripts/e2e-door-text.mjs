import { chromium } from "playwright-core";
const FRONT = process.env.FRONT ?? "http://localhost:5175";
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ["--no-sandbox","--disable-dev-shm-usage"] });
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } }); let ok=1;
try {
  await p.goto(`${FRONT}/`, { waitUntil: "networkidle" });
  await p.fill("#login-username","admin"); await p.fill("#login-password","demo1234");
  await p.click("button[type=submit]"); await p.waitForTimeout(2000);
  await p.goto(`${FRONT}/v/sim-sandbox?dev=door`, { waitUntil: "networkidle" });
  await p.waitForSelector("[data-testid=sim-cert-canenter]", { timeout: 15000 });
  const t = (await p.locator("[data-testid=sim-cert-canenter]").first().textContent())?.trim();
  console.log("canenter text:", t);
  if (t && t.includes("可试跑") && !t.includes("暂不可进入")) console.log("✅ 未认证态显「可试跑」非「暂不可进入」(审核§4·标准页可试跑)");
  else { console.log("❌ 门文案未改"); ok=0; }
  await p.screenshot({ path: "docs/evidence/RC-UX-DOOR-TEXT-realbrowser.png", fullPage: false });
} catch(e){ console.log("❌",e.message); ok=0; } finally { await b.close(); }
process.exit(ok?0:1);
