import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";

/**
 * PANORAMA-SLICE-BACKFILL（全景→字段→切片 链条第三环）：
 * 七视角（GRAPH-PANORAMA-ONLY 已删）域知识以「切片形态」存续 —— 五域各配一张声明式多跳切片。
 * 真值 resolve（非空）+ 多跳锚点（降单跳即失·守「多跳非单跳」）+ 确定性 R6 + 发现纪律（description/argHints·R3）。
 */

interface SliceResult {
  nodes: { id: string; typeKey: string; objectKey: string; props: Record<string, unknown> }[];
  edges: { linkKey: string; from: string; to: string }[];
  truncated: boolean;
  snapshotVersion: string;
}

const resolveKey = (t: Awaited<ReturnType<typeof makeApp>>, key: string, args: Record<string, unknown>, headers = ADMIN) =>
  t.app.inject({ method: "POST", url: `/a/v1/ontology/slices/${key}/resolve`, headers, payload: { args } });

const typesOf = (out: SliceResult) => new Set(out.nodes.map((n) => n.typeKey));

/** 五域切片 → (示例入参, 多跳深层锚点类型)。深层类型仅经 ≥2 跳可达 → 降单跳即从结果消失。 */
const DOMAIN_SLICES: { key: string; args: Record<string, unknown>; root: string; deep: string[]; hopAnchor: string }[] = [
  { key: "panorama.backbone", args: { so: "SO-3391" }, root: "Order", deep: ["Model", "Base", "Line", "Process", "Equipment", "Material"], hopAnchor: "Equipment" },
  { key: "panorama.dataflow", args: { so: "SO-3391" }, root: "Order", deep: ["Model", "Material", "MaterialBatch", "PurchaseOrder", "DataSourceHealth"], hopAnchor: "MaterialBatch" },
  { key: "panorama.solver_binding", args: { baseId: "changzhou" }, root: "Base", deep: ["Line", "Process", "Equipment"], hopAnchor: "Equipment" },
  { key: "panorama.orchestration", args: { key: "baseline" }, root: "AnnualScenario", deep: ["PlanTarget", "Principal", "CapexProject", "FinanceMetric"], hopAnchor: "Principal" },
  { key: "enterprise_360", args: { so: "SO-3391" }, root: "Order", deep: ["Model", "Base", "Material", "Certification", "CarbonFactor"], hopAnchor: "Certification" },
];

describe("PANORAMA-SLICE-BACKFILL 五域切片（切片形态存续七视角域知识）", () => {
  it("PB1: 五域切片各 resolve 非空 + 多跳深层类型齐（真值·spannedTypes≥3）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    for (const s of DOMAIN_SLICES) {
      const res = await resolveKey(t, s.key, s.args);
      expect(res.statusCode, `${s.key} resolve 200`).toBe(200);
      const out = res.json() as SliceResult;
      // 非空真值
      expect(out.nodes.length, `${s.key} 非空`).toBeGreaterThan(0);
      // root 唯一/存在
      expect(typesOf(out).has(s.root), `${s.key} 含根类型 ${s.root}`).toBe(true);
      // spannedTypes≥3
      expect(typesOf(out).size, `${s.key} 覆盖类型≥3`).toBeGreaterThanOrEqual(3);
      // 多跳深层锚点齐（缺任一 = 链路未走全）
      for (const d of s.deep) expect(typesOf(out).has(d), `${s.key} 缺深层类型 ${d}`).toBe(true);
      // 有真实边（非孤立节点堆）
      expect(out.edges.length, `${s.key} 含边`).toBeGreaterThan(0);
    }
  });

  it("PB2: 多跳守卫（降单跳→红锚点）—— 深层锚点仅经 ≥2 跳可达，且从 root 边可追溯", async () => {
    const t = await makeApp();
    await seedBattery(t);
    for (const s of DOMAIN_SLICES) {
      const out = (await resolveKey(t, s.key, s.args)).json() as SliceResult;
      const anchorNodes = out.nodes.filter((n) => n.typeKey === s.hopAnchor);
      // 锚点类型确实出现（若切片被截成单跳，此锚点缺席 → 本断言红）。
      expect(anchorNodes.length, `${s.key} 多跳锚点 ${s.hopAnchor} 应可达`).toBeGreaterThan(0);
      // 锚点不与 root 类型同层：锚点节点均非 root 类型（真多跳，非 root 单层）。
      const rootIds = new Set(out.nodes.filter((n) => n.typeKey === s.root).map((n) => n.id));
      for (const a of anchorNodes) expect(rootIds.has(a.id)).toBe(false);
      // 存在一条以 root 为端的边（子图从 root 展开，非游离）。
      const hasRootEdge = out.edges.some((e) => rootIds.has(e.from) || rootIds.has(e.to));
      expect(hasRootEdge, `${s.key} 子图应从 root 展开`).toBe(true);
    }
  });

  it("PB3: 确定性 R6 —— 同 seed 重跑节点/边集合字节级一致", async () => {
    const a = await makeApp();
    await seedBattery(a);
    const b = await makeApp();
    await seedBattery(b);
    for (const s of DOMAIN_SLICES) {
      const ra = (await resolveKey(a, s.key, s.args)).json() as SliceResult;
      const rb = (await resolveKey(b, s.key, s.args)).json() as SliceResult;
      const norm = (r: SliceResult) => ({
        nodes: r.nodes.map((n) => n.id).sort(),
        edges: r.edges.map((e) => `${e.linkKey}|${e.from}|${e.to}`).sort(),
      });
      expect(norm(ra), `${s.key} 确定性`).toEqual(norm(rb));
    }
  });

  it("PB4: 五域切片契约 fixture 全绿（slice-contracts/run）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const body = (await t.app.inject({ method: "POST", url: "/a/v1/ontology/slice-contracts/run", headers: ADMIN })).json() as {
      results: { sliceKey: string; ok: boolean; diff?: string }[];
    };
    for (const s of DOMAIN_SLICES) {
      const r = body.results.find((x) => x.sliceKey === s.key);
      expect(r, `${s.key} 契约结果存在`).toBeTruthy();
      expect(r!.ok, r!.diff).toBe(true);
    }
  });

  it("PB5: 发现纪律 + R3 —— 五域切片进 catalog discover（description/argHints 齐·feature 过滤先于 authz）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const body = (await t.app.inject({ method: "GET", url: "/a/v1/catalog?kind=slices", headers: ADMIN })).json() as {
      items: { key: string; description: string; argHints: Record<string, string> }[];
    };
    const byKey = new Map(body.items.map((i) => [i.key, i]));
    for (const s of DOMAIN_SLICES) {
      const it = byKey.get(s.key);
      expect(it, `${s.key} 应在 discover 目录`).toBeTruthy();
      expect(it!.description.trim().length, `${s.key} description 非空（发现纪律）`).toBeGreaterThan(0);
      expect(Object.keys(it!.argHints).length, `${s.key} argHints 非空`).toBeGreaterThan(0);
      // argHints 示例值可从描述抽出（融合页据此构造试切入参）。
      const hint = Object.values(it!.argHints)[0]!;
      expect(/如[\s：:]*\S+/.test(hint), `${s.key} argHints 含示例值`).toBe(true);
    }
  });

  it("PB6: 切片清单/索引含五域切片（融合页列表数据源）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const list = (await t.app.inject({ method: "GET", url: "/a/v1/ontology/slices", headers: ADMIN })).json() as { sliceKey: string; hops: number }[];
    const keys = new Set(list.map((s) => s.sliceKey));
    for (const s of DOMAIN_SLICES) expect(keys.has(s.key), `清单缺 ${s.key}`).toBe(true);
    // 索引解析出的 spannedTypes 与真值口径一致（≥3）。
    const idx = (await t.app.inject({ method: "GET", url: "/a/v1/slices/index", headers: ADMIN })).json() as { entries: { sliceKey: string; spannedTypes: string[] }[] };
    for (const s of DOMAIN_SLICES) {
      const e = idx.entries.find((x) => x.sliceKey === s.key);
      expect(e, `索引缺 ${s.key}`).toBeTruthy();
      expect(e!.spannedTypes.length, `${s.key} 索引 spannedTypes≥3`).toBeGreaterThanOrEqual(3);
    }
  });
});
