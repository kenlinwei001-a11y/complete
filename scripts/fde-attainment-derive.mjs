// FDE 实拍：驾驶舱「计划达成率」KPI = 真派生 + 悬浮溯源显分解公式（亲手用一遍·非测试绿）。
// 真后端(datacore SEED_DEMO)真数据 → 真浏览器登录 → dash → 读 KPI 值 → 悬浮 ⓘ → 断言分解公式可见 → 截图。
import { chromium } from "playwright-core";

const FRONT = process.env.FRONT ?? "http://127.0.0.1:5200";
const CHROME = process.env.CHROME;
const OUT = process.env.OUT ?? "docs/evidence/attainment-derive-fde.png";
const OUT2 = process.env.OUT2 ?? "docs/evidence/attainment-decomp-drill-fde.png";
const OUT3 = process.env.OUT3 ?? "docs/evidence/attainment-equip-drill-fde.png";

const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
let failed = false;
const ok = (m) => console.log("✅", m);
const bad = (m) => { console.log("❌", m); failed = true; };
try {
  await page.goto(`${FRONT}/`, { waitUntil: "networkidle" });
  await page.fill("#login-tenant", "demo");
  await page.fill("#login-username", "admin");
  await page.fill("#login-password", "demo1234");
  await page.click("button[type=submit]");
  await page.waitForTimeout(2500);
  // 进驾驶舱：必须走 SPA 内导航（token 在内存，page.goto 整页重载会丢 token 退登录）。
  await page.click('a[href="/v/dash"]');
  await page.waitForTimeout(2000);

  // 找「计划达成率」KPI 卡 + 值
  const attainProv = page.locator('[data-testid="widget-prov-attain"]');
  const has = await attainProv.count();
  if (!has) { bad("未找到 widget-prov-attain（计划达成率 KPI 出处控件）"); }
  else ok("计划达成率 KPI 出处控件在页（widget-prov-attain）");

  const bodyText = await page.locator("body").innerText();
  const m = bodyText.match(/计划达成率[\s\S]{0,40}?(\d{2}\.?\d?)\s*%/);
  if (m) ok(`计划达成率值实拍 = ${m[1]}%（真派生 avg×100）`); else console.log("ℹ️ 未正则到值（不阻断，看截图）");

  // 悬浮 ⓘ → 六要素含分解公式
  await attainProv.scrollIntoViewIfNeeded().catch(() => {});
  await attainProv.hover();
  await page.waitForTimeout(600);
  const tipText = await attainProv.innerText().catch(() => "");
  const wantFormula = tipText.includes("设备效率达成") && tipText.includes("良率达成") && tipText.includes("oee:equip");
  const wantNote = tipText.includes("具体设备/工序") || tipText.includes("逐台勾稽") || tipText.includes("逐台设备");
  if (wantFormula) ok("悬浮溯源显分解公式：达成率 = 设备效率达成 × 良率达成（产线OEE=Σoee:equip×产量/Σ产量）"); else bad(`悬浮未见分解公式（tip=${JSON.stringify(tipText).slice(0,200)}）`);
  if (wantNote) ok("悬浮显逐台勾稽口径（点到具体设备/工序）"); else console.log("ℹ️ 备注勾稽文案未匹配（看截图）");

  await page.screenshot({ path: OUT, fullPage: false });
  ok(`截图已存 ${OUT}`);

  // 逐日拆因下钻：点 KPI → DagNodeDrawer 逐日明细表
  const drill = page.locator('[data-testid="kpi-drill-attain"]');
  if (await drill.count()) {
    await drill.click();
    await page.waitForSelector('[data-testid="dag-node-breakdown"]', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(800);
    const bd = page.locator('[data-testid="dag-node-breakdown"]');
    if (await bd.count()) {
      const rows = await page.locator('[data-testid="breakdown-row"], [data-testid="breakdown-dip-row"]').count();
      const dips = await page.locator('[data-testid="breakdown-dip-row"]').count();
      const bdText = await bd.innerText();
      const hasCols = bdText.includes("设备效率达成") && bdText.includes("良率达成") && bdText.includes("产线OEE") && bdText.includes("主因");
      if (rows > 0 && hasCols) ok(`逐日拆因表渲染：${rows} 日（${dips} 日低于期均标灰）·列含 设备效率达成/良率达成/产线OEE/主因`);
      else bad(`逐日拆因表异常 rows=${rows} cols=${hasCols}`);
      await page.screenshot({ path: OUT2, fullPage: false });
      ok(`下钻截图已存 ${OUT2}`);

      // Level-3 逐设备勾稽：点 action「下钻最差日·最差产线逐设备」
      const action = page.locator('[data-testid="dag-node-action"]');
      if (await action.count()) {
        await action.first().click();
        await page.waitForTimeout(1500);
        const bd3 = page.locator('[data-testid="dag-node-breakdown"]');
        const t3 = await bd3.innerText().catch(() => "");
        const rows3 = await page.locator('[data-testid="breakdown-row"], [data-testid="breakdown-dip-row"]').count();
        const hasEquip = t3.includes("设备 OEE") || t3.includes("工序良率");
        if (rows3 > 0 && hasEquip) ok(`逐设备勾稽表渲染：${rows3} 行（含 设备 OEE / 工序良率·最低 OEE 设备标灰=拖累点）`);
        else bad(`逐设备勾稽表异常 rows=${rows3} hasEquip=${hasEquip} text=${JSON.stringify(t3).slice(0,160)}`);
        await page.screenshot({ path: OUT3, fullPage: false });
        ok(`逐设备截图已存 ${OUT3}`);
      } else bad("逐日拆因抽屉无「下钻逐设备」action");
    } else bad("点 KPI 后未出现逐日拆因表（dag-node-breakdown）");
  } else bad("未找到 kpi-drill-attain（计划达成率 KPI 不可点开下钻）");
} catch (e) {
  bad(`异常：${e.message}`);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
