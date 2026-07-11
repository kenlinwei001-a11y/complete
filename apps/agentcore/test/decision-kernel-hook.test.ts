import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestApp, submitQuery, PLANNER, type TestApp } from "./helpers.js";
import { defaultOnKeys } from "../src/features/registry.js";

/**
 * WO-L2-4 齿（决策内核旁挂·server.ts:305·暗发观察态·对齐 startPreAnalysis）：
 *  ① decision.kernel 开 → 旁挂 fire-and-forget POST datacore build 端点（含 query/intentKey/slots·B→A OBO）·**不阻塞 202**；
 *  ② decision.kernel 关（暗发默认·datacore 解析集不含该键）→ 旁挂内部即返·不触发（旧路径零变化·NG1）；
 *  ③ 无 DATACORE_BASE_URL → 不触发（诚实·无落点）。
 * 说明：DATACORE_BASE_URL 置时 FeatureGate 走真 B→A `/a/v1/tenants/:id/features` 拉解析集（本测 stub 该端点控 entitlement）；
 * POST decision-package 端点 stub 回 204（对齐 datacore QOS_DECISION_KERNEL env 关时行为）。fire-and-forget·失败不阻断答题。
 */
describe("WO-L2-4 · 决策内核旁挂（暗发·B→A OBO 触发）", () => {
  let t: TestApp;
  let calls: { url: string; method?: string; body?: string }[];

  /** stub 全局 fetch：/features 端点回受控 entitlement 集；decision-package 端点回 204 并记录。 */
  const stubFetch = (features: string[]) => {
    calls = [];
    vi.stubGlobal("fetch", async (url: unknown, init?: { method?: string; body?: string }) => {
      const u = String(url);
      if (u.includes("/features")) {
        return new Response(JSON.stringify({ features, configVersion: 1 }), { status: 200, headers: { "content-type": "application/json", etag: '"cv-1"' } });
      }
      calls.push({ url: u, method: init?.method, body: init?.body });
      return new Response(null, { status: 204 });
    });
  };

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (t) await t.app.close();
  });

  const waitForHook = async () => {
    for (let i = 0; i < 60 && !calls.some((c) => c.url.includes("decision-package")); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
  };

  it("① decision.kernel 开 → 旁挂 POST build 端点（intentKey/slots）·不阻塞 202", async () => {
    stubFetch([...defaultOnKeys(), "decision.kernel"]); // 解析集含 decision.kernel
    t = await createTestApp({ env: { DATACORE_BASE_URL: "http://datacore.test" } });

    const { statusCode, taskId } = await submitQuery(t, PLANNER, "常州基地风险时间线？");
    expect(statusCode).toBe(202); // 旁挂 fire-and-forget·不阻塞

    await waitForHook();
    const call = calls.find((c) => c.url.includes(`/a/v1/queries/${taskId}/decision-package`));
    expect(call).toBeDefined();
    expect(call!.method).toBe("POST");
    const body = JSON.parse(call!.body ?? "{}");
    expect(body).toHaveProperty("query");
    expect(body).toHaveProperty("intentKey"); // 复用同一 classification 的 intentKey
    expect(body).toHaveProperty("slots");
  });

  it("② decision.kernel 关（解析集不含）→ 旁挂不触发（旧路径零变化·NG1）", async () => {
    stubFetch(defaultOnKeys()); // 解析集不含 decision.kernel（defaultOn:false）
    t = await createTestApp({ env: { DATACORE_BASE_URL: "http://datacore.test" } });

    const { statusCode } = await submitQuery(t, PLANNER, "常州基地风险时间线？");
    expect(statusCode).toBe(202);
    await new Promise((r) => setTimeout(r, 300));
    expect(calls.some((c) => c.url.includes("decision-package"))).toBe(false);
  });

  it("③ 无 DATACORE_BASE_URL → 旁挂不触发（诚实·无落点）", async () => {
    stubFetch([...defaultOnKeys(), "decision.kernel"]);
    t = await createTestApp(); // 无 DATACORE_BASE_URL
    const { statusCode } = await submitQuery(t, PLANNER, "常州基地风险时间线？");
    expect(statusCode).toBe(202);
    await new Promise((r) => setTimeout(r, 300));
    expect(calls.some((c) => c.url.includes("decision-package"))).toBe(false);
  });
});
