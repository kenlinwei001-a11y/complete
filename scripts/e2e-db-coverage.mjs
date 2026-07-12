import { chromium } from "playwright-core";
const FRONT = process.env.FRONT ?? "http://localhost:5176";
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ["--no-sandbox","--disable-dev-shm-usage"] });
const p = await b.newPage({ viewport: { width: 1440, height: 1100 } }); let ok=1;
try {
  await p.goto(`${FRONT}/`, { waitUntil: "networkidle" });
  await p.fill("#login-username","admin"); await p.fill("#login-password","demo1234");
  await p.click("button[type=submit]"); await p.waitForTimeout(2000);
  await p.goto(`${FRONT}/admin/data-builder`, { waitUntil: "networkidle" });
  await p.waitForSelector("[data-testid=data-builder-page]", { timeout: 15000 });
  const runBtn = await p.locator("[data-testid=sbr-run]").count();
  if (runBtn) { await p.locator("[data-testid=sbr-run]").first().click(); }
  await p.waitForSelector("[data-testid=sbr-coverage]", { timeout: 20000 }).catch(()=>{});
  await p.waitForTimeout(1500);
  const pctEl = await p.locator("[data-testid=sbr-coverage-pct]").count();
  const pct = pctEl ? (await p.locator("[data-testid=sbr-coverage-pct]").first().textContent())?.trim() : null;
  console.log("覆盖度% 真渲染:", pct, "| 拒绝门:", await p.locator("[data-testid=sbr-coverage-reject-gate]").count());
  if (pctEl>0 && /%/.test(pct||"")) console.log("✅ 数据构建页故事覆盖度真显百分比(暴露读懂几成·§3 理解确认门)");
  else { console.log("❌ 覆盖度% 未渲染"); ok=0; }
  await p.screenshot({ path: "docs/evidence/DB-FIVE-ACT-UX-coverage-realbrowser.png", fullPage: false });
} catch(e){ console.log("❌",e.message); ok=0; } finally { await b.close(); }
process.exit(ok?0:1);
