import { describe, expect, it } from "vitest";
import { ADMIN, invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";
import { OUTSOURCE_REDLINE, RULE_PARAM_BINDINGS } from "@platform/contracts";
import { BATTERY_RULES } from "../src/synthetic/battery.js";

/**
 * WO-RULE-EXPR-PARAMS · **接缝驱动测试**（闭 G-C08-EXPR-PARAM-SPLIT）
 *
 * ── 这条接缝是什么 ────────────────────────────────────────────────────────────
 * 一条规则的阈值有**两个消费维**：
 *   · 数据/算数维：`rule.params` --RULE_PARAM_BINDINGS--> `solver_params` --> 求解器算数
 *   · 引擎/判定维：`rule.expression` --规则 DSL 求值--> PASS/WARN/BLOCK
 * 病灶（真实·测试全绿盖住了）：DSL **只能写字面量**，于是同一个阈值在一条规则上写了**两遍**
 * （expression 里一遍、params 里一遍），二者可各自编辑、谁也不校验谁。管理员改 params 把现金底线
 * 从 50 提到 70，求解器立刻按 70 算，而**同一条规则的判定**仍按 expression 里那个 50 走。
 *
 * ── 为什么老测试抓不到（这条最重要，别再犯）─────────────────────────────────
 * `rules-param-binding.test.ts` 的每个用例都**同时**改 expression 和 params（注释里写着
 * 「同时把 expression 里的同一阈值改掉，保持规则自洽」）—— 那正好把接缝**绕过去**了：
 * 它证明的是"两边一起改，结论跟着变"，而用户实际做的是"只改一个阈值"。
 *
 * ── 本文件的头号判据 ─────────────────────────────────────────────────────────
 * **只改 `params`，一个字都不碰 `expression`**（每个用例都断言 expression 字节未变），
 * 然后要求：① 规则判定跟着翻转（引擎维）②求解器算数跟着变（数据维）③用户可见结论跟着变。
 * 任一维不动 = 接缝没通 = 本单退回。
 */

type EvaluatedRule = { key: string; outcome: string; expression: string };

async function evaluated(t: TestApp, solverKey: string, args: Record<string, unknown>): Promise<EvaluatedRule[]> {
  const res = await invokeSolver(t, solverKey, args);
  expect(res.statusCode, res.body).toBe(200);
  return (res.json().data.evaluatedRules ?? []) as EvaluatedRule[];
}
const outcomeOf = (rs: EvaluatedRule[], key: string) => rs.find((r) => r.key === key)?.outcome;

/** 出厂种子里这条规则的 expression（"没被改过"的基准线）。 */
const seedExpression = (key: string): string => {
  const e = BATTERY_RULES.find((r) => r.key === key)?.expression;
  if (!e) throw new Error(`场景包缺规则 ${key}`);
  return e;
};

/** 当前**已发布**版本的 expression（用于断言"我没动表达式"）。 */
async function publishedExpression(t: TestApp, key: string): Promise<string> {
  const rows = await t.repos.rules.list("demo", (r) => r.key === key && r.status === "PUBLISHED");
  expect(rows.length, `${key} 应恰有一条已发布版本`).toBe(1);
  return (rows[0] as { expression: string }).expression;
}

/**
 * **只改命名阈值**发新版：expression 原样沿用当前已发布版本（逐字节复制，不重写）。
 * 这就是本文件的手术刀 —— 用户在规则编辑器里改一个数就是这个动作。
 */
async function republishParamsOnly(t: TestApp, key: string, params: Record<string, number>): Promise<string> {
  const rows = await t.repos.rules.list("demo", (r) => r.key === key && r.status === "PUBLISHED");
  const current = rows[0] as { name: string; expression: string; severity: string; scopeObjectTypes: string[] };
  const created = await t.app.inject({
    method: "POST",
    url: "/a/v1/rules",
    headers: ADMIN,
    payload: {
      key,
      name: current.name,
      expression: current.expression, // ← 一个字都不改
      scopeObjectTypes: current.scopeObjectTypes,
      severity: current.severity,
      params,
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  const pub = await t.app.inject({ method: "POST", url: `/a/v1/rules/${created.json().id}/publish`, headers: ADMIN, payload: {} });
  expect(pub.statusCode, pub.body).toBe(200);
  return current.expression;
}

const storedParams = async (t: TestApp): Promise<Record<string, unknown>> =>
  ((await t.repos.solverParams.get("demo", "spar_demo"))?.params ?? {}) as Record<string, unknown>;

// 现金垫 60 亿：出厂底线 50 下合规，底线提到 70 后击穿 —— 一个夹在两值之间的观测点。
const PLAN_AUDIT_ARGS = { dem: 100, seg_pas: 40, seg_ess: 35, seg_com: 25, sup: 90, ltaCov: 0.9, kitGap: 5, gmTarget: 20, cashCushion: 60, capex: 12 };

describe("WO-RULE-EXPR-PARAMS · 接缝：只改 params → 判定维与数据维同时跟着变", () => {
  it("SEAM-1 · C18 现金底线：expression 逐字节未变，只把 params.cashFloor 50→70 → 规则判定 PASS→BLOCK 且 solver_params 两处口径同步", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 出厂态：expression 引用命名阈值（不是写死的 50）—— 这是本单改动的**结构前提**。
    const expr0 = await publishedExpression(t, "C18");
    expect(expr0).toBe(seedExpression("C18"));
    expect(expr0).toContain("params.cashFloor");
    expect(expr0).not.toMatch(/\d/); // 表达式里不含任何数字字面量 = 阈值没有第二份

    // 基线：现金垫 60 ≥ 底线 50 → C18 通过。
    expect(outcomeOf(await evaluated(t, "plan_audit", PLAN_AUDIT_ARGS), "C18")).toBe("PASS");

    // 手术：只改阈值。
    const exprUsed = await republishParamsOnly(t, "C18", { cashFloor: 70 });
    expect(exprUsed).toBe(expr0); // 复核：确实是拿旧表达式原样重发
    expect(await publishedExpression(t, "C18")).toBe(expr0); // 落库后仍逐字节相同

    // ① 引擎维：同一批输入，判定翻转（这一维在修复前**纹丝不动**——正是本单要闭的缺口）。
    expect(outcomeOf(await evaluated(t, "plan_audit", PLAN_AUDIT_ARGS), "C18")).toBe("BLOCK");
    // ② 数据维：C18 的两个消费口径同步（RULE_PARAM_BINDINGS 投影）。
    const stored = await storedParams(t);
    expect((stored.sop as { cashFloor: number }).cashFloor).toBe(70);
    expect((stored.planGenerate as { targets: { cashFloor: number } }).targets.cashFloor).toBe(70);
  });

  it("SEAM-2 · C08 外协红线三跳：只改 params.outsourceRatioMax → 规则判定翻转 + what-if 拒绝翻转 + 用户可见文案里的百分数跟着变", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const expr0 = await publishedExpression(t, "C08");
    expect(expr0).toBe(seedExpression("C08"));
    expect(expr0).toBe(`${OUTSOURCE_REDLINE.subject} > params.${OUTSOURCE_REDLINE.paramKey}`);

    // 基线①（引擎维）：外协占比 = 80/400 = 红线本身，严格 `>` 不越线 → PASS。
    const splitArgs = { gap: 100, totalDemand: 400 };
    expect(outcomeOf(await evaluated(t, "outsourcing_split", splitArgs), "C08")).toBe("PASS");
    // 基线②（数据维 · 用户可见）：what-if 外协 10% 在 20% 红线下被接受。
    const wiArgs = { modelId: "4680-NCM", qty: 40, weeks: 6, whatIf: { nightShifts: 2, extraChannels: 4, outsourceRatio: 0.1 } };
    const wi0 = (await invokeSolver(t, "capacity_forecast", wiArgs)).json().data.whatIf as Record<string, unknown>;
    expect(wi0.rejected).toBe(false);

    // 手术：红线 20% → 5%，expression 一个字不改。
    await republishParamsOnly(t, "C08", { [OUTSOURCE_REDLINE.paramKey]: 0.05 });
    expect(await publishedExpression(t, "C08")).toBe(expr0);

    // ① 引擎维：0.2 > 0.05 → PASS 翻 WARN。
    expect(outcomeOf(await evaluated(t, "outsourcing_split", splitArgs), "C08")).toBe("WARN");
    // ② 数据维：新接的绑定把 whatIf.outsourceMax 变成 C08 的派生副本（此前该 param 零消费方 = 诱饵）。
    expect((await storedParams(t)).whatIf).toMatchObject({ outsourceMax: 0.05 });
    // ③ 用户可见维：同一个 what-if 从"接受"变"拒绝"，且拒绝文案里的红线百分数是新的那个数。
    const wi1 = (await invokeSolver(t, "capacity_forecast", wiArgs)).json().data.whatIf as Record<string, unknown>;
    expect(wi1.rejected).toBe(true);
    expect(wi1.ruleRef).toBe("C08");
    expect(String(wi1.reason)).toContain("红线 5%");
  });

  it("SEAM-3 · C09/C21 同形：只改 params 即改判定（证明这是机制而非给某条规则打的补丁）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // C09：demo 关键数据源最大延迟 1.8h。阈值 2h → PASS；只把 staleHours 改 1 → WARN。
    const capArgs = { modelId: "4680-NCM", demandDelta: 0.2, weeks: 6 };
    expect(outcomeOf(await evaluated(t, "capacity_forecast", capArgs), "C09")).toBe("PASS");
    const c09Expr = await publishedExpression(t, "C09");
    await republishParamsOnly(t, "C09", { staleHours: 1, degradedFactor: 0.9 });
    expect(await publishedExpression(t, "C09")).toBe(c09Expr);
    expect(outcomeOf(await evaluated(t, "capacity_forecast", capArgs), "C09")).toBe("WARN");

    // C21：S&OP 步骤 2 的越线判定（+20% 偏差）。阈值 10% → 越线；只把阈值改 30% → 不越线。
    const segments = [{ key: "pas", name: "乘用车", target: 100, rolling: 120, lastActual: 100 }];
    const runStep2 = async () => {
      const created = await t.app.inject({ method: "POST", url: "/a/v1/sop/versions", headers: ADMIN, payload: { month: "2026-07" } });
      const id = (created.json() as { id: string }).id;
      await t.app.inject({ method: "POST", url: `/a/v1/sop/versions/${id}/advance`, headers: ADMIN, payload: { step: 1, payload: {} } });
      const res = await t.app.inject({ method: "POST", url: `/a/v1/sop/versions/${id}/advance`, headers: ADMIN, payload: { step: 2, payload: { segments } } });
      expect(res.statusCode, res.body).toBe(200);
      return res.json() as { steps: { s2: { rows: { key: string; flagged: boolean }[] } } };
    };
    expect((await runStep2()).steps.s2.rows.find((r) => r.key === "pas")?.flagged).toBe(true);
    const c21Expr = await publishedExpression(t, "C21");
    await republishParamsOnly(t, "C21", { balanceDeviationPct: 0.3 });
    expect(await publishedExpression(t, "C21")).toBe(c21Expr);
    expect((await runStep2()).steps.s2.rows.find((r) => r.key === "pas")?.flagged).toBe(false);
  });
});

describe("WO-RULE-EXPR-PARAMS · 诚实缺席（不静默兜底）", () => {
  it("引用了未声明的命名阈值 → 创建即 400 拒绝（而不是让它以哑弹形态发布）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/rules",
      headers: ADMIN,
      payload: { key: "PX1", name: "缺阈值", expression: "Order.qty > params.maxQty", scopeObjectTypes: ["Order"], severity: "WARN", params: {} },
    });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().error.message).toContain("params.maxQty");
  });

  it("params.<名> 不会静默回退到载荷同名字段（那是「看着合理的默认值」式兜底）", async () => {
    const t = await makeApp();
    // 载荷里放一个同名 cashFloor 诱饵：若 params 引用被当作普通字段路径解析，前缀可省回退会把它取走。
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/rules/dry-run",
      headers: ADMIN,
      payload: { expression: "AnnualScenario.cashCushion < params.cashFloor", samplePayload: { AnnualScenario: { cashCushion: 40 }, cashFloor: 999 } },
    });
    expect(res.statusCode, res.body).toBe(200);
    // 没提供 params → 诚实报错，绝不用载荷里那个 999 求出一个"看着对"的 violated=true。
    expect(res.json().ok).toBe(false);
    expect(res.json().error.message).toContain("params.cashFloor");
  });

  it("dry-run 提供 params 时正常求值（编辑器「测试」按钮与生产判定同一套解析）", async () => {
    const t = await makeApp();
    const call = (params: Record<string, number>) =>
      t.app.inject({
        method: "POST",
        url: "/a/v1/rules/dry-run",
        headers: ADMIN,
        payload: { expression: "AnnualScenario.cashCushion < params.cashFloor", samplePayload: { AnnualScenario: { cashCushion: 40 } }, params },
      });
    expect((await call({ cashFloor: 50 })).json()).toMatchObject({ ok: true, violated: true });
    expect((await call({ cashFloor: 30 })).json()).toMatchObject({ ok: true, violated: false });
  });
});

describe("WO-RULE-EXPR-PARAMS · 阈值单源不变量（防回潮）", () => {
  it("被 RULE_PARAM_BINDINGS 绑定的规则，其 expression 里不得再出现该阈值的字面量副本", async () => {
    for (const b of RULE_PARAM_BINDINGS) {
      const rule = BATTERY_RULES.find((r) => r.key === b.ruleKey);
      if (!rule) continue;
      const declared = rule.params?.[b.param];
      if (typeof declared !== "number") continue;
      // 该阈值的数值不得以字面量形式出现在表达式里（那就是第二份可各自编辑的拷贝）。
      expect(rule.expression, `${b.ruleKey} 的 expression 里仍写着 ${b.param} 的字面量副本`).not.toContain(String(declared));
    }
  });

  it("C04 例外有据：分类谓词 + 系数型 params，本就没有可分叉的阈值", () => {
    const c04 = BATTERY_RULES.find((r) => r.key === "C04");
    expect(c04?.expression).toBe("Line.certStatus != '量产'");
    expect(c04?.expression).not.toContain("params."); // 不该硬塞一个假阈值进去
    expect(Object.keys(c04?.params ?? {}).sort()).toEqual(["pendingCertFactor", "productionFactor"]);
  });
});
