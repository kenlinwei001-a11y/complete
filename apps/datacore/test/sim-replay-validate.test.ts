import { afterEach, describe, expect, it } from "vitest";
import { PropagationRuleSchema, type PropagationRule, type TickState } from "@platform/contracts";
import {
  replayPropagationRules,
  buildDailyStatesFromSeries,
  DEFAULT_REPLAY_WINDOW,
  type ReplayHistory,
  type ReplaySeriesLike,
} from "../src/sim/replay-validate.js";
import type { PropagationGraph } from "../src/sim/propagation.js";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import type { ObjectInstance, LinkInstance, ObjectTypeDef, TsSeriesRecord, TsPointRecord } from "../src/domain.js";

/**
 * WO-SANDBOX-TEMPORAL-GROUNDING §3.6 回放校验 + horizon 覆盖预检（验收 #6）。
 *
 * 真原则（铁律 0.4）：VALIDATED 用**真 A8 ts_points**（写 repos）+ 真对象/链路/规则，经真 cert 端点跑；
 * NO_HISTORY 用真 demo battery（有 A8 历史但无匹配 series）；gate 关 → v1.1 行为字节不变（NG6·暗发回退）。
 * green→red teeth：容差内规则真 VALIDATED（改系数使超差 → OUT_OF_TOLERANCE 红）；无历史真 NO_HISTORY（绝不假验证）。
 */

const GRAPH: PropagationGraph = {
  objects: [
    { id: "obj_src", typeKey: "SrcT" },
    { id: "obj_tgt", typeKey: "TgtT" },
  ],
  links: [{ fromId: "obj_src", toId: "obj_tgt", linkKey: "DRIVES" }],
};

const RULE = (over: Partial<PropagationRule> = {}): PropagationRule =>
  PropagationRuleSchema.parse({
    id: "pr_replay",
    tenantId: "t",
    key: "PR_DRIVES",
    sourceTypeKey: "SrcT",
    sourceStateVar: "srcVar",
    viaLinkKey: "DRIVES",
    targetTypeKey: "TgtT",
    targetStateVar: "tgtVar",
    coefficient: 0.5,
    delayTicks: 0,
    status: "PUBLISHED",
    ...over,
  });

/** 逐日真实态：tgtΔ = coeff × src[d]（模型可完美复现 → 容差内）。coeff=0.5。 */
function realDailyStates(coeff: number, n: number): TickState[] {
  const states: TickState[] = [];
  let tgt = 100;
  for (let d = 0; d < n; d++) {
    const src = 10 + d;
    states.push({ obj_src: { srcVar: src }, obj_tgt: { tgtVar: tgt } });
    tgt = tgt + coeff * src; // 下一日 tgt 真变化 = coeff×src（真实历史）
  }
  return states;
}

describe("§3.6 replayPropagationRules 纯函数（确定性重放·复用 propagateTick）", () => {
  it("VALIDATED：预测Δ === 实际Δ（容差内）→ 规则转正（唯一 UNCALIBRATED→VALIDATED 路径）", () => {
    const history: ReplayHistory = { graph: GRAPH, ruleParams: {}, dailyStates: realDailyStates(0.5, 20) };
    const res = replayPropagationRules("t", [RULE({ coefficient: 0.5 })], DEFAULT_REPLAY_WINDOW, history, "2026-07-11T00:00:00Z");
    expect(res.status).toBe("VALIDATED");
    expect(res.rules[0]!.status).toBe("VALIDATED");
    expect(res.rules[0]!.meanApe).toBe(0); // 完美复现
    expect(res.rules[0]!.samples).toBe(19); // 20 日 → 19 步对比
    expect(res.validatedCount).toBe(1);
    expect(res.rulesWithHistory).toBe(1);
  });

  it("green→red teeth：系数偏离真历史（0.5→0.9）→ 超差 OUT_OF_TOLERANCE（不假 VALIDATED）", () => {
    // 真历史是 coeff=0.5 生成的；用 coeff=0.9 的规则预测 → Δ 差 80% 远超容差 15%。
    const history: ReplayHistory = { graph: GRAPH, ruleParams: {}, dailyStates: realDailyStates(0.5, 20) };
    const res = replayPropagationRules("t", [RULE({ coefficient: 0.9 })], DEFAULT_REPLAY_WINDOW, history, "2026-07-11T00:00:00Z");
    expect(res.status).toBe("OUT_OF_TOLERANCE");
    expect(res.rules[0]!.status).toBe("OUT_OF_TOLERANCE");
    expect(res.rules[0]!.meanApe!).toBeGreaterThan(DEFAULT_REPLAY_WINDOW.tolerance);
    expect(res.validatedCount).toBe(0);
  });

  it("NO_HISTORY：无 A8 历史（dailyStates 空）→ 诚实 NO_HISTORY（绝不假验证·KILL-MOCK-RED）", () => {
    const history: ReplayHistory = { graph: GRAPH, ruleParams: {}, dailyStates: [] };
    const res = replayPropagationRules("t", [RULE()], DEFAULT_REPLAY_WINDOW, history, "2026-07-11T00:00:00Z");
    expect(res.status).toBe("NO_HISTORY");
    expect(res.rules[0]!.status).toBe("NO_HISTORY");
    expect(res.rules[0]!.meanApe).toBeNull();
    expect(res.rulesWithHistory).toBe(0);
  });

  it("R6 确定性：同输入双跑字节一致（纯重算·无 Date.now/random）", () => {
    const history: ReplayHistory = { graph: GRAPH, ruleParams: {}, dailyStates: realDailyStates(0.5, 20) };
    const a = replayPropagationRules("t", [RULE()], DEFAULT_REPLAY_WINDOW, history, "2026-07-11T00:00:00Z");
    const b = replayPropagationRules("t", [RULE()], DEFAULT_REPLAY_WINDOW, history, "2026-07-11T00:00:00Z");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("§3.6 buildDailyStatesFromSeries（A8 ts_points → 逐日真实态·稀疏不外推）", () => {
  it("两 series 逐日解出真实态；仅命中 stateVars 的 measureField；entity→objId 真映射", () => {
    const series: ReplaySeriesLike[] = [
      { measureFields: ["srcVar", "noise"], points: [
        { entityId: "obj_src", ts: "2026-01-01T00:00:00Z", values: { srcVar: 10, noise: 999 } },
        { entityId: "obj_src", ts: "2026-01-02T00:00:00Z", values: { srcVar: 11, noise: 999 } },
      ] },
      { measureFields: ["tgtVar"], points: [
        { entityId: "obj_tgt", ts: "2026-01-01T00:00:00Z", values: { tgtVar: 100 } },
        { entityId: "obj_tgt", ts: "2026-01-02T00:00:00Z", values: { tgtVar: 105 } },
      ] },
    ];
    const out = buildDailyStatesFromSeries(series, ["srcVar", "tgtVar"], (e) => e, { days: 30 });
    expect(out.observedDays).toBe(2);
    expect(out.coveredDays).toBe(1);
    expect(out.dailyStates[0]).toEqual({ obj_src: { srcVar: 10 }, obj_tgt: { tgtVar: 100 } });
    expect(out.dailyStates[1]).toEqual({ obj_src: { srcVar: 11 }, obj_tgt: { tgtVar: 105 } });
    // noise 未在 stateVars → 不进态（不污染）。
    expect((out.dailyStates[0]!.obj_src as Record<string, number>).noise).toBeUndefined();
  });
});

// ── 真 A8 ts_points 端到端（cert 端点 L3 回放接线 + horizon 预检 + 暗发回退）─────────────
const enableSim = (t: Awaited<ReturnType<typeof makeApp>>, tenant: string, headers: Record<string, string>) =>
  t.app.inject({
    method: "PUT", url: `/a/v1/tenants/${tenant}/features`, headers,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true, "sim.certification": true } },
  });

const newSession = async (t: Awaited<ReturnType<typeof makeApp>>, headers: Record<string, string>): Promise<string> =>
  (await (await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers, payload: { baseSnapshot: {} } })).json()).id as string;

/** 写真 A8 世界：2 类型/2 对象/1 链路 + 2 真实历史 series（tgtΔ=0.5×src）+ 1 已发布传导规则。 */
async function seedReplayWorld(t: Awaited<ReturnType<typeof makeApp>>, tenant: string): Promise<void> {
  const mkType = (key: string): ObjectTypeDef => ({
    id: `otype_${tenant}_${key}`, tenantId: tenant, key, displayName: key,
    domain: "unassigned", properties: [], derivedProperties: [], sourceBindings: [], version: 1, status: "ACTIVE", published: true,
  });
  await t.repos.ontologyTypes.put(mkType("SrcT"));
  await t.repos.ontologyTypes.put(mkType("TgtT"));
  const mkObj = (id: string, type: string): ObjectInstance => ({ id, tenantId: tenant, type, props: {}, origin: { type: "MANUAL" } });
  await t.repos.objects.put(mkObj("obj_src", "SrcT"));
  await t.repos.objects.put(mkObj("obj_tgt", "TgtT"));
  const link: LinkInstance = { id: "lnk_replay", tenantId: tenant, type: "DRIVES", fromId: "obj_src", toId: "obj_tgt", origin: { type: "MANUAL" } };
  await t.repos.links.put(link);

  const mkSeries = (key: string, entityType: string, measure: string): TsSeriesRecord => ({
    id: `tser_${tenant}_${key}`, tenantId: tenant, seriesKey: key, entityType, entityRefField: "entityId",
    timeField: "ts", measureFields: [measure], origin: "CONNECTOR", createdAt: new Date(0).toISOString(),
  });
  const srcSeries = mkSeries("src_series", "SrcT", "srcVar");
  const tgtSeries = mkSeries("tgt_series", "TgtT", "tgtVar");
  await t.repos.tsSeries.put(srcSeries);
  await t.repos.tsSeries.put(tgtSeries);
  const srcPts: TsPointRecord[] = [];
  const tgtPts: TsPointRecord[] = [];
  let tgt = 100;
  for (let d = 0; d < 20; d++) {
    const src = 10 + d;
    const ts = `2026-01-${String(d + 1).padStart(2, "0")}T00:00:00.000Z`;
    srcPts.push({ seriesId: srcSeries.id, entityId: "obj_src", ts, values: { srcVar: src }, ingestedAt: new Date(0).toISOString(), tick: 0, origin: "LIVE" });
    tgtPts.push({ seriesId: tgtSeries.id, entityId: "obj_tgt", ts, values: { tgtVar: tgt }, ingestedAt: new Date(0).toISOString(), tick: 0, origin: "LIVE" });
    tgt = tgt + 0.5 * src;
  }
  await t.repos.tsPoints.upsert(tenant, srcPts);
  await t.repos.tsPoints.upsert(tenant, tgtPts);

  await t.repos.sim.putPropagationRule(PropagationRuleSchema.parse({
    id: "pr_drives", tenantId: tenant, key: "PR_DRIVES",
    sourceTypeKey: "SrcT", sourceStateVar: "srcVar", viaLinkKey: "DRIVES",
    targetTypeKey: "TgtT", targetStateVar: "tgtVar", coefficient: 0.5, delayTicks: 0, status: "PUBLISHED",
  }));
}

type Cert = { level: string; gaps: { gapCode: string; detail: string }[]; replayValidation?: { status: string; rules: { ruleKey: string; status: string; meanApe: number | null }[]; validatedCount: number }; l3Validated?: boolean };

describe("§3.6 cert L3 回放接线（真 A8 ts_points 端到端·验收 #6）", () => {
  afterEach(() => { delete process.env.SIM_TEMPORAL_GROUNDING; });

  it("真 A8 历史 → 容差内规则 VALIDATED + l3Validated=true（暗发闸开·env）", async () => {
    process.env.SIM_TEMPORAL_GROUNDING = "1";
    const t = await makeApp();
    const tenant = "trep";
    const headers = { "x-debug-user": `${tenant}:admin:admin` };
    await seedReplayWorld(t, tenant);
    await enableSim(t, tenant, headers);
    const sid = await newSession(t, headers);
    const cert = (await (await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/certification?scope=GLOBAL`, headers })).json()) as Cert;
    expect(cert.replayValidation).toBeDefined();
    expect(cert.replayValidation!.status).toBe("VALIDATED");
    const rr = cert.replayValidation!.rules.find((r) => r.ruleKey === "PR_DRIVES");
    expect(rr?.status).toBe("VALIDATED");
    expect(rr?.meanApe).toBe(0);
    expect(cert.l3Validated).toBe(true);
  });

  it("NO_HISTORY teeth：demo battery（有 A8 历史但无匹配 series）→ 规则 NO_HISTORY + RULES_UNCALIBRATED 缺口（不假验证）", async () => {
    process.env.SIM_TEMPORAL_GROUNDING = "1";
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t, "demo", ADMIN);
    const sid = await newSession(t, ADMIN);
    const cert = (await (await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/certification?scope=GLOBAL`, headers: ADMIN })).json()) as Cert;
    expect(cert.replayValidation).toBeDefined();
    expect(cert.replayValidation!.status).toBe("NO_HISTORY");
    expect(cert.replayValidation!.rules.every((r) => r.status === "NO_HISTORY")).toBe(true);
    expect(cert.gaps.some((g) => g.gapCode === "RULES_UNCALIBRATED")).toBe(true);
    expect(cert.l3Validated).toBe(false);
  });

  it("暗发回退（NG6）：gate 关（无 env/无 feature）→ cert 无 replayValidation 字段（v1.1 行为不变）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t, "demo", ADMIN);
    // battery 模板会开 sim.* → 显式关 sim.temporal_grounding（暗发·S6 前不上线）以证关闸行为（v1.1 无 replayValidation）。
    await t.app.inject({ method: "PUT", url: `/a/v1/tenants/demo/features`, headers: ADMIN, payload: { overrides: { "sim.temporal_grounding": false } } });
    const sid = await newSession(t, ADMIN);
    const cert = (await (await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/certification?scope=GLOBAL`, headers: ADMIN })).json()) as Cert;
    expect(cert.replayValidation).toBeUndefined();
    expect(cert.l3Validated).toBeUndefined();
  });
});

type Precheck = { worldCompleteness: { pct: number }; gaps: { gapCode: string; detail: string }[]; horizonCoverage?: { requestedTicks: number; coveredTicks: number; sufficient: boolean; source: string } };

describe("§3.6 S0 horizon 覆盖预检（不足→缺口卡+GrowthTicket·绝不外推）", () => {
  afterEach(() => { delete process.env.SIM_TEMPORAL_GROUNDING; });

  it("30 天预测 + 60 天请求 → horizonCoverage.sufficient=false + HORIZON_UNCOVERED 缺口（真源覆盖不足）", async () => {
    process.env.SIM_TEMPORAL_GROUNDING = "1";
    const t = await makeApp();
    await seedBattery(t);
    await enableSim(t, "demo", ADMIN);
    const sid = await newSession(t, ADMIN);
    const pc = (await (await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/scope-precheck?scope=GLOBAL&horizon=60`, headers: ADMIN })).json()) as Precheck;
    expect(pc.horizonCoverage).toBeDefined();
    expect(pc.horizonCoverage!.requestedTicks).toBe(60);
    expect(pc.horizonCoverage!.sufficient).toBe(false); // demo 预测周期 < 60 天
    expect(pc.horizonCoverage!.source).toBe("forecast_snapshot.weeks");
    expect(pc.gaps.some((g) => g.gapCode === "HORIZON_UNCOVERED")).toBe(true);
  });

  it("暗发回退：gate 关（无 horizon 参数或 env）→ precheck 无 horizonCoverage（原视图不变）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await enableSim(t, "demo", ADMIN);
    const sid = await newSession(t, ADMIN);
    const pc = (await (await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/scope-precheck?scope=GLOBAL`, headers: ADMIN })).json()) as Precheck;
    expect(pc.horizonCoverage).toBeUndefined();
  });
});
