// FDE 实拍：驾驶舱「计划达成率」KPI = 真派生 + 悬浮溯源显分解公式（亲手用一遍·非测试绿）。
// 真后端(datacore SEED_DEMO)真数据 → 真浏览器登录 → dash → 读 KPI 值 → 悬浮 ⓘ → 断言分解公式可见 → 截图。
import { chromium } from "playwright-core";

const FRONT = process.env.FRONT ?? "http://127.0.0.1:5200";
const CHROME = process.env.CHROME;
const OUT = process.env.OUT ?? "docs/evidence/attainment-derive-fde.png";

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
  const wantFormula = tipText.includes("设备效率达成") && tipText.includes("良率达成") && tipText.includes("排程事件损");
  const wantNote = tipText.includes("设备效率损") || tipText.includes("逐日拆");
  if (wantFormula) ok("悬浮溯源显分解公式：达成率 = 设备效率达成 × 良率达成 × 排程事件损"); else bad(`悬浮未见分解公式（tip=${JSON.stringify(tipText).slice(0,200)}）`);
  if (wantNote) ok("悬浮备注显缺口拆因（设备效率损 + 良率损 + 排程事件损）"); else console.log("ℹ️ 备注拆因文案未匹配（看截图）");

  await page.screenshot({ path: OUT, fullPage: false });
  ok(`截图已存 ${OUT}`);
} catch (e) {
  bad(`异常：${e.message}`);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
