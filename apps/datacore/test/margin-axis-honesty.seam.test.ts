import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { makeApp, debugUser } from "./helpers.js";
import { ParetoAssembleResultSchema, type ParetoAssembleResult } from "@platform/contracts";

/**
 * WO-MARGIN-AXIS-HONESTY · 毛利轴的**第 4 张准入证**（`denomCoherent`）接缝门。
 *
 * ══ 今天的行为是 X，应该是 Y ══════════════════════════════════════════════════
 *
 * **X（开工实测）**：营收侧与成本侧各是一个**单价类强度量**，被同一个 `qty` 乘完相减，
 *   而两格在本体上**只声明了币种**（都写「元」），**没有一格声明「每什么」**。
 *   `currencyScaleOf` 读的是币种串 ⇒ 两边都是「元」⇒ 判「已对齐」⇒ 减法照做。
 *   demo 租户实测：`unitPrice` 的分母是**套**、`unitCost` 的分母是**电芯**，
 *   比值 25.7×–40.6× 且**逐型号不同** ⇒ 被扭曲的不只是绝对值，是**排序**，
 *   而排序正是这根轴唯一要回答的东西。整条链上没有一处看得见这个差，一路活到屏上。
 *
 * **Y**：币种相同**不构成**可相减的证据。要相减，还得两侧的**分母**同时
 *   ① 被声明、② 相等。缺声明就是**不知道**，不知道就不许当成"相同"——
 *   此时毛利**暂退回 `unavailableObjectives` 并带原因串**，绝不给一个静默算错的数。
 *
 * ══ 这道门咬的是链路不是函数 ═══════════════════════════════════════════════════
 * 全程走 **HTTP 路由**（`app.inject`），不直调 `assembleParetoModel()` ——
 * 只测装配函数是本仓记过的假绿第 9 形态（「实现有、测试有、且是绿的，零生产调用方」）。
 *
 * ══ R14 反硬编码：本门的本体里**没有一个电池字样** ════════════════════════════════
 * 类型叫 `TicketOrder`/`Coach`，字段叫 `pricePerUnit`/`servePerUnitCost`。
 * 判据若哪天偷偷硬编 `unitPrice`/`unitCost`，本门当场红。
 *
 * ⛔ 本门**不新增门脚本、不新增基线 JSON、不改任何金值**（禁令 3）。
 */

const T = "acme";
const ACME = debugUser(T, "admin", "admin");

type App = Awaited<ReturnType<typeof makeApp>>;

const putType = (
  t: App,
  key: string,
  props: { propKey: string; dataType: string; isPrimaryKey?: boolean; unit?: string }[],
) =>
  t.repos.ontologyTypes.put({
    id: `ot_${T}_${key}`, tenantId: T, key, displayName: key, domain: "x", version: 1, status: "ACTIVE",
    derivedProperties: [], sourceBindings: [],
    properties: props.map((p) => ({ isPrimaryKey: false, ...p })) as never,
  });

const putObj = (t: App, type: string, id: string, props: Record<string, unknown>) =>
  t.repos.objects.put({ origin: { type: "MANUAL" }, id, tenantId: T, type, props });

const enableSim = (t: App) =>
  t.app.inject({ method: "PUT", url: `/a/v1/tenants/${T}/features`, headers: ACME, payload: { overrides: { "sim.sandbox": true } } });

const assemble = async (t: App) => {
  const r = await t.app.inject({ method: "POST", url: "/a/v1/sim/optimize-pareto/assemble", headers: ACME, payload: {} });
  return { statusCode: r.statusCode, body: r.body, json: r.statusCode === 200 ? (JSON.parse(r.body) as ParetoAssembleResult) : undefined };
};

/**
 * 售票世界·**跨分母形态**：营收侧与成本侧**都是订单上的单价类强度量**
 * （`pricePerUnit` 命中 revenue∩unitRate ⇒ role `unit_revenue`；
 *  `servePerUnitCost` 命中 cost∩unitRate ⇒ role `unit_cost`），
 * 这正是「一个差被同一个 `qty` 同时乘进两侧、然后相减」的那个形态。
 *
 * `refundCost` 命中 cost 但**不**命中 unitRate ⇒ 走 penalty，不与成本那格抢角色。
 *
 * @param priceUnit / @param costUnit 两侧的单位声明 —— **本门唯一的自变量**。
 */
async function seedCrossDenomWorld(t: App, priceUnit: string, costUnit: string): Promise<void> {
  await putType(t, "TicketOrder", [
    { propKey: "ticketNo", dataType: "string", isPrimaryKey: true },
    { propKey: "seatQty", dataType: "number", unit: "件" },
    { propKey: "pricePerUnit", dataType: "number", unit: priceUnit },
    { propKey: "servePerUnitCost", dataType: "number", unit: costUnit },
    { propKey: "refundCost", dataType: "number", unit: "元" },
  ]);
  await putType(t, "Coach", [
    { propKey: "coachId", dataType: "string", isPrimaryKey: true },
    { propKey: "seatCapacity", dataType: "number", unit: "dimensionless" },
    { propKey: "runCostWan", dataType: "number", unit: "万元" },
  ]);
  // 比值**逐单不同**（100/4=25、100/2.5=40、90/3=30、60/4=15）——刻意复刻 demo 租户
  // 「比值逐行不同 ⇒ 名次也被扭曲」那一态，好让原因串里的 `distinct > 1` 分支被真的走到。
  const orders: [string, number, number, number, number][] = [
    ["o-small", 2, 100, 4, 5], ["o-big", 20, 100, 2.5, 40], ["o3", 15, 90, 3, 30], ["o4", 6, 60, 4, 10],
  ];
  for (const [id, seatQty, pricePerUnit, servePerUnitCost, refundCost] of orders) {
    await putObj(t, "TicketOrder", id, { ticketNo: id, seatQty, pricePerUnit, servePerUnitCost, refundCost });
  }
  const coaches: [string, number, number][] = [["c1", 20, 5], ["c2", 10, 3], ["c3", 30, 7]];
  for (const [id, seatCapacity, runCostWan] of coaches) {
    await putObj(t, "Coach", id, { coachId: id, seatCapacity, runCostWan });
  }
}

/**
 * **反向对照的世界**：营收侧仍是单价（`unit_revenue`），但订单上**没有**单价类成本格 ——
 * 成本只有「按指派那一笔」（`Coach.runCostWan`）。此时没有"两个计价基相减"这回事，
 * 毛利**必须照旧是真轴**。这个世界是本门不做成「无差别下架」的判据。
 */
async function seedAssignCostOnlyWorld(t: App): Promise<void> {
  await putType(t, "TicketOrder", [
    { propKey: "ticketNo", dataType: "string", isPrimaryKey: true },
    { propKey: "seatQty", dataType: "number", unit: "件" },
    { propKey: "pricePerUnit", dataType: "number", unit: "元" },
    { propKey: "refundCost", dataType: "number", unit: "元" },
  ]);
  await putType(t, "Coach", [
    { propKey: "coachId", dataType: "string", isPrimaryKey: true },
    { propKey: "seatCapacity", dataType: "number", unit: "dimensionless" },
    { propKey: "runCostWan", dataType: "number", unit: "万元" },
  ]);
  const orders: [string, number, number, number][] = [
    ["o-small", 2, 100, 5], ["o-big", 20, 100, 40], ["o3", 15, 90, 30], ["o4", 6, 60, 10],
  ];
  for (const [id, seatQty, pricePerUnit, refundCost] of orders) {
    await putObj(t, "TicketOrder", id, { ticketNo: id, seatQty, pricePerUnit, refundCost });
  }
  const coaches: [string, number, number][] = [["c1", 20, 5], ["c2", 10, 3], ["c3", 30, 7]];
  for (const [id, seatCapacity, runCostWan] of coaches) {
    await putObj(t, "Coach", id, { coachId: id, seatCapacity, runCostWan });
  }
}

/** 只取"轴的去向"这一个投影做指纹 —— 与措辞无关，改文案不会让它假红。 */
function axisFingerprint(j: Extract<ParetoAssembleResult, { applicable: true }>): { on: string[]; off: string[]; hash: string } {
  const on = j.request.objectives.map((o) => o.key);
  const off = (j.request.unavailableObjectives ?? []).map((g) => g.key).sort();
  const hash = createHash("sha256").update(JSON.stringify({ on, off })).digest("hex").slice(0, 16);
  return { on, off, hash };
}

async function assembleOk(t: App): Promise<Extract<ParetoAssembleResult, { applicable: true }>> {
  const a = await assemble(t);
  expect(a.statusCode, a.body).toBe(200);
  const parsed = ParetoAssembleResultSchema.parse(a.json) as ParetoAssembleResult;
  expect(parsed.applicable, parsed.applicable === false ? parsed.note : "").toBe(true);
  return parsed as Extract<ParetoAssembleResult, { applicable: true }>;
}

describe("G-UNIT-MARGIN-CROSS-DENOM · 毛利轴第 4 张准入证：币种同 ≠ 可相减", () => {
  it("⓪ 金丝雀：装置先自证有鉴别力（读数会随本体声明而动，不是一个恒定回包）", async () => {
    const t = await makeApp();
    await enableSim(t);
    // 先证明这套装置真的接到了"两侧都是单价"那条路 —— 接不到的话下面每一条都是空转。
    await seedCrossDenomWorld(t, "元", "元");
    const j = await assembleOk(t);
    const roleMap = Object.fromEntries(j.roles.map((r) => [r.role, r.ref]));
    expect(roleMap.unit_revenue, "营收没走 unit_revenue ⇒ 本门测的不是「两个单价相减」那个形态").toBe("TicketOrder.pricePerUnit");
    expect(roleMap.unit_cost, "成本没走 unit_cost ⇒ 跨分母风险根本不成立，下面的报缺是「因为别的原因」").toBe("TicketOrder.servePerUnitCost");
    expect(roleMap.penalty, "违约金被成本格抢走了 ⇒ 角色分配变了，本门在测别的东西").toBe("TicketOrder.refundCost");
    // 鉴别力：同一套装置换一个本体声明，指纹必须**改变**。恒定 ⇒ 读数取法没咬住任何东西。
    const t2 = await makeApp();
    await enableSim(t2);
    await seedCrossDenomWorld(t2, "元/kWh", "元/kWh");
    const j2 = await assembleOk(t2);
    const [f1, f2] = [axisFingerprint(j), axisFingerprint(j2)];
    console.log("金丝雀 指纹A(元,元) =", f1.hash, f1.on, "| 指纹B(元/kWh,元/kWh) =", f2.hash, f2.on);
    expect(f1.hash, "两种本体声明得到同一个指纹 ⇒ 读数取法无鉴别力，后面的结论一个都不能信").not.toBe(f2.hash);
  });

  it("① 对照实验·今天这一态（两侧都只声明币种）⇒ 毛利**退回报缺**且带原因串", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedCrossDenomWorld(t, "元", "元");
    const j = await assembleOk(t);
    const f = axisFingerprint(j);
    console.log("実験① 修后 指纹 =", f.hash, " objectives =", f.on, " unavailable =", f.off);

    expect(j.request.objectives.some((o) => o.key === "margin"), "两侧分母都没声明却算出了毛利 ⇒ 第 4 张准入证形同虚设").toBe(false);
    const gap = (j.request.unavailableObjectives ?? []).find((g) => g.key === "margin");
    expect(gap, "毛利既不在 objectives 也不在报缺清单 ⇒ 静默消失，正是本仓禁止的那一种").toBeDefined();

    // ── 原因串是**打给用户看的**：业务事实要给，实现细节不许出现（R-UI-4）──────────
    const reason = gap!.reason;
    expect(reason, "报缺却没有原因串 ⇒ 等于给了一个不动的 0").toBeTruthy();
    expect(reason).toMatch(/每什么|分母|计价/);
    expect(reason, "原因串里没有恢复条件 ⇒ 下一个人不知道满足什么就能放回").toMatch(/恢复条件/);
    // 业务事实必须在（字段名/单位/条数/比值）——少了它们这句话退化成"系统说算不了"。
    expect(reason).toContain("TicketOrder.pricePerUnit");
    expect(reason).toContain("TicketOrder.servePerUnitCost");
    // 比值逐单不同（25/40/30/15）⇒ 必须走"名次也会被扭曲"那一支，而不是"绝对值整体偏移"。
    expect(reason, "比值逐行不同却报成整体偏移 ⇒ 病情被说轻了").toMatch(/名次/);
    // ⛔ 禁止项：源码文件名/行号（R-UI-4）与排期语汇。
    expect(reason, "原因串泄漏了源码文件名（R-UI-4）").not.toMatch(/\.ts\b|opt-assemble|opt-binding|battery/);
    expect(reason, "原因串泄漏了行号（R-UI-4）").not.toMatch(/:\d+/);
    expect(reason, "原因串出现排期语汇（工单/本单）——那是给开发看的，不是给用户看的").not.toMatch(/工单|本单|WO-/);
  });

  it("② 反向对照：订单上没有单价类成本格 ⇒ 毛利**必须仍在 objectives**（否则是无差别下架）", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedAssignCostOnlyWorld(t);
    const j = await assembleOk(t);
    const f = axisFingerprint(j);
    console.log("実験② 反向对照 指纹 =", f.hash, " objectives =", f.on);

    const roleMap = Object.fromEntries(j.roles.map((r) => [r.role, r.ref]));
    expect(roleMap.unit_cost, "这个世界不该有 unit_cost 角色 ⇒ 装置搭错了，本条对照不成立").toBeUndefined();
    expect(j.request.objectives.map((o) => o.key), "把不含跨分母风险的租户也退了 ⇒ 这是无差别下架，不是诚实报缺")
      .toContain("margin");
    expect(j.request.objectives[0]!.key, "毛利还在，但不在打头位 ⇒ 前端散点的 X/Y 轴被换掉了").toBe("margin");
    expect((j.request.unavailableObjectives ?? []).map((g) => g.key)).not.toContain("margin");
  });

  it("③ 变异反证·两侧真同阶（都声明 元/kWh）⇒ 毛利**回到 objectives**", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedCrossDenomWorld(t, "元/kWh", "元/kWh");
    const j = await assembleOk(t);
    const f = axisFingerprint(j);
    console.log("実験③ 变异·同阶 指纹 =", f.hash, " objectives =", f.on);

    const roleMap = Object.fromEntries(j.roles.map((r) => [r.role, r.ref]));
    expect(roleMap.unit_cost, "变异后 unit_cost 角色丢了 ⇒ 轴回来的原因是别的，不是分母对齐").toBe("TicketOrder.servePerUnitCost");
    expect(j.request.args!.currencyAligned, "复合单位折不动 ⇒ 恢复条件在真实租户上不可达，判据就是一个恒假开关").toBe(true);
    expect(j.request.objectives.map((o) => o.key), "两侧分母已声明且一致，毛利却没回来 ⇒ 判据没咬住分母，只是无条件退轴")
      .toContain("margin");
    expect((j.request.unavailableObjectives ?? []).map((g) => g.key)).not.toContain("margin");
  });

  it("④ 变异反证·分母声明了但不同（元/kWh vs 元/吨）⇒ 必须**再退出去**", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedCrossDenomWorld(t, "元/kWh", "元/吨");
    const j = await assembleOk(t);
    const f = axisFingerprint(j);
    console.log("実験④ 变异·分母不同 指纹 =", f.hash, " unavailable =", f.off);

    expect(j.request.args!.currencyAligned, "币种两侧都是「元」，却判成折不齐 ⇒ 拆解把币种那半也弄丢了").toBe(true);
    expect(j.request.objectives.map((o) => o.key), "kWh 与 吨 是两个不同的分母，相减无意义，却仍出了毛利轴")
      .not.toContain("margin");
    expect((j.request.unavailableObjectives ?? []).map((g) => g.key)).toContain("margin");
  });

  it("⑤ 三态指纹 —— 判据真的挂在**分母**上，不是挂在「有没有 unit_cost」上", async () => {
    const mk = async (p: string, c: string) => {
      const t = await makeApp();
      await enableSim(t);
      await seedCrossDenomWorld(t, p, c);
      return axisFingerprint(await assembleOk(t));
    };
    const bare = await mk("元", "元");           // 都没声明分母 ⇒ 退
    const same = await mk("元/kWh", "元/kWh");   // 声明且一致 ⇒ 回
    const diff = await mk("元/kWh", "元/吨");    // 声明但不同 ⇒ 退
    console.log("実験⑤ 三态指纹：裸元 =", bare.hash, " 同分母 =", same.hash, " 异分母 =", diff.hash);
    // 「没声明」与「声明了但不同」是**两个不同的事实**，但对这根轴的处置相同 ⇒ 指纹相同。
    expect(bare.hash, "「缺声明」与「声明不同」处置不一致 ⇒ 有一态被当成了「可以相减」").toBe(diff.hash);
    // 而「声明且一致」必须与它们不同 —— 否则这个开关根本没被分母驱动。
    expect(same.hash, "三态指纹全同 ⇒ 判据与分母无关，本单的准入证是装饰品").not.toBe(bare.hash);
  });
});
