import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { fireEvent, screen, within } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * 净室归因投影页（CleanroomAttrView）·三通用求解器前端首次接地（KILL-MOCK·SEAM-GATE）。
 * ① shared_bottleneck ② concentration_risk ③ margin_attribution 全部 `invokeSolver` 真调、零写死。
 * 求解器**参数由真对象类型倒推**（deriveArgs.ts 与后端 solver-args.ts 同源）——切主类型下拉 → 换 args → 重调 → 投影随之变。
 */

// 确定性对象类型集：覆盖三求解器所需结构（capacity/ref/demand·多跳 ref 链·营收+成本）。
const TYPES = [
  // 共享瓶颈：资源(有产能) × 共享者(引用资源·有需求·有优先级)。两组资源候选证下拉切换。
  { key: "Furnace", displayName: "化成柜", domain: "capacity", status: "ACTIVE", properties: [{ propKey: "furnaceId", dataType: "string", isPrimaryKey: true }, { propKey: "capacity", dataType: "number", isPrimaryKey: false }] },
  { key: "Job", displayName: "在制任务", domain: "capacity", status: "ACTIVE", properties: [{ propKey: "jobId", dataType: "string", isPrimaryKey: true }, { propKey: "furnaceRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Furnace" }, { propKey: "qty", dataType: "number", isPrimaryKey: false }, { propKey: "priority", dataType: "number", isPrimaryKey: false }] },
  { key: "Cell", displayName: "电芯槽", domain: "capacity", status: "ACTIVE", properties: [{ propKey: "cellId", dataType: "string", isPrimaryKey: true }, { propKey: "capacity", dataType: "number", isPrimaryKey: false }] },
  { key: "Task", displayName: "作业", domain: "capacity", status: "ACTIVE", properties: [{ propKey: "taskId", dataType: "string", isPrimaryKey: true }, { propKey: "cellRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Cell" }, { propKey: "qty", dataType: "number", isPrimaryKey: false }] },
  // 隐性集中度：Customer→Order→Supplier 两跳链。
  { key: "Customer", displayName: "客户", domain: "people", status: "ACTIVE", properties: [{ propKey: "custId", dataType: "string", isPrimaryKey: true }, { propKey: "orderRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Order" }] },
  { key: "Order", displayName: "订单", domain: "product", status: "ACTIVE", properties: [{ propKey: "orderId", dataType: "string", isPrimaryKey: true }, { propKey: "supplierRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Supplier" }] },
  { key: "Supplier", displayName: "供应商", domain: "supply", status: "ACTIVE", properties: [{ propKey: "supplierId", dataType: "string", isPrimaryKey: true }] },
  // 毛利倒挂：目标有营收 + ≥1 成本字段。
  { key: "Product", displayName: "产品", domain: "product", status: "ACTIVE", properties: [{ propKey: "prodId", dataType: "string", isPrimaryKey: true }, { propKey: "revenue", dataType: "number", isPrimaryKey: false }, { propKey: "rawCost", dataType: "number", isPrimaryKey: false }, { propKey: "laborCost", dataType: "number", isPrimaryKey: false }] },
];

function typesHandler() {
  return http.get("*/a/v1/ontology/object-types", () => HttpResponse.json(TYPES));
}

// 求解器 handler：读 args 回射结构性真值（证参数真通到求解器 + 切参数→投影变）。
function bottleneckHandler() {
  return http.post("*/a/v1/solvers/shared_bottleneck/invoke", async ({ request }) => {
    const { args } = (await request.json()) as { args: Record<string, string> };
    const rt = args.resourceType;
    const isF = rt === "Furnace";
    return HttpResponse.json({
      data: {
        bottlenecks: [{ resourceType: rt, resourceId: `${rt}-01`, capacity: isF ? 100 : 200, demand: isF ? 138 : 260, sharerCount: 3 }],
        contention: [{ resourceId: `${rt}-01`, sharers: ["a", "b", "c"] }],
        downgraded: [{ resourceId: `${rt}-01`, sharedByType: args.sharedByType, objectId: "c", reason: isF ? "优先级最低" : "需求最小" }],
        summary: `1 个共享瓶颈,3 张单争用,1 张被降级 · ${rt}`,
      },
      snapshotVersion: "ov-cr",
    });
  });
}
function concentrationHandler() {
  return http.post("*/a/v1/solvers/concentration_risk/invoke", async ({ request }) => {
    const { args } = (await request.json()) as { args: { startType: string; path: { toType: string }[] } };
    const rootType = args.path[args.path.length - 1]!.toType;
    const top = { rootType, rootId: `${rootType}-hub`, dependents: ["c1", "c2", "c3"], count: args.startType === "Customer" ? 3 : 2 };
    return HttpResponse.json({
      data: { concentrations: [top], topExposure: top, summary: `1 个隐性集中单点（${rootType}）,最大敞口 ${top.count} 个依赖方` },
      snapshotVersion: "ov-cr",
    });
  });
}
function marginHandler() {
  return http.post("*/a/v1/solvers/margin_attribution/invoke", async ({ request }) => {
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
  });
}

function renderCr() {
  loginAs("planner");
  server.use(typesHandler(), bottleneckHandler(), concentrationHandler(), marginHandler());
  return renderApp("/v/cleanroom-attr");
}

describe("净室归因投影页 · 三通用求解器接地", () => {
  it("C1 · 共享瓶颈块真调求解器 → 瓶颈行 + 降级单渲真值", async () => {
    renderCr();
    const res = await screen.findByTestId("cr-bn-result");
    // 参数由真对象类型倒推（Furnace 资源·Job 共享者·furnaceRef 链）——非写死。
    const argChips = screen.getByTestId("cr-bn-type-args");
    expect(argChips).toHaveTextContent("resourceType=Furnace");
    expect(argChips).toHaveTextContent("viaField=furnaceRef");
    expect(argChips).toHaveTextContent("capacityField=capacity");
    expect(argChips).toHaveTextContent("priorityField=priority");
    // 瓶颈行真值（需求 138 / 产能 100）+ 降级单。
    const row = within(res).getByTestId("cr-bn-row-Furnace-01");
    expect(row).toHaveTextContent("138");
    expect(row).toHaveTextContent("100");
    expect(within(res).getByTestId("cr-bn-downgraded-Furnace-01")).toHaveTextContent("优先级最低");
  });

  it("C1 · 隐性集中度块真调 → topExposure + 多跳路径", async () => {
    renderCr();
    fireEvent.click(await screen.findByTestId("cr-tab-concentration"));
    const res = await screen.findByTestId("cr-cc-result");
    // 路径由真 ref 链倒推：Customer→orderRef→Order→supplierRef→Supplier。
    const path = screen.getByTestId("cr-cc-path");
    expect(path).toHaveTextContent("orderRef");
    expect(path).toHaveTextContent("supplierRef");
    expect(path).toHaveTextContent("Supplier");
    expect(within(res).getByTestId("cr-cc-top")).toHaveTextContent("Supplier-hub");
    expect(within(res).getByTestId("cr-cc-top-count")).toHaveTextContent("3");
  });

  it("C1 · 毛利倒挂块真调 → rootDrivers 表 + 倒挂明细", async () => {
    renderCr();
    fireEvent.click(await screen.findByTestId("cr-tab-margin"));
    const res = await screen.findByTestId("cr-ma-result");
    // costFields 由真数值字段倒推（rawCost/laborCost）。
    expect(screen.getByTestId("cr-ma-type-args")).toHaveTextContent("targetType=Product");
    expect(within(res).getByTestId("cr-ma-driver-rawCost")).toBeInTheDocument();
    expect(within(res).getByTestId("cr-ma-driver-count-rawCost")).toHaveTextContent("1");
    expect(within(res).getByTestId("cr-ma-inv-Product-9")).toHaveTextContent("-28");
  });

  it("C2 · 接缝：切共享资源类型下拉 → 换 args → 求解器重调 → 投影随之变", async () => {
    renderCr();
    // 默认 Furnace（优先级命名 +1 分最高）：需求 138。
    const before = await screen.findByTestId("cr-bn-row-Furnace-01");
    expect(before).toHaveTextContent("138");
    // 切到 Cell → viaField/资源变，求解器重调返回不同真值（需求 260）。
    fireEvent.change(screen.getByTestId("cr-bn-type"), { target: { value: "Cell" } });
    const after = await screen.findByTestId("cr-bn-row-Cell-01");
    expect(after).toHaveTextContent("260");
    expect(screen.getByTestId("cr-bn-type-args")).toHaveTextContent("viaField=cellRef");
    // Furnace 行已不在（投影确实随参数切换而变，非叠加）。
    expect(screen.queryByTestId("cr-bn-row-Furnace-01")).toBeNull();
  });

  it("C3 · 诚实空态：求解器 404 / 未开通 → 错误卡，不编造瓶颈", async () => {
    loginAs("planner");
    server.use(
      typesHandler(),
      http.post("*/a/v1/solvers/shared_bottleneck/invoke", () =>
        HttpResponse.json({ error: { code: "FEATURE_NOT_FOUND", message: "求解器不存在或未开通", requestId: "r1" } }, { status: 404 }),
      ),
    );
    renderApp("/v/cleanroom-attr");
    expect(await screen.findByTestId("cr-bn-error")).toBeInTheDocument();
    expect(screen.queryByTestId("cr-bn-result")).toBeNull();
  });

  it("C3 · 空结果诚实：求解器返回空 bottlenecks → 「无瓶颈」空态", async () => {
    loginAs("planner");
    server.use(
      typesHandler(),
      http.post("*/a/v1/solvers/shared_bottleneck/invoke", () =>
        HttpResponse.json({ data: { bottlenecks: [], contention: [], downgraded: [], summary: "0 个共享瓶颈,0 张单争用,0 张被降级" }, snapshotVersion: "ov-cr" }),
      ),
    );
    renderApp("/v/cleanroom-attr");
    expect(await screen.findByTestId("cr-bn-empty")).toBeInTheDocument();
  });
});
