import { describe, it, expect, beforeEach } from "vitest";
import type { IntelligenceResource, ResourceSearchResponse } from "@platform/contracts";
import { createTestApp, debugHeaders, ADMIN, TENANT, type TestApp } from "./helpers.js";
import { seedRegistry, seedMcpConfigs } from "../src/mocks/seed.js";
import { projectSolvers, type CatalogItem } from "../src/dril/resource-projector.js";
import { ResourceSearchEngine } from "../src/dril/search-engine.js";
import { extractTieredTags } from "../src/dril/tag-taxonomy.js";

/**
 * WO-DRIL-P2 · 五级标签 + 混合检索 SEAM 门（`dril-retrieval:check`）。
 * 头号判据：golden query set（NL→预期资源 key）→ 预期资源进入 top-3 ≥ 90%（真排序·非同义反复）。
 * + fail-open（embedder=null → 词法回退不崩）+ R6 确定性（同 query 同 registry 字节同序）
 * + R3 entitlement（关 feature 的资源不出现）。
 *
 * 接缝：投影(projectSolvers) × 标签(extractTieredTags 内置于 engine) × 排序(ResourceSearchEngine)——任一半漏即红。
 */

// 代表性求解器目录（镜像 DataCore SOLVER_CATALOG / COCKPIT_SOLVER_CATALOG 的真实描述，非造词）。
const GOLDEN_CATALOG: CatalogItem[] = [
  { key: "capacity_forecast", name: "产能推演", description: "给定型号/数量/周数，推演产能满足度（P50/P90、缺口率、主瓶颈）。", domain: "plan", argHints: { modelId: "型号 ID" } },
  { key: "capacity_rollup", name: "产能上卷", description: "把工序/产线产能沿本体金字塔上卷到基地/型号维度。", domain: "capacity" },
  { key: "bottleneck_matrix", name: "瓶颈矩阵", description: "按基地×工序输出瓶颈强度矩阵，定位约束工序。", domain: "capacity" },
  { key: "risk_timeline", name: "风险时间线", description: "按日推演风险时序（越线点/根因链）。", domain: "plan" },
  { key: "affected_orders", name: "受影响订单", description: "给定扰动，返回受影响订单清单（problems/rootChain）。", domain: "sales" },
  { key: "inventory_optimize", name: "库存优化", description: "目标水位/超储/欠储/呆滞与可释放资金。", domain: "material" },
  { key: "kit_readiness", name: "物料齐套", description: "逐单算齐套率（含在途按 ETA），输出缺料与建议。", domain: "material" },
  { key: "yield_diagnosis", name: "良率诊断", description: "2σ 滑窗突变检测 + 根因候选按时间贴近度排序。", domain: "quality" },
  { key: "changeover_sequence", name: "换型排序", description: "最近邻贪心最小化换型时长，标注交期不可行单。", domain: "plan" },
  { key: "credit_exposure", name: "信用敞口", description: "敞口=应收+在产；可用额与逾期判定（C32）。", domain: "finance" },
  { key: "carbon_footprint", name: "碳足迹核算", description: "物料+能耗两段碳排，对比欧盟阈值给改善杠杆。", domain: "plan" },
  { key: "maintenance_stagger", name: "检修错峰", description: "检修周与交付高峰冲突 → ±4 周内选负荷最低周。", domain: "equip" },
  { key: "cert_schedule", name: "认证排期", description: "按缺口贡献/工时优先级，受 C26 并行约束贪心排认证到周。", domain: "plan" },
  { key: "finance_pnl", name: "量价本利科目表", description: "读 FinancePlan 出收入/销售成本/毛利 预算vs滚动vs差异 + 毛利率行。", domain: "finance" },
  { key: "supply_demand_gap_attribution", name: "供需失衡双向归因", description: "产销缺口双向分摊到需求端(预测偏差)与供给端(产能/物料/设备)，各占多少、每叶证据。", domain: "decision", answersQuestions: ["供需为什么对不上", "需求预测虚高还是供不上", "各占多少"], tags: ["supply-demand", "gap", "attribution", "forecast"] },
  // WO-DRIL-PRECISION：对口根因族——镜像真目录 answersQuestions，让对口 solver 拿到语义分排到榜首。
  { key: "gap_attribution", name: "深度反向缺口归因", description: "总目标缺口沿本体反向多跳结构分摊到基地×订单×瓶颈叶，再沿因果边溯到终点根因，产原子因素表+residual。回答『总缺口一路归到哪些最终根因、各占多少、每叶证据』。", domain: "decision", answersQuestions: ["为什么这个指标没达标", "份额下降的根因是什么", "储能份额为什么下降逐层拆根因", "逐层拆根因、缺口一路归到哪些最终根因", "总缺口主要来自哪一层、各占多少", "每叶证据是什么"], tags: ["gap", "attribution", "rootcause", "缺口归因", "逐层拆根因", "指标没达标"] },
  { key: "margin_attribution", name: "毛利倒挂归因", description: "成本项拆解 + 倒挂群主驱动聚合，定位毛利倒挂的根因成本项。净室通用。", domain: "generic", answersQuestions: ["毛利为什么倒挂", "哪个成本项拖垮了毛利", "毛利倒挂的根因成本项是哪些", "成本项怎么拆解定位倒挂", "倒挂群的主驱动成本是什么"], tags: ["margin", "毛利倒挂", "成本项", "cost", "attribution"] },
];

const GOLDEN_ONTOLOGY_TYPES = [
  { key: "Base", label: "基地" },
  { key: "Line", label: "产线" },
  { key: "Model", label: "型号" },
  { key: "Order", label: "订单" },
  { key: "Material", label: "物料" },
  { key: "Equipment", label: "设备" },
  { key: "Customer", label: "客户" },
];

// golden query set：NL → 预期命中的 solver key（≥8 条）。
const GOLDEN_QUERIES: { query: string; expect: string }[] = [
  { query: "哪个求解器算产能缺口满足度", expect: "capacity_forecast" },
  { query: "产线换型顺序怎么排最省换型时间", expect: "changeover_sequence" },
  { query: "库存呆滞和超储欠储怎么优化释放资金", expect: "inventory_optimize" },
  { query: "订单物料齐套率怎么算缺料", expect: "kit_readiness" },
  { query: "良率突然下降的根因诊断", expect: "yield_diagnosis" },
  { query: "客户信用逾期敞口多大", expect: "credit_exposure" },
  { query: "设备检修和交付高峰冲突怎么错峰", expect: "maintenance_stagger" },
  { query: "产品碳足迹核算能耗碳排", expect: "carbon_footprint" },
  { query: "供需产销为什么对不上双向归因", expect: "supply_demand_gap_attribution" },
  { query: "认证工程师怎么排期到周", expect: "cert_schedule" },
  // WO-DRIL-PRECISION 命门：灌 answersQuestions 后对口根因 solver 须排到榜首（此前 gap_attribution 第4·margin_attribution 抢第1）。
  { query: "储能份额为什么下降 逐层拆根因", expect: "gap_attribution" },
];

function topKeys(res: ResourceSearchResponse, k: number): string[] {
  return res.results.slice(0, k).map((r) => r.resource.key);
}

describe("WO-DRIL-P2 · golden query set → top-3 命中率（SEAM 头号判据）", () => {
  // 镜像 registry 投影期回填：projectSolvers → extractTieredTags（L4 派生自本体·R14）。
  const resources = projectSolvers(GOLDEN_CATALOG).map((r) => ({
    ...r,
    tieredTags: extractTieredTags(`${r.label} ${r.description} ${r.capability ?? ""}`, {
      domain: r.domain,
      ontologyTypes: GOLDEN_ONTOLOGY_TYPES,
    }),
  })) as unknown as IntelligenceResource[];
  const engine = new ResourceSearchEngine({ ontologyTypes: GOLDEN_ONTOLOGY_TYPES });

  it("≥90% 的 golden query 让预期资源进入 top-3", () => {
    const misses: string[] = [];
    for (const g of GOLDEN_QUERIES) {
      const res = engine.search(g.query, resources, { maxResults: 10, minScore: 0 });
      const top3 = topKeys(res, 3);
      if (!top3.includes(g.expect)) misses.push(`${g.query} → 期望 ${g.expect}·实得 [${top3.join(", ")}]`);
    }
    const hitRate = (GOLDEN_QUERIES.length - misses.length) / GOLDEN_QUERIES.length;
    // 诊断：未命中项打印（便于审核复现真跑）。
    if (misses.length > 0) console.log("[dril-retrieval] top-3 未命中：\n" + misses.join("\n"));
    expect(hitRate, `top-3 命中率 ${(hitRate * 100).toFixed(1)}%`).toBeGreaterThanOrEqual(0.9);
  });

  it("WO-DRIL-PRECISION 命门：储能份额逐层拆根因 → gap_attribution 进 top-3 且压过 margin_attribution（灌样例问句·对口根因 solver 上榜）", () => {
    const res = engine.search("储能份额为什么下降 逐层拆根因", resources, { maxResults: 10, minScore: 0 });
    const keys = res.results.map((r) => r.resource.key);
    const top3 = keys.slice(0, 3);
    // 命门：对口根因 solver 必进 top-3（此前 gap_attribution 第4·没上 top-3=没做到）。
    expect(top3, `实得 top-3 [${top3.join(", ")}]`).toContain("gap_attribution");
    // 病根回归护栏：margin_attribution 不得再抢在 gap_attribution 之前（此前 margin 第1·gap 第4）。
    const gapRank = keys.indexOf("gap_attribution");
    const marginRank = keys.indexOf("margin_attribution");
    expect(gapRank).toBeGreaterThanOrEqual(0);
    expect(gapRank, `gap_attribution(${gapRank}) 应排在 margin_attribution(${marginRank}) 之前`).toBeLessThan(
      marginRank === -1 ? Number.POSITIVE_INFINITY : marginRank,
    );
  });

  it("每条结果带 scoreBreakdown（五项）+ 非空 explanation（§7.3 可解释性）", () => {
    const res = engine.search("哪个求解器算产能缺口", resources, { maxResults: 5, minScore: 0 });
    expect(res.results.length).toBeGreaterThan(0);
    const top = res.results[0]!;
    for (const k of ["semantic", "domain", "ontology", "history", "cost"] as const) {
      expect(typeof top.scoreBreakdown[k]).toBe("number");
    }
    expect(top.explanation.length).toBeGreaterThan(0);
    expect(res.explanation.length).toBeGreaterThan(0);
  });

  it("fail-open：embedder=null → 词法回退仍返合理结果（不崩·byte-兼容 top-1）", () => {
    const kwEngine = new ResourceSearchEngine({ embedder: null, ontologyTypes: GOLDEN_ONTOLOGY_TYPES });
    const res = kwEngine.search("库存呆滞怎么优化", resources, { maxResults: 5, minScore: 0 });
    expect(res.results.length).toBeGreaterThan(0);
    expect(topKeys(res, 3)).toContain("inventory_optimize");
  });

  it("R6 确定性：同 query 同资源集 → 字节级同序", () => {
    const a = engine.search("良率下降根因", resources, { maxResults: 8, minScore: 0 });
    const b = engine.search("良率下降根因", resources, { maxResults: 8, minScore: 0 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("structured filter：requiredTags.l3_scenario 硬过滤（只留场景匹配资源）", () => {
    const res = engine.search("成本", resources, {
      maxResults: 20,
      minScore: 0,
      requiredTags: { l3_scenario: ["库存优化"] },
    });
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.results.every((r) => (r.resource.tieredTags?.l3_scenario ?? []).includes("库存优化"))).toBe(true);
  });
});

describe("WO-DRIL-P2 · 端点 POST /b/v1/resources/search（接缝端到端）", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
    const { agents, workflows, skills } = seedRegistry();
    for (const w of workflows) await t.repos.workflows.insert(w);
    for (const s of skills) await t.repos.skills.insert(s);
    for (const a of agents) await t.repos.agents.insert(a);
    for (const m of seedMcpConfigs()) await t.repos.mcpConfigs.insert(m);
  });

  async function search(user: string, body: Record<string, unknown>): Promise<ResourceSearchResponse> {
    const res = await t.app.inject({
      method: "POST",
      url: "/b/v1/resources/search",
      headers: { ...debugHeaders(user), "content-type": "application/json" },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    return res.json() as ResourceSearchResponse;
  }

  it("产能推演类 query → capacity_forecast top-1，带 scoreBreakdown + explanation", async () => {
    const res = await search(ADMIN, { query: "推演产能满足度 P50 缺口", minScore: 0 });
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.results[0]!.resource.key).toBe("capacity_forecast");
    expect(res.results[0]!.scoreBreakdown.semantic).toBeGreaterThan(0);
    expect(res.explanation).toContain("capacity_forecast");
  });

  it("R6 确定性：连续两次同 body → 字节级同响应", async () => {
    const a = await search(ADMIN, { query: "受影响订单清单", minScore: 0 });
    const b = await search(ADMIN, { query: "受影响订单清单", minScore: 0 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("R3 entitlement：关 view.project-sim → capacity_forecast 不出现在结果", async () => {
    const before = await search(ADMIN, { query: "产能满足度推演", minScore: 0, kinds: ["solver"] });
    expect(before.results.some((r) => r.resource.key === "capacity_forecast")).toBe(true);
    t.deps.features.mock.disable(TENANT, "view.project-sim");
    const after = await search(ADMIN, { query: "产能满足度推演", minScore: 0, kinds: ["solver"] });
    expect(after.results.some((r) => r.resource.key === "capacity_forecast")).toBe(false);
  });

  it("tieredTags 回填：投影资源带五级标签（L4 派生自已发布对象类型·R14）", async () => {
    const res = await search(ADMIN, { query: "产能", minScore: 0, kinds: ["solver"] });
    const cf = res.results.find((r) => r.resource.key === "capacity_forecast");
    expect(cf).toBeTruthy();
    expect(cf!.resource.tieredTags).toBeTruthy();
    // L1 域来自真值 domain（plan）；L2/L3 由 taxonomy 关键词命中。
    expect(cf!.resource.tieredTags!.l1_domain).toContain("plan");
  });
});
