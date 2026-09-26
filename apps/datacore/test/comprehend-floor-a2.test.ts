import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";

/**
 * A2：让 comprehend 关键词地板（无 Kimi）也能选中新求解器并自动倒推参数 —— 不靠真 LLM，
 * 锂电常见故事即可在地板上倒推出对应求解器 + 可贯通到启动器的多跳/字段参数。
 * （shared_bottleneck 路径已在 llm-comprehend.test 覆盖；这里覆盖 margin_attribution。）
 */
interface RunResp {
  buildPlan?: { objectTypes: { typeKey: string }[]; solverNeeds: { solverKey: string; args?: Record<string, unknown> }[] };
}

describe("A2 · 关键词地板认新求解器（无 Kimi）", () => {
  it("毛利倒挂故事 → 地板选中 margin_attribution + 自动倒推营收/成本字段", async () => {
    const t: TestApp = await makeApp(); // 不 enqueue LLM → 落地板
    const story = "本季部分订单毛利倒挂、出现亏损，到底是哪个成本项把毛利拉穿的？";
    const res = await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: story, seed: 42 } });
    const bp = (res.json() as RunResp).buildPlan!;
    expect(bp.objectTypes.map((x) => x.typeKey)).toContain("Order");
    const m = bp.solverNeeds.find((s) => s.solverKey === "margin_attribution");
    expect(m).toBeDefined();
    expect(m!.args).toMatchObject({ targetType: "Order", revenueField: "revenue" });
    expect((m!.args!.costFields as { field: string }[]).some((c) => c.field === "rawCost")).toBe(true);
  });

  it("确定性 R6：同故事同 seed 地板倒推出的求解器+参数字节级一致", async () => {
    const t: TestApp = await makeApp();
    const story = "哪些工序会成为共享瓶颈、谁挤占谁、哪张单降级？";
    const run = async () => ((await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: story, seed: 42 } })).json() as RunResp).buildPlan!.solverNeeds;
    expect(await run()).toEqual(await run());
  });
});
