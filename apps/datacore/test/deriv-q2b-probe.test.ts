/**
 * WO-DERIV-DSL-PROBE · Q2b **探针测试，非门**（只量不改；收编方可直接删除本文件）。
 *
 * Q2 首轮「最难」例物化 0 条。⛔ 不许就此报「DSL 做不到」——
 * 人工核算同样得 0 ⇒ 病灶可能在**链路实例**而非语法。本轮把三种「不工作」分开：
 * 没接线（链路类型不存在）/ 接了线没数据（类型在、实例 0）/ 接了线接错地方（实例挂在另一条链上）。
 *
 * 另两件：① 易例的**量纲错配**（件/日 ÷ 套/日）；② `a/b*100` 的**逐算子取整损失 2 位有效数字**。
 */
import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { makeApp, seedBattery } from "./helpers.js";

const OUT = "/tmp/claude-0/-home-user-complete/3f5e96d7-59cd-5a3f-aa1a-9551fc6f8f15/scratchpad/probe";

describe("WO-DERIV-DSL-PROBE Q2b · 链路实例 + 量纲 + 取整", () => {
  it("三态分辨 + 易例改正 + 取整对照", async () => {
    mkdirSync(OUT, { recursive: true });
    const t = await makeApp();
    await seedBattery(t);
    const ctx = t.adminCtx;
    const ov = await t.services.ontology.currentVersion(ctx.tenantId);
    const R: Record<string, unknown> = {};

    // ---------- ① 链路实例普查：类型在 ≠ 实例在 ----------
    const linkTypes = await t.repos.ontologyLinks.list(ctx.tenantId);
    const linkInst = await t.repos.links.list(ctx.tenantId);
    const instCount: Record<string, number> = {};
    for (const l of linkInst) instCount[l.type] = (instCount[l.type] ?? 0) + 1;
    // 🐤 金丝雀：必有实例的链（订单→客户）不能是 0，否则是遍历坏了
    const canary = instCount["order_of_customer"] ?? 0;
    expect(canary, "🐤 order_of_customer 实例数不该为 0（为 0 ⇒ 遍历坏了）").toBeGreaterThan(0);

    const declaredButEmpty = linkTypes.filter((lt) => !instCount[lt.key]).map((lt) => lt.key);
    R.linkInstances = {
      canary_order_of_customer: canary,
      totalLinkTypes: linkTypes.length,
      totalLinkInstances: linkInst.length,
      typesWithZeroInstances: declaredButEmpty.length,
      woLineFamily: {
        wo_on_line_type: linkTypes.some((l) => l.key === "wo_on_line"),
        wo_on_line_instances: instCount["wo_on_line"] ?? 0,
        line_runs_work_order_type: linkTypes.some((l) => l.key === "line_runs_work_order"),
        line_runs_work_order_instances: instCount["line_runs_work_order"] ?? 0,
      },
      top15ByInstances: Object.entries(instCount).sort((a, b) => b[1] - a[1]).slice(0, 15),
      zeroInstanceSample: declaredButEmpty.slice(0, 25),
    };

    // ---------- ② 最难例重跑：用**真有实例**的那条链 ----------
    const liveLinkToWO = linkTypes.find(
      (lt) => (instCount[lt.key] ?? 0) > 0 && ((lt.fromTypeKey === "Line" && lt.toTypeKey === "WorkOrder") || (lt.fromTypeKey === "WorkOrder" && lt.toTypeKey === "Line")),
    );
    R.chosenLink = liveLinkToWO
      ? { key: liveLinkToWO.key, from: liveLinkToWO.fromTypeKey, to: liveLinkToWO.toTypeKey, instances: instCount[liveLinkToWO.key] }
      : null;

    if (liveLinkToWO) {
      const dir = liveLinkToWO.fromTypeKey === "Line" ? "out" : "in";
      const wos = await t.repos.objects.listByType(ctx.tenantId, "WorkOrder");
      const status = "生产中";
      const fQty = `COALESCE(SUM(${dir}(${liveLinkToWO.key}).qtyPlanned, WHERE status == '${status}'), 0)`;
      // 归一分母用**同量纲**的 max_capacity_day（件/日），不是 capacityDaily（套/日）
      const fPress = `CLAMP(${fQty} * 100 / this.max_capacity_day, 0, 100)`;
      await t.services.ontologyCore.compileSpecs(ctx, ov, [
        { specKey: "q2b_blockedQty", targetType: "Line", targetProp: "blockedQty", formula: fQty },
        { specKey: "q2b_blockedCount", targetType: "Line", targetProp: "blockedCount", formula: `COUNT(${dir}(${liveLinkToWO.key}), WHERE status == '${status}')` },
        { specKey: "q2b_blockedPressure", targetType: "Line", targetProp: "blockedPressure", formula: fPress },
      ]);
      await t.services.ontologyCore.recompute(ctx, [{ typeKey: "WorkOrder", prop: "qtyPlanned", objectIds: wos.map((w) => w.id) }]);
      const lines = await t.repos.objects.listByType(ctx.tenantId, "Line");
      const hit = lines.find((o) => typeof o.props.blockedQty === "number" && (o.props.blockedQty as number) > 0);
      // 人工核算
      let manualSum = 0, manualCount = 0;
      if (hit) {
        const rel = linkInst.filter((l) => l.type === liveLinkToWO.key && (dir === "out" ? l.fromId === hit.id : l.toId === hit.id));
        const ids = rel.map((l) => (dir === "out" ? l.toId : l.fromId));
        for (const w of wos) if (ids.includes(w.id) && String(w.props.status) === status) { manualSum += w.props.qtyPlanned as number; manualCount++; }
      }
      R.hardest = {
        direction: dir, formulaQty: fQty, formulaPressure: fPress,
        materialized: lines.filter((o) => typeof o.props.blockedQty === "number").length,
        totalLines: lines.length,
        nonZero: lines.filter((o) => (o.props.blockedQty as number) > 0).length,
        sample: hit ? { id: hit.id, blockedQty: hit.props.blockedQty, blockedCount: hit.props.blockedCount, maxCap: hit.props.max_capacity_day, pressure: hit.props.blockedPressure } : null,
        manualSum, manualCount,
        manualPressure: hit ? Math.min(manualSum * 100 / (hit.props.max_capacity_day as number), 100) : null,
        clampedAt100: lines.filter((o) => o.props.blockedPressure === 100).length,
      };
    }

    // ---------- ③ 易例量纲改正 + 取整对照 ----------
    const lineIds = (await t.repos.objects.listByType(ctx.tenantId, "Line")).map((o) => o.id);
    await t.services.ontologyCore.compileSpecs(ctx, ov, [
      // 错：件/日 ÷ 套/日
      { specKey: "q2b_util_wrong", targetType: "Line", targetProp: "utilWrong", formula: "this.actual_output_daily / this.capacityDaily * 100" },
      // 对：件/日 ÷ 件/日
      { specKey: "q2b_util_right", targetType: "Line", targetProp: "utilRight", formula: "this.actual_output_daily * 100 / this.max_capacity_day" },
      // 取整对照：先除后乘（损位） vs 先乘后除（保位）
      { specKey: "q2b_trunc_bad", targetType: "Line", targetProp: "truncBad", formula: "this.actual_output_daily / this.max_capacity_day * 100" },
    ]);
    await t.services.ontologyCore.recompute(ctx, [{ typeKey: "Line", prop: "actual_output_daily", objectIds: lineIds }]);
    const lines2 = await t.repos.objects.listByType(ctx.tenantId, "Line");
    const s = lines2.find((o) => typeof o.props.utilRight === "number")!;
    R.unitsAndRounding = {
      sample: { id: s.id, actual: s.props.actual_output_daily, capacityDaily_套日: s.props.capacityDaily, maxCapacityDay_件日: s.props.max_capacity_day, seededUtilization: s.props.utilization },
      wrongDenominator: { got: s.props.utilWrong, note: "件/日 ÷ 套/日 —— 量纲错配" },
      rightDenominator: { got: s.props.utilRight, manual: (s.props.actual_output_daily as number) * 100 / (s.props.max_capacity_day as number) },
      roundingPair: {
        mulFirst: s.props.utilRight,
        divFirst: s.props.truncBad,
        exact: (s.props.actual_output_daily as number) / (s.props.max_capacity_day as number) * 100,
      },
    };

    writeFileSync(`${OUT}/q2b.json`, JSON.stringify(R, null, 1));
    console.log("[Q2b]", JSON.stringify(R, null, 1));
    await t.app.close();
  }, 900_000);
});
