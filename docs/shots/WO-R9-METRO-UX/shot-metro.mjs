/**
 * WO-R9-METRO-UX · 亲眼看屏（真浏览器，不是 jsdom）。
 *
 * 纪律（派单原文）：登录后**必须在应用内点导航**进沙盘 ——
 * 直接 goto 是硬跳转，会丢内存里的 token，被踢回 /login。
 *
 * 用法：node shot-metro.mjs <baseUrl> <user> <outDir>
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/node_modules/playwright-core/index.mjs";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://127.0.0.1:5203";
const USER = process.argv[3] ?? "planner";
const OUT = process.argv[4] ?? "docs/shots/WO-R9-METRO-UX";
mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log("[shot]", ...a);

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1680, height: 1080 } });
page.on("console", (m) => {
  if (m.type() === "error") log("PAGE-ERR", m.text().slice(0, 200));
});

try {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.fill("#login-tenant", "demo");
  await page.fill("#login-username", USER);
  await page.fill("#login-password", "demo1234");
  await page.click("button[type=submit]");
  await page.waitForSelector("[data-testid=left-nav]", { timeout: 60000 });
  log("登录成功");

  // ⚠ 应用内点导航（不 goto）
  const navSel = "[data-testid=nav-sim-sandbox]";
  const nav = await page.$(navSel);
  if (!nav) {
    const ids = await page.$$eval("[data-testid^=nav-]", (els) => els.map((e) => e.getAttribute("data-testid")));
    throw new Error(`找不到 ${navSel}；现有导航 testid：${ids.join(", ")}`);
  }
  await nav.scrollIntoViewIfNeeded();
  await nav.click();
  await page.waitForSelector("[data-testid=sandbox-console]", { timeout: 120000 });
  log("沙盘控制台已落地");

  // 切第五档
  await page.click("[data-testid=sc-mode-process]");
  await page.waitForSelector("[data-testid=spc-board]", { timeout: 120000 });
  await page.waitForTimeout(1200);
  // 适应画布，让整张线路图入镜
  const fit = await page.$("[data-testid=spc-fit]");
  if (fit) await fit.click();
  await page.waitForTimeout(900);

  const counts = await page.$eval("[data-testid=spc-counts]", (e) => ({
    total: e.getAttribute("data-total"),
    laid: e.getAttribute("data-laid"),
  }));
  const overlap = await page.$eval("[data-testid=spc-disjoint]", (e) => e.getAttribute("data-overlap"));
  const basis = await page.$eval("[data-testid=spc-order-basis]", (e) => e.getAttribute("data-basis"));
  const stations = await page.$$eval("[data-testid^=spc-card-]", (els) => els.length);
  const rails = await page.$$eval("[data-testid^=spc-seg-]", (els) => els.length);
  const arcs = await page.$$eval("[data-testid^=spc-ic-]", (els) => els.length);
  const lines = await page.$$eval("[data-testid^=spc-lane-]", (els) => els.filter((e) => e.tagName.toLowerCase() === "g").length);
  const titles = await page.$$eval("[data-testid=spc-board] [title], [data-testid=spc-board] svg title", (els) => els.length);
  log("站数恒等式：端点下发", counts.total, "· 上站", counts.laid, "· DOM 站数", stations);
  log("线数", lines, "· 轨段", rails, "· 换乘弧", arcs);
  log("结构红线 data-overlap =", overlap, "· 站序依据 data-basis =", basis, "· 原生 tooltip 数 =", titles);

  await page.screenshot({ path: `${OUT}/01-metro-${USER}.png`, fullPage: false });
  log("截图 1（切档后）已存");

  // 点一座站 → 右栏检视面板。
  // ⚠ 用 `mouse.click` 打在**可见站圈的屏幕坐标**上（真人就是这么点的），
  //    不用 elementHandle.click()：后者点的是 `<g>` 包围盒中心，
  //    而 `<g>` 的包围盒含下方两行标签 —— 那是 playwright 的取点方式带来的偏移，
  //    不是产品的可点性问题（`elementFromPoint` 实测该点命中的就是站圈）。
  //    并且**只挑落在画布可视区内的那座站** —— `.canvas` 是 overflow:hidden，
  //    站的 getBoundingClientRect 即使被裁掉也照样返回几何位置，
  //    照它点会点到画布外面去（真后端 13 条线时实测踩到过：坐标 y=329 落在画布上沿之上）。
  const dot = await page.evaluate(() => {
    const box = document.querySelector("[data-testid=spc-board]").getBoundingClientRect();
    for (const g of document.querySelectorAll("[data-testid^=spc-card-]")) {
      const r = g.querySelector("circle").getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (x > box.left + 4 && x < box.right - 4 && y > box.top + 4 && y < box.bottom - 4) {
        return { x, y, key: g.getAttribute("data-process-key") };
      }
    }
    return null;
  });
  if (dot === null) throw new Error("画布可视区内一座站都没有 —— 适应画布把内容整个顶出了视口");
  const pickedKey = dot.key;
  log("点击坐标", JSON.stringify(dot));
  await page.mouse.click(dot.x, dot.y);
  await page.waitForSelector("[data-testid=pi-panel]", { timeout: 120000 });
  await page.waitForTimeout(1200);
  const panelFor = await page.$eval("[data-testid=pi-panel]", (e) => e.getAttribute("data-process"));
  log("点了站", pickedKey, "→ 检视面板 data-process =", panelFor);
  await page.screenshot({ path: `${OUT}/02-metro-inspect-${USER}.png`, fullPage: false });
  log("截图 2（点站后）已存");

  console.log(
    JSON.stringify(
      { user: USER, served: counts.total, laid: counts.laid, domStations: stations, lines, rails, arcs, overlap, basis, nativeTooltips: titles, pickedKey, panelFor },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
