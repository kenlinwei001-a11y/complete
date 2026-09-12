import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, type TestApp } from "./helpers.js";

/**
 * WO-YIELD-SERIES-TS-SOURCE · 接缝验收（闭 G-YIELD-SERIES-SOURCE-MISMATCH）。
 *
 * 接缝 = A8 时序 `yield:process`（battery.ts tsGenerators → synthetic/service.ts generateHistory 落 tsPoints，
 * 90 天/Process 实体）→ SolverService.injectYieldDiagnosisSeries（invoke 入口按 solverKey 预注入 args.series）
 * → deriveExtendedArgs → yieldDiagnosis 突变检测循环。
 *
 * 判据：
 *  ① 种一个带已知断点的 ≥37 天 `yield:process` 时序 ⇒ `breakpoint` 非 undefined 且指向所种断点附近；
 *  ② 序列不足/无此工序/基地解析不到 ⇒ 保持 `dataMode:"EMPTY"` 诚实位（行内 note 逐字保留），
 *     绝不降级成 `dataMode:"LIVE"` + `breakpoint:undefined` 的假"查过没异常"；
 *  ③ 调用方直传 series ⇒ 注入不覆盖（加性 R6）。
 */

const DAY_MS = 86400000;
/** BATTERY_SOLVER_PARAMS.forecastStart（synthetic/battery.ts）——generateHistory 的 t0。 */
const T0 = Date.parse("2026-06-10T00:00:00Z");
const HISTORY_DAYS = 90;
/** 所种断点的日索引（0 起）：前 60 天 0.95±0.001，之后 0.80±0.001。 */
const PLANTED_DAY = 60;

const dateOf = (dayIndex: number) => new Date(T0 - (HISTORY_DAYS - dayIndex) * DAY_MS).toISOString().slice(0, 10);

/** 把 (基地,工序) 全部匹配实体的 90 天序列覆写成带已知断点的确定值（绕过 writePoints 的 7 天迟到容差，直写仓储）。 */
async function plantBreakpoint(t: TestApp, baseId: string, processName: string): Promise<string[]> {
  const series = (await t.repos.tsSeries.list("demo", (s) => s.seriesKey === "yield:process"))[0]!;
  const procs = (await t.repos.objects.listByType("demo", "Process")).filter(
    (p) => p.props.name === processName && p.props.baseId === baseId,
  );
  expect(procs.length).toBeGreaterThan(0);
  const entityIds = procs.map((p) => String(p.props.processId)).sort();
  const points = [];
  for (const entityId of entityIds) {
    for (let d = 0; d < HISTORY_DAYS; d++) {
      // ±0.001 交替微噪声：令 prev30 的 sd 稳定 >0（不依赖浮点残差），2σ≈0.002 << 断点跌落 0.15。
      const y = (d < PLANTED_DAY ? 0.95 : 0.8) + (d % 2 === 0 ? 0.001 : -0.001);
      points.push({
        seriesId: series.id,
        entityId,
        ts: `${dateOf(d)}T00:00:00.000Z`,
        values: { yield: y },
        ingestedAt: new Date(0).toISOString(), // 确定性（测试内不重排）
        tick: 0,
      });
    }
  }
  await t.repos.tsPoints.upsert("demo", points);
  return entityIds;
}

describe("WO-YIELD-SERIES-TS-SOURCE · yield_diagnosis 时序真源接缝", () => {
  it("① 接缝主判据：种已知断点的 90 天 yield:process 时序 ⇒ breakpoint 非 undefined 且指向所种断点附近", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await plantBreakpoint(t, "changzhou", "涂布");

    const res = await invokeSolver(t, "yield_diagnosis", { processKey: "涂布", baseName: "常州" });
    expect(res.statusCode).toBe(200);
    const out = res.json().data as {
      breakpoint?: { day: number; drop: number };
      candidates: unknown[];
      dataMode: string;
      provenanceSynthetic?: boolean;
    };
    expect(out.dataMode).toBe("LIVE"); // 真算了（序列 ≥37 天，突变检测循环真进入）
    expect(out.breakpoint).toBeDefined();
    // post7 滑窗在断点前 6 天即可含首个跌落日 ⇒ 报告日 ∈ [所种日-7, 所种日]
    expect(out.breakpoint!.day).toBeGreaterThanOrEqual(PLANTED_DAY - 7);
    expect(out.breakpoint!.day).toBeLessThanOrEqual(PLANTED_DAY);
    expect(out.breakpoint!.drop).toBeGreaterThan(0.01); // 真实跌落方向（prev7 > post7）
    // demo 种子时序 origin=SYNTHETIC ⇒ 合成 provenance 披露，不冒充实测
    expect(out.provenanceSynthetic).toBe(true);
  });

  it("②a 序列不足诚实位：无此工序（series 无法注入）⇒ dataMode:EMPTY + 行内 note 逐字保留", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await invokeSolver(t, "yield_diagnosis", { processKey: "不存在工序", baseName: "常州" });
    expect(res.statusCode).toBe(200);
    const out = res.json().data as { breakpoint?: unknown; candidates: unknown[]; dataMode: string; provenanceSynthetic?: boolean; note?: string };
    expect(out.dataMode).toBe("EMPTY");
    expect(out.breakpoint).toBeUndefined();
    expect(out.candidates).toEqual([]);
    expect(out.provenanceSynthetic).toBe(true);
    // 行内警告逐字保留（extended.ts yieldDiagnosis EMPTY 分支 note）
    expect(out.note).toBe("无逐日良率时序输入（series 空）·无法诊断突变——不以写死序列冒充真算");
  });

  it("②b 序列不足诚实位：基地解析不到 ⇒ 不拿全域冒充该基地，保持 EMPTY", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await invokeSolver(t, "yield_diagnosis", { processKey: "涂布", baseName: "不存在基地" });
    expect(res.statusCode).toBe(200);
    const out = res.json().data as { dataMode: string; breakpoint?: unknown };
    expect(out.dataMode).toBe("EMPTY");
    expect(out.breakpoint).toBeUndefined();
  });

  it("②c 序列不足诚实位：时序子系统无该序列（未播种租户）⇒ EMPTY（非假 LIVE）", async () => {
    const t = await makeApp(); // 不 seedBattery ⇒ 无 yield:process series
    const res = await invokeSolver(t, "yield_diagnosis", { processKey: "涂布" });
    expect(res.statusCode).toBe(200);
    const out = res.json().data as { dataMode: string; breakpoint?: unknown };
    expect(out.dataMode).toBe("EMPTY");
    expect(out.breakpoint).toBeUndefined();
  });

  it("③ 加性：调用方直传 series ⇒ 注入不覆盖（直传序列的断点照旧检出）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 直传 50 天、第 35 天起跌（0.95→0.88）——与库内时序无关，验注入让位。
    // 检测循环下限 i=30：post7 窗在 i=30 已含跌落日 ⇒ breakpoint ∈ [30,35]；事件种在 32（距离 ≤2 内）。
    const series = Array.from({ length: 50 }, (_, i) => ({ day: i, yield: i < 35 ? 0.95 : 0.88 }));
    const res = await invokeSolver(t, "yield_diagnosis", { series, events: [{ day: 32, kind: "换料", source: "S1" }] });
    expect(res.statusCode).toBe(200);
    const out = res.json().data as { breakpoint?: { day: number }; candidates: { kind: string }[]; dataMode: string; provenanceSynthetic?: boolean };
    expect(out.dataMode).toBe("LIVE");
    expect(out.breakpoint).toBeDefined();
    expect(out.breakpoint!.day).toBeGreaterThanOrEqual(30);
    expect(out.breakpoint!.day).toBeLessThanOrEqual(35);
    expect(out.candidates[0]!.kind).toBe("换料");
    expect(out.provenanceSynthetic).toBeUndefined(); // 直传 series 无合成披露键（逐字节加性）
  });
});
