import { describe, expect, it } from "vitest";
import {
  computeBaseFreshness, digestSpecCells, fnv1a, specCellIndex, specCellIndexFor, specCellKey, specRefDiffs,
  todayOfSpecCell, worldCellKeys, type BaseSnapshotSource,
} from "../src/sim/spec-cells.js";
import { STATE_VAR_VALUE_REFS } from "../src/synthetic/battery.js";
import { DEMO_DERIVATION_SPECS, recomputeDemoDerivationsAtSeed, seedDemoDerivationSpecs } from "../src/seed-derivation-specs.js";
import { demoPropagationRulesWithDomain, seedDemoPropagationRules } from "../src/seed.js";
import { ADMIN, makeApp, seedBattery, type TestApp } from "./helpers.js";
import type { PropagationRule, SimSession, TickState } from "@platform/contracts";
import type { DerivationSpecRecord } from "../src/domain.js";

/**
 * WO-3ROOT-P2 · 接缝：**规格基值的运行期新鲜度**（`docs/PRD-WO-3ROOT-P2-runtime-rederive.md`）。
 *
 * 咬的是链路两端：
 *   ① **归属**（D1）—— 「这格归不归规格」由 ACTIVE 规格 ∩ 世界量纲空间派生（不是编译期字面量）；
 *   ② **时效**（D2）—— 基值 vs 今天从对象 props 重算的规格真值，逐格 `round(...,6)`、**无容差**；
 *   ③ **三态**（A7）—— 缺源指纹 ⇒ `UNKNOWN`，⛔ 不许读作 FRESH。
 *
 * ⛔ 本档**不**为让新判据变绿而改既有断言；也**不**新增门/棘轮/基线 JSON（仓主禁令 3）。
 */

const spec = (specKey: string, targetType: string, targetProp: string, formula: string, status = "ACTIVE"): DerivationSpecRecord =>
  ({ specKey, targetType, targetProp, formula, status, tenantId: "demo" } as unknown as DerivationSpecRecord);

const rule = (sourceTypeKey: string, sourceStateVar: string, targetTypeKey: string, targetStateVar: string): PropagationRule =>
  ({ sourceTypeKey, sourceStateVar, targetTypeKey, targetStateVar } as unknown as PropagationRule);

/**
 * ── E3 那一臂要真起服务（真 Fastify 实例 + 真仓储）────────────────────────────────────
 *
 * ⚠ 本档此前**零** `makeApp` / `app.inject`：七条用例全是纯函数接缝 ——
 * 那验的是「函数对不对」，**不度量**「这条链在生产里通不通」（PRD §四 E3 点名要的是后者）。
 * 下面这组 helper 走的就是 `sim-seed-world.seam.test.ts` 的同款 harness（真路由 + 真仓储）。
 */

/** 沙盘/传导两个开关**必须先开**：真路由的 `requireSim` 会拒（与 `sim-seed-world.seam.test.ts` 同款）。 */
const enableSim = (t: TestApp, tenant = "demo") =>
  t.app.inject({
    method: "PUT",
    url: `/a/v1/tenants/${tenant}/features`,
    headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

/** 世界态格子数（objectId × stateVar）。断言「非空」要用它 —— `Object.keys(state).length` 只数到对象。 */
const cellCount = (state: TickState): number =>
  Object.values(state).reduce((n, row) => n + Object.keys(row).length, 0);

/**
 * 逐格差器：返回**值不同**的格（`objectId.stateVar`），逐位比较、无容差。
 * ⛔ 只数「值不同」，不数「键不同」：缺键是「这一格没铺到」，与「值漂了」是两个命题，
 *    混成一个数就会把「某侧压根没铺这格」读成「算出了不同的值」。
 */
const diffCells = (a: TickState, b: TickState): string[] => {
  const out: string[] = [];
  for (const objId of Object.keys(a)) {
    for (const sv of Object.keys(a[objId]!)) {
      if (a[objId]![sv] !== b[objId]?.[sv]) out.push(`${objId}.${sv}`);
    }
  }
  return out;
};

describe("WO-3ROOT-P2 · spec-cells（归属 + 时效）", () => {

  it("A1① · 真实 demo 规格 × 真实 demo 规则：index 键集与 \`STATE_VAR_VALUE_REFS\` **双向差集为空**（且规格数 > index.size —— 证明是过滤在起作用，不是恒等）", () => {
    const specs = DEMO_DERIVATION_SPECS.map((x) => ({ ...x, status: "ACTIVE" }) as unknown as DerivationSpecRecord);
    const rules = demoPropagationRulesWithDomain() as unknown as PropagationRule[];
    const index = specCellIndex(specs, worldCellKeys(rules));
    expect(rules.length).toBeGreaterThan(0); // 金丝雀①：规则集非空（否则 worldCellKeys 空 ⇒ index 恒空，"相等"无意义）
    expect(specs.length).toBeGreaterThan(index.size); // 金丝雀②：确有规格被量纲空间挡在外面（28 > 25）
    expect(Object.keys(STATE_VAR_VALUE_REFS).length).toBeGreaterThan(0); // 金丝雀③：refs 表非空
    expect([...index.keys()].sort()).toEqual(Object.keys(STATE_VAR_VALUE_REFS).sort());
    expect(specRefDiffs(index)).toEqual([]);
  });

  it("D1 · 索引 = ACTIVE 规格 ∩ 世界量纲空间：空间外的规格**不许**进索引（widening 守卫）", () => {
    const specs = [
      spec("order_demand_pressure", "Order", "demandPressure", "COALESCE(this.demandDelta * 100, 0)"),
      spec("order_value", "Order", "value", "this.qty * this.unitPrice"), // ← 落点不在世界量纲空间
      spec("retired_one", "Order", "costPressure", "this.creditUsedRatio * 100", "RETIRED"),
    ];
    const universe = worldCellKeys([rule("Model", "demandLoad", "Order", "demandPressure")]);
    const index = specCellIndex(specs, universe);
    expect([...index.keys()]).toEqual(["Order|demandPressure"]);
    // 金丝雀：不带 universe 时另两条**确实**会被收进来 —— 证明上一条不是「恒空」而是过滤生效
    expect(specCellIndex(specs).size).toBe(2);
  });

  it("D1 · refs 对账：specKey 不一致 / 索引里没有 ⇒ 差集非空（沿用既有「绑定断裂」抛错路径）", () => {
    const refEntries = Object.entries(STATE_VAR_VALUE_REFS) as readonly (readonly [string, { specKey: string }])[];
    const specsOf = (mutate?: (key: string, specKey: string) => string) =>
      refEntries.map(([k, v]) => {
        const [t, sv] = k.split("|") as [string, string];
        return spec(mutate === undefined ? v.specKey : mutate(k, v.specKey), t, sv, "0");
      });
    // 正向：整张登记表都指得回 index ⇒ 零差集（⚠ 单条目 index 会报其余 24 条缺位，那是**对的**：
    //       差集判的是「登记表里的每一格，索引里有没有、且指回同一条规格」。别再拿一格去喂它。）
    expect(specRefDiffs(specCellIndex(specsOf()))).toEqual([]);
    // 反向①：**只**把一格换条规格 ⇒ 恰好报出那一格（不是静默通过，也不是全表报红）
    const refKey = refEntries[0]![0];
    const renamed = specRefDiffs(specCellIndex(specsOf((k, sk) => (k === refKey ? "some_other_key" : sk))));
    expect(renamed.length).toBe(1);
    expect(renamed[0]).toContain(refKey);
    // 反向②：索引整个空 ⇒ 25 格**全部**报出来（金丝雀：判据不是恒空）
    const empty = specRefDiffs(new Map());
    expect(empty.length).toBe(refEntries.length);
    expect(empty.length).toBeGreaterThan(0);
  });

  it("D2 · 三态：FRESH / STALE（含逐格明细）/ UNKNOWN；props 撤回 ⇒ 必须回到 FRESH", () => {
    const formule = "COALESCE(this.demandDelta * 100, 0)";
    const specs = [spec("order_demand_pressure", "Order", "demandPressure", formule)];
    const universe = worldCellKeys([rule("Model", "demandLoad", "Order", "demandPressure")]);
    const index = specCellIndex(specs, universe);
    const entry = { objectId: "obj_order_SO-3391", stateVar: "demandPressure", specKey: "order_demand_pressure", baseValue: 60 };
    const source: BaseSnapshotSource = { revision: 7, asOf: "2026-10-03T00:00:00.000Z", specCells: [entry], digest: digestSpecCells([entry]) };
    const baseSnapshot = { "obj_order_SO-3391": { demandPressure: 60, demandDelta: 0.6 } };
    const typeOf = new Map([["obj_order_SO-3391", "Order"]]);
    const withProps = (props: Record<string, unknown>) => new Map([["obj_order_SO-3391", props]]);

    // ① FRESH：源没变（revision 相等 ⇒ 短路）与源变了但逐格相等，两条路都要到 FRESH
    const freshShort = computeBaseFreshness({ source, baseSnapshot, index, typeOf, propsOf: withProps({ demandDelta: 0.6, demandPressure: 60 }), currentRevision: 7 });
    expect(freshShort.state).toBe("FRESH");
    expect(freshShort.staleCellCount).toBe(0);
    const freshScan = computeBaseFreshness({ source, baseSnapshot, index, typeOf, propsOf: withProps({ demandDelta: 0.6, demandPressure: 60 }), currentRevision: 8 });
    expect(freshScan.state).toBe("FRESH"); // ⚠ revision 不等也照样 FRESH ⇒ 判据本体在逐格比对上

    // ② STALE：`demandDelta` 0.6 → 0.9 ⇒ props.demandPressure 60 → 90（E1 的可预言形态）
    const stale = computeBaseFreshness({ source, baseSnapshot, index, typeOf, propsOf: withProps({ demandDelta: 0.9, demandPressure: 90 }), currentRevision: 8 });
    expect(stale.state).toBe("STALE");
    expect(stale.staleCellCount).toBe(1);
    expect(stale.staleCells[0]).toEqual({ objectId: "obj_order_SO-3391", stateVar: "demandPressure", specKey: "order_demand_pressure", baseValue: 60, currentValue: 90 });
    expect(stale.evaluatedCellCount).toBe(index.size);

    // ③ 反向否证（A3）：props 撤回 0.6/60 ⇒ 同一条会话必须回到 FRESH
    const reverted = computeBaseFreshness({ source, baseSnapshot, index, typeOf, propsOf: withProps({ demandDelta: 0.6, demandPressure: 60 }), currentRevision: 9 });
    expect(reverted.state).toBe("FRESH");
    expect(reverted.staleCellCount).toBe(0);

    // ④ UNKNOWN（A7）：缺源指纹 ⇒ 第三态，⛔ 不许读作 FRESH
    const unknown = computeBaseFreshness({ source: null, baseSnapshot, index, typeOf, propsOf: withProps({ demandDelta: 0.9, demandPressure: 90 }), currentRevision: 9 });
    expect(unknown.state).toBe("UNKNOWN");
    expect(unknown.reason).toBeTruthy();
    expect(unknown.staleCellCount).toBe(0);

    // ⑤ 口径（A9）：逐位比、无容差 —— 1e-9 的差也必须报 STALE（存量 339 格舍入差就该红）
    const bitDiff = computeBaseFreshness({ source, baseSnapshot: { "obj_order_SO-3391": { demandPressure: 59.999999999 } }, index, typeOf, propsOf: withProps({ demandDelta: 0.6 }), currentRevision: 9 });
    expect(bitDiff.state).toBe("STALE");
  });

  it("D2 · R6 确定性：digest 无时钟无随机；同输入同输出；换一个基值必换指纹", () => {
    const cells = [{ objectId: "b", stateVar: "y", specKey: "k2", baseValue: 2 }, { objectId: "a", stateVar: "x", specKey: "k1", baseValue: 1 }];
    expect(digestSpecCells(cells)).toBe(digestSpecCells([...cells].reverse())); // 序无关
    expect(digestSpecCells(cells)).not.toBe(digestSpecCells([{ ...cells[0]!, baseValue: 3 }, cells[1]!]));
    expect(fnv1a("")).toMatch(/^[0-9a-f]{8}$/); // 金丝雀：函数活着（空串也有确定值）
  });

  it("D2 · today(c) 与 runDerivations 同口径：round(...,6)；译不出/非有限 ⇒ undefined（判不了≠0）", () => {
    expect(todayOfSpecCell("COALESCE(this.demandDelta * 100, 0)", { demandDelta: 0.6 })).toBe(60);
    expect(todayOfSpecCell("this.qty / 3", { qty: 1 })).toBe(0.333333);
    expect(todayOfSpecCell("SUM(in(some_link).qty)", {})).toBeUndefined(); // 聚合 DSL 不译 ⇒ 判不了
    expect(todayOfSpecCell("COALESCE(this.nonexistent, 0)", {})).toBe(0);   // 缺格 ⇒ fallback 0（与规格层同口径）
  });

  it("D1 · 键式与既有登记表同式：`类型|量纲`（不许改口径）", () => {
    expect(specCellKey("Order", "demandPressure")).toBe("Order|demandPressure");
    expect(Object.keys(STATE_VAR_VALUE_REFS).every((k) => k.includes("|"))).toBe(true);
  });

  /**
   * ── E3 · 归属随规格库走（D1 的**活体判据**）· 真 Fastify 实例 + 真仓储写入 ──────────────
   *
   * 咬的是**链路**，不是函数（本仓假绿第 9 形态：实现有、测试有、且是绿的，而链路是断的）：
   *   真播种（对象 + PUBLISHED 规则 + ACTIVE 规格 + 播种期全量初算）
   *     → **真路由** `POST /a/v1/sim/sessions`（空 body ⇒ 服务端从真实对象派生世界）
   *     → **真仓储写** `repos.derivationSpecs.put(status:"RETIRED")`（PRD §四 E3：今天没有 REST 面
   *        能改 `DerivationSpec.status`，本单不新增治理路由 —— 所以这条腿只能经仓储真写）
   *     → **真路由** `GET …/:id/world`（`baseFreshness.evaluatedCellCount` 就是索引 size）
   *     → **真路由** `POST …/:id/tick` ×5 ⇒ 逐格比对两个会话的 tick5。
   *
   * 三条 Y（全部可预言，缺一条就退一档）：
   *   ① `evaluatedCellCount` **25 → 24**（同一会话、同一路由，唯一变量是规格状态）；
   *   ② 减少的键**恰为** `Order|demandPressure`（不是「少了一个」，是「少的是哪一个」）；
   *   ③ T5 **逐位等于** R5 —— R = 规格**从一开始就** RETIRED 的对照会话，两会话世界同一份。
   *   反向否证（老代码的指纹）：T5 **恒等于** K5（K = 全程 ACTIVE 臂）⇒ D1 没落地。
   *
   * ⚠ 对照臂 R 为什么不走「空 body 建会话」：那条路在 RETIRE 之后**会红**——`deriveSeedBaseSnapshot`
   *   的绑定校验（`specRefDiffs` ⇒ brokenRefs）发现「登记了 valueRef 的格，索引里没有」⇒
   *   当场抛 `valueRef 绑定断裂`（这是 WO-SIM-REAL-DATA §3 的既有不变量：⛔ 不许静默回落哈希）。
   *   本用例**把这条边界当场量下来**（不是绕开不提），再从**同源** `baseSnapshot` 显式建 R
   *   —— 世界逐字节相同，唯一差别是 R 的每一拍都在 RETIRED 索引下跑。
   * ⚠ 本文件此前零 `makeApp`：本用例会让它开始付真播种的钱。这是 PRD §四 E3 点名要的代价。
   */
  it("E3 · 归属随规格库走（真 Fastify + 真仓储）：RETIRE ⇒ `evaluatedCellCount` 25→24、减少键恰为 `Order|demandPressure`；T5 ≡ R5 且 ≠ K5", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    // 与生产播种序列同序（`server.ts` / `seed-cli.ts`）：编译规格 → 播种期全量初算 → 再铺世界。
    await seedDemoDerivationSpecs(t.repos, t.services.ontologyCore, t.services.governance, t.adminCtx);
    await recomputeDemoDerivationsAtSeed(t.repos, t.services.ontologyCore, t.adminCtx);

    const createSession = async (payload: Record<string, unknown>): Promise<SimSession> => {
      const r = await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload });
      expect(r.statusCode, `建会话失败：${r.body}`).toBe(201);
      return r.json() as SimSession;
    };
    const worldOf = async (id: string): Promise<{ tick: number; state: TickState; baseFreshness: { state: string; evaluatedCellCount: number } }> => {
      const r = await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${id}/world`, headers: ADMIN });
      expect(r.statusCode, `读世界失败：${r.body}`).toBe(200);
      return r.json() as { tick: number; state: TickState; baseFreshness: { state: string; evaluatedCellCount: number } };
    };
    const tickN = async (id: string, n: number): Promise<void> => {
      const r = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${id}/tick`, headers: ADMIN, payload: { n } });
      expect(r.statusCode, `推拍失败：${r.body}`).toBe(200);
    };
    /** 生产路由装配索引的**同一处调用**（`app.ts` 的 `simSpecCellIndex` 一字不差）。 */
    const indexNow = async () =>
      specCellIndexFor(t.repos, "demo", worldCellKeys(await t.repos.sim.listPropagationRules("demo", true)));

    // ── ① 规格 ACTIVE：真路由建两个会话（K = 全程 ACTIVE 对照臂；T = 待退役臂）────────────
    const K = await createSession({});
    const T = await createSession({});
    expect(cellCount(K.baseSnapshot)).toBeGreaterThan(0); // 金丝雀：世界非空（空世界下"逐位相同"没有意义）
    expect(T.baseSnapshot).toEqual(K.baseSnapshot); // 两会话同源同值 —— 后面所有的差都不是「世界起点不同」造成的
    const idxActive = await indexNow();
    expect(idxActive.size).toBe(25); // ② 的前置：退役**之前**确实是 25
    expect([...idxActive.keys()]).toContain("Order|demandPressure"); // 金丝雀：待退役那一格真在索引里
    const kWorld0 = await worldOf(K.id); // 读一次世界：路由那个数就是唯一入口的数
    expect(kWorld0.baseFreshness.evaluatedCellCount).toBe(idxActive.size);
    await tickN(K.id, 5); // K 臂 5 拍全在 ACTIVE 索引下跑
    const k5 = await worldOf(K.id);
    expect(k5.tick).toBe(5); // K5 是**推过 5 拍之后**读的（拿 tick0 去比是拿起点比终点，差必然非零 ⇒ 反向否证变恒真）

    // ── ② 真仓储写入 RETIRE（今天没有 REST 面能改 status，PRD §四 E3 明写经仓储真写）──────
    const before = (await t.repos.derivationSpecs.list("demo")).find((s) => s.specKey === "order_demand_pressure");
    expect(before?.status).toBe("ACTIVE"); // 金丝雀：改之前它确实是我要改的那一档
    await t.repos.derivationSpecs.put({ ...before!, status: "RETIRED" });

    // ── ③ Y①+Y②：同一会话再读 ⇒ 25 → 24，减少的键恰为 `Order|demandPressure` ────────────
    const tRetired = await worldOf(T.id);
    expect(tRetired.baseFreshness.evaluatedCellCount).toBe(24);
    const idxRetired = await indexNow();
    expect(idxRetired.size).toBe(24);
    expect(tRetired.baseFreshness.evaluatedCellCount).toBe(idxRetired.size); // 路由读数 = 唯一入口读数（不是两条算径）
    expect([...idxActive.keys()].filter((k) => !idxRetired.has(k))).toEqual(["Order|demandPressure"]); // Y②
    expect([...idxRetired.keys()].filter((k) => !idxActive.has(k))).toEqual([]); // 反向：退役**不许**换进来别的格

    // ── ④ 边界：RETIRE 之后「空 body 建会话」这条路会红（绑定断裂守卫活着）───────────────
    const denied = await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: {} });
    expect(denied.statusCode).toBe(500);
    expect(denied.body).toContain("valueRef 绑定断裂");

    // ── ⑤ 对照臂 R：规格**从一开始就** RETIRED（世界取自同源 T.baseSnapshot，逐字节同一份）──
    const R = await createSession({ baseSnapshot: T.baseSnapshot });
    expect(R.baseSnapshot).toEqual(T.baseSnapshot); // 金丝雀：对照臂的世界 = T 的起点（不是另编一份）

    // ── ⑥ Y③ + 反向否证：T5 ≡ R5（逐位），且 T5 ≠ K5（老代码的指纹是恒等）────────────────
    await tickN(T.id, 5);
    await tickN(R.id, 5);
    const t5 = await worldOf(T.id);
    const r5 = await worldOf(R.id);
    expect(t5.tick).toBe(5);
    expect(r5.tick).toBe(5);
    expect(cellCount(t5.state)).toBeGreaterThan(0); // 金丝雀：两个世界都真铺了格
    expect(diffCells(t5.state, r5.state)).toEqual([]); // Y③：逐位相同（空数组 = 零格差）
    expect(t5.state).toEqual(r5.state);
    const tVsK = diffCells(t5.state, k5.state);
    expect(tVsK.length, `RETIRE 必须让轨迹真的分叉（否则 D1 没落地）：差格=${tVsK.join(",") || "（无）"}`).toBeGreaterThan(0);
  });
});
