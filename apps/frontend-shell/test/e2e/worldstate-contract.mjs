/* eslint-disable */
/**
 * WO-WORLDSTATE-CONTRACT · 真浏览器取证：**施扰动前后，方案寻优屏上的数会不会变**
 *
 * ⛔ 三条硬纪律（同 `lib.mjs`）：禁 VITE_MOCK · 必须从登录走起（唯一 goto 是站点根）·
 *    报否定结论前先自证量法（金丝雀）。
 *
 * ⚠ 本脚本**自带 no-mock 判据**，不复用 `lib.mjs` 的 `assertNoMock()` ——
 *   那一支把端口写死成 4001/4002，而本次真后端跑在 **4051/4052**
 *  （4001/4002 被同机其它 agent 的服务占着，⛔ 不许 `pkill -f datacore` 抢）。
 *   照搬它会恒报「疑似 mock」，那是**量法对错了端口**，不是页面真在用 mock。
 */
import { launch, shot, login, visibleText, sleep } from "./lib.mjs";

const A = process.env.WSC_DATACORE ?? "http://127.0.0.1:4051";
const SESS = "sims_demo_seed_world";
const HDR = { "X-Debug-User": "demo:admin:admin", "content-type": "application/json" };

/** no-mock：网络记录里必须有打到**本次真后端端口**的 2xx/3xx 回包。 */
function assertNoMockOn(netLog, ports) {
  const re = new RegExp(`127\\.0\\.0\\.1:(${ports.join("|")})`);
  const real = netLog.filter((e) => re.test(e.url) && e.status >= 200 && e.status < 400);
  return { ok: real.length > 0, realHits: real.length, sample: real.slice(0, 4).map((e) => `${e.status} ${e.method} ${e.url}`) };
}

/** 读屏：方案条数 + 首条方案名 + 首条方案上的数（**屏上原文**，不是我算的）。 */
async function readScreen(page) {
  const cards = await page.$$('[data-testid^="sandbox-opt-card-"]');
  const first = cards[0] ?? null;
  const firstText = first ? (await first.innerText()).replace(/\s+/g, " ").trim() : null;
  const source = await page.$eval('[data-testid="sandbox-opt"]', (n) => n.getAttribute("data-source")).catch(() => null);
  const detail = await page.$eval('[data-testid="sandbox-opt-detail"]', (n) => n.innerText.replace(/\s+/g, " ").trim()).catch(() => null);
  return { candidates: cards.length, firstCard: firstText, dataSource: source, detail };
}

async function gotoPareto(page) {
  // ⛔ 只许点，不许 goto：手敲 URL 会让「找不到入口」这一整类问题凭空消失。
  await page.getByRole("link", { name: /统一推演控制台/ }).first().click();
  await page.waitForSelector('[data-testid="sandbox-opt"], [role="tab"], button', { timeout: 30000 });
  await sleep(1500);
  // 切到「方案寻优」这一档
  const tab = page.getByText("方案寻优", { exact: true }).first();
  await tab.click();
  await page.waitForSelector('[data-testid="sandbox-opt"]', { timeout: 30000 });
  await sleep(4000); // 等装配 + 求解两跳回来
}

const main = async () => {
  const { browser, page, consoleErrors } = await launch();
  const netLog = [];
  page.on("response", (res) => {
    const u = res.url();
    if (/127\.0\.0\.1:(4051|4052)/.test(u) || /\/(a|b|api)\/v1\//.test(u)) {
      netLog.push({ method: res.request().method(), url: u, status: res.status() });
    }
  });

  const out = { steps: [] };
  const landed = await login(page);
  out.loginLanded = landed;
  out.shotLogin = await shot(page, "wsc-01-home");

  await gotoPareto(page);
  out.shotBefore = await shot(page, "wsc-02-pareto-before");
  out.before = await readScreen(page);

  // ── 金丝雀：屏上真有方案卡吗？没有 ⇒ 报「量法坏了」，不许报「屏上没变」──────────
  out.canaryScreen = {
    ok: out.before.candidates > 0,
    note: out.before.candidates > 0
      ? `屏上读到 ${out.before.candidates} 张方案卡 ⇒ 读屏取法可用`
      : "屏上一张方案卡都没读到 ⇒ 量法坏了（或这一屏根本没渲染），下面的「变没变」不可信",
  };

  out.noMock = assertNoMockOn(netLog, [4051, 4052]);

  // ── 施扰动（走真后端 API，与用户在沙盘上做的是同一条写路）─────────────────────
  const perturb = async (objectId, stateVar, magnitude, kind) => {
    const r = await fetch(`${A}/a/v1/sim/sessions/${SESS}/perturbations`, {
      method: "POST", headers: HDR,
      body: JSON.stringify({ kind, targetObjectId: objectId, targetStateVar: stateVar, startTick: 0, durationTicks: null, magnitude, mode: "set", label: "WSC 屏上对照" }),
    });
    return r.status;
  };
  out.perturbStatus = {
    hefei: await perturb("obj_base_hefei", "loadIndex", 0, "capacity_loss"),
    wuhan: await perturb("obj_base_wuhan", "loadIndex", 0, "capacity_loss"),
    xinyang: await perturb("obj_base_xinyang", "loadIndex", 0, "capacity_loss"),
  };

  // 回到首页再点回来（**不刷新、不敲 URL**）—— 走用户真会走的那条路重取数
  await page.getByRole("link", { name: /首页|工作台/ }).first().click().catch(() => {});
  await sleep(1200);
  await gotoPareto(page);
  out.shotAfter = await shot(page, "wsc-03-pareto-after");
  out.after = await readScreen(page);

  out.changed = JSON.stringify(out.before) !== JSON.stringify(out.after);
  out.consoleErrors = consoleErrors.slice(0, 6);
  await browser.close();
  console.log(JSON.stringify(out, null, 2));
};

main().catch((e) => {
  console.error("E2E FAILED:", e && e.stack ? e.stack : String(e));
  process.exit(1);
});
