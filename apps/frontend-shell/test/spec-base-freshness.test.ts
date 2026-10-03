import { describe, expect, it } from "vitest";
import { baseFreshnessText, readBaseFreshness } from "../src/views/sim/unified/metricWallModel";

/**
 * ══ WO-3ROOT-P2 · D2 屏上句（前端侧接缝：**后端回包 → 屏上措辞**）════════════════════
 *
 * 咬的是最后那一跳：后端 `/sessions/:id/metric-series` 回包里的 `baseFreshness`
 * （三态 + 数字）→ 状态条与导出物上那**一句**。
 *
 * ⛔ 本档不本地重算规格、不做容差：句子里的数必须**逐字**来自回包（A8 判据的后半句
 * 「屏上句必须来自后端数字」——本档咬「数字不落地、不四舍五入、不另算」这一半；
 * 真服务 + 真浏览器那一半见 PRD §九 NOT-MEASURED）。
 */
describe("WO-3ROOT-P2 · 规格基值时效的屏上句（三个态 + 缺席，四个互不串味）", () => {
  it("STALE：句子必须带后端的两个数与基准时刻（不许吞掉 N）", () => {
    const f = readBaseFreshness({
      state: "STALE",
      sourceRevision: 7,
      currentRevision: 9,
      asOf: "2026-10-03T00:00:00.000Z",
      staleCells: [{ objectId: "obj_order_SO-3391", stateVar: "demandPressure", specKey: "order_demand_pressure", baseValue: 60, currentValue: 90 }],
      staleCellCount: 1,
      evaluatedCellCount: 25,
      reason: null,
    });
    expect(f).not.toBeNull();
    const s = baseFreshnessText(f);
    expect(s).toContain("已过期");
    expect(s).toContain("1/25");            // ← 后端数字原样落地（N=1，A8 的判据数）
    expect(s).toContain("2026-10-03T00:00:00.000Z"); // ← as-of 上屏
  });

  it("FRESH：说「新鲜」，且**不许**出现过期措辞（对照臂：屏上不出现过期句）", () => {
    const f = readBaseFreshness({ state: "FRESH", staleCellCount: 0, evaluatedCellCount: 25, asOf: "2026-10-03T00:00:00.000Z", reason: null });
    const s = baseFreshnessText(f);
    expect(s).toContain("新鲜");
    expect(s).not.toContain("已过期");
  });

  it("UNKNOWN（第三态）：说「判不了」并带上后端给的理由 —— ⛔ 不许读作新鲜", () => {
    const f = readBaseFreshness({ state: "UNKNOWN", staleCellCount: 0, evaluatedCellCount: 0, asOf: "", reason: "这条会话没有源指纹（baseSnapshotSource 缺席）" });
    const s = baseFreshnessText(f);
    expect(s).toContain("判不了");
    expect(s).not.toContain("新鲜");
    expect(s).toContain("没有源指纹");
  });

  it("缺席 / 形状不认识 ⇒ null（前端没拿到），与 UNKNOWN（后端说判不了）分开说", () => {
    expect(readBaseFreshness(null)).toBeNull();
    expect(readBaseFreshness({})) .toBeNull();          // 没有 state 字段
    expect(readBaseFreshness({ state: "FRESHISH" })).toBeNull(); // 金丝雀：不是合法态就不认（不是"名字里有 FRESH 就算"）
    expect(baseFreshnessText(null)).toContain("时效读不出来");
    expect(baseFreshnessText(null)).not.toContain("新鲜");
  });

  it("金丝雀·读法活着：同一份回包里换一个 state，屏上句必须跟着换（不是常量）", () => {
    const mk = (state: string) => readBaseFreshness({ state, staleCellCount: 2, evaluatedCellCount: 25, asOf: "T", reason: "r" });
    const a = baseFreshnessText(mk("STALE"));
    const b = baseFreshnessText(mk("FRESH"));
    const c = baseFreshnessText(mk("UNKNOWN"));
    expect(new Set([a, b, c]).size).toBe(3);
  });
});
