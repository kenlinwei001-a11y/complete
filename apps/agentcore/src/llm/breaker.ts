/**
 * 执行语义 §5：LLM Provider 故障切换 + 熔断。
 *
 * - **触发 fallback/熔断计数的失败**（仅这些）：连接超时 / 5xx / 429（SDK 重试耗尽后）/
 *   provider 显式 DISABLED；
 * - **不触发**：4xx 参数错误（换厂商无意义）、内容审查/解析拒绝（保留原语义返回）；
 * - **熔断**：滚动 1 分钟窗口失败率 >50% 且样本 ≥5 → OPEN（直接走 fallback）；
 *   30s 后半开放 1 个探测请求，成功 → CLOSED，失败 → 继续 OPEN。
 */

export type BreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface BreakerOptions {
  windowMs?: number;
  failureRateThreshold?: number;
  minSamples?: number;
  halfOpenAfterMs?: number;
  now?: () => number;
}

export class CircuitBreaker {
  private events: { at: number; ok: boolean }[] = [];
  private state: BreakerState = "CLOSED";
  private openedAt = 0;
  private probing = false;

  private readonly windowMs: number;
  private readonly threshold: number;
  private readonly minSamples: number;
  private readonly halfOpenAfterMs: number;
  private readonly now: () => number;

  constructor(opts: BreakerOptions = {}) {
    this.windowMs = opts.windowMs ?? 60_000;
    this.threshold = opts.failureRateThreshold ?? 0.5;
    this.minSamples = opts.minSamples ?? 5;
    this.halfOpenAfterMs = opts.halfOpenAfterMs ?? 30_000;
    this.now = opts.now ?? (() => Date.now());
  }

  get current(): BreakerState {
    return this.state;
  }

  /** Whether a request to the primary may proceed (true also for the single half-open probe). */
  canAttempt(): boolean {
    if (this.state === "OPEN") {
      if (!this.probing && this.now() - this.openedAt >= this.halfOpenAfterMs) {
        this.state = "HALF_OPEN";
        this.probing = true;
        return true; // allow exactly one probe
      }
      return false;
    }
    if (this.state === "HALF_OPEN") return false; // a probe is already in flight
    return true; // CLOSED
  }

  /** Record an attempt outcome (only fallback-triggering failures pass ok=false). */
  record(ok: boolean): BreakerState {
    const t = this.now();
    if (this.state === "HALF_OPEN") {
      this.probing = false;
      if (ok) {
        this.state = "CLOSED";
        this.events = [];
      } else {
        this.state = "OPEN";
        this.openedAt = t;
      }
      return this.state;
    }
    this.events.push({ at: t, ok });
    const cutoff = t - this.windowMs;
    this.events = this.events.filter((e) => e.at >= cutoff);
    const samples = this.events.length;
    const failures = this.events.filter((e) => !e.ok).length;
    if (samples >= this.minSamples && failures / samples > this.threshold) {
      this.state = "OPEN";
      this.openedAt = t;
    }
    return this.state;
  }
}

/**
 * §5: classify whether an error should trigger fallback + count toward the breaker.
 * 4xx (non-429) and content/parse rejections must NOT.
 */
export function isFallbackTriggering(err: unknown): boolean {
  if (err == null) return false;
  const e = err as { status?: unknown; statusCode?: unknown; name?: unknown; code?: unknown; message?: unknown };
  // Explicit non-triggering: classifier/content parse rejections keep original semantics.
  if (typeof e.name === "string" && /ClassifierParseError|ContentModeration|moderation/i.test(e.name)) {
    return false;
  }
  const status = typeof e.status === "number" ? e.status : typeof e.statusCode === "number" ? e.statusCode : undefined;
  if (typeof status === "number") {
    if (status === 429) return true; // rate limited (SDK retries already exhausted)
    if (status >= 500) return true; // server error
    return false; // other 4xx: request is the problem, switching provider won't help
  }
  // No status → treat connection/timeout class errors as triggering.
  const code = typeof e.code === "string" ? e.code : "";
  const msg = typeof e.message === "string" ? e.message : "";
  if (/ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|EPIPE/i.test(code)) return true;
  if (/timeout|timed out|socket hang up|network|fetch failed|disabled/i.test(msg)) return true;
  return false;
}
