import { beforeAll, describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, ADMIN, type TestApp } from "./helpers.js";
import { SOLVER_CATALOG } from "../src/catalog.js";
import { knownArgKeys, normalizeSolverArgs, SOLVER_ARG_ALIASES } from "../src/solvers/arg-aliases.js";

/**
 * ★ WO-SILENT-WRONG-ANSWER-3 · 三条**静默错答**的接缝门（`G-SOLVER-ARG-KEY-DRIFT` / `G-SOLVER-SCOPE-DEAF`）。
 *
 * 本仓对静默错答的定性：**比跑不通更糟** —— 跑不通用户会来问，静默错答用户会信。
 *
 * ── 判据刻意不是「有没有报错」，是「答案对不对」（工单 §2）────────────────────────────────────
 * 每条都必须有一个**能分辨对错**的断言：同一问题、只改那个维度（基地 / 因子 / 实体），
 * **答案必须跟着变**；不变就是没修好。状态门（200 / COMPLETED / rounds===0）在这里一律不算数 ——
 * 三条病的原始形态全都是 **HTTP 200 + 页面正常渲染 + 数字是错的**。
 *
 * ── 三条的关系（工单 §3「若某条其实是另一条的同一个根因，合并报告」）────────────────────────
 * ①② **同一个根因**：求解器读的键 ≠ 目录 `argHints` 声明的键，多出来的键被
 *   `Record<string,unknown>` 静默吞掉 ⇒ 作用域维凭空消失、答案退回全网。
 *   故两条共用同一份修（`solvers/arg-aliases.ts` 单一归一出处）与同一组差分断言。
 * ③ 是**另一个根因**：键到达了、求解器却没有那一维（`kit_readiness` 的 `orders` 恒取全网前 8 张）。
 *   这一条只能靠引擎侧真接上基地维来治 —— 键名归一对它一点用都没有。**两种病混了必修错地方。**
 *
 * ── 变异反证（真跑·原文见工单交付说明）──────────────────────────────────────────────────
 *   · 把 `service.ts compute()` 里的 `normalizeSolverArgs(...)` 换回 `rawArgs` → §① §② 转红；
 *   · 把 `extended.ts kit_readiness` 的 `pool` 改回 `c.orders` 不过滤 → §③ 转红。
 */

const MODEL = "4680-NCM";
type Body = { statusCode: number; body: string };
const data = (r: Body): Record<string, unknown> => {
  const j = JSON.parse(r.body) as { data?: Record<string, unknown> };
  return j.data ?? (j as Record<string, unknown>);
};

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
  await seedBattery(t);
}, 120_000);

// ---------------------------------------------------------------------------
// §0 单一出处本身（纯函数直测·零数据依赖）
// ---------------------------------------------------------------------------

describe("WO-SILENT-WRONG-ANSWER-3 §0 · 入参键名归一是**一份**实现（治单源·非每个消费方各加一个 ??）", () => {
  it("未登记求解器原样返回**同一个引用**（加性可回退：不在表里的求解器逐字节不变）", () => {
    const args = { a: 1, baseId: "changzhou" };
    expect(normalizeSolverArgs("some_unregistered_solver", args)).toBe(args); // 同一引用，不是深比
  });

  it("只给别名 → 值搬到规范键、**别名键被删掉**（否则 `...args` 会把它拼回输出，答案上出现两个基地字段）", () => {
    const out = normalizeSolverArgs("capacity_forecast", { modelId: MODEL, baseId: "changzhou" });
    expect(out.base).toBe("changzhou");
    expect("baseId" in out).toBe(false);
  });

  it("规范键与别名**同值** → 幂等（可重复归一·不抛）", () => {
    const once = normalizeSolverArgs("risk_timeline", { base: "zaozhuang", baseId: "zaozhuang" });
    expect(once.base).toBe("zaozhuang");
    expect(normalizeSolverArgs("risk_timeline", once)).toEqual(once);
  });

  it("★ 诚实位：规范键与别名**不同值** → 抛，绝不静默挑一个（挑错=「用户以为传了 A、系统按 B 算」）", () => {
    expect(() => normalizeSolverArgs("capacity_forecast", { modelId: MODEL, base: "changzhou", baseId: "chengdu" })).toThrow(
      /冲突/,
    );
  });

  it("空串/undefined 一律算「没给」（S20 卡片的中性默认就是空串，不能被当成「用户指定了基地」）", () => {
    const out = normalizeSolverArgs("carbon_footprint", { modelId: MODEL, base: "", baseName: "" });
    expect(out).toEqual({ modelId: MODEL, base: "", baseName: "" });
  });

  it("★ 别名表登记的每个求解器，其目录 `argHints` 里出现的基地/窗口键都必须归一得到规范键", () => {
    const bad: string[] = [];
    for (const solverKey of Object.keys(SOLVER_ARG_ALIASES)) {
      const item = SOLVER_CATALOG.find((x) => x.key === solverKey);
      if (!item) continue; // 不在目录里的求解器不受本条约束
      const known = knownArgKeys(solverKey); // 规范键 ∪ 别名（与生产同一份表·不另抄）
      const canonical = new Set(Object.keys(SOLVER_ARG_ALIASES[solverKey]!));
      for (const hint of Object.keys(item.argHints ?? {})) {
        if (!known.has(hint)) continue; // 与本表无关的键（modelId/qty/orders…）由 §①§②§③ 的差分断言直接验
        // 归一之后必须落在规范键上（用别名做入参，跑一遍归一必须变成规范键）。
        const out = normalizeSolverArgs(solverKey, { [hint]: "changzhou" });
        const landed = [...canonical].some((c) => out[c] === "changzhou");
        if (!landed) bad.push(`${solverKey}.${hint}`);
      }
    }
    expect(bad, "目录声明了却归一不到规范键的 argHints").toEqual([]);
    // 反向硬断言（金值·防目录悄悄改回旧键）：这三条是本单的病历本身。
    const cap = SOLVER_CATALOG.find((x) => x.key === "capacity_forecast")!;
    const rt = SOLVER_CATALOG.find((x) => x.key === "risk_timeline")!;
    expect(Object.keys(cap.argHints ?? {}), "capacity_forecast 必须声明 base（症①：此前根本没声明）").toContain("base");
    expect(Object.keys(rt.argHints ?? {}), "risk_timeline 必须声明 base（症②：此前声明 baseId 却没人读）").toContain("base");
    expect(Object.keys(rt.argHints ?? {}), "risk_timeline 必须声明 horizon（症②：此前声明 days 却没人读）").toContain("horizon");
  });
});

// ---------------------------------------------------------------------------
// §① capacity_forecast —— 传 baseId 静默答全网
// ---------------------------------------------------------------------------

describe("WO-SILENT-WRONG-ANSWER-3 §① · capacity_forecast 的基地维不因键名而失效", () => {
  it("★ 命门差分：只改基地这一维，p50 必须跟着变（baseId=常州 ≠ baseId=成都 ≠ 全网）", async () => {
    const base = { modelId: MODEL, qty: 100, weeks: 6 };
    const all = data(await invokeSolver(t, "capacity_forecast", base, ADMIN));
    const cz = data(await invokeSolver(t, "capacity_forecast", { ...base, baseId: "changzhou" }, ADMIN));
    const cd = data(await invokeSolver(t, "capacity_forecast", { ...base, baseId: "chengdu" }, ADMIN));

    // ← 修前这一条是红的：`baseId` 被静默吞掉，两者与全网**逐字节相同**（实测 p50 全是 12.3016）。
    expect(cz.p50, "baseId=常州 与全网 p50 相同 = base 维被静默丢（症① 复发）").not.toEqual(all.p50);
    expect(cz.p50, "换个基地 p50 不变 = 这一维没真进算法（只是回显）").not.toEqual(cd.p50);
    expect(cz.scope).toBe("BASE");
    expect(cz.scopeBaseId).toBe("changzhou");
    expect(cd.scopeBaseId).toBe("chengdu");
    expect((cz.perBaseRows as unknown[]).length).toBe(1);
  });

  it("三种写法（base / baseId / baseName 中文名）收敛到同一答案（同一概念只允许有一份归一）", async () => {
    const base = { modelId: MODEL, qty: 100, weeks: 6 };
    const a = await invokeSolver(t, "capacity_forecast", { ...base, base: "changzhou" }, ADMIN);
    const b = await invokeSolver(t, "capacity_forecast", { ...base, baseId: "changzhou" }, ADMIN);
    const c = await invokeSolver(t, "capacity_forecast", { ...base, baseName: "常州" }, ADMIN);
    expect(data(b).p50).toEqual(data(a).p50);
    expect(data(c).p50).toEqual(data(a).p50);
    expect(data(b).scopeBaseId).toBe("changzhou");
  });

  it("加性（不给基地 → 与修前逐字节同解）：scope:ALL · 4 个认证基地 · p50 金值 12.3016", async () => {
    const out = data(await invokeSolver(t, "capacity_forecast", { modelId: MODEL, qty: 100, weeks: 6 }, ADMIN));
    // 金值取自**修前**实测（同 seed 42 同入参）——归一层对"没给别名"的路必须零影响。
    expect(out.p50).toBe(12.3016);
    expect(out.scope).toBe("ALL");
    expect((out.perBaseRows as unknown[]).length).toBe(4);
  });

  it("诚实位：同一维度给了两个不同的值 → 400，不静默挑一个", async () => {
    const r = await invokeSolver(t, "capacity_forecast", { modelId: MODEL, base: "changzhou", baseId: "chengdu" }, ADMIN);
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error.code).toBe("VALIDATION_ERROR");
  });
});

// ---------------------------------------------------------------------------
// §② risk_timeline（S03 风险根因卡）—— 目录声明的两个键一个都不被读
// ---------------------------------------------------------------------------

describe("WO-SILENT-WRONG-ANSWER-3 §② · risk_timeline 照目录传参也必须命中该基地", () => {
  const basesOf = (d: Record<string, unknown>) => [...new Set((d.cards as { baseId: string }[]).map((c) => c.baseId))];

  it("★ 命门差分：`{baseId:'zaozhuang'}`（目录声明的写法）必须只出枣庄的卡，且枣庄必须在里面", async () => {
    const zz = data(await invokeSolver(t, "risk_timeline", { baseId: "zaozhuang" }, ADMIN));
    const all = data(await invokeSolver(t, "risk_timeline", {}, ADMIN));
    // ← 修前这一条是红的：返回 8 张卡 [jiangmen,handan,zigong,xinyang,changzhou,chengdu,jinhua,hefei]，
    //   枣庄**一张都不在里面**，且与 `{}` 逐字节相同。
    expect(basesOf(zz)).toEqual(["zaozhuang"]);
    expect(basesOf(all).length).toBeGreaterThan(1);
    expect(basesOf(all)).not.toContain("zaozhuang"); // 病历原文：全网路里枣庄本就不出卡 → 更显"问了等于没问"
  });

  it("★ 命门差分：换个基地，卡真的换（不是回显换了、数字没换）", async () => {
    const zz = data(await invokeSolver(t, "risk_timeline", { baseId: "zaozhuang" }, ADMIN));
    const cz = data(await invokeSolver(t, "risk_timeline", { baseId: "changzhou" }, ADMIN));
    expect(basesOf(cz)).toEqual(["changzhou"]);
    expect(JSON.stringify(cz.cards)).not.toEqual(JSON.stringify(zz.cards));
  });

  it("★ 命门差分：目录声明的 `days` 必须真的改窗口（修前 days=7 与不传逐字节相同·窗口恒 30）", async () => {
    const d7 = await invokeSolver(t, "risk_timeline", { days: 7 }, ADMIN);
    const h7 = await invokeSolver(t, "risk_timeline", { horizon: 7 }, ADMIN);
    const d30 = await invokeSolver(t, "risk_timeline", {}, ADMIN);
    expect(data(d7).horizon).toBe(7);
    expect(d7.body).toEqual(h7.body); // 别名与规范键同解
    expect(d7.body).not.toEqual(d30.body); // 与默认窗口不同 → 这一维真进了算法
  });

  it("只给 base 不给 factor（S03 卡就是这么传的）→ 该基地的卡，不是别的基地的卡", async () => {
    const zz = data(await invokeSolver(t, "risk_timeline", { base: "zaozhuang" }, ADMIN));
    expect(basesOf(zz)).toEqual(["zaozhuang"]);
    expect((zz.cards as unknown[]).length).toBeGreaterThan(0); // forced：该基地恒出卡，不因本窗无越线而整张消失
  });

  it("诚实位：输出必须说明**这次算的是谁**（修前顶层一个字都没有 → 错答在屏上看不出来）", async () => {
    const zz = data(await invokeSolver(t, "risk_timeline", { baseId: "zaozhuang" }, ADMIN));
    const all = data(await invokeSolver(t, "risk_timeline", {}, ADMIN));
    expect(zz.scope).toBe("BASE");
    expect(zz.scopeBaseId).toBe("zaozhuang");
    expect(String(zz.scopeNote)).toContain("非全网");
    expect(all.scope).toBe("ALL");
    expect(String(all.scopeNote)).toContain("全网");
  });

  it("加性（不给任何参数 → 与修前同解）：8 张卡 · horizon 30 · 基地集金值不变", async () => {
    const all = data(await invokeSolver(t, "risk_timeline", {}, ADMIN));
    expect(all.horizon).toBe(30);
    expect((all.cards as unknown[]).length).toBe(8);
    expect(basesOf(all)).toEqual(["jiangmen", "handan", "zigong", "xinyang", "changzhou", "chengdu", "jinhua", "hefei"]);
  });

  it("诚实缺席：认不出的基地 → 400，不静默退回全网 8 张卡", async () => {
    const r = await invokeSolver(t, "risk_timeline", { baseId: "火星基地" }, ADMIN);
    expect(r.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// §③ kit_readiness（S08 齐套分析）—— 键到达了，求解器却没有那一维
// ---------------------------------------------------------------------------

describe("WO-SILENT-WRONG-ANSWER-3 §③ · 派生意图的用户实体到达之后必须真的被用上", () => {
  const idsOf = (d: Record<string, unknown>) => (d.rows as { orderId: string }[]).map((r) => r.orderId);

  it("★ 命门差分（病历原句）：「常州下周哪些订单缺料」vs「金华…」答案不再逐字节相同", async () => {
    const cz = await invokeSolver(t, "kit_readiness", { base: "changzhou" }, ADMIN);
    const jh = await invokeSolver(t, "kit_readiness", { base: "jinhua" }, ADMIN);
    // ← 修前这一条是红的：`orders` 恒取 `c.orders.slice(0,8)`（全网前 8 张），两问逐字节相同。
    expect(cz.body).not.toEqual(jh.body);
    expect(idsOf(data(cz))).not.toEqual(idsOf(data(jh)));
    // 真过滤（不是换了个回显标签）：两个基地的订单集必须各自非空、且不是同一批单。
    expect(idsOf(data(cz)).length).toBeGreaterThan(0);
    expect(idsOf(data(jh)).length).toBeGreaterThan(0);
  });

  it("基地作用域是**真过滤**：命中的每一张单都必须真的挂在该基地（Order.bases ∋ baseId）", async () => {
    const cz = data(await invokeSolver(t, "kit_readiness", { base: "changzhou" }, ADMIN));
    const orders = await t.repos.objects.listByType("demo", "Order");
    const byId = new Map(orders.map((o) => [String(o.props.so), (o.props.bases as unknown[]) ?? []]));
    for (const id of idsOf(cz)) {
      expect((byId.get(id) ?? []).map(String), `${id} 不属于常州却进了常州的齐套表`).toContain("changzhou");
    }
    expect((cz.scope as Record<string, unknown>).mode).toBe("BASE");
    expect((cz.scope as Record<string, unknown>).baseId).toBe("changzhou");
  });

  it("键名归一同样生效（baseId/中文名 与 base 同解）", async () => {
    const a = await invokeSolver(t, "kit_readiness", { base: "changzhou" }, ADMIN);
    const b = await invokeSolver(t, "kit_readiness", { baseId: "常州" }, ADMIN);
    expect(b.body).toEqual(a.body);
  });

  it("诚实位：全网口径必须自报「全网」+ 自报「只看了前 8 张」（此前这两件事都完全隐形）", async () => {
    const all = data(await invokeSolver(t, "kit_readiness", {}, ADMIN));
    const sc = all.scope as Record<string, unknown>;
    expect(sc.mode).toBe("ALL");
    expect(sc.orderPoolTotal).toBe(24);
    expect(sc.sampled).toBe(8);
    // shortageCount=8 此前会被读成"该口径下共 8 张缺料单"，实际只是"抽样的 8 张里 8 张缺料"。
    expect(String(sc.samplingNote)).toContain("不是该口径下的全部");
  });

  it("加性（不给基地 → 与修前同解）：8 行 · shortageCount 8 · 首行 SO-3391（病历原文的那一组数）", async () => {
    const all = data(await invokeSolver(t, "kit_readiness", {}, ADMIN));
    expect(idsOf(all).length).toBe(8);
    expect(all.shortageCount).toBe(8);
    expect(idsOf(all)[0]).toBe("SO-3391");
  });

  it("诚实缺席：认不出的基地 → 400，不静默退回全网订单池", async () => {
    const r = await invokeSolver(t, "kit_readiness", { base: "火星基地" }, ADMIN);
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error.code).toBe("AMBIGUOUS_SCOPE");
  });

  it("调用方直传 orders（规则 payload / 测试路）→ 不注入 scope 键 = 逐字节加性", async () => {
    const r = data(
      await invokeSolver(
        t,
        "kit_readiness",
        { orders: [{ orderId: "O1", qty: 10, startDay: 5, materials: [{ material: "M1", onHand: 100, inTransit: [], bomUnit: 1 }] }] },
        ADMIN,
      ),
    );
    expect("scope" in r).toBe(false);
    expect(r.shortageCount).toBe(0);
  });
});
