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
});
