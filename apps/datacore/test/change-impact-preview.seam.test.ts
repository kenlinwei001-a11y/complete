import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, debugUser } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import {
  previewChangeImpact,
  buildChangeImpactWorld,
  CHANGE_IMPACT_MAX_HOPS,
  type ChangeImpactWorld,
} from "../src/sim/change-impact.js";

/**
 * WO-CHANGE-IMPACT-PREVIEW · 验收测试。
 *
 * 头号判据 = **预览与实际一致**：预览说波及 A/B/C ⇒ 真改一次，实际变的就是 A/B/C。
 * 断言落在**两个集合的比对**（不是「函数被调用」也不是「返回非空」）：
 *   · 传导族（recompute）：预览 recompute 集合 vs 真跑 propagateTick 后的状态差分集合；
 *   · 派生族（rederive）：预览 rederive 集合 vs 真跑 runDerivations 后的派生值差分集合。
 * 另：多跳跳数（3 跳真链）· 环不无限展开 · MAX_HOPS 截断诚实位 · rejudge/rewire 两桶 ·
 * 焦点五态 · 空集不冒充「没有波及」。
 *
 * 变异反证（T1 手动跑过，报告贴原文）：把 expandStateVar 的多跳展开拆掉（hop≥1 不再入队），
 * 红在「缺 sv:*@2 / sv:*@3」——即「预览漏了第 2/3 跳」，不是「函数不存在」。
 */

const enableSim = async (t: Awaited<ReturnType<typeof makeApp>>) =>
  t.app.inject({
    method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

type PreviewBody = {
  items: { bucket: string; target: string; hops: number; via: string }[];
  unresolved: { what: string; missing: string }[];
  truncated: boolean;
};

const previewViaApi = async (
  t: Awaited<ReturnType<typeof makeApp>>,
  focus: Record<string, unknown>,
): Promise<PreviewBody> => {
  const r = await t.app.inject({
    method: "POST", url: "/a/v1/sim/change-impact-preview", headers: ADMIN,
    payload: { focus },
  });
  expect(r.statusCode).toBe(200);
  return r.json() as PreviewBody;
};

/** hop 标注的目标串——断言失败时报错信息直接指到「哪一跳的哪个目标缺了」。 */
const hopTagged = (p: PreviewBody) => p.items.map((i) => `${i.target}@${i.hops}`);

describe("WO-CHANGE-IMPACT-PREVIEW · 接线", () => {
  it("feature 关 ⇒ 404 FEATURE_NOT_FOUND（Entitlement 先于 authz）", async () => {
    const t = await makeApp();
    // ⚠ 不能用 demo 租户测「关」：demo 经 L2 行业模板（battery=all-on 减暗发排除集）已把
    // sim.* 全开（seed.ts 注记坐实：override 没有 sim.* 但模板抬上来了，只看 L1 defaultOn
    // 会得出"没开"的错结论——少追一层）。无模板租户才落到 L1 defaultOn:false。
    const r = await t.app.inject({
      method: "POST", url: "/a/v1/sim/change-impact-preview", headers: debugUser("t2", "u", "admin"),
      payload: { focus: { kind: "stateVar", objectId: "x", stateVar: "y" } },
    });
    expect(r.statusCode).toBe(404);
  });
});

describe("WO-CHANGE-IMPACT-PREVIEW · 预览与实际一致（传导族 · 真跑 propagateTick 差分）", () => {
  it("预览 recompute 集合 === 真跑 N tick 后实际变值的对象.状态变量集合", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);

    const links = await t.repos.links.list("demo", (l) => l.type === "order_for_model");
    expect(links.length).toBeGreaterThan(0);
    const { fromId: orderId } = links[0]!;

    // 预览（结构闭包）。
    const preview = await previewViaApi(t, { kind: "stateVar", objectId: orderId, stateVar: "demandPressure" });
    const previewSet = preview.items.filter((i) => i.bucket === "recompute").map((i) => i.target.slice(3)).sort();
    expect(previewSet.length).toBeGreaterThan(0);

    // 真改一次：焦点置 10（非零 ⇒ 引擎 sourceVal===0 跳过语义不介入），跑足 tick 让全闭包落地。
    const sid = (await (await t.app.inject({
      method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN,
      payload: { baseSnapshot: { [orderId]: { demandPressure: 10 } } },
    })).json()).id as string;
    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 24 } });

    // 实际集合 = 任一 tick 状态里出现且值非 0 的 (objId,stateVar)，去掉焦点本身（扰动直写，非传导）。
    const actual = new Set<string>();
    for (const ts of await t.repos.sim.listTickStates("demo", sid)) {
      for (const [objId, vars] of Object.entries(ts.state)) {
        for (const [v, val] of Object.entries(vars)) {
          if (typeof val === "number" && val !== 0) actual.add(`${objId}.${v}`);
        }
      }
    }
    actual.delete(`${orderId}.demandPressure`);
    const actualSet = [...actual].sort();

    // 🔴 头号判据：两个集合逐元素相等。任何一边多一个/少一个都红在这里。
    expect(previewSet).toEqual(actualSet);
  });

  it("多跳正确：3 跳真链（Order→Model→Base→Line）逐跳列出且跳数标对", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);

    // 沿真链路取一条完整实例链（与 live-fire 同取法）。
    const links = await t.repos.links.list("demo");
    const ofm = links.find((l) => l.type === "order_for_model")!;
    const orderId = ofm.fromId, modelId = ofm.toId;
    const mpa = links.find((l) => l.type === "model_producible_at" && l.fromId === modelId)!;
    const baseId = mpa.toId;
    const lbb = links.find((l) => l.type === "line_belongs_to_base" && l.fromId === baseId)!;
    const lineId = lbb.toId;
    expect(new Set([orderId, modelId, baseId, lineId]).size).toBe(4);

    const preview = await previewViaApi(t, { kind: "stateVar", objectId: orderId, stateVar: "demandPressure" });
    const tagged = hopTagged(preview);
    // 第 1/2/3 跳各就各位——变异反证拆多跳展开时，红的就是这三行里的 @2/@3。
    expect(tagged).toContain(`sv:${modelId}.demandLoad@1`);
    expect(tagged).toContain(`sv:${baseId}.loadIndex@2`);
    expect(tagged).toContain(`sv:${lineId}.utilPressure@3`);
  });
});

describe("WO-CHANGE-IMPACT-PREVIEW · 预览与实际一致（派生族 · 真跑 runDerivations 差分）", () => {
  it("预览 rederive 集合 === 改 Order.qty 后 runDerivations 实际变值的 对象.派生属性 集合", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);

    const order = (await t.repos.objects.listByType("demo", "Order")).find((o) =>
      typeof o.props.qty === "number" && typeof o.props.unitPrice === "number",
    );
    expect(order).toBeTruthy();
    const orderId = order!.id;

    // 先沉降一次：让所有派生值落到当前真值（否则首轮重算会把存量漂移算进差分，与焦点无关）。
    const run0 = await t.app.inject({ method: "POST", url: "/a/v1/derivations/run", headers: ADMIN });
    expect(run0.statusCode).toBe(202); // 该路由按设计返回 202 + DerivationRun
    const snapshot = async () => {
      const m = new Map<string, unknown>();
      for (const typeKey of ["Order", "Base", "Model"]) {
        for (const o of await t.repos.objects.listByType("demo", typeKey)) {
          for (const [k, v] of Object.entries(o.props)) m.set(`${o.id}.${k}`, v);
        }
      }
      return m;
    };
    const before = await snapshot();

    // 预览（prop 焦点 = 改一个普通对象属性）。
    const preview = await previewViaApi(t, { kind: "prop", objectId: orderId, propKey: "qty" });
    const previewSet = preview.items.filter((i) => i.bucket === "rederive").map((i) => i.target.slice(3)).sort();
    expect(previewSet.length).toBeGreaterThan(0);

    // 真改一次：qty +7，再跑一次派生。
    await t.repos.objects.put({ ...order!, props: { ...order!.props, qty: (order!.props.qty as number) + 7 } });
    const run1 = await t.app.inject({ method: "POST", url: "/a/v1/derivations/run", headers: ADMIN });
    expect(run1.statusCode).toBe(202);
    const after = await snapshot();

    const actual: string[] = [];
    for (const [k, v] of after) {
      if (k === `${orderId}.qty`) continue; // 焦点本身（直写，非派生）
      if (before.get(k) !== v) actual.push(k);
    }
    // 只比派生属性键（预览只承诺派生值；原始 props 不被 runDerivations 改写）。
    const derivedKeys = new Set(["value", "committedQty", "orderCount", "totalDemand", "oeeIndex"]);
    const actualSet = actual.filter((k) => derivedKeys.has(k.split(".").pop()!)).sort();

    // 🔴 同一判据的第二族实例：两个集合逐元素相等。
    expect(previewSet).toEqual(actualSet);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 纯函数层（合成世界）：环 / 保险丝 / 诚实位 / rejudge / rewire / 焦点五态
// ────────────────────────────────────────────────────────────────────────────

const baseWorld = (): ChangeImpactWorld => ({
  objects: [], links: [], propagationRules: [], derivedTypes: [], derivationSpecs: [], rules: [],
});

describe("WO-CHANGE-IMPACT-PREVIEW · 环与保险丝（纯函数）", () => {
  it("环检测：A.x→B.y→C.z→A.x 不无限展开；环上节点只列一次、焦点不被回列", () => {
    const w = baseWorld();
    w.objects = [
      { id: "a1", typeKey: "A", props: {} },
      { id: "b1", typeKey: "B", props: {} },
      { id: "c1", typeKey: "C", props: {} },
    ];
    w.links = [
      { fromId: "a1", toId: "b1", linkKey: "a_to_b" },
      { fromId: "b1", toId: "c1", linkKey: "b_to_c" },
      { fromId: "c1", toId: "a1", linkKey: "c_to_a" },
    ];
    w.propagationRules = [
      { key: "r_ab", sourceTypeKey: "A", sourceStateVar: "x", viaLinkKey: "a_to_b", targetTypeKey: "B", targetStateVar: "y" },
      { key: "r_bc", sourceTypeKey: "B", sourceStateVar: "y", viaLinkKey: "b_to_c", targetTypeKey: "C", targetStateVar: "z" },
      { key: "r_ca", sourceTypeKey: "C", sourceStateVar: "z", viaLinkKey: "c_to_a", targetTypeKey: "A", targetStateVar: "x" },
    ];
    const p = previewChangeImpact(w, { kind: "stateVar", objectId: "a1", stateVar: "x" });
    // 环的第三边（c1→a1.x）真被走到 = 环确实展开了一整圈；回列焦点被 visited 拦下 ⇒
    // 恰好两项、有限、truncated=false。若环检测失效，本断言永远不返回（展开不终止）。
    expect(hopTagged(p as PreviewBody)).toEqual([`sv:b1.y@1`, `sv:c1.z@2`]);
    expect(p.truncated).toBe(false);
  });

  it(`MAX_HOPS=${CHANGE_IMPACT_MAX_HOPS} 保险丝：35 节链 ⇒ 列到第 ${CHANGE_IMPACT_MAX_HOPS} 跳 + truncated + unresolved 点名`, () => {
    const w = baseWorld();
    const N = 35;
    for (let i = 0; i < N; i++) w.objects.push({ id: `n${i}`, typeKey: "N", props: {} });
    for (let i = 0; i < N - 1; i++) w.links.push({ fromId: `n${i}`, toId: `n${i + 1}`, linkKey: "next" });
    w.propagationRules = [
      { key: "r_next", sourceTypeKey: "N", sourceStateVar: "v", viaLinkKey: "next", targetTypeKey: "N", targetStateVar: "v" },
    ];
    const p = previewChangeImpact(w, { kind: "stateVar", objectId: "n0", stateVar: "v" });
    expect(p.truncated).toBe(true);
    expect(p.unresolved.some((u) => u.missing.includes("保险丝"))).toBe(true);
    // 截断点之前的每一跳都在（1..MAX_HOPS），没有第 MAX_HOPS+1 跳。
    const hops = p.items.map((i) => i.hops);
    expect(Math.max(...hops)).toBe(CHANGE_IMPACT_MAX_HOPS);
    expect(p.items.length).toBe(CHANGE_IMPACT_MAX_HOPS);
  });
});

describe("WO-CHANGE-IMPACT-PREVIEW · 诚实位（⛔ 空集不冒充「没有波及」）", () => {
  it("焦点对象不存在 ⇒ items 空 + unresolved 点名焦点（不是静默空集）", () => {
    const p = previewChangeImpact(baseWorld(), { kind: "stateVar", objectId: "ghost", stateVar: "x" });
    expect(p.items).toEqual([]);
    expect(p.unresolved).toHaveLength(1);
    expect(p.unresolved[0]!.what).toContain("ghost");
  });

  it("可达规则零实例 ⇒ unresolved 明说「接了线没数据」", () => {
    const w = baseWorld();
    w.objects = [{ id: "a1", typeKey: "A", props: {} }];
    // 规则 r_dead 引用 linkKey「no_such_link」：零实例。b_to_a 无出边，r_dead 从 a1.x 可达。
    w.propagationRules = [
      { key: "r_dead", sourceTypeKey: "A", sourceStateVar: "x", viaLinkKey: "no_such_link", targetTypeKey: "B", targetStateVar: "y" },
    ];
    const p = previewChangeImpact(w, { kind: "stateVar", objectId: "a1", stateVar: "x" });
    expect(p.items).toEqual([]);
    expect(p.unresolved.some((u) => u.what === "pr:r_dead" && u.missing.includes("零实例"))).toBe(true);
  });

  it("真叶子（无任何下游）⇒ items 空 + unresolved 空 = 与「算不出来」分得开", () => {
    const w = baseWorld();
    w.objects = [{ id: "a1", typeKey: "A", props: {} }];
    const p = previewChangeImpact(w, { kind: "stateVar", objectId: "a1", stateVar: "lonely" });
    expect(p.items).toEqual([]);
    expect(p.unresolved).toEqual([]);
  });

  it("派生公式解析失败 ⇒ unresolved 点名（不静默跳过）", () => {
    const w = baseWorld();
    w.objects = [{ id: "a1", typeKey: "A", props: { q: 1 } }];
    w.derivedTypes = [{ typeKey: "A", primaryKey: "id", derived: [{ propKey: "bad", formula: "q * ( +" }] }];
    const p = previewChangeImpact(w, { kind: "prop", objectId: "a1", propKey: "q" });
    expect(p.unresolved.some((u) => u.what === "A.bad" && u.missing.includes("解析失败"))).toBe(true);
  });

  it("规则表达式解析失败 ⇒ unresolved 点名「无法判定是否波及」", () => {
    const w = baseWorld();
    w.objects = [{ id: "a1", typeKey: "A", props: { q: 1 } }];
    w.rules = [{ key: "C99", expression: "A.q >>> ", scopeObjectTypes: ["A"] }];
    const p = previewChangeImpact(w, { kind: "prop", objectId: "a1", propKey: "q" });
    expect(p.unresolved.some((u) => u.what === "rule:C99")).toBe(true);
  });
});

describe("WO-CHANGE-IMPACT-PREVIEW · rejudge / rewire / 派生链（纯函数）", () => {
  it("rejudge：规则表达式引用（含 SUM() func 参数）⇒ 列出规则，hop1", () => {
    const w = baseWorld();
    w.objects = [{ id: "a1", typeKey: "A", props: { q: 5 } }];
    w.rules = [
      { key: "C01", expression: "A.q > 3", scopeObjectTypes: ["A"] },
      { key: "C02", expression: "SUM(A.q) > 100", scopeObjectTypes: ["A"] },
      { key: "C03", expression: "A.other > 1", scopeObjectTypes: ["A"] },
    ];
    const p = previewChangeImpact(w, { kind: "prop", objectId: "a1", propKey: "q" });
    const tagged = hopTagged(p as PreviewBody);
    expect(tagged).toContain("rule:C01@1");
    expect(tagged).toContain("rule:C02@1"); // func 参数里的路径也算引用
    expect(tagged).not.toContain("rule:C03@1");
  });

  it("派生链：算术同对象 hop1 → 聚合跨类型 hop2（沿 byField 匹配目标主键）", () => {
    const w = baseWorld();
    w.objects = [
      { id: "o1", typeKey: "Order", props: { qty: 2, unitPrice: 3, bases: ["b1"] } },
      { id: "b1", typeKey: "Base", props: { id: "b1" } },
    ];
    w.derivedTypes = [
      { typeKey: "Order", primaryKey: "id", derived: [{ propKey: "value", formula: "qty * unitPrice" }] },
      { typeKey: "Base", primaryKey: "id", derived: [{ propKey: "committedQty", formula: "SUM(Order.value BY bases)" }] },
    ];
    const p = previewChangeImpact(w, { kind: "prop", objectId: "o1", propKey: "qty" });
    const tagged = hopTagged(p as PreviewBody);
    expect(tagged).toEqual(["op:o1.value@1", "op:b1.committedQty@2"]);
  });

  it("DerivationSpec：dep 命中 ⇒ 反导航到目标（hop1），目标又是下游 dep ⇒ hop2", () => {
    const w = baseWorld();
    w.objects = [
      { id: "s1", typeKey: "Sup", props: { risk: 1 } },
      { id: "m1", typeKey: "Mat", props: {} },
    ];
    w.links = [{ fromId: "m1", toId: "s1", linkKey: "mat_sup" }];
    w.derivationSpecs = [
      // target=Mat, 经 mat_sup out 导航到 Sup.risk：direction=out ⇒ 目标在 fromId 侧（m1）。
      { specKey: "sp1", targetType: "Mat", targetProp: "supRisk", deps: [{ typeKey: "Sup", prop: "risk", via: "mat_sup", direction: "out" }] },
      // 链式：Mat.supRisk → 自身类型派生。
      { specKey: "sp2", targetType: "Mat", targetProp: "riskLabel", deps: [{ typeKey: "Mat", prop: "supRisk" }] },
    ];
    const p = previewChangeImpact(w, { kind: "prop", objectId: "s1", propKey: "risk" });
    const tagged = hopTagged(p as PreviewBody);
    expect(tagged).toContain("op:m1.supRisk@1");
    expect(tagged).toContain("op:m1.riskLabel@2");
  });

  it("rewire：link 焦点 ⇒ 吃这条边的传导规则 hop1 + 经它流动的值 hop1 + 下游 hop2", () => {
    const w = baseWorld();
    w.objects = [
      { id: "a1", typeKey: "A", props: {} },
      { id: "b1", typeKey: "B", props: {} },
      { id: "c1", typeKey: "C", props: {} },
    ];
    w.links = [
      { fromId: "a1", toId: "b1", linkKey: "a_b" },
      { fromId: "b1", toId: "c1", linkKey: "b_c" },
    ];
    w.propagationRules = [
      { key: "r_ab", sourceTypeKey: "A", sourceStateVar: "x", viaLinkKey: "a_b", targetTypeKey: "B", targetStateVar: "y" },
      { key: "r_bc", sourceTypeKey: "B", sourceStateVar: "y", viaLinkKey: "b_c", targetTypeKey: "C", targetStateVar: "z" },
    ];
    const p = previewChangeImpact(w, { kind: "link", linkKey: "a_b", fromId: "a1", toId: "b1" });
    const tagged = hopTagged(p as PreviewBody);
    expect(tagged).toContain("pr:r_ab@1"); // rewire：规则本身
    expect(tagged).toContain("sv:b1.y@1"); // recompute：经这条边流的值（最短跳数 = 1）
    expect(tagged).toContain("sv:c1.z@2"); // 下游
  });

  it("propagationRule 焦点 ⇒ 该规则全部实例的 target hop1 + 下游继续", () => {
    const w = baseWorld();
    w.objects = [
      { id: "a1", typeKey: "A", props: {} }, { id: "a2", typeKey: "A", props: {} },
      { id: "b1", typeKey: "B", props: {} }, { id: "b2", typeKey: "B", props: {} },
    ];
    w.links = [
      { fromId: "a1", toId: "b1", linkKey: "a_b" },
      { fromId: "a2", toId: "b2", linkKey: "a_b" },
    ];
    w.propagationRules = [
      { key: "r_ab", sourceTypeKey: "A", sourceStateVar: "x", viaLinkKey: "a_b", targetTypeKey: "B", targetStateVar: "y" },
    ];
    const p = previewChangeImpact(w, { kind: "propagationRule", ruleKey: "r_ab" });
    const tagged = hopTagged(p as PreviewBody);
    expect(tagged).toContain("sv:b1.y@1");
    expect(tagged).toContain("sv:b2.y@1");
  });

  it("derivedProp 焦点 ⇒ 该类型全部实例 hop1；类型无实例 ⇒ unresolved 诚实位", () => {
    const w = baseWorld();
    w.objects = [
      { id: "o1", typeKey: "Order", props: { qty: 2, unitPrice: 3 } },
      { id: "o2", typeKey: "Order", props: { qty: 4, unitPrice: 5 } },
    ];
    w.derivedTypes = [
      { typeKey: "Order", primaryKey: "id", derived: [{ propKey: "value", formula: "qty * unitPrice" }] },
      { typeKey: "Empty", primaryKey: "id", derived: [{ propKey: "e", formula: "1 + 1" }] },
    ];
    const p = previewChangeImpact(w, { kind: "derivedProp", typeKey: "Order", propKey: "value" });
    const tagged = hopTagged(p as PreviewBody);
    expect(tagged).toContain("op:o1.value@1");
    expect(tagged).toContain("op:o2.value@1");
    const p2 = previewChangeImpact(w, { kind: "derivedProp", typeKey: "Empty", propKey: "e" });
    expect(p2.items).toEqual([]);
    expect(p2.unresolved.some((u) => u.missing.includes("无实例"))).toBe(true);
  });
});

// ── 对抗审查（impact-reviewer）实证抖出的三个假阴性 REAL-BUG 的复发闸 ────────────
// 三处的共性：修复前都输出「items空 + unresolved空」= 谎称「焦点确为叶子」——
// 正是本单头注明令禁止的说谎诚实位。机器把守，不许重构悄悄回去。
describe("WO-CHANGE-IMPACT-PREVIEW · 对抗审查 REAL-BUG 复发闸", () => {
  // 实证 1b/1c 的世界形状（reviewer /tmp 脚本同款微世界）。
  const aggWorld = (): ChangeImpactWorld => ({
    objects: [
      { id: "o1", typeKey: "Order", props: { qty: 2, bases: ["b1"] } },
      { id: "b1", typeKey: "Base", props: { id: "b1" } },
    ],
    links: [], propagationRules: [], derivationSpecs: [], rules: [],
    derivedTypes: [
      { typeKey: "Base", primaryKey: "id", derived: [{ propKey: "committedQty", formula: "SUM(Order.qty BY bases)" }] },
    ],
  });

  it("REAL-BUG-c①：改 byField（Order.bases）⇒ 匹配集变 ⇒ committedQty 必列出", () => {
    const p = previewChangeImpact(aggWorld(), { kind: "prop", objectId: "o1", propKey: "bases" });
    expect(hopTagged(p as PreviewBody)).toContain("op:b1.committedQty@1");
  });

  it("REAL-BUG-c②：改目标主键（Base.id）⇒ 自己的目标派生值必列出", () => {
    const p = previewChangeImpact(aggWorld(), { kind: "prop", objectId: "b1", propKey: "id" });
    expect(hopTagged(p as PreviewBody)).toContain("op:b1.committedQty@1");
  });

  it("REAL-BUG-f：两段路径首段类型∉scope ⇒ resolveField 前缀回退，实际判的是 scope 类型同名 prop", () => {
    const w = baseWorld();
    w.objects = [{ id: "l1", typeKey: "Line", props: { qty: 7 } }];
    // scope=[Line] 写 "Order.qty"：运行期 scheduler 逐 scope 类型求值 + resolveField
    // 丢弃首段回退 ⇒ 实际读的是 Line.qty。预览只索 Order.qty 即漏报（假阴性实证）。
    w.rules = [{ key: "R1", expression: "Order.qty > 5", scopeObjectTypes: ["Line"] }];
    const p = previewChangeImpact(w, { kind: "prop", objectId: "l1", propKey: "qty" });
    expect(hopTagged(p as PreviewBody)).toContain("rule:R1@1");
  });

  it("REAL-BUG-装配器：非 ACTIVE 类型的对象也在预览世界里（传导图物化不过滤 status）", async () => {
    const t = await makeApp();
    // 非 ACTIVE 类型 + 实例 + 一条从它出发的传导规则。propagateTick 的图物化（propagation-inputs
    // :72）不过滤 status ⇒ 真传导图里有它；预览世界若缺 ⇒ recompute 桶假阴性。
    // ⚠ 2026-08-17 审核方改：原写 status:"DRAFT" —— **`ObjectTypeDef.status` 只有
    // `"ACTIVE" | "RETIRED"` 两个值**（`domain.ts:296/443`），"DRAFT" 是非法值，tsc 报 TS2322。
    // 追一层确认不是类型写窄了：全仓写 `status:"DRAFT"` 的 5 处**全是别的制品**
    // （`OntologyDraft` 建模草稿 · `ActionDraft` · `DataBuilderAgent`），没有一处是本体类型。
    // 本用例要的语义是「**非 ACTIVE**」，`RETIRED` 就是合法的非 ACTIVE 值，命题一字不变。
    // 这条红在 handoff 分支上**就已存在**（该分支的 domain.ts 同为两值），
    // 交单报告给了 VITEST_RC=0 21/21 却**没跑 typecheck** ——「测试绿 ≠ 类型对」的又一实例。
    await t.repos.ontologyTypes.put({
      id: "ot_ghost", tenantId: "demo", key: "Ghost", displayName: "已下线类型", domain: "x",
      version: 1, status: "RETIRED", derivedProperties: [], sourceBindings: [],
      properties: [{ propKey: "g", dataType: "number", isPrimaryKey: true }],
    });
    await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "g1", tenantId: "demo", type: "Ghost", props: { g: 1 } });
    const world = await buildChangeImpactWorld(t.repos, "demo");
    expect(world.objects.some((o) => o.id === "g1")).toBe(true);
    // 且派生族的 ACTIVE 过滤仍然成立（DRAFT 类型的 derivedProperties 不进世界）。
    expect(world.derivedTypes.some((d) => d.typeKey === "Ghost")).toBe(false);
  });
});
