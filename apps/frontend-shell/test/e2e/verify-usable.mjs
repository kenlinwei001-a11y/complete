/* eslint-disable */
/**
 * WO-HOME-ENTRY-FLOW · **绿测试 ≠ 能用**：新加的三个首页入口与四张指引卡，逐个**真点一遍**。
 *
 * 为什么要有这一支：判据表那四格量的都是「屏上有没有 / 搜不搜得到」——
 * 全是**存在性**。存在性证明不了「点下去真到得了那一页」。本仓记过这笔账：
 * 「组件写了 ✅ → renderer 注册 ✅ → 后端派单 ✅ → 屏上仍然到不了」。
 * 故每个新入口必须：真点 → 真换 URL → 真渲染出内容（不是空壳、不是 404 文案）。
 *
 * ⛔ 全程从登录走起，零手敲 URL；每次点完**回首页再点下一个**（点链跳转会改变 DOM，
 *    拿旧 locator 接着点会撞 detached node，那种失败读起来像"入口坏了"，其实是脚本坏了）。
 */
import { launch, login, shot, sleep, attachNetLog, assertNoMock, BASE } from "./lib.mjs";

const R = { at: new Date().toISOString(), routeEntries: [], guides: [] };
const { browser, page, consoleErrors } = await launch();
const net = attachNetLog(page);

/** 一屏"真渲染了内容"的判据：正文非空、且不含 404/无权 的兜底文案。 */
async function screenState() {
  return await page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    const txt = (main.innerText ?? "").trim();
    return {
      path: location.pathname,
      textLen: txt.length,
      head: txt.slice(0, 120).replace(/\n+/g, " | "),
      looksBroken: /页面不存在|无权访问|FEATURE_NOT_FOUND|Not Found|出错了/.test(txt),
    };
  });
}

async function backHome() {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="home-page"]', { timeout: 30000 });
  await sleep(1000);
}

try {
  await login(page);
  await sleep(1800);
  R.noMock = assertNoMock(net);

  // ── 三个新首页入口：真点 → 真到 ────────────────────────────────────
  for (const [key, label] of [
    ["sim-unified", "统一推演控制台"],
    ["sim-sandbox", "推演沙盘"],
    ["decision-console", "事件影响与对策"],
  ]) {
    await backHome();
    const link = page.locator(`[data-testid="home-view-${key}"]`);
    const present = (await link.count()) > 0;
    if (!present) {
      R.routeEntries.push({ key, label, present: false });
      continue;
    }
    const linkText = (await link.first().innerText()).trim();
    await link.first().click();
    await page.waitForFunction((k) => location.pathname === `/v/${k}`, key, { timeout: 30000 }).catch(() => {});
    await sleep(2200);
    const st = await screenState();
    R.routeEntries.push({ key, label, present: true, linkText, ...st, shot: await shot(page, `U-route-${key}`) });
  }

  // ── 四张指引卡：真点 → 真起推演（落点视图 + 对话坞展开）────────────
  for (const gk of ["material-delay", "delivery-risk", "shutdown", "rush-order"]) {
    await backHome();
    const chip = page.locator(`[data-testid="home-event-${gk}"]`);
    const present = (await chip.count()) > 0;
    if (!present) {
      R.guides.push({ gk, present: false });
      continue;
    }
    const chipText = (await chip.first().innerText()).replace(/\n+/g, " | ").trim();
    await chip.first().click();
    await sleep(3000);
    const st = await screenState();
    // 点一张卡 = 起一段推演对话：落点视图变了 + 对话坞里出现了那句问句
    const dock = await page.evaluate(() => {
      const t = document.body.innerText;
      return { leftHome: location.pathname !== "/", bodyHead: t.slice(0, 200).replace(/\n+/g, " | ") };
    });
    R.guides.push({ gk, present: true, chipText, ...st, ...dock, shot: await shot(page, `U-guide-${gk}`) });
  }
  R.consoleErrors = consoleErrors.slice(0, 10);
} catch (e) {
  R.FATAL = String(e && e.stack ? e.stack : e).slice(0, 900);
  try {
    R.shotFatal = await shot(page, "U-ERR");
  } catch {}
} finally {
  await browser.close();
}
console.log(JSON.stringify(R, null, 2));
