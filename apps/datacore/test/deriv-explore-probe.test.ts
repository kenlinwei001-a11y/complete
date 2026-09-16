/**
 * WO-DERIV-DSL-PROBE · **探针测试，非门**（只量不改；收编方可直接删除本文件）。
 *
 * ① 落盘本体快照（类型/数值属性/链接/对象数）到 scratchpad，供 Q2/Q3 分档。
 * ② **判别实验**：`Order.value` 到底是哪台引擎物化的？
 *    本仓有两台同名不同宗的派生引擎，**对 `qty*unitPrice` 算出的数逐位相同** ⇒
 *    「value 对得上」不度量「DerivationSpec 跑过」。必须用一条**只有 §2 DSL 有、模板方言没有**
 *    的公式去分辨。形态：「我用『公式算对了』当作『是这台引擎算的』的证据。」
 */
import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";

const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/probe";

describe("WO-DERIV-DSL-PROBE · 本体快照 + 引擎判别", () => {
  it("① dump 类型/数值属性/链接/对象计数", async () => {
    mkdirSync(OUT, { recursive: true });
    const t = await makeApp();
    await seedBattery(t);
    const ctx = t.adminCtx;

    const types = await t.repos.ontologyTypes.list(ctx.tenantId, (x) => x.status === "ACTIVE");
    const links = await t.repos.ontologyLinks.list(ctx.tenantId);
    // 🐤 金丝雀：电池合成必有 Order；没有 ⇒ 取法坏了，不是本体空
    expect(types.some((x) => x.key === "Order"), "🐤 Order 必须在").toBe(true);
    expect(links.length, "🐤 links 不该为空").toBeGreaterThan(3);

    const rows: Record<string, unknown> = {};
    for (const ty of types) {
      const objs = await t.repos.objects.listByType(ctx.tenantId, ty.key);
      // 数值属性：从**真对象**统计有限数命中数（不信 schema 声明）
      const numericHits: Record<string, number> = {};
      for (const o of objs) {
        for (const [k, v] of Object.entries(o.props ?? {})) {
          if (typeof v === "number" && Number.isFinite(v)) numericHits[k] = (numericHits[k] ?? 0) + 1;
        }
      }
      rows[ty.key] = {
        displayName: ty.displayName,
        n: objs.length,
        derived: (ty.derivedProperties ?? []).map((d) => ({ prop: d.propKey, formula: d.formula })),
        declaredProps: (ty.properties ?? []).map((p) => `${p.key}:${p.dataType}${p.unit ? "/" + p.unit : ""}`),
        numericHits,
      };
    }

    const linkRows = links.map((l) => ({ key: l.key, from: l.fromTypeKey, to: l.toTypeKey }));
    writeFileSync(`${OUT}/ontology.json`, JSON.stringify({ types: rows, links: linkRows }, null, 1));
    console.log(`[PROBE] types=${types.length} links=${links.length} objs=${Object.values(rows).reduce((a, r) => a + ((r as { n: number }).n), 0)}`);
    await t.app.close();
  }, 600_000);

  it("② 判别实验：DerivationSpec 编译 ≠ 物化；哪台引擎写了 Order.value", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const ctx = t.adminCtx;
    const report: Record<string, unknown> = {};

    // --- 基线：seedBattery 之后，Order.value 有没有值？derivation_specs 有没有条目？---
    const orders0 = await t.repos.objects.listByType(ctx.tenantId, "Order");
    const sample = orders0.find((o) => typeof o.props.qty === "number" && typeof o.props.unitPrice === "number")!;
    expect(sample, "🐤 必须找得到带 qty/unitPrice 的订单").toBeDefined();
    const specs0 = await t.repos.derivationSpecs.list(ctx.tenantId, () => true);
    report.baseline = {
      orderSample: { id: sample.id, qty: sample.props.qty, unitPrice: sample.props.unitPrice, value: sample.props.value },
      manualCheck: (sample.props.qty as number) * (sample.props.unitPrice as number),
      derivationSpecsInDb: specs0.length,
    };

    // --- 判别 A：装一条**只有 §2 DSL 能写、模板 derivedProperties 里没有**的公式 ---
    // Line.__probeSelf = this.capacityDaily * 2 —— 模板方言里不存在这个 propKey。
    const lineType = (await t.repos.ontologyTypes.list(ctx.tenantId, (x) => x.key === "Line"))[0];
    expect(lineType, "🐤 Line 类型必须在").toBeDefined();
    const hasProbeInTemplate = (lineType!.derivedProperties ?? []).some((d) => d.propKey === "__probeSelf");
    expect(hasProbeInTemplate, "🐤 反侧：模板里不该已有 __probeSelf").toBe(false);

    const ov = await t.services.ontology.currentVersion(ctx.tenantId);
    await t.services.ontologyCore.compileSpecs(ctx, ov, [
      { specKey: "__probe_self", targetType: "Line", targetProp: "__probeSelf", formula: "this.capacityDaily * 2" },
    ]);
    const specsAfterCompile = await t.repos.derivationSpecs.list(ctx.tenantId, (s) => s.status === "ACTIVE");
    const lines1 = await t.repos.objects.listByType(ctx.tenantId, "Line");
    const materializedAfterCompile = lines1.filter((o) => o.props.__probeSelf !== undefined).length;

    // --- 判别 B：跑模板引擎 runDerivations —— 它读 type.derivedProperties，不读 specs ---
    await t.services.ontology.runDerivations(ctx);
    const lines2 = await t.repos.objects.listByType(ctx.tenantId, "Line");
    const materializedAfterRunDerivations = lines2.filter((o) => o.props.__probeSelf !== undefined).length;

    // --- 判别 C：跑 §2 引擎 recompute，喂它依赖变更 ---
    const lineIds = lines2.map((o) => o.id);
    const rc = await t.services.ontologyCore.recompute(ctx, [
      { typeKey: "Line", prop: "capacityDaily", objectIds: lineIds },
    ]);
    const lines3 = await t.repos.objects.listByType(ctx.tenantId, "Line");
    const withProbe = lines3.filter((o) => typeof o.props.__probeSelf === "number");
    const s3 = withProbe[0];

    report.discriminator = {
      linesTotal: lines2.length,
      specsActiveAfterCompile: specsAfterCompile.length,
      materializedAfterCompileOnly: materializedAfterCompile,
      materializedAfterRunDerivations: materializedAfterRunDerivations,
      materializedAfterRecompute: withProbe.length,
      recomputeUpdatedObjects: rc.updatedObjects,
      sampleAfterRecompute: s3
        ? { id: s3.id, capacityDaily: s3.props.capacityDaily, __probeSelf: s3.props.__probeSelf, manual: (s3.props.capacityDaily as number) * 2 }
        : null,
    };

    // --- 判别 D：小数位数指纹 —— §2 DSL 定点 4 位，模板引擎 round(...,6) ---
    await t.services.ontologyCore.compileSpecs(ctx, ov, [
      { specKey: "__probe_third", targetType: "Line", targetProp: "__probeThird", formula: "this.capacityDaily / 3" },
    ]);
    await t.services.ontologyCore.recompute(ctx, [{ typeKey: "Line", prop: "capacityDaily", objectIds: lineIds }]);
    const lines4 = await t.repos.objects.listByType(ctx.tenantId, "Line");
    const s4 = lines4.find((o) => typeof o.props.__probeThird === "number");
    report.decimalFingerprint = s4
      ? {
          capacityDaily: s4.props.capacityDaily,
          __probeThird: s4.props.__probeThird,
          exact: (s4.props.capacityDaily as number) / 3,
          decimals: String(s4.props.__probeThird).split(".")[1]?.length ?? 0,
        }
      : null;

    writeFileSync(`${OUT}/discriminator.json`, JSON.stringify(report, null, 1));
    console.log("[PROBE-DISCRIMINATOR]", JSON.stringify(report, null, 1));
    await t.app.close();
  }, 600_000);
});
