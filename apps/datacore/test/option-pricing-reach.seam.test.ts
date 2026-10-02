/**
 * WO-PRICING-REACH · **真引擎**接缝门：候选落点到订单格的跳数 vs 本次推演拍数
 *
 * ## 为什么非要有这道门（它咬的是哪一类假绿）
 *
 * `option-pricing.test.ts` 的 `mkDeps()` 把 `advanceTicks` 桩成「传了 ephemeral 就回硬编码的
 * after」。它验的是「`priceCandidate` 把临时扰动透传下去了」，**不验「扰动真的走了几跳」** ——
 * 真 `simAdvanceTicks` 在那条用例里从没被跑到过。
 *
 * 于是下面这件事在三周内没有任何东西看得见：
 * **引擎每拍只推进一跳**（`propagation.ts` 入流写 `next`、边的源读 `effState`），
 * 而 demo 世界的 `Material.shortageRisk →[material_used_by_model]→ Model.supplyRisk
 * →[model_demanded_by_order]→ Order.shortageRisk` 是**两条边**（`seed.ts` 两条 `delayTicks: 0`）。
 * ⇒ `horizon=1` 时扰动只走到 `Model` 层，而 `/pricing` 的读数只数 `Order` 格 ⇒ **逐字节恒零**，
 * 与「这个杠杆没接线 / 这条对策没用」在屏上**长得一模一样**。
 *
 * ## 这道门咬什么（判据一：对照实验，不是"跑得起来"）
 *
 * 把 X（推演拍数）从 `hops−1` 改成 `hops`，Y（回包）必须按可预言的方式变：
 * `gap HORIZON_BELOW_REACH`（读不到）→ `priced` 且订单读数**非零**（读得到）。
 * 两个数缺一个都不算交付；⛔ 跳数取**回包自报**（引擎现算），不是本文件内联的常数。
 *
 * ⚠ 本门**一处都不桩**：会话走真路由建、图与规则走 `buildPropagationInputs`（与真 tick 同一处装配）、
 * 推进走真 `simAdvanceTicks`。
 */
import { describe, expect, it } from "vitest";

import { ADMIN, makeApp, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import { seedDemoDerivationSpecs, recomputeDemoDerivationsAtSeed } from "../src/seed-derivation-specs.js";
// 「谁算推演世界的成员」的**唯一物化入口**（与 `buildPropagationInputs` 同一支）。
import { listSimWorldObjects } from "../src/sim/seed-world.js";

const SEED_CTX = { tenantId: "demo", userId: "usr_demo_admin", roles: ["admin"], attributes: {} };

const enableSim = async (t: TestApp) =>
  t.app.inject({
    method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

/**
 * 与生产播种序列同源：多跑 `seed:derivation-specs` / `seed:derivation-recompute` 两步。
 * ⛔ 少这两步，ACTIVE 派生规格为 0 ⇒ ① 查绑定一律 `NO_BINDING`，**本门会绿着什么都测不到**
 * （缺格发生在 ③.5 之前，永远走不到跳数那一步）。
 */
async function seededApp(): Promise<TestApp> {
  const t = await makeApp();
  await seedBattery(t);
  await seedDemoPropagationRules(t.repos);
  await seedDemoDerivationSpecs(t.repos, t.services.ontologyCore, t.services.governance, SEED_CTX as never);
  const materialized = await recomputeDemoDerivationsAtSeed(t.repos, t.services.ontologyCore, SEED_CTX as never);
  expect(materialized, "播种期一个对象都没物化 ⇒ 下面的世界态全是假的").toBeGreaterThan(0);
  await enableSim(t);
  return t;
}

interface PricingItem {
  candidateId: string;
  kind: string;
  reason?: string;
  fingerprint?: string;
  horizon?: number;
  control?: { touchedOrders: number; displacement: { ordersSeen: number } };
  after?: { touchedOrders: number; displacement: { ordersSeen: number } };
  disclosure: {
    tickCount: number;
    reach: { kind: string; hops?: number; visited?: number; reason?: string };
  };
}

const price = async (
  t: TestApp,
  sid: string,
  body: Record<string, unknown>,
): Promise<PricingItem[]> => {
  const r = await t.app.inject({
    method: "POST", url: `/a/v1/sim/sessions/${sid}/pricing`, headers: ADMIN, payload: body,
  });
  expect(r.statusCode, `定价路由失败：${JSON.stringify(r.json()).slice(0, 400)}`).toBe(200);
  return r.json().items as PricingItem[];
};

/**
 * 挑一个**真落点**：在推演世界成员里、带 `leadTime` 的 Material。
 *
 * 走 `listSimWorldObjects`（「谁算推演世界的成员」的**唯一物化入口**）—— ⛔ 不在测里另抄一份
 * 「for types / for listByType / if …」的判定，那就是第 N 份抄件。
 * `lever.objectId` 直接用**内部 id**：路由的 `resolveBusinessRefToObjectId` 解析不出时回落原值
 * （`resolvedObjectId ?? candidate.lever.objectId`），这条回落路径本身也该被真跑一遍。
 */
async function pickMaterial(t: TestApp): Promise<{ id: string; leadTime: number }> {
  const world = await listSimWorldObjects(t.repos, "demo");
  const inWorld = new Set(world.map(({ obj }) => obj.id));
  const mats = await t.repos.objects.listByType("demo", "Material");
  const hit = mats.find((o) => inWorld.has(o.id) && typeof o.props.leadTime === "number");
  expect(hit, "推演世界里找不到带 leadTime 的 Material ⇒ 夹具坏了，不是产品行为").toBeDefined();
  return { id: hit!.id, leadTime: hit!.props.leadTime as number };
}

const candidateFor = (m: { id: string; leadTime: number }) => ({
  candidateId: "cand_reach_seam",
  impedimentId: "imp_reach_seam",
  label: "物料·到货周期减半（接缝用）",
  lever: { objectType: "Material", objectId: m.id, prop: "leadTime", unit: "天", valueKind: "days" },
  fromValue: m.leadTime,
  toValue: m.leadTime / 2,
  join: { kind: "LOCUS_PROP", path: `material:${m.id}` },
  rungKind: "THRESHOLD",
  rungSource: "接缝门固定档（引 RULE_GATE 之外的档位来源）",
  effectKind: "DOWNSTREAM_ONLY",
  dims: [
    { key: "breach", label: "物料缺口压力", value: 5, baseline: 10, unit: "天", betterWhen: "lower", dataMode: "SYNTHETIC" },
  ],
  provenance: { solverKey: "chain_impediments", formula: "this.leadTime", inputs: ["Material.leadTime"] },
  dataMode: "SYNTHETIC",
});

/**
 * 会话 baseSnapshot：给该 Material 一格真源 —— ③（落点格必须已存在）与 ④（扰动落笔处）都吃它。
 * ⛔ 不铺全量世界：本门要的是「同一落点、两个拍数」的对照，不是世界的规模。
 */
async function newSessionWith(t: TestApp, m: { id: string }): Promise<string> {
  const created = await t.app.inject({
    method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN,
    payload: { baseSnapshot: { [m.id]: { shortageRisk: 40 } } },
  });
  expect(created.statusCode, "建会话失败").toBe(201);
  return created.json().id as string;
}

describe("WO-PRICING-REACH · 落点→订单格跳数 × 推演拍数（真引擎接缝）", () => {
  it("h < 跳数 ⇒ 诚实缺格；h ≥ 跳数 ⇒ 真读数且非零（同一次推演的两个拍数，缺一不算交付）", async () => {
    const t = await seededApp();
    const m = await pickMaterial(t);
    const sid = await newSessionWith(t, m);
    const cand = candidateFor(m);

    // ── ① 先问一次最短的（h=1），把**引擎自报的跳数**读出来 —— 后面所有判据都用它，⛔ 不内联常数 ──
    const short = await price(t, sid, { horizon: 1, candidates: [cand] });
    const it0 = short[0]!;
    expect(it0.disclosure.reach.kind, "落点必须在图里，否则本门什么都没测到").toBe("reachable");
    const hops = it0.disclosure.reach.hops!;
    // 金丝雀：demo 种子里 `Material.shortageRisk→Model.supplyRisk→Order.shortageRisk` 是**两条**边。
    // 若这个世界有一天变成 1 跳可达，本门**当场失去鉴别力**（h=1 就能读到数），必须报出来而不是静默变绿。
    expect(hops, "demo 世界到订单的跳数不是 2 ⇒ 本门的判据前提变了，先核对种子再改期望").toBe(2);

    // ── ② h = hops − 1：必须**显式缺格**，且披露里带着「为什么是零」的两个数 ──
    const gap = (await price(t, sid, { horizon: hops - 1, candidates: [cand] }))[0]!;
    expect(gap.kind).toBe("gap");
    expect(gap.reason).toBe("HORIZON_BELOW_REACH");
    expect(gap.disclosure.tickCount).toBe(hops - 1);
    expect(gap.disclosure.reach.hops).toBe(hops);
    // ⛔ 这一态**不许**带一组看起来正常的读数（那就是「读不到」冒充「读数」）
    expect(gap.after).toBeUndefined();
    expect(gap.control).toBeUndefined();

    // ── ③ h = hops：真读数，且订单侧**真的动了** ──
    const ok = (await price(t, sid, { horizon: hops, candidates: [cand] }))[0]!;
    expect(ok.kind, `h=跳数时仍读不到 ⇒ 要么引擎每拍推的跳数变了，要么这条边断了：${JSON.stringify(ok).slice(0, 300)}`).toBe("priced");
    expect(ok.disclosure.reach.kind).toBe("reachable");
    expect(ok.disclosure.reach.hops).toBe(hops);
    expect(ok.disclosure.tickCount).toBe(hops);
    // 金丝雀：订单集非空（0 ⇒ 订单遍历坏了，⛔ 不许把「没数到」读成「没波及」）
    expect(ok.after!.displacement.ordersSeen).toBeGreaterThan(0);
    expect(ok.after!.touchedOrders, "h=跳数了订单还一格不动 ⇒ 传导链没通，本门的对照实验不成立").toBeGreaterThan(0);
  });

  it("缺省 horizon（不传）⇒ 后端现算够用的拍数，直接给 priced，⛔ 不再默认 1（注定读不出东西的值）", async () => {
    const t = await seededApp();
    const m = await pickMaterial(t);
    const sid = await newSessionWith(t, m);
    const out = (await price(t, sid, { candidates: [candidateFor(m)] }))[0]!;
    expect(out.kind, "缺省时长读不出东西 ⇒ 默认值又回到了「注定为零」那一档").toBe("priced");
    expect(out.disclosure.tickCount).toBeGreaterThanOrEqual(1);
    // 缺省值必须**够用**：不低于跳数
    expect(out.disclosure.tickCount).toBeGreaterThanOrEqual(out.disclosure.reach.hops!);
  });

  it("指纹含推演拍数：换个时长再问，是**另一次提问**而不是命中上一条缓存", async () => {
    const t = await seededApp();
    const m = await pickMaterial(t);
    const sid = await newSessionWith(t, m);
    const cand = candidateFor(m);
    // 跳数先读出来（h=跳数 与 h=跳数+1 两次都必须 priced，才比得了指纹）
    const base = (await price(t, sid, { horizon: 1, candidates: [cand] }))[0]!;
    const hops = base.disclosure.reach.hops!;
    const a = (await price(t, sid, { horizon: hops, candidates: [cand] }))[0]!;
    const b = (await price(t, sid, { horizon: hops + 1, candidates: [cand] }))[0]!;
    expect(a.kind).toBe("priced");
    expect(b.kind).toBe("priced");
    expect(a.fingerprint, "同一个候选换个时长拿到同一个指纹 ⇒ 路由缓存会把上一次的答回给这一次").not.toBe(b.fingerprint);
  });
});
