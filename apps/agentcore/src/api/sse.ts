import type { FastifyReply, FastifyRequest } from "fastify";
import { TaskEvents, TERMINAL_EVENTS } from "../events.js";
import type { QueryEventRow } from "../persistence/repos.js";

const HEARTBEAT_MS = 15_000;

/**
 * SSE stream (QOS-PRD §8.2): heartbeat comment every 15s, Last-Event-ID replay from
 * query_events then live, monotonic ids, stream closed after a terminal event.
 */
export async function streamTaskEvents(
  req: FastifyRequest,
  reply: FastifyReply,
  events: TaskEvents,
  taskId: string,
): Promise<void> {
  const lastEventIdHeader = req.headers["last-event-id"];
  const fromQuery = (req.query as Record<string, string | undefined>)?.lastEventId;
  const lastSeq = Number(
    (typeof lastEventIdHeader === "string" ? lastEventIdHeader : undefined) ?? fromQuery ?? "0",
  );
  const afterSeq = Number.isFinite(lastSeq) ? lastSeq : 0;

  reply.hijack();
  // `hijack()` 之后 Fastify 不再替本回复发响应，凡经 `reply.header()` 排入的响应头
  // （CORS 头就是这一类）都不会自己落到线路上 —— 必须显式带进 writeHead，否则
  // 跨源 EventSource 因缺 Access-Control-Allow-Origin 被浏览器拦成 readyState=2/0 消息，
  // 而同主机的普通 fetch 走正常回复生命周期、头照常下发 —— 同一策略两套结果。
  // 故此处**不自建**任何 CORS 判据，只把 Fastify 已累积的头原样转运，策略仍单源在 cors 注册处。
  const carried: Record<string, string | number | string[]> = {};
  for (const [k, v] of Object.entries(reply.getHeaders())) {
    if (v !== undefined) carried[k] = v;
  }
  reply.raw.writeHead(200, {
    ...carried,
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  reply.raw.write(":ok\n\n");

  let lastSent = afterSeq;
  let closed = false;

  const writeEvent = (row: QueryEventRow): boolean => {
    if (closed || row.seq <= lastSent) return false;
    lastSent = row.seq;
    reply.raw.write(`id: ${row.seq}\nevent: ${row.event}\ndata: ${JSON.stringify(row.payload ?? null)}\n\n`);
    return TERMINAL_EVENTS.has(row.event);
  };

  const heartbeat = setInterval(() => {
    if (!closed) reply.raw.write(":hb\n\n");
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    reply.raw.end();
  };

  // Subscribe FIRST (buffer live events), then replay history, then flush the buffer.
  const buffer: QueryEventRow[] = [];
  let live = false;
  const unsubscribe = events.subscribe(taskId, (row) => {
    if (!live) {
      buffer.push(row);
      return;
    }
    if (writeEvent(row)) close();
  });

  req.raw.on("close", close);

  const history = await events.replayAfter(taskId, afterSeq);
  let terminal = false;
  for (const row of history) {
    if (writeEvent(row)) terminal = true;
  }
  for (const row of buffer) {
    if (writeEvent(row)) terminal = true;
  }
  live = true;
  if (terminal) close();
}
