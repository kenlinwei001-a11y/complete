/* eslint-disable */
/**
 * 剩下四件：
 *  · 判据 2 的**金丝雀**：推演沙盘同类控件（不数它就等于没自证量法）
 *  · 判据 3 的**角色维度**：planner / base_manager:常州 各看一次「演习结论」
 *  · 判据 4 的**金丝雀**：同一把「扫元/亿/万」的尺子量经营驾驶舱，必须命中
 *  · 判据 5：登录→推演 的真实动线四个数
 *  · 判据 6 的**金丝雀**：/a/v1/objects 上 unitPrice 的实值
 */
import { launch, login, shot, attachNetLog, sleep } from "./lib.mjs";

const R = { sandbox: {}, roles: {}, moneyCanary: {}, trail: {}, objCanary: {} };

async function dumpSelects(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("select")).map((s) => ({
      testid: s.dataset.testid ?? null,
      label: (s.closest("label")?.innerText ?? "").split("\n")[0] || null,
      count: s.options.length,
      disabled: s.disabled,
      optgroups: Array.from(s.querySelectorAll("optgroup")).map((g) => ({
        label: g.label,
        n: g.querySelectorAll("option").length,
      })),
      sample: Array.from(s.options).slice(0, 5).map((o) => o.value),
    })),
  );
}

async function verdictTab(page) {
  return page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const v = btns.filter((b) => /演习结论/.test(b.innerText));
    const live = btns.filter((b) => /传导识别/.test(b.innerText));
    return {
      verdict: v.map((b) => ({
        disabled: b.disabled === true,
        title: b.getAttribute("title"),
        testid: b.dataset.testid ?? null,
      })),
      canaryLiveTab: live.map((b) => ({ disabled: b.disabled === true, title: b.getAttribute("title") })),
      allTabs: btns
        .filter((b) => (b.dataset.testid ?? "").startsWith("usim-tab-"))
        .map((b) => ({
          testid: b.dataset.testid,
          text: b.innerText.trim(),
          disabled: b.disabled === true,
        })),
    };
  });
}

async function clickNav(page, text) {
  const link = page.locator("nav a, aside a").filter({ hasText: text }).first();
  await link.waitFor({ state: "visible", timeout: 15000 });
  await link.click();
  await sleep(3000);
}

// ══ ① admin：沙盘金丝雀 + 驾驶舱金额金丝雀 + 动线 ═══════════════════════
{
  const { browser, page } = await launch();
  const net = attachNetLog(page);
  try {
    // ── 判据 5 的动线：从这里开始一步一步记 ──────────────────────────
    const trail = [];
    trail.push({ step: 1, act: "打开站点（浏览器地址栏只输站点根）", nav: 1, click: 0, url: "/" });
    await login(page);
    trail.push({ step: 2, act: "填写 租户 demo", nav: 0, click: 0 });
    trail.push({ step: 3, act: "填写 账号 admin", nav: 0, click: 0 });
    trail.push({ step: 4, act: "填写 密码", nav: 0, click: 0 });
    trail.push({ step: 5, act: "点【登录】按钮", nav: 1, click: 1, url: page.url() });
    await sleep(1200);
    R.trail.homeUrl = page.url();

    // 从首页能不能一步点到统一推演控制台？先看首页上有没有这个入口。
    R.trail.homeHasUnifiedEntry = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="home-page"] a, [data-testid="home-page"] button')).some((e) =>
        /统一推演控制台|推演沙盘/.test(e.innerText),
      ),
    );
    R.trail.homeEntryTexts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="home-page"] a[href]')).map((a) => a.innerText.trim()),
    );

    // 侧栏「推演」分组是否需要先展开？
    // ⚠ SVG 元素没有 innerText（`undefined.trim()` 会当场炸）—— 一律先兜底成空串。
    R.trail.simGroupState = await page.evaluate(() => {
      const txt = (e) => (typeof e.innerText === "string" ? e.innerText : "").trim();
      const heads = Array.from(document.querySelectorAll("nav *, aside *")).filter(
        (e) => e.children.length === 0 && /^推演$/.test(txt(e)),
      );
      return heads.map((h) => ({
        tag: h.tagName,
        text: txt(h),
        parentText: (h.parentElement ? txt(h.parentElement) : "").slice(0, 80),
      }));
    });

    await clickNav(page, "统一推演控制台");
    trail.push({ step: 6, act: "点侧栏【统一推演控制台】", nav: 1, click: 1, url: page.url() });
    R.trail.unifiedUrl = page.url();

    // 到了推演屏之后，真跑一次推演要再点几下？
    R.trail.runButton = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button")).find((x) => /施加并推演/.test(x.innerText));
      return b ? { text: b.innerText.trim(), disabled: b.disabled === true } : null;
    });
    if (R.trail.runButton !== null && R.trail.runButton.disabled === false) {
      await page.locator("button").filter({ hasText: "施加并推演" }).first().click();
      trail.push({ step: 7, act: "点【施加并推演】（用默认扰动，未改任何参数）", nav: 0, click: 1 });
      await sleep(6000);
      R.trail.afterRunShot = await shot(page, "06-after-run-perturbation");
      R.trail.afterRunText = await page.evaluate(() => document.body.innerText.slice(0, 1500));
    }
    R.trail.steps = trail;

    // ── 判据 4 的金丝雀：同一把尺子量经营驾驶舱 ────────────────────────
    await clickNav(page, "经营驾驶舱");
    await sleep(7000);
    R.moneyCanary.shot = await shot(page, "07-dashboard-money-canary");
    const dash = await page.evaluate(() => document.body.innerText);
    R.moneyCanary.url = page.url();
    R.moneyCanary.yuan = (dash.match(/元/g) ?? []).length;
    R.moneyCanary.yi = (dash.match(/亿/g) ?? []).length;
    R.moneyCanary.wan = (dash.match(/万/g) ?? []).length;
    R.moneyCanary.hits = (dash.match(/[^\n]{0,40}(?:亿元|万元|亿|元)[^\n]{0,12}/g) ?? []).slice(0, 25);

    // ── 判据 2 的金丝雀：推演沙盘同类控件 ──────────────────────────────
    await clickNav(page, "推演沙盘");
    await sleep(8000);
    R.sandbox.shot = await shot(page, "08-sandbox");
    R.sandbox.url = page.url();
    R.sandbox.selects = await dumpSelects(page);
    R.sandbox.text = (await page.evaluate(() => document.body.innerText)).slice(0, 2500);

    // ── 判据 6 的金丝雀：/a/v1/objects 上的 unitPrice（在**浏览器里**用用户自己的 token 取）
    R.objCanary = await page.evaluate(async () => {
      const tok = (() => {
        for (const k of Object.keys(localStorage)) {
          const v = localStorage.getItem(k) ?? "";
          const m = v.match(/eyJ[A-Za-z0-9_.-]{20,}/);
          if (m) return m[0];
        }
        return null;
      })();
      const r = await fetch("http://127.0.0.1:4001/a/v1/objects?objectType=Material&limit=50", {
        headers: tok ? { Authorization: "Bearer " + tok } : {},
        credentials: "include",
      });
      const t = await r.text();
      const up = t.match(/"unitPrice":\s*([0-9.eE+-]+)/g) ?? [];
      return {
        status: r.status,
        bytes: t.length,
        unitPriceHits: up.length,
        unitPriceSample: up.slice(0, 8),
        yuanInBody: (t.match(/元/g) ?? []).length,
        tokenFound: tok !== null,
      };
    });
  } catch (e) {
    R.FATAL_A = String(e && e.stack ? e.stack : e);
    try {
      R.shotFatalA = await shot(page, "ERR-rest-a");
    } catch {}
  } finally {
    await browser.close();
  }
}

// ══ ② 换角色看「演习结论」（判据 3 要求真验，不许只信 renderer:null 的源码推断）══
for (const who of ["planner", "base_manager"]) {
  const { browser, page } = await launch();
  try {
    await login(page, { user: who });
    await sleep(1200);
    R.roles[who] = { loginOk: true, home: page.url() };
    R.roles[who].navTexts = await page.evaluate(() =>
      Array.from(document.querySelectorAll("nav a, aside a")).map((a) => a.innerText.trim()),
    );
    const hasUnified = R.roles[who].navTexts.some((t) => /统一推演控制台/.test(t));
    R.roles[who].hasUnifiedInNav = hasUnified;
    if (hasUnified) {
      await clickNav(page, "统一推演控制台");
      await sleep(4000);
      R.roles[who].url = page.url();
      R.roles[who].tabs = await verdictTab(page);
      R.roles[who].shot = await shot(page, `09-verdict-${who}`);
      R.roles[who].selects = await dumpSelects(page);
    } else {
      R.roles[who].shot = await shot(page, `09-home-${who}`);
    }
  } catch (e) {
    R.roles[who] = { loginOk: false, err: String(e.message).slice(0, 300) };
    try {
      R.roles[who].shot = await shot(page, `ERR-${who}`);
    } catch {}
  } finally {
    await browser.close();
  }
}

console.log(JSON.stringify(R, null, 2));
