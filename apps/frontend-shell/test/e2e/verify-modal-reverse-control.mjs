/* eslint-disable */
/**
 * WO-PALETTE-USABLE · 实验④ 反向对照：**另一个** <Modal> 用法（22 处里的一个）。
 *
 * 要证两件事，缺一件这个修法就算改坏了别处：
 *   ① 打开时首焦落点**没变** —— 不带 autoFocus 的弹窗仍然落在 ✕ 关闭按钮上
 *      （修 ⌘K 时若图省事去改「首焦跳过 .head」，这一格就会翻）；
 *   ② 但这个弹窗里的输入框**同样**能连续输入（焦点修复是全局收益，不是只修了 ⌘K）。
 *
 * ⛔ 全程点击导航，不手敲 URL。
 */
import { launch, login, shot, sleep } from "./lib.mjs";

const R = { at: new Date().toISOString() };
const { browser, page } = await launch();

try {
  await login(page);
  await sleep(1500);

  // 点开「管理台」分组 → 点用户页（全靠点，不 goto）
  // 导航分组默认收起 ⇒ 子项压根没渲染。先把**每一组**都点开，再找用户页入口。
  // （第一版只点了标题含「管理」的组，一个都没匹配上，于是误报「入口不存在」——
  //   那是量法没覆盖到，不是入口没有。）
  const groupToggles = page.locator('[data-testid^="nav-group-toggle-"]');
  const n = await groupToggles.count();
  R.navGroupCount = n;
  for (let i = 0; i < n; i++) {
    await groupToggles.nth(i).click().catch(() => {});
    await sleep(200);
  }
  await sleep(600);
  // 目标：产能推演页的 AffectedOrdersModal —— 与 ⌘K 完全不同的另一个 <Modal> 用法，
  // 且它的 onClose 同样是内联箭头（`onClose={() => setOrdersDay(null)}`），属那 37 处之一。
  // 导航里没有 nav-risk（业务视图都收在 nav-business 后面），所以走**产品自己的路**：
  // 用刚修好的 ⌘K 面板启动 S02「交期风险与受影响订单」，它的 targetView 就是 risk。
  // 顺带这一步本身也是修复的端到端证明：修前 "S02" 根本打不进去。
  await page.keyboard.press("Control+k");
  await sleep(1000);
  const pdlg = page.locator('[role="dialog"]');
  const pin = pdlg.locator('[data-testid="command-palette-input"]');
  await pin.fill("");
  await sleep(300);
  await pin.click();
  await pin.type("S02", { delay: 70 });
  await sleep(700);
  R.paletteTyped = await pin.inputValue();
  const s02 = pdlg.locator('[data-testid="command-palette-item-S02"]');
  R.navFound = (await s02.count()) > 0;
  if (!R.navFound) {
    R.navTestIds = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid^="nav-"]')).map((e) => e.getAttribute("data-testid")),
    );
  } else {
    await s02.click();
    await sleep(4000);
    R.urlAfterNavClick = page.url();

    // 风险卡 → 逐日圆点（risk-dot-i）才是打开弹窗的那一下
    let dots = page.locator('[data-testid^="risk-dot-"]');
    R.dotsBeforeCardClick = await dots.count();
    if (R.dotsBeforeCardClick === 0) {
      const cards = page.locator('[data-testid^="risk-card-"]');
      R.cardCount = await cards.count();
      if (R.cardCount > 0) {
        await cards.first().click();
        await sleep(2000);
      }
      dots = page.locator('[data-testid^="risk-dot-"]');
    }
    R.dotCount = await dots.count();

    if (R.dotCount === 0) {
      R.note = "没找到 risk-dot-* —— 如实报「这条路没走通」，不假装反向对照做过了";
      R.shot = await shot(page, "PU-reverse-control-no-dot");
    } else {
      // 记录点击前的焦点，用来判断「焦点确实被移进了弹窗」
      R.focusBeforeOpen = await page.evaluate(() => document.activeElement?.tagName ?? null);
      await dots.first().click();
      await sleep(1500);
      const dlg = page.locator('[role="dialog"]');
      R.dialogOpen = (await dlg.count()) > 0;
      R.dialogTitle = R.dialogOpen ? (await dlg.getAttribute("aria-label")) : null;

      // ① 首焦落点：不带 autoFocus 的弹窗必须仍然落在 ✕ 关闭按钮（与修前一致）
      R.firstFocus = await page.evaluate(() => {
        const a = document.activeElement;
        const d = document.querySelector('[role="dialog"]');
        return {
          tag: a?.tagName ?? null,
          ariaLabel: a?.getAttribute?.("aria-label") ?? null,
          text: (a?.textContent ?? "").trim().slice(0, 20),
          insideDialog: !!d?.contains(a),
          isCloseButton: a?.getAttribute?.("aria-label") === "关闭",
        };
      });
      R.shot = await shot(page, "PU-reverse-control-risk-modal");
    }
  }
} catch (e) {
  R.FATAL = String(e && e.stack ? e.stack : e).slice(0, 500);
} finally {
  await browser.close();
}
console.log(JSON.stringify(R, null, 2));
