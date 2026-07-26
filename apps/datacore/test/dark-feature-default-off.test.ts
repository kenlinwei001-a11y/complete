import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";
import { FEATURE_REGISTRY, ALL_FEATURE_KEYS, QOS_DARK_LAUNCH_FEATURES } from "../src/features.js";

/**
 * WO-Phase4 · dark feature 防回归锁（诚实调查结论）：
 *
 * 核实结论 —— `ceo.free-llm` / `agent.coordinator` 平台注册均 `defaultOn:false`，且**无 demo 租户 seed override**
 * 显式开启（grep `apps/` 只在**测试**里 `features.mock.set(...,"ceo.free-llm")`）。**但**：demo 租户 industry=
 * `battery-manufacturing`，其行业模板此前 `return new Set(ALL_FEATURE_KEYS)`（all on）→ 在 L2 顺带把这两个 QOS 路由
 * 暗发门也打开 → `resolve("demo")` 实际返回二者 **true**（部署态 demo 会被劫持进无预算 path-B ReAct → 空转超时）。
 *
 * 修：把 `QOS_DARK_LAUNCH_FEATURES` 从 battery「all on」模板诚实排除（只经**显式**租户 override 才启用·default-off 锁死），
 * 产品分档特性（sim.* / opt.* 等）不受影响照常随模板开。本测锁死该结论防回归。
 */
describe("WO-Phase4 · dark feature 默认关（demo 部署态防回归）", () => {
  it("平台注册二者 defaultOn:false（default-off 锁死）", () => {
    for (const key of ["ceo.free-llm", "agent.coordinator"]) {
      const def = FEATURE_REGISTRY.find((f) => f.key === key);
      expect(def, `${key} 必须在平台注册表`).toBeDefined();
      expect(def!.defaultOn, `${key} 必须 defaultOn:false`).toBe(false);
    }
  });

  it("battery「all on」行业模板诚实排除 QOS 暗发门（不随模板顺带开）", () => {
    expect(QOS_DARK_LAUNCH_FEATURES.has("ceo.free-llm")).toBe(true);
    expect(QOS_DARK_LAUNCH_FEATURES.has("agent.coordinator")).toBe(true);
    // 排除只针对 QOS 路由门；产品分档暗发特性（sim.* / opt.*）不在此列
    expect(QOS_DARK_LAUNCH_FEATURES.has("sim.commander")).toBe(false);
    expect(QOS_DARK_LAUNCH_FEATURES.has("sim.sandbox")).toBe(false);
    // WO-DETERMINISTIC-CROSS-DOMAIN：确定性跨域分路门亦在暗发排除集（battery「all on」保持默认关）。
    expect(QOS_DARK_LAUNCH_FEATURES.has("qos.deterministic-multi-domain")).toBe(true);
    // L2/L3 多意图门同列暗发排除集（QOS_DARK_LAUNCH·all-on 也关·PRD-multi-intent-L2L3）。
    expect(QOS_DARK_LAUNCH_FEATURES.has("qos.multi-intent-l2-decompose")).toBe(true);
    expect(QOS_DARK_LAUNCH_FEATURES.has("qos.multi-intent-l3-coupled")).toBe(true);
    // ALL_FEATURE_KEYS 仍含（注册未删·仅模板不顺带开）
    expect(ALL_FEATURE_KEYS).toContain("ceo.free-llm");
    expect(ALL_FEATURE_KEYS).toContain("agent.coordinator");
    expect(ALL_FEATURE_KEYS).toContain("qos.deterministic-multi-domain");
  });

  it("demo（battery）resolved features 二者 false·sim.* 仍在（不误伤产品分档）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const resolved = (
      await t.app.inject({ method: "GET", url: "/a/v1/tenants/demo/features", headers: ADMIN })
    ).json() as { features: string[] };

    expect(resolved.features).not.toContain("ceo.free-llm");
    expect(resolved.features).not.toContain("agent.coordinator");
    expect(resolved.features).not.toContain("qos.deterministic-multi-domain"); // WO-DETERMINISTIC-CROSS-DOMAIN：all-on 也保持关
    expect(resolved.features).not.toContain("qos.multi-intent-l2-decompose"); // L2 真分解门 all-on 也保持关
    expect(resolved.features).not.toContain("qos.multi-intent-l3-coupled"); // L3 耦合联合门 all-on 也保持关
    // 回归护栏：只排除 QOS 暗发门·battery 产品分档特性仍随模板开
    expect(resolved.features).toContain("sim.commander");
    expect(resolved.features).toContain("sim.sandbox");
  });

  it("显式租户 override 仍可启用（暗发门不是被删·只是不默认开）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const put = await t.app.inject({
      method: "PUT",
      url: "/a/v1/tenants/demo/features",
      headers: ADMIN,
      payload: { overrides: { "ceo.free-llm": true, "agent.coordinator": true } },
    });
    expect(put.statusCode).toBe(200);
    const after = (put.json() as { features: string[] }).features;
    expect(after).toContain("ceo.free-llm");
    expect(after).toContain("agent.coordinator");
  });
});
