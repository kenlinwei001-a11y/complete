/* eslint-disable */
/**
 * WO-WORLDSTATE-CONTRACT · 判别「屏上没变」到底是**后端没变**还是**前端缓存**。
 *
 * 上一支脚本实测：施扰动后后端杠杆最大档 5879.216357 → 14744.170406，
 * 而屏上仍是 5879.216357。两种可能的处置完全不同：
 *   · 后端没变 ⇒ 我这张单没做完；
 *   · 前端缓存 ⇒ 后端已对，缺的是失效策略（不在本单边界内，只观测）。
 * 判据：**整页硬刷新**（重新挂载 ⇒ 重新发请求）。刷完变了 ⇒ 是缓存。
 */
import { launch, shot, login, sleep } from "./lib.mjs";

const readCaps = async (page) => {
  const first = (await page.$$('[data-testid^="sandbox-opt-card-"]'))[0];
  return first ? (await first.innerText()).replace(/\s+/g, " ").slice(0, 180) : null;
};

const gotoPareto = async (page) => {
  await page.getByRole("link", { name: /统一推演控制台/ }).first().click();
  await sleep(1500);
  await page.getByText("方案寻优", { exact: true }).first().click();
  await page.waitForSelector('[data-testid="sandbox-opt"]', { timeout: 30000 });
  await sleep(4000);
};

const main = async () => {
  const { browser, page } = await launch();
  const out = {};
  await login(page);
  await gotoPareto(page);
  out.beforeReload = await readCaps(page);

  // 整页硬刷新 —— 这是唯一一处 reload，且**只为判别缓存**，不是用来绕过入口。
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="sandbox-opt"]', { timeout: 30000 }).catch(() => {});
  await sleep(5000);
  out.afterReload = await readCaps(page);
  out.shot = await shot(page, "wsc-04-after-reload");
  out.verdict = out.beforeReload === out.afterReload
    ? "刷新后仍相同 ⇒ 不是缓存，要回头查后端"
    : "刷新后变了 ⇒ 是前端缓存（后端已对）";
  await browser.close();
  console.log(JSON.stringify(out, null, 2));
};
main().catch((e) => { console.error("E2E FAILED:", e.stack || String(e)); process.exit(1); });
