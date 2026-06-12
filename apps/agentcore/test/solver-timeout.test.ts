import { describe, expect, it } from "vitest";
import { createTestApp, debugHeaders, PLANNER } from "./helpers.js";

/**
 * 增量 §0-2：同步求解端点 POST /b/v1/solvers/{key}/run 超时（默认 15s，配置
 * SOLVER_RUN_TIMEOUT_MS）→ 504 SOLVER_TIMEOUT 统一错误信封。慢求解器用桩注入。
 */
describe("solver run timeout (增量 §0-2)", () => {
  it("上游慢于阈值 → 504 SOLVER_TIMEOUT 错误信封；快路径不受影响", async () => {
    const t = await createTestApp();
    // 注入假慢求解器（上游 200ms > 阈值 50ms）
    t.deps.config.SOLVER_RUN_TIMEOUT_MS = 50;
    const slow = () => new Promise<Record<string, unknown>>((resolve) => setTimeout(() => resolve({ data: {} }), 200));
    (t.deps.dataCore.solver as { invoke: unknown }).invoke = slow;

    const r = await t.app.inject({
      method: "POST",
      url: "/b/v1/solvers/capacity_forecast/run",
      headers: debugHeaders(PLANNER),
      payload: { args: { modelId: "4680-NCM", weeks: 6 } },
    });
    expect(r.statusCode).toBe(504);
    const body = r.json() as { error: { code: string; message: string; requestId: string } };
    expect(body.error.code).toBe("SOLVER_TIMEOUT");
    expect(typeof body.error.message).toBe("string");
    expect(typeof body.error.requestId).toBe("string");

    // 阈值放宽 → 同一桩在限内返回（超时计时器被清理，不误伤后续请求）
    t.deps.config.SOLVER_RUN_TIMEOUT_MS = 1000;
    const ok = await t.app.inject({
      method: "POST",
      url: "/b/v1/solvers/capacity_forecast/run",
      headers: debugHeaders(PLANNER),
      payload: { args: { modelId: "4680-NCM", weeks: 6 } },
    });
    expect(ok.statusCode).toBe(200);
  });

  it("默认配置 15s（生产值），可由环境变量覆盖", async () => {
    const t = await createTestApp();
    expect(t.config.SOLVER_RUN_TIMEOUT_MS).toBe(15_000);
  });
});
