/* eslint-disable */
/**
 * WO-PALETTE-USABLE · 真浏览器对照实验（修前/修后同一把尺子跑两遍）
 *
 * 量两件事：
 *   ① ⌘K 面板输入框能不能留住多字符（逐键 type，不是 fill）
 *   ② 面板能不能够到后端 total 条里的最后一条
 *
 * ⛔ 报否定结论前必须先过金丝雀（铁律 0.6）：
 *   金丝雀 = **登录页的用户名输入框**，用**完全相同**的 `type()+inputValue()` 尺子量一遍。
 *   它若也留不住 `4680` ⇒ 报「尺子坏了」，不许报「面板坏了」。
 *   选它的理由：登录成功本身就证明了它能收多字符 —— 已知必中。
 *
 * ⚠ 每个词都**关掉面板重开、从空串打起**，不靠 fill("")/Control+a 清空
 *   （取证方第一版金丝雀就栽在这：没真清空，量的是拼接串，两次都报「无匹配」却什么都没证明）。
 */
import { launch, login, shot, sleep, attachNetLog, assertNoMock } from "./lib.mjs";

const TAG = process.env.PHASE ?? "unknown";
const R = { phase: TAG, at: new Date().toISOString(), canary: {}, typing: [], panel: {}, mock: {} };

const { browser, page } = await launch();
const net = attachNetLog(page);
const scenarioBodies = [];
page.on("response", (res) => {
  if (/\/b\/v1\/scenarios(\?|$)/.test(res.url())) {
    res.text().then((t) => scenarioBodies.push(t)).catch(() => {});
  }
});

/**
 * 打开面板 → 返回 dialog / input 定位器。
 *
 * ⚠ 关掉再开**不会**清空输入：`CommandPalette` 的 `q` 是常驻组件 state，
 *   `if (!open) return null` 只是不渲染、**组件没卸载** ⇒ 上一轮打的字还在。
 *   本脚本第一版就栽在这（量到 "4S"/"4Sa" 这种拼接串，空串态误报 0 行）。
 *   故此处显式 fill("") 并**断言真的空了**再往下走 —— 清不掉就当场抛，不许拿脏串出结论。
 */
async function openPalette() {
  await page.keyboard.press("Escape");
  await sleep(250);
  await page.keyboard.press("Control+k");
  await sleep(900);
  const dlg = page.locator('[role="dialog"]');
  const input = dlg.locator('[data-testid="command-palette-input"]');
  await input.fill("");
  await sleep(400);
  const cleared = await input.inputValue();
  if (cleared !== "") throw new Error(`清空失败，输入框仍为 ${JSON.stringify(cleared)} —— 量法坏了，不许据此下结论`);
  return { dlg, input };
}
async function closePalette() {
  await page.keyboard.press("Escape");
  await sleep(350);
}

try {
  // ── 金丝雀：登录页输入框，同一把尺子 ────────────────────────────────
  await page.goto((process.env.E2E_BASE ?? "http://127.0.0.1:5173") + "/", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForSelector("#login-username", { timeout: 30000 });
  const cu = page.locator("#login-username");
  await cu.click();
  await cu.type("4680", { delay: 60 });
  await sleep(300);
  R.canary.loginInputTyped = "4680";
  R.canary.loginInputGot = await cu.inputValue();
  R.canary.ok = R.canary.loginInputGot === "4680";
  R.canary.note = R.canary.ok
    ? "尺子成立：同一 type()+inputValue() 在已知好控件上留住了 4 个字符"
    : "⚠ 尺子坏了 —— 不许据此报「面板坏了」";
  await cu.fill("");

  // ── 真登录（⛔ 唯一 goto 是站点根，之后全靠点） ─────────────────────
  await login(page);
  await sleep(2000);
  R.loginShot = await shot(page, `PU-${TAG}-01-after-login`);
  R.mock = assertNoMock(net);

  // ── 实验①：逐键输入 ────────────────────────────────────────────────
  for (const w of ["4680", "S02", "abc", "常州20"]) {
    const { input } = await openPalette();
    await input.click();
    const focusBefore = await page.evaluate(() => document.activeElement?.tagName ?? null);
    await input.type(w, { delay: 70 });
    await sleep(600);
    const got = await input.inputValue();
    const focusAfter = await page.evaluate(() => document.activeElement?.tagName ?? null);
    R.typing.push({ typed: w, got, ok: got === w, focusBefore, focusAfter });
    await closePalette();
  }

  // ── 实验②：面板条数 / 能不能够到最后一条 ────────────────────────────
  const { dlg, input } = await openPalette();
  await sleep(700);
  const backend = (() => {
    for (const b of scenarioBodies) {
      try {
        const j = JSON.parse(b);
        if (j && typeof j.total === "number") return { total: j.total, itemCount: (j.items ?? []).length };
      } catch {}
    }
    return null;
  })();
  R.panel.backend = backend;

  R.panel.emptyQuery = await dlg.evaluate((d) => {
    const rows = Array.from(d.querySelectorAll('[data-testid^="command-palette-item-"]'));
    // 第二把尺子（取证方用的 innerText 正则），两把不一致就是信号
    const byText = Array.from(d.querySelectorAll("button")).filter((e) =>
      /^S\d\d/.test((e.innerText ?? "").trim()),
    );
    const list = rows.length ? rows[0].parentElement : null;
    return {
      rowCountByTestId: rows.length,
      rowCountByText: byText.length,
      ids: rows.map((r) => (r.getAttribute("data-testid") ?? "").replace("command-palette-item-", "")),
      scrollH: list?.scrollHeight ?? null,
      clientH: list?.clientHeight ?? null,
      scrollable: list ? list.scrollHeight > list.clientHeight + 2 : null,
    };
  });

  // 够不够得着最后一条：把列表滚到底，读最后一行
  R.panel.reachLast = await dlg.evaluate(async (d) => {
    const rows = Array.from(d.querySelectorAll('[data-testid^="command-palette-item-"]'));
    if (rows.length === 0) return { ok: false, why: "零行" };
    const list = rows[0].parentElement;
    list.scrollTop = list.scrollHeight;
    await new Promise((r) => setTimeout(r, 400));
    const last = rows[rows.length - 1];
    const lr = last.getBoundingClientRect();
    const cr = list.getBoundingClientRect();
    return {
      lastId: (last.getAttribute("data-testid") ?? "").replace("command-palette-item-", ""),
      lastText: (last.innerText ?? "").replace(/\n+/g, " | ").trim().slice(0, 80),
      // 滚到底之后，最后一行的矩形必须落在列表可视区内 ⇒ 真的够得着
      lastVisibleAfterScroll: lr.top >= cr.top - 2 && lr.bottom <= cr.bottom + 2,
      scrollTop: list.scrollTop,
      scrollH: list.scrollHeight,
      clientH: list.clientHeight,
    };
  });
  R.panelShot = await shot(page, `PU-${TAG}-02-palette-empty`);

  // 面板不能变成一屏塞不下的长条：量 dialog 高度 vs 视口
  R.panel.dialogFits = await dlg.evaluate((d) => {
    const r = d.getBoundingClientRect();
    return { dialogHeight: Math.round(r.height), viewportHeight: window.innerHeight, fits: r.height <= window.innerHeight };
  });
  await closePalette();
} catch (e) {
  R.FATAL = String(e && e.stack ? e.stack : e).slice(0, 600);
} finally {
  await browser.close();
}
console.log(JSON.stringify(R, null, 2));
