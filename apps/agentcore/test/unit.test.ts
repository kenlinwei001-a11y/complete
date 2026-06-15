import { describe, expect, it } from "vitest";
import { resolvePath } from "../src/util/jsonpath.js";
import { resolveTemplate, TemplateResolutionError, collectSlotRefs } from "../src/util/template.js";
import { hasUnverifiedNumerics } from "../src/util/numerics.js";
import { redact } from "../src/util/redact.js";
import { encryptSecret, decryptSecret } from "../src/crypto.js";
import { prngFor } from "../src/mocks/prng.js";
import { validatePlanSteps } from "../src/workflow/validate.js";
import { normalizeQuery } from "../src/router/orchestrator.js";

describe("resolvePath (JSONPath-lite)", () => {
  const root = { a: { b: [{ c: 1 }, { c: 2 }] }, 中文: "ok" };
  it("supports $ .field [n]", () => {
    expect(resolvePath(root, "$.a.b[1].c")).toBe(2);
    expect(resolvePath(root, "$.a.b[0]")).toEqual({ c: 1 });
    expect(resolvePath(root, "$.中文")).toBe("ok");
  });
  it("returns undefined for malformed paths / null traversal", () => {
    expect(resolvePath(root, "$.a.x.y")).toBeUndefined();
    expect(resolvePath(root, "$..a")).toBeUndefined();
    expect(resolvePath(root, "$.a.b[*]")).toBeUndefined();
    expect(resolvePath(null, "$.a")).toBeUndefined();
  });
});

describe("template resolution", () => {
  const scope = {
    slots: { base: { objectId: "b1" }, timeWindow: null },
    context: { view: "risk" },
    steps: { s1: { data: { count: 3 } } },
  };
  it("resolves exact and embedded refs", () => {
    expect(resolveTemplate("{{slots.base.objectId}}", scope)).toBe("b1");
    expect(resolveTemplate("共 {{steps.s1.output.data.count}} 张", scope)).toBe("共 3 张");
    expect(resolveTemplate({ x: "{{context.view}}" }, scope)).toEqual({ x: "risk" });
  });
  it("null optional slot resolves to null", () => {
    expect(resolveTemplate("{{slots.timeWindow}}", scope)).toBeNull();
  });
  it("throws TemplateResolutionError on unresolvable refs", () => {
    expect(() => resolveTemplate("{{slots.nope}}", scope)).toThrow(TemplateResolutionError);
    expect(() => resolveTemplate("{{steps.zz.output.x}}", scope)).toThrow(TemplateResolutionError);
  });
  it("collects slot refs", () => {
    expect([...collectSlotRefs({ a: "{{slots.base.objectId}}", b: ["{{slots.weeks}}"] })]).toEqual([
      "base",
      "weeks",
    ]);
  });
});

describe("numeric provenance scan (§5.5)", () => {
  it("flags bare business numbers", () => {
    expect(hasUnverifiedNumerics("产能缺口约 1200 套。")).toBe(true);
    expect(hasUnverifiedNumerics("利用率 81.9%。")).toBe(true);
  });
  it("does not flag sentences carrying ⟦ref⟧ marks", () => {
    expect(hasUnverifiedNumerics("利用率 81.9% ⟦ref:0⟧。")).toBe(false);
    expect(hasUnverifiedNumerics("缺口 3 套 ⟦ref:1⟧。无数字句子。")).toBe(false);
  });
  it("excludes ISO dates", () => {
    expect(hasUnverifiedNumerics("截止日期是 2026-06-12。")).toBe(false);
    expect(hasUnverifiedNumerics("截止 2026-06-12，缺口 3 套。")).toBe(true);
  });
});

describe("redaction (§10.4)", () => {
  it("redacts password/token/secret keys deeply", () => {
    expect(redact({ a: 1, password: "x", nested: { apiToken: "y", clientSecret: "z" } })).toEqual({
      a: 1,
      password: "[REDACTED]",
      nested: { apiToken: "[REDACTED]", clientSecret: "[REDACTED]" },
    });
  });
});

describe("crypto", () => {
  it("AES-GCM roundtrip", () => {
    const key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const ct = encryptSecret("hunter2", key);
    expect(ct).not.toContain("hunter2");
    expect(decryptSecret(ct, key)).toBe("hunter2");
  });
});

describe("deterministic prng", () => {
  it("same input same output", () => {
    const a = prngFor({ x: 1 });
    const b = prngFor({ x: 1 });
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("plan validation", () => {
  it("rejects forward refs", () => {
    const errors = validatePlanSteps([
      { id: "s1", type: "query_objects", params: { objectType: "Base", filter: { x: "{{steps.s2.output.data}}" } } },
      { id: "s2", type: "render_answer", params: { blocks: [] } },
    ]);
    expect(errors.some((e) => e.includes("前向引用"))).toBe(true);
  });
});

describe("normalizeQuery", () => {
  it("lowercase / strip punctuation / digits → #", () => {
    expect(normalizeQuery("对比 20% 的产能, OK?")).toBe(normalizeQuery("对比 35% 的产能 OK"));
  });
});
