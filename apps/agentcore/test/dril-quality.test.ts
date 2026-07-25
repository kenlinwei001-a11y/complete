import { describe, it, expect, beforeEach } from "vitest";
import {
  computeQualityScore,
  ewmaUpdate,
  graphDistanceScore,
  relationStrengthScore,
  type IntelligenceResource,
  type ResourceSearchResponse,
} from "@platform/contracts";
import { ResourceSearchEngine } from "../src/dril/search-engine.js";
import { ResourceQualityService, overlayQuality } from "../src/dril/quality.js";
import { createTestApp, debugHeaders, ADMIN, TENANT, type TestApp } from "./helpers.js";
import { seedRegistry, seedMcpConfigs } from "../src/mocks/seed.js";

/**
 * WO-DRIL-P3 · Graph Traversal + Quality Score SEAM 门（`dril-quality:check`）。
 *
 * 头号判据（接缝驱动·任一半漏即红）：
 *  ① Quality EWMA 确定性更新（byte-exact given inputs·R6）；
 *  ② 低质量资源在检索中排名**下降** vs 高质量同侪（history 0.10 真移动排序）+ 翻转反证（mutation）；
 *  ③ graphDistance：离焦点更近（planSlice BFS 跳数更少）的资源 ontology 子分更高·排名更前；
 *  ④ 端到端：POST 质量探针 → 仓储 EWMA → registry 叠加 → 再检索见排名位移（数据种×引擎路由接缝）。
 */

// --- 构造两个"除质量/对象类型外完全相同"的 solver 资源（隔离单一变量·防 tie-break 混淆）。 ---
function solverRes(key: string, extra: Partial<IntelligenceResource> = {}): IntelligenceResource {
  return {
    kind: "solver",
    key,
    label: "产能推演求解器",
    description: "给定型号数量周数，推演产能满足度与缺口率。",
    isDeterministic: true,
    requiresSidecar: false,
    tieredTags: { l1_domain: ["plan"], l2_decisionType: [], l3_scenario: [], l4_object: [], l5_algorithm: [] },
    ...extra,
  } as IntelligenceResource;
}

function ranks(res: ResourceSearchResponse): Record<string, number> {
  const out: Record<string, number> = {};
  res.results.forEach((r, i) => (out[r.resource.key] = i));
  return out;
}

describe("WO-DRIL-P3 · Quality EWMA（§5.4·R6 确定性）", () => {
  it("ewmaUpdate byte-exact：一串 success/fail 观测 → 手算逐步吻合（α=0.1）", () => {
    // 首观测无 prev → prevSuccess = success?1:0；后续 EWMA。
    let s = ewmaUpdate({}, { success: true, latencyMs: 1000 });
    expect(s).toEqual({ successRate: 1, usageCount: 1, avgLatencyMs: 1000 });
    s = ewmaUpdate(s, { success: false, latencyMs: 3000 });
    // successRate = 0.1*0 + 0.9*1 = 0.9 ; latency = 0.1*3000 + 0.9*1000 = 1200
    expect(s.successRate).toBeCloseTo(0.9, 12);
    expect(s.avgLatencyMs).toBeCloseTo(1200, 12);
    expect(s.usageCount).toBe(2);
    s = ewmaUpdate(s, { success: false, latencyMs: 3000 });
    // successRate = 0.1*0 + 0.9*0.9 = 0.81
    expect(s.successRate).toBeCloseTo(0.81, 12);
  });

  it("computeQualityScore 复合公式确定性（同输入同输出）", () => {
    const q = { successRate: 0.9, accuracy: 0.8, avgLatencyMs: 1000, usageCount: 100, approval: "APPROVED" as const };
    expect(computeQualityScore(q)).toBe(computeQualityScore(q));
  });

  it("ResourceQualityService.record：连续观测的仓储态与手算 EWMA byte 一致（R6）", async () => {
    const t = await createTestApp();
    const svc = new ResourceQualityService(t.repos);
    const ctx = { tenantId: TENANT } as never;
    let row = await svc.record(ctx, "solver", "capacity_forecast", { success: true, latencyMs: 1000 }, "2026-07-25T00:00:00Z");
    expect(row).toMatchObject({ successRate: 1, usageCount: 1, avgLatencyMs: 1000 });
    row = await svc.record(ctx, "solver", "capacity_forecast", { success: false, latencyMs: 3000 }, "2026-07-25T00:00:01Z");
    expect(row.successRate).toBeCloseTo(0.9, 12);
    expect(row.avgLatencyMs).toBeCloseTo(1200, 12);
    expect(row.usageCount).toBe(2);
    // 复读仓储 = 最后一次 upsert（确定性持久）。
    const got = await svc.get(ctx, "solver", "capacity_forecast");
    expect(got).toEqual(row);
  });
});

describe("WO-DRIL-P3 · SEAM 低质量排名下降 vs 高质量同侪（history 真移动排序 + mutation 反证）", () => {
  const engine = new ResourceSearchEngine();
  const query = "产能推演满足度缺口";

  it("高 successRate 资源排在低 successRate 同侪之上（history 子分驱动）", () => {
    // 同侪除质量外全同；把「高质量」的 key 取字典序更**靠后**（zzz），若仍排前 → 证明是 history 而非 key tie-break。
    const high = solverRes("zzz_high", { quality: { successRate: 0.95, accuracy: 0.9, trustLevel: "GOVERNED" } });
    const low = solverRes("aaa_low", { quality: { successRate: 0.05, accuracy: 0.0, trustLevel: "EXPERIMENTAL" } });
    const res = engine.search(query, [high, low], { maxResults: 10, minScore: 0 });
    const r = ranks(res);
    expect(r["zzz_high"]).toBeLessThan(r["aaa_low"]); // 高质量在前，尽管 key 靠后
    // history 子分显式对照。
    const hi = res.results.find((x) => x.resource.key === "zzz_high")!;
    const lo = res.results.find((x) => x.resource.key === "aaa_low")!;
    expect(hi.scoreBreakdown.history).toBeGreaterThan(lo.scoreBreakdown.history);
  });

  it("mutation 反证：翻转两者 successRate → 排名随之翻转（history 0.10 真咬）", () => {
    const a = solverRes("aaa", { quality: { successRate: 0.95, accuracy: 0.9, trustLevel: "GOVERNED" } });
    const b = solverRes("bbb", { quality: { successRate: 0.05, accuracy: 0.0, trustLevel: "EXPERIMENTAL" } });
    const before = ranks(engine.search(query, [a, b], { maxResults: 10, minScore: 0 }));
    expect(before["aaa"]).toBeLessThan(before["bbb"]); // a(高) 在前
    // 翻转质量（其余不变）。
    const a2 = solverRes("aaa", { quality: { successRate: 0.05, accuracy: 0.0, trustLevel: "EXPERIMENTAL" } });
    const b2 = solverRes("bbb", { quality: { successRate: 0.95, accuracy: 0.9, trustLevel: "GOVERNED" } });
    const after = ranks(engine.search(query, [a2, b2], { maxResults: 10, minScore: 0 }));
    expect(after["bbb"]).toBeLessThan(after["aaa"]); // 翻转后 b(现高) 在前
  });

  it("R6：同 query 同资源集（含 quality）→ 字节级同序", () => {
    const rs = [
      solverRes("s1", { quality: { successRate: 0.9 } }),
      solverRes("s2", { quality: { successRate: 0.2 } }),
    ];
    const x = engine.search(query, rs, { maxResults: 5, minScore: 0 });
    const y = engine.search(query, rs, { maxResults: 5, minScore: 0 });
    expect(JSON.stringify(x)).toBe(JSON.stringify(y));
  });
});

describe("WO-DRIL-P3 · graphDistance（planSlice BFS·§7.2 ontology 第二项）", () => {
  it("graphDistanceScore 纯函数：越近跳数分越高·无图 → 0", () => {
    const hops = new Map([["Base", 0], ["Line", 1], ["Equipment", 3]]);
    expect(graphDistanceScore(hops, ["Base"])).toBe(1); // 焦点自身 hops0
    expect(graphDistanceScore(hops, ["Line"])).toBeCloseTo(0.5, 12); // 1/(1+1)
    expect(graphDistanceScore(hops, ["Equipment"])).toBeCloseTo(0.25, 12); // 1/(1+3)
    expect(graphDistanceScore(hops, ["Line", "Equipment"])).toBeCloseTo(0.5, 12); // 取最近
    expect(graphDistanceScore(undefined, ["Line"])).toBe(0); // 无图中性
    expect(graphDistanceScore(hops, ["Customer"])).toBe(0); // 不在图 → 0
  });

  it("SEAM：离焦点更近的资源 ontology 子分更高 → 排名更前（真图非常数）+ mutation", () => {
    const hopsFromFocus = new Map([["Base", 0], ["Line", 1], ["Equipment", 3]]);
    const engine = new ResourceSearchEngine({ hopsFromFocus });
    // 两资源除声明对象类型外全同（scopeObjectTypes 驱动 rTypes）。
    const near = solverRes("near", { scopeObjectTypes: ["Line"] } as Partial<IntelligenceResource>);
    const far = solverRes("far", { scopeObjectTypes: ["Equipment"] } as Partial<IntelligenceResource>);
    const res = engine.search("产能推演", [near, far], { maxResults: 10, minScore: 0 });
    const nr = res.results.find((x) => x.resource.key === "near")!;
    const fr = res.results.find((x) => x.resource.key === "far")!;
    expect(nr.scoreBreakdown.ontology).toBeGreaterThan(fr.scoreBreakdown.ontology);
    expect(ranks(res)["near"]).toBeLessThan(ranks(res)["far"]);
    // mutation：把跳数图反过来（Line 远、Equipment 近）→ 排名翻转。
    const flipped = new ResourceSearchEngine({ hopsFromFocus: new Map([["Base", 0], ["Line", 3], ["Equipment", 1]]) });
    const res2 = flipped.search("产能推演", [near, far], { maxResults: 10, minScore: 0 });
    expect(ranks(res2)["far"]).toBeLessThan(ranks(res2)["near"]);
  });
});

describe("WO-DRIL-P3 · relationStrength（§7.2 ontology 第三项·组包场景）", () => {
  it("relationStrengthScore 纯函数：指向已选中占比·无选中 → 0", () => {
    const rels = [{ toKind: "solver", toKey: "X" }, { toKind: "slice", toKey: "Y" }];
    expect(relationStrengthScore(rels, new Set(["solver|X"]))).toBeCloseTo(0.5, 12);
    expect(relationStrengthScore(rels, new Set(["solver|X", "slice|Y"]))).toBe(1);
    expect(relationStrengthScore(rels, new Set())).toBe(0);
    expect(relationStrengthScore(undefined, new Set(["solver|X"]))).toBe(0);
  });

  it("SEAM：关联已选中 solver 的资源 ontology 子分更高（组包上浮）", () => {
    const engine = new ResourceSearchEngine({ selectedKeys: new Set(["solver|capacity_forecast"]) });
    const wfRelated = {
      kind: "workflow", key: "wf_related", label: "产能核查流程", description: "调用产能推演求解器的工作流。",
      relations: [{ relType: "invokes", toKind: "solver", toKey: "capacity_forecast" }],
    } as IntelligenceResource;
    const wfUnrelated = {
      kind: "workflow", key: "wf_unrelated", label: "产能核查流程", description: "调用产能推演求解器的工作流。",
      relations: [{ relType: "invokes", toKind: "solver", toKey: "other_solver" }],
    } as IntelligenceResource;
    const res = engine.search("产能推演", [wfRelated, wfUnrelated], { maxResults: 10, minScore: 0 });
    const rel = res.results.find((x) => x.resource.key === "wf_related")!;
    const unrel = res.results.find((x) => x.resource.key === "wf_unrelated")!;
    expect(rel.scoreBreakdown.ontology).toBeGreaterThan(unrel.scoreBreakdown.ontology);
  });
});

describe("WO-DRIL-P3 · overlayQuality（运行时分叠加·不改真值源）", () => {
  it("有分行 → 覆盖 successRate/usageCount/avgLatencyMs；无分行 → 原样", () => {
    const base = solverRes("s", { quality: { accuracy: 0.7, trustLevel: "PRODUCTION" } });
    const overlaid = overlayQuality(base, { tenantId: TENANT, kind: "solver", key: "s", successRate: 0.42, usageCount: 9, avgLatencyMs: 1234, lastProbeAt: "2026-07-25T00:00:00Z" });
    expect(overlaid.quality).toMatchObject({ accuracy: 0.7, trustLevel: "PRODUCTION", successRate: 0.42, usageCount: 9, avgLatencyMs: 1234 });
    expect(overlayQuality(base, undefined)).toBe(base); // 无分行原样（同引用）
  });
});

describe("WO-DRIL-P3 · 端到端 SEAM：质量探针 → 仓储 → registry 叠加 → 再检索排名位移", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
    const { agents, workflows, skills } = seedRegistry();
    for (const w of workflows) await t.repos.workflows.insert(w);
    for (const s of skills) await t.repos.skills.insert(s);
    for (const a of agents) await t.repos.agents.insert(a);
    for (const m of seedMcpConfigs()) await t.repos.mcpConfigs.insert(m);
  });

  async function search(body: Record<string, unknown>): Promise<ResourceSearchResponse> {
    const res = await t.app.inject({ method: "POST", url: "/b/v1/resources/search", headers: { ...debugHeaders(ADMIN), "content-type": "application/json" }, payload: body });
    expect(res.statusCode).toBe(200);
    return res.json() as ResourceSearchResponse;
  }
  async function probe(kind: string, key: string, success: boolean, latencyMs: number) {
    const res = await t.app.inject({ method: "POST", url: `/b/v1/resources/${kind}/${key}/quality`, headers: { ...debugHeaders(ADMIN), "content-type": "application/json" }, payload: { success, latencyMs } });
    expect(res.statusCode).toBe(200);
    return res.json() as { quality: { successRate: number } };
  }

  it("capacity_forecast 探成功→history 升→排名上移；再探失败→history 降→排名回落（自参照真移动）", async () => {
    const q = { query: "产能推演满足度缺口", minScore: 0, kinds: ["solver"] };
    const base = await search(q);
    const baseCf = base.results.find((r) => r.resource.key === "capacity_forecast")!;
    expect(baseCf).toBeTruthy();
    const baseHistory = baseCf.scoreBreakdown.history;
    const baseRank = base.results.findIndex((r) => r.resource.key === "capacity_forecast");

    // 探针：3 次成功 → successRate→1 → history 升。
    for (let i = 0; i < 3; i++) await probe("solver", "capacity_forecast", true, 800);
    const high = await search(q);
    const highCf = high.results.find((r) => r.resource.key === "capacity_forecast")!;
    const highRank = high.results.findIndex((r) => r.resource.key === "capacity_forecast");
    expect(highCf.scoreBreakdown.history).toBeGreaterThan(baseHistory);
    expect(highRank).toBeLessThanOrEqual(baseRank); // 上移或持平

    // 再探针：20 次失败 → successRate 衰减 → history 降 → 排名相对高质态回落。
    for (let i = 0; i < 20; i++) await probe("solver", "capacity_forecast", false, 55000);
    const low = await search(q);
    const lowCf = low.results.find((r) => r.resource.key === "capacity_forecast")!;
    const lowRank = low.results.findIndex((r) => r.resource.key === "capacity_forecast");
    expect(lowCf.scoreBreakdown.history).toBeLessThan(highCf.scoreBreakdown.history);
    expect(lowRank).toBeGreaterThanOrEqual(highRank); // 低质态排名不高于高质态（下降或持平）
  });

  it("relations 端点 1-hop：capacity_check 工作流出边含 invokes→capacity_forecast", async () => {
    // 先触发投影。
    await search({ query: "产能", minScore: 0 });
    const res = await t.app.inject({ method: "GET", url: `/b/v1/resources/workflow/capacity_check/relations`, headers: debugHeaders(ADMIN) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { relations: { relType: string; toKind: string; toKey: string }[] };
    expect(body.relations.some((r) => r.relType === "invokes" && r.toKind === "solver" && r.toKey === "capacity_forecast")).toBe(true);
  });
});
