/* eslint-disable */
/**
 * WO-REAL-FRONTEND-VERIFY · 真浏览器取证公共库
 *
 * 存在的理由：本轮此前所有「前端结论」都是**扫渲染源字符串**推断出来的，
 * 一次浏览器都没开过。这个库把「真登录 → 真点击 → 真读屏」这条路封装成可复跑的脚本。
 *
 * ⛔ 三条硬纪律，写在这里因为它们是本文件存在的前提：
 *  1. **禁 VITE_MOCK** —— 页面必须打真后端（datacore:4001 / agentcore:4002）。
 *     `assertNoMock()` 在每次登录后实测校验，不是靠「我没设那个变量」这种自证。
 *  2. **必须从登录走起** —— `login()` 是唯一入口，不许 `page.goto('/v/xxx')` 直达。
 *     手敲 URL 会让「找不到入口」这一整类问题凭空消失。
 *  3. **报否定结论前先自证量法** —— `countOptions()` / `scanMoney()` 都要求调用方
 *     同时对一个**已知必中**的目标跑一遍（金丝雀）。金丝雀不中 ⇒ 报「量法坏了」，
 *     不许报「屏上没有」。
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:5173";
/**
 * 截图落点。**锚在本文件自己身上，不是 `process.cwd()`**。
 *
 * ⚠ 原来写的是 `path.resolve(process.cwd(), "apps/frontend-shell/test/e2e/shots")` ——
 * 只有从**仓库根**跑才对。从 `apps/frontend-shell/` 跑同一个脚本，截图会静静地落到
 * `apps/frontend-shell/apps/frontend-shell/test/e2e/shots/`，**脚本照样 RC=0、回包里
 * 还是那个 basename**，于是报告引用的 `adv-on.png` 其实是**上一次跑剩下的旧图**。
 * 形态：**「我用『脚本回了这个文件名』当作『这张图是这次跑出来的』的证据，而前者并不度量后者。」**
 * 实测踩过（2026-09-08，本单）：新图落进嵌套目录，仓库里那两张一个字节没动。
 * 锚在 `import.meta.url` 上之后，从哪个目录跑都落同一处。
 */
export const SHOT_DIR = process.env.E2E_SHOTS ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "shots");

mkdirSync(SHOT_DIR, { recursive: true });

/** 全量网络回包记录（判据 6 要的就是「用户那条路上的回包」，不是 curl 的）。 */
export function attachNetLog(page) {
  const log = [];
  page.on("response", (res) => {
    const req = res.request();
    const entry = {
      method: req.method(),
      url: res.url(),
      status: res.status(),
      body: null,
      bodyErr: null,
    };
    log.push(entry);
    // 只对 API 回包留正文；静态资源不留（体积）。
    if (/\/(a|b|api)\/v1\//.test(res.url())) {
      res
        .text()
        .then((t) => {
          entry.body = t;
        })
        .catch((e) => {
          entry.bodyErr = String(e && e.message ? e.message : e);
        });
    }
  });
  return log;
}

export async function launch() {
  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 400));
  });
  page.on("pageerror", (e) => consoleErrors.push("PAGEERROR " + String(e.message).slice(0, 400)));
  return { browser, ctx, page, consoleErrors };
}

export async function shot(page, name) {
  const file = path.join(SHOT_DIR, name.endsWith(".png") ? name : name + ".png");
  await page.screenshot({ path: file, fullPage: true });
  return path.basename(file);
}

/**
 * 真登录。⛔ 唯一允许的 `goto` 目标是站点根 `/` —— 之后全靠点。
 * 返回登录**之后**落在哪个 URL（用于证明「登录即到首页」不是我手敲的）。
 */
export async function login(page, { user = "admin", password = "demo1234", tenant = "demo" } = {}) {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#login-username", { timeout: 30000 });
  await page.fill("#login-tenant", tenant);
  await page.fill("#login-username", user);
  await page.fill("#login-password", password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="home-page"]', { timeout: 30000 });
  return page.url();
}

/**
 * 后端端口（datacore|agentcore）。默认 4001/4002 —— 与 `serve.sh` 同一组，既有单不受影响。
 *
 * ⚠ **必须可覆盖**：本机会同时跑好几个 agent，4001/4002 常被别人占着
 * （实测：`ss -ltnp` 报"空闲"而 `listen` 报 EADDRINUSE —— **`ss` 在这个沙箱里看不见别人的 socket，
 * 拿它当"端口可用"的证据是错的量法**；唯一可靠的判据是**真去 bind 一次**）。
 * 换端口之后若这里仍写死 4001/4002，`assertNoMock` 会**恒报"疑似 mock"** ——
 * 而那不是 mock 的证据，是**量法对错了端口**。形态：
 * 「我用『没看到打 4001 的包』当作『页面在用 mock』的证据，而前者并不度量后者。」
 */
export const E2E_API_PORTS = process.env.E2E_API_PORTS ?? "4001|4002";

/**
 * 实测「这一屏真的在打真后端」——不是靠「我没设 VITE_MOCK」这种自证。
 * 判据：网络记录里必须出现打到**本次实际使用的**后端端口的 200 回包。
 * MSW mock 模式下请求被 service worker 截胡，`fromServiceWorker` 为真且不会有真后端连接。
 */
export function assertNoMock(netLog) {
  const re = new RegExp(`127\\.0\\.0\\.1:(${E2E_API_PORTS})`);
  const real = netLog.filter((e) => re.test(e.url) && e.status >= 200 && e.status < 400);
  return {
    ok: real.length > 0,
    realHits: real.length,
    // 报 ok:false 时必须让人一眼看出"我在找哪个端口" —— 否则"端口配错"与"真的在用 mock"
    // 在屏上一模一样，而这两件事的修法完全相反。
    portsProbed: E2E_API_PORTS,
    sample: real.slice(0, 5).map((e) => `${e.status} ${e.method} ${e.url}`),
  };
}

/** 数一个 `<select>` 的 option 数与前若干项文本。找不到该控件时如实说「控件不在」而不是报 0。 */
export async function countOptions(page, selector) {
  const el = await page.$(selector);
  if (el === null) return { present: false, count: null, values: [], note: "控件不在这一屏上" };
  const data = await el.evaluate((sel) => ({
    count: sel.options.length,
    values: Array.from(sel.options).map((o) => o.value),
    labels: Array.from(sel.options).map((o) => o.textContent),
    groups: Array.from(sel.querySelectorAll("optgroup")).map((g) => g.label),
    disabled: sel.disabled,
  }));
  return { present: true, ...data };
}

/** 全屏可见文本（用于金额扫描 / 关键词命中）。取 innerText 而非 textContent —— 隐藏节点不算数。 */
export async function visibleText(page, selector = "body") {
  return page.$eval(selector, (n) => n.innerText);
}

const MONEY_RE = /(亿元|万元|元|亿|万)\b|[0-9][0-9,.]*\s*(亿元|万元|元|亿|万)/g;

/** 金额扫描。返回命中片段（带上下文），供报告直接引用屏上原文。 */
export function scanMoney(text) {
  const hits = [];
  const re = /[^\n]{0,40}(?:亿元|万元|元)[^\n]{0,20}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    hits.push(m[0].trim());
    if (hits.length >= 60) break;
  }
  const unitCount = (text.match(/元/g) ?? []).length;
  return { unitCount, hits };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
