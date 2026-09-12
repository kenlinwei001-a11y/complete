/* eslint-disable */
/**
 * 判据 6 · 「推演回包里有没有钱」——在**浏览器网络层**抓，不是 curl。
 *
 * ⚠ 金丝雀第一版取 token 取错了地方（翻 localStorage，实测 `tokenFound:false` → 401）：
 *   本站 accessToken 存在内存 store 里，refresh 走 httpOnly cookie。
 *   **「我没找到 token」不等于「没有 token」** —— 改成从真实出站请求上把
 *   `Authorization` 头**原样截下来**再用，这才是用户那条路上真正带的凭据。
 */
import { launch, login, shot, attachNetLog, sleep } from "./lib.mjs";

const R = { sim: {}, canary: {}, authProbe: {} };

const { browser, page } = await launch();
const net = attachNetLog(page);

// 截下真实出站请求上的 Authorization 头（不猜它存在哪）
let authHeader = null;
page.on("request", (req) => {
  const h = req.headers();
  if (authHeader === null && typeof h.authorization === "string" && h.authorization.startsWith("Bearer ")) {
    authHeader = h.authorization;
  }
});

async function clickNav(text) {
  const link = page.locator("nav a, aside a").filter({ hasText: text }).first();
  await link.waitFor({ state: "visible", timeout: 15000 });
  await link.click();
  await sleep(3000);
}

try {
  await login(page);
  await sleep(1500);
  R.authProbe.captured = authHeader !== null;
  R.authProbe.prefix = authHeader ? authHeader.slice(0, 22) + "…" : null;

  // ── 用户那条路：进推演，真跑一次，把 sim 回包全收下 ──────────────────
  await clickNav("统一推演控制台");
  await sleep(4000);
  const runBtn = page.locator("button").filter({ hasText: "施加并推演" }).first();
  const canRun = await runBtn.isEnabled().catch(() => false);
  R.sim.ranPerturbation = false;
  if (canRun) {
    await runBtn.click();
    await sleep(9000);
    R.sim.ranPerturbation = true;
    R.sim.shotAfterRun = await shot(page, "10-after-run");
  }
  // 再点一圈三个已接线的档，把它们的回包也收进来
  for (const tab of ["传导识别", "损失归因", "方案寻优"]) {
    try {
      await page.locator("button").filter({ hasText: tab }).first().click({ timeout: 6000 });
      await sleep(5000);
      R.sim["shot_" + tab] = await shot(page, `11-tab-${tab}`);
    } catch (e) {
      R.sim["err_" + tab] = String(e.message).slice(0, 150);
    }
  }

  await sleep(2000);
  const simResp = net.filter((e) => /\/a\/v1\/sim\//.test(e.url) && typeof e.body === "string");
  R.sim.responses = simResp.map((e) => ({
    url: e.url.replace(/^https?:\/\/127\.0\.0\.1:\d+/, "").slice(0, 120),
    status: e.status,
    bytes: e.body.length,
    yuan: (e.body.match(/元/g) ?? []).length,
    yi: (e.body.match(/亿/g) ?? []).length,
    wan: (e.body.match(/万/g) ?? []).length,
    money: (e.body.match(/unitPrice|amountYuan|revenue|价格|金额|marginWan|valueYuan/g) ?? []).length,
  }));
  R.sim.totalBytes = R.sim.responses.reduce((a, b) => a + b.bytes, 0);
  R.sim.totalYuan = R.sim.responses.reduce((a, b) => a + b.yuan, 0);
  R.sim.totalMoneyKeys = R.sim.responses.reduce((a, b) => a + b.money, 0);

  // ── 金丝雀：同一把「扫元 / 扫 unitPrice」的尺子，量一个**必中**的回包 ──
  R.canary = await page.evaluate(async (auth) => {
    const probe = async (u) => {
      const r = await fetch(u, { headers: auth ? { Authorization: auth } : {}, credentials: "include" });
      const t = await r.text();
      const up = t.match(/"unitPrice":\s*([0-9.eE+-]+)/g) ?? [];
      return {
        url: u.replace(/^https?:\/\/127\.0\.0\.1:\d+/, ""),
        status: r.status,
        bytes: t.length,
        unitPriceHits: up.length,
        unitPriceSample: up.slice(0, 8),
        yuan: (t.match(/元/g) ?? []).length,
      };
    };
    return {
      material: await probe("http://127.0.0.1:4001/a/v1/objects?objectType=Material&limit=50"),
      order: await probe("http://127.0.0.1:4001/a/v1/objects?objectType=Order&limit=20"),
    };
  }, authHeader);
} catch (e) {
  R.FATAL = String(e && e.stack ? e.stack : e);
  try {
    R.shotFatal = await shot(page, "ERR-payload");
  } catch {}
} finally {
  await browser.close();
}

console.log(JSON.stringify(R, null, 2));
