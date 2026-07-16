import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, debugUser } from "./helpers.js";
import { deriveCertification, DEFAULT_CERT_CONFIG, type CertScope, type TrialTickInput } from "../src/sim/certification.js";
import type { ClosureReport, GapReport } from "@platform/contracts";

/**
 * 推演沙盘增量 2 · 就绪认证（SimCertification = 投影既有 closure，零新校验 RL3）。
 * SPEC docs/SPEC-sandbox-readiness-certification.md §10 DoD：投影正确 · 删 writeback→L4 降 L3 ·
 * canEnterSimulation=false · gaps 列出 · 全局 vs 局部 · 确定性 R6 · 端点过 entitlement(R3)。
 */

// 一个"满级 L4"基线：closure 全过、trial PASS、scope 三元组全满足。
const goodClosure = (): ClosureReport => ({
  gatePassed: true,
  findings: [
    { kind: "OBJECT", ref: "Order", status: "BOUND" },
    { kind: "OBJECT", ref: "Factory", status: "BOUND" },
    { kind: "DATA", ref: "ds.qty", status: "BOUND" },
  ],
  objectsBound: 2, dataOrphans: 0, forwardMissing: 0, chainBroken: 0, shapeBroken: 0,
  buildMode: "STRICT", advisoryCount: 0, blocked: false,
});
const cleanGaps = (): GapReport => ({ question: "", taskId: "t", verdict: "ANSWERABLE", path: "NONE", findings: [], generatedAt: "2026-01-01T00:00:00Z" });
const passTrial = (): TrialTickInput => ({ passed: true, rulesFired: 4, at: "2026-01-01T00:00:00Z", error: null });

const fullScope = (kind: "GLOBAL" | "LOCAL" = "GLOBAL", target: string | null = null): CertScope & { computedAt: string } => ({
  kind, targetRef: target, computedAt: "2026-01-01T00:00:00Z",
  objectTypes: [
    { typeKey: "Order", bound: true, fieldCount: 4, consumedFieldCount: 4, sliceCovered: true, behaviorReady: true },
    { typeKey: "Factory", bound: true, fieldCount: 3, consumedFieldCount: 2, sliceCovered: true, behaviorReady: true },
  ],
  derivations: [
    { typeKey: "Order", propKey: "risk", sourceVars: ["Order.qty", "Factory.cap"], present: true },
  ],
  actions: [{ key: "adopt_mitigation", targetTypeKey: "Order" }],
  slices: [{ key: "order_factory" }],
  propagationRules: [],
  needed: { stateVars: 1, derivationRules: 1, actions: 1, propagationRules: 0 },
});

describe("增量2 · deriveCertification 纯投影", () => {
  it("满级 L4：closure 全过 ∧ trial PASS ∧ 三元组全真 → L4_CERTIFIED ∧ canEnterSimulation", () => {
    const cert = deriveCertification(goodClosure(), cleanGaps(), passTrial(), fullScope(), DEFAULT_CERT_CONFIG);
    expect(cert.level).toBe("L4_CERTIFIED");
    expect(cert.l4Checks).toEqual({ fanoutSafe: true, writebackComplete: true, observabilityMet: true });
    expect(cert.canEnterSimulation).toBe(true);
    expect(cert.gaps).toHaveLength(0);
    // 三维投影正确（§2.3）：结构 100、知识 (4+2)/(4+3)=86、行为 100、综合=0.4*100+0.3*86+0.3*100=86。
    expect(cert.dims.structure).toBe(100);
    expect(cert.dims.knowledge).toBe(Math.round((100 * 6) / 7));
    expect(cert.dims.behavior).toBe(100);
    // 综合 = 0.4*100 + 0.3*round(600/7=86) + 0.3*100 = 40 + 25.8 + 30 = 95.8 → 96。
    expect(cert.dims.composite).toBe(Math.round(0.4 * 100 + 0.3 * Math.round((100 * 6) / 7) + 0.3 * 100));
    // 世界完整度 100%（present=needed）+ entering 含派生与 Action。
    expect(cert.worldCompleteness.pct).toBe(100);
    const ent = cert.worldCompleteness.entering.find((e) => e.kind === "DERIVATION" && e.key === "Order.risk")!;
    expect(ent).toBeDefined();
    // 评审遗留修：source 显**真实派生依赖**（非占位 FULFILLS r_…），知道每个将进入态从哪来（R13）。
    expect(ent.source).toBe("派生自 Order.qty·Factory.cap");
    expect(ent.source).not.toContain("FULFILLS r_");
    expect(cert.worldCompleteness.entering.some((e) => e.kind === "ACTION")).toBe(true);
  });

  it("DoD2：删一条 writeback Action → L4 降 L3 + writebackComplete=false + canEnterSimulation=false + gaps 列出（不静默）", () => {
    const scope = fullScope();
    scope.actions = []; // 删掉 writeback Action
    const cert = deriveCertification(goodClosure(), cleanGaps(), passTrial(), scope, DEFAULT_CERT_CONFIG);
    expect(cert.level).toBe("L3_VERIFIED");
    expect(cert.l4Checks.writebackComplete).toBe(false);
    expect(cert.canEnterSimulation).toBe(false);
    const codes = cert.gaps.map((g) => g.gapCode);
    expect(codes).toContain("NO_WRITEBACK"); // 缺件诚实入 gaps[]
  });

  it("trial FAIL（派生有环）→ 不进 L3，canEnterSimulation=false，gaps 含 TRIAL_TICK_FAILED ∧ FANOUT_UNSAFE", () => {
    const trial: TrialTickInput = { passed: false, rulesFired: 0, at: "t", error: "CYCLIC_DERIVATION: a → b → a" };
    const cert = deriveCertification(goodClosure(), cleanGaps(), trial, fullScope(), DEFAULT_CERT_CONFIG);
    expect(cert.level).toBe("L2_RUNNABLE"); // L2 达成但 L3 需 trial.passed
    expect(cert.canEnterSimulation).toBe(false);
    const codes = cert.gaps.map((g) => g.gapCode);
    expect(codes).toContain("TRIAL_TICK_FAILED");
    expect(codes).toContain("FANOUT_UNSAFE"); // 环 → acyclic=false → fanoutSafe=false
  });

  it("高扇出（出边 > maxFanout）→ fanoutSafe=false（唯一新读的计数）", () => {
    const scope = fullScope();
    // 同一 sourceStateVar 派生出 9 条边 > maxFanout(8)。
    scope.derivations = Array.from({ length: 9 }, (_, i) => ({ typeKey: "Order", propKey: `d${i}`, sourceVars: ["Order.qty"], present: true }));
    scope.needed.derivationRules = 9; scope.needed.stateVars = 9;
    const cert = deriveCertification(goodClosure(), cleanGaps(), passTrial(), scope, DEFAULT_CERT_CONFIG);
    expect(cert.l4Checks.fanoutSafe).toBe(false);
    expect(cert.level).toBe("L3_VERIFIED"); // L3 但非 L4
    expect(cert.gaps.map((g) => g.gapCode)).toContain("FANOUT_UNSAFE");
  });

  it("未归域对象 → OBJECT 维降级，结构准备度 <100，level 降 L1", () => {
    const scope = fullScope();
    scope.objectTypes[1]!.bound = false; // Factory 未归域
    const closure = goodClosure();
    closure.gatePassed = false; closure.findings.push({ kind: "OBJECT", ref: "Factory", status: "FAILED" });
    const cert = deriveCertification(closure, cleanGaps(), passTrial(), scope, DEFAULT_CERT_CONFIG);
    expect(cert.dims.structure).toBe(50); // 1/2 归域
    expect(cert.level).toBe("L0_INVALID"); // OBJECT-FAILED → 连 L1 都不到
  });

  it("全局 vs 局部：同本体同一函数换 scope，LOCAL 缺字段对象 <100（复刻竞品 75/100 语义）", () => {
    const global = deriveCertification(goodClosure(), cleanGaps(), passTrial(), fullScope("GLOBAL", null), DEFAULT_CERT_CONFIG);
    expect(global.scope).toBe("GLOBAL");
    expect(global.dims.knowledge).toBe(Math.round((100 * 6) / 7));
    // LOCAL 只看 Factory（知识 2/3=67）。
    const local = fullScope("LOCAL", "Factory");
    local.objectTypes = [{ typeKey: "Factory", bound: true, fieldCount: 3, consumedFieldCount: 2, sliceCovered: true, behaviorReady: true }];
    local.derivations = []; local.needed = { stateVars: 0, derivationRules: 0, actions: 1, propagationRules: 0 };
    const localCert = deriveCertification(goodClosure(), cleanGaps(), passTrial(), local, DEFAULT_CERT_CONFIG);
    expect(localCert.scope).toBe("LOCAL");
    expect(localCert.targetRef).toBe("Factory");
    expect(localCert.dims.knowledge).toBe(Math.round((100 * 2) / 3)); // 67，区别于 GLOBAL 86
    expect(localCert.dims.knowledge).not.toBe(global.dims.knowledge);
  });

  it("确定性 R6：同输入跑两次字节级一致（computedAt 由调用方传入，不 Date.now）", () => {
    const a = deriveCertification(goodClosure(), cleanGaps(), passTrial(), fullScope(), DEFAULT_CERT_CONFIG);
    const b = deriveCertification(goodClosure(), cleanGaps(), passTrial(), fullScope(), DEFAULT_CERT_CONFIG);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("既有 GapReport.findings 投影进 gaps[]（不静默既有缺口）", () => {
    const gaps: GapReport = {
      question: "", taskId: "t", verdict: "BLOCKED", path: "NONE", generatedAt: "t",
      findings: [{ gapCode: "SOLVER_NOT_FOUND", atStep: "closure:CHAIN", evidence: "求解器 ghost 未注册", suggestedFill: "注册", blocking: true }],
    };
    const cert = deriveCertification(goodClosure(), gaps, passTrial(), fullScope(), DEFAULT_CERT_CONFIG);
    expect(cert.gaps.some((g) => g.gapCode === "SOLVER_NOT_FOUND")).toBe(true);
  });
});

describe("增量2 · 就绪认证端点（R3 暗发 · 复用既有 closure 取数）", () => {
  const enableSim = (t: Awaited<ReturnType<typeof makeApp>>) =>
    t.app.inject({ method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN, payload: { overrides: { "sim.sandbox": true, "sim.certification": true } } });

  it("暗发：未播种租户 → certification 端点 404 FEATURE_NOT_FOUND（先于 authz）", async () => {
    const t = await makeApp();
    // 先在干净租户建会话不可能（sim.sandbox 也关），直接打 certification 必 404。
    const r = await t.app.inject({ method: "GET", url: "/a/v1/sim/sessions/x/certification", headers: debugUser("freshco", "admin", "admin") });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe("FEATURE_NOT_FOUND");
  });

  it("seedBattery 本体 → GET certification 返合法 SimCertification（含 L 级/三维/三元组/世界完整度/gaps）", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedBattery(t);
    const init = await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot: { o1: { risk: 0.5 } } } });
    const sid = init.json().id as string;
    const r = await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/certification?scope=GLOBAL`, headers: ADMIN });
    expect(r.statusCode).toBe(200);
    const cert = r.json();
    expect(["L0_INVALID", "L1_CONFIGURED", "L2_RUNNABLE", "L3_VERIFIED", "L4_CERTIFIED"]).toContain(cert.level);
    expect(cert.scope).toBe("GLOBAL");
    expect(cert.dims).toHaveProperty("composite");
    expect(cert.l4Checks).toHaveProperty("fanoutSafe");
    expect(cert.trialTick).toHaveProperty("rulesFired");
    expect(cert.worldCompleteness).toHaveProperty("pct");
    expect(Array.isArray(cert.gaps)).toBe(true);
    expect(typeof cert.canEnterSimulation).toBe("boolean");
    // 确定性 R6：同一会话两次认证除 computedAt 外一致。
    const r2 = await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/certification?scope=GLOBAL`, headers: ADMIN });
    const c2 = r2.json();
    expect({ ...cert, computedAt: 0, trialTick: { ...cert.trialTick, at: 0 } }).toEqual({ ...c2, computedAt: 0, trialTick: { ...c2.trialTick, at: 0 } });
  });

  it("scope-precheck 端点（init step③）：返世界完整度 + entering 清单 + canEnterSimulation", async () => {
    const t = await makeApp();
    await t.app.inject({ method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN, payload: { overrides: { "sim.sandbox": true } } });
    await seedBattery(t);
    const init = await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot: {} } });
    const sid = init.json().id as string;
    const r = await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/scope-precheck`, headers: ADMIN });
    expect(r.statusCode).toBe(200);
    expect(r.json().worldCompleteness).toHaveProperty("entering");
    expect(typeof r.json().canEnterSimulation).toBe("boolean");
  });

  it("WO-RC1 前向闭合硬前置：C24 scope 归真实类型（Order·非 eval-only 命名空间 Quote）→ GLOBAL cert forwardMissing 消 → canEnterSimulation 翻真「✓可进入推演」", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedBattery(t);
    const init = await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot: {} } });
    const sid = init.json().id as string;
    const r = await t.app.inject({ method: "GET", url: `/a/v1/sim/sessions/${sid}/certification?scope=GLOBAL`, headers: ADMIN });
    expect(r.statusCode).toBe(200);
    const cert = r.json();
    // 前向闭合缺口清零：不再有引用 eval-only 命名空间 Quote 的规则 scope FORWARD MISSING（此前 C24->Quote 卡在 L1）。
    expect(cert.gaps.some((g: { detail?: string }) => (g.detail ?? "").includes("C24->Quote"))).toBe(false);
    // 硬前置满足 → 满级认证 → 「✓可进入推演」亮。
    expect(cert.level).toBe("L4_CERTIFIED");
    expect(cert.canEnterSimulation).toBe(true);
  });
});
