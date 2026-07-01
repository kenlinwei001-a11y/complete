import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, debugUser, ADMIN } from "./helpers.js";

/**
 * WO-ENTERPRISE-DR-AUDIT（sub-B·外部审计对接·SIEM sink）测试。
 *  - secret 加密不回显（R5·仅 credentialRef 存在标记）
 *  - flush 把 append-only audit_log 增量 NDJSON 推达 SIEM mock（actor+target+before/after+requestId 齐）
 *  - 投递失败旁路吞（不阻主写·恒 200·本地 audit_log 不受影响）
 *  - 游标 sinceAt 续投（重投不丢·单调前推）
 *  - 关 feature → 404 FEATURE_NOT_FOUND（R3 Entitlement 先于 authz）
 */

// 本地 SIEM 收集器 mock（记录收到的 NDJSON body）。
function makeSiem() {
  const received: Array<Record<string, unknown>> = [];
  let calls = 0;
  const fetchImpl: typeof fetch = (async (_url: string, init?: RequestInit) => {
    calls++;
    const body = String(init?.body ?? "");
    for (const line of body.split("\n")) {
      if (line.trim()) received.push(JSON.parse(line));
    }
    return { ok: true, status: 200, async text() { return ""; } } as unknown as Response;
  }) as unknown as typeof fetch;
  return { received, fetchImpl, get calls() { return calls; } };
}

async function enableSink(t: Awaited<ReturnType<typeof makeApp>>) {
  const r = await t.app.inject({
    method: "PUT",
    url: "/a/v1/tenants/demo/features",
    headers: ADMIN,
    payload: { overrides: { "audit-sink": true } },
  });
  expect(r.statusCode).toBe(200);
}

describe("WO-ENTERPRISE-DR-AUDIT · 外部审计 SIEM sink", () => {
  it("配 sink（secret 加密不回显·仅 credentialRef）→ 改 feature 落审计 → flush → SIEM 收到 NDJSON", async () => {
    const siem = makeSiem();
    const t = await makeApp({ fetchImpl: siem.fetchImpl });
    await seedBattery(t);
    await enableSink(t);

    // 配 webhook_ndjson sink（带 secret）。
    const put = await t.app.inject({
      method: "PUT",
      url: "/a/v1/audit-sinks",
      headers: ADMIN,
      payload: { kind: "webhook_ndjson", endpoint: "http://127.0.0.1:9099/ingest", secret: "s3cr3t-token" },
    });
    expect(put.statusCode).toBe(200);
    const sink = put.json() as Record<string, unknown>;
    // R5：绝不回显 secret 明文/密文——仅 credentialRef 存在标记。
    expect(sink.credentialRef).toBe("cred:configured");
    expect(JSON.stringify(sink)).not.toContain("s3cr3t-token");
    expect(JSON.stringify(sink)).not.toContain("enc:v1:");

    // 触发一次管理操作 → 落 append-only 审计（features.updated 带 actor+before/after+requestId）。
    const feat = await t.app.inject({
      method: "PUT",
      url: "/a/v1/tenants/demo/features",
      headers: { ...ADMIN, "x-request-id": "req-siem-001" },
      payload: { overrides: { "view.plan-audit": false } },
    });
    expect(feat.statusCode).toBe(200);

    // flush → SIEM mock 收到该审计事件。
    const flush = await t.app.inject({ method: "POST", url: "/a/v1/audit-sinks/flush", headers: ADMIN });
    expect(flush.statusCode).toBe(200);
    const res = flush.json() as { delivered: number; ok: boolean };
    expect(res.ok).toBe(true);
    expect(res.delivered).toBeGreaterThan(0);

    const entry = siem.received.find((e) => e.action === "features.updated");
    expect(entry).toBeTruthy();
    expect(entry!.actorId).toBe("admin");
    expect(entry!.targetKind).toBe("feature_config");
    expect(entry!.before).toBeTruthy();
    expect(entry!.after).toBeTruthy();
    expect(entry!.requestId).toBe("req-siem-001");
  });

  it("secret 不回显：GET /a/v1/audit-sinks 只见 credentialRef 标记（R5）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await enableSink(t);
    await t.app.inject({
      method: "PUT", url: "/a/v1/audit-sinks", headers: ADMIN,
      payload: { kind: "webhook_ndjson", endpoint: "http://127.0.0.1:9099/ingest", secret: "top-secret" },
    });
    const list = await t.app.inject({ method: "GET", url: "/a/v1/audit-sinks", headers: ADMIN });
    expect(list.statusCode).toBe(200);
    const body = list.json() as Array<Record<string, unknown>>;
    expect(body[0]!.credentialRef).toBe("cred:configured");
    expect(JSON.stringify(body)).not.toContain("top-secret");
    expect(JSON.stringify(body)).not.toContain("enc:v1:");
  });

  it("投递失败旁路吞：endpoint 不可达 → flush 恒 200(ok:false)·本地 audit_log 不受影响·游标不前推续投", async () => {
    let attempt = 0;
    const failThenOk: typeof fetch = (async (_url: string, init?: RequestInit) => {
      attempt++;
      if (attempt === 1) throw new Error("ECONNREFUSED"); // 首投不可达
      const body = String(init?.body ?? "");
      const lines = body.split("\n").filter((l) => l.trim());
      return { ok: true, status: 200, _lines: lines, async text() { return ""; } } as unknown as Response;
    }) as unknown as typeof fetch;
    const t = await makeApp({ fetchImpl: failThenOk });
    await seedBattery(t);
    await enableSink(t);
    await t.app.inject({
      method: "PUT", url: "/a/v1/audit-sinks", headers: ADMIN,
      payload: { kind: "webhook_ndjson", endpoint: "http://127.0.0.1:1/dead" },
    });
    await t.app.inject({
      method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
      payload: { overrides: { "view.plan-audit": false } },
    });

    // 首投失败 → 恒 200·ok:false·不抛（旁路不阻主写）。
    const f1 = await t.app.inject({ method: "POST", url: "/a/v1/audit-sinks/flush", headers: ADMIN });
    expect(f1.statusCode).toBe(200);
    expect((f1.json() as { ok: boolean }).ok).toBe(false);

    // 本地 audit_log 不受 SIEM 失败影响（append-only 仍全量可读）。
    const local = await t.app.inject({ method: "GET", url: "/a/v1/audit-log", headers: ADMIN });
    expect((local.json() as { total: number }).total).toBeGreaterThan(0);

    // 续投：游标未前推 → 二次 flush 成功把同批送达（重投不丢）。
    const f2 = await t.app.inject({ method: "POST", url: "/a/v1/audit-sinks/flush", headers: ADMIN });
    expect(f2.statusCode).toBe(200);
    expect((f2.json() as { ok: boolean; delivered: number }).ok).toBe(true);
    expect((f2.json() as { delivered: number }).delivered).toBeGreaterThan(0);
  });

  it("游标续投不重投旧条目：二次 flush 无新审计 → delivered 0", async () => {
    const siem = makeSiem();
    const t = await makeApp({ fetchImpl: siem.fetchImpl });
    await seedBattery(t);
    await enableSink(t);
    await t.app.inject({
      method: "PUT", url: "/a/v1/audit-sinks", headers: ADMIN,
      payload: { kind: "webhook_ndjson", endpoint: "http://127.0.0.1:9099/ingest" },
    });
    await t.app.inject({
      method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
      payload: { overrides: { "view.plan-audit": false } },
    });
    const f1 = await t.app.inject({ method: "POST", url: "/a/v1/audit-sinks/flush", headers: ADMIN });
    expect((f1.json() as { delivered: number }).delivered).toBeGreaterThan(0);
    // 无新审计 → 游标已前推 → 二次 delivered 0（不重投）。
    const f2 = await t.app.inject({ method: "POST", url: "/a/v1/audit-sinks/flush", headers: ADMIN });
    expect((f2.json() as { delivered: number }).delivered).toBe(0);
  });

  it("关 feature → 404 FEATURE_NOT_FOUND（R3 Entitlement 先于 authz）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 用无 industry 模板的裸租户（平台默认 audit-sink defaultOn:false → 关=不存在）。
    // battery demo 租户 L2=ALL_FEATURE_KEYS 会把 audit-sink 一并开启，故此处显式换裸租户验"关"。
    const FRESH = debugUser("fresh_no_tmpl", "padmin", "admin");
    const put = await t.app.inject({
      method: "PUT", url: "/a/v1/audit-sinks", headers: FRESH,
      payload: { kind: "webhook_ndjson", endpoint: "http://127.0.0.1:9099/ingest" },
    });
    expect(put.statusCode).toBe(404);
    expect((put.json() as { error: { code: string } }).error.code).toBe("FEATURE_NOT_FOUND");
    const get = await t.app.inject({ method: "GET", url: "/a/v1/audit-sinks", headers: FRESH });
    expect(get.statusCode).toBe(404);
    const flush = await t.app.inject({ method: "POST", url: "/a/v1/audit-sinks/flush", headers: FRESH });
    expect(flush.statusCode).toBe(404);
  });

  it("R2 租户隔离：审计外送仅本租户 audit_log（跨租户不外送）", async () => {
    const siem = makeSiem();
    const t = await makeApp({ fetchImpl: siem.fetchImpl });
    await seedBattery(t);
    await enableSink(t);
    // 另一租户 platform_admin 需先开该租户 feature；此处只验 demo sink 只送 demo 条目。
    await t.app.inject({
      method: "PUT", url: "/a/v1/audit-sinks", headers: ADMIN,
      payload: { kind: "webhook_ndjson", endpoint: "http://127.0.0.1:9099/ingest" },
    });
    await t.app.inject({
      method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
      payload: { overrides: { "view.risk-board": false } },
    });
    await t.app.inject({ method: "POST", url: "/a/v1/audit-sinks/flush", headers: ADMIN });
    expect(siem.received.every((e) => e.tenantId === "demo")).toBe(true);
  });
});
