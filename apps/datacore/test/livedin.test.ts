import { beforeAll, describe, expect, it } from "vitest";
import { HistoryBundleSchema, type HistoryBundle } from "@platform/contracts";
import { ADMIN, BASE_MANAGER, makeApp, type TestApp } from "./helpers.js";
import type { SyntheticJob } from "../src/domain.js";

/**
 * 运营态出厂配置增量（PRD-addendum-lived-in-state）验收 Y1–Y9（Y10 人工盲测除外）。
 * Y8（对话历史预载渲染）由 AgentCore（场景入口种子）+ 前端 RTL 用例覆盖。
 */

type LivedJob = SyntheticJob & { livedIn?: { batches: number; days: number; points: number; durationMs: number } };

async function runLivedJob(t: TestApp, seed = 42): Promise<LivedJob> {
  const res = await t.app.inject({
    method: "POST",
    url: "/a/v1/synthetic/jobs",
    headers: ADMIN,
    payload: { industry: "battery-manufacturing", scale: "S", seed, livedIn: true },
  });
  expect(res.statusCode).toBe(202);
  return res.json() as LivedJob;
}

async function fetchBundle(t: TestApp, headers: Record<string, string> = ADMIN, qs = "?pageSize=200"): Promise<{ raw: string; bundle: HistoryBundle }> {
  const res = await t.app.inject({ method: "GET", url: `/a/v1/history/bundle${qs}`, headers });
  expect(res.statusCode).toBe(200);
  return { raw: res.body, bundle: HistoryBundleSchema.parse(res.json()) };
}

describe("运营态出厂配置（livedIn 回放）", () => {
  let t: TestApp;
  let job: LivedJob;
  let bundle: HistoryBundle;
  let bundleRaw: string;

  beforeAll(async () => {
    t = await makeApp();
    job = await runLivedJob(t);
    const r = await fetchBundle(t);
    bundle = r.bundle;
    bundleRaw = r.raw;
  }, 300_000);

  it("Y1: livedIn 合成 → 一年运营态就位，S 规模回放 ≤5 分钟", () => {
    expect(job.status).toBe("SUCCEEDED");
    expect(job.livedIn).toBeDefined();
    const replay = job.livedIn!;
    expect(replay.days).toBe(365);
    expect(replay.batches).toBe(13);
    expect(replay.points).toBeGreaterThan(50_000); // 5 系列 × 168 实体日 × 365
    // 性能门槛（规范性）：S 规模全量回放 ≤ 5 分钟
    expect(replay.durationMs).toBeLessThan(300_000);

    // 全部历史分区有数据（登录即用，零配置）
    expect(bundle.trend).toHaveLength(13);
    expect(bundle.deliveredCount).toBe(60);
    expect(bundle.delivered).toHaveLength(60);
    expect(bundle.onTimeRate).toBe(85); // 51/60 按期
    expect(bundle.riskCases).toHaveLength(10);
    expect(bundle.actionHistory.total).toBe(200);
    expect(bundle.actionStats).toEqual({ executed: 164, rejected: 22, cancelled: 8, failed: 6, total: 200 });
    expect(bundle.mapeSeries).toHaveLength(52);
    expect(bundle.sopVersions).toHaveLength(13);
    expect(bundle.ruleVersions.length).toBeGreaterThanOrEqual(5);
    expect(bundle.incubated).toHaveLength(3);
    // 每场景入口 2–6 条任务/对话史（7 入口：dash/risk/project/audit/generate/explore(graph)/review）
    const scenes = new Set(bundle.taskHistory.map((h) => h.scene));
    for (const scene of ["dash", "risk", "project-sim", "plan-audit", "plan-generate", "graph", "review"]) {
      const n = bundle.taskHistory.filter((h) => h.scene === scene).length;
      expect(scenes.has(scene)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(6);
    }
    // S&OP 达成率 88% → 94% 爬坡
    expect(bundle.sopVersions[0]!.attainment).toBe(88);
    expect(bundle.sopVersions[11]!.attainment).toBe(94);
    expect(bundle.sopVersions[11]!.label).toBe("V12");
    // 运营回顾视图进 workspace（零配置导航）
    const ws = t.app.inject({ method: "GET", url: "/a/v1/me/workspace", headers: ADMIN });
    return ws.then((res) => {
      const body = res.json() as { views: { viewKey: string; renderer: string }[]; navigation: { key: string }[] };
      const review = body.views.find((v) => v.viewKey === "review");
      expect(review?.renderer).toBe("review");
      expect(body.navigation.some((n) => n.key === "review")).toBe(true);
    });
  });

  it("Y2: 同 seed 重放 → history/bundle 全量字节一致（跨进程实例）", async () => {
    const t2 = await makeApp();
    await runLivedJob(t2);
    const r2 = await fetchBundle(t2);
    expect(r2.raw).toBe(bundleRaw);
  }, 300_000);

  it("Y3: 三层下钻不穿帮 —— 月度产出 → 基地月度明细 → 检修对象同月、检修月下凹", async () => {
    // 任取一个有检修的月份与基地
    const maintMonths = bundle.trend.filter((r) => r.maintBaseIds.length > 0);
    expect(maintMonths.length).toBeGreaterThanOrEqual(2); // Q2 检修季错峰
    for (const row of bundle.trend) {
      // 层 1↔2：月度总产出 = Σ 基地月度明细（同月）
      const monthRows = bundle.monthly.filter((m) => m.month === row.month);
      expect(monthRows).toHaveLength(12);
      const sum = monthRows.reduce((a, m) => a + m.output, 0);
      expect(Math.abs(sum - row.output)).toBeLessThan(0.05);
    }
    const month = maintMonths[maintMonths.length - 1]!.month;
    const baseId = maintMonths[maintMonths.length - 1]!.maintBaseIds[0]!;
    // 层 2：该基地检修月明细标记 maint，且产出较相邻月可见下凹
    const series = bundle.monthly.filter((m) => m.baseId === baseId).sort((a, b) => (a.month < b.month ? -1 : 1));
    const idx = series.findIndex((m) => m.month === month);
    expect(series[idx]!.maint).toBe(true);
    const neighbors = [series[idx - 1], series[idx + 1]].filter(Boolean) as typeof series;
    for (const n of neighbors) expect(series[idx]!.output).toBeLessThan(n.output * 0.97);
    // 层 3：检修事件与本体 MaintPlan 对象同月（窗口 = lastMaintStart 起 14 天）
    const mp = (await t.repos.objects.listByType("demo", "MaintPlan")).find((m) => m.props.baseId === baseId)!;
    const start = String(mp.props.lastMaintStart);
    const mid = new Date(Date.parse(`${start}T00:00:00Z`) + 7 * 86400000).toISOString().slice(0, 7);
    expect(mid).toBe(month);
    // 层 3b：原始时序聚合（与前端 query_timeseries_agg 同一路径）数字同源
    const agg = await t.app.inject({
      method: "POST",
      url: "/a/v1/timeseries/agg-query",
      headers: ADMIN,
      payload: {
        seriesKey: "output:line",
        entityIds: [`LINE-${baseId}`],
        window: { from: `${month}-01`, to: new Date(Date.parse(`${month}-28T00:00:00Z`) + 5 * 86400000).toISOString().slice(0, 8) + "01", grain: "week" },
        agg: "sum",
      },
    });
    expect(agg.statusCode).toBe(200);
  });

  it("Y4: 叙事互引 —— 危机的案例/Action/C16 变更/MAPE 回弹引用同一时间窗", async () => {
    const win = bundle.crisisWindow;
    expect(win).toEqual({ from: "2025-10-28", to: "2025-11-10" });
    // ① 风险案例 CASE-007
    const crisis = bundle.riskCases.find((c) => c.caseNo === "CASE-007")!;
    expect(crisis.tags).toContain("到货危机");
    expect(crisis.windowFrom).toBe(win.from);
    expect(crisis.windowTo).toBe(win.to);
    expect(crisis.baseId).toBe("changzhou");
    // ② 已执行 Action（同窗口内采纳）
    const action = bundle.actionHistory.items.find((a) => a.id === crisis.actionId)!;
    expect(action.status).toBe("EXECUTED");
    expect(action.createdAt >= win.from && action.createdAt <= win.to).toBe(true);
    // ③ C16 规则收紧挂「到货危机复盘」，复盘原因引用同一时间窗
    const c16 = bundle.ruleVersions.find((r) => r.key === "C16" && r.status === "PUBLISHED")!;
    expect(c16.expression).toContain("< 5");
    expect(c16.tags).toContain("到货危机复盘");
    expect(c16.reason).toContain(win.from);
    // 覆盖天数演进 3 → 5
    expect(bundle.ruleVersions.some((r) => r.key === "C16" && r.expression.includes("< 3"))).toBe(true);
    // ④ MAPE 第 21 周（weekStart == 危机窗口起点）回弹 +1.8pct
    const w21 = bundle.mapeSeries[20]!;
    const w20 = bundle.mapeSeries[19]!;
    expect(w21.weekStart).toBe(win.from);
    expect(w21.mape).toBeGreaterThan(w20.mape + 1.2);
    expect(w21.event).toContain("到货危机");
    // 曲线消解可回放：案例 curve 指向危机窗口的真实时序
    expect(crisis.curve.entityId).toBe("LINE-changzhou");
    expect(crisis.curve.from < win.from && crisis.curve.to > win.to).toBe(true);
  });

  it("Y4b: 危机窗口产出真实下凹后消解（曲线由回放生成，不是画出来的）", async () => {
    const series = (await t.repos.tsSeries.list("demo", (s) => s.seriesKey === "output:line"))[0]!;
    const points = await t.repos.tsPoints.list("demo", series.id, { entityIds: ["LINE-changzhou"] });
    const avg = (from: string, to: string) => {
      const vals = points.filter((p) => p.ts >= `${from}T00:00:00.000Z` && p.ts < `${to}T00:00:00.000Z`).map((p) => p.values.output ?? 0);
      return vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
    };
    // 危机窗口 2025-10-28~2025-11-10：前(清洁基线)→中(下凹)→后(消解)
    const before = avg("2025-10-01", "2025-10-23"); // 危机前(下凹自 10-24 起)
    const during = avg("2025-10-28", "2025-11-01"); // 谷底(depth 0.78，low→adopted)
    const after = avg("2025-11-18", "2025-12-08"); // 消解后
    expect(during).toBeLessThan(before * 0.85);
    expect(after).toBeGreaterThan(during * 1.15);
  });

  it("Y5: 延期挽回链 —— 9 单曾延期，7 单挽回备注关联案例与已执行 Action", () => {
    const delayed = bundle.delivered.filter((d) => d.delayDays > 0);
    expect(delayed).toHaveLength(9);
    const rescued = delayed.filter((d) => d.rescue);
    expect(rescued).toHaveLength(7);
    for (const d of rescued) {
      expect(d.delayDays).toBeLessThanOrEqual(2);
      const kase = bundle.riskCases.find((c) => c.id === d.rescue!.caseId)!;
      expect(kase).toBeDefined();
      expect(kase.affectedOrders).toContain(d.so);
      expect(d.rescue!.note).toContain(kase.caseNo);
      expect(d.rescue!.note).toContain(d.rescue!.actionId);
      const action = bundle.actionHistory.items.find((a) => a.id === d.rescue!.actionId)!;
      expect(action.status).toBe("EXECUTED");
      expect(kase.actionId).toBe(d.rescue!.actionId);
    }
    // 危机案例 4 张受影响订单中 3 张挽回
    const crisis = bundle.riskCases.find((c) => c.caseNo === "CASE-007")!;
    expect(crisis.affectedOrders).toHaveLength(4);
    const crisisRescued = rescued.filter((d) => d.rescue!.caseId === crisis.id);
    expect(crisisRescued).toHaveLength(3);
  });

  it("Y6: 行级权限作用于历史 —— czmgr 仅见常州月度/案例，聚合按可见范围重算", async () => {
    const { bundle: cz } = await fetchBundle(t, BASE_MANAGER);
    expect(cz.monthly.length).toBe(13); // forecastStart 2026-06-10 起回放 365 天跨 13 个日历月
    expect(cz.monthly.every((m) => m.baseId === "changzhou")).toBe(true);
    expect(cz.riskCases.length).toBeGreaterThanOrEqual(1);
    expect(cz.riskCases.every((c) => c.baseId === "changzhou")).toBe(true);
    expect(cz.delivered.every((d) => d.bases.includes("changzhou"))).toBe(true);
    expect(cz.deliveredCount).toBeLessThan(bundle.deliveredCount);
    // 准交率按可见子集重算
    const onTime = cz.delivered.filter((d) => d.onTime).length;
    const expected = Math.round((onTime / cz.delivered.length) * 1000) / 10;
    expect(cz.onTimeRate).toBe(expected);
    // 趋势 = 可见基地之和（常州单基地）
    for (const row of cz.trend) {
      const m = cz.monthly.find((x) => x.month === row.month)!;
      expect(Math.abs(row.output - m.output)).toBeLessThan(0.05);
    }
    // 租户级记录全量（Action/校准/规则/任务史）
    expect(cz.actionHistory.total).toBe(200);
    expect(cz.ruleVersions.length).toBe(bundle.ruleVersions.length);
  });

  it("Y7: 校准证据链 —— MAPE 收敛 + 2 条被拒提案带方法学原因", () => {
    const series = bundle.mapeSeries;
    expect(series[0]!.mape).toBe(12);
    expect(series[51]!.mape).toBeLessThanOrEqual(7.3);
    // 整体收敛（除危机回弹外单调下行的指数曲线）
    expect(series[10]!.mape).toBeLessThan(series[0]!.mape);
    expect(series[51]!.mape).toBeLessThan(series[30]!.mape);
    const proposals = bundle.calibrations.proposals;
    expect(proposals).toHaveLength(8);
    const rejected = proposals.filter((p) => p.status === "REJECTED");
    expect(rejected).toHaveLength(2);
    const shift = rejected.find((p) => p.evidence?.flags.includes("STRUCTURAL_SHIFT"))!;
    expect(shift.method).toBe("EMA");
    // 漂移闸门：危机窗口内观测漂移（证据窗口与危机时间窗重叠）
    expect(shift.evidence!.windowTo >= "2025-10-28").toBe(true);
    const noImp = rejected.find((p) => p.evidence?.flags.includes("NO_IMPROVEMENT"))!;
    expect(noImp.evidence!.mapeBefore - noImp.evidence!.simulatedMapeAfter).toBeLessThan(1);
    // 6 次生效提案均带 M11 方法字段 + 预言 vs 实现
    const applied = proposals.filter((p) => p.status === "APPLIED");
    expect(applied).toHaveLength(6);
    for (const p of applied) {
      expect(["EMA", "REPLAY_ATTRIBUTION", "QUANTILE"]).toContain(p.method);
      expect(p.realizedMape).toBeDefined();
    }
    expect(bundle.calibrations.history).toHaveLength(6);
  });

  it("Y9: origin 替换 —— 接入一个月 LIVE 实绩，同期覆盖、趋势无缝、水印比例变化", async () => {
    const before = bundle.trend.map((r) => r.output);
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/history/live-ingest",
      headers: ADMIN,
      payload: { month: "2026-03" },
    });
    expect(res.statusCode).toBe(202);
    const ingest = res.json() as { written: number; liveMonths: string[]; liveRatio: number };
    expect(ingest.written).toBeGreaterThan(4000);
    expect(ingest.liveMonths).toEqual(["2026-03"]);

    const { bundle: after } = await fetchBundle(t);
    // 趋势无缝：同一管线回填 → 数值不跳变
    expect(after.trend.map((r) => r.output)).toEqual(before);
    expect(after.trend.find((r) => r.month === "2026-03")!.live).toBe(true);
    expect(after.generatedFrom.liveMonths).toEqual(["2026-03"]);
    expect(after.generatedFrom.liveRatio).toBeCloseTo(1 / 13, 3);
    // 点位 origin=LIVE（同键覆盖 SYNTHETIC）
    const series = (await t.repos.tsSeries.list("demo", (s) => s.seriesKey === "output:line"))[0]!;
    const march = await t.repos.tsPoints.list("demo", series.id, {
      from: "2026-03-01T00:00:00.000Z",
      to: "2026-04-01T00:00:00.000Z",
    });
    expect(march.length).toBeGreaterThan(0);
    expect(march.every((p) => p.origin === "LIVE")).toBe(true);
    // 水印徽章（hover 显示 generatedFrom 与 seed；LIVE 占比消退）
    const wm = await t.app.inject({ method: "GET", url: "/a/v1/history/watermark", headers: ADMIN });
    const watermark = wm.json() as { synthetic: boolean; seed: number; liveRatio: number };
    expect(watermark.synthetic).toBe(true);
    expect(watermark.seed).toBe(42);
    expect(watermark.liveRatio).toBeCloseTo(1 / 13, 3);
  });

  it("Entitlement 先于 authz：view.review 关闭 → history/bundle 404 FEATURE_NOT_FOUND", async () => {
    await t.app.inject({
      method: "PUT",
      url: "/a/v1/tenants/demo/features",
      headers: ADMIN,
      payload: { overrides: { "view.review": false } },
    });
    const res = await t.app.inject({ method: "GET", url: "/a/v1/history/bundle", headers: ADMIN });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe("FEATURE_NOT_FOUND");
    await t.app.inject({
      method: "PUT",
      url: "/a/v1/tenants/demo/features",
      headers: ADMIN,
      payload: { overrides: {} },
    });
  });
});
