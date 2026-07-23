import { describe, expect, it } from "vitest";
import { assembleContextBundle, type TypeSemanticsPayload } from "@platform/contracts";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";

/**
 * WO-QOS-ONTOLOGY-CONTEXT · 本体口径/语义投影地基（datacore 半 + 跨半接缝 SEAM-GATE）。
 *
 * 数据半（projectTypeSemantics·真本体投影）× 引擎半（contracts assembleContextBundle·真打分/选型）
 * 一测通——共享 assembly 代码消除 mock 漂移，此测即真接缝驱动。
 *   SEAM-1 储能问句 → gap_attribution matchScore 最高 + relevantTypes 含 Metric/CausalFactor/Base/MaterialBalance·口径来自本体
 *   SEAM-2 无对口 solver 的分组问句 → relevantTypes+分组维度+口径齐（证无 solver 也能定位数据）
 *   SEAM-3 口径单一真值：改本体 Metric 口径 → 投影同步变（灭 mirror 漂移·R6 同问同投影字节一致）
 */

const get = async (t: Awaited<ReturnType<typeof makeApp>>): Promise<TypeSemanticsPayload> =>
  (await t.app.inject({ method: "GET", url: "/a/v1/ontology/type-semantics", headers: ADMIN })).json() as TypeSemanticsPayload;

describe("WO-QOS-ONTOLOGY-CONTEXT · type-semantics 投影 + 接缝", () => {
  it("投影原料来自本体单一真值：Metric 口径=派生公式·Base 字段映射=sourceBinding·因果证据类型来自 CausalFactor.drillType", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const p = await get(t);

    const metric = p.types.find((x) => x.typeKey === "Metric");
    expect(metric).toBeTruthy();
    // 口径来自本体 derivedProperties（非内联）。
    expect(metric!.caliber.gapPct).toBe("(actual - target) / target * 100");
    expect(metric!.caliber.delta).toBe("actual - target");

    const base = p.types.find((x) => x.typeKey === "Base");
    expect(base).toBeTruthy();
    // 字段映射来自 sourceBinding.fieldMappings（溯源到接入系统列）。
    expect(base!.fieldMappings.baseId).toBe("BASE_ID");
    expect(base!.units.util).toBe("%");

    // 因果证据类型宇宙来自真实 CausalFactor.drillType（含 MaterialBalance/Equipment·数据源非内联）。
    expect(p.causalDomain).toBe("decision");
    expect(p.causalEvidenceTypes).toContain("MaterialBalance");
    expect(p.causalEvidenceTypes).toContain("Equipment");

    // 求解器语义来自求解器目录（gap_attribution 带 answersQuestions/tags/输出形状/readsTypes）。
    const gap = p.solvers.find((s) => s.key === "gap_attribution");
    expect(gap).toBeTruthy();
    expect(gap!.tags).toContain("attribution");
    expect(gap!.outputShape).toContain("atomicLeaves");
    expect(gap!.readsTypes).toContain("Metric"); // 描述 "Metric.gap" 词边界命中
  });

  it("SEAM-1 储能份额没达标逐层拆根因 → gap_attribution matchScore 最高 + relevantTypes 含 Metric/CausalFactor/Base/MaterialBalance", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const p = await get(t);

    const question = "储能份额没达标·逐层拆根因";
    // 引擎半解析（问句→域/首选求解器·此处显式传 decision + gap_attribution·mirror ceo-route 确定性路由）。
    const bundle = assembleContextBundle(p, { domain: "decision", primarySolver: "gap_attribution", focus: { metric: "seg_attain_ess" } }, question);

    // gap_attribution 排第一且分最高。
    expect(bundle.relevantSolvers[0]!.key).toBe("gap_attribution");
    const gapScore = bundle.relevantSolvers[0]!.matchScore;
    for (const s of bundle.relevantSolvers.slice(1)) expect(s.matchScore).toBeLessThan(gapScore);

    // relevantTypes 含四类（Metric 决策域·CausalFactor 决策域·Base 经 Equipment.baseId 引用闭包·MaterialBalance 因果证据）。
    const typeKeys = bundle.relevantTypes.map((x) => x.typeKey);
    for (const k of ["Metric", "CausalFactor", "Base", "MaterialBalance"]) expect(typeKeys).toContain(k);

    // 储能达成率指标在集内（seg_attain_ess 是 Metric 实例·类型 Metric 相关即证）。
    // 口径来自本体（非内联）——bundle.calibers[Metric] 即投影的派生公式。
    expect(bundle.calibers.Metric?.gapPct).toBe("(actual - target) / target * 100");
    // 字段映射随相关类型带出（Base 溯源）。
    expect(bundle.fieldMappings.Base?.baseId).toBe("BASE_ID");
  });

  it("SEAM-2 无对口 solver 的分组问句（客户地点按省份）→ relevantTypes+分组维度+口径齐·无首选求解器霸占", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const p = await get(t);

    const question = "各省份分别有多少个交付地点";
    // 无 CEO/决策路由命中 → 无 primarySolver（证无 solver 也能定位数据）。
    const bundle = assembleContextBundle(p, { domain: "commercial" }, question);

    // 无任何求解器被"设计成"回答本题（无首选加权·全部匹配分 < 首选加权阈）。
    for (const s of bundle.relevantSolvers) expect(s.matchScore).toBeLessThan(1000);

    // 商务域类型齐 + 可分组维度在 keyProps（供下游③ aggregate·省份/城市）。
    const custLoc = bundle.relevantTypes.find((x) => x.typeKey === "CustomerLocation");
    expect(custLoc).toBeTruthy();
    expect(custLoc!.keyProps).toContain("province");
    expect(custLoc!.keyProps).toContain("city");
    // 决策域因果证据类型不越界进商务域问句（causalDomain≠commercial）。
    expect(bundle.relevantTypes.map((x) => x.typeKey)).not.toContain("CausalFactor");
  });

  it("SEAM-3 口径单一真值：改本体 Metric 派生口径 → 投影同步变（灭 mirror 漂移）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const before = await get(t);
    expect(before.types.find((x) => x.typeKey === "Metric")!.caliber.gapPct).toBe("(actual - target) / target * 100");

    // 直接改本体 Metric 派生公式（单一真值口径）。
    const metricType = (await t.repos.ontologyTypes.list(t.adminCtx.tenantId)).find((x) => x.key === "Metric")!;
    const patched = {
      ...metricType,
      derivedProperties: metricType.derivedProperties.map((d) =>
        d.propKey === "gapPct" ? { ...d, formula: "(actual - target) / target * 200" } : d,
      ),
    };
    await t.repos.ontologyTypes.put(patched);

    const after = await get(t);
    expect(after.types.find((x) => x.typeKey === "Metric")!.caliber.gapPct).toBe("(actual - target) / target * 200");
  });

  it("R6 确定性：同 (本体, 问句) 两跑投影 + bundle 字节一致", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const p1 = await get(t);
    const p2 = await get(t);
    expect(JSON.stringify(p1)).toBe(JSON.stringify(p2));
    const q = "储能份额没达标·逐层拆根因";
    const b1 = assembleContextBundle(p1, { domain: "decision", primarySolver: "gap_attribution" }, q);
    const b2 = assembleContextBundle(p2, { domain: "decision", primarySolver: "gap_attribution" }, q);
    expect(JSON.stringify(b1)).toBe(JSON.stringify(b2));
  });
});
