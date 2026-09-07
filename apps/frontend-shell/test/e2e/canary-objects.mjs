/* eslint-disable */
/**
 * 判据 6 的金丝雀（独立成篇，因为它必须能单独重跑）：
 * 用**和判据 6 完全同一把尺子**（浏览器网络层 + 同一个正则）量一个「我确定有钱」的回包。
 * 它若也报 0 ⇒ 报「我的量法坏了」，不许报「推演回包里没有钱」。
 */
import { launch, login, shot, attachNetLog, sleep } from "./lib.mjs";

const R = {};
const { browser, page } = await launch();
const net = attachNetLog(page);
let auth = null;
page.on("request", (req) => {
  const h = req.headers();
  if (auth === null && typeof h.authorization === "string" && h.authorization.startsWith("Bearer ")) auth = h.authorization;
});

try {
  await login(page);
  await sleep(1500);
  R.authCaptured = auth !== null;

  R.probes = await page.evaluate(async (a) => {
    const one = async (u) => {
      try {
        const r = await fetch(u, { headers: a ? { Authorization: a } : {}, credentials: "include" });
        const t = await r.text();
        const up = t.match(/"unitPrice":\s*([0-9.eE+-]+)/g) ?? [];
        return {
          url: u.replace(/^https?:\/\/127\.0\.0\.1:\d+/, ""),
          status: r.status,
          bytes: t.length,
          unitPriceHits: up.length,
          unitPriceSample: up.slice(0, 10),
          yuan: (t.match(/元/g) ?? []).length,
          yuanCtx: (t.match(/.{0,30}元.{0,10}/g) ?? []).slice(0, 5),
        };
      } catch (e) {
        return { url: u, ERR: String(e && e.message ? e.message : e) };
      }
    };
    // ⚠ 参数名是 `type` 不是 `objectType`，分页是 `pageSize` 不是 `limit`。
    //   第一版写错时端点回 400 —— 而 400 的 body 里 unitPrice 命中数当然是 0。
    //   **这正是金丝雀要拦的那一刀**：0 命中的原因是「我问错了」，不是「数据没有」。
    return {
      material: await one("http://127.0.0.1:4001/a/v1/objects?type=Material&pageSize=50"),
      order: await one("http://127.0.0.1:4001/a/v1/objects?type=Order&pageSize=20"),
      demand: await one("http://127.0.0.1:4001/a/v1/objects?type=DemandSegment&pageSize=20"),
    };
  }, auth);

  // 顺带把**用户真走过的**回包里带钱的那一条也留证（不是我构造的探针）
  R.organic = net
    .filter((e) => typeof e.body === "string" && (e.body.match(/元/g) ?? []).length > 0)
    .map((e) => ({
      url: e.url.replace(/^https?:\/\/127\.0\.0\.1:\d+/, ""),
      bytes: e.body.length,
      yuan: (e.body.match(/元/g) ?? []).length,
      ctx: (e.body.match(/.{0,40}元.{0,10}/g) ?? []).slice(0, 4),
    }));
} catch (e) {
  R.FATAL = String(e && e.stack ? e.stack : e).slice(0, 500);
} finally {
  await browser.close();
}
console.log(JSON.stringify(R, null, 2));
