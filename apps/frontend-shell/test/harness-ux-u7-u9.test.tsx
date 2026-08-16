import { describe, expect, it } from "vitest";
import { http, HttpResponse, type RequestHandler } from "msw";
import { screen } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { useSessionStore } from "@/store/sessionStore";
import {
  BASIS_LABEL,
  STAMP_LABEL,
  buildProvenanceHtml,
  exportStamp,
  reportFileName,
  type ProvenanceReport,
} from "@/views/sim/exportProvenance";

/**
 * ══ WO-HARNESS-UX-GAP-1 · 判据 U7 / U9 的机检 ══
 *
 * 判据出处：`docs/PRD-harness-ux-adoption.md` §2
 *   · **U7 同屏问答带本页上下文** —— 问答常驻同屏，**且知道自己在哪一页**；
 *   · **U9 导出带出处与时间戳** —— 导出物自带口径说明与生成时间，可被第三方复算。
 * 参考件对位：`docs/reference-prototype-decision-platform.html` 第 3532 行（问答「基于本页实时数据回答」）
 * 与第 3582 行（导出抬头「… · 导出时间 ${now} · 所有数字派生自同一本体」）。
 *
 * ── 这一份测试咬的是**链路**，不是函数（假绿第 9 形态 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR`）──
 * U7 的断言刻意**不去调 `usePageView`**，而是把整个应用渲染到那条 URL 上，再问
 * `sessionStore.view` 是不是这一页 —— 因为 U7 的真实失败模式恰恰是「hook 写好了但页面没挂」
 * 或「页面挂了但走的是另一条路由」，直接调 hook 的测试对这两种失败**全都是绿的**。
 *
 * ── 前置哨兵（这一条不是装饰）───────────────────────────────────────────────────
 * 每个 U7 用例渲染前先把 `view` 设成一个哨兵值。若没有这一步，
 * `view` 恰好等于目标键时用例照样绿 —— 而那可能是上一个用例的残留、也可能是初值。
 * 断言要的是「**这一页把它改成了自己**」，不是「它现在恰好是对的」。
 * 反向哨兵见最后一个 `describe`：一个**已知没挂**的页面必须**不**命中，
 * 否则说明断言恒真（那是工具坏了，不是页面都合格）。
 */

/* ══════════════ 各页最小 handler（只为把页面渲染出来，不验业务数值）══════════════ */

const CR_TYPES = [
  { key: "Furnace", displayName: "化成柜", domain: "capacity", status: "ACTIVE", properties: [{ propKey: "furnaceId", dataType: "string", isPrimaryKey: true }, { propKey: "capacity", dataType: "number", isPrimaryKey: false }] },
  { key: "Job", displayName: "在制任务", domain: "capacity", status: "ACTIVE", properties: [{ propKey: "jobId", dataType: "string", isPrimaryKey: true }, { propKey: "furnaceRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Furnace" }, { propKey: "qty", dataType: "number", isPrimaryKey: false }, { propKey: "priority", dataType: "number", isPrimaryKey: false }] },
];

const DR_TYPES = [
  { key: "Supplier", displayName: "供应商", status: "ACTIVE", properties: [{ propKey: "supplierId", dataType: "string", isPrimaryKey: true }] },
  { key: "Material", displayName: "物料", status: "ACTIVE", properties: [{ propKey: "materialId", dataType: "string", isPrimaryKey: true }, { propKey: "supplierRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Supplier" }] },
];

function typesHandler(types: unknown) {
  return http.get("*/a/v1/ontology/object-types", () => HttpResponse.json(types));
}

function objectsHandler() {
  return http.get("*/a/v1/objects", ({ request }) => {
    const type = new URL(request.url).searchParams.get("type") ?? "";
    const items = type === "Supplier" ? [{ id: "s1", type, props: { supplierId: "SUP-01" } }] : [];
    return HttpResponse.json({ items, total: items.length });
  });
}

function bottleneckHandler() {
  return http.post("*/a/v1/solvers/shared_bottleneck/invoke", async ({ request }) => {
    const { args } = (await request.json()) as { args: Record<string, string> };
    return HttpResponse.json({
      data: {
        bottlenecks: [{ resourceType: args.resourceType, resourceId: "Furnace-01", capacity: 100, demand: 138, sharerCount: 3 }],
        contention: [{ resourceId: "Furnace-01", sharers: ["a", "b", "c"] }],
        downgraded: [{ resourceId: "Furnace-01", sharedByType: args.sharedByType, objectId: "c", reason: "优先级最低" }],
        summary: "1 个共享瓶颈,3 张单争用,1 张被降级",
      },
      snapshotVersion: "ov-cr",
    });
  });
}

function radiusHandler() {
  return http.post("*/a/v1/solvers/supplier_disruption_radius/invoke", async ({ request }) => {
    const body = (await request.json()) as { args: { rootType: string; rootId: string; layers: { type: string; viaField: string }[] } };
    const layers = body.args.layers.map((l) => ({ ...l, count: 2, ids: ["m1", "m2"] }));
    return HttpResponse.json({
      data: {
        rootType: body.args.rootType,
        rootId: body.args.rootId,
        layers,
        radius: layers.length,
        totalAffected: layers.length * 2,
        leafType: layers[layers.length - 1]?.type ?? null,
        leafCount: 2,
        summary: "断供波及 2 个对象",
      },
      snapshotVersion: "ov-dr",
    });
  });
}

/** 四页的挂载点：URL → 期望的 view 键 → 该页导出按钮的 testid（先出现的那一个）。 */
const PAGES: { path: string; viewKey: string; exportTestId: string; handlers: () => RequestHandler[] }[] = [
  { path: "/v/what-if", viewKey: "what-if", exportTestId: "export-report-what-if", handlers: () => [typesHandler([])] },
  { path: "/v/optimize-whatif", viewKey: "optimize-whatif", exportTestId: "export-report-optimize-whatif", handlers: () => [] },
  { path: "/v/cleanroom-attr", viewKey: "cleanroom-attr", exportTestId: "export-report-cleanroom-bottleneck", handlers: () => [typesHandler(CR_TYPES), bottleneckHandler()] },
  { path: "/v/disruption-radius", viewKey: "disruption-radius", exportTestId: "export-report-disruption-radius", handlers: () => [typesHandler(DR_TYPES), objectsHandler(), radiusHandler()] },
];

const SENTINEL = "__sentinel-not-a-real-view__";

/* ══════════════ U7 · 同屏问答知道自己在哪一页 ══════════════ */

describe("判据 U7 · 专用 route 的推演页必须把「我是哪一页」告诉同屏问答", () => {
  for (const p of PAGES) {
    it(`${p.path} → sessionStore.view === "${p.viewKey}"（问答的本页上下文与建议问句都靠它）`, async () => {
      loginAs("planner");
      const hs = p.handlers();
      if (hs.length) server.use(...hs);
      // 前置哨兵：先污染成一个绝不可能是答案的值，逼这一页自己把它改回来。
      useSessionStore.getState().setView(SENTINEL);
      expect(useSessionStore.getState().view).toBe(SENTINEL);

      renderApp(p.path);
      // 等页面真正渲染出来（不是等 URL 变）——`usePageView` 在 effect 里跑，挂载后才生效。
      await screen.findByTestId(p.exportTestId);

      expect(useSessionStore.getState().view).toBe(p.viewKey);
    });
  }

  it("反向哨兵：哨兵值不会自己变回真键（证上面的断言不是恒真）", () => {
    useSessionStore.getState().setView(SENTINEL);
    expect(useSessionStore.getState().view).not.toBe("what-if");
    expect(PAGES.map((p) => p.viewKey)).not.toContain(SENTINEL);
  });
});

/* ══════════════ U9 · 导出物自带出处与生成时间 ══════════════ */

describe("判据 U9 · 每个推演页都能导出一份第三方可复算的文档", () => {
  for (const p of PAGES) {
    it(`${p.path} 屏上有导出入口 + 问号记号（口径在浮层，第一层只留动作）`, async () => {
      loginAs("planner");
      const hs = p.handlers();
      if (hs.length) server.use(...hs);
      renderApp(p.path);

      const btn = await screen.findByTestId(p.exportTestId);
      expect(btn).toHaveTextContent("导出");
      // 静默降层等于删除：口径降进浮层后，第一层必须留下那个可见记号。
      const infoId = p.exportTestId.replace("export-report-", "info-export-");
      expect(screen.getByTestId(infoId)).toBeInTheDocument();
    });
  }

  it("拼出的文档同时含 生成时间 + 口径与出处 + 表格本体（逐字咬，不咬「有没有导出按钮」）", () => {
    const report: ProvenanceReport = {
      docName: "优化推演",
      basis: ["求解器 optimize_whatif · 模板族 facility_location（seed 42·同输入同输出）", "扰动：facilities.f1.cost→9"],
      sections: [{ heading: "目标值对照", head: ["项", "值"], rows: [["基线目标值", 120], ["扰动后目标值", 133]] }],
    };
    const html = buildProvenanceHtml(report, "2026-08-16 09:30");

    expect(html).toContain(`${STAMP_LABEL} 2026-08-16 09:30`);
    expect(html).toContain(`${BASIS_LABEL}：`);
    expect(html).toContain("求解器 optimize_whatif · 模板族 facility_location（seed 42·同输入同输出）");
    expect(html).toContain("扰动：facilities.f1.cost→9");
    expect(html).toContain("所有数字派生自同一本体（一个事实一个出处）");
    expect(html).toContain("目标值对照");
    expect(html).toContain("<td>133</td>");
  });

  /**
   * **必不中样例**（金丝雀的另一半）：判据写在生产代码入口，不是只写在这一行断言里。
   * 若哪天有人把 `basis` 去掉图省事，`buildProvenanceHtml` 当场抛 —— 而不是安静地
   * 导出一份没人能复算的漂亮表格（那种失败在屏上看不出来，这正是 U9 要防的）。
   */
  it("缺口径 / 缺时间戳 ⇒ 直接抛，不许导出一份不可复算的文档", () => {
    const noBasis: ProvenanceReport = { docName: "优化推演", basis: [], sections: [] };
    expect(() => buildProvenanceHtml(noBasis, "2026-08-16 09:30")).toThrow(/口径与出处/);
    // 只有空白的 basis 同样不算数（"  " 不是出处）。
    expect(() => buildProvenanceHtml({ ...noBasis, basis: ["   "] }, "2026-08-16 09:30")).toThrow(/口径与出处/);
    expect(() => buildProvenanceHtml({ ...noBasis, basis: ["求解器 x"] }, "  ")).toThrow(/生成时间/);
  });

  it("空结果诚实留白，不补编数据；时间戳与文件名确定性（R6 同输入同输出）", () => {
    const html = buildProvenanceHtml(
      { docName: "断供影响半径", basis: ["求解器 supplier_disruption_radius"], sections: [{ heading: "逐层受冲击对象", head: ["层", "数"], rows: [] }] },
      "2026-08-16 09:30",
    );
    expect(html).toContain("诚实空态，不补编");

    const d = new Date(2026, 7, 16, 9, 5);
    expect(exportStamp(d)).toBe("2026-08-16 09:05");
    expect(exportStamp(d)).toBe(exportStamp(new Date(2026, 7, 16, 9, 5)));
    expect(reportFileName("净室归因 · 共享瓶颈", "2026-08-16 09:05")).toBe("净室归因_共享瓶颈_2026-08-16.html");
  });
});
