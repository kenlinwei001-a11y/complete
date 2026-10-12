/* eslint-disable */
/**
 * WO-HOME-ENTRY-FLOW · **同一把尺子**，修前修后各跑一次。
 *
 * 为什么一个脚本跑两次、而不是写两个脚本：修前修后要对比的是**数**，
 * 两个脚本量出来的数不可比（这正是本仓「我用 X 当作 Y 的证据」的老形态）。
 * 故本文件一个字都不许因为"改完了"而改 —— 改了就得两边重跑。
 *
 * 输出四格（与工单的对照实验表一一对应）：
 *   G1 走到「统一推演控制台」：来源（首页/侧栏）+ 总点击数
 *   G2 ⌘K 逐词：物料延期 / 延期 / 停机 / 插单（+ 金丝雀 物料 / 订单）
 *   G3 反向对照：首页 home-view-* 计数、侧栏业务类计数（一项都不许丢）
 *   G4 金丝雀：「经营驾驶舱」必须被同一把尺子量到；量不到 ⇒ 报「量法坏了」
 *
 * ⛔ 三条纪律（继承自 lib.mjs，此处再钉一遍因为最容易在改完后偷懒）：
 *   1. 禁 VITE_MOCK —— `assertNoMock()` 实测网络回包，不是"我没设那个变量"这种自证。
 *   2. 从登录走起 —— 唯一允许的 goto 是站点根。手敲 /v/sim-unified 会让本单要测的问题整个消失。
 *   3. ⌘K 每个词**关掉面板重开、从空串打起** —— 取证方第一版用 `Control+a` 想清空，
 *      实际没选中，查的是「物料延期物料」这种拼接串：两次都报「无匹配」看着一致，
 *      **却什么都没证明**。本版每词 Esc → 重开 → `fill("")` → 打，且回显 inputValue 自证。
 */
import { launch, login, shot, sleep, attachNetLog, assertNoMock, BASE } from "./lib.mjs";

const TAG = process.env.E2E_TAG ?? "before";
const R = { tag: TAG, at: new Date().toISOString() };

const { browser, page, consoleErrors } = await launch();
const net = attachNetLog(page);

/** 首页 / 侧栏的普查 —— 修前修后同一段代码，故两边的数可比。 */
const INVENTORY = () => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  };
  const views = Array.from(document.querySelectorAll('[data-testid^="home-view-"]')).filter(vis);
  const hot = Array.from(document.querySelectorAll('[data-testid^="home-scenario-"]')).filter(vis);
  const all = Array.from(document.querySelectorAll('[data-testid="home-all-scenarios"]')).filter(vis);
  const viewNames = views.map((e) => e.innerText.trim());
  const viewKeys = views.map((e) => e.dataset.testid.replace(/^home-view-/, ""));
  // 侧栏：业务类 = 非 /admin/ 的导航链接（与取证方 recon 的口径逐字相同）
  const navAll = Array.from(document.querySelectorAll("nav a, aside a, header a")).filter(vis);
  const navBiz = navAll
    .map((a) => ({ href: a.getAttribute("href"), text: a.innerText.trim() }))
    .filter((x) => x.href && !x.href.startsWith("/admin/"));
  return {
    hotN: hot.length,
    viewN: views.length,
    allN: all.length,
    viewNames,
    viewKeys,
    navAllN: navAll.length,
    navBizN: navBiz.length,
    navBiz: navBiz.map((x) => `${x.text} ${x.href}`),
    // 侧栏有、首页没有的三个推演屏（本单的靶子）
    missingFromHome: ["统一推演控制台", "推演沙盘", "事件影响与对策"].filter((t) => !viewNames.includes(t)),
    // G4 金丝雀：一个我**确定**首页有的名字，同一把尺子必须命中。
    // 它若也报没有 ⇒ 结论是「量法坏了」，不许报「首页没有 X」。
    canaryPresent: viewNames.includes("经营驾驶舱"),
    // 指引：屏上有没有一句话回答「物料延期该点哪个」
    guidanceText: (document.querySelector('[data-testid="home-event-guidance"]')?.innerText ?? "").replace(/\n+/g, " | "),
    guidanceChips: Array.from(document.querySelectorAll('[data-testid^="home-event-"]'))
      .filter(vis)
      .map((e) => e.innerText.replace(/\n+/g, " | ").trim()),
  };
};

/** ⌘K 逐词：每词 Esc 关闭 → Ctrl+K 重开 → fill("") 清空 → 打词。回显 inputValue 自证没拼接。 */
async function ask(word) {
  await page.keyboard.press("Escape");
  await sleep(400);
  await page.keyboard.press("Control+k");
  await sleep(900);
  const dlg = page.locator('[role="dialog"]');
  if ((await dlg.count()) === 0) return { word, opened: false };
  const input = dlg.locator("input").first();
  await input.click();
  await input.fill("");
  await sleep(300);
  // ⚠ 用 fill 而不是逐键 type：本轮另有一张单在修「每点一次只能输一个 ASCII 字符」的焦点 bug；
  //   fill 一次 change 交付整串（与 CJK 走 IME 上屏同构），绕开那个 bug —— 本单量的是**搜得到搜不到**，
  //   不是那个 bug 修没修。inputValue 回显即证明整串真进去了。
  await input.fill(word);
  await sleep(1200);
  const txt = await dlg.innerText();
  const rows = await dlg.evaluate((d) =>
    Array.from(d.querySelectorAll("button[data-testid^='command-palette-item-']")).map((e) =>
      e.innerText.replace(/\s*\n\s*/g, " | ").trim(),
    ),
  );
  return {
    word,
    opened: true,
    inputValue: await input.inputValue(),
    noMatch: /无匹配场景/.test(txt),
    rowCount: rows.length,
    rows: rows.slice(0, 6),
  };
}

let clicks = 0;
const steps = [];
function rec(act, kind, note) {
  if (kind === "click") clicks += 1;
  steps.push({ n: steps.length + 1, act, kind, path: new URL(page.url()).pathname, note: note ?? null });
}

try {
  // ── 从登录走起（唯一允许的 goto）──────────────────────────────────
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#login-username", { timeout: 30000 });
  steps.push({ n: 1, act: "打开站点根 → 落登录页", kind: "nav", path: new URL(page.url()).pathname });
  await page.fill("#login-tenant", "demo");
  await page.fill("#login-username", "admin");
  await page.fill("#login-password", "demo1234");
  rec("填账号/密码（租户默认 demo）", "type");
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="home-page"]', { timeout: 30000 });
  rec("点【登录】", "click");
  await sleep(1800);
  R.landed = page.url();
  R.shotHome = await shot(page, `${TAG}-01-home-after-login`);
  R.noMock = assertNoMock(net);

  // ── G3/G4：首页 + 侧栏普查 ────────────────────────────────────────
  R.inventory = await page.evaluate(INVENTORY);

  // ── G1：走到「统一推演控制台」。先在首页找；找不到才退侧栏 ────────
  const homeLink = page.locator('[data-testid="home-view-sim-unified"]');
  const foundOnHome = (await homeLink.count()) > 0;
  R.g1 = { foundOnHome };
  if (foundOnHome) {
    rec("在首页看到【统一推演控制台】", "look");
    await homeLink.first().click();
    rec("点首页的【统一推演控制台】", "click");
    R.g1.source = "home";
  } else {
    rec("在首页找【统一推演控制台】—— 没有，改看侧栏", "look-FAILED");
    const sideLink = page.locator('nav a[href="/v/sim-unified"], aside a[href="/v/sim-unified"]');
    R.g1.sidebarPresent = (await sideLink.count()) > 0;
    await sideLink.first().click();
    rec("点侧栏的【统一推演控制台】", "click");
    R.g1.source = "sidebar";
  }
  await page.waitForFunction(() => location.pathname === "/v/sim-unified", { timeout: 30000 });
  await sleep(1500);
  R.g1.landedPath = new URL(page.url()).pathname;
  R.g1.clicksFromLogin = clicks;
  R.g1.totalSteps = steps.length;
  R.g1.shot = await shot(page, `${TAG}-02-unified-console`);
  R.steps = steps;

  // 回首页，再做 ⌘K（面板全局可用，但从首页起最贴近真实动线）
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="home-page"]', { timeout: 30000 });
  await sleep(1200);

  // ── G2：⌘K 逐词。金丝雀在前（证明这把尺子是活的），靶词在后 ────────
  R.palette = [];
  for (const w of ["物料", "订单", "物料延期", "延期", "停机", "插单"]) {
    R.palette.push(await ask(w));
  }
  await page.keyboard.press("Escape");
  await sleep(400);
  await page.keyboard.press("Control+k");
  await sleep(900);
  const dlg2 = page.locator('[role="dialog"]');
  if ((await dlg2.count()) > 0) {
    await dlg2.locator("input").first().fill("物料延期");
    await sleep(1200);
    R.shotPalette = await shot(page, `${TAG}-03-palette-material-delay`);
  }
  R.consoleErrors = consoleErrors.slice(0, 10);
} catch (e) {
  R.FATAL = String(e && e.stack ? e.stack : e).slice(0, 900);
  try {
    R.shotFatal = await shot(page, `${TAG}-ERR`);
  } catch {}
} finally {
  await browser.close();
}
console.log(JSON.stringify(R, null, 2));
