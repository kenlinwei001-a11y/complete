/* eslint-disable */
/**
 * WO-HOME-ENTRY-FLOW · **对照实验**：`verify-usable` 里那串 SSE `ERR_FAILED` 是我引进的吗？
 *
 * 判据（照铁律 0.6 句式反过来用）：不许拿「我改完之后看见了这个报错」当作
 * 「这个报错是我改出来的」的证据 —— 前者并不度量后者。
 * 故拿一条**本单一行没碰**的老路径做对照：首页原有的高频场景卡（`home-scenario-*`，
 * 走的是与指引卡**逐字相同**的 `useScenarioLaunch`）。
 *   · 老路径也报同一串 ⇒ 与本单无关（分端口取证态下 SSE 的既有现象）；
 *   · 只有指引卡报 ⇒ 那才是我的账。
 */
import { launch, login, shot, sleep } from "./lib.mjs";

const R = { at: new Date().toISOString() };
const { browser, page, consoleErrors } = await launch();

const sseErrs = () => consoleErrors.filter((t) => /\/events\?|ERR_FAILED|EventSource/.test(t)).length;

try {
  await login(page);
  await sleep(1500);
  R.beforeAnyClick = { total: consoleErrors.length, sse: sseErrs() };

  // 老路径：首页原有高频场景卡（本单没碰过一行）
  const hot = page.locator('[data-testid^="home-scenario-"]').first();
  R.hotTestId = await hot.getAttribute("data-testid");
  await hot.click();
  await sleep(4000);
  R.afterOldPathCard = { total: consoleErrors.length, sse: sseErrs(), path: new URL(page.url()).pathname };
  R.shot = await shot(page, "C-old-path-hot-card");
} catch (e) {
  R.FATAL = String(e && e.stack ? e.stack : e).slice(0, 600);
} finally {
  await browser.close();
}
R.verdict =
  R.afterOldPathCard && R.afterOldPathCard.sse > 0
    ? "老路径同样报 SSE 错 ⇒ 与本单无关（既有现象）"
    : "老路径不报 ⇒ 需追查，可能是本单引进的";
console.log(JSON.stringify(R, null, 2));
