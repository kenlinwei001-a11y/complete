/* eslint-disable */
/**
 * 判据 5 · 动线四个数（总步数 · 总点击 · 页面跳转 · 卡在第几步）。
 *
 * 计数口径写死在这里，免得事后各说各话：
 *  · **步** = 用户看得见的一个动作（打开站点 / 填一格 / 点一下 / 读一屏）
 *  · **点击** = 真实 mousedown（填表不算，键盘输入不算）
 *  · **页面跳转** = `location.pathname` 变了一次
 *  · **卡在第几步** = 第一个「想做但做不了」的步
 *
 * ⛔ 从登录走起，全程零手敲 URL。租户格默认已是 `demo`，所以它**不计一步**（实测默认值）。
 */
import { launch, login, shot, sleep, BASE } from "./lib.mjs";

const R = { steps: [], counts: {}, blocked: null, homeCount: {} };
let clicks = 0;
let navs = 0;
let lastPath = null;

const { browser, page } = await launch();

function rec(act, kind, note) {
  const p = new URL(page.url()).pathname;
  if (lastPath !== null && p !== lastPath) navs += 1;
  lastPath = p;
  if (kind === "click") clicks += 1;
  R.steps.push({ n: R.steps.length + 1, act, kind, path: p, note: note ?? null });
}

try {
  // ── 步 1：打开站点（地址栏只输站点根）─────────────────────────────
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#login-username", { timeout: 30000 });
  lastPath = new URL(page.url()).pathname;
  navs = 1;
  R.steps.push({ n: 1, act: "打开站点根 → 自动落在登录页", kind: "nav", path: lastPath });
  R.shot01 = await shot(page, "W1-login");
  R.tenantDefault = await page.inputValue("#login-tenant");

  // ── 步 2/3：填账号、填密码（租户默认已是 demo，不占一步）──────────
  await page.fill("#login-username", "admin");
  rec("在【账号】格里输入 admin", "type");
  await page.fill("#login-password", "demo1234");
  rec("在【密码】格里输入密码", "type");

  // ── 步 4：点登录 ───────────────────────────────────────────────────
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="home-page"]', { timeout: 30000 });
  await sleep(1500);
  rec("点【登录】", "click");
  R.shot02 = await shot(page, "W2-home");

  // 首页入口普查（判据 1 的机检部分）
  R.homeCount = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden";
    };
    const views = Array.from(document.querySelectorAll('[data-testid^="home-view-"]')).filter(vis);
    const hot = Array.from(document.querySelectorAll('[data-testid^="home-scenario-"]')).filter(vis);
    const all = Array.from(document.querySelectorAll('[data-testid="home-all-scenarios"]')).filter(vis);
    const names = views.map((e) => e.innerText.trim());
    // 「推演类」= 产出一个**预测/推演/优化结果**的入口（对照：台账/图谱/地图是看现状）
    const SIM = /推演|规划|可行性|优选|寻优|归因|传导|体检|建议/;
    return {
      hotN: hot.length,
      viewN: views.length,
      allN: all.length,
      totalClickable: hot.length + views.length + all.length,
      viewNames: names,
      simLike: names.filter((n) => SIM.test(n)),
      // 首页上有没有「统一推演控制台 / 推演沙盘 / 事件影响与对策」这三个侧栏里有的推演屏？
      missingFromHome: ["统一推演控制台", "推演沙盘", "事件影响与对策"].filter(
        (t) => !names.includes(t) && !hot.some((h) => h.innerText.includes(t)),
      ),
      // 金丝雀：一个我确定在首页上的名字，同一把尺子必须命中
      canaryPresent: names.includes("经营驾驶舱"),
    };
  });

  // ── 步 5：在首页找推演入口 —— 这一步做不了（首页没有统一推演控制台）──
  R.steps.push({
    n: R.steps.length + 1,
    act: "在首页找【统一推演控制台】入口",
    kind: "look",
    path: lastPath,
    note:
      R.homeCount.missingFromHome.length > 0
        ? `❌ 找不到：首页 ${R.homeCount.viewN} 张业务视图卡里没有 ${R.homeCount.missingFromHome.join(" / ")}（它们只在左侧栏）`
        : "✅ 首页上有",
  });
  if (R.homeCount.missingFromHome.length > 0 && R.blocked === null) {
    R.blocked = { step: R.steps.length, why: "首页没有推演控制台入口，必须改走左侧栏" };
  }

  // ── 步 6：改走左侧栏 ───────────────────────────────────────────────
  await page.locator("nav a, aside a").filter({ hasText: "统一推演控制台" }).first().click();
  await sleep(4500);
  rec("在左侧栏点【统一推演控制台】", "click");
  R.shot03 = await shot(page, "W3-unified");

  // ── 步 7：点【施加并推演】 ────────────────────────────────────────
  const run = page.locator("button").filter({ hasText: "施加并推演" }).first();
  R.runEnabled = await run.isEnabled().catch(() => false);
  if (R.runEnabled) {
    await run.click();
    await sleep(9000);
    rec("点【施加并推演】（默认扰动，一格没改）", "click");
    R.shot04 = await shot(page, "W4-after-run");
  }

  // ── 步 8：想看「演习结论」——真点一下看拦不拦 ───────────────────────
  const verdict = page.locator("button").filter({ hasText: "演习结论" }).first();
  const vDisabled = await verdict.isDisabled().catch(() => true);
  R.steps.push({
    n: R.steps.length + 1,
    act: "点【演习结论】页签想看这次推演的结论",
    kind: "click-attempt",
    path: lastPath,
    note: vDisabled ? "❌ 点不动（disabled）" : "✅ 点得动",
  });
  R.verdictDisabled = vDisabled;
  if (vDisabled && R.blocked === null) R.blocked = { step: R.steps.length, why: "演习结论页签禁用" };
  R.verdictTitle = await verdict.getAttribute("title");

  // ── 步 9：退而求其次，点【损失归因】────────────────────────────────
  await page.locator("button").filter({ hasText: "损失归因" }).first().click();
  await sleep(6000);
  rec("改点【损失归因】", "click");
  R.shot05 = await shot(page, "W5-attribution");
  const attrTxt = await page.evaluate(() => document.body.innerText);
  R.attrMoney = {
    yuan: (attrTxt.match(/元/g) ?? []).length,
    yi: (attrTxt.match(/亿/g) ?? []).length,
    wan: (attrTxt.match(/万/g) ?? []).length,
    days: (attrTxt.match(/\d+(\.\d+)?D\b/g) ?? []).length,
    pct: (attrTxt.match(/\d+%/g) ?? []).length,
  };

  // ── 步 10：点【方案寻优】看有没有钱 ───────────────────────────────
  await page.locator("button").filter({ hasText: "方案寻优" }).first().click();
  await sleep(9000);
  rec("改点【方案寻优】", "click");
  R.shot06 = await shot(page, "W6-optimize");
  const optTxt = await page.evaluate(() => document.body.innerText);
  R.optMoney = {
    yuan: (optTxt.match(/元/g) ?? []).length,
    yi: (optTxt.match(/亿/g) ?? []).length,
    rawBigNum: (optTxt.match(/\d{9,}\.?\d*元/g) ?? []).slice(0, 6),
    yiFormatted: (optTxt.match(/[\d.]+亿元/g) ?? []).slice(0, 8),
  };

  R.counts = { totalSteps: R.steps.length, clicks, navs };
} catch (e) {
  R.FATAL = String(e && e.stack ? e.stack : e).slice(0, 600);
  try { R.shotFatal = await shot(page, "ERR-walk"); } catch {}
} finally {
  await browser.close();
}
console.log(JSON.stringify(R, null, 2));
