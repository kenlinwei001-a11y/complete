import { beforeEach, describe, expect, it } from "vitest";
import type { GrowthTicket } from "@platform/contracts";
import { createTestApp, TENANT, type TestApp } from "./helpers.js";

/**
 * A4 · 成长工单施工面经工具接口暴露（厂商中立 code-agent 与 REST/CLI 同源操作）。
 *
 * 故事脚本（~100 字）：平台自己的施工 agent（dogfooding）打开成长工单墙——先 discover 看到两张 OPEN
 * 工单，其中"独角兽推演"缺口已带自动 scaffold 的 DRAFT 骨架（施工=审批发布非从零）；它认领该工单
 * （claim→IN_PROGRESS、登记施工者），干完提交待验证（submit→IN_REVIEW）。隔壁租户的 agent 既看不到
 * 这些工单、也认领不了（R2 租户隔离）。验证三工具经统一执行器驱动整套生命周期。
 */
const now = "2026-06-18T00:00:00.000Z";
function ticket(id: string, gapCode: GrowthTicket["gapCode"], tenantId = TENANT, extra: Partial<GrowthTicket> = {}): GrowthTicket {
  return {
    id, tenantId, fromQuestion: `问 ${id}`, gapCode,
    ioContract: { inputs: ["Model"], outputShape: ["value", "provenance"] },
    ontologyRefs: { objectTypes: ["Model"], slices: [], rules: [] },
    acceptance: "应能答出可验证答案", status: "OPEN", createdAt: now, ...extra,
  };
}

const CTX = { tenantId: TENANT, userId: "code-agent-1", roles: ["planner"] };
const OTHER = { tenantId: "tenant-other", userId: "intruder", roles: ["planner"] };

describe("A4 · 成长工单施工工具（discover/claim/submit）", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
    await t.repos.growthTickets.upsert(ticket("gtk_unicorn", "NO_PLAN", TENANT, { scaffoldedDrafts: [{ kind: "plan", key: "plan_growth_abc" }] }));
    await t.repos.growthTickets.upsert(ticket("gtk_carbon", "NO_RULE"));
    await t.repos.growthTickets.upsert(ticket("gtk_other", "NO_SLICE", "tenant-other")); // 隔壁租户
  });

  const run = (ctx: typeof CTX, tool: string, input: unknown) => t.deps.engine.makeExecutor("task_a4", ctx).run(tool, input);

  it("discover_growth_tickets：列本租户工单，带 scaffoldedDrafts；status 过滤生效", async () => {
    const all = await run(CTX, "discover_growth_tickets", {});
    expect(all.ok).toBe(true);
    const items = (all.payload as { items: { id: string; scaffoldedDrafts: { key: string }[] }[] }).items;
    expect(items.map((i) => i.id).sort()).toEqual(["gtk_carbon", "gtk_unicorn"]); // 不含隔壁租户 R2
    const unicorn = items.find((i) => i.id === "gtk_unicorn")!;
    expect(unicorn.scaffoldedDrafts[0]!.key).toBe("plan_growth_abc"); // 已建骨架可见

    const open = await run(CTX, "discover_growth_tickets", { status: "IN_REVIEW" });
    expect((open.payload as { items: unknown[] }).items.length).toBe(0); // 无 IN_REVIEW
  });

  it("claim → IN_PROGRESS（登记施工者）→ submit → IN_REVIEW（整套生命周期）", async () => {
    const claimed = await run(CTX, "claim_growth_ticket", { ticketId: "gtk_unicorn", assignee: "code-agent-1" });
    expect((claimed.payload as { status: string; assignee: string }).status).toBe("IN_PROGRESS");
    expect((claimed.payload as { assignee: string }).assignee).toBe("code-agent-1");
    expect((await t.repos.growthTickets.listByTenant(TENANT)).find((x) => x.id === "gtk_unicorn")!.status).toBe("IN_PROGRESS");

    const submitted = await run(CTX, "submit_growth_ticket", { ticketId: "gtk_unicorn" });
    expect((submitted.payload as { status: string }).status).toBe("IN_REVIEW");
    expect((await t.repos.growthTickets.listByTenant(TENANT)).find((x) => x.id === "gtk_unicorn")!.status).toBe("IN_REVIEW");

    // discover 过滤 IN_REVIEW 现在能查到它
    const inReview = await run(CTX, "discover_growth_tickets", { status: "IN_REVIEW" });
    expect((inReview.payload as { items: { id: string }[] }).items.map((i) => i.id)).toEqual(["gtk_unicorn"]);
  });

  it("R2 隔离：隔壁租户看不到也认领不了本租户工单", async () => {
    const seen = await run(OTHER, "discover_growth_tickets", {});
    expect((seen.payload as { items: { id: string }[] }).items.map((i) => i.id)).toEqual(["gtk_other"]); // 只见自己的

    const stolen = await run(OTHER, "claim_growth_ticket", { ticketId: "gtk_unicorn" });
    expect((stolen.payload as { error?: string }).error).toContain("TICKET_NOT_FOUND");
    // 本租户工单状态未被改动
    expect((await t.repos.growthTickets.listByTenant(TENANT)).find((x) => x.id === "gtk_unicorn")!.status).toBe("OPEN");
  });

  it("认领不存在的工单 → TICKET_NOT_FOUND（不抛异常，可恢复）", async () => {
    const r = await run(CTX, "claim_growth_ticket", { ticketId: "gtk_ghost" });
    expect(r.ok).toBe(true);
    expect((r.payload as { error: string }).error).toContain("TICKET_NOT_FOUND");
  });
});
