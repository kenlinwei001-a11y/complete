import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, type TestApp } from "./helpers.js";
import { RULE_PARAM_BINDINGS, applyRuleParamBindings } from "@platform/contracts";
import { BATTERY_SOLVER_PARAMS, BATTERY_RULES } from "../src/synthetic/battery.js";

/**
 * 规则即引用 **P4 · 数值维**（G-10 §8 残口）——**效果层**验收，不是运输层。
 *
 * P1 让规则一等化、P2 让求解器**评估**规则（`evaluatedRules`），但求解器**算数**用的系数/阈值仍读
 * `solver_params` 里自己那份**同值字面量**：C04 `pendingCertFactor:0.6` ↔ `certFactors.认证中:0.6`、
 * C09 `staleHours:2/degradedFactor:0.9` ↔ `health.staleHours/health.degraded`。门守的是 SolverParam 那份、
 * 规则那份没人读 = **诱饵**：下一个人去改规则种子，以为改了推演，其实一个数都没动。
 *
 * 本文件的头号判据（缺则本单退回）：**改规则定义、不改任何代码，求解器输出的数真的跟着变**。
 * 只断言"规则被读到了 / 值传下去了"（运输层）一律不算 —— 所以每条都去比 `p50/p90` 这种**推演结论数值**。
 */

interface CapacityOut {
  p50: number;
  p90: number;
  healthFactor: number;
  degradeNote?: string;
  pendingCertList?: string[];
  evaluatedRules?: { key: string; outcome: string }[];
}

async function capacity(t: TestApp): Promise<CapacityOut> {
  const res = await t.app.inject({
    method: "POST",
    url: "/a/v1/solvers/capacity_forecast/invoke",
    headers: ADMIN,
    payload: { args: { modelId: "4680-NCM", demandDelta: 0.2, weeks: 6 } },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().data as CapacityOut;
}

/** 经**规则编辑路径**改规则（新版本 → 发布），全程不碰任何源码常量。 */
async function editRule(
  t: TestApp,
  patch: { key: string; name: string; expression: string; scopeObjectTypes: string[]; severity: string; params: Record<string, number> },
): Promise<void> {
  const created = await t.app.inject({ method: "POST", url: "/a/v1/rules", headers: ADMIN, payload: patch });
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json().id as string;
  const pub = await t.app.inject({ method: "POST", url: `/a/v1/rules/${id}/publish`, headers: ADMIN, payload: {} });
  expect(pub.statusCode, pub.body).toBe(200);
}

const storedParams = async (t: TestApp): Promise<Record<string, unknown>> =>
  ((await t.repos.solverParams.get("demo", "spar_demo"))?.params ?? {}) as Record<string, unknown>;

describe("规则即引用 P4 · 改规则即改推演（数值维·效果层）", () => {
  it("SEAM-1 · 改 C09 数据健康阈值（规则编辑路径）→ capacity_forecast 的 P90 数值真的变（不改一行代码）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 基线：demo 关键数据源最大延迟 1.8h ≤ C09.staleHours(2) → 不降级，P90 = P50 × health.normal。
    const before = await capacity(t);
    expect(before.healthFactor).toBe(0.93);
    expect(before.degradeNote).toBeUndefined();
    expect(before.p90).toBeCloseTo(before.p50 * 0.93, 3);

    // 只改规则：延迟阈值 2h → 1h（同时把 expression 里的同一阈值改掉，保持规则自洽）。
    await editRule(t, {
      key: "C09",
      name: "数据时延临时降级",
      expression: "DataSourceHealth.critical == TRUE AND DataSourceHealth.lagHours > 1",
      scopeObjectTypes: ["DataSourceHealth"],
      severity: "WARN",
      params: { staleHours: 1, degradedFactor: 0.9 },
    });

    const after = await capacity(t);
    // ① 推演**数值**跟着变：同一批数据源现在越过 1h 阈值 → P90 系数 0.93 → 0.9，P90 真的掉下来。
    expect(after.healthFactor).toBe(0.9);
    expect(after.p50).toBe(before.p50); // P50 不受健康度影响 → 变的确实是 C09 这条链，不是别的
    expect(after.p90).toBeLessThan(before.p90);
    expect(after.p90).toBeCloseTo(before.p50 * 0.9, 3);
    // ② 降级说明里的阈值/系数也来自规则（前端读的是这句话）。
    expect(after.degradeNote).toContain("（>1h）");
    // ③ 同一次改动让规则闸也翻转（P2 评估维）——数值维与评估维**同源**，不再各说各话。
    expect(before.evaluatedRules?.find((r) => r.key === "C09")?.outcome).toBe("PASS");
    expect(after.evaluatedRules?.find((r) => r.key === "C09")?.outcome).toBe("WARN");
  });

  it("SEAM-2 · 改 C09 降级系数 degradedFactor → P90 按新系数走（阈值与系数两个 param 各自独立生效）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await capacity(t);

    await editRule(t, {
      key: "C09",
      name: "数据时延临时降级",
      expression: "DataSourceHealth.critical == TRUE AND DataSourceHealth.lagHours > 1",
      scopeObjectTypes: ["DataSourceHealth"],
      severity: "WARN",
      params: { staleHours: 1, degradedFactor: 0.5 },
    });

    const after = await capacity(t);
    expect(after.healthFactor).toBe(0.5);
    expect(after.p90).toBeCloseTo(before.p50 * 0.5, 3);
  });

  it("SEAM-3 · 改 C04 认证降额系数 → 认证中产线的产能贡献真的变（P50 数值下降）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = await capacity(t);
    expect((before.pendingCertList ?? []).length).toBeGreaterThan(0); // 该型号确有认证中产线，系数才咬得到

    await editRule(t, {
      key: "C04",
      name: "仅认证产线计入产能",
      expression: "Line.certStatus != '量产'",
      scopeObjectTypes: ["Line"],
      severity: "WARN",
      params: { productionFactor: 1, pendingCertFactor: 0.2 },
    });

    const after = await capacity(t);
    expect(after.p50).toBeLessThan(before.p50); // 0.6 → 0.2：认证中基地贡献缩水
    expect(after.p90).toBeLessThan(before.p90);
  });

  it("SEAM-4 · 改 C21 产销偏差阈值 → S&OP 步骤 2 的越线判定（flagged/议题）真的翻转", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 构造一个 +20% 偏差的细分：阈值 10% 下越线、阈值 30% 下不越线。
    const segments = [{ key: "pas", name: "乘用车", target: 100, rolling: 120, lastActual: 100 }];
    const runStep2 = async () => {
      const created = await t.app.inject({ method: "POST", url: "/a/v1/sop/versions", headers: ADMIN, payload: { month: "2026-07" } });
      const id = (created.json() as { id: string }).id;
      await t.app.inject({ method: "POST", url: `/a/v1/sop/versions/${id}/advance`, headers: ADMIN, payload: { step: 1, payload: {} } });
      const res = await t.app.inject({ method: "POST", url: `/a/v1/sop/versions/${id}/advance`, headers: ADMIN, payload: { step: 2, payload: { segments } } });
      expect(res.statusCode, res.body).toBe(200);
      return res.json() as { steps: { s2: { rows: { key: string; flagged: boolean }[] } }; agenda: { source: string; title: string }[] };
    };

    const before = await runStep2();
    expect(before.steps.s2.rows.find((r) => r.key === "pas")?.flagged).toBe(true); // 20% > 10%
    expect(before.agenda.some((a) => a.source === "C21")).toBe(true);

    await editRule(t, {
      key: "C21",
      name: "产销平衡偏差",
      expression: "SopVersionRow.balanceDeviationPct > 0.30",
      scopeObjectTypes: ["SopVersionRow"],
      severity: "WARN",
      params: { balanceDeviationPct: 0.3 },
    });

    const after = await runStep2();
    expect(after.steps.s2.rows.find((r) => r.key === "pas")?.flagged).toBe(false); // 20% ≤ 30% → 不再越线
    expect(after.agenda.some((a) => a.source === "C21")).toBe(false); // 议题也不再自动提报
  });

  it("SEAM-5 · 改 C18 现金垫底线 → plan_generate 的硬约束结论（hardViol/问题清单）真的变", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const planGenerate = async () => {
      const res = await t.app.inject({ method: "POST", url: "/a/v1/solvers/plan_generate/invoke", headers: ADMIN, payload: { args: {} } });
      expect(res.statusCode, res.body).toBe(200);
      return res.json().data as { schemes: { no: string; hardViol: string[]; problems: { ruleRef?: string; title?: string }[] }[] };
    };

    const c18Count = (r: Awaited<ReturnType<typeof planGenerate>>) => r.schemes.filter((s) => s.hardViol.includes("C18")).length;
    const before = await planGenerate();
    expect(c18Count(before)).toBeLessThan(3); // 出厂底线 50 亿：并非全部方案击穿

    await editRule(t, {
      key: "C18",
      name: "现金垫底线",
      expression: "AnnualScenario.cashCushion < 200",
      scopeObjectTypes: ["AnnualScenario"],
      severity: "BLOCK",
      params: { cashFloor: 200 },
    });

    const after = await planGenerate();
    expect(c18Count(after)).toBe(3); // 底线 200 亿：三方案全部击穿
    expect(c18Count(after)).toBeGreaterThan(c18Count(before));
    expect(after.schemes[0]?.problems.some((p) => p.ruleRef === "C18" && p.title?.includes("200"))).toBe(true);

    // 同一条 C18 的两个消费口径同源（否则同一规则在 S&OP 与方案生成里各说各话）。
    const stored = await storedParams(t);
    expect((stored.sop as { cashFloor: number }).cashFloor).toBe(200);
    expect(((stored.planGenerate as { targets: { cashFloor: number } }).targets).cashFloor).toBe(200);
  });
});

describe("规则即引用 P4 · 单源不并存（同值副本已清）", () => {
  it("solver_params 种子值全部从规则派生 —— 不是第二份同值字面量", async () => {
    const ruleParam = (k: string, p: string) => BATTERY_RULES.find((r) => r.key === k)?.params?.[p];
    const certFactors = BATTERY_SOLVER_PARAMS.certFactors as Record<string, number>;
    const health = BATTERY_SOLVER_PARAMS.health as Record<string, number>;
    const sop = BATTERY_SOLVER_PARAMS.sop as Record<string, number>;
    expect(certFactors["量产"]).toBe(ruleParam("C04", "productionFactor"));
    expect(certFactors["认证中"]).toBe(ruleParam("C04", "pendingCertFactor"));
    expect(health.staleHours).toBe(ruleParam("C09", "staleHours"));
    expect(health.degraded).toBe(ruleParam("C09", "degradedFactor"));
    expect(sop.cashFloor).toBe(ruleParam("C18", "cashFloor"));
    expect((BATTERY_SOLVER_PARAMS.planGenerate as { targets: { cashFloor: number } }).targets.cashFloor).toBe(ruleParam("C18", "cashFloor"));
    expect(sop.dvThreshold).toBe(ruleParam("C21", "balanceDeviationPct"));
    // health.normal 刻意**不**归规则：它是 M11 校准参数 p90_health(path=health.normal) 的靶子，
    // 规则再声明一份 normalFactor 就是第二个写者 + 新诱饵 → 已从 C09.params 删除。
    expect(ruleParam("C09", "normalFactor")).toBeUndefined();
  });

  it("被真消费的 params 才留：C11/C22/C25 的同值副本（阈值已在 expression 里）已删", async () => {
    const params = (k: string) => BATTERY_RULES.find((r) => r.key === k)?.params ?? {};
    expect(params("C11")).toEqual({}); // 曾 { minBufferDays: 3 }，与 expression 的 3 同值、全仓无人读
    expect(params("C22")).toEqual({}); // 曾 { maxChangeoverMin: 120 }
    expect(params("C25")).toEqual({}); // 曾 { assumeTolerancePct: 0.05 }
    expect(params("C02")).toEqual({}); // 曾 { tolerancePct: 0.05 }，求解器无对应口径
    // 反面：被绑定的仍在（它们是真源，不是副本）。
    for (const b of RULE_PARAM_BINDINGS) expect(params(b.ruleKey)[b.param]).toBeTypeOf("number");
  });

  it("种子期零写入：规则与 solver_params 本就同源同值 → 发布不空转参数版本（R6 字节一致不破）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const rec = await t.repos.solverParams.get("demo", "spar_demo");
    expect(rec?.version).toBe(1); // 只有 seedBatteryParamsAndSpecs 那一次写入
  });

  it("未绑定的规则发布不碰 solver_params（作用域最小化）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const v0 = (await t.repos.solverParams.get("demo", "spar_demo"))?.version;
    await editRule(t, { key: "C03", name: "产能上限约束", expression: "Order.demandDelta > 0.3", scopeObjectTypes: ["Order"], severity: "BLOCK", params: {} });
    expect((await t.repos.solverParams.get("demo", "spar_demo"))?.version).toBe(v0);
  });
});

describe("规则即引用 P4 · 投影纯函数的诚实边界", () => {
  it("父容器不存在 → 跳过（R14：非本场景包租户零副作用，不凭空造参数结构）", () => {
    const { params, changes } = applyRuleParamBindings({ unrelated: 1 }, [{ key: "C09", params: { staleHours: 9 } }]);
    expect(changes).toEqual([]);
    expect(params).toEqual({ unrelated: 1 });
  });

  it("非数值 param 跳过（params 契约允许 string/string[]，那些不是数值阈值）", () => {
    const src = { health: { normal: 0.93, degraded: 0.9, staleHours: 2 } };
    const { params, changes } = applyRuleParamBindings(src, [{ key: "C09", params: { staleHours: "两小时" } }]);
    expect(changes).toEqual([]);
    expect((params.health as Record<string, number>).staleHours).toBe(2);
  });

  it("只改被绑定的叶子，同层其它子键原样保留（浅合并存储下防冲键）+ 入参不被改写", () => {
    const src = { health: { normal: 0.93, degraded: 0.9, staleHours: 2 }, other: { a: 1 } };
    const { params, changes } = applyRuleParamBindings(src, [{ key: "C09", params: { staleHours: 1, degradedFactor: 0.5 } }]);
    expect(changes.map((c) => c.path).sort()).toEqual(["health.degraded", "health.staleHours"]);
    expect(params.health).toEqual({ normal: 0.93, degraded: 0.5, staleHours: 1 });
    expect(params.other).toBe(src.other); // 未触及子树共享引用
    expect(src.health).toEqual({ normal: 0.93, degraded: 0.9, staleHours: 2 }); // 入参一字不动
  });
});
