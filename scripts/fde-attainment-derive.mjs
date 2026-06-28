// FDE 实拍：驾驶舱「计划达成率」KPI = 真派生 + 悬浮溯源显分解公式（亲手用一遍·非测试绿）。
// 真后端(datacore SEED_DEMO)真数据 → 真浏览器登录 → dash → 读 KPI 值 → 悬浮 ⓘ → 断言分解公式可见 → 截图。
import { chromium } from "playwright-core";

const FRONT = process.env.FRONT ?? "http://127.0.0.1:5200";
const CHROME = process.env.CHROME;
const OUT = process.env.OUT ?? "docs/evidence/attainment-derive-fde.png";
const OUT2 = process.env.OUT2 ?? "docs/evidence/attainment-decomp-drill-fde.png";
const OUT3 = process.env.OUT3 ?? "docs/evidence/attainment-line-ranking-fde.png";
const OUT4 = process.env.OUT4 ?? "docs/evidence/attainment-equip-drill-fde.png";
const OUT5 = process.env.OUT5 ?? "docs/evidence/attainment-equip-trend-fde.png";

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

      // A3 全线排行：点 action「下钻最差日·全线排行」
      const action = page.locator('[data-testid="dag-node-action"]');
      if (await action.count()) {
        await action.first().click();
        await page.waitForTimeout(1500);
        const tLines = await page.locator('[data-testid="dag-node-breakdown"]').innerText().catch(() => "");
        const lineRows = await page.locator('[data-testid="breakdown-row"], [data-testid="breakdown-dip-row"]').count();
        if (lineRows > 1 && tLines.includes("产线") && tLines.includes("达成率")) ok(`A3 全线排行表：${lineRows} 线（达成率升序·可点选）`);
        else bad(`A3 全线排行异常 rows=${lineRows} text=${JSON.stringify(tLines).slice(0,140)}`);
        await page.screenshot({ path: OUT3, fullPage: false });
        ok(`全线排行截图已存 ${OUT3}`);

        // 点最差线行 → 逐设备勾稽
        await page.locator('[data-testid="breakdown-dip-row"]').first().click();
        await page.waitForTimeout(1500);
        const tEquip = await page.locator('[data-testid="dag-node-breakdown"]').innerText().catch(() => "");
        const eqRows = await page.locator('[data-testid="breakdown-row"], [data-testid="breakdown-dip-row"]').count();
        const hasEquip = tEquip.includes("设备 OEE") || tEquip.includes("工序良率");
        if (eqRows > 0 && hasEquip) ok(`逐设备勾稽表：${eqRows} 行（含 设备 OEE / 工序良率·最低标灰=拖累点）`);
        else bad(`逐设备表异常 rows=${eqRows} hasEquip=${hasEquip} text=${JSON.stringify(tEquip).slice(0,160)}`);
        await page.screenshot({ path: OUT4, fullPage: false });
        ok(`逐设备截图已存 ${OUT4}`);

        // A2 点设备行 → OEE 趋势
        await page.locator('[data-testid="breakdown-dip-row"]').first().click();
        await page.waitForTimeout(1500);
        const tTrend = await page.locator('[data-testid="dag-node-breakdown"]').innerText().catch(() => "");
        const trRows = await page.locator('[data-testid="breakdown-row"], [data-testid="breakdown-dip-row"]').count();
        if (trRows > 1 && tTrend.includes("OEE") && tTrend.includes("趋势")) ok(`A2 设备 OEE 趋势表：${trRows} 日（点到具体设备时间轴）`);
        else bad(`A2 设备趋势异常 rows=${trRows} text=${JSON.stringify(tTrend).slice(0,140)}`);
        await page.screenshot({ path: OUT5, fullPage: false });
        ok(`设备趋势截图已存 ${OUT5}`);
      } else bad("逐日拆因抽屉无「下钻」action");
    } else bad("点 KPI 后未出现逐日拆因表（dag-node-breakdown）");
  } else bad("未找到 kpi-drill-attain（计划达成率 KPI 不可点开下钻）");
} catch (e) {
  bad(`异常：${e.message}`);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
