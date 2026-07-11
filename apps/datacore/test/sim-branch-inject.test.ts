import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, debugUser, type TestApp } from "./helpers.js";

/**
 * WO-SANDBOX-BRANCH-INJECT（S3）· 分支注入不同应对 + compare 决策维差量（经 S6 SimContextOverlay 真算）。
 * 铁律 0.4：决策维经真求解器上下文 overlay 在各分支模拟末态上算（KILL-MOCK-RED·非造 delta·非曲线均值）。
 * R6 确定性 · R3 暗发（sim.branch_inject defaultOff·关=回容器分支+不返 decisionDims）。
 */
const enable = (t: TestApp, extra: Record<string, boolean> = {}) =>
  t.app.inject({
    method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true, "sim.checkpoint": true, "sim.branch": true, ...extra } },
  });

// 建"父会话→tick0 检查点"，返回 { sid, cpId, baseId }。baseSnapshot 以真 Base 对象 id 为键（overlay 命中真承载对象）。
async function parentWithCp(t: TestApp): Promise<{ sid: string; cpId: string; baseId: string }> {
  const bases = (await t.repos.objects.listByType("demo", "Base")).filter((o) => !o.mergedInto);
  const baseId = bases[0]!.id;
  const init = await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot: { [baseId]: { risk: 10 } } } });
  const sid = init.json().id as string;
  const cp = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/checkpoint`, headers: ADMIN, payload: { label: "cp0" } });
  return { sid, cpId: cp.json().id as string, baseId };
}
const DIMS = JSON.stringify([{ dimKey: "Base.risk", label: "风险", objectType: "Base", stateVar: "risk", agg: "sum", direction: "LOWER_BETTER" }]);

describe("WO-SANDBOX-BRANCH-INJECT · 分支注入应对 + compare 决策维差量", () => {
  it("A≠B（§5.1）+ 决策维经 overlay 真算（§5.2）：外协 vs 加班注入不同 → 末态不同、决策维逐值不同", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await enable(t, { "sim.branch_inject": true });
    const { sid, cpId, baseId } = await parentWithCp(t);
    // 分支 A（应对=外协·降风险 −3）；分支 B（应对=加班·升风险 +5）——不同应对注入不同 child tick0。
    const brA = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/branch`, headers: ADMIN,
      payload: { checkpointId: cpId, mitigation: { key: "outsource", label: "外协", injections: [{ objectId: baseId, stateVar: "risk", delta: -3 }] } } });
    const brB = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/branch`, headers: ADMIN,
      payload: { checkpointId: cpId, mitigation: { key: "overtime", label: "加班", injections: [{ objectId: baseId, stateVar: "risk", delta: 5 }] } } });
    // 应对随分支落 tick0 baseSnapshot（A≠B 真）：外协 10−3=7，加班 10+5=15。
    expect(brA.json().baseSnapshot[baseId].risk).toBe(7);
    expect(brB.json().baseSnapshot[baseId].risk).toBe(15);
    expect(brA.json().mitigation.key).toBe("outsource");
    const aid = brA.json().id as string, bid = brB.json().id as string;
    // compare 决策维（经 S6 overlay 覆盖真世界 → 逐维聚合·LOWER_BETTER）。
    const cmp = await t.app.inject({ method: "GET", url: `/a/v1/sim/compare?a=${aid}&b=${bid}&dims=${encodeURIComponent(DIMS)}`, headers: ADMIN });
    const dd = cmp.json().decisionDims as { dimKey: string; a: number; b: number; delta: number; verdict: string }[];
    expect(dd).toBeDefined();
    const risk = dd.find((d) => d.dimKey === "Base.risk")!;
    // a/b 逐值：baseId 被 overlay 覆盖为分支模拟值（其余 Base 真 props 两侧同·抵消）→ delta = 15−7 = 8。
    expect(risk.b - risk.a).toBe(8);
    expect(risk.delta).toBe(8);
    // LOWER_BETTER：b(15)>a(7) → A 更优（机械判·R6）。
    expect(risk.verdict).toBe("A_BETTER");
  });

  it("决策维 a/b 逐对后端真值（§5.2·非造）：overlay 聚合 = Base.risk 全对象求和 + 分支覆盖值", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await enable(t, { "sim.branch_inject": true });
    const { sid, cpId, baseId } = await parentWithCp(t);
    // 后端真值口径：所有 Base 对象 props.risk 之和，其中 baseId 被分支模拟末态覆盖。
    const bases = (await t.repos.objects.listByType("demo", "Base")).filter((o) => !o.mergedInto);
    const realOtherRisk = bases.filter((b) => b.id !== baseId)
      .reduce((s, b) => s + (typeof b.props.risk === "number" && Number.isFinite(b.props.risk) ? (b.props.risk as number) : 0), 0);
    const brA = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/branch`, headers: ADMIN,
      payload: { checkpointId: cpId, mitigation: { key: "outsource", injections: [{ objectId: baseId, stateVar: "risk", delta: -3 }] } } });
    const cmp = await t.app.inject({ method: "GET", url: `/a/v1/sim/compare?a=${brA.json().id}&b=${brA.json().id}&dims=${encodeURIComponent(DIMS)}`, headers: ADMIN });
    const risk = (cmp.json().decisionDims as { dimKey: string; a: number }[]).find((d) => d.dimKey === "Base.risk")!;
    // 逐值对后端真值：a = realOtherRisk + 覆盖值 7（10−3）。
    expect(risk.a).toBeCloseTo(realOtherRisk + 7, 6);
  });

  it("R6 确定性（§5.3）：同应对同注入两次 compare 决策维字节一致", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await enable(t, { "sim.branch_inject": true });
    const { sid, cpId, baseId } = await parentWithCp(t);
    const branch = async (delta: number) => (await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/branch`, headers: ADMIN,
      payload: { checkpointId: cpId, mitigation: { key: "m", injections: [{ objectId: baseId, stateVar: "risk", delta }] } } })).json().id as string;
    const a1 = await branch(-3), b1 = await branch(5);
    const a2 = await branch(-3), b2 = await branch(5);
    const cmp = async (a: string, b: string) => (await t.app.inject({ method: "GET", url: `/a/v1/sim/compare?a=${a}&b=${b}&dims=${encodeURIComponent(DIMS)}`, headers: ADMIN })).json().decisionDims;
    expect(JSON.stringify(await cmp(a1, b1))).toBe(JSON.stringify(await cmp(a2, b2)));
  });

  it("回退演练（§5.5·teeth）：sim.branch_inject 关 → 忽略 mitigation（回容器分支·A/B 相同）+ compare 不返 decisionDims", async () => {
    // 干净租户（非 battery·避 all-on 干扰）：只开 sim.branch 前置，branch_inject 保持 defaultOff（暗发关）。
    const t = await makeApp();
    const H = debugUser("freshco", "admin", "admin");
    await t.app.inject({ method: "PUT", url: "/a/v1/tenants/freshco/features", headers: H,
      payload: { overrides: { "sim.sandbox": true, "sim.propagation": true, "sim.checkpoint": true, "sim.branch": true } } });
    const init = await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: H, payload: { baseSnapshot: { o1: { risk: 10 } } } });
    const sid = init.json().id as string;
    const cp = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/checkpoint`, headers: H, payload: { label: "cp0" } });
    const cpId = cp.json().id as string;
    const brA = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/branch`, headers: H,
      payload: { checkpointId: cpId, mitigation: { key: "outsource", injections: [{ objectId: "o1", stateVar: "risk", delta: -3 }] } } });
    const brB = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/branch`, headers: H,
      payload: { checkpointId: cpId, mitigation: { key: "overtime", injections: [{ objectId: "o1", stateVar: "risk", delta: 5 }] } } });
    // 关闸：mitigation 被忽略 → child 是容器分支（态 == 检查点态·A==B），响应不带 mitigation。
    expect(brA.json().baseSnapshot.o1.risk).toBe(10);
    expect(brB.json().baseSnapshot.o1.risk).toBe(10);
    expect(brA.json().mitigation).toBeUndefined();
    const cmp = await t.app.inject({ method: "GET", url: `/a/v1/sim/compare?a=${brA.json().id}&b=${brB.json().id}&dims=${encodeURIComponent(DIMS)}`, headers: H });
    // 关闸：不返 decisionDims（旧行为字节一致），a/b 序列仍在（向后兼容）。
    expect(cmp.json().decisionDims).toBeUndefined();
    expect(Array.isArray(cmp.json().a)).toBe(true);
  });

  it("缺省决策维（无 dims 参数）：从 PUBLISHED 传导规则派生（R14 配置驱动·direction=NEUTRAL 只报值不判优劣）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await enable(t, { "sim.branch_inject": true });
    // 发布一条传导规则 → 派生决策维 target=Base.risk。
    await t.app.inject({ method: "POST", url: "/a/v1/sim/propagation-rules", headers: ADMIN,
      payload: { key: "r_bi", sourceTypeKey: "Line", sourceStateVar: "util", viaLinkKey: "line_belongs_to_base", targetTypeKey: "Base", targetStateVar: "risk", coefficient: 0.5, delayTicks: 0, status: "PUBLISHED" } });
    const { sid, cpId, baseId } = await parentWithCp(t);
    const brA = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/branch`, headers: ADMIN,
      payload: { checkpointId: cpId, mitigation: { key: "outsource", injections: [{ objectId: baseId, stateVar: "risk", delta: -3 }] } } });
    const brB = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/branch`, headers: ADMIN,
      payload: { checkpointId: cpId, mitigation: { key: "overtime", injections: [{ objectId: baseId, stateVar: "risk", delta: 5 }] } } });
    const cmp = await t.app.inject({ method: "GET", url: `/a/v1/sim/compare?a=${brA.json().id}&b=${brB.json().id}`, headers: ADMIN });
    const dd = cmp.json().decisionDims as { dimKey: string; delta: number; verdict: string }[];
    const risk = dd.find((d) => d.dimKey === "Base.risk")!;
    expect(risk).toBeDefined();
    expect(risk.delta).toBe(8); // 派生维仍真算差量
    expect(risk.verdict).toBe("NO_DATA"); // NEUTRAL：有值不臆断优劣（诚实）
  });
});
