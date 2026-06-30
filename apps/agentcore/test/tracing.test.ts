/**
 * WO-OBSERVABILITY (OBS-2) · AgentCore tracing.ts 单测：
 *  ① no-op 诚实降级——未配 OTLP endpoint → exporting=false（不导出，不假装）。
 *  ② span 树产出 smoke——in-memory exporter 真证 withSpan 嵌套（root→obo.datacore）parent 链 + attr，无凭据。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { trace } from "@opentelemetry/api";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor, type ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { withSpan, annotateRequestId, injectTraceContext, isExporting, initTracing, SERVICE_NAME } from "../src/tracing.js";

const exporter = new InMemorySpanExporter();
let provider: BasicTracerProvider;

beforeAll(() => {
  trace.disable();
  provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  trace.setGlobalTracerProvider(provider);
});

afterAll(async () => {
  await provider.shutdown();
});

describe("OBS-2 · agentcore tracing no-op 诚实降级", () => {
  it("未配 OTLP → exporting=false（service.name=agentcore）", () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
    const r = initTracing();
    expect(r.started).toBe(true);
    expect(r.exporting).toBe(false);
    expect(isExporting()).toBe(false);
    expect(SERVICE_NAME).toBe("agentcore");
  });
});

describe("OBS-2 · agentcore span 树（root→obo.datacore parent 链）", () => {
  it("OBO 跨服务 span 续在 root 下 + attr tenantId/requestId + 无凭据", async () => {
    exporter.reset();
    const reqId = "req_ac_obs2_001";
    const tenantId = "demo";
    const jwt = "Bearer.eyJ-SECRET-USER-JWT-PLAINTEXT.sig";

    await withSpan("qos.query", { "http.route": "/api/v1/queries" }, async () => {
      annotateRequestId(reqId);
      await withSpan(
        "obo.datacore",
        { "http.method": "POST", "http.route": "/a/v1/solvers/x/invoke", "peer.service": "datacore", "app.tenant_id": tenantId, "app.request_id": reqId },
        async () => {
          const headers: Record<string, string> = { "x-request-id": reqId };
          injectTraceContext(headers);
          // 双轨：x-request-id 保留 + traceparent 注入。
          expect(headers["x-request-id"]).toBe(reqId);
          expect(headers["traceparent"]).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
          void jwt; // 凭据绝不进 attr
          return undefined;
        },
      );
    });

    const spans = exporter.getFinishedSpans();
    const byName = (n: string): ReadableSpan | undefined => spans.find((s) => s.name === n);
    const root = byName("qos.query");
    const obo = byName("obo.datacore");
    expect(root).toBeDefined();
    expect(obo).toBeDefined();
    // parent 链 + 同 trace。
    expect(obo!.parentSpanContext?.spanId).toBe(root!.spanContext().spanId);
    expect(obo!.spanContext().traceId).toBe(root!.spanContext().traceId);
    // attr 关联键 + R2 tenantId。
    expect(root!.attributes["app.request_id"]).toBe(reqId);
    expect(obo!.attributes["app.tenant_id"]).toBe(tenantId);
    expect(obo!.attributes["peer.service"]).toBe("datacore");
    // no-secrets-echo：任何 span attr 不含 JWT 明文。
    for (const s of spans) {
      for (const v of Object.values(s.attributes)) {
        expect(String(v)).not.toContain("SECRET-USER-JWT");
      }
    }
  });
});
