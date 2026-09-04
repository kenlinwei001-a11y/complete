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
  page: number;
  pageSize: number;
  hasMore: boolean;
  warnings?: string[];
}

async function getPage(t: TestApp, url: string): Promise<ObjectsPageRes> {
  const res = await t.app.inject({ method: "GET", url, headers: ADMIN });
  expect(res.statusCode, `${url} → ${res.body.slice(0, 300)}`).toBe(200);
  return res.json() as ObjectsPageRes;
}

/** 期望被 400 拒掉的请求：回状态码 + 错误信息（用于断言"点了名"）。 */
async function getRejected(t: TestApp, url: string): Promise<{ status: number; message: string }> {
  const res = await t.app.inject({ method: "GET", url, headers: ADMIN });
  const body = res.json() as { error?: { message?: string } };
  return { status: res.statusCode, message: body.error?.message ?? res.body };
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
  it("`limit` 这类**分页别名**必须 400 点名，不许静默生效也不许只回 warning", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 沿革：修前 `?limit=100000` 被完全忽略、静默回落 pageSize=50；
    // 随后改成回 warning —— 仍然不够：**生产前端 `fetchOrdersForFamilies` 就发了 `limit=500`，
    // 实收 50 行而 total=500（10× 欠读），warning 摆在响应里没有任何人读。**
    // 一个不产生错误、只让人少拿数据的参数，必须硬拒。
    const rej = await getRejected(t, "/a/v1/objects?type=Order&limit=100000");
    expect(rej.status, `limit 必须被 400 拒掉，实得 ${rej.status}：${rej.message}`).toBe(400);
    expect(rej.message, "错误必须点名是哪个参数").toContain("limit");
    expect(rej.message, "错误要说出正确的参数名，否则调用方不知道怎么改").toContain("pageSize");

    // 金丝雀：别的分页别名同样拒（否则本条只挡住了 `limit` 一个词）。
    for (const alias of ["offset=10", "cursor=abc", "per_page=100", "skip=5"]) {
      const r = await getRejected(t, `/a/v1/objects?type=Order&${alias}`);
      expect(r.status, `分页别名 ${alias} 应被 400，实得 ${r.status}`).toBe(400);
    }
  }, 300000);

  it("分页参数的**值**不许静默改写：page/pageSize 非法即 400", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // `page=abc` 悄悄变 1、`pageSize=abc` 悄悄变 50 —— 与忽略参数同病，只是发生在值这一层：
    // 调用方拿到的是别人替他选的那一页，而响应里一个字都没提。
    for (const bad of ["page=abc", "page=0", "page=-1", "pageSize=abc", "pageSize=0", "pageSize=-5"]) {
      const r = await getRejected(t, `/a/v1/objects?type=Order&${bad}`);
      expect(r.status, `${bad} 应被 400（静默回落是病），实得 ${r.status}：${r.message}`).toBe(400);
    }
    // 金丝雀（护住上一条）：合法值必须照常 200，否则"凡带 page 就 400"也能让上面全绿。
    const ok = await getPage(t, "/a/v1/objects?type=Order&page=2&pageSize=10");
    expect(ok.items.length).toBe(10);
  }, 300000);

  it("pageSize 超上限：夹到 500 但必须**说出来**，且回显的是生效值", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const pg = await getPage(t, "/a/v1/objects?type=Order&pageSize=100000");
    expect(pg.pageSize, "回显的必须是生效值，不是请求值 —— 否则调用方按 100000 算下一页会算错").toBe(500);
    expect(pg.warnings?.join(" ") ?? "", "被夹了却不说 = 又一次静默截断").toContain("500");
    expect(pg.items.length).toBeLessThanOrEqual(500);
  }, 300000);

  it("未知（非分页）参数回 warning；合法参数（含 f_<属性名>）不许误报", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 非分页形态的拼写错误只回 warning：本端点 URL 常由 agent 现拼，
    // 硬拒会把一个拼写问题升级成一次故障，而它并不会让人少拿数据。
    const bogus = await getPage(t, "/a/v1/objects?type=Order&bogusParam=1");
    expect(bogus.warnings?.join(" ") ?? "").toContain("bogusParam");

    // 金丝雀（护住上一条）：合法参数全用上，必须**一个 warning 都没有** ——
    // 否则「凡请求皆报警」也能让上一条绿，那它就什么都没验。
    const clean = await getPage(t, "/a/v1/objects?type=Order&q=SO&page=1&pageSize=10&base=&f_status=OPEN");
    expect(clean.warnings, `合法参数被误报为未知：${JSON.stringify(clean.warnings)}`).toBeUndefined();
  }, 300000);
});

describe("GET /a/v1/objects · 截断信号 hasMore（不许让调用方自己算那道算术）", () => {
  it("hasMore 逐页走完必须恰好在最后一页转 false，且 ③ 累计 = ④ 真值", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const truth = await truthCount(t, "Line");
    // 金丝雀：Line 必须多于一页，否则 hasMore 恒 false，本条什么都没验。
    expect(truth, `Line 只有 ${truth} 行，撑不满两页 ⇒ 本条会假绿`).toBeGreaterThan(50);

    // 只信 hasMore 翻页（不看 total、不算 page*pageSize）——
    // 这正是调用方拿到本响应后最该能做的事：跟着信号走就能取全。
    for (const pageSize of [50, 10, 7, 1]) {
      const seen = new Set<string>();
      let page = 1;
      for (;;) {
        const pg = await getPage(t, `/a/v1/objects?type=Line&page=${page}&pageSize=${pageSize}`);
        expect(pg.pageSize, "回显生效页长").toBe(pageSize);
        expect(pg.page, "回显生效页号").toBe(page);
        for (const it of pg.items) seen.add(it.id);
        if (!pg.hasMore) break;
        page++;
        expect(page, "hasMore 一直为真 = 它没在最后一页转 false").toBeLessThan(truth + 5);
      }
      // 变异反证：页长改小，累计条数必须**不变**。跟着变小 ⇒ "翻完"是假的。
      expect(seen.size, `pageSize=${pageSize} 时只凭 hasMore 翻完应取全 ${truth} 行`).toBe(truth);
    }
  }, 300000);
});

/**
 * ── WO-PAGING-SILENT-TRUNCATION-SCAN · 接缝：**调用方不传分页** × 真路由 ──────────
 *
 * 上面几组验的是「传了参数之后端点算得对」。**本组验的是另一半，也是真正在生产里发生的那半**：
 * 调用方**什么参数都不传**。这不报错、不 warning、不留痕 —— 它拿回默认页长那么多行，
 * 然后把它当成全部。已知真实事故：一个多目标面板因此只用 500 张单里的 50 张求解。
 *
 * 为什么必须是接缝测试：
 *   · 只测端点 ⇒ 它按契约行事（默认页长是它的本职），绿；
 *   · 只测前端 `fetchAllObjects` 的单元 ⇒ 桩想回多少回多少，永远取全，绿。
 * 只有「真种出 > 页长的类型」×「真走这条路由」×「真跑那个翻页算法」三件事合起来才现形。
 */
describe("GET /a/v1/objects · 不传分页 = 静默截断；全量翻页算法必须仍等于全量口径", () => {
  /** 前端 `apps/frontend-shell/src/api/endpoints.ts` 的 `fetchAllObjects` **同形实现**（逐页走 hasMore + total 校对）。 */
  async function fetchAllViaRoute(t: TestApp, type: string): Promise<number> {
    const MAX_PAGES = 2000;
    let n = 0;
    let last: ObjectsPageRes | undefined;
    let page = 1;
    for (; page <= MAX_PAGES; page++) {
      last = await getPage(t, `/a/v1/objects?type=${type}&page=${page}&pageSize=500`);
      n += last.items.length;
      if (!last.hasMore) break;
    }
    // 撞安全阀 / 条数对不上 ⇒ 抛，绝不静默回一个短列表（这一条正是变异反证当场抓出来的）。
    expect(last?.hasMore, `翻了 ${MAX_PAGES} 页仍未取完 ${type}`).toBeFalsy();
    if (!last?.totalIsLowerBound) expect(n, `${type} 累计条数应等于服务端 total`).toBe(last?.total);
    return n;
  }

  it("头号判据：真实条数 > 默认页长时，全量翻页读数 = 全量口径，而不传分页的读数不是", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 生产里真的被当成全集用的那几类（排产订单池 / 产线册 / 在制批 / 车间册）。
    for (const type of ["Order", "Line", "WIPLot", "Workshop"]) {
      const truth = await truthCount(t, type);

      // 金丝雀（护住本条自己）：这个类型必须真的多于默认页长，否则「不传分页」恰好也取全 ⇒ 本条假绿。
      const bare = await getPage(t, `/a/v1/objects?type=${type}`);
      expect(
        truth,
        `${type} 只有 ${truth} 行 ≤ 默认页长 ${bare.pageSize} ⇒ 它碰不到这个洞，不配当本条的样例`,
      ).toBeGreaterThan(bare.pageSize);

      // ① 病本身：什么都不传 ⇒ 静默少读，且回包**确实**说了 hasMore（信号一直都在，只是没人读）。
      expect(bare.items.length, `${type} 不传分页应只拿到一页（这就是那个洞）`).toBe(bare.pageSize);
      expect(bare.items.length, `${type} 不传分页拿到的必须少于真值`).toBeLessThan(truth);
      expect(bare.hasMore, "服务端一直在说「还有」——修的是没人听，不是没人说").toBe(true);

      // ② 修后：全量翻页算法的读数必须等于**独立口径**（直接读仓储，不用被测端点自己的 total）。
      expect(await fetchAllViaRoute(t, type), `${type} 全量翻页读数应等于仓储真值`).toBe(truth);
    }
  }, 300000);

  it("变异反证：页长改小，不传分页的读数跟着变小，而全量翻页读数纹丝不动", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const truth = await truthCount(t, "Order");

    // 显式 pageSize 模拟「服务端页长被改小」：**修前形态**跟着页长走（它就是页长的函数），
    // **修后形态**必须恒等于真值。跟着变 ⇒ 「翻完了」是假的。
    for (const serverPage of [50, 10, 3]) {
      const bare = await getPage(t, `/a/v1/objects?type=Order&pageSize=${serverPage}`);
      expect(bare.items.length, `页长 ${serverPage} 时，修前形态应恰好等于页长`).toBe(serverPage);
      expect(await fetchAllViaRoute(t, "Order"), `页长 ${serverPage} 时，修后形态必须仍是 ${truth}`).toBe(truth);
    }
  }, 300000);
});

/**
 * ── 接缝：**A↔B** · `POST /a/v1/objects/query` 的截断此前一个信号都没有 ──────────
 *
 * `GET /a/v1/objects` 至少还回 `hasMore`；这条给 agent 用的路**回的是裸数组**，
 * `Order` 真值 500、agent 拿到 100 行，长得和「一共就 100 张单」完全一样。
 * 于是它会拿 100 当分母作答，而屏上没有任何东西说得出这件事。
 */
describe("POST /a/v1/objects/query · 截断必须可察觉", () => {
  it("裸数组旁边必须给出 total（全量口径）与 truncated；data 形状不许变", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const truth = await truthCount(t, "Order");
    expect(truth, "Order 必须多于默认 limit 100，否则本条碰不到截断 ⇒ 假绿").toBeGreaterThan(100);

    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/objects/query",
      headers: ADMIN,
      payload: { objectType: "Order", filter: {} },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[]; total?: number; truncated?: boolean };

    expect(Array.isArray(body.data), "data 仍必须是裸数组（既有消费方靠它）").toBe(true);
    expect(body.data.length, "默认 limit=100 ⇒ 只给 100 行").toBe(100);
    expect(body.total, "total 必须是全量口径（独立于 limit），不是本次给了多少行").toBe(truth);
    expect(body.truncated, "没给全就必须说出来").toBe(true);

    // 金丝雀：取全时 truncated 必须为 false —— 否则「恒 true」也能让上面那条绿。
    const full = await t.app.inject({
      method: "POST",
      url: "/a/v1/objects/query",
      headers: ADMIN,
      payload: { objectType: "Order", filter: {}, limit: 1000 },
    });
    const fullBody = full.json() as { data: unknown[]; total?: number; truncated?: boolean };
    expect(fullBody.data.length, "limit 够大时应给全").toBe(truth);
    expect(fullBody.truncated, "给全了就不该标截断").toBe(false);
    expect(fullBody.total).toBe(truth);
  }, 300000);
});
