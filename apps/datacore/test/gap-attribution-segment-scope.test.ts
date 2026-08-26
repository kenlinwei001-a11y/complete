import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";

/**
 * SEAM · gap_attribution 细分作用域化（WO-SEG-ATTR-SCOPE · G-SEG-ATTR-CROSS-SEGMENT）。
 * 数据半（Order.businessType/Metric.businessType 落值）× 引擎半（结构反向分摊按业态裁订单）——
 * 断在接缝不在各半：储能达成率下钻的订单叶必须**只含储能客户**（无整车厂），且非细分指标
 * （gm_rate）行为不变（证明过滤严格作用于 seg_attain_* 而非误伤全局）。
 */
const ADMIN: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
const AUTOMAKER = ["长安", "东风", "广汽", "吉利", "小鹏", "宇通", "客车"]; // 乘用车/商用车整车厂
const STORAGE = ["国家电网", "南方电网", "国家电投", "龙源电力"]; // 储能客户

const custOf = (factor: string) => /（(.+?)）/.exec(factor)?.[1] ?? "";

describe("SEAM · gap_attribution 细分作用域（G-SEG-ATTR-CROSS-SEGMENT）", () => {
  it("储能达成率下钻只含储能客户订单（无整车厂·断在接缝不在各半）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const g: any = await t.services.solvers.invoke(ADMIN, "gap_attribution", { metricKey: "seg_attain_ess" });
    expect(g.rootMetric.key).toBe("seg_attain_ess");
    // 收紧过滤（复审建议·健壮性）：仅 L2 订单叶(prov.kind="实测")；L1 基地节点(service.ts kind:"派生"·drillType 亦为 "Order"·factor="基地 X")
    // 排除在外——否则 custOf("基地 X")→"" 会让 every(∈储能) 假失败。真订单叶 kind 恒 "实测"。
    const orderLeaves = g.atomicLeaves.filter((l: any) => l.provenance?.drillType === "Order" && l.provenance?.kind === "实测");
    expect(orderLeaves.length).toBeGreaterThan(0);
    const custs = orderLeaves.map((l: any) => custOf(l.factor));
    // 头号断言：不含任何整车厂/商用车客户
    expect(custs.some((c: string) => AUTOMAKER.some((a) => c.includes(a)))).toBe(false);
    // 且全部属储能
    expect(custs.every((c: string) => STORAGE.some((s) => c.includes(s)))).toBe(true);
    // 叶携业态（R13 出处透明·前端可二次过滤）
    expect(orderLeaves.every((l: any) => l.businessType === "storage")).toBe(true);
    // 勾稽/确定性未被破坏
    expect(g.reconciled).toBe(true);
  });

  it("每细分只归因本细分（seg_attain_pas → 仅乘用车整车厂·无储能）——证过滤按业态**精准裁**·非黑名单删整车厂", async () => {
    // 复审改写（诚实·亲跑核对）：原 PRD 拿 gm_rate 作「非细分不裁剪」控制，但亲跑实测 gm_rate 经
    // gap_attribution **零订单叶**（不落结构回落订单铺分路径）→ 该前提不成立、断言恒假。改用**镜像细分** seg_attain_pas
    // 作更强控制：乘用车达成率 → 订单叶全乘用车整车厂（长安/东风/广汽/吉利）·无储能。与储能题（只储能·无整车厂）互为镜像，
    // 证过滤是「按 Metric 业态精准裁」（储能题删整车厂、乘用车题保整车厂删储能）而非「一律删整车厂」的黑名单。
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const g: any = await t.services.solvers.invoke(ADMIN, "gap_attribution", { metricKey: "seg_attain_pas" });
    expect(g.rootMetric.key).toBe("seg_attain_pas");
    const custs = g.atomicLeaves
      .filter((l: any) => l.provenance?.drillType === "Order" && l.provenance?.kind === "实测") // 仅 L2 订单叶·排 L1 基地节点(复审建议)
      .map((l: any) => custOf(l.factor));
    expect(custs.length).toBeGreaterThan(0);
    expect(custs.every((c: string) => AUTOMAKER.some((a) => c.includes(a)))).toBe(true); // 全乘用车整车厂
    expect(custs.some((c: string) => STORAGE.some((s) => c.includes(s)))).toBe(false); // 无储能（精准裁·非黑名单）
    expect(g.reconciled).toBe(true);
  });

  it("③ base 作用域下钻不套业态过滤（合肥非储能基地根因树跨全业态·非空）——治 base 作用域回归（0079ba31）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    // 合肥(hefei) = 乘用车订单首基地、非储能基地。base 作用域下钻（RiskBoard 每基地根因推演树）应展示其订单树·非空——
    // 即便默认指标是 seg_attain_ess(储能)。回归守：储能全局过滤若误伤 base 作用域 → noBaseData=true 空树（合肥/成都/武汉曾断）。
    const g: any = await t.services.solvers.invoke(ADMIN, "gap_attribution", { scope: { baseId: "hefei" } });
    expect(g.noBaseData ?? false).toBe(false); // 非空树（回归时此处为 true）
    expect(g.scope?.baseId).toBe("hefei");
    const l1 = g.levels.find((L: any) => L.depth === 1);
    expect(l1?.nodes?.length ?? 0).toBeGreaterThan(0); // L1 有该基地根
    const orderLeaves = g.atomicLeaves.filter((l: any) => l.provenance?.drillType === "Order" && l.provenance?.kind === "实测");
    expect(orderLeaves.length).toBeGreaterThan(0); // 有订单叶（跨全业态·非被储能过滤空）
    expect(g.reconciled).toBe(true);
  });

  it("④ 非首基地也有敞口树（厦门 base 作用域·可产订单敞口·非空·勾稽）——治 G-SEG-ATTR-BASE-BASES0", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    // 厦门(xiamen) 因 Order.bases 字母序恒 bases[1]、从不当首基地 → 全局 L1 无它（旧洞：空树）。
    // 但它是 2170-NCM 可产基地 → base 作用域应出「可承接订单敞口」树·非空（exposure 标注·勾稽守）。
    const g: any = await t.services.solvers.invoke(ADMIN, "gap_attribution", { scope: { baseId: "xiamen" } });
    expect(g.noBaseData ?? false).toBe(false); // 敞口树非空（旧洞时为 true）
    expect(g.scope?.baseId).toBe("xiamen");
    expect(g.scope?.exposure).toBe(true); // 诚实标注 exposure（非全局分摊份额）
    const orderLeaves = g.atomicLeaves.filter((l: any) => l.provenance?.drillType === "Order" && l.provenance?.kind === "实测");
    expect(orderLeaves.length).toBeGreaterThan(0); // 有可产订单叶
    expect(g.reconciled).toBe(true); // 勾稽 Σ子+residual=父
  });
});
