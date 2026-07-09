import { describe, expect, it } from "vitest";
import type { StoryBuildRun, TicketBoardRow, TicketDetail } from "@platform/contracts";
import { createTestApp, PLANNER, TENANT, type TestApp } from "./helpers.js";

/**
 * UPG-L0-CONSOLE-BOARD 齿轮测试（PRD-gapfill-surface-consolidation §3/§4）：把 script-目标建域缺口
 * （StoryBuildRun.ClosureReport MISSING 段）additive 投影进统一 Console board（R13 纯只读投影不造新真值）。
 *  - BC1 暗发 ON：flag 开 → board 收进 BUILD_CLOSURE 行 + buildClosureEnabled=true；source 透镜精确过滤；
 *    详情逐值对 ClosureReport（全链闭包逐段 + counts）。
 *  - BC2 回退演练 C3：flag OFF（缺省）→ board 无 BUILD_CLOSURE 行 + buildClosureEnabled=false；sbc_ 详情 404（改造前系统无此源）。
 *  - BC3 R2 租户隔离：跨租户看不到他租户建域闭包行。
 */
const H = (user: string) => ({ "x-debug-user": user, "content-type": "application/json" });
const NOW = "2026-07-09T08:00:00.000Z";

function runWithClosure(id: string, tenantId: string): StoryBuildRun {
  return {
    id, tenantId, script: "为常州基地建产能爬坡域", status: "SUCCEEDED",
    producedConnections: [], producedDatasets: [], producedArtifacts: [], storyCoverage: [], nodes: [],
    buildMode: "STRICT",
    closureReport: {
      gatePassed: false, buildMode: "STRICT", advisoryCount: 0, blocked: true,
      objectsBound: 3, dataOrphans: 1, forwardMissing: 1, chainBroken: 1, shapeBroken: 0,
      findings: [
        { kind: "OBJECT", ref: "Base", status: "BOUND", detail: "对象类型已注册" },
        { kind: "CHAIN", ref: "solver:capacity_ramp", status: "MISSING", detail: "求解器需求未在 DataCore 注册", severity: "HARD" },
        { kind: "DATA", ref: "Order.qty", status: "MISSING", detail: "数据集字段孤儿", severity: "HARD" },
        { kind: "FORWARD", ref: "capacity_ramp.output", status: "FAILED", detail: "正向产出缺失", severity: "HARD" },
      ],
    },
    createdAt: NOW,
  };
}

describe("UPG-L0-CONSOLE-BOARD · script 目标 BUILD_CLOSURE 收进统一 Console board", () => {
  it("BC1 暗发 ON：board 收进 ClosureReport MISSING 段 + source 透镜过滤 + 详情逐值对闭包", async () => {
    const t: TestApp = await createTestApp({ env: { GROWTH_BUILD_CLOSURE: "1" } });
    t.dataCore.databuilder.seed(runWithClosure("sbr_bc1", TENANT));

    const res = await t.app.inject({ method: "GET", url: "/api/v1/growth/board", headers: H(PLANNER) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: TicketBoardRow[]; buildClosureEnabled: boolean };
    expect(body.buildClosureEnabled).toBe(true);
    // MISSING/FAILED 三段 → 三行（BOUND 段不投影·R13 只投缺口）。
    const closureRows = body.items.filter((r) => r.source === "BUILD_CLOSURE");
    expect(closureRows.length).toBe(3);
    for (const r of closureRows) {
      expect(r.kind).toBe("BUILD_CLOSURE");
      expect(r.claimable).toBe(false); // R13 只读投影不可认领
      expect(r.fromQuestion).toBe("为常州基地建产能爬坡域");
      expect(r.deeplink).toBe("/admin/data-builder?run=sbr_bc1");
    }
    // 缺口码映射（换标不造真值）：CHAIN/FORWARD→SOLVER_NOT_FOUND·DATA→EMPTY_DATA。
    expect(closureRows.map((r) => r.gapCode).sort()).toEqual(["EMPTY_DATA", "SOLVER_NOT_FOUND", "SOLVER_NOT_FOUND"]);

    // source 透镜精确过滤（script 目标 = BUILD_CLOSURE）。
    const script = await t.app.inject({ method: "GET", url: "/api/v1/growth/board?source=BUILD_CLOSURE", headers: H(PLANNER) });
    const scriptRows = (script.json() as { items: TicketBoardRow[] }).items;
    expect(scriptRows.length).toBe(3);
    expect(scriptRows.every((r) => r.source === "BUILD_CLOSURE")).toBe(true);
    // query 目标透镜（WORKLIST）不含 BUILD_CLOSURE 行。
    const query = await t.app.inject({ method: "GET", url: "/api/v1/growth/board?source=WORKLIST", headers: H(PLANNER) });
    expect((query.json() as { items: TicketBoardRow[] }).items.every((r) => r.source === "WORKLIST")).toBe(true);

    // 详情逐值对 ClosureReport（全链闭包逐段 + counts·R13 只读投影）。
    const chainRow = closureRows.find((r) => r.evidence.includes("CHAIN"))!;
    const detail = await t.app.inject({ method: "GET", url: `/api/v1/growth/tickets/${chainRow.id}/detail`, headers: H(PLANNER) });
    expect(detail.statusCode).toBe(200);
    const d = detail.json() as TicketDetail;
    expect(d.supply.closure).toBeDefined();
    expect(d.supply.closure!.gatePassed).toBe(false);
    expect(d.supply.closure!.buildMode).toBe("STRICT");
    expect(d.supply.closure!.segments.length).toBe(4); // 逐段全投（含 BOUND，让用户看全链）
    expect(d.supply.closure!.counts).toEqual({ objectsBound: 3, dataOrphans: 1, forwardMissing: 1, chainBroken: 1, shapeBroken: 0 });
    const chainSeg = d.supply.closure!.segments.find((s) => s.kind === "CHAIN")!;
    expect(chainSeg).toMatchObject({ ref: "solver:capacity_ramp", status: "MISSING", severity: "HARD" });
  });

  it("BC2 回退演练 C3：flag OFF（缺省）→ board 无 BUILD_CLOSURE 行 + buildClosureEnabled=false·sbc_ 详情 404", async () => {
    const t: TestApp = await createTestApp(); // 无 GROWTH_BUILD_CLOSURE = 关闸（改造前系统）
    t.dataCore.databuilder.seed(runWithClosure("sbr_off", TENANT));

    const res = await t.app.inject({ method: "GET", url: "/api/v1/growth/board", headers: H(PLANNER) });
    const body = res.json() as { items: TicketBoardRow[]; buildClosureEnabled: boolean };
    expect(body.buildClosureEnabled).toBe(false);
    expect(body.items.some((r) => r.source === "BUILD_CLOSURE")).toBe(false); // 关闸=改造前 query-目标 board

    // sbc_ 详情关闸即不存在（404·非静默 200 空）。
    const detail = await t.app.inject({ method: "GET", url: "/api/v1/growth/tickets/sbc_sbr_off.0/detail", headers: H(PLANNER) });
    expect(detail.statusCode).toBe(404);
  });

  it("BC3 R2 租户隔离：flag ON 下跨租户看不到他租户建域闭包行", async () => {
    const t: TestApp = await createTestApp({ env: { GROWTH_BUILD_CLOSURE: "1" } });
    t.dataCore.databuilder.seed(runWithClosure("sbr_mine", TENANT));
    const OTHER = "other-tenant:user-x:planner";
    const board = await t.app.inject({ method: "GET", url: "/api/v1/growth/board", headers: H(OTHER) });
    expect((board.json() as { items: TicketBoardRow[] }).items.some((r) => r.source === "BUILD_CLOSURE")).toBe(false);
  });
});
