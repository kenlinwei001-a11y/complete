import { describe, expect, it } from "vitest";
import { CircuitBreaker, isFallbackTriggering } from "../src/llm/breaker.js";

describe("执行语义 §5 — CircuitBreaker", () => {
  it("opens after >50% failures over ≥ minSamples within the window", () => {
    const b = new CircuitBreaker({ minSamples: 5, failureRateThreshold: 0.5 });
    // 4 failures, 1 success → 4/5 = 0.8 > 0.5, samples == 5 → OPEN
    expect(b.record(false)).toBe("CLOSED");
    expect(b.record(false)).toBe("CLOSED");
    expect(b.record(false)).toBe("CLOSED");
    expect(b.record(true)).toBe("CLOSED");
    expect(b.record(false)).toBe("OPEN");
    expect(b.canAttempt()).toBe(false); // open → block primary
  });

  it("does not open below minSamples even at 100% failure", () => {
    const b = new CircuitBreaker({ minSamples: 5 });
    b.record(false);
    b.record(false);
    expect(b.current).toBe("CLOSED");
    expect(b.canAttempt()).toBe(true);
  });

  it("half-opens after the cooldown and closes on a successful probe", () => {
    let t = 1_000;
    const b = new CircuitBreaker({ minSamples: 2, halfOpenAfterMs: 30_000, now: () => t });
    b.record(false);
    expect(b.record(false)).toBe("OPEN");
    expect(b.canAttempt()).toBe(false);
    t += 30_000; // cooldown elapses
    expect(b.canAttempt()).toBe(true); // single probe allowed
    expect(b.canAttempt()).toBe(false); // a probe is already in flight
    expect(b.record(true)).toBe("CLOSED"); // probe succeeded → closed
    expect(b.canAttempt()).toBe(true);
  });

  it("re-opens when the half-open probe fails", () => {
    let t = 0;
    const b = new CircuitBreaker({ minSamples: 2, halfOpenAfterMs: 10, now: () => t });
    b.record(false);
    b.record(false);
    t += 10;
    expect(b.canAttempt()).toBe(true);
    expect(b.record(false)).toBe("OPEN"); // probe failed → back to open
  });

  it("rolls failures out of the window", () => {
    let t = 0;
    const b = new CircuitBreaker({ minSamples: 3, windowMs: 1000, now: () => t });
    b.record(false);
    b.record(false);
    t += 2000; // old failures expire
    b.record(false); // only 1 sample in window now
    expect(b.current).toBe("CLOSED");
  });
});

describe("执行语义 §5 — isFallbackTriggering classification", () => {
  it("triggers on 5xx, 429, and connection/timeout errors", () => {
    expect(isFallbackTriggering({ status: 500 })).toBe(true);
    expect(isFallbackTriggering({ status: 503 })).toBe(true);
    expect(isFallbackTriggering({ status: 429 })).toBe(true);
    expect(isFallbackTriggering({ code: "ETIMEDOUT" })).toBe(true);
    expect(isFallbackTriggering({ message: "fetch failed: socket hang up" })).toBe(true);
  });

  it("does NOT trigger on 4xx param errors or content/parse rejections", () => {
    expect(isFallbackTriggering({ status: 400 })).toBe(false);
    expect(isFallbackTriggering({ status: 401 })).toBe(false);
    expect(isFallbackTriggering({ status: 422 })).toBe(false);
    const parseErr = new Error("bad json");
    parseErr.name = "ClassifierParseError";
    expect(isFallbackTriggering(parseErr)).toBe(false);
    expect(isFallbackTriggering(null)).toBe(false);
  });
});
