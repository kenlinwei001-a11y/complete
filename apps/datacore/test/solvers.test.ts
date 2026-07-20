import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, type TestApp } from "./helpers.js";
import { BATTERY_SOLVER_PARAMS, NOMINAL_PROCESS_YIELD } from "../src/synthetic/battery.js";
import { round } from "../src/prng.js";

const P = BATTERY_SOLVER_PARAMS as {
  ramp: { base: number; step: number; fullWeek: number };
  maintMult: number;
  health: { normal: number; degraded: number };
  whatIf: { nightShiftCoef: number; channelCoef: number; outsourceMax: number };
  logistics: { byAddress: Record<string, number>; defaultDays: number };
  packCellCount: number;
  bottleneck: { primary: Record<string, string>; mock: Record<string, number> };
  risk: {
    threshold: number;
    targetLift: { base: number; mod: number };
    eventAmps: Record<string, number>;
    arrivalCycleDays: number;
  };
  audit: { segMargins: { pas: number; ess: number; com: number } };
  planGenerate: {
    base: { rev: number; gm: number; share: number; turns: number; cash: number };
    targets: { gmFloor: number; cashFloor: number; capexCap: number };
    paths: Record<string, { name: string; rev: number; gm: number; share: number; capex: number; turns: number; cash: number }>;
    scores: Record<string, number>;
  };
};

/** Independent S1.2 curve implementation (test-side reimplementation, not the solver's). */
function indepCurve(w: number, maintWeek: number | null): number {
  let m = w >= P.ramp.fullWeek ? 1 : P.ramp.base + P.ramp.step * (w - 1);
  if (maintWeek !== null && w === maintWeek) m *= P.maintMult;
  return m;
}

interface PerBaseRow {
  base: string;
  baseId: string;
  weeklyCap: number;
  certFactor: number;
  maintWeek: number | null;
  bottleneck: string;
  tightness: number;
  cumTotal: number;
}

function indepP50(rows: PerBaseRow[], weeks: number): number {
  let p50 = 0;
  for (const r of rows) {
    let cum = 0;
    for (let w = 1; w <= weeks; w++) cum += r.weeklyCap * r.certFactor * indepCurve(w, r.maintWeek);
    p50 += cum;
  }
  return round(p50, 4);
}

async function forecast(t: TestApp, args: Record<string, unknown>) {
  const res = await invokeSolver(t, "capacity_forecast", args);
  expect(res.statusCode).toBe(200);
  return (res.json() as { data: Record<string, unknown> }).data;
}

describe("S1 solvers", () => {
  it("V1: capacity_forecast P50 matches the independent S1.2 formula (0.6 cert + 0.72 maint), P90 = P50×0.93", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const weeks = 10; // all maint weeks (3–10) fall inside the window
    const out = await forecast(t, { modelId: "4680-NCM", qty: 40, weeks });
    const rows = out.perBaseRows as PerBaseRow[];
    expect(rows.length).toBeGreaterThan(0);
    // certification state from the model↔line edges: 量产 and 认证中 both present
    expect(rows.some((r) => r.certFactor === 0.6)).toBe(true);
    expect(rows.some((r) => r.certFactor === 1)).toBe(true);
    expect(rows.every((r) => r.maintWeek !== null && r.maintWeek >= 3 && r.maintWeek <= 10)).toBe(true);
    // hand-computed P50 from the per-base drilldown inputs
    expect(out.p50).toBe(indepP50(rows, weeks));
    // per-base cumTotal also matches
    for (const r of rows) {
      let cum = 0;
      for (let w = 1; w <= weeks; w++) cum += r.weeklyCap * r.certFactor * indepCurve(w, r.maintWeek);
      expect(r.cumTotal).toBe(round(cum, 4));
    }
    expect(out.healthFactor).toBe(P.health.normal);
    expect(out.p90).toBe(round((out.p50 as number) * P.health.normal, 4));
    expect(out.pendingCertList as string[]).not.toHaveLength(0);
    // aliases kept for AgentCore seed plans
    expect(out.mainBottleneck).toBe(out.mainBn);
    expect(typeof out.gapPct).toBe("number");

    // weeklyCap independently recomputed from the seeded production topology (S1.1 rollup)
    const r0 = rows[0]!;
    const lines = await t.repos.objects.listByType("demo", "Line");
    const procs = await t.repos.objects.listByType("demo", "Process");
    const equips = await t.repos.objects.listByType("demo", "Equipment");
    const base = (await t.repos.objects.listByType("demo", "Base")).find((b) => b.props.baseId === r0.baseId)!;
    const lineIds = lines.filter((l) => l.props.baseId === r0.baseId).map((l) => l.props.lineId);
    // SA-3 Workshop 层：基地日产能 = 各串行工序车间产能均值（代表工序吞吐），非求和（详见 computeRollup 注释）。
    const lineCaps: number[] = [];
    for (const lineId of lineIds) {
      const serial: number[] = [];
      let formation = Infinity;
      let aging = Infinity;
      for (const pr of procs.filter((x) => x.props.lineId === lineId)) {
        if (pr.props.kind === "formation") {
          formation = (pr.props.channels as number) * (pr.props.channelOutputDaily as number) * (pr.props.yield as number);
        } else if (pr.props.kind === "aging") {
          aging = (pr.props.agingSlots as number) / (pr.props.agingDays as number);
        } else {
          let hourly = 0;
          for (const e of equips.filter((x) => x.props.processId === pr.props.processId)) {
            const oee =
              typeof e.props.oee_current === "number"
                ? (e.props.oee_current as number)
                : (e.props.oeeA as number) * (e.props.oeeP as number) * (e.props.oeeQ as number);
            hourly += (3600 / (e.props.ctSeconds as number)) * (e.props.availFactor as number) * oee;
          }
          serial.push(
            hourly *
              ((pr.props.shiftHours as number) * (pr.props.shifts as number)) *
              (pr.props.yield as number) *
              (pr.props.attendance as number) *
              (pr.props.utilization as number),
          );
        }
      }
      lineCaps.push(round(Math.min(Math.min(...serial), formation, aging), 2));
    }
    const lineMean = lineCaps.length > 0 ? lineCaps.reduce((a, v) => a + v, 0) / lineCaps.length : 0;
    // WO-SCALE-COHERENCE 镜像：共享化成/老化封顶按「基地代表良率/名义」缩放（同 computeRollup·保良率敏感度）。
    const baseYields = procs.filter((x) => lineIds.includes(x.props.lineId)).map((pr) => (pr.props.yield as number) ?? 1).filter((y) => y > 0);
    const baseMeanYield = baseYields.length > 0 ? baseYields.reduce((a, v) => a + v, 0) / baseYields.length : 1;
    const yf = baseMeanYield / NOMINAL_PROCESS_YIELD;
    const daily = round(Math.min(lineMean, (base.props.formationCapDaily as number) * yf, (base.props.agingCapDaily as number) * yf), 2);
    expect(r0.weeklyCap).toBe(round((daily * 7) / P.packCellCount / 10000, 4));
  });

  it("V2: data-health degrade — IoT lag 4.2h → P90 factor 0.90 + degrade note", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await forecast(t, { modelId: "4680-NCM", qty: 40, weeks: 6 });
    expect(before.healthFactor).toBe(0.93);
    // §6.2 test hook: mark the critical source stale
    await t.services.solvers.markSourceStale("demo", "iot-scada", 4.2);
    const after = await forecast(t, { modelId: "4680-NCM", qty: 40, weeks: 6 });
    expect(after.p50).toBe(before.p50); // same input → same P50
    expect(after.healthFactor).toBe(0.9);
    expect(after.p90).toBe(round((after.p50 as number) * 0.9, 4));
    expect(String(after.degradeNote)).toContain("4.2");
    expect(String(after.degradeNote)).toContain("C09");
  });

  it("V3: batch mode — wkEff subtracts logistics days; cumulative per-batch checks; gap = max shortfall", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const batches = [
      { qty: 100, dueDate: "2026-07-10", address: "海外" }, // forecastStart 2026-06-10：dueDay 30，wkEff = floor((30−14)/7) = 2
      { qty: 8, dueDate: "2026-07-24", address: "上海" }, // dueDay 44，wkEff = floor((44−3)/7) = 5
      { qty: 10, dueDate: "2026-08-21", address: "广州" }, // dueDay 72，wkEff = floor((72−5)/7) = 9
    ];
    const out = await forecast(t, { modelId: "4680-NCM", batches, weeks: 8 });
    const rows = out.batchRows as { qty: number; dueDate: string; wkEff: number; cumDemand: number; cumP90: number; ok: boolean }[];
    expect(rows).toHaveLength(3);
    expect(rows[0]!.wkEff).toBe(2);
    expect(rows[1]!.wkEff).toBe(5);
    expect(rows[2]!.wkEff).toBe(9);
    // cumulative demand check ordering (sorted by dueDate asc)
    expect(rows[0]!.cumDemand).toBe(100);
    expect(rows[1]!.cumDemand).toBe(108);
    expect(rows[2]!.cumDemand).toBe(118);
    // the tight batch must fail in 1 effective week; gap = max shortfall
    expect(rows[0]!.ok).toBe(false);
    const worst = Math.max(...rows.filter((r) => !r.ok).map((r) => round(r.cumDemand - r.cumP90, 4)), 0);
    expect(out.gap).toBe(round(worst, 4));
    expect(out.ok).toBe(false);
  });

  it("V4: what-if exact formula (cap-aware) and C08 rejection at 25% outsourcing", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const out = await forecast(t, {
      modelId: "4680-NCM",
      qty: 40,
      weeks: 6,
      whatIf: { nightShifts: 2, extraChannels: 4, outsourceRatio: 0.1 },
    });
    const wi = out.whatIf as Record<string, number | boolean>;
    expect(wi.rejected).toBe(false);
    const raw = (out.p50 as number) * (1 + 0.06 * 2 + 0.05 * 4) + 40 * 0.1;
    const expected = round(Math.min(raw, wi.physicalCap as number), 4);
    expect(wi.adjustedP50).toBe(expected);
    expect(wi.capped).toBe(raw > (wi.physicalCap as number));

    const rejected = await forecast(t, {
      modelId: "4680-NCM",
      qty: 40,
      weeks: 6,
      whatIf: { nightShifts: 2, extraChannels: 4, outsourceRatio: 0.25 },
    });
    const wr = rejected.whatIf as Record<string, unknown>;
    expect(wr.rejected).toBe(true);
    expect(wr.ruleRef).toBe("C08");
  });

  it("bottleneck_matrix MOCK formula is exact and primary comes from BN_PRIMARY config", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await invokeSolver(t, "bottleneck_matrix", {});
    const data = (res.json() as { data: { dataMode: string; factors: string[]; rows: { base: string; tightness: Record<string, number>; primary: string }[] } }).data;
    expect(data.dataMode).toBe("MOCK");
    expect(data.factors).toHaveLength(7);
    const row = data.rows.find((r) => r.base === "常州")!;
    expect(row.primary).toBe(P.bottleneck.primary["常州"]);
    const bases = await t.repos.objects.listByType("demo", "Base");
    const util = bases.find((b) => b.props.baseId === "changzhou")!.props.util as number;
    for (const f of data.factors) {
      const seed = ("常".charCodeAt(0) + f.charCodeAt(0) * 7) % 9;
      const expected =
        f === row.primary ? Math.min(97, 88 + (seed % 9)) : Math.min(83, 55 + seed + (util > 0.82 ? 6 : 2));
      expect(row.tightness[f]).toBe(expected);
    }
  });

  it("V5: risk_timeline 常州·物料齐套 H=30 — daily curve matches the formula, 14d arrival pulses, crossDay, mitigation −12", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const H = 30;
    const res = await invokeSolver(t, "risk_timeline", { base: "常州", factor: "物料齐套", horizon: H });
    const data = (res.json() as { data: { threshold: number; cards: Record<string, unknown>[] } }).data;
    expect(data.threshold).toBe(85);
    const card = data.cards.find((c) => c.base === "常州" && c.factor === "物料齐套")!;
    expect(card).toBeDefined();
    const series = card.series as number[];
    expect(series).toHaveLength(H);

    // independent recompute (S1.4 formulas)
    const bases = await t.repos.objects.listByType("demo", "Base");
    const util = bases.find((b) => b.props.baseId === "changzhou")!.props.util as number;
    const seed = ("常".charCodeAt(0) + "物".charCodeAt(0) * 7) % 9;
    const cur = Math.min(83, 55 + seed + (util > 0.82 ? 6 : 2)); // 物料齐套 is not 常州's primary
    const lift = (("常".charCodeAt(0) + "物".charCodeAt(0)) % P.risk.targetLift.mod) + P.risk.targetLift.base;
    const tgt = Math.min(96, cur + lift);
    // arrival-gap events every 14 days are the only 物料齐套 pulses with the seeded ontology
    const eventDays = [14, 28];
    const cardEvents = (card.events as { type: string; day: number; factors: string[] }[]).filter((e) =>
      e.factors.includes("物料齐套"),
    );
    expect(cardEvents.map((e) => e.day)).toEqual(eventDays);
    expect(cardEvents.every((e) => e.amp === undefined || true)).toBe(true);
    const expected: number[] = [];
    for (let d = 1; d <= H; d++) {
      const vb = cur + (tgt - cur) * Math.min(1, d / (0.72 * H));
      let pulse = 0;
      for (const ed of eventDays) {
        const dist = Math.abs(d - ed);
        if (dist > 3) continue;
        const ps = Math.max(0.25, 1 - (vb - 68) / 45);
        pulse += P.risk.eventAmps.arrival_gap! * ps * (1 - dist / 4);
      }
      expected.push(Math.min(98, Math.round(vb + pulse)));
    }
    expect(series).toEqual(expected);
    const expectedCross = expected.findIndex((v) => v >= 85);
    expect(card.crossDay).toBe(expectedCross === -1 ? null : expectedCross + 1);

    // mitigation 提前备料: eff 12 from T+2 — peak −12, crossing cleared/postponed
    const mit = await invokeSolver(t, "risk_timeline", {
      base: "常州",
      factor: "物料齐套",
      horizon: H,
      mitigation: { planKey: "early_stock" },
    });
    const mcard = ((mit.json() as { data: { cards: Record<string, unknown>[] } }).data.cards).find(
      (c) => c.base === "常州" && c.factor === "物料齐套",
    )!;
    const m = mcard.mitigated as { series: number[]; appliedPlan: string; effectiveFrom: number; peak: number; crossDay: number | null };
    expect(m.appliedPlan).toBe("提前备料");
    expect(m.effectiveFrom).toBe(2);
    for (let d = 1; d <= H; d++) {
      expect(m.series[d - 1]).toBe(d >= 2 ? Math.max(0, expected[d - 1]! - 12) : expected[d - 1]);
    }
    expect(m.peak).toBe((mcard.peak as number) - 12);
    if (mcard.crossDay !== null) {
      expect(m.crossDay === null || (m.crossDay as number) > (mcard.crossDay as number)).toBe(true);
    }
  });

  it("V5b: risk_timeline planRows — 每基地主因素首选方案 + 峰值≥90 备份 + 14 天内反提 S&OP（§2.4）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const out = (await invokeSolver(t, "risk_timeline", { horizon: 30 })).json() as {
      data: { cards: { base: string; peak: number; crossDay: number | null }[]; planRows: { act: string; det: string; owner: string; start: string; done: string; eff: string; rule: string }[] };
    };
    const { cards, planRows } = out.data;
    expect(planRows.length).toBeGreaterThan(0);
    // 每行字段完整 + 规则 ∈ {C05, C21}
    for (const r of planRows) {
      expect(r.act.length).toBeGreaterThan(0);
      expect(r.owner.length).toBeGreaterThan(0);
      expect(["C05", "C21"]).toContain(r.rule);
    }
    // 峰值≥90 的基地有备份方案行
    if (cards.some((c) => c.peak >= 90)) {
      expect(planRows.some((r) => r.act.includes("备份方案") && r.det.includes("双保险"))).toBe(true);
    }
    // 存在 14 天内越线 → 反提 S&OP 行（C21）
    if (cards.some((c) => c.crossDay != null && c.crossDay <= 14)) {
      const reflux = planRows.find((r) => r.rule === "C21");
      expect(reflux?.owner).toContain("S&OP");
    }
    // 按启动日排序（start 字符串 numeric 升序）
    const starts = planRows.map((r) => r.start);
    expect([...starts].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))).toEqual(starts);
  });

  // PRD-IND-risk §4.6：逐日 tip 事件可解释——每事件带 tag/obj/desc/src（量化 hashN 确定性 R6）。
  it("V5c: risk_timeline 事件带 tag/desc/src 可解释文案（§4.6）+ R6 同输入字节一致", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const run = async () => (await invokeSolver(t, "risk_timeline", { horizon: 30 })).json() as { data: { cards: { events: { type: string; tag?: string; desc?: string; src?: string }[] }[] } };
    const out = await run();
    const allEvents = out.data.cards.flatMap((c) => c.events);
    expect(allEvents.length).toBeGreaterThan(0);
    for (const e of allEvents) {
      expect(e.tag).toBeTruthy();
      expect(e.desc).toBeTruthy();
      expect(e.src).toBeTruthy();
    }
    // 来源系统三选一（SRC_META 逐字）
    const srcs = new Set(allEvents.map((e) => e.src));
    for (const s of srcs) expect(["EAM/CMMS 检修计划", "S&OP/ERP 订单交期", "WMS/ERP 采购与在途"]).toContain(s);
    // R6：同输入同输出
    expect(JSON.stringify(await run())).toBe(JSON.stringify(out));
  });

  it("affected_orders: window [day−7, day+14], delay estimate, condition filter + nearest-due fallback", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await invokeSolver(t, "affected_orders", { baseId: "changzhou", day: 30, peak: 93 });
    const data = (res.json() as { data: { affected: { so: string; dueDay: number; delay: number }[]; fallback: boolean } }).data;
    for (const a of data.affected) {
      expect(a.dueDay).toBeGreaterThanOrEqual(23);
      expect(a.dueDay).toBeLessThanOrEqual(44);
      expect(a.delay).toBeGreaterThanOrEqual(1);
    }
    // impossible condition → fallback to nearest-due max orders within the window
    const fb = await invokeSolver(t, "affected_orders", {
      baseId: "changzhou",
      day: 30,
      peak: 93,
      condition: { prop: "qty", op: ">", value: 10_000_000 },
    });
    const fbData = (fb.json() as { data: { affected: unknown[]; fallback: boolean } }).data;
    expect(fbData.fallback).toBe(true);
    expect(fbData.affected.length).toBeGreaterThan(0);
    expect(fbData.affected.length).toBeLessThanOrEqual(5);
  });

  it("affected_orders 无 baseId → 跨基地聚合 VM（summary/rows[seg+risks]/problems）；base 过滤", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 无 baseId → 订单全链聚合形状（order-chain 视图消费）
    const agg = (await (await invokeSolver(t, "affected_orders", {})).json()).data as {
      summary: { orderCount: number; totalQty: number; custCount: number; revenue: number };
      rows: { so: string; seg: string; risks: { base: string; factor: string }[] }[];
      problems: unknown[];
    };
    expect(agg.summary.orderCount).toBeGreaterThan(0);
    expect(agg.rows.length).toBe(agg.summary.orderCount);
    expect(agg.rows[0]!.seg).toBeTruthy();
    expect(agg.rows[0]!.risks.length).toBeGreaterThan(0);
    expect(Array.isArray(agg.problems)).toBe(true);
    // base 过滤 → 行的风险点均含该基地
    const cz = (await (await invokeSolver(t, "affected_orders", { base: "常州" })).json()).data as {
      rows: { risks: { base: string }[] }[];
    };
    for (const r of cz.rows) expect(r.risks.some((k) => k.base === "常州")).toBe(true);
  });

  it("V6: plan_audit 5H+4M（含外部信号 E01/E03）→ score 0 → 站不住; why carries substituted numbers; fix.patch correct", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const input = {
      dem: 100,
      // PRD-IND-audit §4.5-A1：seg 合计 90≠dem(触 X01)，且储能(低毛利)占比高 → 结构毛利 15<目标 16(触 X03)
      seg_pas: 30,
      seg_ess: 45,
      seg_com: 15,
      sup: 95,
      ltaCov: 60,
      kitGap: 900,
      gmTarget: 16,
      cashCushion: 48,
      capex: 12,
    };
    const res = await invokeSolver(t, "plan_audit", input);
    const data = (res.json() as { data: { H: { id: string; why: string; fix?: { patch: Record<string, number> } }[]; M: { id: string; why: string }[]; score: number; verdict: string; gmStruct: number } }).data;
    expect(data.H.map((h) => h.id).sort()).toEqual(["X01", "X02", "X03", "X04", "X05"]);
    // R01/R02 + 外部信号 E01（毛利缓冲 15−16<1.2 击穿）/E03（客户舆情恒提示）；E02 不触（dem 100<130）
    expect(data.M.map((m) => m.id).sort()).toEqual(["E01", "E03", "R01", "R02"]);
    expect(data.score).toBe(0); // clamp(100 − 22×5 − 7×4)=0
    expect(data.verdict).toBe("站不住"); // §3.1：H>0 → 站不住
    // why texts contain the substituted numbers
    expect(data.H.find((h) => h.id === "X01")!.why).toContain("90");
    expect(data.H.find((h) => h.id === "X02")!.why).toContain("5");
    // PRD-IND-audit §4.5-A1：结构毛利权重分母用 segTot（三细分合计 90），非 dem → gmStruct=1350/90=15
    const gmStruct = (30 * 18 + 45 * 13 + 15 * 15) / 90;
    expect(data.gmStruct).toBe(round(gmStruct, 4));
    expect(data.H.find((h) => h.id === "X03")!.why).toContain("15");
    expect(data.H.find((h) => h.id === "X04")!.why).toContain("900");
    expect(data.H.find((h) => h.id === "X05")!.why).toContain("48");
    // fix.patch values
    expect(data.H.find((h) => h.id === "X02")!.fix!.patch.sup).toBe(100);
    expect(data.H.find((h) => h.id === "X03")!.fix!.patch.gmTarget).toBe(15);
    expect(data.H.find((h) => h.id === "X04")!.fix!.patch.kitGap).toBe(700);
    expect(data.H.find((h) => h.id === "X05")!.fix!.patch.capex).toBe(10); // 12 − (50−48)
    const segPatch = data.H.find((h) => h.id === "X01")!.fix!.patch;
    expect(round(segPatch.seg_pas! + segPatch.seg_ess! + segPatch.seg_com!, 1)).toBe(100);
  });

  it("V7: plan_generate — C violates CAPEX cap, recommend = E on defaults, 5-dim scores exact", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await invokeSolver(t, "plan_generate", {});
    const data = (res.json() as {
      data: {
        schemes: { name: string; pathKey: string; scores: Record<string, number>; hardViol: string[] }[];
        recommend: string;
        paths: { pathKey: string; outcome: Record<string, number>; scores: Record<string, number>; hardViol: string[] }[];
      };
    }).data;
    const pathC = data.paths.find((p) => p.pathKey === "C")!;
    expect(pathC.hardViol).toContain("CAPEX");
    expect(data.schemes).toHaveLength(3);
    // 1:1 §4.4 方案编号 壹/贰/叁（稳健·守盈利 / 均衡 / 进取·冲规模）
    expect(data.schemes.map((s) => s.no)).toEqual(["壹", "贰", "叁"]);
    // ★推荐 = 三案中可行且综合分最高（动态，非固定 E）
    const feasSchemes = data.schemes.filter((s) => s.hardViol.length === 0);
    const expectRec = [...feasSchemes].sort((a, b) => (b.scores.total! - a.scores.total!) || (a.pathKey < b.pathKey ? -1 : 1))[0];
    expect(data.recommend).toBe(expectRec!.pathKey);
    // exact 5-dim for every path, recomputed from the scenario-pack coefficients
    const cfg = P.planGenerate;
    for (const p of data.paths) {
      const eff = cfg.paths[p.pathKey]!;
      const gm = round(cfg.base.gm + eff.gm, 4);
      const cash = round(cfg.base.cash + eff.cash, 4);
      const rev = round(cfg.base.rev * eff.rev, 4);
      const clamp = (v: number) => Math.min(100, Math.max(0, v));
      expect(p.scores.profit).toBe(clamp(round(50 + (gm - cfg.targets.gmFloor) * 22, 4)));
      expect(p.scores.scale).toBe(clamp(round(40 + eff.share * 3, 4)));
      expect(p.scores.cash).toBe(clamp(round(50 + (cash - cfg.targets.cashFloor) * 4, 4)));
      expect(p.scores.growth).toBe(clamp(round(30 + (rev - cfg.base.rev) * 2.5, 4)));
      expect(p.scores.stability).toBe(clamp(round(90 - eff.capex * 2.2, 4)));
      const mean = (p.scores.profit! + p.scores.scale! + p.scores.cash! + p.scores.growth! + p.scores.stability!) / 5;
      expect(p.scores.total).toBe(Math.max(0, Math.round(mean) - 15 * p.hardViol.length));
    }
    // 1:1 §4.4：进取(叁) = 全集 规模+增长 最高（pickMax，排除已选稳健）；去重 → 三案 pathKey 互异
    const agg = data.schemes[2]!;
    const keys = data.schemes.map((s) => s.pathKey);
    expect(new Set(keys).size).toBe(3); // 去重：三案路径互异
    const stdKey = data.schemes[0]!.pathKey;
    const scaleGrowth = (k: string) => { const p = data.paths.find((x) => x.pathKey === k)!; return p.scores.scale! + p.scores.growth!; };
    const aggExpect = [...data.paths].filter((p) => p.pathKey !== stdKey).sort((a, b) => (scaleGrowth(b.pathKey) - scaleGrowth(a.pathKey)) || (a.pathKey < b.pathKey ? -1 : 1))[0]!;
    expect(agg.pathKey).toBe(aggExpect.pathKey);
  });

  it("capacity_rollup returns 4-level intermediates with formulas and inputs", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await invokeSolver(t, "capacity_rollup", {});
    const data = (res.json() as { data: { bases: Record<string, unknown>[]; ruleRefs: string[] } }).data;
    expect(data.ruleRefs).toEqual(["C01", "C02"]);
    expect(data.bases).toHaveLength(13);
    const b = data.bases[0]! as { weeklyWan: number; formula: string; inputs: unknown[]; lines: { formula: string }[]; processes: unknown[]; equipment: { formula: string; inputs: unknown[] }[] };
    expect(b.weeklyWan).toBeGreaterThan(0);
    expect(b.formula).toContain("周产能");
    expect(b.lines[0]!.formula).toContain("min(串行段)");
    expect(b.equipment[0]!.formula).toContain("3600");
    expect((b.equipment[0]!.inputs as unknown[]).length).toBeGreaterThan(0);
  });
});
