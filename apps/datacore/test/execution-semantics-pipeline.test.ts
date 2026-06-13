import { describe, expect, it } from "vitest";
import { ADMIN, b64, makeApp, seedBattery } from "./helpers.js";
import { OpsReplayService } from "../src/opsteam/replay.js";
import type { LlmParseRequest } from "../src/llm.js";
import type { OpsTickReport } from "@platform/contracts";

const FIXTURE_MD = `# 产能管理制度

第一条 需求增量超过 50% 时必须阻断排产并上报计划委员会审批。

第二条 外协比例不得超过 30%，超出时系统应发出警告并记录原因。

第三条 客户信用使用率超过 100% 时禁止接收新订单。
`;

function extractionFor(req: LlmParseRequest<unknown>): unknown {
  const text = req.messages[0]!.content;
  if (text.includes("需求增量"))
    return { candidates: [{ name: "需求增量阻断", description: "d", expression: "Order.demandDelta > 0.5", expressionConfidence: 0.95, scopeObjectTypes: ["Order"], severity: "BLOCK", sourceQuote: "需求增量超过 50% 时必须阻断排产" }] };
  if (text.includes("外协比例"))
    return { candidates: [{ name: "外协比例上限", description: "d", expression: "Order.outsourceRatio > 0.3", expressionConfidence: 0.9, scopeObjectTypes: ["Order"], severity: "WARN", sourceQuote: "外协比例不得超过 30%" }] };
  if (text.includes("信用使用率"))
    return { candidates: [{ name: "信用额度约束", description: "d", expression: "Order.creditUsedRatio > 1", expressionConfidence: 0.92, scopeObjectTypes: ["Order"], severity: "BLOCK", sourceQuote: "客户信用使用率超过 100% 时禁止接收新订单" }] };
  return { candidates: [] };
}

describe("execution semantics §6 — A2 partial extraction (three-state)", () => {
  it("a failed segment yields PARTIAL with successful segments preserved; single-segment retry recovers", async () => {
    const t = await makeApp();
    // segment 2 ("外协比例") fails; the other two succeed
    let failOutsource = true;
    t.llm.onRequest((req) => {
      const text = (req as LlmParseRequest<unknown>).messages[0]!.content;
      if (failOutsource && text.includes("外协比例")) throw new Error("segment LLM 503");
      return extractionFor(req as LlmParseRequest<unknown>);
    });

    const up = await t.app.inject({
      method: "POST",
      url: "/a/v1/rule-docs",
      headers: ADMIN,
      payload: { filename: "capacity-policy.md", contentBase64: b64(FIXTURE_MD) },
    });
    expect(up.statusCode).toBe(202);
    const { docId, status, candidateCount } = up.json() as { docId: string; status: string; candidateCount: number };
    expect(status).toBe("PARTIAL"); // §6: not failed, not dropped
    expect(candidateCount).toBe(2); // the two healthy segments produced candidates

    // segment-level status table
    const segRes = await t.app.inject({ method: "GET", url: `/a/v1/rule-docs/${docId}/segments`, headers: ADMIN });
    const segItems = (segRes.json() as { items: { segNo: number; status: string; error?: string }[] }).items;
    expect(segItems).toHaveLength(3);
    const failed = segItems.filter((s) => s.status === "FAILED");
    expect(failed).toHaveLength(1);
    expect(failed[0]!.error).toContain("503");

    // retry the single failed segment after the transient error clears
    failOutsource = false;
    const retry = await t.app.inject({
      method: "POST",
      url: `/a/v1/rule-docs/${docId}/segments/${failed[0]!.segNo}/retry`,
      headers: ADMIN,
    });
    expect(retry.statusCode).toBe(200);
    expect((retry.json() as { status: string }).status).toBe("IN_REVIEW"); // no failed segments left

    const cands = (
      await t.app.inject({ method: "GET", url: `/a/v1/rule-docs/${docId}/candidates`, headers: ADMIN })
    ).json() as unknown[];
    expect(cands).toHaveLength(3); // failed segment's candidate now present
  });

  it("retry on a non-PARTIAL doc is rejected", async () => {
    const t = await makeApp();
    t.llm.onRequest((req) => extractionFor(req as LlmParseRequest<unknown>));
    const up = await t.app.inject({
      method: "POST",
      url: "/a/v1/rule-docs",
      headers: ADMIN,
      payload: { filename: "ok.md", contentBase64: b64(FIXTURE_MD) },
    });
    const { docId } = up.json() as { docId: string };
    const retry = await t.app.inject({ method: "POST", url: `/a/v1/rule-docs/${docId}/segments/0/retry`, headers: ADMIN });
    expect(retry.statusCode).toBe(409);
  });
});

describe("execution semantics §4 — replay action idempotency (opKey)", () => {
  it("re-running the same tick dedupes side-effecting actions via opKey", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await t.services.opsTeam.seedDefaultPersonas("demo");

    let askCalls = 0;
    const replay = new OpsReplayService({
      actions: t.services.actions,
      sop: t.services.sop,
      solvers: t.services.solvers,
      resolvePersona: (tenantId, username) => t.services.opsTeam.resolvePersonaCtx(tenantId, username),
      ask: async () => {
        askCalls++;
        return { taskId: `task_${askCalls}` };
      },
      listPendingDrafts: async () => [],
      listFallbackClusters: async () => [],
      promoteIntent: async () => null,
      adoptMitigation: async () => ({ draftId: "d", status: "EXECUTED" }),
      idempotency: {
        get: async (tenantId, opKey) => {
          const rec = await t.repos.idempotencyRecords.get(tenantId, `replay|${opKey}`);
          if (!rec || rec.expiresAt < new Date().toISOString()) return undefined;
          return rec.responseDigest as unknown as OpsTickReport["executed"][number];
        },
        put: async (tenantId, opKey, exec) => {
          const now = Date.now();
          await t.repos.idempotencyRecords.put({
            id: `replay|${opKey}`,
            tenantId,
            scope: "replay",
            responseDigest: exec as unknown as Record<string, unknown>,
            createdAt: new Date(now).toISOString(),
            expiresAt: new Date(now + 7 * 24 * 60 * 60_000).toISOString(),
          });
        },
      },
      log: () => undefined,
    });

    const playbook = {
      key: "k",
      version: 1,
      cadence: { daily: [{ kind: "ask" as const, persona: "vp_planner_zhang", view: "risk", queryPool: "planner_daily", prob: 1 }] },
    };
    const args = { tick: 1, date: "2026-07-06", seed: 42, scenarioEvents: [] };

    const r1 = await replay.runTick("demo", playbook, args);
    const r2 = await replay.runTick("demo", playbook, args); // crash-and-resume of the same tick

    expect(askCalls).toBe(1); // §4: side effect executed exactly once
    expect(r1.executed).toHaveLength(1);
    expect(r2.executed).toHaveLength(1); // cached result still reported
    expect(r2.executed[0]!.ref).toBe(r1.executed[0]!.ref);
  });
});
