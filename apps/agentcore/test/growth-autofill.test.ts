import { describe, expect, it } from "vitest";
import { createTestApp, PLANNER, type TestApp } from "./helpers.js";
import { text, toolUse } from "../src/llm/mock.js";
import { FILL } from "../src/growth/probe.js";

/**
 * 自成长发动机 G + E-b：缺功能问句 → 骨架工单带**真实 I/O 契约 + 本体引用**（此前全空）+ 缺求解器
 * B 兜底命名 generic_inference + growth.* 事件经 E-c domain_events 馈源（F1 全局通道传播）。
 */
const H = { "x-debug-user": PLANNER, "content-type": "application/json" };

describe("G · 自成长自动补：骨架工单富契约 + B 兜底 + growth.* 事件", () => {
  it("B 兜底命名 generic_inference（FILL.SOLVER_NOT_FOUND）；各缺口码有补法", () => {
    expect(FILL.SOLVER_NOT_FOUND).toMatch(/generic-inference|generic_inference/i);
    expect(FILL.NO_CAPABILITY).toMatch(/GrowthTicket|I\/O|施工/);
    for (const v of Object.values(FILL)) expect(v.length).toBeGreaterThan(0);
  });

  it("缺能力问句 → 工单带真实 ioContract（inputs=filters+选中类型 / outputShape 按 gap）+ ontologyRefs（view+选中类型），非空", async () => {
    const t: TestApp = await createTestApp();
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    t.llm.queueAgentTurn({ content: [text("探索"), toolUse("final_answer", { blocks: [{ type: "text", markdown: "探索" }], provenance: [] })] });

    const run = await t.app.inject({
      method: "POST", url: "/api/v1/growth/run", headers: H,
      payload: {
        packageId: "pkg_battery_manufacturing",
        query: "4680-NCM 在常州的碳足迹分摊是多少？",
        context: { view: "risk", selectedObjects: [{ objectType: "Base", objectId: "B1" }], filters: { region: "east", quarter: "Q3" } },
        maxRounds: 2,
      },
    });
    expect(run.statusCode).toBe(200);

    const tickets = (await t.app.inject({ method: "GET", url: "/api/v1/growth/tickets", headers: H }).then((r) => r.json())) as {
      items: { gapCode: string; ioContract: { inputs: string[]; outputShape: string[] }; ontologyRefs: { objectTypes: string[] }; acceptance: string }[];
    };
    expect(tickets.items.length).toBeGreaterThan(0);
    const tk = tickets.items[0]!;
    // 富契约（此前 inputs 仅 filter keys、outputShape/objectTypes 全空）：现 inputs 含 filter + 选中类型
    expect(tk.ioContract.inputs).toEqual(expect.arrayContaining(["region", "quarter", "Base"]));
    expect(tk.ioContract.outputShape.length).toBeGreaterThan(0); // 按 gapCode 的输出形状骨架
    expect(tk.ontologyRefs.objectTypes).toEqual(expect.arrayContaining(["Base", "risk"])); // view + 选中类型
    // WO-DATABUILDER-HARNESS：NO_INTENT 现自补 DRAFT 意图 → 工单 acceptance 反映"已 scaffold DRAFT 骨架·施工=审批发布"（非从零开发）。
    expect(tk.gapCode).toBe("NO_INTENT");
    expect(tk.acceptance).toContain("审批发布");
  });

  it("E-b：growth.gap_detected / fill_proposed / ticket_opened 经 E-c 馈源（/b/v1/outbox）发出 → F1 传播", async () => {
    const t: TestApp = await createTestApp();
    const since = new Date(Date.now() - 1000).toISOString();
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    t.llm.queueAgentTurn({ content: [text("探索"), toolUse("final_answer", { blocks: [{ type: "text", markdown: "探索" }], provenance: [] })] });
    await t.app.inject({ method: "POST", url: "/api/v1/growth/run", headers: H, payload: { packageId: "pkg_battery_manufacturing", query: "未知能力问句", context: { view: "dash", selectedObjects: [], filters: {} }, maxRounds: 1 } });

    const evts = (await t.app.inject({ method: "GET", url: `/b/v1/outbox?since=${encodeURIComponent(since)}`, headers: H }).then((r) => r.json())) as { event: string }[];
    const names = new Set(evts.map((e) => e.event));
    expect(names.has("growth.gap_detected")).toBe(true);
    expect(names.has("growth.fill_proposed")).toBe(true);
    expect(names.has("growth.ticket_opened")).toBe(true);
  });
});
