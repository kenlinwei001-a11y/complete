import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";
import { ClosurePolicySchema, BuildPlanSchema, type BuildPlan } from "@platform/contracts";
import { validateClosure } from "../src/databuilder/closure.js";
import { checkProvisionalHonesty } from "../src/databuilder/provisional-honesty.js";

const SCRIPT = "常州基地产能紧张，影响订单交期与客户信用，请做风险推演";
const policy = ClosurePolicySchema.parse({ object: {}, data: {}, forward: {} });

/** 含未注册求解器 + 缺字段的计划（STRICT 会 HARD 阻断）。 */
function brokenPlan(): BuildPlan {
  return BuildPlanSchema.parse({
    id: "bpl_a18", tenantId: "demo", builderKey: "t", scriptHash: "h", seed: 1, script: "",
    dataSources: [], objectTypes: [{ typeKey: "Order", displayName: "订单", domain: "product", properties: [{ propKey: "qty", dataType: "number" }] }],
    rules: [], kbDocs: [],
    solverNeeds: [{ solverKey: "capacity_switch_optimizer", inputFields: [{ typeKey: "Order", propKey: "ghostField" }] }], // 未注册 + 缺字段
    createdAt: "2026-01-01",
  });
}

describe("A18 · 双模闭包（STRICT HARD / PROVISIONAL ADVISORY）", () => {
  it("STRICT：未注册求解器 + 缺字段 → gatePassed=false、blocked=true、finding 非 ADVISORY（HARD 阻断不变）", () => {
    const r = validateClosure(brokenPlan(), policy, "STRICT");
    expect(r.buildMode).toBe("STRICT");
    expect(r.gatePassed).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.chainBroken).toBeGreaterThan(0);
    expect(r.advisoryCount).toBe(0);
    expect(r.findings.find((f) => f.kind === "CHAIN" && f.status === "FAILED")?.severity).not.toBe("ADVISORY");
  });

  it("PROVISIONAL：同样缺口 → 全降 ADVISORY、blocked=false（不阻断成 0），gatePassed 仍诚实=false", () => {
    const r = validateClosure(brokenPlan(), policy, "PROVISIONAL");
    expect(r.buildMode).toBe("PROVISIONAL");
    expect(r.blocked).toBe(false); // 守"不靠阻断成 0"
    expect(r.gatePassed).toBe(false); // 诚实：STRICT 口径仍不过
    expect(r.advisoryCount).toBeGreaterThan(0);
    // 所有 FAILED/MISSING 降级 ADVISORY
    expect(r.findings.filter((f) => f.status === "FAILED" || f.status === "MISSING").every((f) => f.severity === "ADVISORY")).toBe(true);
  });

  it("checkProvisionalHonesty：STRICT 直接通过；PROVISIONAL 缺标签/误标 VERIFIED → 违规", () => {
    const baseRun = { id: "sbr_1", tenantId: "demo", script: "s", producedConnections: [], producedDatasets: [], producedArtifacts: [], storyCoverage: [], nodes: [], status: "SUCCEEDED" as const, createdAt: "2026-01-01" };
    // STRICT → 空违规
    expect(checkProvisionalHonesty({ ...baseRun, buildMode: "STRICT" } as never)).toEqual([]);
    // PROVISIONAL 但缺 UNVERIFIED 标 + 误标 VERIFIED → 多条违规
    const bad = checkProvisionalHonesty({
      ...baseRun, buildMode: "PROVISIONAL", domainTrustLevel: "GOVERNED",
      verification: { status: "VERIFIED", question: "q", answerable: true, verifiedAt: "t" },
    } as never);
    expect(bad.some((v) => v.rule === "TRUST_LABEL")).toBe(true);
    expect(bad.some((v) => v.rule === "VERDICT")).toBe(true);
    expect(bad.some((v) => v.rule === "NO_ANSWERABLE")).toBe(true);
    // 干净 PROVISIONAL → 空违规
    expect(checkProvisionalHonesty({ ...baseRun, buildMode: "PROVISIONAL", domainTrustLevel: "UNVERIFIED", verification: { status: "PROVISIONAL_ANSWER", question: "q", verifiedAt: "t" } } as never)).toEqual([]);
  });
});

describe("A18 · 真服务 PROVISIONAL 建域（L1）", () => {
  it("buildMode:PROVISIONAL → 域标 UNVERIFIED + 终态 PROVISIONAL_ANSWER + domain.provisional_built + 诚实门过；STRICT 不变", async () => {
    const t: TestApp = await makeApp();
    t.services.databuilder.setInferenceProbe(async () => ({ answer: "可答", answerable: true }));

    // PROVISIONAL：建域 + 自动验证（onComplete）
    const prov = (await (await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: SCRIPT, seed: 7, buildMode: "PROVISIONAL", inference: true } })).json()) as {
      id: string; buildMode: string; domainTrustLevel: string; verification?: { status: string; answerable?: boolean };
    };
    expect(prov.buildMode).toBe("PROVISIONAL");
    expect(prov.domainTrustLevel).toBe("UNVERIFIED");
    // A18 红线：未审核域绝不 VERIFIED/answerable
    expect(prov.verification?.status).toBe("PROVISIONAL_ANSWER");
    expect(prov.verification?.answerable).not.toBe(true);
    // 诚实门：无违规
    const full = (await (await t.app.inject({ method: "GET", url: `/a/v1/databuilder/runs/${prov.id}`, headers: ADMIN })).json()) as never;
    expect(checkProvisionalHonesty(full)).toEqual([]);
    // 事件
    const events = await t.repos.outboxEvents.list("demo", (e) => e.event === "domain.provisional_built");
    expect(events.some((e) => (e.payload as { runId?: string }).runId === prov.id)).toBe(true);

    // STRICT（默认）：buildMode=STRICT + GOVERNED（行为不变）
    const strict = (await (await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: SCRIPT, seed: 8 } })).json()) as { buildMode: string; domainTrustLevel: string; verification?: { status: string } };
    expect(strict.buildMode).toBe("STRICT");
    expect(strict.domainTrustLevel).toBe("GOVERNED");
    expect(strict.verification?.status).not.toBe("PROVISIONAL_ANSWER");
  });
});
