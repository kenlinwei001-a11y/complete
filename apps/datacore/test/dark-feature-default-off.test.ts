import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";
import {
  FEATURE_REGISTRY,
  ALL_FEATURE_KEYS,
  QOS_DARK_LAUNCH_FEATURES,
  INCOMPLETE_DATA_DARK_LAUNCH_FEATURES,
} from "../src/features.js";

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
    // WO-PROCESS-INSTANCE：「数据尚缺」暗发门同样 all-on 也保持关（详见下一个 describe）。
    expect(resolved.features).not.toContain("process.runtime");
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

/**
 * WO-PROCESS-INSTANCE · 第三个暗发集合「数据尚缺」的防回归锁。
 *
 * ── 这条锁的来历（真实踩坑，不是照抄格式）─────────────────────────────────
 * 本单注册 `process.runtime` 时写了 `defaultOn:false`，**以为就暗发了**；
 * 实测 `resolve("demo")` 仍为 `true` —— 因为 demo 的 industry 是 `battery-manufacturing`，
 * 其模板规则是「`ALL_FEATURE_KEYS` 全开，减去暗发集合」，于是 L2 把 L1 的 false 覆盖成了 true。
 * 形态即铁律 0.6 的句式：
 * **「我用『注册表里写了 defaultOn:false』当作『它真的关着』的证据，而前者并不度量后者。」**
 *
 * ── ⚠ 为什么这里是**枚举**而不是一条通用不变量 ────────────────────────────
 * 直觉上该写「凡 `defaultOn:false` 都必须在某个暗发集合里」。**实测该命题为假**：
 * 31 个 `defaultOn:false` 的键里有 15 个（`sim.*` / `opt.*` /
 * `data-import.record-materialize` / `ceo.dataset.generate` 等）**故意**不在任何集合里 ——
 * 它们是**产品分档**，本就该随行业模板开（上一个 describe 的 `sim.sandbox` 断言正是护着这一点）。
 *
 * 即 `defaultOn:false` 在本仓有**两种**含义，机器分不出来，只有作者知道：
 *   (a) **产品分档** —— 平台默认不给，但行业模板可以给（`sim.*` / `opt.*`）；
 *   (b) **暗发** —— 谁都不许顺带开，只认显式租户 override（本文件锁的这些）。
 * 写死一条「全都必须进集合」的通用门，会把 15 个 (a) 类误判成违规 ——
 * 那是**另一个方向**的同类错误：拿一个看起来相关的规则当判据，而它并不度量真实意图。
 *
 * ⇒ 所以延续本文件既有做法：**逐个枚举 (b) 类**。
 * 新增暗发门时，除了 `defaultOn:false`，**必须**同时 ① 进三个集合之一、② 在此加一行锁。
 */
describe("WO-PROCESS-INSTANCE · 「数据尚缺」暗发门默认关（防回归）", () => {
  it("process.runtime 注册为 defaultOn:false", () => {
    const def = FEATURE_REGISTRY.find((f) => f.key === "process.runtime");
    expect(def, "process.runtime 必须在平台注册表").toBeDefined();
    expect(def!.defaultOn).toBe(false);
  });

  it("且在暗发集合里 —— 只有 defaultOn:false 拦不住 battery「all on」（本单实测踩过）", () => {
    expect(INCOMPLETE_DATA_DARK_LAUNCH_FEATURES.has("process.runtime")).toBe(true);
    // 三个集合语义各不相同，不许合并：QOS=路由会变慢 · PERF=性能收窄 · 本集合=数据尚无。
    expect(QOS_DARK_LAUNCH_FEATURES.has("process.runtime")).toBe(false);
    // 注册未删，仅模板不顺带开。
    expect(ALL_FEATURE_KEYS).toContain("process.runtime");
  });

  it("显式 override 仍可开（暗发不是阉割）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const put = await t.app.inject({
      method: "PUT",
      url: "/a/v1/tenants/demo/features",
      headers: ADMIN,
      payload: { overrides: { "process.runtime": true } },
    });
    expect(put.statusCode).toBe(200);
    expect((put.json() as { features: string[] }).features).toContain("process.runtime");
  });
});
