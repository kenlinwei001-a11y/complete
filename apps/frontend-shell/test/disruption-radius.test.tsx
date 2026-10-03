import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { queryClient } from "@/store/queryClient";
import { deriveDisruptionLayers, disruptionRootCandidates, type OTypeLite } from "@/views/DisruptionRadiusView";

/**
 * WO · 断供影响半径投影页（supplier_disruption_radius 前端接线·KILL-MOCK·SEAM-GATE）。
 *
 * 接缝：本页从**真本体 ref 图倒推反向扇出链 layers**（前端半：deriveDisruptionLayers），把 {rootType,rootId,layers}
 * 交给**真求解器反向多跳扇出**（引擎半：service.supplierDisruptionRadius，此处以忠实迷你引擎桩按 args 现算，
 * 非按 rootId 写死）。倒推链若 viaField 错，引擎返回 0 → 页面空——C1 出真值即证两半在接缝上对上。
 * 换 rootId → 引擎真值变 → radius/total/leaf 随之变（C2 纯投影，零写死）。
 */

// ── 本体：Supplier ← Material(supplierRef) ← Order(materialRef) ← Customer(orderRef)。────────────
const TYPES = [
  { key: "Supplier", displayName: "供应商", status: "ACTIVE", properties: [{ propKey: "supplierId", dataType: "string", isPrimaryKey: true }, { propKey: "name", dataType: "string" }] },
  { key: "Material", displayName: "物料", status: "ACTIVE", properties: [{ propKey: "matId", dataType: "string", isPrimaryKey: true }, { propKey: "supplierRef", dataType: "ref", refToTypeKey: "Supplier" }] },
  { key: "Order", displayName: "销售订单", status: "ACTIVE", properties: [{ propKey: "soId", dataType: "string", isPrimaryKey: true }, { propKey: "materialRef", dataType: "ref", refToTypeKey: "Material" }] },
  { key: "Customer", displayName: "客户", status: "ACTIVE", properties: [{ propKey: "custId", dataType: "string", isPrimaryKey: true }, { propKey: "orderRef", dataType: "ref", refToTypeKey: "Order" }] },
];

// ── 真对象图（引擎桩据此现算·非写死输出）。────────────
type Obj = { id: string; type: string; props: Record<string, unknown> };
const OBJECTS: Record<string, Obj[]> = {
  Supplier: [
    { id: "sup_1", type: "Supplier", props: { supplierId: "华东电解液", name: "华东电解液" } },
    { id: "sup_2", type: "Supplier", props: { supplierId: "孤立供应商", name: "孤立供应商" } },
  ],
  Material: [
    { id: "m1", type: "Material", props: { matId: "正极A", supplierRef: "华东电解液" } },
    { id: "m2", type: "Material", props: { matId: "电解液B", supplierRef: "华东电解液" } },
  ],
  Order: [
    { id: "o1", type: "Order", props: { soId: "SO1", materialRef: "正极A" } },
    { id: "o2", type: "Order", props: { soId: "SO2", materialRef: "电解液B" } },
  ],
  Customer: [{ id: "c1", type: "Customer", props: { custId: "CUST1", orderRef: "SO1" } }],
};
const PK: Record<string, string> = { Supplier: "supplierId", Material: "matId", Order: "soId", Customer: "custId" };

/** 忠实迷你引擎：与 datacore service.supplierDisruptionRadius 同口径反向扇出（按 args 现算）。 */
function miniSolve(args: { rootType: string; rootId: string; layers: { type: string; viaField: string }[] }) {
  let frontier = new Set<string>([args.rootId]);
  const result: { type: string; viaField: string; count: number; ids: string[] }[] = [];
  let radius = 0;
  for (const layer of args.layers) {
    const objs = OBJECTS[layer.type] ?? [];
    const pk = PK[layer.type];
    const hit = objs.filter((o) => frontier.has(String(o.props[layer.viaField] ?? "")));
    const ids = hit.map((o) => String((pk ? o.props[pk] : undefined) ?? o.id)).sort();
    result.push({ type: layer.type, viaField: layer.viaField, count: ids.length, ids });
    if (ids.length > 0) radius += 1;
    frontier = new Set(ids);
    if (ids.length === 0) break;
  }
  const leaf = result[result.length - 1];
  const totalAffected = result.reduce((s, l) => s + l.count, 0);
  return {
    rootType: args.rootType,
    rootId: args.rootId,
    layers: result,
    radius,
    totalAffected,
    leafType: leaf?.type ?? null,
    leafCount: leaf?.count ?? 0,
    summary: `断供「${args.rootId}」影响半径 ${radius} 层、波及 ${totalAffected} 个对象；叶层 ${leaf?.type ?? "—"} ${leaf?.count ?? 0} 个`,
  };
}

function baseHandlers() {
  return [
    http.get("*/a/v1/ontology/object-types", () => HttpResponse.json(TYPES)),
    http.get("*/a/v1/objects", ({ request }) => {
      const type = new URL(request.url).searchParams.get("type") ?? "";
      const items = OBJECTS[type] ?? [];
      return HttpResponse.json({ items, total: items.length });
    }),
    http.post("*/a/v1/solvers/supplier_disruption_radius/invoke", async ({ request }) => {
      const body = (await request.json().catch(() => ({}))) as { args?: { rootType: string; rootId: string; layers: { type: string; viaField: string }[] } };
      return HttpResponse.json({ data: miniSolve(body.args!), snapshotVersion: "ov-dr" });
    }),
  ];
}

function renderDR() {
  loginAs("planner");
  server.use(...baseHandlers());
  return renderApp("/v/disruption-radius");
}

describe("断供影响半径投影页（DisruptionRadiusView）", () => {
  // ── 纯函数（确定性倒推）────────────
  it("deriveDisruptionLayers · 从 Supplier 沿反向 ref 倒推出 Material→Order→Customer 链", () => {
    const layers = deriveDisruptionLayers(TYPES as OTypeLite[], "Supplier");
    expect(layers).toEqual([
      { type: "Material", viaField: "supplierRef" },
      { type: "Order", viaField: "materialRef" },
      { type: "Customer", viaField: "orderRef" },
    ]);
  });

  it("disruptionRootCandidates · 只留有反向链的类型，reach 长者优先（Supplier 首）", () => {
    const cands = disruptionRootCandidates(TYPES as OTypeLite[]).map((t) => t.key);
    expect(cands[0]).toBe("Supplier"); // 链长 3
    expect(cands).not.toContain("Customer"); // 无类型 ref Customer → 无反向链
  });

  it("确定性：同输入两次倒推字节一致", () => {
    expect(JSON.stringify(deriveDisruptionLayers(TYPES as OTypeLite[], "Supplier"))).toBe(
      JSON.stringify(deriveDisruptionLayers([...TYPES].reverse() as OTypeLite[], "Supplier")),
    );
  });

  // ── C1 · 调真 solver 出 layers / radius ────────────
  it("C1 · 默认落 Supplier + 首个来源 → 渲三层扇出 + 半径 3 + 叶层敞口", async () => {
    renderDR();
    // 半径 / 总数 / 叶层 全从引擎真值渲染
    expect(await screen.findByTestId("dr-radius")).toHaveTextContent("3 层");
    expect(screen.getByTestId("dr-total")).toHaveTextContent("5");
    expect(screen.getByTestId("dr-leaf")).toHaveTextContent("客户 1");
    // 逐层扇出真值（L1 物料 2 / L2 订单 2 / L3 客户 1）
    expect(screen.getByTestId("dr-layer-count-0")).toHaveTextContent("2 个");
    expect(screen.getByTestId("dr-layer-count-1")).toHaveTextContent("2 个");
    expect(screen.getByTestId("dr-layer-count-2")).toHaveTextContent("1 个");
    // 分层扇出 DAG：断供根 + 三层节点
    const dag = screen.getByTestId("dr-fanout");
    expect(dag).toHaveAttribute("data-layers", "4");
    expect(screen.getByTestId("dr-fanout-node-__root")).toBeInTheDocument();
    expect(screen.getByTestId("dr-fanout-node-L2")).toBeInTheDocument();
    // 叶层敞口标注
    expect(screen.getByTestId("dr-layer-2")).toHaveTextContent("叶层敞口");
  });

  // ── C2 · 换 rootId → 半径真变（引擎按 args 现算，非写死）────────────
  it("C2 · 换断供来源（华东电解液→孤立供应商）→ 半径 3→0、扩散清空（纯投影·零写死）", async () => {
    renderDR();
    expect(await screen.findByTestId("dr-radius")).toHaveTextContent("3 层");
    const sel = screen.getByTestId("dr-root-id") as HTMLSelectElement;
    // 来源列表真取（两个供应商），非写死
    expect(Array.from(sel.options).map((o) => o.value)).toEqual(["华东电解液", "孤立供应商"]);

    fireEvent.change(sel, { target: { value: "孤立供应商" } });
    await waitFor(() => expect(screen.getByTestId("dr-radius")).toHaveTextContent("0 层"));
    expect(screen.getByTestId("dr-total")).toHaveTextContent("0");
    // 半径 0 诚实提示出
    expect(screen.getByTestId("dr-zero-radius")).toBeInTheDocument();
    // 第一层断链（0 个）
    expect(screen.getByTestId("dr-layer-count-0")).toHaveTextContent("0 个");
  });

  // ── C3 · KILL-MOCK：选择器列表真取 + 反向链本体倒推 ────────────
  it("C3 · 来源类型下拉 = 本体真候选、来源对象下拉 = 真对象；反向链标注来自本体倒推", async () => {
    renderDR();
    await screen.findByTestId("dr-radius");
    const typeSel = screen.getByTestId("dr-root-type") as HTMLSelectElement;
    // 候选来自本体（有反向链者），Supplier 默认首选；Customer 不在候选
    expect(typeSel.value).toBe("Supplier");
    const typeVals = Array.from(typeSel.options).map((o) => o.value);
    expect(typeVals).toContain("Supplier");
    expect(typeVals).not.toContain("Customer");
    // 反向扇出链标注（本体 ref 倒推）含各 viaField
    const chain = screen.getByTestId("dr-chain");
    expect(chain).toHaveTextContent("supplierRef");
    expect(chain).toHaveTextContent("materialRef");
    expect(chain).toHaveTextContent("orderRef");
  });

  // ── 诚实空态：本体无反向引用链 ────────────
  it("诚实空态 · 本体无任何被引用类型（无反向链）→ 空态卡，不编扩散", async () => {
    loginAs("planner");
    server.use(
      http.get("*/a/v1/ontology/object-types", () =>
        HttpResponse.json([{ key: "Lonely", displayName: "孤立类型", status: "ACTIVE", properties: [{ propKey: "id", dataType: "string", isPrimaryKey: true }] }]),
      ),
    );
    renderApp("/v/disruption-radius");
    expect(await screen.findByTestId("dr-empty-no-chain")).toBeInTheDocument();
    expect(screen.queryByTestId("dr-metrics")).toBeNull();
  });

  // ── 诚实空态：来源类型无对象 ────────────
  it("诚实空态 · 来源类型无对象 → 提示无法选择，不出结果区", async () => {
    loginAs("planner");
    server.use(
      http.get("*/a/v1/ontology/object-types", () => HttpResponse.json(TYPES)),
      http.get("*/a/v1/objects", () => HttpResponse.json({ items: [], total: 0 })),
    );
    renderApp("/v/disruption-radius");
    expect(await screen.findByTestId("dr-empty-no-objects")).toBeInTheDocument();
    expect(screen.queryByTestId("dr-metrics")).toBeNull();
    cleanup();
    queryClient.clear();
  });
});
