import { describe, expect, it } from "vitest";
import { makeApp } from "./helpers.js";
import { VleService } from "../src/vle.js";

/**
 * 增量2 · V5 参照实现双算（核心可证底线 / VL2）·  PRD-addendum-validation-loop §2「参照实现」+ §7 VL2。
 *
 * 证「双算是真有效的，不是装饰」：⑤段把被测 capacity_forecast 的 capWanP50/capWanP90 与
 * `vle-oracle.ts` 第二套独立代码算出的参照值逐字段比对。
 *   - 干净被测 → ⑤参照断言 PASS（expected==actual）。
 *   - 植入「求解器系数 bug」（模拟改坏 curveMult：把被测 capWanP50 篡改 ×0.85）→ ⑤参照断言**红**，
 *     diff 精确指出期望/实际 + Δ（VL2 真有效，捕获人造 bug）。
 *
 * 实现：用一个**被测 invoker 包装**注入篡改（不改求解器源码、不污染其它测试）——等价于「被测算错一个系数」。
 * 参照预言机独立重算正确值 → 当场抓出偏离。这正是 H4 增量2 的 DoD。
 */
describe("VLE · V5 参照实现双算（增量2 · VL2 真有效）", { timeout: 120000 }, () => {
  const VITEN_OK = "⑤求解器执行";

  it("干净被测：⑤参照双算 PASS（被测 capWanP50/capWanP90 == 独立参照值）", async () => {
    const t = await makeApp();
    // 注入真实被测 solvers.invoke（与 app.ts 生产接线同）。
    const vle = new VleService(t.repos, t.services.synthetic, t.services.ontology, (c, k, a) =>
      t.services.solvers.invoke(c, k, a),
    );
    const run = await vle.run(t.adminCtx, "SMOKE", 42);
    const report = run.report as unknown as { pass: boolean; assertions: { segment: string; point: string; oracle: string; pass: boolean; expected?: unknown; actual?: unknown }[] };
    const ref = report.assertions.find((a) => a.segment === VITEN_OK && a.oracle === "reference");
    expect(ref).toBeDefined();
    expect(ref!.pass).toBe(true);
    // 双算真出值（非占位）：expected/actual 均含数值 capWanP50/capWanP90 且相等。
    const exp = ref!.expected as { capWanP50: number; capWanP90: number };
    const act = ref!.actual as { capWanP50: number; capWanP90: number };
    expect(typeof exp.capWanP50).toBe("number");
    expect(exp.capWanP50).toBeGreaterThan(0);
    expect(act.capWanP50).toBe(exp.capWanP50);
    expect(act.capWanP90).toBe(exp.capWanP90);
    expect(report.pass).toBe(true);
  });

  it("植入求解器系数 bug（被测 capWanP50 ×0.85，模拟改坏 curveMult）→ ⑤参照双算变红，diff 指出期望/实际/Δ", async () => {
    const t = await makeApp();
    // 被测 invoker 包装：对 capacity_forecast 输出篡改 capWanP50/capWanP90（= 求解器算错一个系数）。
    const buggyInvoke = async (c: Parameters<typeof t.services.solvers.invoke>[0], k: string, a: Record<string, unknown>) => {
      const out = await t.services.solvers.invoke(c, k, a);
      if (k === "capacity_forecast" && typeof out.capWanP50 === "number") {
        out.capWanP50 = Math.round((out.capWanP50 as number) * 0.85 * 1e4) / 1e4; // 人造 bug：曲线系数被改坏
        out.capWanP90 = Math.round((out.capWanP90 as number) * 0.85 * 1e4) / 1e4;
      }
      return out;
    };
    const vle = new VleService(t.repos, t.services.synthetic, t.services.ontology, buggyInvoke);
    const run = await vle.run(t.adminCtx, "SMOKE", 42);
    const report = run.report as unknown as { pass: boolean; assertions: { segment: string; point: string; oracle: string; pass: boolean; expected?: unknown; actual?: unknown; diff?: string }[] };
    const ref = report.assertions.find((a) => a.segment === VITEN_OK && a.oracle === "reference");
    expect(ref).toBeDefined();
    // 双算抓到 bug：参照断言红 + 整报告 pass=false。
    expect(ref!.pass).toBe(false);
    expect(report.pass).toBe(false);
    // diff 精确（含期望/实际/Δ）——不是空占位。
    expect(ref!.diff).toBeTruthy();
    // 注意：diff 是**给人看的散文**（"P50 期望 …"），P50 在这里是**分位数的通俗名**不是字段名，
    // 故不随字段改名而改。（本行曾被整批改名误伤成 /capWanP50 期望/，由全量跑当场报红逼回来。）
    expect(ref!.diff!).toMatch(/P50 期望 .* 实际 .*Δ/);
    const exp = ref!.expected as { capWanP50: number };
    const act = ref!.actual as { capWanP50: number };
    expect(act.capWanP50).toBeLessThan(exp.capWanP50); // 被测被改小，参照仍是正确值 → 实际 < 期望
  });
});
