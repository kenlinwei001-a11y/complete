import { describe, expect, it } from "vitest";
import { createTestApp, ADMIN, debugHeaders } from "./helpers.js";

/**
 * WO-IMPORT-SCENARIO-LAUNCHER-WIRE（G3 follow-up）· 导入场景端到端进电池启动器 + selectedObjects 流转。
 *
 * G3 诚实交底转单：电池族启动器此前只走 SCENARIO_CATALOG、**忽略** DataCore `/a/v1/scenarios/pack` seam（携本租户
 * 导入场景）→ 导入场景卡进不了 demo 启动器。本单：①电池 catalog 合入 pack.scenarios ②IndustryScenario 补
 * selectedObjects/targetView/slotPresets 让 G3 解析的真对象经 pack 传卡面（一键推演 PRD §3.3）。
 */

describe("WO-IMPORT-SCENARIO-LAUNCHER-WIRE · 导入场景进电池启动器", () => {
  it("电池租户：导入场景经 DataCore pack seam → 出现在启动器目录 + 携 selectedObjects/targetView（合入非替换）", async () => {
    const t = await createTestApp();
    // 模拟 DataCore /a/v1/scenarios/pack 返回本租户导入场景（G3 已解析真对象 selectedObjects·经 seam 携字段）。
    (t.dataCore.ontology as unknown as { getScenarioPack: () => Promise<unknown> }).getScenarioPack = async () => ({
      industryKey: "battery-manufacturing",
      scenarios: [
        {
          key: "imported-equip-fail",
          title: "导入·设备故障影响",
          question: "常州基地设备故障影响半径?",
          answer: { kind: "objects", objectType: "Base" },
          targetView: "sim-sandbox",
          selectedObjects: [{ objectType: "Base", objectId: "changzhou", label: "常州" }],
          slotPresets: { baseId: "changzhou" },
        },
      ],
    });
    const res = await t.app.inject({ method: "GET", url: "/b/v1/scenarios", headers: debugHeaders(ADMIN) });
    expect(res.statusCode).toBe(200);
    const items = (res.json() as { items: { sNo: string; name: string; view: string; presetContext: { targetView: string; selectedObjects: { objectType: string }[] } }[] }).items;
    // ① 导入场景进电池启动器目录（此前 battery 忽略 pack.scenarios → 进不来·green→red 命门）。
    const card = items.find((x) => x.sNo === "imported-equip-fail");
    expect(card).toBeDefined();
    expect(card!.name).toBe("导入·设备故障影响");
    // ② 携 targetView + selectedObjects（G3 解析真对象经 pack 传卡面·一键推演）。
    expect(card!.view).toBe("sim-sandbox");
    expect(card!.presetContext.targetView).toBe("sim-sandbox");
    expect(card!.presetContext.selectedObjects.some((o) => o.objectType === "Base")).toBe(true);
    // 合入非替换：出厂电池 20 卡仍在。
    expect(items.some((x) => x.sNo === "S01")).toBe(true);
  });

  it("无导入场景 → 启动器只有出厂电池卡（无 imported-* 泄漏·合入不凭空造卡）", async () => {
    const t = await createTestApp();
    const res = await t.app.inject({ method: "GET", url: "/b/v1/scenarios", headers: debugHeaders(ADMIN) });
    const items = (res.json() as { items: { sNo: string }[] }).items;
    expect(items.some((x) => x.sNo.startsWith("imported-"))).toBe(false);
    expect(items.some((x) => x.sNo === "S01")).toBe(true);
  });
});
