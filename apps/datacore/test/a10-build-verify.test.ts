import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";

const SCRIPT = "常州基地产能紧张，影响订单交期与客户信用，请做风险推演";

/**
 * A10 · 终态闭环末步（建域→publish→自动/手动重跑主问句验证"现在真能答了"）。
 * 守"绿测试≠能用"：QOS 实跑可答=VERIFIED(活证据)；不可答=NOT_VERIFIED+缺口码；QOS 未配=BUILD_STATIC(诚实)。
 */
describe("A10 · 终态闭环验证（verifyBuild）", () => {
  it("手动重跑验证 · QOS 可答 → VERIFIED(RUNTIME_PROBE) + build.verified 事件 + 回灌 FDE launcher 节点 DONE", async () => {
    const t: TestApp = await makeApp();
    t.services.databuilder.setInferenceProbe(async () => ({ answer: "常州 7 月缺口 12%，主瓶颈涂布", answerable: true }));

    const run = (await (await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: SCRIPT, seed: 31 } })).json()) as { id: string; status: string };
    expect(run.status).toBe("SUCCEEDED");

    const verified = (await (await t.app.inject({ method: "POST", url: `/a/v1/databuilder/runs/${run.id}/verify`, headers: ADMIN })).json()) as {
      verification: { status: string; evidence: string; answerable: boolean; answer: string };
      nodes: { key: string; status: string }[];
    };
    expect(verified.verification.status).toBe("VERIFIED");
    expect(verified.verification.evidence).toBe("RUNTIME_PROBE");
    expect(verified.verification.answerable).toBe(true);
    expect(verified.verification.answer).toMatch(/经 QOS 实跑/);
    // 回灌 FDE 节点图末节点（launcher）
    expect(verified.nodes.find((n) => n.key === "launcher")!.status).toBe("DONE");

    const events = await t.repos.outboxEvents.list("demo", (e) => e.event === "build.verified");
    expect(events.some((e) => (e.payload as { status?: string }).status === "VERIFIED")).toBe(true);
  });

  it("QOS 实跑不可答 → NOT_VERIFIED + gapCode + FDE launcher 节点 FAILED（不假绿）", async () => {
    const t: TestApp = await makeApp();
    t.services.databuilder.setInferenceProbe(async () => ({ answer: "缺求解器，无法回答", answerable: false }));
    const run = (await (await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: SCRIPT, seed: 32 } })).json()) as { id: string };
    const v = (await (await t.app.inject({ method: "POST", url: `/a/v1/databuilder/runs/${run.id}/verify`, headers: ADMIN })).json()) as {
      verification: { status: string; gapCode: string }; nodes: { key: string; status: string; gapCode?: string }[];
    };
    expect(v.verification.status).toBe("NOT_VERIFIED");
    expect(v.verification.gapCode).toBe("NOT_ANSWERABLE");
    const launcher = v.nodes.find((n) => n.key === "launcher")!;
    expect(launcher.status).toBe("FAILED");
    expect(launcher.gapCode).toBe("NOT_ANSWERABLE");
  });

  it("QOS 未配 → BUILD_STATIC（兜底直调求解器，诚实标'未过运行时'）", async () => {
    const t: TestApp = await makeApp(); // 不注入 inferenceProbe
    const run = (await (await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: SCRIPT, seed: 33 } })).json()) as { id: string };
    const v = (await (await t.app.inject({ method: "POST", url: `/a/v1/databuilder/runs/${run.id}/verify`, headers: ADMIN })).json()) as { verification: { status: string; evidence: string } };
    expect(v.verification.status).toBe("BUILD_STATIC");
    expect(v.verification.evidence).toBe("BUILD_STATIC");
  });

  it("全自动末步：publish 后 onComplete 自动触发 verifyBuild（建域即带 verification，无需手动）", async () => {
    const t: TestApp = await makeApp();
    t.services.databuilder.setInferenceProbe(async () => ({ answer: "可答", answerable: true }));
    // inference=false 也自动验证（A10 验证不依赖 inference 标志，是 publish 后的独立末步）
    const run = (await (await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: SCRIPT, seed: 34 } })).json()) as {
      id: string; verification?: { status: string };
    };
    expect(run.verification?.status).toBe("VERIFIED");
  });

  it("R2：跨租户 verify → 404（仅本租户 run）", async () => {
    const t: TestApp = await makeApp();
    const run = (await (await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: SCRIPT, seed: 35 } })).json()) as { id: string };
    const other = await t.app.inject({ method: "POST", url: `/a/v1/databuilder/runs/${run.id}/verify`, headers: { "x-debug-user": "acme:admin:admin" } });
    expect(other.statusCode).toBe(404);
  });
});
