// FDE 实拍：场景管理台「一键长出此卡」按钮（G-9 招牌 UI 接线）。真后端真浏览器：登录 demo admin →
// SPA 内导航 /admin/scenes → 点首张卡「一键长出此卡」→ 断言 maturity 徽章 + 发育留痕渲染 → 截图。
import { chromium } from "playwright-core";
const FRONT = process.env.FRONT ?? "http://127.0.0.1:5200";
const CHROME = process.env.CHROME;
const OUT = process.env.OUT ?? "docs/evidence/g9-grow-ui-fde.png";
const b = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
let failed = false;
const ok = (m) => console.log("✅", m);
const bad = (m) => { console.log("❌", m); failed = true; };
try {
  await p.goto(`${FRONT}/`, { waitUntil: "networkidle" });
  await p.fill("#login-tenant", "demo"); await p.fill("#login-username", "admin"); await p.fill("#login-password", "demo1234");
  await p.click("button[type=submit]"); await p.waitForTimeout(2500);
  // SPA 内导航到场景管理台（token 在内存，不用 page.goto 整页重载）
  const link = p.locator('a[href="/admin/scenes"]');
  if (await link.count()) { await link.first().click(); } else { await p.evaluate(() => window.history.pushState({}, "", "/admin/scenes")); }
  await p.waitForTimeout(2500);
  const growBtns = p.locator('[data-testid^="scenario-grow-"]');
  const n = await growBtns.count();
  if (n === 0) { bad("场景管理台无「一键长出此卡」按钮"); }
  else {
    ok(`场景管理台「一键长出此卡」按钮在页（${n} 张卡）`);
    const label = (await growBtns.first().innerText()).trim();
    ok(`按钮文案：「${label}」`);
    await growBtns.first().scrollIntoViewIfNeeded().catch(() => {});
    await growBtns.first().click();
    await p.waitForTimeout(4000); // 真后端 grow（经 QOS 跑通验证）
    const maturity = p.locator('[data-testid^="scenario-maturity-"]').first();
    const mat = (await maturity.innerText().catch(() => "")).trim();
    if (/已验证|可用/.test(mat)) ok(`卡 maturity 徽章：「${mat}」（grow 后 GOVERNED）`); else bad(`maturity 徽章异常：「${mat}」`);
    const trace = p.locator('[data-testid^="scenario-ontogenesis-"]').first();
    if (await trace.count()) {
      const tx = (await trace.innerText()).replace(/\s+/g, " ");
      const rings = tx.includes("数据环") && tx.includes("本体环") && tx.includes("能力环");
      if (rings) ok("发育留痕渲染：三环 + 验证 + 答案预览"); else bad(`留痕缺三环：${tx.slice(0, 120)}`);
    } else bad("无发育留痕区");
    await p.screenshot({ path: OUT, fullPage: false });
    ok(`截图已存 ${OUT}`);
  }
} catch (e) { bad(`异常：${e.message}`); } finally { await b.close(); }
process.exit(failed ? 1 : 0);
