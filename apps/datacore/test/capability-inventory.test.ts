import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";
import { diffNeeds, type CapabilityInventory } from "../src/databuilder/capability-inventory.js";

/**
 * PRD-fde §3.5 能力清单 + 比对差异（P1）：发动机"知现状→算缺口"。
 *
 * 故事脚本（~100 字）：那条"工序/设备共享瓶颈"的故事经 comprehend 倒推出需要 Process/Equipment 类型 +
 * shared_bottleneck 求解器 + 降级规则。建之前发动机先查本租户现有能力(只有 Base/Order/…、capacity_forecast
 * 等),把需求 diff 现状,**当场报出缺 Process/Equipment(缺类型)、shared_bottleneck(缺求解器)、降级规则**——
 * 知道缺什么才能去各模块 create / 求解器三级升级。干净需求(全已有)→ READY 零缺口。
 */
describe("PRD-fde §3.5 · 能力清单 + 比对差异", () => {
  const INV: CapabilityInventory = { objectTypes: ["Base", "Order"], rules: ["C03"], solvers: ["capacity_forecast", "generic_inference"], slices: ["slice_base"] };

  it("diffNeeds（纯函数）：缺的逐项报码,全有→READY,确定性排序（R6）", () => {
    const r = diffNeeds({ objectTypes: ["Base", "Process", "Equipment"], rules: ["C03", "R_DOWNGRADE"], solvers: ["shared_bottleneck"], slices: ["slice_base", "slice_process"] }, INV);
    expect(r.verdict).toBe("GAPS");
    const byKey = Object.fromEntries(r.gaps.map((g) => [g.key, g.gapCode]));
    expect(byKey.Process).toBe("NO_SLICE"); // 缺类型
    expect(byKey.Equipment).toBe("NO_SLICE");
    expect(byKey.shared_bottleneck).toBe("SOLVER_NOT_FOUND"); // 缺求解器→三级升级处置
    expect(byKey.R_DOWNGRADE).toBe("NO_RULE");
    expect(byKey.slice_process).toBe("NO_SLICE");
    expect(r.gaps.some((g) => g.key === "Base")).toBe(false); // 已有不报
    // 确定性：两次同序
    expect(diffNeeds({ objectTypes: ["Process", "Equipment"] }, INV).gaps.map((g) => g.key)).toEqual(["Equipment", "Process"]);
  });

  it("干净需求（全已有）→ READY 零缺口", () => {
    expect(diffNeeds({ objectTypes: ["Base"], solvers: ["capacity_forecast"], slices: ["slice_base"] }, INV).verdict).toBe("READY");
  });

  it("GET /a/v1/capability-inventory：列出本租户现有 类型/规则/求解器/切片", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const inv = (await t.app.inject({ method: "GET", url: "/a/v1/capability-inventory", headers: ADMIN })).json() as CapabilityInventory;
    expect(inv.objectTypes).toContain("Base");
    expect(inv.objectTypes).toContain("Order");
    expect(inv.solvers).toContain("capacity_forecast");
    expect(inv.solvers).toContain("generic_inference");
    expect(inv.rules.length).toBeGreaterThan(0);
  });

  it("POST /a/v1/capability-inventory/diff：现状真实——已有的不报(Process 在 battery 已建)、真缺的报", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({
      method: "POST", url: "/a/v1/capability-inventory/diff", headers: ADMIN,
      payload: { objectTypes: ["Order", "Process", "Equipment", "MarsColony"], solvers: ["capacity_forecast", "shared_bottleneck", "phantom_solver"] },
    });
    const r = res.json() as { verdict: string; gaps: { key: string; gapCode: string }[] };
    expect(r.verdict).toBe("GAPS");
    // battery 已建 Process/Equipment/Order + capacity_forecast + 新建的 shared_bottleneck → 不报(清单真实反映现状)
    for (const k of ["Order", "Process", "Equipment", "capacity_forecast", "shared_bottleneck"]) expect(r.gaps.some((g) => g.key === k)).toBe(false);
    // 真缺的报:虚构类型 MarsColony + 未注册求解器 phantom_solver(phantom_solver=永不注册的测试夹具键,验证"缺求解器"被诚实暴露)
    expect(r.gaps.some((g) => g.key === "MarsColony" && g.gapCode === "NO_SLICE")).toBe(true);
    expect(r.gaps.some((g) => g.key === "phantom_solver" && g.gapCode === "SOLVER_NOT_FOUND")).toBe(true);
  });
});
