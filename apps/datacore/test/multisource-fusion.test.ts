import { describe, expect, it } from "vitest";
import { makeApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import type { MultiSourceFusionOutput } from "@platform/contracts";

/**
 * WO-MULTISRC-FUSION-DOMAIN（N1·多源融合 + 冲突仲裁 + 测谎·建在 SolverBinding 之上）测试。
 *
 * 北极星核：**ERP/MES/SRM 对同一事实各执一词 → 按 pk 归并多源实例 + A5 规则驱动冲突仲裁 + 测谎（跨源
 * 数值不一致超阈值 → SUSPECT + 置信降级·不照单全收 R13）+ 带置信溯源答案（dataMode 反映跨源一致性）+
 * AUDIT 留痕。** 复用 ① role 归一 + A5 DSL + audit·不新造引擎。R6 确定·R2 隔离。
 */

// 两源同一 Order：ERP 报交期 T1（乐观），MES 因产能不足报实际交期 T2（更晚）——交期风险冲突。
async function seedTwoSourceOrders(t: Awaited<ReturnType<typeof makeApp>>, tenantId: string) {
  // 源类型（本租户已发布本体·DF.8 接地占位）。
  const ty = (key: string) => ({
    id: `ot_${tenantId}_${key}`, tenantId, key, displayName: key, domain: "sales", version: 1, status: "ACTIVE" as const,
    derivedProperties: [], sourceBindings: [],
    properties: [
      { propKey: "so", dataType: "string", isPrimaryKey: true },
      { propKey: "due", dataType: "string", isPrimaryKey: false },
      { propKey: "asOf", dataType: "string", isPrimaryKey: false },
    ],
  });
  await t.repos.ontologyTypes.put(ty("ErpOrder") as never);
  await t.repos.ontologyTypes.put(ty("MesOrder") as never);
  // 同一 Order SO-3391，两源交期不同（ERP 乐观 09-01 vs MES 实际 09-20）。
  await t.repos.objects.put({ id: "erp1", tenantId, type: "ErpOrder", props: { so: "SO-3391", due: "2026-09-01", asOf: "2026-06-10" } });
  await t.repos.objects.put({ id: "mes1", tenantId, type: "MesOrder", props: { so: "SO-3391", due: "2026-09-20", asOf: "2026-06-25" } });
}

const F = async (t: Awaited<ReturnType<typeof makeApp>>, ctx: AuthCtx, args: Record<string, unknown>): Promise<MultiSourceFusionOutput> =>
  (await t.services.solvers.invoke(ctx, "multisource_fusion", args)) as unknown as MultiSourceFusionOutput;

describe("WO-MULTISRC-FUSION · N1 多源融合 + 仲裁 + 测谎", () => {
  it("同一 Order 多源交期各执一词 → 归并 + 权威源仲裁 + 溯源两源 + 置信反映一致性", async () => {
    const t = await makeApp();
    const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
    await seedTwoSourceOrders(t, "demo");
    const out = (await F(t, ctx, {
      role: "order",
      fields: ["due"],
      sources: [
        { sourceLabel: "ERP", typeKey: "ErpOrder", authority: 1, asOfField: "asOf" },
        { sourceLabel: "MES", typeKey: "MesOrder", authority: 3, asOfField: "asOf" }, // MES 更权威（现场实测）
      ],
      defaultStrategy: "AUTHORITY",
    })) as unknown as MultiSourceFusionOutput;

    expect(out.fused).toHaveLength(1);
    const fo = out.fused[0]!;
    expect(fo.pk).toBe("SO-3391");
    const due = fo.fields.find((f) => f.field === "due")!;
    expect(due.conflict).toBe(true); // 两源交期不同 → 冲突
    expect(due.suspect).toBe(false); // due 是日期非数值 → 无数值测谎
    // 权威源仲裁：MES(authority=3) 胜 → 采纳实际交期 T2，溯源标明取哪源/为何。
    expect(due.chosenSource).toBe("MES");
    expect(due.value).toBe("2026-09-20");
    expect(due.reason).toContain("权威");
    // 两源都溯源可见。
    expect(due.sources.map((s) => s.source).sort()).toEqual(["ERP", "MES"]);
    // 置信反映一致性：有冲突 → dataMode PARTIAL（非 LIVE 冒充）。
    expect(out.dataMode).toBe("PARTIAL");
    expect(out.conflictCount).toBe(1);
    expect(fo.verdict).toBe("TRUSTED"); // 无测谎命中
  });

  it("新鲜度策略：采纳最新源交期（asOf 最新者胜）", async () => {
    const t = await makeApp();
    const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
    await seedTwoSourceOrders(t, "demo");
    const out = (await F(t, ctx, {
      role: "order", fields: ["due"],
      sources: [
        { sourceLabel: "ERP", typeKey: "ErpOrder", authority: 5, asOfField: "asOf" },
        { sourceLabel: "MES", typeKey: "MesOrder", authority: 1, asOfField: "asOf" },
      ],
      defaultStrategy: "FRESHNESS",
    })) as unknown as MultiSourceFusionOutput;
    const due = out.fused[0]!.fields.find((f) => f.field === "due")!;
    expect(due.strategy).toBe("FRESHNESS");
    expect(due.chosenSource).toBe("MES"); // asOf 06-25 > 06-10
  });

  it("测谎（虚报产能）：跨源同字段数值不一致超阈值 → SUSPECT + 置信降级 + 审慎取最保守值（不照单全收）", async () => {
    const t = await makeApp();
    const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
    const ty = (key: string) => ({
      id: `ot_demo_${key}`, tenantId: "demo", key, displayName: key, domain: "mfg", version: 1, status: "ACTIVE" as const,
      derivedProperties: [], sourceBindings: [],
      properties: [
        { propKey: "base", dataType: "string", isPrimaryKey: true },
        { propKey: "capacity", dataType: "number", isPrimaryKey: false },
      ],
    });
    await t.repos.ontologyTypes.put(ty("ScadaCap") as never);
    await t.repos.ontologyTypes.put(ty("MesCap") as never);
    await t.repos.ontologyTypes.put(ty("SelfReportCap") as never);
    // 常州基地产能：SCADA 实测 100，MES 实测 105，但基地自报 200（虚报好看）→ 极差大 → 测谎命中。
    await t.repos.objects.put({ id: "s1", tenantId: "demo", type: "ScadaCap", props: { base: "常州", capacity: 100 } });
    await t.repos.objects.put({ id: "m1", tenantId: "demo", type: "MesCap", props: { base: "常州", capacity: 105 } });
    await t.repos.objects.put({ id: "r1", tenantId: "demo", type: "SelfReportCap", props: { base: "常州", capacity: 200 } });

    const out = (await F(t, ctx, {
      role: "base_capacity", fields: ["capacity"],
      sources: [
        { sourceLabel: "SCADA", typeKey: "ScadaCap", authority: 3 },
        { sourceLabel: "MES", typeKey: "MesCap", authority: 2 },
        { sourceLabel: "SELF", typeKey: "SelfReportCap", authority: 1 }, // 基地自报（最不权威）
      ],
      suspectThreshold: 0.15,
    })) as unknown as MultiSourceFusionOutput;

    const fo = out.fused[0]!;
    expect(fo.verdict).toBe("SUSPECT"); // 测谎命中 → 常驻 SUSPECT（不洗白 R13）
    expect(out.suspectCount).toBe(1);
    expect(out.dataMode).toBe("MOCK"); // 有测谎命中 → 头条最审慎（不冒充真值）
    const cap = fo.fields.find((f) => f.field === "capacity")!;
    expect(cap.suspect).toBe(true);
    expect(cap.suspectEvidence!.outlierSource).toBe("SELF"); // 虚报源被揪出
    expect(cap.suspectEvidence!.outlierValue).toBe(200);
    // 审慎（不照单全收）：取最保守（最小）值 100，绝不采纳虚报的 200。
    expect(cap.strategy).toBe("CONSERVATIVE");
    expect(cap.value).toBe(100);
    expect(cap.chosenSource).toBe("SCADA");
    // 置信降级：字段整体置信降到 0.35（远低于一致的 0.95）；虚报源逐源置信被砍半。
    expect(cap.confidence).toBe(0.35);
    const selfSrc = cap.sources.find((s) => s.source === "SELF")!;
    const scadaSrc = cap.sources.find((s) => s.source === "SCADA")!;
    expect(selfSrc.confidence).toBeLessThan(scadaSrc.confidence);
    expect(fo.confidence).toBe(0.35); // 对象整体置信 = 逐字段最小（审慎）
  });

  it("AUDIT 留痕：测谎 + 冲突对象经统一 append-only 审计（含 actor/取哪源/为何/置信）+ 融合快照可查", async () => {
    const t = await makeApp();
    const ctx: AuthCtx = { tenantId: "demo", userId: "planner01", roles: ["admin"], attributes: {}, requestId: "req-fuse-1" };
    const ty = (key: string) => ({
      id: `ot_demo_${key}`, tenantId: "demo", key, displayName: key, domain: "mfg", version: 1, status: "ACTIVE" as const,
      derivedProperties: [], sourceBindings: [],
      properties: [{ propKey: "base", dataType: "string", isPrimaryKey: true }, { propKey: "capacity", dataType: "number", isPrimaryKey: false }],
    });
    await t.repos.ontologyTypes.put(ty("ScadaCap") as never);
    await t.repos.ontologyTypes.put(ty("SelfReportCap") as never);
    await t.repos.objects.put({ id: "s1", tenantId: "demo", type: "ScadaCap", props: { base: "宜宾", capacity: 90 } });
    await t.repos.objects.put({ id: "r1", tenantId: "demo", type: "SelfReportCap", props: { base: "宜宾", capacity: 180 } });
    await F(t, ctx, {
      role: "base_capacity", fields: ["capacity"],
      sources: [
        { sourceLabel: "SCADA", typeKey: "ScadaCap", authority: 3 },
        { sourceLabel: "SELF", typeKey: "SelfReportCap", authority: 1 },
      ],
    });
    // 审计留痕：fusion.suspect_detected 带 actor + requestId + 取哪源/置信。
    const audits = await t.repos.auditLog.list("demo");
    const suspectAudit = audits.find((a) => a.action === "fusion.suspect_detected");
    expect(suspectAudit).toBeTruthy();
    expect(suspectAudit!.actorId).toBe("planner01");
    expect(suspectAudit!.requestId).toBe("req-fuse-1");
    expect(suspectAudit!.targetId).toBe("base_capacity:宜宾");
    expect((suspectAudit!.after as Record<string, unknown>).verdict).toBe("SUSPECT");
    // 融合快照 append 落 fused_objects（复盘全貌）。
    const snaps = await t.repos.fusedObjects.list("demo");
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.verdict).toBe("SUSPECT");
    expect(snaps[0]!.pk).toBe("宜宾");
    expect(snaps[0]!.fused.fields[0]!.value).toBe(90); // 审慎取实测最小值
  });

  it("R6 确定性：同多源同参数重跑 → 字节一致（仲裁/测谎无随机）", async () => {
    const run = async () => {
      const t = await makeApp();
      const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
      await seedTwoSourceOrders(t, "demo");
      const out = await F(t, ctx, {
        role: "order", fields: ["due"],
        sources: [
          { sourceLabel: "ERP", typeKey: "ErpOrder", authority: 1, asOfField: "asOf" },
          { sourceLabel: "MES", typeKey: "MesOrder", authority: 3, asOfField: "asOf" },
        ],
      });
      return JSON.stringify(out);
    };
    expect(await run()).toEqual(await run());
  });

  it("R2 租户隔离：租户 A 的多源对象不泄漏到租户 B 融合", async () => {
    const t = await makeApp();
    await seedTwoSourceOrders(t, "demo");
    const ctxOther: AuthCtx = { tenantId: "other", userId: "u", roles: ["admin"], attributes: {} };
    // other 租户无对象 → 融合 0 个（demo 的对象不越租户）。
    const out = (await F(t, ctxOther, {
      role: "order", fields: ["due"],
      sources: [
        { sourceLabel: "ERP", typeKey: "ErpOrder", authority: 1 },
        { sourceLabel: "MES", typeKey: "MesOrder", authority: 3 },
      ],
    })) as unknown as MultiSourceFusionOutput;
    expect(out.fused).toHaveLength(0);
    expect(await t.repos.fusedObjects.list("other")).toHaveLength(0);
  });

  it("A5 规则驱动仲裁（G-10 可编辑）：已发布 fusion_arb 规则命中 → 字段级策略覆盖默认", async () => {
    const t = await makeApp();
    const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
    await seedTwoSourceOrders(t, "demo");
    // 发布一条融合仲裁规则：冲突时走新鲜度优先（覆盖默认 AUTHORITY）。表达式经 A5 DSL 解析。
    await t.repos.rules.put({
      id: "rule_fusion1", tenantId: "demo", key: "fusion_arb_freshness", name: "冲突走新鲜度",
      expression: "conflict == TRUE", scopeObjectTypes: ["__fusion__"], severity: "INFO",
      ruleType: "constraint", params: { strategy: "FRESHNESS" } as unknown as Record<string, number>,
      origin: "manual", version: 1, status: "PUBLISHED",
    } as never);
    const out = (await F(t, ctx, {
      role: "order", fields: ["due"],
      sources: [
        { sourceLabel: "ERP", typeKey: "ErpOrder", authority: 9, asOfField: "asOf" }, // 权威高但规则改走新鲜度
        { sourceLabel: "MES", typeKey: "MesOrder", authority: 1, asOfField: "asOf" },
      ],
      defaultStrategy: "AUTHORITY",
    })) as unknown as MultiSourceFusionOutput;
    const due = out.fused[0]!.fields.find((f) => f.field === "due")!;
    expect(due.strategy).toBe("FRESHNESS"); // 规则覆盖默认 AUTHORITY
    expect(due.chosenSource).toBe("MES"); // 新鲜度最新
    expect(due.reason).toContain("fusion_arb_freshness"); // 溯源到规则
  });
});
