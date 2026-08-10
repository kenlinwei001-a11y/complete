import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import {
  CHAIN_LEAD_TIME_METRICS,
  CHAIN_SETTLEMENT_NODE_IDS,
  chainCashConversionDays,
  chainDeliveryLeadTimeDays,
  chainSettlementDays,
  isDeliveryStep,
  isSettlementNodeId,
} from "@platform/contracts";
import type { ChainLossResult } from "../src/solvers/chain-loss.js";

/**
 * WO-LEADTIME-SPLIT · 「全链前置期」拆成两个不合成指标的门（仓主 2026-08-09 裁决）。
 *
 * ── 裁决前的形态（这个门要防止它复活）────────────────────────────────────
 * `totals.leadTimeDays` = 所有节点之和，账期（`Customer.termDays` = 60 天）混在里面。
 * seed 42 · 锚点 SO-3391 实测：全链 85.39 天里账期独占 60 天（占非增值时长 71.3%），
 * 而整条产线十道工序的作业 + 换型加起来才 1.55 天。
 * ⇒ 生产侧任何改进摊进这个数都几乎看不见，而沙盘正是给生产/供应链侧做决策用的。
 *
 * ── 这个文件咬三件事（全部在**效果层**：断言的是"数会不会变"，不是"函数被调用了"）──
 *  ① **两个指标不得相等**（相等 = 有人又把它们合并了）。
 *     ⚠ 前置条件必须先自证：本数据集的账期 > 0。若账期恰为 0，两数天然相等，
 *     那条数据不适合做这个断言 —— 故本门**先断言账期 > 0**，再断言两者不等。
 *     （不放宽断言去迁就数据，这是 WO 判据的原话。）
 *  ② **改账期只动现金周转期**（本单的灵魂断言）：把 `Customer.termDays` 改一个值 →
 *     现金周转期真变，而交付前置期 / 增值 / 非增值 / 流动效率 / 整张归因表**逐位不变**。
 *     这条比"两数不等"强得多：它咬的是**因果隔离**，不是某一次的取值。
 *  ③ **口径恒等式**：现金周转期 === 交付前置期 + 结算段，且结算段 === 账期段之和。
 *
 * ── 变异反证（交付说明记录了实测红/绿原文）────────────────────────────────
 * 把 `chain-loss.ts` 的分流退回合成（`deliverySteps = steps`，即账期重新进交付前置期）
 * → ① 与 ② 必须双双变红。还绿 = 这个门测的不是这件事。
 */

const ADMIN: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
const SOLVER_KEY = "chain_loss_attribution";

const run = (t: TestApp, args: Record<string, unknown> = {}) =>
  t.services.solvers.invoke(ADMIN, SOLVER_KEY, args) as unknown as Promise<ChainLossResult>;

/** 把锚点客户的账期改成 `days`，返回改前的值（供还原/对照）。 */
async function setAnchorTermDays(t: TestApp, custId: string, days: number): Promise<number> {
  const rows = await t.repos.objects.listByType(ADMIN.tenantId, "Customer");
  const row = rows.find((o) => String(o.props.custId) === custId);
  if (row === undefined) throw new Error(`测试前置条件不成立：找不到 Customer ${custId}`);
  const before = Number(row.props.termDays);
  await t.repos.objects.put({ ...row, props: { ...row.props, termDays: days } });
  return before;
}

describe("WO-LEADTIME-SPLIT · 交付前置期 / 现金周转期 两个不合成的指标", () => {
  // ════════════════════════════════════════════════════════════════════════
  // ① 两个指标不得相等（先自证账期 > 0，否则这条断言在本数据集上无意义）
  // ════════════════════════════════════════════════════════════════════════
  it("① 交付前置期 !== 现金周转期（且先自证本数据集账期 > 0 —— 账期为 0 的数据不适合做这条断言）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const r = await run(t);

    // 前置条件（数据适格性）：结算段必须真的 > 0，否则两数天然相等，断言变成空转。
    expect(
      r.totals.settlementDays,
      "本数据集结算段（账期）为 0 ⇒ 两个指标天然相等，这条数据不适合做本断言（换一条，别放宽断言）",
    ).toBeGreaterThan(0);

    // 本体断言：两个指标必须是两个数。
    expect(
      r.totals.deliveryLeadTimeDays,
      `交付前置期 == 现金周转期（都是 ${r.totals.deliveryLeadTimeDays}）⇒ 有人又把两个指标合并了`,
    ).not.toBe(r.totals.cashConversionDays);
    expect(r.totals.cashConversionDays).toBeGreaterThan(r.totals.deliveryLeadTimeDays);

    // 口径恒等式：现金周转期 = 交付前置期 + 结算段（分解关系，不是替代关系）。
    expect(r.totals.cashConversionDays).toBeCloseTo(r.totals.deliveryLeadTimeDays + r.totals.settlementDays, 9);
    // 结算段 = `cash.steps` 之和（单列块与总数对得上，不许两处各算各的）。
    expect(r.cash.steps.reduce((a, s) => a + s.days, 0)).toBeCloseTo(r.totals.settlementDays, 9);
    // 结算段里必须真有账期那一段（否则"结算段>0"可能来自别的东西，断言指错对象）。
    expect(r.cash.steps.map((s) => s.nodeId).every(isSettlementNodeId), "cash 块混进了非结算段节点").toBe(true);
    expect(r.cash.steps.some((s) => s.stepId === "order.settlement_terms"), "账期段没有进 cash 块").toBe(true);
  });

  // ════════════════════════════════════════════════════════════════════════
  // ② 灵魂断言：改账期 → 只有现金周转期动，交付侧一字不变
  // ════════════════════════════════════════════════════════════════════════
  it("② 灵魂断言：termDays 60 → 90 ⇒ 现金周转期 +30，交付前置期/增值/非增值/流动效率/归因表**逐位不变**", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const before = await run(t);
    const custId = before.anchor.customerId;
    expect(custId, "锚点订单挂不到客户 ⇒ 本用例的前提不成立（不是被测代码的问题，先修种子）").not.toBeNull();

    const oldTerm = await setAnchorTermDays(t, custId!, 90);
    expect(oldTerm, "种子里锚点客户的账期应为 60（口径基线变了要同步改本断言）").toBe(60);

    const after = await run(t);

    // ── 现金侧：必须真变，且变化量 == 账期变化量（30 天），一天不多一天不少 ──
    expect(after.totals.settlementDays - before.totals.settlementDays).toBeCloseTo(30, 9);
    expect(after.totals.cashConversionDays - before.totals.cashConversionDays).toBeCloseTo(30, 9);

    // ── 交付侧：**逐位不变**（这才是拆分的意义 —— 账期与生产决策彻底解耦）──
    expect(
      after.totals.deliveryLeadTimeDays,
      `改账期把交付前置期也带动了（${before.totals.deliveryLeadTimeDays} → ${after.totals.deliveryLeadTimeDays}）⇒ 两个指标仍在混算`,
    ).toBe(before.totals.deliveryLeadTimeDays);
    expect(after.totals.valueAddDays, "改账期动了增值天数").toBe(before.totals.valueAddDays);
    expect(after.totals.nonValueDays, "改账期动了损失分母 ⇒ 账期仍在分母里").toBe(before.totals.nonValueDays);
    expect(after.totals.flowEfficiency, "改账期动了流动效率 ⇒ 分母仍是含账期的那个数").toBe(before.totals.flowEfficiency);

    // 整张归因表逐位不变 —— 一个百分点都不许飘（账期若在分母里，这里每一行都会变）。
    expect(after.attribution, "改账期动了损失归因表 ⇒ 账期仍在归因分母里，生产侧占比被它压着").toEqual(before.attribution);
    // 守恒律在两次运行里都成立（分母收窄不破坏 Σ==100）。
    for (const r of [before, after]) expect(r.conservation.ok, `守恒未通过：residual=${r.conservation.residual}`).toBe(true);

    // 还原后必须回到原值（确定性 R6：同输入同输出，改回去就该一模一样）。
    await setAnchorTermDays(t, custId!, oldTerm);
    const restored = await run(t);
    expect(restored.totals.cashConversionDays).toBe(before.totals.cashConversionDays);
    expect(restored.totals.deliveryLeadTimeDays).toBe(before.totals.deliveryLeadTimeDays);
  });

  // ════════════════════════════════════════════════════════════════════════
  // ③ 口径元数据与分类表：不许有第二套定义，也不许悄悄改分类
  // ════════════════════════════════════════════════════════════════════════
  it("③ 口径定义单一出处：结算段分类表钉死，两个指标的起点/终点/含不含账期写在契约里", () => {
    // 分类表钉死 —— "多加一个结算段节点"这件事无法在不惊动任何人的情况下发生。
    expect([...CHAIN_SETTLEMENT_NODE_IDS].sort()).toEqual(["order.cash", "order.settlement"]);
    // 生产段一律不许被判成结算段（反向守，防有人把 material.* 也塞进去把交付前置期掏空）。
    for (const id of ["capacity.aging", "material.replenish", "material.iqc", "capacity.op.OP-001", "demand.consensus"]) {
      expect(isSettlementNodeId(id), `${id} 被判成结算段 ⇒ 交付前置期会被掏空`).toBe(false);
      expect(isDeliveryStep({ nodeId: id })).toBe(true);
    }
    // 口径元数据：两个指标的终点必须不同，且只有现金口径含账期。
    expect(CHAIN_LEAD_TIME_METRICS.delivery.includesPaymentTerms).toBe(false);
    expect(CHAIN_LEAD_TIME_METRICS.cash.includesPaymentTerms).toBe(true);
    expect(CHAIN_LEAD_TIME_METRICS.delivery.to).not.toBe(CHAIN_LEAD_TIME_METRICS.cash.to);
  });

  it("③.2 契约三函数自洽：现金周转期 === 交付前置期 + 结算段（纯函数层再断一次，绕过求解器）", () => {
    const steps = [
      { stepId: "s1", nodeId: "capacity.op.OP-001", kind: "work" as const, days: 2, valueAdd: true },
      { stepId: "s2", nodeId: "material.replenish", kind: "handoff" as const, days: 5, valueAdd: false },
      { stepId: "s3", nodeId: "order.cash", kind: "queue" as const, days: 60, valueAdd: false },
      { stepId: "s4", nodeId: "order.settlement", kind: "queue" as const, days: 3, valueAdd: false },
    ];
    expect(chainDeliveryLeadTimeDays(steps)).toBe(7); // 2 + 5，账期与开票都不进
    expect(chainSettlementDays(steps)).toBe(63); // 60 + 3
    expect(chainCashConversionDays(steps)).toBe(70);
    expect(chainCashConversionDays(steps)).toBe(chainDeliveryLeadTimeDays(steps) + chainSettlementDays(steps));
  });

  // ════════════════════════════════════════════════════════════════════════
  // ④ 返回体不许再出现裸的 `leadTimeDays`（纪律 ① 的机器化）
  // ════════════════════════════════════════════════════════════════════════
  it("④ totals 里不许再有裸的 leadTimeDays —— 每个消费方必须显式选一个口径", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const r = await run(t);
    expect(
      Object.keys(r.totals),
      "totals 里又出现了 leadTimeDays（一个没有主语的数）⇒ 谁看都以为是自己要的那个，正是本单要根治的形态",
    ).not.toContain("leadTimeDays");
    expect(Object.keys(r.totals)).toEqual(
      expect.arrayContaining(["deliveryLeadTimeDays", "cashConversionDays", "settlementDays"]),
    );
    // 摘要里两个指标都必须点名（不许出现无主语的「全链 N 天」）。
    expect(r.summary).toContain(CHAIN_LEAD_TIME_METRICS.delivery.label);
    expect(r.summary).toContain(CHAIN_LEAD_TIME_METRICS.cash.label);
  });
});
