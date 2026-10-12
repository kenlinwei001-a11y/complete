/* eslint-disable */
/**
 * 判据 2 / 3 / 4 / 6 · 统一推演控制台 + 推演沙盘 的真点取证。
 *
 * ⛔ 全程点侧栏，**一次都不手敲 URL** —— 手敲会让「找不到入口」这类问题凭空消失。
 * 每一条否定结论都带金丝雀：同一把尺子量一个已知必中的目标。
 */
import { launch, login, shot, attachNetLog, assertNoMock, sleep } from "./lib.mjs";

const R = { meta: {}, c2: {}, c3: {}, c4: {}, c6: {}, trail: [] };

const { browser, page, consoleErrors } = await launch();
const net = attachNetLog(page);

/** 只认「点侧栏里那个文字」这一种到达方式。 */
async function clickNav(text) {
  const link = page.locator(`nav a, aside a`).filter({ hasText: text }).first();
  await link.waitFor({ state: "visible", timeout: 15000 });
  await link.click();
  R.trail.push({ click: text, url: page.url() });
  await sleep(2500);
}

/** 把整屏的 select / tab / 可见文本 dump 出来，不猜 testid。 */
async function dumpScreen(page) {
  return page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden";
    };
    return {
      url: location.href,
      selects: Array.from(document.querySelectorAll("select")).map((s) => ({
        testid: s.dataset.testid ?? null,
        label: (s.closest("label")?.innerText ?? "").split("\n")[0] || null,
        count: s.options.length,
        disabled: s.disabled,
        visible: vis(s),
        optgroups: Array.from(s.querySelectorAll("optgroup")).map((g) => ({
          label: g.label,
          n: g.querySelectorAll("option").length,
        })),
        sample: Array.from(s.options).slice(0, 6).map((o) => o.value),
      })),
      buttons: Array.from(document.querySelectorAll("button"))
        .filter(vis)
        .map((b) => ({
          testid: b.dataset.testid ?? null,
          text: b.innerText.replace(/\s*\n\s*/g, " ").trim().slice(0, 48),
          disabled: b.disabled === true,
          ariaDisabled: b.getAttribute("aria-disabled"),
          title: b.getAttribute("title"),
        }))
        .filter((b) => b.text.length > 0),
      text: document.body.innerText,
    };
  });
}

try {
  R.meta.landed = await login(page);
  R.trail.push({ click: "(登录)", url: page.url() });
  await sleep(1200);
  R.meta.noMock = assertNoMock(net);

  // ══ 统一推演控制台 ═══════════════════════════════════════════════════
  await clickNav("统一推演控制台");
  await sleep(3500);
  R.meta.shotUnified = await shot(page, "02-unified-console");
  R.c2.unified = await dumpScreen(page);

  // 判据 3 · 「演习结论」页签：真悬停读 title + 读 disabled
  R.c3.admin = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const hit = btns.filter((b) => /演习结论/.test(b.innerText));
    return hit.map((b) => ({
      text: b.innerText.replace(/\s*\n\s*/g, " ").trim(),
      disabled: b.disabled === true,
      ariaDisabled: b.getAttribute("aria-disabled"),
      title: b.getAttribute("title"),
      testid: b.dataset.testid ?? null,
    }));
  });
  // 金丝雀：同一把尺子量一个**确定可点**的页签，它必须 disabled=false 且 title=null
  R.c3.canaryAdmin = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const hit = btns.filter((b) => /传导识别|损失归因|指标态势/.test(b.innerText));
    return hit.map((b) => ({
      text: b.innerText.replace(/\s*\n\s*/g, " ").trim(),
      disabled: b.disabled === true,
      title: b.getAttribute("title"),
    }));
  });
  // 真悬停（不是只读属性）——证明 title 真的会浮出来
  try {
    const vb = page.locator("button").filter({ hasText: "演习结论" }).first();
    await vb.hover({ timeout: 5000 });
    await sleep(1200);
    R.c3.shotHover = await shot(page, "03-verdict-tab-hover-admin");
    R.c3.hoverOk = true;
  } catch (e) {
    R.c3.hoverOk = false;
    R.c3.hoverErr = String(e.message).slice(0, 200);
  }

  // 判据 2 · 落点对象类型下拉（统一控制台侧）
  R.c2.unifiedTypeSelect =
    R.c2.unified.selects.find((s) => s.testid === "rail-typekey") ??
    R.c2.unified.selects.find((s) => /落点对象类型/.test(s.label ?? "")) ??
    null;
  // 金丝雀：同屏另一个下拉（扰什么 / 落点对象）必须数得出且 > 1
  R.c2.unifiedCanaries = R.c2.unified.selects.map((s) => ({
    testid: s.testid,
    label: s.label,
    count: s.count,
    optgroups: s.optgroups,
  }));

  // 判据 4 · 「损失归因」档：真点开，扫金额
  try {
    const attrBtn = page.locator("button").filter({ hasText: "损失归因" }).first();
    await attrBtn.click({ timeout: 8000 });
    await sleep(5000);
    R.c4.shot = await shot(page, "04-attribution-screen");
    const d = await dumpScreen(page);
    R.c4.url = d.url;
    R.c4.moneyHits = (d.text.match(/[^\n]{0,45}(?:亿元|万元|元)[^\n]{0,15}/g) ?? []).slice(0, 40);
    R.c4.yuanCount = (d.text.match(/元/g) ?? []).length;
    R.c4.yiCount = (d.text.match(/亿/g) ?? []).length;
    R.c4.wanCount = (d.text.match(/万/g) ?? []).length;
    R.c4.textLen = d.text.length;
    R.c4.textHead = d.text.slice(0, 3000);
    R.c4.clicked = true;
  } catch (e) {
    R.c4.clicked = false;
    R.c4.err = String(e.message).slice(0, 300);
  }

  // 判据 6 · 推演回包里「元」出现几次（用户那条路上的回包，不是 curl）
  R.c6.simResponses = net
    .filter((e) => /\/(a|b|api)\/v1\/(sim|solvers|scenario)/i.test(e.url) && e.body)
    .map((e) => ({
      url: e.url.replace(/^https?:\/\/127\.0\.0\.1:\d+/, ""),
      status: e.status,
      bytes: e.body.length,
      yuan: (e.body.match(/元/g) ?? []).length,
      yi: (e.body.match(/亿/g) ?? []).length,
    }));
  // 全量回包（不限 sim），用于「元」在哪出现过的金丝雀
  R.c6.allApi = net
    .filter((e) => e.body)
    .map((e) => ({
      url: e.url.replace(/^https?:\/\/127\.0\.0\.1:\d+/, "").slice(0, 110),
      status: e.status,
      bytes: e.body.length,
      yuan: (e.body.match(/元/g) ?? []).length,
      unitPrice: (e.body.match(/unitPrice/g) ?? []).length,
    }));

  R.meta.consoleErrors = consoleErrors.slice(0, 25);
} catch (e) {
  R.FATAL = String(e && e.stack ? e.stack : e);
  try {
    R.shotFatal = await shot(page, "ERR-console");
  } catch {}
} finally {
  await browser.close();
}

console.log(JSON.stringify(R, null, 2));
