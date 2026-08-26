/**
 * WO-ENGINE-SCOPE-FIX（欠账 #116 / #117）· 引擎层**作用域实参差分门**
 * —— 闭 `G-SOLVER-SCOPE-ECHO`（只回显不重算·假个性化）与 `G-SOLVER-SCOPE-DEAF`（实参完全忽略）在
 *    `carbon_footprint.baseName` / `lta_gap.material` / `risk_timeline.base` 三处的实例。
 *
 * ⚠ 本文件刻意**不是状态门**（"断言实参传对了"），而是**差分门**：
 *   同一次调用**只换作用域实参的值** → 断言**输出真的不同**，且不同的那部分**等于该实体自己的真数据**。
 *   取证单 `docs/WO-ENGINE-SCOPE-FORENSICS.md` §0 的结论是：20 张卡的求解器里 7 处「只回显」——
 *   答案上印着用户说的对象、数字却是**别人的**。既有测试全绿也咬不住这类病，因为它们咬的是**函数**
 *   （喂齐 args 直调），没有一条咬「**换实参 → 输出应当变**」。这就是「绿测试 ≠ 能用」的第 10 种形态。
 *
 * 接缝（SEAM-GATE）：数据半（`Base`/`EnergyMeter`/`Material` 对象真值）× 引擎半（求解器作用域路由）。
 *   断言里的**期望值一律从对象库真读**（不写死金值）——数据半掉了（电表没灌 baseId / 物料没中文名）
 *   或引擎半掉了（回到取 `[0]`）**任一半**即红。
 */
import { describe, expect, it } from "vitest";
import { ADMIN, invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";

const query = (t: TestApp, objectType: string): Promise<Record<string, unknown>[]> =>
  t.app
    .inject({ method: "POST", url: "/a/v1/objects/query", headers: ADMIN, payload: { objectType, filter: {}, limit: 500 } })
    .then((r) => (r.json() as { data: { props: Record<string, unknown> }[] }).data.map((o) => o.props));

const okData = async (t: TestApp, key: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const res = await invokeSolver(t, key, args);
  expect(res.statusCode, `${key}(${JSON.stringify(args)}) → ${res.body}`).toBe(200);
  return (res.json() as { data: Record<string, unknown> }).data;
};

/** 抹掉「回显位」后的输出指纹：只回显的实参被抹掉后若两份仍相同 ⇒ 数字根本没跟着变（= 假个性化）。 */
const fingerprintWithout = (o: Record<string, unknown>, echoKeys: string[]): string => {
  const c = JSON.parse(JSON.stringify(o)) as Record<string, unknown>;
  for (const k of echoKeys) delete c[k];
  return JSON.stringify(c);
};

let app: TestApp;
const boot = async (): Promise<TestApp> => {
  if (!app) {
    app = await makeApp();
    await seedBattery(app);
  }
  return app;
};

// ---------------------------------------------------------------------------
// A 组① · carbon_footprint 的基地维（#116·G-SOLVER-SCOPE-ECHO）
// 修前：`extended.ts` 取 `energyMeters[0]` —— 任何基地问都拿常州的电网因子，输出却印着用户问的基地。
// ---------------------------------------------------------------------------
describe("差分门 A① · carbon_footprint 基地维：换基地 → energyCarbon 必须真变，且等于该基地自己的电表", () => {
  it("三个基地三个不同的 energyCarbon，且各自 == 该基地 EnergyMeter 的 energyPerUnit × gridFactor（数据半 × 引擎半）", async () => {
    const t = await boot();
    const meters = await query(t, "EnergyMeter");
    const bases = await query(t, "Base");
    // 数据半前置（掉了就红在这里，而不是让引擎半背锅）：每个基地一块电表，且 gridFactor 真有跨度。
    expect(meters.length, "EnergyMeter 行数").toBeGreaterThanOrEqual(3);
    const byBase = new Map(meters.map((m) => [String(m.baseId), m]));

    const picks = ["chengdu", "zaozhuang", "jiangmen"].filter((b) => byBase.has(b));
    expect(picks.length, `期望的基地电表缺失：${JSON.stringify([...byBase.keys()])}`).toBe(3);

    const seen = new Map<string, number>();
    for (const baseId of picks) {
      const m = byBase.get(baseId)!;
      const name = String(bases.find((b) => String(b.baseId) === baseId)?.name ?? baseId);
      const out = await okData(t, "carbon_footprint", { modelId: "4680-NCM", baseName: name });
      const energy = (out.breakdown as { energyCarbon: number }).energyCarbon;
      // ★ 真重算判据：能耗碳 == 该基地电表的真值乘积（四舍五入到 4 位，与求解器同口径）。
      const expected = Math.round(Number(m.energyPerUnit) * Number(m.gridFactor) * 1e4) / 1e4;
      expect(energy, `${name} 的 energyCarbon 应取该基地电表（${m.energyPerUnit}×${m.gridFactor}）`).toBeCloseTo(expected, 4);
      // ★ 回显位与算的必须是同一个基地（本单要治的正是「印着成都、算的是常州」）。
      expect(out.baseName, "回显的基地名必须是真正被算的那个").toBe(name);
      seen.set(name, energy);
    }
    // ★ 差分判据：三个基地三个**互不相同**的数（修前三者恒等 1.3041）。
    expect(new Set([...seen.values()]).size, `三基地 energyCarbon 应互不相同，实测 ${JSON.stringify([...seen])}`).toBe(3);
  });

  it("抹掉回显位后两份输出**不再**逐字节相同（修前恒相同 = ECHO_ONLY 的机器判据）", async () => {
    const t = await boot();
    const a = await okData(t, "carbon_footprint", { modelId: "4680-NCM", baseName: "成都" });
    const b = await okData(t, "carbon_footprint", { modelId: "4680-NCM", baseName: "枣庄" });
    expect(fingerprintWithout(a, ["baseName"])).not.toBe(fingerprintWithout(b, ["baseName"]));
  });

  it("baseId 与中文名同解（chengdu ≡ 成都），且回显位归一成规范中文名", async () => {
    const t = await boot();
    const byId = await okData(t, "carbon_footprint", { modelId: "4680-NCM", base: "chengdu" });
    const byName = await okData(t, "carbon_footprint", { modelId: "4680-NCM", baseName: "成都" });
    expect(byId.baseName).toBe("成都");
    expect(fingerprintWithout(byId, [])).toBe(fingerprintWithout(byName, []));
  });

  it("诚实缺席：指定的基地在基地库无匹配 → 400 AMBIGUOUS_SCOPE（拒绝静默落首块电表）", async () => {
    const t = await boot();
    const res = await invokeSolver(t, "carbon_footprint", { modelId: "4680-NCM", baseName: "火星基地" });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe("AMBIGUOUS_SCOPE");
  });

  it("加性：不指定基地 → 仍取排序首块电表（与本单上线前逐字节一致）", async () => {
    const t = await boot();
    const meters = await query(t, "EnergyMeter");
    const first = [...meters].sort((x, y) => (String(x.meterId ?? x.baseId) < String(y.meterId ?? y.baseId) ? -1 : 1))[0]!;
    const out = await okData(t, "carbon_footprint", { modelId: "4680-NCM", baseName: "" });
    const energy = (out.breakdown as { energyCarbon: number }).energyCarbon;
    expect(energy).toBeCloseTo(Math.round(Number(first.energyPerUnit) * Number(first.gridFactor) * 1e4) / 1e4, 4);
  });
});

// ---------------------------------------------------------------------------
// A 组② · lta_gap 的物料维（#116·G-SOLVER-SCOPE-ECHO）
// 修前：只匹 `Material.matId`，而卡片 S09 传的是中文名 → 任何物料都拿首行（铝箔）的数。
// ---------------------------------------------------------------------------
describe("差分门 A② · lta_gap 物料维：中文名必须真定位物料（不是落到首行）", () => {
  it("中文名 ≡ 同物料的 matId（抹掉 material 回显位后逐字节相同）", async () => {
    const t = await boot();
    const mats = await query(t, "Material");
    const m = mats.find((x) => String(x.matId) === "pos_ncm");
    expect(m, "数据半：Material.pos_ncm 应存在").toBeTruthy();
    const cnName = String(m!.name);
    expect(cnName, "数据半：Material 应有中文名列").not.toBe("");

    const byName = await okData(t, "lta_gap", { material: cnName, month: "2026-07" });
    const byId = await okData(t, "lta_gap", { material: "pos_ncm", month: "2026-07" });
    expect(fingerprintWithout(byName, ["material"])).toBe(fingerprintWithout(byId, ["material"]));
  });

  it("换物料 → netDemand/coverage/gap 必须真变（修前两个中文名逐字节相同）", async () => {
    const t = await boot();
    const mats = await query(t, "Material");
    const a = String(mats.find((x) => String(x.matId) === "pos_ncm")!.name);
    const b = String(mats.find((x) => String(x.matId) === "al_foil")!.name);
    const ra = await okData(t, "lta_gap", { material: a, month: "2026-07" });
    const rb = await okData(t, "lta_gap", { material: b, month: "2026-07" });
    expect(ra.netDemand).not.toBe(rb.netDemand);
    expect(fingerprintWithout(ra, ["material"])).not.toBe(fingerprintWithout(rb, ["material"]));
    // ★ 真重算判据：netDemand == 该物料自己的 dailyUse×30×bomUnit − onHand − inTransit。
    const mA = mats.find((x) => String(x.matId) === "pos_ncm")!;
    const expected = Math.round((Math.round(Number(mA.dailyUse) * 30 * 100) / 100) * Number(mA.bomUnit) * 1e4) / 1e4 - Number(mA.onHand) - Number(mA.inTransit);
    expect(Number(ra.netDemand)).toBeCloseTo(Math.round(expected * 1e4) / 1e4, 2);
  });

  it("诚实缺席：指定的物料无匹配 → 400 AMBIGUOUS_SCOPE（拒绝静默落首个物料）", async () => {
    const t = await boot();
    const res = await invokeSolver(t, "lta_gap", { material: "不存在的物料X", month: "2026-07" });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe("AMBIGUOUS_SCOPE");
  });

  it("加性：不指定物料 → 仍取排序首个物料（与本单上线前逐字节一致）", async () => {
    const t = await boot();
    const out = await okData(t, "lta_gap", {});
    expect(out.material).toBe("al_foil");
  });
});

// ---------------------------------------------------------------------------
// B 组 · risk_timeline 的双键守卫（#117·G-SOLVER-SCOPE-DEAF）
// 修前：`if (args.base && args.factor)` —— 只给 base 静默扩到全网；问枣庄返回 8 张**别的基地**的卡。
// ---------------------------------------------------------------------------
describe("差分门 B · risk_timeline 单给 base：不得静默扩到全网", () => {
  it("只给 base（S03 卡片今天就是这么传的）→ 返回的每一张卡都必须是**这个**基地的", async () => {
    const t = await boot();
    for (const baseId of ["zaozhuang", "changzhou"]) {
      const out = await okData(t, "risk_timeline", { base: baseId });
      const cards = out.cards as { baseId: string }[];
      expect(cards.length, `${baseId} 应至少出一张卡（forced·不因未越线而整张消失）`).toBeGreaterThan(0);
      expect(
        [...new Set(cards.map((c) => c.baseId))],
        `问 ${baseId} 却返回了别的基地的卡：${JSON.stringify(cards.map((c) => c.baseId))}`,
      ).toEqual([baseId]);
    }
  });

  it("换基地 → 输出真的不同（修前两份逐字节相同）", async () => {
    const t = await boot();
    const z = await okData(t, "risk_timeline", { base: "zaozhuang" });
    const c = await okData(t, "risk_timeline", { base: "changzhou" });
    expect(JSON.stringify(z)).not.toBe(JSON.stringify(c));
    const cz = (z.cards as Record<string, unknown>[])[0]!;
    const cc = (c.cards as Record<string, unknown>[])[0]!;
    expect(cz.peak).not.toBe(cc.peak); // 真推演值随基地变（不是只换了个标签）
    expect(z.exposureOrder).toEqual(["zaozhuang"]);
    expect(c.exposureOrder).toEqual(["changzhou"]);
  });

  it("单给 base ≠ 不给 base（修前二者逐字节相同 = 实参完全失效的机器判据）", async () => {
    const t = await boot();
    const scoped = await okData(t, "risk_timeline", { base: "zaozhuang" });
    const all = await okData(t, "risk_timeline", {});
    expect(JSON.stringify(scoped)).not.toBe(JSON.stringify(all));
    // 修前的原样：全网路返回 8 张卡且**枣庄不在里面** —— 这条同时锚住「加性未被破」。
    const allBases = (all.cards as { baseId: string }[]).map((x) => x.baseId);
    expect(allBases).toEqual(["jiangmen", "handan", "zigong", "xinyang", "changzhou", "chengdu", "jinhua", "hefei"]);
    expect(allBases).not.toContain("zaozhuang");
  });

  it("base + factor 双键路径不回归（原本就真重算的那条）", async () => {
    const t = await boot();
    const out = await okData(t, "risk_timeline", { base: "常州", factor: "物料齐套", horizon: 30 });
    const cards = out.cards as { baseId: string; factor: string }[];
    expect(cards.map((c) => [c.baseId, c.factor])).toEqual([["changzhou", "物料齐套"]]);
  });

  it("诚实缺席：base 解析不到 → 400（修前静默当成「没给基地」返回全网 8 张卡）", async () => {
    const t = await boot();
    const res = await invokeSolver(t, "risk_timeline", { base: "火星基地" });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("unknown base");
  });
});
