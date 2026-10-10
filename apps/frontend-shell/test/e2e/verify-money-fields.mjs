/* eslint-disable */
/**
 * 判据 6 的**订正版**。
 *
 * ⚠ 先说为什么要订正：原判据写的是「推演回包『元』出现 0 次」。
 *   实测「元」这把尺子在本行业**天然坏掉** —— `三元正极`（NCM 正极材料）里就带一个「元」，
 *   它不是货币单位。金丝雀里两处「元」命中全是 `"name":"三元正极"`，一处真金额都不是。
 *   ⇒ **数「元」这个字，度量的不是「回包里有没有钱」。**（形态同 CLAUDE.md 铁律 0.6：
 *     「我用 X 当作 Y 的证据，而 X 并不度量 Y」。）
 *
 * 本脚本改数**带钱的字段名**，并按字段逐个报出现处，同时保留原「元」计数供对照。
 */
import { launch, login, shot, attachNetLog, sleep } from "./lib.mjs";

const MONEY_KEYS = [
  "unitPrice", "价格", "金额", "revenue", "amount", "cost", "价税", "marginWan",
  "valueYuan", "amountYuan", "gmv", "priceYuan", "totalValue", "value",
];

const R = { sim: {}, canary: {} };
const { browser, page } = await launch();
const net = attachNetLog(page);
let auth = null;
page.on("request", (req) => {
  const h = req.headers();
  if (auth === null && typeof h.authorization === "string" && h.authorization.startsWith("Bearer ")) auth = h.authorization;
});

async function clickNav(text) {
  const l = page.locator("nav a, aside a").filter({ hasText: text }).first();
  await l.waitFor({ state: "visible", timeout: 15000 });
  await l.click();
  await sleep(3000);
}

function measure(body) {
  const out = { bytes: body.length, yuanChar: (body.match(/元/g) ?? []).length, keys: {} };
  // 「元」字命中里有多少是 `三元/多元/元器件` 这类**非货币**用法 —— 分开数，别混。
  out.yuanCharNonMoney = (body.match(/[三多单双高低]元|元器件|元数据/g) ?? []).length;
  for (const k of MONEY_KEYS) {
    const n = (body.match(new RegExp('"' + k + '"\\s*:', "g")) ?? []).length;
    if (n > 0) out.keys[k] = n;
  }
  return out;
}

try {
  await login(page);
  await sleep(1500);
  await clickNav("统一推演控制台");
  await sleep(4000);
  try {
    const b = page.locator("button").filter({ hasText: "施加并推演" }).first();
    if (await b.isEnabled()) {
      await b.click();
      await sleep(9000);
      R.sim.ran = true;
    }
  } catch { R.sim.ran = false; }
  for (const t of ["传导识别", "损失归因", "方案寻优"]) {
    try { await page.locator("button").filter({ hasText: t }).first().click({ timeout: 6000 }); await sleep(5000); } catch {}
  }
  await sleep(2000);

  R.sim.perResponse = net
    .filter((e) => /\/a\/v1\/sim\//.test(e.url) && typeof e.body === "string")
    .map((e) => ({ url: e.url.replace(/^https?:\/\/127\.0\.0\.1:\d+/, "").slice(0, 100), status: e.status, ...measure(e.body) }));

  const agg = { bytes: 0, yuanChar: 0, yuanCharNonMoney: 0, keys: {} };
  for (const r of R.sim.perResponse) {
    agg.bytes += r.bytes; agg.yuanChar += r.yuanChar; agg.yuanCharNonMoney += r.yuanCharNonMoney;
    for (const [k, v] of Object.entries(r.keys)) agg.keys[k] = (agg.keys[k] ?? 0) + v;
  }
  R.sim.aggregate = agg;

  // 金丝雀：同一把尺子量两个**确定带钱**的回包
  R.canary = await page.evaluate(async (a) => {
    const one = async (u) => {
      const r = await fetch(u, { headers: a ? { Authorization: a } : {}, credentials: "include" });
      const t = await r.text();
      return { url: u.replace(/^https?:\/\/127\.0\.0\.1:\d+/, ""), status: r.status, bytes: t.length, body: t.slice(0, 0), raw: t };
    };
    const m = await one("http://127.0.0.1:4001/a/v1/objects?type=Material&pageSize=50");
    const o = await one("http://127.0.0.1:4001/a/v1/objects?type=Order&pageSize=20");
    return { material: { url: m.url, status: m.status, bytes: m.bytes, raw: m.raw }, order: { url: o.url, status: o.status, bytes: o.bytes, raw: o.raw } };
  }, auth);
  for (const k of ["material", "order"]) {
    const c = R.canary[k];
    R.canary[k] = { url: c.url, status: c.status, ...measure(c.raw) };
  }
} catch (e) {
  R.FATAL = String(e && e.stack ? e.stack : e).slice(0, 500);
} finally {
  await browser.close();
}
console.log(JSON.stringify(R, null, 2));
