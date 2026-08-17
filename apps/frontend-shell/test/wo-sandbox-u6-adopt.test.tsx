import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-U6-ADOPT · 判据 U6「结论即动作」前端半接缝 —— 四页「采纳结论」按钮 → ActionDraft 真发出。
 *
 * 病灶（WO-SANDBOX-32CELLS 复核）：what-if / optimize-whatif / cleanroom-attr / disruption-radius
 * 四页的推演结论屏上算得出来、却**没有任何动作出口** —— 用户看完结论想落实，只能手抄到别处。
 * 本测断言每页的采纳按钮真的 POST /a/v1/action-drafts（submit=true 直进 S2 审批·非直改真值 R4），
 * 且 payload 里的判别字段 + 推演快照**就是屏上正在显示的那份**（数值与 MSW 求解器真算输出逐字段相等，
 * 不是写死的期望值——前端接错线，这里当场红）。
 *
 * 动作分工（不重叠）：
 *  · what-if          → 「对象数据变更」（既有 WIRED 分支）：采纳 = 把假设经审批真改成数据。
 *  · optimize-whatif / cleanroom-attr / disruption-radius → 「采纳推演结论」（本单新增通用动作型）：
 *    采纳 = 把结论（判别字段 + 快照）落成 SimConclusionAdoption 台账。
 *
 * 后端半（审批 → domainExecutor 真写对象 → 列表端点读回字段真变 + 变异反证）
 * 见 apps/datacore/test/action-adopt-sim-conclusion.seam.test.ts。
 */

interface CapturedDraft {
  actionTypeKey?: string;
  payload?: Record<string, unknown>;
  submit?: boolean;
}

function captureDrafts(): { captured: CapturedDraft[] } {
  const captured: CapturedDraft[] = [];
  server.use(
    http.post("*/a/v1/action-drafts", async ({ request }) => {
      captured.push((await request.json()) as CapturedDraft);
      return HttpResponse.json({ draftId: "act-u6-adopt", status: "PENDING_APPROVAL" }, { status: 201 });
    }),
  );
  return { captured };
}

// ── what-if：与 what-if.test.tsx 同款驱动（本页 U1 已无提交闸，填完即算）──────────────────────
async function fillHypothesis(propKey: string, value: string): Promise<string> {
  const typeSelect = await screen.findByTestId("wi-type-select");
  fireEvent.change(typeSelect, { target: { value: "Base" } });
  const objSelect = await screen.findByTestId("wi-object-select");
  await waitFor(() => {
    const opts = within(objSelect).getAllByRole("option") as HTMLOptionElement[];
    expect(opts.filter((o) => o.value !== "").length).toBeGreaterThan(0);
  });
  const realOpts = (within(objSelect).getAllByRole("option") as HTMLOptionElement[]).filter((o) => o.value !== "");
  fireEvent.change(objSelect, { target: { value: realOpts[0]!.value } });
  fireEvent.change(screen.getByTestId("wi-prop-select"), { target: { value: propKey } });
  fireEvent.change(screen.getByTestId("wi-value-input"), { target: { value } });
  return realOpts[0]!.value;
}

// ── cleanroom-attr：与 cleanroom-attr.test.tsx 同款确定性夹具 ────────────────────────────────
const CR_TYPES = [
  { key: "Furnace", displayName: "化成柜", domain: "capacity", status: "ACTIVE", properties: [{ propKey: "furnaceId", dataType: "string", isPrimaryKey: true }, { propKey: "capacity", dataType: "number", isPrimaryKey: false }] },
  { key: "Job", displayName: "在制任务", domain: "capacity", status: "ACTIVE", properties: [{ propKey: "jobId", dataType: "string", isPrimaryKey: true }, { propKey: "furnaceRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Furnace" }, { propKey: "qty", dataType: "number", isPrimaryKey: false }, { propKey: "priority", dataType: "number", isPrimaryKey: false }] },
  { key: "Customer", displayName: "客户", domain: "people", status: "ACTIVE", properties: [{ propKey: "custId", dataType: "string", isPrimaryKey: true }, { propKey: "orderRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Order" }] },
  { key: "Order", displayName: "订单", domain: "product", status: "ACTIVE", properties: [{ propKey: "orderId", dataType: "string", isPrimaryKey: true }, { propKey: "supplierRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Supplier" }] },
  { key: "Supplier", displayName: "供应商", domain: "supply", status: "ACTIVE", properties: [{ propKey: "supplierId", dataType: "string", isPrimaryKey: true }] },
  { key: "Product", displayName: "产品", domain: "product", status: "ACTIVE", properties: [{ propKey: "prodId", dataType: "string", isPrimaryKey: true }, { propKey: "revenue", dataType: "number", isPrimaryKey: false }, { propKey: "rawCost", dataType: "number", isPrimaryKey: false }, { propKey: "laborCost", dataType: "number", isPrimaryKey: false }] },
];

function renderCr() {
  loginAs("planner");
  server.use(
    http.get("*/a/v1/ontology/object-types", () => HttpResponse.json(CR_TYPES)),
    http.post("*/a/v1/solvers/shared_bottleneck/invoke", async ({ request }) => {
      const { args } = (await request.json()) as { args: Record<string, string> };
      const rt = args.resourceType;
      return HttpResponse.json({
        data: {
          bottlenecks: [{ resourceType: rt, resourceId: `${rt}-01`, capacity: 100, demand: 138, sharerCount: 3 }],
          contention: [{ resourceId: `${rt}-01`, sharers: ["a", "b", "c"] }],
          downgraded: [{ resourceId: `${rt}-01`, sharedByType: args.sharedByType, objectId: "c", reason: "优先级最低" }],
          summary: `1 个共享瓶颈,3 张单争用,1 张被降级 · ${rt}`,
        },
        snapshotVersion: "ov-cr",
      });
    }),
    http.post("*/a/v1/solvers/concentration_risk/invoke", async ({ request }) => {
      const { args } = (await request.json()) as { args: { path: { toType: string }[] } };
      const rootType = args.path[args.path.length - 1]!.toType;
      const top = { rootType, rootId: `${rootType}-hub`, dependents: ["c1", "c2", "c3"], count: 3 };
      return HttpResponse.json({
        data: { concentrations: [top], topExposure: top, summary: `1 个隐性集中单点（${rootType}）,最大敞口 3 个依赖方` },
        snapshotVersion: "ov-cr",
      });
    }),
    http.post("*/a/v1/solvers/margin_attribution/invoke", async ({ request }) => {
      const { args } = (await request.json()) as { args: { targetType: string; costFields: { field: string; label?: string }[] } };
      const driver = args.costFields[0]!.label ?? args.costFields[0]!.field;
      return HttpResponse.json({
        data: {
          inverted: [{ id: `${args.targetType}-9`, revenue: 100, totalCost: 128, margin: -28, marginRate: -0.28, topDriver: { label: driver, value: 80, share: 0.625 }, attribution: [{ label: driver, value: 80, share: 0.625 }] }],
          rootDrivers: [{ label: driver, invertedCount: 1, totalValue: 80 }],
          invertedCount: 1,
          summary: `1 个目标毛利倒挂；根因主驱动 ${driver}（拉穿 1 个）`,
        },
        snapshotVersion: "ov-cr",
      });
    }),
  );
  return renderApp("/v/cleanroom-attr");
}

// ── disruption-radius：与 disruption-radius.test.tsx 同款本体 + 忠实迷你引擎桩 ───────────────
const DR_TYPES = [
  { key: "Supplier", displayName: "供应商", status: "ACTIVE", properties: [{ propKey: "supplierId", dataType: "string", isPrimaryKey: true }, { propKey: "name", dataType: "string" }] },
  { key: "Material", displayName: "物料", status: "ACTIVE", properties: [{ propKey: "matId", dataType: "string", isPrimaryKey: true }, { propKey: "supplierRef", dataType: "ref", refToTypeKey: "Supplier" }] },
  { key: "Order", displayName: "销售订单", status: "ACTIVE", properties: [{ propKey: "soId", dataType: "string", isPrimaryKey: true }, { propKey: "materialRef", dataType: "ref", refToTypeKey: "Material" }] },
  { key: "Customer", displayName: "客户", status: "ACTIVE", properties: [{ propKey: "custId", dataType: "string", isPrimaryKey: true }, { propKey: "orderRef", dataType: "ref", refToTypeKey: "Order" }] },
];
type DrObj = { id: string; type: string; props: Record<string, unknown> };
const DR_OBJECTS: Record<string, DrObj[]> = {
  Supplier: [{ id: "sup_1", type: "Supplier", props: { supplierId: "华东电解液", name: "华东电解液" } }],
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
const DR_PK: Record<string, string> = { Supplier: "supplierId", Material: "matId", Order: "soId", Customer: "custId" };

function renderDR() {
  loginAs("planner");
  server.use(
    http.get("*/a/v1/ontology/object-types", () => HttpResponse.json(DR_TYPES)),
    http.get("*/a/v1/objects", ({ request }) => {
      const type = new URL(request.url).searchParams.get("type") ?? "";
      const items = DR_OBJECTS[type] ?? [];
      return HttpResponse.json({ items, total: items.length });
    }),
    http.post("*/a/v1/solvers/supplier_disruption_radius/invoke", async ({ request }) => {
      const body = (await request.json()) as { args: { rootType: string; rootId: string; layers: { type: string; viaField: string }[] } };
      // 忠实迷你引擎：按 args 现算反向扇出（非同写死输出）。
      let frontier = new Set<string>([body.args.rootId]);
      const layers: { type: string; viaField: string; count: number; ids: string[] }[] = [];
      let radius = 0;
      for (const layer of body.args.layers) {
        const hit = (DR_OBJECTS[layer.type] ?? []).filter((o) => frontier.has(String(o.props[layer.viaField] ?? "")));
        const ids = hit.map((o) => String(o.props[DR_PK[layer.type]!] ?? o.id)).sort();
        layers.push({ type: layer.type, viaField: layer.viaField, count: ids.length, ids });
        if (ids.length > 0) radius += 1;
        frontier = new Set(ids);
        if (ids.length === 0) break;
      }
      const leaf = layers[layers.length - 1];
      const totalAffected = layers.reduce((s, l) => s + l.count, 0);
      return HttpResponse.json({
        data: {
          rootType: body.args.rootType,
          rootId: body.args.rootId,
          layers,
          radius,
          totalAffected,
          leafType: leaf?.type ?? null,
          leafCount: leaf?.count ?? 0,
          summary: `断供「${body.args.rootId}」影响半径 ${radius} 层、波及 ${totalAffected} 个对象；叶层 ${leaf?.type ?? "—"} ${leaf?.count ?? 0} 个`,
        },
        snapshotVersion: "ov-dr",
      });
    }),
  );
  return renderApp("/v/disruption-radius");
}

describe("WO-U6-ADOPT · 四页「采纳结论」→ ActionDraft（判别字段 + 屏上快照）", () => {
  it("what-if · 点「采纳此假设为真实变更」→ 「对象数据变更」草稿真发出，patch=屏上假设（类型强制后的值）", async () => {
    const { captured } = captureDrafts();
    loginAs("planner");
    renderApp("/v/what-if");
    const objectId = await fillHypothesis("util", "2"); // 数值属性 → 屏上 after 真算 200/1100
    await screen.findByTestId("wi-result");
    expect(screen.getByTestId("wi-affected-count")).toHaveTextContent("2");

    fireEvent.click(screen.getByTestId("wi-adopt-assumption"));

    await waitFor(() => expect(captured.length).toBe(1));
    const draft = captured[0]!;
    expect(draft.actionTypeKey).toBe("对象数据变更");
    expect(draft.submit, "必须直进审批链（R4：真值写入经 Action 审批，不直改）").toBe(true);
    const p = draft.payload!;
    expect(p.objectType).toBe("Base");
    expect(p.objectId).toBe(objectId);
    // patch 的值是**类型强制后**的 2（number），不是输入框原文 "2" —— 与屏上试算同源。
    expect(p.patch).toEqual({ util: 2 });
    expect(String(p.reason)).toContain(`Base/${objectId}.util = 2`);
  });

  it("optimize-whatif · 点「采纳结论」→ 「采纳推演结论」草稿，快照=屏上这份解（含决策切换后的两版方案）", async () => {
    const { captured } = captureDrafts();
    loginAs("planner");
    renderApp("/v/optimize-whatif");
    fireEvent.click(await screen.findByTestId("ow-solve"));
    // 屏上结论就位：决策切换 开f1→开f2，基线 114 / 扰动 132 / Δ+18（MSW 真·暴力最优）。
    await screen.findByTestId("ow-switch-banner");
    expect(screen.getByTestId("ow-delta-obj")).toHaveTextContent("+18");

    fireEvent.click(screen.getByTestId("ow-adopt-conclusion"));

    await waitFor(() => expect(captured.length).toBe(1));
    const draft = captured[0]!;
    expect(draft.actionTypeKey).toBe("采纳推演结论");
    expect(draft.submit).toBe(true);
    const p = draft.payload!;
    expect(p.source).toBe("optimize-whatif");
    expect(p.family).toBe("facility_location");
    expect(p.seed).toBe(42);
    // 扰动清单 = 已提交求解的那版入参（f1 开设成本 100→150）。
    expect(p.perturbations).toEqual([{ target: "facilities.f1.openCost", value: 150 }]);
    // 快照 = 屏上那份解：目标值三连 + 决策切换后的两版方案结构（量纲：目标值随族目标函数·本族为成本）。
    const snap = p.snapshot as Record<string, unknown>;
    expect(snap.baselineObjective).toBe(114);
    expect(snap.perturbedObjective).toBe(132);
    expect(snap.deltaObjective).toBe(18);
    expect(snap.feasible).toBe(true);
    // MSW 桩对 facility_location 是真·小规模暴力最优（能证最优）→ out.optimal=true 是诚实真值；
    // 纪律「不写死最优」的咬法 = 快照跟字段走（optimal === out.optimal），不是写死某个布尔。
    expect(snap.optimal).toBe(true);
    const base = snap.baselineSolution as { openFacilities?: string[] };
    const pert = snap.perturbedSolution as { openFacilities?: string[] };
    expect(base.openFacilities).toContain("f1");
    expect(pert.openFacilities).toContain("f2");
    expect(pert.openFacilities).not.toContain("f1");
  });

  it("cleanroom-attr · 三块诊断各自点采纳 → 草稿的 analysis/args/findings=屏上那份求解结果", async () => {
    const { captured } = captureDrafts();
    renderCr();

    // ① 共享瓶颈（默认 tab）：屏上 需求138/产能100 · Furnace-01。
    await screen.findByTestId("cr-bn-result");
    fireEvent.click(screen.getByTestId("cr-bn-adopt-conclusion"));
    await waitFor(() => expect(captured.length).toBe(1));

    // ② 隐性集中度。
    fireEvent.click(screen.getByTestId("cr-tab-concentration"));
    await screen.findByTestId("cr-cc-result");
    fireEvent.click(screen.getByTestId("cr-cc-adopt-conclusion"));
    await waitFor(() => expect(captured.length).toBe(2));

    // ③ 毛利倒挂。
    fireEvent.click(screen.getByTestId("cr-tab-margin"));
    await screen.findByTestId("cr-ma-result");
    fireEvent.click(screen.getByTestId("cr-ma-adopt-conclusion"));
    await waitFor(() => expect(captured.length).toBe(3));

    for (const d of captured) {
      expect(d.actionTypeKey).toBe("采纳推演结论");
      expect(d.submit).toBe(true);
      expect(d.payload!.source).toBe("cleanroom-attr");
    }

    // ① 瓶颈：倒推参数 + 结论行原样（demand/capacity 为资源原生单位）。
    const bn = captured[0]!.payload!;
    expect(bn.analysis).toBe("shared_bottleneck");
    expect(bn.primaryType).toBe("Furnace");
    expect((bn.args as Record<string, unknown>).resourceType).toBe("Furnace");
    expect((bn.args as Record<string, unknown>).viaField).toBe("furnaceRef");
    const bnSnap = bn.snapshot as { summary: string; findingCount: number; findings: Record<string, unknown>[] };
    expect(bnSnap.findingCount).toBe(1);
    expect(bnSnap.findings[0]).toMatchObject({ resourceId: "Furnace-01", demand: 138, capacity: 100 });
    expect(bnSnap.summary).toContain("共享瓶颈");

    // ② 集中度：多跳链终点根 + 敞口计数（个）。
    const cc = captured[1]!.payload!;
    expect(cc.analysis).toBe("concentration_risk");
    expect(cc.primaryType).toBe("Customer");
    const ccSnap = cc.snapshot as { findingCount: number; findings: Record<string, unknown>[] };
    expect(ccSnap.findingCount).toBe(1);
    expect(ccSnap.findings[0]).toMatchObject({ rootType: "Supplier", rootId: "Supplier-hub", count: 3 });

    // ③ 毛利倒挂：findingCount 用 invertedCount（倒挂条数），findings=inverted 行（财务原生单位）。
    const ma = captured[2]!.payload!;
    expect(ma.analysis).toBe("margin_attribution");
    expect(ma.primaryType).toBe("Product");
    const maSnap = ma.snapshot as { findingCount: number; findings: Record<string, unknown>[] };
    expect(maSnap.findingCount).toBe(1);
    expect(maSnap.findings[0]).toMatchObject({ id: "Product-9", margin: -28, totalCost: 128 });
  });

  it("disruption-radius · 点「采纳结论」→ 草稿带断供根 + 实际扇出链 + 屏上快照（半径/波及/叶层）", async () => {
    const { captured } = captureDrafts();
    renderDR();
    // 屏上评估就位：半径 3 层 · 波及 5 · 叶层 客户 1。
    expect(await screen.findByTestId("dr-radius")).toHaveTextContent("3 层");
    expect(screen.getByTestId("dr-total")).toHaveTextContent("5");

    fireEvent.click(screen.getByTestId("dr-adopt-conclusion"));

    await waitFor(() => expect(captured.length).toBe(1));
    const draft = captured[0]!;
    expect(draft.actionTypeKey).toBe("采纳推演结论");
    expect(draft.submit).toBe(true);
    const p = draft.payload!;
    expect(p.source).toBe("disruption-radius");
    expect(p.rootType).toBe("Supplier");
    expect(p.rootId).toBe("华东电解液");
    // 实际扇出链（本体倒推，随 payload 上送给审批人）。
    expect(p.layers).toEqual([
      { type: "Material", viaField: "supplierRef" },
      { type: "Order", viaField: "materialRef" },
      { type: "Customer", viaField: "orderRef" },
    ]);
    expect(p.disabledEdges, "本次未关边——空清单也要真送上，不许缺省藏条件").toEqual([]);
    // 快照 = 屏上那份（量纲：radius 层 · totalAffected/leafCount 个 · layersDetail 逐层 count 个）。
    const snap = p.snapshot as {
      radius: number; totalAffected: number; leafType: string | null; leafCount: number;
      layersDetail: { type: string; viaField: string; count: number; ids: string[] }[]; summary: string;
    };
    expect(snap.radius).toBe(3);
    expect(snap.totalAffected).toBe(5);
    expect(snap.leafType).toBe("Customer");
    expect(snap.leafCount).toBe(1);
    expect(snap.layersDetail.map((l) => l.count)).toEqual([2, 2, 1]);
    expect(snap.summary).toContain("影响半径 3 层");
  });
});
