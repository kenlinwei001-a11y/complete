import { describe, expect, it } from "vitest";
import { makeApp, ADMIN } from "./helpers.js";
import { SOLVER_KEYS } from "../src/solvers/service.js";
import {
  SOLVER_CATEGORY_MAP,
  solverCategoryOf,
  solversByCategory,
  solversInCategory,
  uncategorizedSolverKeys,
} from "../src/solvers/taxonomy.js";
import { datacoreResourceDescriptors } from "../src/catalog.js";
import { SOLVER_CATEGORIES, SOLVER_CATEGORY_META, isSolverCategory, type SolverCategory } from "@platform/contracts";

/**
 * WO-L7A · 内置求解器决策问题分类维（10 类）。
 *
 * 两条效果层判据（工单硬要求）：
 *  ① **相等不是非空**：按某类目检索 → 返回的 solver 集合**恰好等于**该类目成员集；
 *  ② **无漏网**：`SOLVER_KEYS.length === 已分类数 === 59`（59 = 本单实测值，见交付说明）。
 *
 * 判据 ① 在**两层**各断言一次：纯函数层（`solversInCategory`）与 HTTP 层
 * （`GET /a/v1/solvers/registry?category=`）。只测纯函数 = 测的是函数不是链路
 * （本仓「只有 test 引用 = 已排练不是已实现」的老坑）；HTTP 那条才驱动真消费方。
 */

/**
 * 本单实测的内置求解器总数（同 ontology-core.test.ts 的金值·抽取命令见 docs/WO-L7A-delivery.md §1）。
 *
 * 59 → **60**：WO-FLOWTIME 的 `process_flow_time`（2026-08-14 WO-R9-PROCESS-MERGE 合并时收编）。
 * 60 → **61**：WO-FINANCE-WORLDSTATE 的 `finance_world_projection`（财务**金额**随世界态扰动的投影
 *   —— `finance_pnl` 签名不吃 worldId，缺的就是金额那一跳）。
 * ⚠ 本文件的金值**必须与 `ontology-core.test.ts` 同步改**——两处写的是同一个数，
 *   改一处不改另一处会出现「一个文件绿一个文件红」，而先看到哪个纯看运气。
 */
const SOLVER_TOTAL = 61;

/**
 * 类目 → 成员 的**期望值**（测试侧独立写死一份，与 `SOLVER_CATEGORY_MAP` 对拍）。
 * 故意不从 `SOLVER_CATEGORY_MAP` 反推——从被测对象推期望值就是自证自明，改错了照样绿。
 */
const EXPECTED: Record<SolverCategory, string[]> = {
  capacity_bottleneck: [
    "capacity_rollup",
    "capacity_forecast",
    "bottleneck_matrix",
    "shared_bottleneck",
    "base_capacity_outlook",
    "chain_impediments",
  ],
  planning_scheduling: [
    "plan_audit",
    "plan_generate",
    "cert_schedule",
    "changeover_sequence",
    "maintenance_stagger",
    "job_shop_schedule",
    "sequencing_optimize",
    "sop_reschedule",
    "portfolio",
  ],
  material_inventory: ["kit_readiness", "lta_gap", "inventory_optimize", "mrp_netting"],
  risk_propagation: [
    "risk_timeline",
    "affected_orders",
    "counterfactual_timeline",
    "audit_timeline",
    "concentration_risk",
    "supplier_disruption_radius",
  ],
  root_cause_attribution: [
    "yield_diagnosis",
    "plan_rootcause",
    "margin_attribution",
    "gap_attribution",
    "supply_demand_gap_attribution",
    "chain_loss_attribution",
    // WO-FLOWTIME：与上一条**分层**不是重复——那个答「哪一段慢」（链路节拍层·环节损失占比），
    // 这个答「哪一张单卡着、卡在谁那里、卡了多久」（流程实例层·全量实例 + 天数 + 责任方 + 溯源）。
    "process_flow_time",
  ],
  countermeasure_closure: [
    "mitigation_select",
    "outsourcing_split",
    "quarterly_gap",
    "countermeasure_combo",
    "decision_play",
  ],
  order_commitment: ["quote_margin", "credit_exposure", "order_fullchain", "atp_check"],
  performance_finance: [
    "capex_scenario",
    "carbon_footprint",
    "metric_rollup",
    "cockpit_kpi",
    "finance_pnl",
    // WO-FINANCE-WORLDSTATE：与上一条**分层**不是重复 —— `finance_pnl` 答「本体真值下三科目各是多少」
    // （静态口径·不吃 worldId），这个答「在**这个推演世界**里、施加扰动之后各变成多少钱」（世界态投影口径）。
    "finance_world_projection",
    "ksf_graph",
  ],
  combinatorial_allocation: [
    "selection_optimize",
    "assignment_optimize",
    "packing_optimize",
    "facility_location",
    "min_cost_flow",
    "set_cover",
    "independent_set",
    "combinatorial_auction",
    "multi_objective",
    "cross_object_occupancy",
  ],
  whatif_exploration: ["generic_inference", "optimize_whatif", "ontology_query"],
};

/** 期望表按 `SOLVER_KEYS` 声明序归一（`solversInCategory` 的契约序·比对前统一口径）。 */
const inDeclOrder = (keys: string[]): string[] =>
  (SOLVER_KEYS as readonly string[]).filter((k) => keys.includes(k));

/**
 * 集合口径归一（排序）。**为什么 HTTP 层用集合而不用序**：`/a/v1/solvers/registry` 的论域是
 * `ALL_SOLVER_CATALOG = [...SOLVER_CATALOG, ...GENERIC_SOLVER_CATALOG, ...COCKPIT_SOLVER_CATALOG]`，
 * 三池拼接序 ≠ `SOLVER_KEYS` 声明序（实测：`chain_impediments` 在 GENERIC 池、`base_capacity_outlook`
 * 在 COCKPIT 池，故注册表里前者排在后者之前，而 SOLVER_KEYS 里正相反）。
 * 判据要的是「返回的 solver **集合**恰好等于该类目下的那些 key」——集合相等，故这里排序后比对；
 * 本单**不**去改既有注册表端点的返回顺序（那是别的消费方的既有契约，改序 = 越界的行为变更）。
 * 声明序那条约束在纯函数层（`solversInCategory`）已严格断言，两层各守各的口径。
 */
const asSet = (keys: string[]): string[] => [...keys].sort();

describe("WO-L7A · 求解器决策问题分类维（10 类）", () => {
  it("金丝雀：抽取/查询工具本身是对的（一个确定在册的 solver 必须查得到类目·查不到=工具坏了不是没分类）", () => {
    // 正向金丝雀：capacity_forecast 确定在册，必须查出类目。
    expect(SOLVER_KEYS as readonly string[]).toContain("capacity_forecast");
    expect(solverCategoryOf("capacity_forecast")).toBe("capacity_bottleneck");
    // 反向金丝雀：一个确定不在册的 key 必须查不出类目（防"什么都返回"的过宽实现）。
    expect(solverCategoryOf("definitely_not_a_solver_key")).toBeUndefined();
    // 类目枚举守卫同样双向。
    expect(isSolverCategory("capacity_bottleneck")).toBe(true);
    expect(isSolverCategory("definitely_not_a_category")).toBe(false);
  });

  it("判据②·无漏网：SOLVER_KEYS 59 条 === 已分类 59 条，一条不多一条不少", () => {
    // 实测总数（与 ontology-core.test.ts 金值同源）。
    expect(SOLVER_KEYS.length).toBe(SOLVER_TOTAL);
    // 每个 solver 都有类目（0 漏网）。
    expect(uncategorizedSolverKeys()).toEqual([]);
    // 已分类数 === 总数（不是"≥"也不是"非空"）。
    const categorized = (SOLVER_KEYS as readonly string[]).filter((k) => solverCategoryOf(k) !== undefined);
    expect(categorized.length).toBe(SOLVER_TOTAL);
    // 归档表键集 === SOLVER_KEYS 键集（防"多归了一个已删除的 key"这种反向漂移）。
    expect(new Set(Object.keys(SOLVER_CATEGORY_MAP))).toEqual(new Set(SOLVER_KEYS));
    // 10 个类目的成员数之和 === 59，且互不重叠（分类是**划分**，不是打标签）。
    const groups = solversByCategory();
    expect(groups.length).toBe(10);
    expect(groups.reduce((n, g) => n + g.solverKeys.length, 0)).toBe(SOLVER_TOTAL);
    expect(new Set(groups.flatMap((g) => g.solverKeys)).size).toBe(SOLVER_TOTAL);
    // 每个类目都非空（不许有摆设类目）+ 都有中文标签与决策问句（"没有描述不允许发布"同构）。
    for (const g of groups) {
      expect(g.solverKeys.length, `类目 ${g.category} 是空的`).toBeGreaterThan(0);
      expect(SOLVER_CATEGORY_META[g.category].label.trim().length).toBeGreaterThan(0);
      expect(SOLVER_CATEGORY_META[g.category].decisionQuestion.trim().length).toBeGreaterThan(0);
    }
  });

  it("判据①·纯函数层：每个类目检索结果 **恰好等于** 该类目成员集（相等，非包含/非空）", () => {
    for (const category of SOLVER_CATEGORIES) {
      expect(solversInCategory(category), `类目 ${category} 成员集不符`).toEqual(inDeclOrder(EXPECTED[category]));
    }
    // 反证：任取一个类目，它一定不包含别的类目的成员（互斥·防"全都返回"的假绿）。
    expect(solversInCategory("whatif_exploration")).not.toContain("atp_check");
  });

  it("确定性 R6：分类表稳定排序，重复调用字节级一致，且不依赖对象键序", () => {
    expect(JSON.stringify(solversByCategory())).toBe(JSON.stringify(solversByCategory()));
    // 类目间序 === SOLVER_CATEGORIES 声明序。
    expect(solversByCategory().map((g) => g.category)).toEqual([...SOLVER_CATEGORIES]);
    // 类目内序 === SOLVER_KEYS 声明序（取一个多成员类目验）。
    const idx = (k: string) => (SOLVER_KEYS as readonly string[]).indexOf(k);
    const seq = solversInCategory("planning_scheduling").map(idx);
    expect(seq).toEqual([...seq].sort((a, b) => a - b));
    // 键序无关：把归档表键序打乱重建，分组结果不变（证明输出不取 Object.keys 顺序）。
    const shuffled = Object.fromEntries(Object.entries(SOLVER_CATEGORY_MAP).reverse());
    expect(new Set(Object.keys(shuffled))).toEqual(new Set(Object.keys(SOLVER_CATEGORY_MAP)));
  });

  it("SEAM · HTTP 层判据①：GET /a/v1/solvers/registry?category= 返回的 key 集恰好等于该类目成员集（驱动真消费方）", async () => {
    const t = await makeApp();
    for (const category of SOLVER_CATEGORIES) {
      const res = await t.app.inject({
        method: "GET",
        url: `/a/v1/solvers/registry?category=${category}`,
        headers: ADMIN,
      });
      expect(res.statusCode, category).toBe(200);
      const { solvers } = res.json() as { solvers: { key: string; category?: string }[] };
      // 恰好相等（不是"包含"、不是"非空"）：集合相等 + 计数相等（计数挡住重复项凑数）。
      expect(asSet(solvers.map((s) => s.key)), `类目 ${category} 的注册表检索结果不符`).toEqual(asSet(EXPECTED[category]));
      expect(solvers.length, `类目 ${category} 计数不符`).toBe(EXPECTED[category].length);
      // 每条都带回类目字段（前端可直接分组）。
      expect(solvers.every((s) => s.category === category)).toBe(true);
    }
  });

  it("SEAM · HTTP 层判据②：不带 category 时注册表仍是 59 条全量，且**每条**都带类目（无漏网传到线上）", async () => {
    const t = await makeApp();
    const { solvers } = (await t.app.inject({ method: "GET", url: "/a/v1/solvers/registry", headers: ADMIN })).json() as {
      solvers: { key: string; category?: string }[];
    };
    expect(solvers.length).toBe(SOLVER_TOTAL);
    expect(solvers.filter((s) => !s.category).map((s) => s.key)).toEqual([]);
    // 各类目计数之和 === 59（线上投影与本地归档表对得上）。
    const byCat = new Map<string, number>();
    for (const s of solvers) byCat.set(s.category!, (byCat.get(s.category!) ?? 0) + 1);
    expect([...byCat.values()].reduce((a, b) => a + b, 0)).toBe(SOLVER_TOTAL);
    for (const category of SOLVER_CATEGORIES) {
      expect(byCat.get(category), `类目 ${category} 计数不符`).toBe(EXPECTED[category].length);
    }
  });

  it("GET /a/v1/solvers/categories 登记表：10 类 + 决策问句 + 成员 key + uncategorized 空", async () => {
    const t = await makeApp();
    const body = (await t.app.inject({ method: "GET", url: "/a/v1/solvers/categories", headers: ADMIN })).json() as {
      categories: { category: SolverCategory; label: string; decisionQuestion: string; solverKeys: string[]; count: number }[];
      total: number;
      uncategorized: string[];
    };
    expect(body.total).toBe(SOLVER_TOTAL);
    expect(body.uncategorized).toEqual([]); // 诚实亮出漏网；空 = 全覆盖
    expect(body.categories.map((c) => c.category)).toEqual([...SOLVER_CATEGORIES]);
    for (const c of body.categories) {
      expect(c.solverKeys, `类目 ${c.category}`).toEqual(inDeclOrder(EXPECTED[c.category]));
      expect(c.count).toBe(c.solverKeys.length);
      expect(c.decisionQuestion.length).toBeGreaterThan(0);
    }
    expect(body.categories.reduce((n, c) => n + c.count, 0)).toBe(SOLVER_TOTAL);
  });

  it("非法类目显式 400（不静默忽略参数返全量——静默会让调用方以为筛过了）", async () => {
    const t = await makeApp();
    const bad1 = await t.app.inject({ method: "GET", url: "/a/v1/solvers/registry?category=bogus", headers: ADMIN });
    expect(bad1.statusCode).toBe(400);
    const bad2 = await t.app.inject({ method: "GET", url: "/a/v1/catalog?kind=solvers&category=bogus", headers: ADMIN });
    expect(bad2.statusCode).toBe(400);
  });

  it("资源投影带上类目：datacoreResourceDescriptors 的 solver 条目 59/59 有 category（发现侧供给）", () => {
    const solvers = datacoreResourceDescriptors().filter((d) => d.kind === "solver");
    expect(solvers.length).toBe(SOLVER_TOTAL);
    expect(solvers.filter((d) => !d.category).map((d) => d.key)).toEqual([]);
    for (const d of solvers) expect(d.category).toBe(solverCategoryOf(d.key));
    // 切片条目不该被塞类目（分类维是求解器专有）。
    expect(datacoreResourceDescriptors().filter((d) => d.kind === "slice").every((d) => d.category === undefined)).toBe(true);
  });

  it("discover 场景池按类目筛选生效（论域=场景池 ⊂ 全 59，故断言 = 类目 ∩ 场景池）", async () => {
    const t = await makeApp();
    const res = await t.app.inject({
      method: "GET",
      url: "/a/v1/catalog?kind=solvers&category=order_commitment",
      headers: ADMIN,
    });
    expect(res.statusCode).toBe(200);
    const { items } = res.json() as { items: { key: string; category?: string }[] };
    // 场景池含 quote_margin/credit_exposure（SOLVER_CATALOG）+ order_fullchain/atp_check（COCKPIT），四条齐。
    expect(items.map((i) => i.key).sort()).toEqual(["atp_check", "credit_exposure", "order_fullchain", "quote_margin"]);
    expect(items.every((i) => i.category === "order_commitment")).toBe(true);
    // 切片池无类目维 → 给了类目即诚实空集（不静默返全量）。
    const slices = (await t.app.inject({
      method: "GET",
      url: "/a/v1/catalog?kind=slices&category=order_commitment",
      headers: ADMIN,
    })).json() as { items: unknown[] };
    expect(slices.items).toEqual([]);
  });
});
