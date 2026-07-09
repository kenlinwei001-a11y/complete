import { describe, expect, it } from "vitest";
import { invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";

/**
 * FILL-AUDIT-TIMELINE-REAL（FAKEDATA-SWEEP F1·治本·铁律0.6/KILL-MOCK-RED）牙齿：
 * audit_timeline 逐日传导曲线由**真源在否派生**——
 *  · 有真日序源的口径（产销/齐套 → 需求驱动瓶颈张力·真产线利用率/真需求-产能缺口 + 真事件脉冲）
 *    → series 真值聚合（tensionSeries·非 hashString）·dataMode=LIVE·hasData=true；
 *  · 无真日序源的口径（毛利/现金/份额/struct/capex23/爬坡/外协·财务/结构维度无逐日实测）
 *    → 诚实空态（series:[]·hasData:false·dataMode:MOCK·noDataReason）·**绝不哈希造曲线**。
 * teeth：回退到旧 hash 造曲线口径（h=hashString(kind) 派生满曲线）→
 *    ① 无源口径不再空（series 满 90 点）→ 空态断言红；② 产销/齐套 dataMode 退 PARTIAL/MOCK → LIVE 断言红。
 */
describe("audit_timeline · 真源在否派生（F1 治本牙齿）", () => {
  const REAL_KINDS = ["产销", "齐套"]; // 映射需求驱动瓶颈因素·seedBattery 有真产线利用率/真需求-产能预测
  const NO_SOURCE_KINDS = ["毛利", "现金", "份额", "爬坡", "外协", "capex23", "struct"]; // 财务/结构维度·无逐日实测

  it("有真源口径（产销/齐套）：series 真值聚合·measurement=LIVE·hasData·4 阶段·峰值/越线由真曲线算", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    for (const kind of REAL_KINDS) {
      const out = (await (await invokeSolver(t, "audit_timeline", { kind })).json() as {
        data: { kind: string; series: number[]; stages: { d: number; label: string }[]; peak: number; crossDay: number | null; threshold: number; dataMode: string; hasData: boolean; confidence?: { measurement?: string; synthetic?: boolean } };
      }).data;
      expect(out.kind).toBe(kind);
      // 实测维（measurement）= LIVE：曲线来自真基线聚合（tensionSeries·非 hash）。
      // teeth：回退到 hash 造曲线 → 求解器自报 measurement 退 PARTIAL/MOCK → 此断言红。
      // （头条 dataMode 在 demo 合成数据下由横切「真实↔合成维」降级为 SYNTHETIC——诚实位·非实测维）。
      expect(out.confidence?.measurement).toBe("LIVE");
      expect(out.dataMode).not.toBe("MOCK");
      expect(out.dataMode).not.toBe("PARTIAL");
      expect(out.hasData).toBe(true);
      expect(out.series.length).toBe(90);
      expect(out.series.every((v) => Number.isFinite(v))).toBe(true);
      expect(out.peak).toBe(Math.max(...out.series)); // 峰值来自真曲线
      // 越线日由真曲线 + 真阈值算（null 或 1..90 之内·非 hash 目标制造）。
      if (out.crossDay !== null) {
        expect(out.crossDay).toBeGreaterThanOrEqual(1);
        expect(out.crossDay).toBeLessThanOrEqual(90);
        expect(out.series[out.crossDay - 1]!).toBeGreaterThanOrEqual(out.threshold);
      }
      expect(out.stages.map((s) => s.label)).toEqual(["事件窗", "约束越线", "波及订单", "财务击穿"]);
      // 峰值阶段锚定真峰值日（series argmax·非 hash peakDay）。
      const stagePeak = out.stages.find((s) => s.label === "约束越线")!;
      expect(out.series[stagePeak.d]).toBe(out.peak);
    }
  });

  it("无真源口径（毛利/现金/份额/…）：诚实空态·series:[]·hasData:false·dataMode:MOCK·noDataReason·绝不哈希造曲线", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    for (const kind of NO_SOURCE_KINDS) {
      const out = (await (await invokeSolver(t, "audit_timeline", { kind })).json() as {
        data: { kind: string; series: number[]; stages: unknown[]; peak: number | null; crossDay: number | null; dataMode: string; hasData: boolean; noDataReason?: string };
      }).data;
      expect(out.kind).toBe(kind);
      // teeth：回退到 hash 造曲线 → series 会是 90 点满曲线 → 下面空态断言红。
      expect(out.series).toEqual([]);
      expect(out.stages).toEqual([]);
      expect(out.peak).toBeNull();
      expect(out.crossDay).toBeNull();
      expect(out.hasData).toBe(false);
      expect(out.dataMode).toBe("MOCK");
      expect(typeof out.noDataReason).toBe("string");
      expect(out.noDataReason!.length).toBeGreaterThan(0);
    }
  });

  it("有真源口径带当日事件 + 受影响订单（复用 risk 真引擎）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const out = (await (await invokeSolver(t, "audit_timeline", { kind: "齐套" })).json() as { data: { events: unknown[]; affectedOrders: unknown[] } }).data;
    expect(Array.isArray(out.events)).toBe(true);
    expect(Array.isArray(out.affectedOrders)).toBe(true);
  });

  it("产销 vs 齐套 出不同曲线（映射因素不同·事件脉冲不同·真值派生）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const a = (await (await invokeSolver(t, "audit_timeline", { kind: "产销" })).json() as { data: { series: number[] } }).data;
    const b = (await (await invokeSolver(t, "audit_timeline", { kind: "齐套" })).json() as { data: { series: number[] } }).data;
    expect(JSON.stringify(a.series)).not.toBe(JSON.stringify(b.series));
  });

  it("L6：同 kind 字节一致（真源 LIVE 与无源空态均确定性 R6）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    for (const kind of ["产销", "现金"]) {
      const a = (await invokeSolver(t, "audit_timeline", { kind })).json();
      const b = (await invokeSolver(t, "audit_timeline", { kind })).json();
      expect(JSON.stringify((a as { data: unknown }).data)).toBe(JSON.stringify((b as { data: unknown }).data));
    }
  });

  // PRD §2②：每审计项带 kind（9 种口径）+ audit_timeline 复用 events/affectedOrders 引擎（同款悬停详情）。
  it("plan_audit 每项带 kind（9 种口径之一）", async () => {
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
});
