/**
 * WO-OBSERVABILITY (OBS-2) · 全链 OTel span 树初始化（DataCore）。
 *
 * 在 requestId spine（WO-AUDIT-OBS）之上加分布式 trace——不替换现有关联层：
 *  - `requestId`（x-request-id 跨系统透传）继续做人读关联键，落日志/错误信封；
 *  - W3C `traceparent` 做机器读分布式 trace context，OTel 自动续 trace + 逐段时延。
 *  - 两者经传播桥接关联：入站 span 加 attribute `app.request_id` = 该请求 requestId。
 *
 * 诚实降级（铁律·R-诚实）：**未配 `OTEL_EXPORTER_OTLP_ENDPOINT` → 不导出**。
 *  此时不挂任何 SpanProcessor（NodeSDK 不接 exporter）——span 在进程内产生但不发往任何后端，
 *  既不假装导出、也不阻塞请求；服务照常 curl 通。配了 endpoint 才真起 OTLP/HTTP 导出。
 *
 * 该模块必须在 app 构建前 import（见 server.ts 第一行 import），使 auto-instrumentation
 * 在 http/fastify/pg 模块被 require 前完成 monkey-patch。import 即触发 start()（幂等）。
 */
import { context, propagation, trace, type Span, type Tracer } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ParentBasedSampler, TraceIdRatioBasedSampler, AlwaysOnSampler, type Sampler } from "@opentelemetry/sdk-trace-base";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

export const SERVICE_NAME = "datacore";

/** 服务名导出供 span attr / 测试断言。 */
const SERVICE_VERSION = process.env.npm_package_version ?? "0.1.0";

/** 取 OTLP endpoint（traces signal）。未配则 no-op（诚实不导出）。 */
function otlpEndpoint(): string | undefined {
  const v = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * 采样：dev `ParentBased(AlwaysOn)`（本地看全 trace）；生产取 env ratio（默认 1.0）。
 * 续 trace 时尊重父级采样决策（ParentBased），无父则按根采样器。
 */
function buildSampler(): Sampler {
  const isProd = (process.env.NODE_ENV ?? "development") === "production";
  if (!isProd) return new ParentBasedSampler({ root: new AlwaysOnSampler() });
  const ratioRaw = Number(process.env.OTEL_TRACES_SAMPLER_RATIO ?? "1");
  const ratio = Number.isFinite(ratioRaw) && ratioRaw >= 0 && ratioRaw <= 1 ? ratioRaw : 1;
  return new ParentBasedSampler({ root: ratio >= 1 ? new AlwaysOnSampler() : new TraceIdRatioBasedSampler(ratio) });
}

let sdk: NodeSDK | undefined;
let started = false;
/** 是否真接了 OTLP 导出（false = no-op 诚实降级）。供日志/测试判定。 */
let exporting = false;

/**
 * 起 OTel NodeSDK（幂等）。模块 import 时自动调用一次。
 * 返回 { started, exporting }：exporting=false 即 no-op 降级（未配 OTLP，不导出）。
 */
export function initTracing(): { started: boolean; exporting: boolean } {
  if (started) return { started, exporting };
  started = true;

  const endpoint = otlpEndpoint();
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: SERVICE_VERSION,
  });

  // 自动 instrument http/fastify/pg；关掉吵闹的 fs instrumentation。
  const instrumentations = getNodeAutoInstrumentations({
    "@opentelemetry/instrumentation-fs": { enabled: false },
  });

  if (endpoint) {
    // 真起 OTLP/HTTP traces 导出（NodeSDK 接 traceExporter → 自动 BatchSpanProcessor）。
    const traceExporter = new OTLPTraceExporter({ url: endpoint.replace(/\/$/, "") + "/v1/traces" });
    sdk = new NodeSDK({ resource, sampler: buildSampler(), traceExporter, instrumentations });
    exporting = true;
  } else {
    // 诚实降级：不接 exporter → 无 SpanProcessor 导出（span 在进程内产生但不发往后端，不假装）。
    sdk = new NodeSDK({ resource, sampler: buildSampler(), instrumentations });
    exporting = false;
  }
  sdk.start();
  return { started, exporting };
}

/** 关闭 SDK（flush 未导出 span），优雅停机调用。幂等。 */
export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    try {
      await sdk.shutdown();
    } catch {
      /* best-effort flush */
    }
  }
}

export function isExporting(): boolean {
  return exporting;
}

/** 本服务命名 tracer（业务自定义 span 用）。 */
export function getTracer(): Tracer {
  return trace.getTracer(SERVICE_NAME, SERVICE_VERSION);
}

/**
 * 在当前 active context 下开一个子 span 跑 fn，自动关 span / 记异常 / 设状态。
 * 自定义业务节点（solver invoke / outbox.emit / OBO 调用）用此包裹。
 * attr 约定（R2 / no-secrets-echo）：可带 tenantId / solverKey / dataMode 等业务键，
 * **禁带凭据明文**（token/apiKey/password/credential 等一律不进 attr）。
 */
export async function withSpan<T>(
  name: string,
  attrs: Record<string, string | number | boolean | undefined>,
  fn: (span: Span) => Promise<T> | T,
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(name, async (span) => {
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== undefined) span.setAttribute(k, v);
    }
    try {
      const r = await fn(span);
      span.setStatus({ code: 1 /* OK */ });
      return r;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: 2 /* ERROR */, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * 把 requestId（人读关联键）挂到当前 active span 的 attribute `app.request_id`，
 * 使日志里的 requestId 可在 trace 后端定位到 trace（traceId↔requestId 关联）。
 */
export function annotateRequestId(requestId: string | undefined): void {
  if (!requestId) return;
  const span = trace.getActiveSpan();
  if (span) span.setAttribute("app.request_id", requestId);
}

/**
 * 出站桥接：把当前 active context 的 W3C trace context 注入到 headers（traceparent/tracestate），
 * 使下游服务（DataCore→AgentCore 或反向）续同一 trace。与 x-request-id 双轨并存（不破 AUDIT-OBS）。
 */
export function injectTraceContext(headers: Record<string, string>): Record<string, string> {
  propagation.inject(context.active(), headers);
  return headers;
}

// 模块 import 即起 SDK（幂等）——必须先于 http/fastify/pg 被 require（见 server.ts 第一行 import "./tracing.js"）。
initTracing();
