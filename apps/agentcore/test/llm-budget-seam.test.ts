import { describe, expect, it } from "vitest";
import type { LlmBudgetStatus } from "@platform/contracts";
import { createTestApp, PLANNER, TENANT, submitQuery, waitForTask, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { HttpLlmBudget, NoopLlmBudget, type LlmBudgetPort } from "../src/ops/llm-budget.js";
import { llmBudgetEnforceEnabled } from "../src/router/orchestrator.js";

/**
 * OC7 / #92 SEAM · 「账本记得对，没人读」——给 `/a/v1/llm-budgets` 接上真消费方。
 *
 * 病灶：DataCore 三条路由（GET/PUT/record）状态机完整、`oc-platform-config.test.ts` 实测
 * OK → SOFT_EXCEEDED → HARD_EXCEEDED 全对，但全仓 `grep -rn "llm-budget"` 在
 * `apps/agentcore/src` 与 `apps/frontend-shell/src` **零命中**：没有任何调用方写它或读它。
 * 契约注释里写明的意图（软线→警示/跳过非必要 compose；硬线→拒）从未落地。
 * 三条路由还全是 `mustAdmin` —— 而天然写入方 AgentCore 拿的是服务间凭证，压根进不去。
 *
 * 接法（顺序刻意）：**记账无条件接**（先让账本有真数据），**执行才门控暗发**——反过来就是拿脏账拦人。
 */

const ENFORCE_ON = [...defaultOnKeys(), "qos.llm-budget-enforce"];

/** 可观测的假账本：记下每次记账，状态可编。 */
function fakeLedger(status?: LlmBudgetStatus): LlmBudgetPort & { records: { tenantId: string; tokens: number }[] } {
  const records: { tenantId: string; tokens: number }[] = [];
  return {
    records,
    stats: { recorded: 0, recordFailures: 0, statusFailures: 0 },
    async status() {
      return status;
    },
    async record(tenantId: string, tokens: number) {
      records.push({ tenantId, tokens });
    },
  };
}

const st = (over: Partial<LlmBudgetStatus>): LlmBudgetStatus => ({
  usedTokens: 0,
  hardLimitTokens: 1000,
  softLimitTokens: 800,
  state: "OK",
  degrade: false,
  ...over,
});

async function runOnce(t: TestApp) {
  t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
  t.llm.queueAgentTurn({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "答。" }], provenance: [] })] });
  const r = await submitQuery(t, PLANNER, "给我个自由结论", { view: "dash" });
  if (r.statusCode === 202) await waitForTask(t, r.taskId, (x) => x.status === "COMPLETED", 15000);
  return r;
}

describe("#92 SEAM · LLM token 配额账本终于有了真消费方", () => {
  it("① 记账无条件发生：一次 path-B 跑完，本次真实 token 用量进了账本（不受暗发门控）", async () => {
    const ledger = fakeLedger();
    const t: TestApp = await createTestApp({ llmBudget: ledger });
    const r = await runOnce(t);
    expect(r.statusCode).toBe(202);

    expect(ledger.records.length).toBe(1);
    expect(ledger.records[0]!.tenantId).toBe(TENANT);
    // 效果层：记的是**这次跑的真实用量**，不是常数——与 agentRuns 落库的累计值一致。
    const run = await t.repos.agentRuns.getByTask(r.taskId);
    const expected = (run?.totalInputTokens ?? 0) + (run?.totalOutputTokens ?? 0);
    expect(expected).toBeGreaterThan(0);
    expect(ledger.records[0]!.tokens).toBe(expected);
  });

  it("② 执行门关（缺省）：硬线早已耗尽也照常放行 —— 只记账不拦（既有行为字节不变）", async () => {
    const ledger = fakeLedger(st({ usedTokens: 99999, state: "HARD_EXCEEDED", degrade: true }));
    const t: TestApp = await createTestApp({ llmBudget: ledger });
    const r = await runOnce(t);
    expect(r.statusCode).toBe(202);
    expect(ledger.records.length).toBe(1); // 仍记账
  });

  it("③ 执行门开 + 硬线耗尽 → 429 LLM_BUDGET_EXCEEDED，且消息里带真实数字（可自证非编造）", async () => {
    const ledger = fakeLedger(st({ usedTokens: 1200, hardLimitTokens: 1000, state: "HARD_EXCEEDED", degrade: true }));
    const t: TestApp = await createTestApp({ llmBudget: ledger });
    t.deps.features.mock.set(TENANT, ENFORCE_ON);
    const r = await submitQuery(t, PLANNER, "给我个自由结论", { view: "dash" });
    expect(r.statusCode).toBe(429);
    const err = (r.body as { error?: { code?: string; message?: string } }).error;
    expect(err?.code).toBe("LLM_BUDGET_EXCEEDED");
    expect(err?.message).toContain("1200");
    expect(err?.message).toContain("1000");
    expect(ledger.records.length).toBe(0); // 拒在建任务前 → 没有跑，也就没有用量
  });

  it("④ 执行门开但软线（未过硬线）→ 不拦（软线是降级信号，不是闸门）", async () => {
    const ledger = fakeLedger(st({ usedTokens: 850, state: "SOFT_EXCEEDED", degrade: true }));
    const t: TestApp = await createTestApp({ llmBudget: ledger });
    t.deps.features.mock.set(TENANT, ENFORCE_ON);
    const r = await runOnce(t);
    expect(r.statusCode).toBe(202);
  });

  it("⑤ fail-open 铁律：账本不可用（status 返 undefined）时门开也不拦 —— 一次 DataCore 抖动不该让用户不能提问", async () => {
    const ledger = fakeLedger(undefined);
    const t: TestApp = await createTestApp({ llmBudget: ledger });
    t.deps.features.mock.set(TENANT, ENFORCE_ON);
    const r = await runOnce(t);
    expect(r.statusCode).toBe(202);
  });

  it("⑥ 门判据字节兼容：`ALL`（mock 默认 / entitlement fail-open）一律视为关", () => {
    expect(llmBudgetEnforceEnabled("ALL")).toBe(false);
    expect(llmBudgetEnforceEnabled(new Set(defaultOnKeys()))).toBe(false);
    expect(llmBudgetEnforceEnabled(new Set(ENFORCE_ON))).toBe(true);
  });

  it("⑦ HttpLlmBudget 走服务间凭证（X-Service-Token + X-Tenant-Id），且失败只计数不抛", async () => {
    const seen: { url: string; headers: Record<string, string>; body?: string }[] = [];
    let ok = true;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const h = new Headers(init?.headers ?? {});
      seen.push({
        url: String(url),
        headers: Object.fromEntries([...h.entries()]),
        ...(typeof init?.body === "string" ? { body: init.body } : {}),
      });
      if (!ok) return new Response("boom", { status: 500 });
      return new Response(JSON.stringify(st({ usedTokens: 5 })), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const b = new HttpLlmBudget({ baseUrl: "http://dc.test", serviceToken: "svc-secret", fetchImpl });
    const s1 = await b.status(TENANT);
    expect(s1?.usedTokens).toBe(5);
    expect(seen[0]!.headers["x-service-token"]).toBe("svc-secret");
    expect(seen[0]!.headers["x-tenant-id"]).toBe(TENANT);

    await b.record(TENANT, 42);
    expect(JSON.parse(seen[1]!.body!)).toEqual({ tokens: 42 });
    expect(b.stats.recorded).toBe(1);

    ok = false; // A 侧开始 500 —— 不得抛，只计数
    await expect(b.record(TENANT, 7)).resolves.toBeUndefined();
    expect(b.stats.recordFailures).toBe(1);
    expect(await b.status(TENANT)).toBeUndefined();
    expect(b.stats.statusFailures).toBe(1);
    await b.record(TENANT, 0); // 0 token 不发请求（不污染账本）
    expect(seen.length).toBe(4);
  });

  it("⑧ 未配服务间凭证 → Noop：不记不拦（部署没接 A 侧时既有行为字节不变）", async () => {
    const noop = new NoopLlmBudget();
    expect(await noop.status()).toBeUndefined();
    await expect(noop.record()).resolves.toBeUndefined();
    const t: TestApp = await createTestApp(); // 缺省即 Noop（测试无 DATACORE_BASE_URL/SERVICE_TOKEN）
    expect(t.deps.llmBudget).toBeInstanceOf(NoopLlmBudget);
    const r = await runOnce(t);
    expect(r.statusCode).toBe(202);
  });
});
