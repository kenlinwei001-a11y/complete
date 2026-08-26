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
  it("★ 命门差分：只改基地这一维，capWanP50 必须跟着变（baseId=常州 ≠ baseId=成都 ≠ 全网）", async () => {
    const base = { modelId: MODEL, qty: 100, weeks: 6 };
    const all = data(await invokeSolver(t, "capacity_forecast", base, ADMIN));
    const cz = data(await invokeSolver(t, "capacity_forecast", { ...base, baseId: "changzhou" }, ADMIN));
    const cd = data(await invokeSolver(t, "capacity_forecast", { ...base, baseId: "chengdu" }, ADMIN));

    // ← 修前这一条是红的：`baseId` 被静默吞掉，两者与全网**逐字节相同**（实测 capWanP50 全是 12.3016）。
    expect(cz.capWanP50, "baseId=常州 与全网 capWanP50 相同 = base 维被静默丢（症① 复发）").not.toEqual(all.capWanP50);
    expect(cz.capWanP50, "换个基地 capWanP50 不变 = 这一维没真进算法（只是回显）").not.toEqual(cd.capWanP50);
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
    expect(data(b).capWanP50).toEqual(data(a).capWanP50);
    expect(data(c).capWanP50).toEqual(data(a).capWanP50);
    expect(data(b).scopeBaseId).toBe("changzhou");
  });

  it("加性（不给基地 → 与修前逐字节同解）：scope:ALL · 4 个认证基地 · capWanP50 金值 12.3016", async () => {
    const out = data(await invokeSolver(t, "capacity_forecast", { modelId: MODEL, qty: 100, weeks: 6 }, ADMIN));
    // 金值取自**修前**实测（同 seed 42 同入参）——归一层对"没给别名"的路必须零影响。
    expect(out.capWanP50).toBe(12.3016);
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

  // S15 `quote_margin` —— 同属「16 个派生意图对用户实体失聪」，但**两维定性不同，不许合成一句**
  it("★ 命门差分（S15·型号维·真接线）：换型号 → BOM 成本与毛利真变（修前两个型号逐字节相同）", async () => {
    const ncm = data(await invokeSolver(t, "quote_margin", { custName: "电网公司F", modelId: "4680-NCM", qty: 500 }, ADMIN));
    const lfp = data(await invokeSolver(t, "quote_margin", { custName: "电网公司F", modelId: "方形-LFP", qty: 500 }, ADMIN));
    // ← 修前这一条是红的：`bom` 恒取 `mats.slice(0,4)`（与型号无关的全局前 4 行）。
    expect((ncm.breakdown as Record<string, number>).bomCost).not.toEqual((lfp.breakdown as Record<string, number>).bomCost);
    expect(ncm.margin).not.toEqual(lfp.margin);
    // 并线（WO-QUOTE-MARGIN-CUSTOMER）：`scope` 的形状从「逐维 APPLIED/NOT_APPLIED」升级为
    // 「mode + 可溯字段」——本单原本要断言的是「型号维真生效」，该语义现由 `modelMatched` + `bomId` 承载
    // （能说出**用的是哪张 BOM**，比一个 "APPLIED" 字符串更强）。断言强度不降。
    const ns = ncm.scope as Record<string, unknown>;
    const ls = lfp.scope as Record<string, unknown>;
    expect(ns.modelId).toBe("4680-NCM");
    expect(ls.modelId).toBe("方形-LFP");
    // 型号维真生效的**可溯判据**：两个型号取到的是**两张不同的真 BOM**，而不是同一份全局常数。
    expect(ns.bomId, "型号维真生效 = 说得出用的哪张 BOM").toBeTruthy();
    expect(ns.bomId).not.toEqual(ls.bomId);
    // ⚠ 不断言 `modelMatched: true` —— 该键回答的是**另一个**问题：「这位客户下过这个型号吗」。
    //   电网公司F 名下无 4680-NCM 在手单 ⇒ 它如实为 false，并附 modelNote 说明单价回落。
    //   那是诚实位正常工作，不是型号维失效（两者混为一谈会把一条好断言写成假红）。
    expect(ns.modelMatched === false ? ns.modelNote : "ok", "modelMatched:false 必须解释单价怎么来的").toBeTruthy();
  });

  // ⚠ 本例已**反转**（并线 WO-QUOTE-MARGIN-CUSTOMER·欠账 #118）。
  // 原文断言的是「客户维**今天真的没有**，故回包必须标 custDimension:"NOT_APPLIED" + missingInputs」——
  // 那是一条**诚实位**：功能没做出来时，要求答案自己承认。现在客户维**真做出来了**
  // （客户 → order_of_customer 归属边 → 在手单 → 真单价/真 BOM），于是那条诚实位连同
  // `custDimension`/`custNote`/`missingInputs` 三个键一并退役 —— 退役的理由是**缺口被填上了**，
  // 不是断言碍事。故本例改为断言「这一维现在真的生效」：口径可溯到该客户自己的订单。
  it("★ 客户维（S15）：并线后真生效 —— 回包必须说得出这是**谁**的单（不再是 NOT_APPLIED 诚实位）", async () => {
    const b = data(await invokeSolver(t, "quote_margin", { custName: "商用车集团G", modelId: "4680-NCM" }, ADMIN));
    const sc = b.scope as Record<string, unknown>;
    expect(sc.mode, "点了名的客户必须走 CUSTOMER 口径，不是全域冒充").toBe("CUSTOMER");
    expect(sc.custName).toBe("商用车集团G"); // 回显用户真说的那个，不是目录里写死的那个
    expect(sc.custId, "算的是谁要可溯到主数据 id").toBeTruthy();
    // 假个性化的反面判据：答案必须挂得到**该客户自己的**订单/BOM，而不是一份全局常数。
    expect(sc.priceSource, "价从哪来必须写明（真单价 or 回落 Model.unitPrice）").toBeTruthy();
    expect(sc.dataMode).toBe("OK");
  });

  it("诚实缺席（S15）：认不出的型号 → 400，不拿全局前 4 种物料冒充该型号 BOM", async () => {
    const r = await invokeSolver(t, "quote_margin", { modelId: "火星电池" }, ADMIN);
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error.code).toBe("AMBIGUOUS_SCOPE");
  });

  // ⚠ 金值已更（并线 WO-QUOTE-MARGIN-CUSTOMER）——**这是一次有意的行为变更，不是金值将就代码**：
  // 原值 313.7452 = `Material` 按 id 排序前 4 行（铝箔/壳体/铜箔/电解液，**不含正极**）的成本，
  // 与任何真实型号的配方都无关；原断言把它锁成「不给型号时的加性保证」。
  // 并线后不给型号 → 取**全部在手单的主力型号**的真 BOM（方形-LFP → 540.2012），
  // 即「不知道问的是谁」时给的是一份**真配方**而不是一份没有主语的常数。
  // 直传 bom 的那条路（rules-p3 / solvers-extended）仍逐字节加性，见下一例与 quote-margin-customer 的 EXPLICIT 用例。
  it("不给型号 → 取主力型号真 BOM（金值 540.2012·方形-LFP）· scope.mode=ALL", async () => {
    const out = data(await invokeSolver(t, "quote_margin", {}, ADMIN));
    expect((out.breakdown as Record<string, number>).bomCost).toBe(540.2012);
    const sc = out.scope as Record<string, unknown>;
    expect(sc.mode).toBe("ALL");
    expect(sc.bomId, "全域口径也必须说得出用的是哪张 BOM").toBeTruthy();
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
