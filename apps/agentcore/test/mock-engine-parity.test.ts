/**
 * WO-MOCK-ENGINE-PARITY · mock 求解器与真引擎**同口径现算集合相等**（本单的牙·闭 §8 G-AGENTCORE-MOCK-DIVERGED-FROM-ENGINE）。
 *
 * 病灶（派单指认 + 本单复核成立，逐字段差见交单报告）：
 *   · 修前 mock `ontology_query` 把 linkPath **写死**成 P1 之前的旧路
 *     `["model_producible_at:in","order_for_model:in"]`（任何 rootType≠sel.type 同一条），而真引擎
 *     `runOntologyQuery` 从运行时本体图经 planSlice（确定性 BFS + 固定 tie-break）**现算**。
 *     A 侧本体加了 `model_demanded_by_order`（Model→Order 影响向）后，真侧 Base→Order 已改走它
 *     （等长候选 tie-break：域内边优先 → toType 字典序 → linkKey 字典序 → out 先于 in），
 *     mock 停在旧路 —— 咬 mock 的测试恒绿，因为它验的就是那份写死的数据。
 *   · 形态（铁律 0.6 句式）：「我用『mock 返回了 linkPath』当作『mock 的 linkPath 与真引擎一致』的证据。」
 *
 * 口径（两半都现算，无一写死）：
 *   · 真侧图 = `apps/datacore/src/synthetic/battery.ts` 当**文本**现算（跨 app import 源码违反
 *     contracts-only-shared；同 mock-discover-parity 的房规）。运行期租户增删类型由 datacore 侧守，
 *     本测试基准 = 种子本体全集。
 *   · 真侧形状 = `apps/datacore/src/solvers/service.ts` `SOLVER_OUTPUT_SHAPES` 文本现算
 *     （`shapeKeys(XSchema)` 形式经 **live import 契约包**求值，不手抄键名）。
 *   · mock 侧 = 真跑 `createMockDataCore().solver.invoke(...)` 现取。
 *   · 断言**集合相等**不是数量相等；差集逐条点名（缺哪个/多哪个）。
 *
 * 反假绿设计：
 *   §1 金丝雀（双向：已知必中 ∧ 已知不存在必不中）——与主判据**共用同一份抽取器**。
 *   §2 mock 镜像图 == battery.ts 现算图（类型 key+domain · 链路三元组，集合相等）。
 *   §3 BFS tie-break 锚点：slice-planner.ts 与 mock 移植件的四个排序键**同序**（文本锚，变了即红）。
 *   §4 接缝：真跑 mock ontology_query，linkPath/hops/usedSliceKeys/summary 逐字段 == 抽取图现算期望。
 *   §5 图敏感性自证：从抽取图里删掉 `model_demanded_by_order`，期望路径必须**变**（且退回历史旧路）
 *      —— 证明 §4 的期望真的在跟踪图，不是另一份写死。
 *   §6 五求解器顶层形状 == SOLVER_OUTPUT_SHAPES 同口径（条件键逐条带 why；catchall  schema 用
 *      「必填 ⊆ mock ∧ 多出 ⊆ 真侧别名」口径，不冒充穷尽）。
 *   §7 变异反证：断言函数喂变异输入必须报出那条变异（红在「缺哪个/多哪个」，不是「数量不等」）。
 *   §8 错误 parity：未知类型/未知链路/根过滤零匹配，mock 与真侧同口径抛 NO_QUERY_PLAN。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, stripComments } from "./factlock.js";
import { createMockDataCore } from "../src/mocks/clients.js";
import {
  MOCK_ONTOLOGY_LINKS,
  MOCK_ONTOLOGY_TYPES,
  MockNoQueryPlanError,
  buildOntologyAdjacency,
  hopsToLinkPath,
  planMockOntologyPaths,
  shortestOntologyPath,
  type MockOntologyLink,
  type MockOntologyType,
} from "../src/mocks/ontology-graph.js";
import type { ToolAuthCtx } from "../src/tools/clients.js";
import {
  BottleneckMatrixOutputSchema,
  CapacityForecastOutputSchema,
  OntologyQueryOutputSchema,
  OntologyQueryPlanSchema,
  OntologyQueryProvenanceSchema,
  PlanAuditOutputSchema,
  PlanGenerateOutputSchema,
  RiskTimelineOutputSchema,
} from "@platform/contracts";

const CTX: ToolAuthCtx = { tenantId: "demo", userId: "u1", roles: ["planner"] } as ToolAuthCtx;

// ---------------------------------------------------------------------------
// 文本抽取公用件（与同目录 mock-discover-parity.test.ts 同算法：跳字符串 + 配平 + 顶层切分）
// ---------------------------------------------------------------------------

const readStripped = (rel: string): string => stripComments(readFileSync(join(REPO_ROOT, rel), "utf8"));

function skipString(text: string, i: number): number {
  const q = text[i]!;
  let j = i + 1;
  while (j < text.length) {
    if (text[j] === "\\") { j += 2; continue; }
    if (text[j] === q) return j + 1;
    j += 1;
  }
  return j;
}

/** 从 `startIdx`（必须正好是 `open`）取到配平的 `close`，含两端；不配平返 null。 */
function balanced(text: string, startIdx: number, open: string, close: string): string | null {
  let depth = 0;
  for (let i = startIdx; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"' || c === "'" || c === "`") { i = skipString(text, i) - 1; continue; }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return text.slice(startIdx, i + 1);
    }
  }
  return null;
}

/** 从 `declRe` 命中的声明起取第一个 `open` 的配平体；任一环节失败抛「工具坏了」，绝不返空冒充。 */
function balancedAfter(text: string, declRe: RegExp, open: string, close: string, what: string): string {
  const m = declRe.exec(text);
  if (!m) throw new Error(`抽取器坏了：找不到 ${what}`);
  const openIdx = text.indexOf(open, m.index + m[0].length);
  if (openIdx < 0) throw new Error(`抽取器坏了：${what} 声明后找不到 ${open}`);
  const body = balanced(text, openIdx, open, close);
  if (!body) throw new Error(`抽取器坏了：${what} 体配平失败`);
  return body;
}

// ---------------------------------------------------------------------------
// 抽取器① · battery.ts → 真侧本体图（类型 key+domain · 链路三元组）
// ---------------------------------------------------------------------------

const BATTERY_SRC = "apps/datacore/src/synthetic/battery.ts";

export interface BatteryGraph {
  types: MockOntologyType[];
  links: MockOntologyLink[];
}

export function extractBatteryGraph(): BatteryGraph {
  const text = readStripped(BATTERY_SRC);
  // 类型域映射：BATTERY_TYPE_DOMAIN 表 + 内联 domain 两源。
  const domBody = balancedAfter(text, /export const BATTERY_TYPE_DOMAIN[^=]*=\s*/, "{", "}", "BATTERY_TYPE_DOMAIN");
  const domainOf = new Map<string, string>();
  for (const m of domBody.matchAll(/(\w+)\s*:\s*"([^"]+)"/g)) domainOf.set(m[1]!, m[2]!);
  if (domainOf.size < 10) throw new Error(`抽取器坏了：BATTERY_TYPE_DOMAIN 只抽出 ${domainOf.size} 条`);

  const otBody = balancedAfter(text, /export function batteryObjectTypes\(\)[^{]*\{[\s\S]*?return\s*/, "[", "]", "batteryObjectTypes return 数组");
  const types = new Map<string, string>();
  for (const m of otBody.matchAll(/\{\s*key:\s*"(\w+)"[^}]*?domain:\s*"(\w+)"/g)) types.set(m[1]!, m[2]!);
  for (const m of otBody.matchAll(/\bplainD?\(\s*"(\w+)"/g)) {
    if (!types.has(m[1]!)) types.set(m[1]!, domainOf.get(m[1]!) ?? "unassigned");
  }
  if (types.size < 30) throw new Error(`抽取器坏了：batteryObjectTypes 只抽出 ${types.size} 条`);

  const ltBody = balancedAfter(text, /export function batteryLinkTypes\(\)[^{]*\{[\s\S]*?return\s*/, "[", "]", "batteryLinkTypes return 数组");
  const links: MockOntologyLink[] = [];
  for (const m of ltBody.matchAll(/\{\s*key:\s*"(\w+)",\s*fromTypeKey:\s*"(\w+)",\s*toTypeKey:\s*"(\w+)"/g))
    links.push({ linkKey: m[1]!, fromTypeKey: m[2]!, toTypeKey: m[3]! });
  if (links.length < 20) throw new Error(`抽取器坏了：batteryLinkTypes 只抽出 ${links.length} 条`);
  return {
    types: [...types.entries()].map(([key, domain]) => ({ key, domain })),
    links,
  };
}

// ---------------------------------------------------------------------------
// 抽取器② · service.ts SOLVER_OUTPUT_SHAPES → 各求解器声明形状（shapeKeys 经 live 契约求值）
// ---------------------------------------------------------------------------

const SERVICE_SRC = "apps/datacore/src/solvers/service.ts";

/** shapeKeys(XSchema) 的 live 求值表 —— 与 service.ts:484 `Object.keys(schema.shape)` 同一口径。 */
const SHAPE_KEYS_REGISTRY: Record<string, { shape: Record<string, unknown> }> = {
  CapacityForecastOutputSchema,
  BottleneckMatrixOutputSchema,
  RiskTimelineOutputSchema,
  PlanAuditOutputSchema,
  PlanGenerateOutputSchema,
};

export function extractSolverOutputShapes(): Map<string, string[]> {
  const text = readStripped(SERVICE_SRC);
  const body = balancedAfter(text, /export const SOLVER_OUTPUT_SHAPES[^=]*=\s*/, "{", "}", "SOLVER_OUTPUT_SHAPES");
  const inner = body.slice(1, -1);
  const out = new Map<string, string[]>();
  // 顶层逐条：key: [ ... ] 或 key: shapeKeys(XSchema)。数组体可能跨行，用配平走。
  const entryRe = /(\w+):\s*(\[|shapeKeys\()/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(inner)) !== null) {
    const key = m[1]!;
    if (m[2] === "[") {
      const arrBody = balanced(inner, m.index + m[0].length - 1, "[", "]");
      if (!arrBody) throw new Error(`抽取器坏了：SOLVER_OUTPUT_SHAPES.${key} 数组配平失败`);
      const keys = [...arrBody.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
      if (keys.length === 0) throw new Error(`抽取器坏了：SOLVER_OUTPUT_SHAPES.${key} 抽出 0 键`);
      out.set(key, keys);
    } else {
      const callBody = balanced(inner, m.index + m[0].length - 1, "(", ")");
      if (!callBody) throw new Error(`抽取器坏了：SOLVER_OUTPUT_SHAPES.${key} shapeKeys 调用配平失败`);
      const schemaName = callBody.slice(1, -1).trim();
      const schema = SHAPE_KEYS_REGISTRY[schemaName];
      if (!schema) throw new Error(`抽取器坏了：shapeKeys(${schemaName}) 不在 live 求值表（扩 SHAPE_KEYS_REGISTRY，别手抄键名）`);
      out.set(key, Object.keys(schema.shape));
    }
  }
  if (out.size < 50) throw new Error(`抽取器坏了：SOLVER_OUTPUT_SHAPES 只抽出 ${out.size} 个求解器`);
  return out;
}

// ---------------------------------------------------------------------------

const diff = (want: ReadonlySet<string>, got: ReadonlySet<string>) => ({
  missing: [...want].filter((k) => !got.has(k)).sort(),
  extra: [...got].filter((k) => !want.has(k)).sort(),
});

const linkId = (l: MockOntologyLink) => `${l.linkKey}|${l.fromTypeKey}|${l.toTypeKey}`;
const typeId = (t: MockOntologyType) => `${t.key}|${t.domain}`;

describe("WO-MOCK-ENGINE-PARITY · mock 与真引擎同口径现算集合相等", () => {
  const graph = extractBatteryGraph();
  const shapes = extractSolverOutputShapes();

  it("§1 金丝雀：两份抽取器都没瞎（已知必中 ∧ 已知不存在必不中）", () => {
    // 抽取器①：三条已知链路必中（含历史病灶两端：旧路 order_for_model 与今路 model_demanded_by_order）
    const ids = new Set(graph.links.map(linkId));
    expect(ids.has("model_producible_at|Model|Base"), "工具坏了：必中链路 model_producible_at 未抽中").toBe(true);
    expect(ids.has("order_for_model|Order|Model"), "工具坏了：必中链路 order_for_model 未抽中").toBe(true);
    expect(ids.has("model_demanded_by_order|Model|Order"), "工具坏了：必中链路 model_demanded_by_order 未抽中").toBe(true);
    // 反向：已知不存在的链路必不中（单向测不出恒真匹配器）
    expect(ids.has("zzz_nonexistent_link|Foo|Bar"), "工具坏了：合成链路被抽中 = 匹配器恒真").toBe(false);
    // 类型域两源都活着（Base 是内联 domain·Cadence 走 BATTERY_TYPE_DOMAIN）
    const tmap = new Map(graph.types.map((t) => [t.key, t.domain]));
    expect(tmap.get("Base"), "工具坏了：Base 未抽中").toBe("factory");
    expect(tmap.get("Cadence"), "工具坏了：Cadence（BATTERY_TYPE_DOMAIN 源）未抽中").toBe("capacity");
    // 抽取器②：61 求解器里必含本单 5 个 + 已知键
    for (const k of ["ontology_query", "affected_orders", "capacity_forecast", "decision_play", "optimize_whatif"])
      expect(shapes.has(k), `工具坏了：SOLVER_OUTPUT_SHAPES 缺 ${k}`).toBe(true);
    expect(shapes.get("ontology_query"), "工具坏了：ontology_query 声明形状缺 provenance").toContain("provenance");
    expect(shapes.get("capacity_forecast"), "工具坏了：shapeKeys(CapacityForecastOutputSchema) live 求值缺 capWanP50").toContain("capWanP50");
    // 独立口径对总数（铁律 0.6：全中不保证覆盖全）：类型/链路计数与 grep 口径一致
    // ⚠️ 这两个数**写死**是有意的：它们是**第三方口径**（人手 grep `key:`/`plain(`/`fromTypeKey:` 计数），
    // 与 §2 的镜像表互为对照 —— 抽取器若因正则漂移少抽一条，§2 会跟着少要一条、**照样绿**，
    // 只有这里的绝对数会红。所以它不能改成 `MOCK_ONTOLOGY_LINKS.length`（那就退化成自己跟自己比）。
    // 代价是它**天生带保质期**：A 侧每加一条链路/类型就要人肉改一次数（改前须两侧独立复算，
    // 不许照着报错信息里的 received 直接抄）。
    // 100→101 于 2026-08-23（本单）：A 侧 4a0c7ea1 加 `material_has_outsource`(Material→Outsource)；
    // 该类型落在 battery-extended.ts，不进 `batteryObjectTypes()` ⇒ 类型数仍为 61。
    expect(graph.types.length, "类型数与探针独立口径不符（今日 61）").toBe(61);
    expect(graph.links.length, "链路数与 grep fromTypeKey 独立口径不符（今日 101）").toBe(101);
  });

  it("§2 mock 镜像图 == battery.ts 现算图（集合相等·缺谁多谁点名）", () => {
    const wantT = new Set(graph.types.map(typeId));
    const gotT = new Set(MOCK_ONTOLOGY_TYPES.map(typeId));
    expect(diff(wantT, gotT), "mock 镜像类型表与 battery.ts 对不上（missing=A 侧有 mock 缺·extra=mock 有 A 侧无；禁手改镜像表，重跑抽取对齐）").toEqual({ missing: [], extra: [] });
    const wantL = new Set(graph.links.map(linkId));
    const gotL = new Set(MOCK_ONTOLOGY_LINKS.map(linkId));
    expect(diff(wantL, gotL), "mock 镜像链路表与 battery.ts 对不上——A 侧改了本体而 mock 没跟，正是本单要治的漂移").toEqual({ missing: [], extra: [] });
  });

  it("§3 BFS tie-break 锚点：真侧 planner 与 mock 移植件四个排序键同序", () => {
    const KEYS = [
      "Number(b.sameDomain) - Number(a.sameDomain)",
      "a.to.localeCompare(b.to)",
      "a.linkKey.localeCompare(b.linkKey)",
      "a.direction.localeCompare(b.direction)",
    ];
    const seqOf = (rel: string) => {
      const text = readStripped(rel);
      const idx = KEYS.map((k) => text.indexOf(k));
      for (let i = 0; i < KEYS.length; i++)
        expect(idx[i]!, `工具坏了：${rel} 找不到排序键「${KEYS[i]}」——真侧 tie-break 改了，mock 移植件要跟着改`).toBeGreaterThanOrEqual(0);
      return idx;
    };
    const planner = seqOf("apps/datacore/src/ontology/slice-planner.ts");
    const mockPort = seqOf("apps/agentcore/src/mocks/ontology-graph.ts");
    const inOrder = (xs: number[]) => xs.every((x, i) => i === 0 || x > xs[i - 1]!);
    expect(inOrder(planner), "真侧 planner tie-break 键序变了——先复核口径再谈 mock").toBe(true);
    expect(inOrder(mockPort), "mock 移植件 tie-break 键序与真侧 planner 不一致（域内优先→toType→linkKey→direction）").toBe(true);
  });

  it("§4 接缝：mock ontology_query 的 linkPath/hops/usedSliceKeys/summary == 抽取图现算期望", async () => {
    const dc = createMockDataCore();
    const r = await dc.solver.invoke(CTX, "ontology_query", {
      rootType: "Base",
      rootFilter: [{ field: "name", op: "eq", value: "常州" }],
      select: [{ type: "Order", fields: ["so", "qty"] }],
    });
    const data = r.data as {
      rows: Record<string, unknown>[];
      columns: string[];
      provenance: { typeKey: string; objId: string; linkPath: string[] }[];
      queryPlan: { usedSliceKeys: string[]; hops: { linkKey: string; direction: string; toType: string }[]; aggregation: string[] };
      summary: string;
    };
    // 期望路径：从 battery.ts 抽取图现算（不是写死；图敏感性由 §5 自证）
    const adj = buildOntologyAdjacency(graph.types, graph.links);
    const expectedHops = shortestOntologyPath(adj, "Base", "Order", 8);
    expect(expectedHops, "工具坏了：抽取图上 Base→Order 不可达").not.toBeNull();
    const expectedLinkPath = hopsToLinkPath(expectedHops!);
    expect(data.provenance.length).toBeGreaterThan(0);
    for (const prov of data.provenance)
      expect(prov.linkPath, "mock provenance.linkPath ≠ 抽取图 BFS 现算路径（漂移即红，两侧图都现算）").toEqual(expectedLinkPath);
    // queryPlan.hops：方向映射（out→forward/in→backward）+ 逐跳落点，与真侧同式现算
    const expectedQpHops = expectedHops!.map((h) => ({
      linkKey: h.linkKey,
      direction: h.direction === "out" ? "forward" : "backward",
      toType: h.toType,
    }));
    expect(data.queryPlan.hops, "queryPlan.hops 与现算期望不符（方向/落点逐跳对拍）").toEqual(expectedQpHops);
    // usedSliceKeys：sliceKey 公式锚在 planner 文本上，期望值同式现算
    const plannerText = readStripped("apps/datacore/src/ontology/slice-planner.ts");
    expect(plannerText.includes("biz.plan.${req.rootType.toLowerCase()}__"), "工具坏了：planner sliceKey 公式变了，本测试期望公式要跟着改").toBe(true);
    expect(data.queryPlan.usedSliceKeys).toEqual(["biz.plan.base__order"]);
    // summary：真侧模板「遍历 K 跳 → N 行（…）」（query-engine.ts return 处）
    const engineText = readStripped("apps/datacore/src/ontology/query-engine.ts");
    expect(engineText.includes("跳 →"), "工具坏了：真侧 summary 模板变了，锚点要跟着改").toBe(true);
    expect(data.summary, "summary 不再是真侧「遍历 K 跳 → N 行」口径").toMatch(/^Base 遍历 2 跳 → \d+ 行（Order）/);
    // 历史病灶反向钉：不许再出现 P1 之前那条旧路
    expect(expectedLinkPath, "抽取图今日仍应走 model_demanded_by_order（若真侧本体又改了，先复核再改钉）").toContain("model_demanded_by_order:out");
    expect(expectedLinkPath).not.toContain("order_for_model:in");
  });

  it("§5 图敏感性自证：删掉 model_demanded_by_order，期望路径必须变（且退回历史旧路）", () => {
    const adjFull = buildOntologyAdjacency(graph.types, graph.links);
    const full = shortestOntologyPath(adjFull, "Base", "Order", 8)!;
    const mutatedLinks = graph.links.filter((l) => l.linkKey !== "model_demanded_by_order");
    const adjMut = buildOntologyAdjacency(graph.types, mutatedLinks);
    const alt = shortestOntologyPath(adjMut, "Base", "Order", 8);
    expect(alt, "工具坏了：删一条链后 Base→Order 不可达——图结构变了，本变异前提不成立").not.toBeNull();
    expect(
      hopsToLinkPath(alt!),
      "判据失效：删掉 model_demanded_by_order 后期望路径不变 = §4 的期望根本没在跟踪图（写死病）",
    ).not.toEqual(hopsToLinkPath(full));
    expect(
      hopsToLinkPath(alt!),
      "变异后应恰好退回 P1 之前的旧路（历史病灶复现·今日图口径；真侧再加等长短路时本钉要重推导）",
    ).toEqual(["model_producible_at:in", "order_for_model:in"]);
    // planMockOntologyPaths（mock 自用规划件）与抽取图同结果——mock 内嵌图与抽取图一致时的端到端一致性
    const planned = planMockOntologyPaths("Base", ["Order"]);
    expect(hopsToLinkPath(planned.paths.get("Order")!)).toEqual(hopsToLinkPath(full));
    expect(planned.sliceKey).toBe("biz.plan.base__order");
  });

  it("§6 五求解器顶层形状 == SOLVER_OUTPUT_SHAPES 同口径（集合相等·条件键逐条带 why）", async () => {
    const dc = createMockDataCore();
    const call = async (solverKey: string, args: Record<string, unknown>) =>
      ((await dc.solver.invoke(CTX, solverKey, args)).data ?? {}) as Record<string, unknown>;

    // 条件键台账：每条 = 真侧在特定输入下才不出现的键（why 必须写真侧依据），mock 按同口径不出现。
    // 真侧新增字段时 diff 出的新键不在台账里 ⇒ 红在「缺哪个」——这正是本单的牙。
    const CONDITIONAL: Record<string, { keys: string[]; why: string }> = {
      ontology_query: { keys: ["deltas"], why: "真侧仅 overrides 非空时附（query-engine.ts return 条件展开）；mock 不支持 overrides 恒不出现" },
      decision_play: { keys: ["locusPlay"], why: "真侧仅传 locusType+locusId 时出现（service.ts:543 注释自陈）；本调用未传" },
      affected_orders: { keys: ["summary"], why: "summary 为无 baseId 聚合分支专有（risk.ts affectedOrdersAggregate）；本调用走单基地分支" },
    };

    const CASES: { solverKey: string; args: Record<string, unknown> }[] = [
      { solverKey: "ontology_query", args: { rootType: "Base", select: [{ type: "Order", fields: ["so", "qty"] }] } },
      { solverKey: "affected_orders", args: { baseId: "base_changzhou" } },
      { solverKey: "decision_play", args: { metricKey: "seg_attain_ess", factorId: "cf-cathode-shortage" } },
      { solverKey: "optimize_whatif", args: { family: "facility_location", selection: [{ objectId: "fac_a" }, { objectId: "fac_b" }], perturbations: [{ target: "facilities.fac_b.openCost", value: 5 }] } },
    ];
    for (const c of CASES) {
      const declared = shapes.get(c.solverKey);
      expect(declared, `工具坏了：SOLVER_OUTPUT_SHAPES 无 ${c.solverKey}`).toBeTruthy();
      const got = new Set(Object.keys(await call(c.solverKey, c.args)));
      const want = new Set(declared!);
      const allow = CONDITIONAL[c.solverKey]?.keys ?? [];
      const { missing, extra } = diff(want, got);
      expect(
        { missing, allow },
        `${c.solverKey}：mock 缺真侧声明键（missing），且必须逐条等于条件键台账（allow）——真侧加字段而 mock 不动即在此处红`,
      ).toEqual({ missing: [...allow].sort(), allow: [...allow].sort() });
      expect(extra, `${c.solverKey}：mock 多发了真侧声明形状里没有的键（G-MOCK-OVERCLAIM 方向）`).toEqual([]);
    }

    // capacity_forecast：schema 带 .catchall（声明不穷尽·本体 §8 登记的盲区），口径改为
    // 「必填键 ⊆ mock ∧ mock 多出 ⊆ 真侧别名台账」——必填/可选由 live schema 现算，不手抄。
    const capShape = CapacityForecastOutputSchema.shape as Record<string, { safeParse: (v: unknown) => { success: boolean } }>;
    const required = Object.keys(capShape).filter((k) => !capShape[k]!.safeParse(undefined).success);
    expect(required.length, "工具坏了：capacity schema 必填键为 0").toBeGreaterThan(0);
    const capGot = new Set(Object.keys(await call("capacity_forecast", { modelId: "model_4680_ncm" })));
    const missingReq = required.filter((k) => !capGot.has(k));
    expect(missingReq, "capacity_forecast：mock 缺契约必填键（前端按契约消费将拿到 undefined 而测试照绿）").toEqual([]);
    // 真侧别名台账：capacity.ts 真返回 gapPct/mainBottleneck（文本锚），schema catchall 不列它们。
    const capText = readStripped("apps/datacore/src/solvers/capacity.ts");
    const ALIASES = ["gapPct", "mainBottleneck"];
    for (const a of ALIASES)
      expect(capText.includes(`${a}:`), `工具坏了：capacity.ts 不再返回别名 ${a}——台账要重核`).toBe(true);
    const capExtra = [...capGot].filter((k) => !(k in capShape));
    expect(capExtra.sort(), "capacity_forecast：mock 多发了 schema 与真侧别名都没有的键").toEqual([...ALIASES].sort());

    // 嵌套形状：ontology_query 的 provenance/queryPlan/hop 三层 == live 契约 schema（条件键 derivedFrom 带 why）
    const oq = await call("ontology_query", { rootType: "Base", select: [{ type: "Order", fields: ["so", "qty"] }] });
    const prov = (oq.provenance as Record<string, unknown>[])[0]!;
    const provWant = new Set(Object.keys(OntologyQueryProvenanceSchema.shape));
    const provGot = new Set(Object.keys(prov));
    expect(diff(provWant, provGot), "provenance 嵌套键集与契约不符（missing 仅允许 derivedFrom=overrides 条件键）").toEqual({ missing: ["derivedFrom"], extra: [] });
    const qp = oq.queryPlan as Record<string, unknown>;
    expect(diff(new Set(Object.keys(OntologyQueryPlanSchema.shape)), new Set(Object.keys(qp))), "queryPlan 键集与契约不符").toEqual({ missing: [], extra: [] });
    const hop = (qp.hops as Record<string, unknown>[])[0]!;
    expect(new Set(Object.keys(hop)), "hop 键集与契约不符").toEqual(new Set(["linkKey", "direction", "toType"]));
    // 双源互证：SOLVER_OUTPUT_SHAPES.ontology_query（文本）== OntologyQueryOutputSchema（live）
    expect(new Set(shapes.get("ontology_query")!), "两份真侧来源对 ontology_query 声明不一致——先复核哪份漂了").toEqual(
      new Set(Object.keys(OntologyQueryOutputSchema.shape)),
    );
  });

  it("§7 变异反证：断言函数喂变异必须报出那条变异（红在缺哪个/多哪个）", () => {
    // 形状差集：真侧「加一个字段」的变异 ⇒ missing 恰好报出它（不是数量不等，是指名）
    const d1 = diff(new Set(["a", "b", "__ghost_field__"]), new Set(["a", "b"]));
    expect(d1).toEqual({ missing: ["__ghost_field__"], extra: [] });
    // mock「多发一个字段」的变异 ⇒ extra 恰好报出它
    const d2 = diff(new Set(["a", "b"]), new Set(["a", "b", "__overclaim__"]));
    expect(d2).toEqual({ missing: [], extra: ["__overclaim__"] });
    // 「多一个错的 + 少一个对的」不得被数量相等掩盖
    const d3 = diff(new Set(["a", "b"]), new Set(["a", "c"]));
    expect(d3).toEqual({ missing: ["b"], extra: ["c"] });
    // 图差集：A 侧加一条链而 mock 不动 ⇒ missing 指名那条链
    const ghost: MockOntologyLink = { linkKey: "zz_ghost_link", fromTypeKey: "Base", toTypeKey: "Order" };
    const d4 = diff(new Set([...graph.links.map(linkId), linkId(ghost)]), new Set(MOCK_ONTOLOGY_LINKS.map(linkId)));
    expect(d4.missing, "图变异未被指名").toEqual([linkId(ghost)]);
  });

  it("§8 错误 parity：未知类型/未知链路/根过滤零匹配 ⇒ mock 与真侧同口径抛 NO_QUERY_PLAN", async () => {
    // 锚：真侧 query-engine.ts 对这三类抛 NoQueryPlanError（文本自证锚点没漂）
    const engineText = readStripped("apps/datacore/src/ontology/query-engine.ts");
    for (const anchor of ["不在本体中", "无匹配根对象"])
      expect(engineText.includes(anchor), `工具坏了：真侧错误文案「${anchor}」不在 query-engine.ts——锚点要重核`).toBe(true);
    const dc = createMockDataCore();
    await expect(dc.solver.invoke(CTX, "ontology_query", { rootType: "NoSuchType", select: [{ type: "Order", fields: ["so"] }] })).rejects.toThrow(MockNoQueryPlanError);
    await expect(dc.solver.invoke(CTX, "ontology_query", { rootType: "Base", select: [{ type: "NoSuchType", fields: ["x"] }] })).rejects.toThrow(/不在本体中/);
    await expect(
      dc.solver.invoke(CTX, "ontology_query", { rootType: "Base", rootFilter: [{ field: "name", op: "eq", value: "不存在的基地" }], select: [{ type: "Order", fields: ["so"] }] }),
    ).rejects.toThrow(/无匹配根对象/);
    await expect(
      dc.solver.invoke(CTX, "ontology_query", { rootType: "Base", hops: [{ linkKey: "zz_no_such_link", direction: "forward" }], select: [{ type: "Order", fields: ["so"] }] }),
    ).rejects.toThrow(/不在本体中/);
    // overrides：mock 诚实报缺（不伪造 deltas）
    await expect(
      dc.solver.invoke(CTX, "ontology_query", {
        rootType: "Base",
        select: [{ type: "Order", fields: ["so"] }],
        overrides: [{ objectType: "Order", objectId: "obj_order_SO-0001", prop: "qty", value: 1 }],
      }),
    ).rejects.toThrow(/不支持 overrides/);
  });
});
