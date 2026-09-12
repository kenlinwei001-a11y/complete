import { describe, expect, it } from "vitest";
import { coordinatorEnabled, freeLlmEnabled } from "../src/router/orchestrator.js";
import { defaultOnKeys, FEATURE_REGISTRY } from "../src/features/registry.js";

/**
 * WO-Phase4 · dark feature 默认关（agentcore 路由门·防回归锁）：
 * `coordinatorEnabled` / `freeLlmEnabled` 对 `"ALL"`（mock 默认 / DataCore 降级态）恒 false —— 既有单 agent path-B
 * 逐字节不变·不劫持（C4/C6/C7）；仅当**显式** Set 含对应键才启用。registry 二者 defaultOn:false（`defaultOnKeys()` 不含）。
 */
describe("WO-Phase4 · dark feature 路由门默认关（agentcore）", () => {
  it("coordinatorEnabled/freeLlmEnabled('ALL') 恒 false（降级态不劫持）", () => {
    expect(coordinatorEnabled("ALL")).toBe(false);
    expect(freeLlmEnabled("ALL")).toBe(false);
  });

  it("空显式 Set → 二者 false（暗发默认关·非 defaultOn 打开）", () => {
    const empty = new Set<string>();
    expect(coordinatorEnabled(empty)).toBe(false);
    expect(freeLlmEnabled(empty)).toBe(false);
  });

  it("显式含对应键才启用（门键控·不靠 defaultOn）", () => {
    expect(coordinatorEnabled(new Set(["agent.coordinator"]))).toBe(true);
    expect(freeLlmEnabled(new Set(["ceo.free-llm"]))).toBe(true);
  });

  it("agentcore registry 二者 defaultOn:false·defaultOnKeys() 不含", () => {
    for (const key of ["ceo.free-llm", "agent.coordinator"]) {
      const def = FEATURE_REGISTRY.find((f) => f.key === key);
      expect(def?.defaultOn, `${key} defaultOn:false`).toBe(false);
    }
    expect(defaultOnKeys()).not.toContain("ceo.free-llm");
    expect(defaultOnKeys()).not.toContain("agent.coordinator");
  });
});
