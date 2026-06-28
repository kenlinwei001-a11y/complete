// FDE 实拍（G-9 招牌端到端·空租户）：登录**空世界租户 fresh** → 场景管理台「一键长出此卡」→
// 后端探测世界全空 → 经合成正门 provision 起步世界 → 重跑验证 → GOVERNED，留痕显 "provision N 对象起步世界"。
import { chromium } from "playwright-core";
const FRONT = process.env.FRONT ?? "http://127.0.0.1:5200";
const CHROME = process.env.CHROME;
const OUT = process.env.OUT ?? "docs/evidence/g9-grow-empty-tenant-fde.png";
const b = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
let failed = false;
const ok = (m) => console.log("✅", m);
const bad = (m) => { console.log("❌", m); failed = true; };
try {
  await p.goto(`${FRONT}/`, { waitUntil: "networkidle" });
  await p.fill("#login-tenant", "fresh"); await p.fill("#login-username", "admin"); await p.fill("#login-password", "demo1234");
  await p.click("button[type=submit]"); await p.waitForTimeout(2500);
  ok("登录空世界租户 fresh");
  const link = p.locator('a[href="/admin/scenes"]');
  if (await link.count()) await link.first().click(); else await p.evaluate(() => window.history.pushState({}, "", "/admin/scenes"));
  await p.waitForTimeout(2500);
  const grow = p.locator('[data-testid^="scenario-grow-"]').first();
  if (!(await grow.count())) { bad("场景管理台无「一键长出此卡」按钮"); }
  else {
    ok("空租户场景管理台「一键长出此卡」在页");
    await grow.scrollIntoViewIfNeeded().catch(() => {});
    await grow.click();
    // 真后端：探测空世界→provision 合成世界(runJob)→重验，耗时较长，轮询留痕出现
    let mat = "", growthTx = "";
    for (let i = 0; i < 40; i++) {
      await p.waitForTimeout(1500);
      mat = (await p.locator('[data-testid^="scenario-maturity-"]').first().innerText().catch(() => "")).trim();
      growthTx = (await p.locator('[data-testid^="scenario-growth-"]').first().innerText().catch(() => "")).replace(/\s+/g, " ");
      if (/已验证|可用/.test(mat) && /provision/.test(growthTx)) break;
    }
    if (/已验证|可用/.test(mat)) ok(`maturity 徽章：「${mat}」（空租户长出后 GOVERNED）`); else bad(`maturity 未达 GOVERNED：「${mat}」`);
    if (/provision .* 对象起步世界/.test(growthTx)) ok(`发育留痕显 provision 故事：${growthTx.slice(0, 110)}`); else bad(`provision 留痕未现：${JSON.stringify(growthTx).slice(0, 160)}`);
    const verif = (await p.locator('[data-testid^="scenario-verif-"]').first().innerText().catch(() => "")).replace(/\s+/g, " ");
    ok(`验证留痕：${verif.slice(0, 80)}`);
    await p.screenshot({ path: OUT, fullPage: false });
    ok(`截图已存 ${OUT}`);
  }
} catch (e) { bad(`异常：${e.message}`); } finally { await b.close(); }
process.exit(failed ? 1 : 0);
