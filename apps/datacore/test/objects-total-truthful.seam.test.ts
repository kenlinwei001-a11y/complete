import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, type TestApp } from "./helpers.js";

/**
 * 接缝：**合成数据的规模** × **`GET /a/v1/objects` 的分页读**。
 *
 * 病（2026-08-29 实测复现）：该端点内部读的是 `queryObjects(ctx, type, {}, 1000)`，
 * 而 `queryObjects` 里有 `Math.min(limit, 1000)` 硬顶。于是
 *   · `total` 由**截断后**的数组长度算出 ⇒ `EquipmentOEE` 自报 1000，真值 5460（低估 5.46×）；
 *   · 第 1000 行之后的数据**任何 page 都翻不到**（`page=3&pageSize=500` 恒回 0 行）。
 * 最要命的是**调用方无从察觉** —— `total` 正是唯一的检测手段，而它自己被同一个硬顶截断。
 * （本轮已致一个评审角色把敞口低估 5.46 倍。）
 *
 * 为什么必须是**接缝**测试而不是各半 unit：
 *   · 只测 `queryObjects` ⇒ 它按契约行事（截断是它的本职），绿；
 *   · 只测路由但用 <1000 行的类型 ⇒ 永远碰不到硬顶，绿。
 * 只有「真种出 >1000 行的类型」× 「真走这条路由」两半合起来，这个病才会现形。
 */

/** `queryObjects` 里那个 ≤1000 —— 本测就是要证明本端点的 total 不再被它夹住。 */
const HARD_CAP = 1000;

/**
 * 独立口径：**直接读仓储**，不经过被测端点。
 * 拿端点自己的另一个字段去证明它自己 = 循环论证，这里刻意绕开。
 * 口径与服务层对齐：OC1 被并入对象不计（admin 无行级过滤，故不需再套 A6）。
 */
async function truthCount(t: TestApp, type: string): Promise<number> {
  const all = await t.repos.objects.listByType("demo", type);
  return all.filter((o) => !o.mergedInto).length;
}

interface ObjectsPageRes {
  items: { id: string; type: string; props: Record<string, unknown> }[];
  total: number;
  totalIsLowerBound?: boolean;
  warnings?: string[];
}

async function getPage(t: TestApp, url: string): Promise<ObjectsPageRes> {
  const res = await t.app.inject({ method: "GET", url, headers: ADMIN });
  expect(res.statusCode, `${url} → ${res.body.slice(0, 300)}`).toBe(200);
  return res.json() as ObjectsPageRes;
}

/** 种子里行数最多的类型（本测的「大类型」；seed 42 · scale S 实测 = EquipmentOEE 5460 行）。 */
async function biggestType(t: TestApp): Promise<{ key: string; n: number }> {
  const raw = (await t.app.inject({ method: "GET", url: "/a/v1/ontology/object-types", headers: ADMIN })).json() as
    | { key: string }[]
    | { items: { key: string }[] };
  const list = Array.isArray(raw) ? raw : raw.items;
  let best = { key: "", n: -1 };
  for (const ty of list) {
    const n = await truthCount(t, ty.key);
    if (n > best.n) best = { key: ty.key, n };
  }
  return best;
}

describe("GET /a/v1/objects · total 说真话 + 分页能穿越硬顶", () => {
  it("头号判据：total = 独立口径真值，且**不等于**硬顶；第 1000 行之后能翻到", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const big = await biggestType(t);

    // 金丝雀（护住本测自己）：种子必须真的种出 >1000 行的类型，否则本测碰不到硬顶、
    // 会**假绿**通过。种子缩水时要在这里红，而不是悄悄退化成一个什么都没验的测试。
    expect(
      big.n,
      `种子里没有任何类型超过 ${HARD_CAP} 行（最大 ${big.key}=${big.n}）⇒ 本测碰不到硬顶，` +
        `会假绿。请调大合成规模或改用能超顶的类型，别删本断言。`,
    ).toBeGreaterThan(HARD_CAP);

    const page1 = await getPage(t, `/a/v1/objects?type=${big.key}&page=1&pageSize=500`);

    // ① total 必须是真值 —— 用**不经过该接口**的独立口径核对。
    expect(page1.total, `${big.key} 的 total 应等于仓储真值`).toBe(big.n);

    // ② 且必须不是硬顶本身。①已蕴含②（因 big.n > HARD_CAP），但单独写出来是为了
    //    让回归时的失败信息直接说出病名，而不是只报「两个数不等」。
    expect(page1.total, "total 恰好等于硬顶 ⇒ 它又被截断了（这正是本单要修的病）").not.toBe(HARD_CAP);

    // ③ 分页必须能穿越硬顶：逐页取回、按 id 去重，总数必须等于 total。
    //    这一条同时证伪「total 对了但第 1000 行之后仍取不到」这个更严重的残缺态。
    const pageSize = 500;
    const seen = new Set<string>();
    const pages = Math.ceil(big.n / pageSize);
    for (let p = 1; p <= pages; p++) {
      const pg = await getPage(t, `/a/v1/objects?type=${big.key}&page=${p}&pageSize=${pageSize}`);
      for (const it of pg.items) seen.add(it.id);
    }
    expect(seen.size, `逐页取回去重后应等于 total（差额 = 任何分页都取不到的行）`).toBe(big.n);

    // ④ 硬顶之后那一页确实有货（点名断言，避免③被「前几页凑够数」蒙混）。
    const beyond = await getPage(t, `/a/v1/objects?type=${big.key}&page=3&pageSize=500`);
    expect(beyond.items.length, "page=3&pageSize=500 = 第 1000 行之后，修前恒为 0 行").toBeGreaterThan(0);
  }, 300000);

  it("金丝雀：<1000 行的类型本来就对，改动不许把它们弄错", async () => {
    const t = await makeApp();
    await seedBattery(t);
    for (const type of ["Order", "OrderLine", "Equipment"]) {
      const truth = await truthCount(t, type);
      expect(truth, `${type} 应少于硬顶，否则它不配当本条的金丝雀`).toBeLessThan(HARD_CAP);
      const pg = await getPage(t, `/a/v1/objects?type=${type}&page=1&pageSize=500`);
      expect(pg.total, `${type} 的 total`).toBe(truth);
      expect(pg.totalIsLowerBound, `${type} 没撞安全上限，不该标下界`).toBeUndefined();
    }
  }, 300000);

  it("列筛选后的 total 也必须是「筛完的总行数」，不是「本页取回多少」", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const all = await getPage(t, "/a/v1/objects?type=Order&page=1&pageSize=1");
    // pageSize=1 只取回 1 行，但 total 必须仍是全量 —— total 与分页解耦的最小反证。
    expect(all.items.length).toBe(1);
    expect(all.total).toBe(await truthCount(t, "Order"));
  }, 300000);
});

describe("GET /a/v1/objects · 无法识别的查询参数不许静默吞掉", () => {
  it("`limit` 在本端点无效 ⇒ 必须回 warning 并点名正确参数是 pageSize", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 实测：修前 `?limit=100000` 被完全忽略、无任何提示、静默回落 pageSize=50，
    // 审核方与三个评审角色都被它骗过。
    const pg = await getPage(t, "/a/v1/objects?type=Order&limit=100000");
    expect(pg.warnings, "无效参数必须有 warnings").toBeDefined();
    expect(pg.warnings!.join(" ")).toContain("limit");
    expect(pg.warnings!.join(" "), "warning 要说出正确的参数名，否则调用方不知道怎么改").toContain("pageSize");
    // 且它确实没生效（诚实 ≠ 悄悄改语义）：默认页长 50。
    expect(pg.items.length).toBe(50);
  }, 300000);

  it("未知参数回 warning；合法参数（含 f_<属性名>）不许误报", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const bogus = await getPage(t, "/a/v1/objects?type=Order&bogusParam=1");
    expect(bogus.warnings?.join(" ") ?? "").toContain("bogusParam");

    // 金丝雀（护住上一条）：合法参数全用上，必须**一个 warning 都没有** ——
    // 否则「凡请求皆报警」也能让上一条绿，那它就什么都没验。
    const clean = await getPage(t, "/a/v1/objects?type=Order&q=SO&page=1&pageSize=10&base=&f_status=OPEN");
    expect(clean.warnings, `合法参数被误报为未知：${JSON.stringify(clean.warnings)}`).toBeUndefined();
  }, 300000);
});
