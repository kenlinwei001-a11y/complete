// WO-RC-UX-KPI-CARRIER · 真浏览器：治「推了没反应·死的」——tick 后 KPI 磁贴（传导目标 loadIndex）随 DAG 真动·非恒 0。
import { chromium } from "playwright-core";
const FRONT = process.env.FRONT ?? "http://localhost:5175";
const CHROME = process.env.CHROME;
const results = []; const ok = (m) => { results.push(1); console.log("✅", m); };
const bad = (m) => { results.push(0); console.log("❌", m); };
const b = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
try {
  await p.goto(`${FRONT}/`, { waitUntil: "networkidle" });
  await p.fill("#login-username", "admin"); await p.fill("#login-password", "demo1234");
  await p.click("button[type=submit]"); await p.waitForTimeout(2000);
  // 带任意参数 → 不触发裸访问 302 → 渲染沙盘下钻态（KPI 磁贴在此）
  await p.goto(`${FRONT}/v/sim-sandbox?dev=kpi-carrier`, { waitUntil: "networkidle" });
  await p.waitForSelector("[data-testid=sandbox-kpis]", { timeout: 15000 });
  await p.waitForTimeout(1500);
  // 找传导目标磁贴（loadIndex 或 demandLoad——初始无载体·tick 后应被传导写入）
  const vars = await p.locator('[data-testid^=sandbox-kpi-][data-testid$=-val]').evaluateAll(
    (els) => els.map((e) => ({ id: e.getAttribute("data-testid"), val: e.textContent?.trim() })),
  );
  console.log("· tick0 磁贴:", JSON.stringify(vars));
  const target = vars.find((v) => /loadIndex|demandLoad/i.test(v.id ?? ""));
  if (!target) { bad("找不到传导目标磁贴(loadIndex/demandLoad)"); }
  else {
    const before = Number(target.val);
    ok(`tick0 传导目标磁贴 ${target.id} = ${target.val}`);
    // 推进 3 tick
    await p.fill("[data-testid=sandbox-tick-days]", "3").catch(() => {});
    await p.click("[data-testid=sandbox-tick-btn]");
    await p.waitForFunction(() => Number(document.querySelector("[data-testid=sandbox-cur-tick]")?.textContent) >= 3, { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(1000);
    const afterTxt = await p.locator(`[data-testid="${target.id}"]`).textContent();
    const after = Number(afterTxt);
    console.log(`· tick3 传导目标磁贴 ${target.id} = ${afterTxt}`);
    (after > 0 && after !== before)
      ? ok(`tick 后磁贴真动：${before} → ${after}（治「推了没反应·死的」·磁贴随 DAG 传导·KILL-MOCK-RED 取真 post-tick 态）`)
      : bad(`磁贴仍恒 0/未动：${before} → ${after}（死的错觉未修）`);
  }
  await p.screenshot({ path: "docs/evidence/RC-UX-KPI-CARRIER-realbrowser.png", fullPage: false });
  ok("截图 docs/evidence/RC-UX-KPI-CARRIER-realbrowser.png");
} catch (e) { bad("异常：" + (e?.message ?? String(e))); } finally { await b.close(); }
const failed = results.filter((r) => !r).length;
console.log(`\n${failed === 0 ? "✅ 全绿" : "❌ 有红"}：${results.length - failed}/${results.length}`);
process.exit(failed === 0 ? 0 : 1);
