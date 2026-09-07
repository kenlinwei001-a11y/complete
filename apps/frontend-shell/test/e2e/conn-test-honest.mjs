/* eslint-disable */
/**
 * WO-CONNTEST-HONEST · 真浏览器取证：连接器新建向导里点「测试连接」，屏上到底说什么。
 *
 * ⛔ 三条硬纪律（沿用 lib.mjs）：
 *  1. 禁 VITE_MOCK —— `assertNoMock()` 实测网络记录里有真后端 200 回包，不是靠「我没设那个变量」自证。
 *  2. **必须从登录走起**，之后全靠点：唯一的 `goto` 是站点根 `/`。
 *     手敲 `/admin/connections` 会让「找不到入口」这一整类问题凭空消失。
 *  3. 报否定结论前先自证量法（本脚本的金丝雀见下）。
 *
 * ## 本脚本的对照实验（铁律 1.5 判据一）
 * 同一个操作序列跑两遍，只换后端回包：
 * - `MODE=before`：代理重放**修复前**的回包（`{ok:true}`）⇒ 屏上应当出现「连接成功」。
 * - `MODE=after` ：真后端 ⇒ 屏上应当出现「连接失败：主机名解析不到」+ 可行动说明。
 * 两遍都对 `nonexistent.invalid` 这一个不存在的主机。**屏上两句原文都要留档。**
 *
 * ## 金丝雀（证明「我读到的那块屏」真的会随输入变）
 * 同一次会话里再点一次**能连上的目标**（内置样例源 mock_erp），屏上必须变成「连接成功」。
 * 它若也显示失败 ⇒ 报「量法坏了 / 按钮做成了永远失败」，不许报「修好了」。
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { launch, login, shot, attachNetLog, assertNoMock, visibleText, sleep } from "./lib.mjs";

const MODE = process.env.MODE ?? "after";
const OUT = process.env.E2E_OUT ?? path.resolve(process.cwd(), `apps/frontend-shell/test/e2e/conntest-${MODE}-output.json`);

const BAD_HOST = "http://nonexistent.invalid/data";

/** 读「测试连接」结果那一块的屏上原文（badge + 说明 + 探测行），拼成用户真正看到的一段。 */
async function readResultBlock(page) {
  const el = await page.$('[data-testid="test-result"]');
  if (el === null) return { present: false, text: null, note: "结果块不在屏上（可能没点到按钮）" };
  const text = (await el.evaluate((n) => n.innerText)).trim();
  return { present: true, text };
}

async function openWizardAndTest(page, { typeKey, fill }) {
  // 新建连接 → 选类型 → 填表 → 测试连接
  await page.click('button:has-text("新建连接")');
  await page.waitForSelector(`[data-testid="connector-type-${typeKey}"]`, { timeout: 20000 });
  await page.click(`[data-testid="connector-type-${typeKey}"]`);
  for (const [key, val] of Object.entries(fill ?? {})) {
    await page.waitForSelector(`#jsf-${key}`, { timeout: 20000 });
    await page.fill(`#jsf-${key}`, val);
  }
  await page.click('button:has-text("测试连接")');
  // 等结果块出现（而不是死等固定时长）
  await page.waitForSelector('[data-testid="test-result"]', { timeout: 30000 });
  await sleep(400); // 让说明行渲染完
}

async function closeWizard(page) {
  // 关掉模态：优先点关闭，退不出就按 Esc
  const closed = await page.$('button[aria-label="关闭"], .modal-close');
  if (closed) await closed.click().catch(() => {});
  else await page.keyboard.press("Escape").catch(() => {});
  await sleep(300);
}

const { browser, page, consoleErrors } = await launch();
const netLog = attachNetLog(page);
const result = { mode: MODE, at: new Date().toISOString(), steps: [] };

try {
  // ① 真登录（唯一的 goto）
  const landed = await login(page);
  result.landedAfterLogin = landed;
  result.steps.push("① 登录 demo/admin/demo1234 → " + landed);
  await shot(page, `conntest-${MODE}-01-after-login`);

  // ② 自证不是 mock
  const nomock = assertNoMock(netLog);
  result.assertNoMock = nomock;
  if (!nomock.ok) throw new Error("assertNoMock 失败：这一屏没有打到真后端，取证作废");
  result.steps.push(`② 真后端命中 ${nomock.realHits} 次（禁 VITE_MOCK 已实测）`);

  // ③ 从导航点进「数据接入」——不许手敲 URL
  await page.click('text=数据接入');
  await page.waitForSelector('button:has-text("新建连接")', { timeout: 30000 });
  result.urlAfterNavClick = page.url();
  result.steps.push("③ 点导航「数据接入」→ " + result.urlAfterNavClick);
  await shot(page, `conntest-${MODE}-02-connections-page`);

  // ④ 主实验：对不存在的主机点「测试连接」
  await openWizardAndTest(page, { typeKey: "rest_api", fill: { url: BAD_HOST } });
  const bad = await readResultBlock(page);
  result.badHost = { input: BAD_HOST, screen: bad };
  result.steps.push(`④ rest_api + ${BAD_HOST} → 屏上：${JSON.stringify(bad.text)}`);
  const badShot = await shot(page, `conntest-${MODE}-03-badhost`);
  result.badHostShot = badShot;

  // ⑤ 金丝雀：同一屏换一个**能连上**的目标，屏上必须变
  await closeWizard(page);
  await openWizardAndTest(page, { typeKey: "mock_erp", fill: {} });
  const good = await readResultBlock(page);
  result.canaryGood = { input: "mock_erp（内置样例源）", screen: good };
  result.steps.push(`⑤ 金丝雀 mock_erp → 屏上：${JSON.stringify(good.text)}`);
  result.canaryShot = await shot(page, `conntest-${MODE}-04-canary-good`);

  // 判据：两次屏上文本必须不同，否则说明我读的那块屏根本不随输入变
  result.canaryDiscriminates = bad.text !== good.text;

  result.consoleErrors = consoleErrors.slice(0, 10);
  result.apiCalls = netLog
    .filter((e) => /\/a\/v1\/connections\/test/.test(e.url))
    .map((e) => ({ status: e.status, url: e.url, body: e.body }));
} catch (err) {
  result.error = String(err && err.stack ? err.stack : err);
  try { result.errorShot = await shot(page, `conntest-${MODE}-99-error`); } catch {}
} finally {
  writeFileSync(OUT, JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}
