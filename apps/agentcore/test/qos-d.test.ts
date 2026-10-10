import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, PLANNER, submitQuery, waitForTask, type TestApp } from "./helpers.js";

const CZ = { objectType: "Base", objectId: "base_changzhou", label: "常州" };

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.app.close();
});

interface SseEvent {
  id: number;
  event: string;
  data: unknown;
}

async function readSse(url: string, headers: Record<string, string>, stopAt?: number): Promise<SseEvent[]> {
  const controller = new AbortController();
  const res = await fetch(url, { headers, signal: controller.signal });
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const events: SseEvent[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (frame.startsWith(":")) continue;
        let id = 0;
        let event = "";
        let data = "";
        for (const line of frame.split("\n")) {
          if (line.startsWith("id: ")) id = Number(line.slice(4));
          else if (line.startsWith("event: ")) event = line.slice(7);
          else if (line.startsWith("data: ")) data = line.slice(6);
        }
        if (event) events.push({ id, event, data: data ? JSON.parse(data) : null });
        if (event === "answer.final" || event === "task.failed" || event === "task.cancelled") {
          controller.abort();
          return events;
        }
        if (stopAt !== undefined && events.length >= stopAt) {
          controller.abort();
          return events;
        }
      }
    }
  } catch (err) {
    if ((err as Error).name !== "AbortError") throw err;
  }
  return events;
}

describe("SSE replay & idempotency (§12 D1–D2)", () => {
  it("D1: Last-Event-ID replay — no duplicates, no loss, ends with answer.final", async () => {
    await t.app.listen({ port: 0, host: "127.0.0.1" });
    const address = t.app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    t.llm.queueClassification({
      candidates: [{ intentKey: "affected_orders", confidence: 0.95 }],
      outOfCatalog: false,
      extractedSlots: {},
    });
    const { taskId } = await submitQuery(t, PLANNER, "影响哪些订单？", { view: "risk", selectedObjects: [CZ] });
    await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    const url = `http://127.0.0.1:${port}/api/v1/queries/${taskId}/events`;
    const headers = { "x-debug-user": encodeURIComponent(PLANNER) };

    // first connection: read only the first 2 events, then "disconnect"
    const first = await readSse(url, headers, 2);
    expect(first.length).toBe(2);
    expect(first[0]?.event).toBe("task.accepted");
    const lastId = first[first.length - 1]?.id as number;

    // reconnect with Last-Event-ID → replay continues from the next seq
    const second = await readSse(url, { ...headers, "last-event-id": String(lastId) });
    expect(second[0]?.id).toBe(lastId + 1);
    expect(second[second.length - 1]?.event).toBe("answer.final");

    // union: monotonic ids, no dup / no loss
    const all = [...first, ...second].map((e) => e.id);
    for (let i = 1; i < all.length; i++) expect(all[i]).toBe((all[i - 1] as number) + 1);

    const everything = await readSse(url, headers);
    expect(everything.map((e) => e.id)).toEqual(all);
  });

  it("D2: same Idempotency-Key returns the same task", async () => {
    t.llm.queueClassification({
      candidates: [{ intentKey: "affected_orders", confidence: 0.95 }],
      outOfCatalog: false,
      extractedSlots: {},
    });
    const a = await submitQuery(t, PLANNER, "影响哪些订单？", { view: "risk", selectedObjects: [CZ] }, {
      "idempotency-key": "idem-001",
    });
    expect(a.statusCode).toBe(202);
    await waitForTask(t, a.taskId, (x) => x.status === "COMPLETED");
    const b = await submitQuery(t, PLANNER, "影响哪些订单？", { view: "risk", selectedObjects: [CZ] }, {
      "idempotency-key": "idem-001",
    });
    expect(b.taskId).toBe(a.taskId);
    expect(t.llm.classifyRequests.length).toBe(1); // pipeline only ran once
  });

  it("RATE_LIMITED: >10 executing tasks per user → 429", async () => {
    // ten tasks stuck awaiting clarification (active) → the 11th trips the per-user cap
    for (let i = 0; i < 10; i++) {
      t.llm.queueClassification({
        candidates: [{ intentKey: "affected_orders", confidence: 0.95 }],
        outOfCatalog: false,
        extractedSlots: {},
      });
      const { taskId } = await submitQuery(t, PLANNER, `影响哪些订单 ${i}？`, { view: "risk", selectedObjects: [] });
      await waitForTask(t, taskId, (x) => x.status === "AWAITING_CLARIFICATION");
    }
    const res = await submitQuery(t, PLANNER, "再来一个", { view: "risk", selectedObjects: [CZ] });
    expect(res.statusCode).toBe(429);
    expect((res.body as { error?: { code?: string } }).error?.code).toBe("RATE_LIMITED");
  });

  /**
   * 接缝：CORS 策略（`server.ts` 的 cors 注册处） × SSE 帧下发路径（`api/sse.ts` 的 hijack + raw.writeHead）。
   *
   * 病灶：`hijack()` 之后 Fastify 不再替本回复发响应，`reply.header()` 排入的头（CORS 头就是这一类）
   * 不会自己落到线路上 —— 而普通路由走正常回复生命周期、头照常下发。**同一份策略、两条路两种结果**，
   * 跨源 EventSource 因此被浏览器拦下（readyState=2 / 0 消息），普通 fetch 却 200。
   *
   * 本条咬的**不是**「有没有头」，是「**SSE 那条路的头与普通路由逐字段同源**」——
   * 故必须成对断言：对照臂用同一实例上的普通路由，缺它则「把 CORS 全关了」也能绿。
   */
  it("CORS × SSE 接缝：/events 与普通路由下发同一份 CORS 头，且不带 Origin 时不凭空放宽", async () => {
    await t.app.listen({ port: 0, host: "127.0.0.1" });
    const address = t.app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const base = `http://127.0.0.1:${port}`;
    const origin = "http://127.0.0.1:5273";
    const headers = { "x-debug-user": encodeURIComponent(PLANNER) };

    t.llm.queueClassification({
      candidates: [{ intentKey: "affected_orders", confidence: 0.95 }],
      outOfCatalog: false,
      extractedSlots: {},
    });
    const { taskId } = await submitQuery(t, PLANNER, "影响哪些订单？", { view: "risk", selectedObjects: [CZ] });
    await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    // 对照臂：同一实例上的普通路由（策略的既有行为，取自 cors 注册处，不另立判据）
    const plain = await fetch(`${base}/api/v1/queries`, { headers: { ...headers, origin } });
    const expectedOrigin = plain.headers.get("access-control-allow-origin");
    expect(expectedOrigin).toBe(origin); // 既有策略是反射 Origin（origin:true），不是 ``*``
    expect(plain.headers.get("access-control-allow-credentials")).toBe("true");

    // 被测臂：SSE（任务已终态 ⇒ 回放完即关流，fetch 会正常结束）
    const sse = await fetch(`${base}/api/v1/queries/${taskId}/events`, { headers: { ...headers, origin } });
    expect(sse.status).toBe(200);
    expect(sse.headers.get("content-type")).toContain("text/event-stream");
    expect(sse.headers.get("access-control-allow-origin")).toBe(expectedOrigin);
    expect(sse.headers.get("access-control-allow-credentials")).toBe(plain.headers.get("access-control-allow-credentials"));
    await sse.body?.cancel();

    // 金丝雀（负向）：不带 Origin ⇒ 照常 200，且**不得**凭空造出 ACAO —— 证明修的是「转运已有头」而非「一律加宽」
    const bare = await fetch(`${base}/api/v1/queries/${taskId}/events`, { headers });
    expect(bare.status).toBe(200);
    expect(bare.headers.get("access-control-allow-origin")).toBeNull();
    await bare.body?.cancel();
  });
});
