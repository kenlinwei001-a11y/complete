import { describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";

/**
 * WO-CAPSIM-IA-UNIFY（M1·唯一推演 surface 收敛·§5 验收②）：
 *  沙盘退役为「产能推演看板下钻态」——**裸访问** /v/sim-sandbox（无 scope/drill 参）→ 302 收敛到唯一 surface /v/risk；
 *  **下钻访问**（携 ?whatif= / ?from= 等参）→ 仍渲染沙盘（下钻态·推演能力不丢）。
 */
describe("WO-CAPSIM-IA-UNIFY · /v/sim-sandbox 退役重定向（下钻态保留）", () => {
  it("裸访问 /v/sim-sandbox → 302 落回产能推演 /v/risk（无独立沙盘路由·验收②）", async () => {
    loginAs("planner");
    const { router } = renderApp("/v/sim-sandbox");
    await waitFor(() => expect(router.state.location.pathname).toBe("/v/risk"));
  });

  it("下钻访问 /v/sim-sandbox?from=dialogue（携 drill 参）→ 不重定向（停留沙盘下钻态·推演不丢）", async () => {
    loginAs("planner");
    const { router } = renderApp("/v/sim-sandbox?from=dialogue");
    await waitFor(() => expect(router.state.location.pathname).toBe("/v/sim-sandbox"));
    expect(router.state.location.pathname).not.toBe("/v/risk");
  });
});
