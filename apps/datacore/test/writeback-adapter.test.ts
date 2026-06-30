import { describe, expect, it } from "vitest";
import { makeApp, ADMIN } from "./helpers.js";
import { MockWritebackAdapter, ErpRestWritebackAdapter, buildWritebackAdapter } from "../src/writeback.js";
import type { ActionDraft } from "../src/domain.js";

/** 建一个无注册类型的简单 Action（默认审批链 [admin]·demo 租户 ALLOW_ADMIN 自审）→ 审批 → EXECUTED。 */
async function createAndExecute(t: Awaited<ReturnType<typeof makeApp>>, actionTypeKey = "WO_ACTUATE_TEST") {
  const draftRes = await t.app.inject({
    method: "POST",
    url: "/a/v1/action-drafts",
    headers: ADMIN,
    payload: { actionTypeKey, payload: { foo: "bar", n: 42 } },
  });
  expect(draftRes.statusCode).toBe(201);
  const { draftId } = draftRes.json() as { draftId: string };
  const approved = await t.app.inject({
    method: "POST",
    url: `/a/v1/action-drafts/${draftId}/approve`,
    headers: ADMIN,
    payload: {},
  });
  return { draftId, draft: approved.json() as ActionDraft };
}

describe("WO-ACTUATE · 决策出站写回适配器", () => {
  it("①a Mock 适配器：EXECUTED 自动落 writeback-echo → reconcile 一致即 ECHO_SUPPRESSED", async () => {
    const t = await makeApp(); // WRITEBACK_TARGET 默认 mock
    const { draft } = await createAndExecute(t);
    expect(draft.status).toBe("EXECUTED");
    expect(draft.writebackTarget).toBe("MOCK");
    expect(draft.executionResult?.target?.kind).toBe("MOCK");
    const targetRef = draft.executionResult!.targetRef!;
    expect(targetRef).toMatch(/^MO-2026-\d+$/);

    // 自动落的 echo（不靠手动 POST /a/v1/writeback-echoes）
    const echoes = (await t.app.inject({ method: "GET", url: "/a/v1/writeback-echoes", headers: ADMIN })).json() as {
      items: { ref: string; writtenValue: unknown; actionId: string }[];
    };
    const echo = echoes.items.find((e) => e.ref === targetRef);
    expect(echo).toBeTruthy();
    expect(echo!.writtenValue).toEqual({ foo: "bar", n: 42 });

    // 源系统回流同值 → 回声抑制
    const rec = (await t.app.inject({
      method: "POST",
      url: "/a/v1/writeback-echoes/reconcile",
      headers: ADMIN,
      payload: { ref: targetRef, incomingValue: { foo: "bar", n: 42 } },
    })).json() as { verdict: string };
    expect(rec.verdict).toBe("ECHO_SUPPRESSED");
  });

  it("①b Mock 适配器：源回流不同值 → 发 writeback.divergence（DL4）", async () => {
    const t = await makeApp();
    const { draft } = await createAndExecute(t);
    const targetRef = draft.executionResult!.targetRef!;
    const rec = (await t.app.inject({
      method: "POST",
      url: "/a/v1/writeback-echoes/reconcile",
      headers: ADMIN,
      payload: { ref: targetRef, incomingValue: { foo: "TAMPERED", n: 0 } },
    })).json() as { verdict: string };
    expect(rec.verdict).toBe("DIVERGENCE");
    const events = await t.repos.outboxEvents.list("demo", (e) => e.event === "writeback.divergence");
    expect(events.length).toBeGreaterThan(0);
  });

  it("② erp_rest 未配端点 → EXECUTED 诚实降级 WRITEBACK_NOT_CONFIGURED（非假成功）", async () => {
    const t = await makeApp({ env: { WRITEBACK_TARGET: "erp_rest" } });
    const { draft } = await createAndExecute(t);
    // 出站失败 → EXECUTION_FAILED（绝不假装写成功），错误码诚实
    expect(draft.status).toBe("EXECUTION_FAILED");
    expect(draft.writebackTarget).toBe("ERP_REST");
    expect(draft.executionResult?.error).toBe("WRITEBACK_NOT_CONFIGURED");
    expect(draft.executionResult?.target?.kind).toBe("ERP_REST");
  });

  it("R6 确定性：同 draft.id → 同 targetRef（无时钟/随机）", async () => {
    const t = await makeApp();
    const draft = { id: "act_fixed_123", tenantId: "demo", payload: {} } as ActionDraft;
    expect(MockWritebackAdapter.targetRefFor(draft)).toBe(MockWritebackAdapter.targetRefFor(draft));
    const adapter = new MockWritebackAdapter(t.repos);
    const r1 = await adapter.execute(draft);
    expect(r1.targetRef).toBe(MockWritebackAdapter.targetRefFor(draft));
  });

  it("R2 租户隔离：echo 带 draft.tenantId，跨租户不可见", async () => {
    const t = await makeApp();
    const adapter = new MockWritebackAdapter(t.repos);
    await adapter.execute({ id: "act_a", tenantId: "tenantA", payload: { v: 1 } } as ActionDraft);
    const inA = await t.repos.writebackEchoes.list("tenantA", () => true);
    const inB = await t.repos.writebackEchoes.list("tenantB", () => true);
    expect(inA.length).toBe(1);
    expect(inB.length).toBe(0);
  });

  it("erp stub：配了 base url 仍是未实现 stub（诚实·真 ERP body 待接入）", async () => {
    const adapter = new ErpRestWritebackAdapter("http://erp.example/api");
    const r = await adapter.execute({ id: "act_x", tenantId: "demo", payload: {} } as ActionDraft);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("WRITEBACK_ERP_STUB_NOT_IMPLEMENTED");
    expect(r.target.kind).toBe("ERP_REST");
  });

  it("buildWritebackAdapter：config 选择对应种类", async () => {
    const t = await makeApp();
    expect(buildWritebackAdapter("mock", t.repos).kind).toBe("MOCK");
    expect(buildWritebackAdapter("erp_rest", t.repos).kind).toBe("ERP_REST");
  });
});
