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

  it("RATE_LIMITED: >3 executing tasks per user → 429", async () => {
    // three tasks stuck awaiting clarification (active)
    for (let i = 0; i < 3; i++) {
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
});
