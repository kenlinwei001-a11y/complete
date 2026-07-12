import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";

/**
 * WO-AUDIT-CURSOR-TIEBREAK · 复合游标 (at,id) 修同毫秒边界丢审计（append-only 承诺「不丢」的真落实）。
 * 旧实现游标只存 `at` + 过滤 `at > sinceAt`：与游标同一毫秒的后续审计被静默排除 → SIEM 丢条目
 * （高写入率下同毫秒常见）。这也是全测偶发 flake（audit-sink 首投 delivered 0）的根。
 */

function makeSiem() {
  const received: Array<Record<string, unknown>> = [];
  const fetchImpl = (async (_url: string, init?: { body?: unknown }) => {
    for (const line of String(init?.body ?? "").split("\n")) if (line.trim()) received.push(JSON.parse(line));
    return { ok: true, status: 200, async text() { return ""; } };
  }) as unknown as typeof fetch;
  return { received, fetchImpl };
}

async function activeSink(t: Awaited<ReturnType<typeof makeApp>>) {
  await t.app.inject({ method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN, payload: { overrides: { "audit-sink": true } } });
  await t.app.inject({ method: "PUT", url: "/a/v1/audit-sinks", headers: ADMIN, payload: { kind: "webhook_ndjson", endpoint: "http://127.0.0.1:9099/ingest" } });
}

const putAudit = (t: Awaited<ReturnType<typeof makeApp>>, id: string, at: string) =>
  t.repos.auditLog.put({ id, tenantId: "demo", actorId: "u", action: "test.evt", targetKind: "T", targetId: "x", at });

const flush = async (t: Awaited<ReturnType<typeof makeApp>>) =>
  (await (await t.app.inject({ method: "POST", url: "/a/v1/audit-sinks/flush", headers: ADMIN })).json()) as { delivered: number };

describe("WO-AUDIT-CURSOR-TIEBREAK · 同毫秒边界不丢", () => {
  it("游标推进到同 at 的某 id 后，同 at 的更大 id 仍被投递（旧 `at>sinceAt` 会丢·red-bite）", async () => {
    const t = await makeApp({ fetchImpl: makeSiem().fetchImpl });
    await seedBattery(t);
    await activeSink(t);
    const AT = "2035-06-01T00:00:00.000Z"; // 远未来·稳过 sink 创建游标
    await putAudit(t, "aud_1", AT);
    const f1 = await flush(t);
    expect(f1.delivered).toBeGreaterThan(0); // 投 aud_1（+可能 seed/feature 审计）·游标→(AT,aud_1)
    // 关键：同一毫秒 AT 追加更大 id → 复合游标仍投；旧实现 at>AT=false 会静默丢。
    await putAudit(t, "aud_2", AT);
    const f2 = await flush(t);
    expect(f2.delivered).toBe(1); // aud_2 被投递（不丢）
    // 无新条目 → 游标已到 (AT,aud_2) → 不重投。
    const f3 = await flush(t);
    expect(f3.delivered).toBe(0);
  });

  it("同 at 多条一次性全投·不重投（复合游标单调·R6 幂等）", async () => {
    const t = await makeApp({ fetchImpl: makeSiem().fetchImpl });
    await seedBattery(t);
    await activeSink(t);
    const AT = "2035-07-01T00:00:00.000Z";
    // 先把历史游标推过 AT 之前的一切
    await flush(t);
    await putAudit(t, "aud_a", AT);
    await putAudit(t, "aud_b", AT);
    await putAudit(t, "aud_c", AT);
    expect((await flush(t)).delivered).toBe(3); // 同 at 三条全投
    expect((await flush(t)).delivered).toBe(0); // 不重投
  });
});
