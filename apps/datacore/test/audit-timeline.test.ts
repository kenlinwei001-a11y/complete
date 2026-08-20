import { describe, expect, it } from "vitest";
import { invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";
import { AUDIT_KIND_LIVE_SOURCES } from "@platform/contracts";

/**
 * wave④ audit/generate · 每审计项独立时序（audit_timeline）：按 kind 出 90 天逐日 series + 4 阶段，
 * 与产能推演同款逐日交互，形状由 kind hash 确定性派生（R14 无 per-kind 业务常数，R6 字节一致）。
 */
describe("audit_timeline 每审计项时序（L1 + L6）", () => {
  it("L1：按 kind 出 90 天逐日 series + 4 阶段 + 越线日/峰值", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const out = (await (await invokeSolver(t, "audit_timeline", { kind: "毛利" })).json() as { data: { kind: string; series: number[]; stages: { d: number; label: string }[]; peak: number; threshold: number } }).data;
    expect(out.kind).toBe("毛利");
    expect(out.series.length).toBe(90);
    expect(out.series.every((v) => v >= 40 && v <= 97)).toBe(true); // clamp[40,97]
    expect(out.stages.length).toBe(4);
    expect(out.stages.map((s) => s.label)).toEqual(["事件窗", "约束越线", "波及订单", "财务击穿"]);
    expect(out.peak).toBe(Math.max(...out.series));
  });

  it("L1：不同 kind 出不同曲线（形状 kind 派生）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const a = (await (await invokeSolver(t, "audit_timeline", { kind: "毛利" })).json() as { data: { series: number[] } }).data;
    const b = (await (await invokeSolver(t, "audit_timeline", { kind: "齐套" })).json() as { data: { series: number[] } }).data;
    expect(JSON.stringify(a.series)).not.toBe(JSON.stringify(b.series));
  });

  it("L6：同 kind 字节一致", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const a = (await invokeSolver(t, "audit_timeline", { kind: "现金" })).json();
    const b = (await invokeSolver(t, "audit_timeline", { kind: "现金" })).json();
    expect(JSON.stringify((a as { data: unknown }).data)).toBe(JSON.stringify((b as { data: unknown }).data));
  });

  // PRD §2②：每审计项带 kind（9 种口径）+ audit_timeline 复用 events/affectedOrders 引擎（同款悬停详情）。
  it("L1：plan_audit 每项带 kind（9 种口径之一）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const out = (await (await invokeSolver(t, "plan_audit", {})).json() as { data: { H: { id: string; kind?: string }[]; M: { id: string; kind?: string }[]; S: { id: string; kind?: string }[] } }).data;
    const KINDS = ["产销", "毛利", "齐套", "现金", "份额", "爬坡", "外协", "capex23", "struct"];
    const all = [...out.H, ...out.M, ...out.S];
    expect(all.length).toBeGreaterThan(0);
    for (const item of all) {
      expect(item.kind).toBeTruthy();
      expect(KINDS).toContain(item.kind);
    }
    // 已知映射抽样：X03→毛利 · X04→齐套 · X05→现金
    const x03 = all.find((i) => i.id === "X03" || i.id === "S-X03");
    if (x03) expect(x03.kind).toBe("毛利");
  });

  it("L1：audit_timeline 带当日事件 + 受影响订单（复用 risk 引擎）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const out = (await (await invokeSolver(t, "audit_timeline", { kind: "齐套" })).json() as { data: { events: unknown[]; affectedOrders: unknown[] } }).data;
    expect(Array.isArray(out.events)).toBe(true);
    expect(Array.isArray(out.affectedOrders)).toBe(true);
  });
});

/**
 * WO-AUDIT-TIMELINE-LIVESOURCE（断点 G-AUDIT-TIMELINE-HASH-PROJECTION 数据半）：
 * 病灶 = auditTimeline series 100% 由 hashString(kind) 形状投影（同一 kind 恒同一条线·改 kind 名线就变·
 * 与真实数据无关）。修复 = 有真 A8 日序列源的 kind（contracts `AUDIT_KIND_LIVE_SOURCES` 单一出处·实测只有
 * 「产销」→ attainment:base）接真源升 LIVE；无真源 kind 保持 MOCK 哈希投影 + 诚实披露（不冒充 LIVE·不硬造源）。
 *
 * 断言形态说明（WO 要求「按真源语义定」）：真源语义下 series = f(真 tsPoints) · kind 名零参与，
 * 故主判据 A2 用「同一真源数据换一个 kind 名 ⇒ 除 echo 的 kind 字段外**全量输出字节一致**」直咬旧病灶
 * （旧实现里 hashString(新名) ≠ hashString(旧名) ⇒ series 必变 → 红）。
 */
describe("WO-AUDIT-TIMELINE-LIVESOURCE · 真源接线（产销 LIVE · 其余 MOCK 诚实披露）", () => {
  it("A1 接缝：产销 → dataMode LIVE + source 披露 attainment:base + series 为真逐日数据", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const out = (await (await invokeSolver(t, "audit_timeline", { kind: "产销" })).json() as {
      data: {
        kind: string; series: number[]; stages: { d: number; label: string }[]; peak: number; threshold: number;
        dataMode: string; provenanceSynthetic: boolean; note: string;
        source?: { seriesKey: string; measure: string; days: number };
      };
    }).data;
    expect(out.dataMode).toBe("LIVE");
    expect(out.source).toEqual({ seriesKey: "attainment:base", measure: "attainment", days: out.series.length });
    expect(out.series.length).toBe(90); // 种子 90 天历史全进窗口
    expect(out.series.every((v) => v >= 40 && v <= 97)).toBe(true); // 显示带不变
    expect(out.stages.map((s) => s.label)).toEqual(["事件窗", "约束越线", "波及订单", "财务击穿"]);
    expect(out.peak).toBe(Math.max(...out.series));
    // provenance 维如实标：demo 世界 tsSeries.origin=SYNTHETIC → true（measurement 维 LIVE 不动·两维正交·不谎报实测）。
    expect(out.provenanceSynthetic).toBe(true);
    expect(out.note).toContain("attainment:base");
    // 真逐日数据不是形状投影的恒带：90 天值不得全同。
    expect(new Set(out.series).size).toBeGreaterThan(1);
  }, 120000);

  it("A2 验收判据：同一真源数据换 kind 名 ⇒ series 逐字节相同（不再由 hashString(kind) 派生）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const base = (await (await invokeSolver(t, "audit_timeline", { kind: "产销" })).json() as { data: Record<string, unknown> }).data;
    expect(base.dataMode).toBe("LIVE"); // 前提：本测咬的是 LIVE 半
    // 改名仿真：把同一条真源映射登记到一个新 kind 名下（等价「产销」改名后仍走同一真源）。
    const table = AUDIT_KIND_LIVE_SOURCES as Record<string, (typeof AUDIT_KIND_LIVE_SOURCES)[keyof typeof AUDIT_KIND_LIVE_SOURCES]>;
    table["产销·改名"] = table["产销"];
    try {
      const renamed = (await (await invokeSolver(t, "audit_timeline", { kind: "产销·改名" })).json() as { data: Record<string, unknown> }).data;
      // 旧病灶下：hashString("产销·改名") ≠ hashString("产销") ⇒ series/peak/crossDay/stages/repBase 全变 → 红。
      // 修复后：整条派生链零 kind 参与 ⇒ 除 echo 的 kind 字段外**全量输出**字节一致（含 events/affectedOrders）。
      expect({ ...renamed, kind: base.kind }).toEqual(base);
    } finally {
      delete table["产销·改名"];
    }
  }, 120000);

  it("A3 独立 oracle：series 逐日 = clamp(round(40+(target−当日跨基地均值)×k),40,97)（映射表实参·非引擎自证）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const src = AUDIT_KIND_LIVE_SOURCES["产销"]!;
    // 独立重算：绕过求解器，直接读仓储真点按映射表公式投影（oracle 与被测实现不共享代码路径）。
    const series = (await t.repos.tsSeries.list("demo", (s) => s.seriesKey === src.seriesKey))[0];
    expect(series, "种子应含 attainment:base 序列").toBeTruthy();
    const rows = await t.repos.tsPoints.list("demo", series!.id);
    expect(rows.length).toBeGreaterThan(0);
    const byDate = new Map<string, { sum: number; n: number }>();
    for (const p of rows) {
      const v = p.values[src.measure];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      const d = p.ts.slice(0, 10);
      const e = byDate.get(d) ?? { sum: 0, n: 0 };
      e.sum += v;
      e.n += 1;
      byDate.set(d, e);
    }
    const dates = [...byDate.keys()].sort().slice(-90);
    const oracle = dates.map((d) => {
      const e = byDate.get(d)!;
      return Math.min(97, Math.max(40, Math.round(40 + (src.target - e.sum / e.n) * src.k)));
    });
    const out = (await (await invokeSolver(t, "audit_timeline", { kind: "产销" })).json() as { data: { series: number[] } }).data;
    expect(out.series).toEqual(oracle);
  }, 120000);

  it("A4 MOCK 半不回退：无真源 kind（毛利）仍 dataMode MOCK + 哈希投影披露 + 无 source 字段", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const out = (await (await invokeSolver(t, "audit_timeline", { kind: "毛利" })).json() as {
      data: { series: number[]; dataMode: string; provenanceSynthetic: boolean; note: string; source?: unknown };
    }).data;
    expect(out.dataMode).toBe("MOCK");
    expect(out.provenanceSynthetic).toBe(true);
    expect(out.note).toContain("形状投影");
    expect(out.source).toBeUndefined(); // 不硬造数据源·不冒充 LIVE
    expect(out.series.length).toBe(90);
    expect(out.series.every((v) => v >= 40 && v <= 97)).toBe(true);
    // R6：MOCK 半同入参字节一致（本测试文件 L6 用例以「现金」复测同一条性质）。
    const again = (await (await invokeSolver(t, "audit_timeline", { kind: "毛利" })).json() as { data: unknown }).data;
    expect(JSON.stringify(again)).toBe(JSON.stringify(out));
  }, 120000);
});
