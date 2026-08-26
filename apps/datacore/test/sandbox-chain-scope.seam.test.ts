import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, ADMIN, type TestApp } from "./helpers.js";

/**
 * WO-SANDBOX-E2 · 业务线 scope 入口 SEAM 门（推演沙盘 W2·E2）。
 *
 * ── 本单的性质（**扩挂载点，不是造机制**·三分法定性 = 「接了线接错地方」）──
 * 业务线维度早就接了线：`service.ts` portfolio 分支解析 `args.businessTypes` → `PortfolioInput.businessTypes`
 * → `portfolio.ts` `btFilter` 真在收窄世界重解。病在**57 个求解器里只挂了 portfolio 一个点**：
 * 沙盘链路上真正出订单集的 `affected_orders` / `order_fullchain` / `atp_check` 一个都没吃这一维。
 * 故本门咬的是**新挂载点的效果层**，不是"参数被传了"。
 *
 * ── 判据一律效果层（绿测试≠能用）──
 * 断言的是**返回的订单集合本身**（`rows[].so` / `problems[].rootChains[].orderId` / 逐单类选中的那张单），
 * 并**回仓储 join `Order.businessType` 真值对拍**——不看"函数被调用了"、不看"scope 字段回带了"。
 * 头号命门来自本仓真实事故 §8 `G-SEG-ATTR-CROSS-SEGMENT`「储能达成率下钻混入整车厂」：
 * 选储能推演，结果里出现乘用车/商用车任何一张单 = 红。
 *
 * ── 真世界 · 非 toy ──
 * 走 `seedBattery`（真 battery 合成种子·seed 42）+ REST `/a/v1/solvers/{key}/invoke`（真路由真 SolverContext），
 * 不 mock 求解器、不直构 ctx。seed 42 真值（本门里的数字都是实测抄下来的，不是估的）：
 *   24 张 OPEN 订单 = 乘用车 12 ⊕ 储能 9 ⊕ 商用车 3。
 */

const ALL = 24;
const STORAGE_SOS = ["SO-3452", "SO-3458", "SO-3464", "SO-3470", "SO-3476", "SO-3495", "SO-3501", "SO-3518", "SO-3529"];

interface AggOut {
  summary: { orderCount: number; totalQty: number; custCount: number; revenue: number };
  rows: { so: string; cust: string; seg: string; model: string; qty: number }[];
  problems: { category: string; orderCount: number; rootChains: { orderId: string }[] }[];
  scope?: { businessTypes?: string[]; baseIds?: string[]; modelIds?: string[] };
}

async function agg(t: TestApp, args: Record<string, unknown>): Promise<AggOut> {
  const res = await invokeSolver(t, "affected_orders", args, ADMIN);
  expect(res.statusCode, `affected_orders ${JSON.stringify(args)} 应 200，实收 ${res.body}`).toBe(200);
  return JSON.parse(res.body).data as AggOut;
}

/**
 * 回仓储取「订单号 → 真业务线」（效果层对拍的**真值源**）。
 *
 * ⚠ 为什么不采信求解器自述的 seg 标签：**亲手真跑时发现一个存量缺陷（本单未修·已上报）**——
 * `order_fullchain` 的细分映射写死 `modelId.includes("S192")→储能 / includes("L148")→商用车 / 其余→乘用车`
 * （`service.ts` orderFullchain），而 seed 42 的 Model 全集是
 * `2170-NCM / 4680-LFP / 4680-NCM / 圆柱-LFP / 方形-LFP / 方形-NCM` —— **一个都不含 S192/L148**，
 * 于是**每一张单都被标成乘用车**并取乘用车的 marginPct=19/floorPct=12（储能真值 13/11、商用 15/11）。
 * 三分法定性 = **「接了线没数据」**（分支在、接了线，但输入恒不命中 → 恒走兜底），不是本单的 scope 缺口，
 * 修它会动 `order_fullchain` 所有调用的 seg/marginPct/floorPct/verdict（越出本单「args 解析与 scope 归一」边界）。
 * 故本门一律回 `Order.businessType` 真值对拍，不让这个存量错标把 SEAM 判据带歪。
 */
async function btBySo(t: TestApp): Promise<Map<string, string>> {
  const orders = await t.repos.objects.listByType("demo", "Order");
  return new Map(orders.map((o) => [String(o.props.so), String(o.props.businessType)]));
}

const sos = (r: AggOut): string[] => r.rows.map((x) => x.so).sort();

describe("WO-SANDBOX-E2 · SEAM 命门：选储能推演 → 结果只含储能订单，不泄漏其他细分（G-SEG-ATTR-CROSS-SEGMENT 同类事故）", () => {
  it("affected_orders 聚合：24 张全细分 → 9 张全储能；乘用车/商用车一张不漏进来；problems 根因链也不泄漏", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const truth = await btBySo(t);

    // 基线（未限定）：全细分同框 —— 这就是"用户以为筛了、其实没筛"时会看到的东西。
    const all = await agg(t, {});
    expect(all.summary.orderCount).toBe(ALL);
    expect([...new Set(all.rows.map((r) => truth.get(r.so)))].sort()).toEqual(["commercial", "passenger", "storage"]);
    expect(all.scope, "未限定 → 不回带 scope 字段（避免'未指定'被读成'限定了个空的'）").toBeUndefined();

    // 选储能推演。
    const ess = await agg(t, { businessTypes: ["storage"] });

    // ★ 命门①：返回的订单集合逐张回仓储对拍真业务线 —— 出现任何非 storage 即红。
    const leaked = ess.rows.filter((r) => truth.get(r.so) !== "storage");
    expect(leaked.map((r) => `${r.so}/${r.cust}/${truth.get(r.so)}`), "选储能推演却混入了其他细分的订单（跨细分泄漏）").toEqual([]);

    // ★ 命门②：真收窄（9 ≠ 24）且**不多不少正好是种子里那 9 张储能单**（漏筛红、过筛也红）。
    expect(ess.summary.orderCount).toBe(9);
    expect(sos(ess)).toEqual(STORAGE_SOS);

    // ★ 命门③：下游聚合数字跟着真变（不是只在行集上过滤、汇总仍用全集算）。
    expect(ess.summary.revenue).toBeLessThan(all.summary.revenue);
    expect(ess.summary.totalQty).toBeLessThan(all.summary.totalQty);
    expect(ess.summary.custCount).toBeLessThan(all.summary.custCount);

    // ★ 命门④：**根因下钻链**也不泄漏 —— 这正是事故原文那一层（"储能达成率下钻铺出长安/东风整车厂叶"）。
    const chainOrderIds = [...new Set(ess.problems.flatMap((p) => p.rootChains.map((c) => c.orderId)))];
    expect(chainOrderIds.length, "储能作用域下 problems 根因链应非空（空树会让本断言变成空转）").toBeGreaterThan(0);
    expect(chainOrderIds.filter((id) => truth.get(id) !== "storage"), "problems 根因链混入非储能订单").toEqual([]);

    // 反向对称：选乘用车 → 12 张全乘用车，且与储能集**零交集**（两次推演互不串味）。
    const pas = await agg(t, { businessTypes: ["passenger"] });
    expect(pas.summary.orderCount).toBe(12);
    expect(pas.rows.filter((r) => truth.get(r.so) !== "passenger")).toEqual([]);
    expect(sos(pas).filter((s) => STORAGE_SOS.includes(s))).toEqual([]);
  });

  it("逐单类求解器（order_fullchain / atp_check）：缺省选单也在作用域内挑，不再恒落全集首单", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const truth = await btBySo(t);

    for (const key of ["order_fullchain", "atp_check"]) {
      const base = JSON.parse((await invokeSolver(t, key, {}, ADMIN)).body).data as Record<string, unknown>;
      const baseSo = String(base.so ?? base.orderRef);
      expect(truth.get(baseSo), `${key} 未限定时的首单（种子实测 SO-3391·乘用车）`).toBe("passenger");

      const res = await invokeSolver(t, key, { businessTypes: ["storage"] }, ADMIN);
      expect(res.statusCode, `${key} 储能作用域应 200：${res.body}`).toBe(200);
      const scoped = JSON.parse(res.body).data as Record<string, unknown>;
      const scopedSo = String(scoped.so ?? scoped.orderRef);
      // ★ 效果层：选中的那张单**真的换了**，且它真是储能单（不是"参数传了但还是那张乘用车单"）。
      expect(scopedSo, `${key} 选储能仍返回全集首单 = 作用域没进选单逻辑`).not.toBe(baseSo);
      expect(truth.get(scopedSo)).toBe("storage");

      // 商用车同理（三档都真分流，非只有 storage 走通）。
      const com = JSON.parse((await invokeSolver(t, key, { businessTypes: ["commercial"] }, ADMIN)).body).data as Record<string, unknown>;
      expect(truth.get(String(com.so ?? com.orderRef))).toBe("commercial");
    }
  });
});

describe("WO-SANDBOX-E2 · 三维可组合（业务线 ⊕ 基地 ⊕ 型号 三个条件都生效·SEAM-ARG-DROP 丢参史）", () => {
  it("三维同给 → 结果 = 三者交集，且严格小于任一单维（「只生效最后一个」当场红）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const truth = await btBySo(t);

    // 单维基线（seed 42 实测）：常州基地**同时有**乘用车与储能单 —— 故基地维不蕴含业务线维，三维互不替代。
    const byBt = await agg(t, { businessTypes: ["passenger"] });
    const byBase = await agg(t, { baseIds: ["changzhou"] });
    const byModel = await agg(t, { modelIds: ["4680-NCM"] });
    expect(byBt.summary.orderCount).toBe(12);
    expect(byBase.summary.orderCount).toBe(8);
    expect([...new Set(byBase.rows.map((r) => truth.get(r.so)))].sort(), "常州须是混业态基地，否则本用例证不出三维正交").toEqual(["passenger", "storage"]);
    expect(byModel.summary.orderCount).toBe(8);

    // 三维同给。
    const combo = await agg(t, { businessTypes: ["passenger"], baseIds: ["changzhou"], modelIds: ["4680-NCM"] });

    // ★ 命门：结果 == 三个单维集合的**交集**（逐单号对拍·不是"数量对上了"）。
    const inter = sos(byBt).filter((s) => sos(byBase).includes(s) && sos(byModel).includes(s));
    expect(sos(combo)).toEqual(inter);
    expect(sos(combo)).toEqual(["SO-3402", "SO-3415", "SO-3420", "SO-3490"]);

    // ★ 命门：严格小于每一个单维 —— 只要有任一维被丢掉（SEAM-ARG-DROP），结果必等于其中某个单维集合，这里立刻红。
    for (const [name, single] of [["businessTypes", byBt], ["baseIds", byBase], ["modelIds", byModel]] as const) {
      expect(combo.summary.orderCount, `三维组合结果等于只有 ${name} 生效时的结果 → 另两维被丢参`).toBeLessThan(single.summary.orderCount);
      expect(sos(combo).every((s) => sos(single).includes(s))).toBe(true);
    }

    // 回带的 scope 三维齐全（R-ARG-FIDELITY：下游看得见筛了哪三维）。
    expect(combo.scope).toEqual({ businessTypes: ["passenger"], baseIds: ["changzhou"], modelIds: ["4680-NCM"] });
  });

  it("基地维复用既有归一单源 normalizeBaseRef：obj_base_<中文名> / 中文名 / baseId 三形态同一结果（没另造一套归一）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const out = [];
    for (const form of ["zaozhuang", "枣庄", "obj_base_枣庄"]) {
      out.push(await agg(t, { businessTypes: ["storage"], baseIds: [form] }));
    }
    expect(sos(out[0]!)).toEqual(["SO-3452", "SO-3464", "SO-3495", "SO-3518"]);
    expect(sos(out[1]!)).toEqual(sos(out[0]!));
    expect(sos(out[2]!)).toEqual(sos(out[0]!)); // obj_base_ 前缀被 normalizeBaseRef strip（症② 同族）
  });
});

describe("WO-SANDBOX-E2 · 诚实缺席（静默返回全集是最危险的一种：用户以为筛了、其实没筛）", () => {
  it("不存在的业务线 → 400 诚实报错并列出合法值，绝不静默回落全集", async () => {
    const t = await makeApp();
    await seedBattery(t);
    for (const bad of [["氢能"], ["storage", "氢能"], ["ESS"], [""], [null]]) {
      const res = await invokeSolver(t, "affected_orders", { businessTypes: bad }, ADMIN);
      expect(res.statusCode, `businessTypes=${JSON.stringify(bad)} 应 400，实收 ${res.body}`).toBe(400);
      const err = JSON.parse(res.body).error as { code: string; message: string };
      expect(err.code).toBe("VALIDATION_ERROR");
      // 合法值必须在报错里列出来（否则用户只知道错了、不知道该填什么）。
      for (const legal of ["passenger", "commercial", "storage"]) expect(err.message).toContain(legal);
    }
    // ★ 命门：错的那次绝不能悄悄给出全集 —— 上面已断 400；这里再确认全集只在**未限定**时才出现。
    expect((await agg(t, {})).summary.orderCount).toBe(ALL);
  });

  it("合法但作用域内无订单 → 诚实空（0 行），不是静默全集", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 商用车订单在 wuhan/xiamen/zigong；邯郸是纯储能基地 → 交集真为空。
    const empty = await agg(t, { businessTypes: ["commercial"], baseIds: ["handan"] });
    expect(empty.summary.orderCount).toBe(0);
    expect(empty.rows).toEqual([]);
    expect(empty.summary.revenue).toBe(0);
    expect(empty.summary.orderCount, "空作用域返回了全集 = 静默兜底").not.toBe(ALL);
    // 回带 scope，让"我确实按这三维筛过、真的没有"可被看见（空 ≠ 没筛）。
    expect(empty.scope).toEqual({ businessTypes: ["commercial"], baseIds: ["handan"] });
  });

  it("逐单类：点名的单不在作用域 → 400 明说被哪一维挡住；作用域内无单 → 404 诚实空，都不回落作用域外的单", async () => {
    const t = await makeApp();
    await seedBattery(t);
    for (const key of ["order_fullchain", "atp_check"]) {
      const refKey = key === "atp_check" ? "orderRef" : "so";
      // SO-3391 是乘用车单；在储能作用域里点名它 → 必须拒绝，绝不"点名优先、悄悄无视作用域"。
      const res = await invokeSolver(t, key, { [refKey]: "SO-3391", businessTypes: ["storage"] }, ADMIN);
      expect(res.statusCode, `${key} 点名作用域外的单应 400，实收 ${res.body}`).toBe(400);
      const err = JSON.parse(res.body).error as { code: string; message: string };
      expect(err.code).toBe("VALIDATION_ERROR");
      expect(err.message).toContain("SO-3391");
      expect(err.message).toContain("储能"); // 明说是哪一维把它挡在外面

      // 作用域真空（商用车 ∩ 邯郸）→ 404 诚实空，不回落任意一张单。
      const none = await invokeSolver(t, key, { businessTypes: ["commercial"], baseIds: ["handan"] }, ADMIN);
      expect(none.statusCode, `${key} 空作用域应 404，实收 ${none.body}`).toBe(404);
      expect(JSON.parse(none.body).error.code).toBe("NOT_FOUND");
    }
  });

  it("既有 portfolio 挂载点的静默全集也堵上：businessTypes 非法值不再被 filter 光后退回全世界重解", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 改前：`args.businessTypes.map(String)` 不校验枚举 → portfolio.ts btFilter 把非法值滤光 → btScoped=false
    //       → 全世界重解，与不传逐字节同结果（用户以为在推演某业务线，其实是全域）。
    const bad = await invokeSolver(t, "portfolio", { businessTypes: ["氢能"] }, ADMIN);
    expect(bad.statusCode, `portfolio 非法业务线应 400，实收 ${bad.body}`).toBe(400);
    expect(JSON.parse(bad.body).error.code).toBe("VALIDATION_ERROR");
    // 合法值仍照常走（本单只堵静默兜底，不改既有可用路径）。
    expect((await invokeSolver(t, "portfolio", { businessTypes: ["storage"] }, ADMIN)).statusCode).toBe(200);
  });
});

describe("WO-SANDBOX-E2 · R6 确定性 + 向后兼容", () => {
  it("同输入两跑字节一致（affected_orders / order_fullchain / atp_check 三处作用域路径）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const scopedArgs = { businessTypes: ["storage"], baseIds: ["枣庄"] };
    for (const key of ["affected_orders", "order_fullchain", "atp_check"]) {
      const a = (await invokeSolver(t, key, scopedArgs, ADMIN)).body;
      const b = (await invokeSolver(t, key, scopedArgs, ADMIN)).body;
      expect(b, `${key} 同输入两跑不字节一致（R6）`).toBe(a);
    }
    // 归一去重排序 + base 维回带 canonical：等价写法（重复值 / 中文名与 baseId 混写）→ 结果字节一致（R6 全序确定）。
    const x = await agg(t, { businessTypes: ["storage", "storage"], baseIds: ["枣庄", "zaozhuang"] });
    const y = await agg(t, { businessTypes: ["storage"], baseIds: ["zaozhuang"] });
    expect(JSON.stringify(x)).toBe(JSON.stringify(y));
    expect(x.scope).toEqual({ businessTypes: ["storage"], baseIds: ["zaozhuang"] }); // 回带的是解析后的真基地键，不是用户随手写的那两条
  });

  it("未限定 / 空数组（前端未勾选）→ 与上线前逐字节一致，且不回带 scope", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const none = (await invokeSolver(t, "affected_orders", {}, ADMIN)).body;
    const emptyArrays = (await invokeSolver(t, "affected_orders", { businessTypes: [], baseIds: [], modelIds: [] }, ADMIN)).body;
    expect(emptyArrays, "空数组（勾选框一个没勾）必须归一为『全域』，与不传字节一致").toBe(none);
    expect(JSON.parse(none).data.scope).toBeUndefined();
  });

  it("非数组写法诚实拒绝（不吞成「没传」→ 那又是一次静默全集）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    for (const bad of ["storage", { 0: "storage" }, 1]) {
      const res = await invokeSolver(t, "affected_orders", { businessTypes: bad }, ADMIN);
      expect(res.statusCode, `businessTypes=${JSON.stringify(bad)} 应 400`).toBe(400);
      expect(JSON.parse(res.body).error.message).toContain("businessTypes");
    }
  });
});
