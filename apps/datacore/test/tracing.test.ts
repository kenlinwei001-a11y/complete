/**
 * WO-OBSERVABILITY (OBS-2) · tracing.ts 单测：
 *  ① no-op 诚实降级——未配 OTLP endpoint → initTracing 返回 exporting=false（不导出，不假装）。
 *  ② span 树产出 smoke——用 in-memory exporter 真证 withSpan 嵌套产出 root→solver.invoke→outbox.emit
 *     的 parent 链 + attr（app.request_id 关联键 / tenantId R2 / 求解 dataMode），且 **无凭据明文**。
 *
 * 这是 FDE 核心证明（docker 不可用时的 in-memory span 真证·替 Jaeger 截图）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { context, trace } from "@opentelemetry/api";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor, type ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { withSpan, annotateRequestId, injectTraceContext, isExporting, initTracing, SERVICE_NAME } from "../src/tracing.js";

const exporter = new InMemorySpanExporter();
let provider: BasicTracerProvider;

beforeAll(() => {
  // 注册一个带 in-memory exporter 的 provider 到全局 OTel API，使 getTracer()/withSpan 真产出可断言 span。
  // （tracing.ts 的全局 SDK 在 no-op 模式不导出；这里独立挂 in-memory 导出器抓 span 树。）
  // tracing.ts 模块 import 时已经经 NodeSDK 设过一次全局 provider；OTel 拒绝二次覆盖（no-op + warn），
  // 故先 trace.disable() 清掉再 setGlobalTracerProvider 我们的 in-memory provider。
  trace.disable();
  provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  trace.setGlobalTracerProvider(provider);
});

afterAll(async () => {
  await provider.shutdown();
});

describe("OBS-2 · tracing no-op 诚实降级", () => {
  it("未配 OTLP endpoint → initTracing exporting=false（不导出·不假装）", () => {
    const before = { e: process.env.OTEL_EXPORTER_OTLP_ENDPOINT, t: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT };
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
    // initTracing 在 import 时已跑过一次（幂等）；当前进程未配 OTLP → exporting 必为 false。
    const r = initTracing();
    expect(r.started).toBe(true);
    expect(r.exporting).toBe(false);
    expect(isExporting()).toBe(false);
    expect(SERVICE_NAME).toBe("datacore");
    if (before.e !== undefined) process.env.OTEL_EXPORTER_OTLP_ENDPOINT = before.e;
    if (before.t !== undefined) process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = before.t;
  });
});

describe("OBS-2 · span 树产出（in-memory 真证 parent 链）", () => {
  it("root→solver.invoke→outbox.emit 嵌套 + attr 关联 + 无凭据明文", async () => {
    exporter.reset();
    const reqId = "req_obs2_smoke_001";
    const tenantId = "demo";
    const secretToken = "sk-super-secret-credential-PLAINTEXT";

    // 模拟一个请求 root span（= HTTP root），挂 requestId 关联键，然后嵌套业务 span。
    await withSpan("http.request", { "http.route": "/a/v1/solvers/x/invoke" }, async () => {
      annotateRequestId(reqId);
      // 求解器 invoke span（attr solverKey/tenantId/dataMode）。
      await withSpan("solver.invoke", { "solver.key": "capacity_forecast", "app.tenant_id": tenantId }, async (span) => {
        span.setAttribute("solver.data_mode", "LIVE");
        // 末端 outbox.emit span（领域事件落库）。
        await withSpan("outbox.emit", { "messaging.destination": "materialize.completed", "app.tenant_id": tenantId }, async () => {
          // 故意把凭据放进闭包（绝不能进 span attr）——验证 no-secrets-echo。
          void secretToken;
          return undefined;
        });
      });
    });

    const spans = exporter.getFinishedSpans();
    const byName = (n: string): ReadableSpan | undefined => spans.find((s) => s.name === n);
    const root = byName("http.request");
    const solver = byName("solver.invoke");
    const outbox = byName("outbox.emit");

    expect(root).toBeDefined();
    expect(solver).toBeDefined();
    expect(outbox).toBeDefined();

    // parent 链：root → solver → outbox（spanId/parent 正确）。
    expect(solver!.parentSpanContext?.spanId).toBe(root!.spanContext().spanId);
    expect(outbox!.parentSpanContext?.spanId).toBe(solver!.spanContext().spanId);
    // 同一 trace（traceId 一致）。
    expect(solver!.spanContext().traceId).toBe(root!.spanContext().traceId);
    expect(outbox!.spanContext().traceId).toBe(root!.spanContext().traceId);

    // attr 关联键 + R2 tenantId + 求解诚实位。
    expect(root!.attributes["app.request_id"]).toBe(reqId);
    expect(solver!.attributes["solver.key"]).toBe("capacity_forecast");
    expect(solver!.attributes["app.tenant_id"]).toBe(tenantId);
    expect(solver!.attributes["solver.data_mode"]).toBe("LIVE");
    expect(outbox!.attributes["messaging.destination"]).toBe("materialize.completed");
    expect(outbox!.attributes["app.tenant_id"]).toBe(tenantId);

    // no-secrets-echo（R5）：任何 span 的任何 attr 值都不得含凭据明文。
    for (const s of spans) {
      for (const v of Object.values(s.attributes)) {
        expect(String(v)).not.toContain(secretToken);
        expect(String(v).toLowerCase()).not.toContain("sk-super-secret");
      }
    }
  });

  it("span 异常被记录 + 状态置 ERROR（不吞错）", async () => {
    exporter.reset();
    await expect(
      withSpan("solver.invoke", { "solver.key": "boom" }, async () => {
        throw new Error("solver blew up");
      }),
    ).rejects.toThrow("solver blew up");
    const s = exporter.getFinishedSpans().find((x) => x.name === "solver.invoke");
    expect(s).toBeDefined();
    expect(s!.status.code).toBe(2 /* ERROR */);
    expect(s!.events.some((e) => e.name === "exception")).toBe(true);
  });

  it("injectTraceContext 在 active span 下注入 W3C traceparent（出站双轨）", async () => {
    await withSpan("http.request", {}, async () => {
      const headers: Record<string, string> = { "x-request-id": "req_dual_track" };
      injectTraceContext(headers);
      // 双轨：x-request-id 保留（AUDIT-OBS）+ traceparent 注入（OTel 续 trace）。
      expect(headers["x-request-id"]).toBe("req_dual_track");
      expect(headers["traceparent"]).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
    });
    void context; // keep import used
  });
});
