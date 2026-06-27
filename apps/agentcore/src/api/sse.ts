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
  // CORS（直连端口的开发调试·部署态经网关同源不受影响）：SSE 经 reply.hijack() 绕过 @fastify/cors
  // 的 onSend 钩子，须在此手动回声 Origin（与全局 cors origin:true 同义），否则跨源 EventSource 被浏览器
  // 拦截（net::ERR_FAILED）→ 对话坞收不到 answer.final → 永远「仍在执行」。反射 Origin + 允许凭据。
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    ...(origin
      ? { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", vary: "Origin" }
      : { "access-control-allow-origin": "*" }),
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
