import { beforeEach, describe, expect, it } from "vitest";
import { PageContextSchema } from "@platform/contracts";
import { useSessionStore } from "@/store/sessionStore";

/**
 * WO-CEO-6-FE（闭 G-3 前端接线侧）· buildContext 增产 PageContext（从现有 SessionContext 状态诚实派生）。
 *
 * 病根：buildContext 从不产 pageContext → orchestrator `hasPageContext` 恒假 → CEO 深问意图从不进候选。
 * 本测证「派生真值·非写死」：改选中对象 → entities/selection 变（C3 red-bite）；focus 由 filters/选中对象类型映射；
 * 无上下文页 → 最小真值不伪造 entities/focus/drillPath（C4 诚实）。
 *
 * 「门真打开 + CEO 意图真进候选并路由到求解器（args 派生自 pageContext）」的端到端接缝证据在
 * apps/agentcore/test/ceo-pagecontext-seam.test.ts（resolveCeoRoute/orchestrator 在 agentcore·跨 app 不可 import·
 * contracts-only-shared）——该 seam 消费的正是此处派生的形状（selection=选中 id·focus.metric=Metric 对象·factorId=根因对象）。
 */
describe("F56 · buildContext 产 PageContext（派生真值·闭 G-3 前端侧）", () => {
  beforeEach(() => useSessionStore.getState().reset());

  it("C1 产出合 PageContextSchema：view + entities/selection 从 selectedObjects 派生（非写死）", () => {
    const s = useSessionStore.getState();
    s.setView("gap-waterfall");
    s.setSelectedObjects([
      { objectType: "Metric", objectId: "seg_attain_ess", label: "储能达成率" },
      { objectType: "RootCause", objectId: "cf-cathode-shortage", label: "正极粉短缺" },
    ]);
    const ctx = useSessionStore.getState().buildContext();
    const pc = ctx.pageContext!;
    // 合契约
    expect(() => PageContextSchema.parse(pc)).not.toThrow();
    expect(pc.view).toBe("gap-waterfall");
    // entities 逐字段来自选中对象（非写死）
    expect(pc.entities).toEqual([
      { type: "Metric", id: "seg_attain_ess", label: "储能达成率", drillRef: "seg_attain_ess" },
      { type: "RootCause", id: "cf-cathode-shortage", label: "正极粉短缺", drillRef: "cf-cathode-shortage" },
    ]);
    // selection = 选中对象 id（喂 resolveCeoRoute → factorId）
    expect(pc.selection).toEqual(["seg_attain_ess", "cf-cathode-shortage"]);
    // focus 由类型映射诚实派生：Metric→metric，RootCause→factorId
    expect(pc.focus?.metric).toBe("seg_attain_ess");
    expect(pc.focus?.factorId).toBe("cf-cathode-shortage");
  });

  it("C3 red-bite：改选中对象 → pageContext.entities/selection/focus.factorId 变（页面焦点真驱动·非无视）", () => {
    const s = useSessionStore.getState();
    s.setView("gap-waterfall");
    s.setSelectedObjects([{ objectType: "RootCause", objectId: "cf-cathode-shortage", label: "正极粉短缺" }]);
    const pc1 = useSessionStore.getState().buildContext().pageContext!;
    expect(pc1.selection).toEqual(["cf-cathode-shortage"]);
    expect(pc1.focus?.factorId).toBe("cf-cathode-shortage");

    // 换选另一个根因
    useSessionStore.getState().setSelectedObjects([{ objectType: "RootCause", objectId: "cf-upstream-cut", label: "上游断供" }]);
    const pc2 = useSessionStore.getState().buildContext().pageContext!;
    expect(pc2.selection).toEqual(["cf-upstream-cut"]);
    expect(pc2.focus?.factorId).toBe("cf-upstream-cut");
    expect(pc1.focus?.factorId).not.toBe(pc2.focus?.factorId); // 有牙：改选中 → 派生变 → 下游 args 变
  });

  it("focus 也从 filters 单值派生（列筛选态搭车·metric/base/line）", () => {
    const s = useSessionStore.getState();
    s.setView("ledger");
    s.setFilters({ metric: "seg_attain_ pw", base: "changzhou", tag: ["a", "b"] });
    const pc = useSessionStore.getState().buildContext().pageContext!;
    expect(pc.focus?.metric).toBe("seg_attain_ pw");
    expect(pc.focus?.base).toBe("changzhou");
    // 多值筛选（string[]）不当聚焦标量·诚实不猜
    expect(pc.focus).not.toHaveProperty("tag");
  });

  it("C4 诚实：无选中/无筛选页 → 最小真值（view）·不伪造 entities/focus/drillPath", () => {
    const s = useSessionStore.getState();
    s.setView("dashboard");
    const pc = useSessionStore.getState().buildContext().pageContext!;
    expect(() => PageContextSchema.parse(pc)).not.toThrow();
    expect(pc.view).toBe("dashboard");
    expect(pc.entities).toEqual([]); // 不伪造
    expect(pc.selection).toEqual([]);
    expect(pc.drillPath).toEqual([]); // store 无面包屑态 → 不产·不伪造
    expect(pc.focus).toBeUndefined(); // 无可派生焦点 → 不带 focus（非写死空对象）
  });
});
