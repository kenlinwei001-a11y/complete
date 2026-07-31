import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, debugUser, ADMIN, type TestApp } from "./helpers.js";
import { installReadRecorder, observedReadSurface } from "./ontology-signature.recorder.js";
import { SOLVER_ONTOLOGY_SIGNATURES, mergeReadSurfaces } from "../src/solvers/ontology-signature.js";
import type { OntologyReadSurface } from "@platform/contracts";
import type { AuthCtx, ObjectInstance } from "../src/domain.js";

/**
 * WO-69 P2 · Function 本体签名 —— SEAM（接缝驱动）测试。
 *
 * 头号判据 **S5「实跑比对」**：签名必须与**实际读写**一致，不是文档。
 *   本仓已有多具「手写清单 vs 实现漂移」的尸体（漂了没人知道，直到线上出错数）。所以本门**不读代码、不读注释**：
 *   真跑一遍求解器 → 用记录器（`ontology-signature.recorder.ts`：拦 listByType + props Proxy）观测
 *   **真被读到的对象类型与属性** → 与 `SOLVER_ONTOLOGY_SIGNATURES` 的声明比对。
 *   判红方向 = **漏声明**（观测 ⊄ 声明）：漏声明 → 守卫误判"不读受限类型" → 放行 → 出错数字（静默污染，比崩溃毒）。
 *   过度声明只导致多拒（安全方向），故不判红，但会打印出来防止签名长草。
 *
 * S6：签名里的每个 typeKey/propKey/linkKey 必须能在**已发布本体**里解析——不许自造命名。
 * S7-narrow：P2 的收益本身——受限调用者对**不读受限类型**的求解器现在拿到真数字（P1 粗守卫一律 403），
 *            对**真读受限列**的求解器仍然 403（绝不出错数字），**无签名**的求解器保守 403。
 * S8-compat：admin / 无列级策略调用者 —— 逐字节现行为（P1 的 S4 底线在 P2 之后必须仍然成立）。
 */

/** 受限角色（种子策略见 synthetic/service.ts seedPolicies）：Material.unitPrice 既不可读也不可写。 */
const OPERATOR = debugUser("demo", "operator1", "line_operator");

/**
 * S5 实跑样本：每条 = 一个已签名求解器 + 一组能真正跑通的入参。
 * 覆盖 ⑩ 洞（早返回·自建 ctx）与 compute() 两条读路径。
 */
const S5_FIXTURES: { key: string; args: Record<string, unknown> }[] = [
  // ⑩ 洞（早返回求解器，直取 repos.objects.listByType，不经 loadContext 列投影）
  { key: "gap_attribution", args: { metricKey: "market_share" } },
  { key: "gap_attribution", args: { metricKey: "gross_margin" } },
  { key: "plan_rootcause", args: {} },
  { key: "concentration_risk", args: { startType: "Customer", path: [{ viaField: "orderRef", toType: "Order" }] } },
  { key: "margin_attribution", args: { targetType: "Order", revenueField: "revenue", costFields: [{ field: "matCost" }] } },
  { key: "metric_rollup", args: {} },
  { key: "cockpit_kpi", args: {} },
  { key: "ksf_graph", args: {} },
  { key: "finance_pnl", args: {} },
  { key: "mrp_netting", args: {} },
  // compute() 路径（经 loadContext）
  { key: "capacity_rollup", args: {} },
  { key: "capacity_forecast", args: { modelId: "4680-NCM", qty: 1000, weeks: 6 } },
  { key: "bottleneck_matrix", args: {} },
  { key: "risk_timeline", args: { days: 30 } },
  { key: "counterfactual_timeline", args: { days: 30 } },
  { key: "affected_orders", args: {} },
  { key: "audit_timeline", args: {} },
  // E6b 扩展族
  { key: "quote_margin", args: {} },
  { key: "credit_exposure", args: {} },
];

/** 声明侧的有效读取面 = 静态 reads ∪ resolveReads(入参/数据)。 */
async function declaredReads(
  key: string,
  args: Record<string, unknown>,
  listByType: (t: string) => Promise<ObjectInstance[]>,
): Promise<OntologyReadSurface[]> {
  const sig = SOLVER_ONTOLOGY_SIGNATURES[key];
  if (!sig) throw new Error(`no signature: ${key}`);
  const dyn = sig.resolveReads ? await sig.resolveReads({ args, listByType }) : [];
  return mergeReadSurfaces([...(sig.reads ?? []), ...dyn]);
}

describe("WO-69 P2 · Function 本体签名", () => {
  // ── S5（头号）：实跑观测 vs 声明 ─────────────────────────────────────────────
  it("S5 实跑比对：每个已签名求解器真读到的类型/属性都在声明内（漏声明即红）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const ctx: AuthCtx = t.adminCtx;
    const listByType = (typeKey: string) => t.repos.objects.listByType(ctx.tenantId, typeKey);

    const violations: string[] = [];
    const overDeclared: string[] = [];
    let compared = 0;

    for (const f of S5_FIXTURES) {
      const declared = await declaredReads(f.key, f.args, listByType);
      const declaredByType = new Map(declared.map((d) => [d.typeKey, d]));

      const { rec, restore } = installReadRecorder(t);
      try {
        await t.services.solvers.invoke(ctx, f.key, f.args);
      } finally {
        restore();
      }
      const observed = observedReadSurface(rec);
      compared++;

      const label = `${f.key}(${JSON.stringify(f.args)})`;
      for (const [typeKey, props] of observed) {
        const d = declaredByType.get(typeKey);
        if (!d) {
          violations.push(`${label}: 真读了未声明的对象类型 **${typeKey}**（读到属性 ${[...props].sort().join("/")}）`);
          continue;
        }
        if (d.propKeys === undefined) continue; // 声明为"全属性" → 任何属性都在声明内
        const missing = [...props].filter((p) => !d.propKeys!.includes(p)).sort();
        if (missing.length > 0) {
          violations.push(`${label}: 类型 ${typeKey} 真读了未声明的属性 **${missing.join(", ")}**`);
        }
      }
      // 过度声明（声明了但本次实跑没读到）——安全方向，不判红，只播报防长草。
      for (const d of declared) {
        if (!observed.has(d.typeKey)) overDeclared.push(`${label}: ${d.typeKey}`);
      }
    }

    // eslint-disable-next-line no-console
    if (overDeclared.length > 0) console.log(`[S5] 保守多声明（本次实跑未触及·非红）：\n  ${overDeclared.join("\n  ")}`);
    expect(compared).toBe(S5_FIXTURES.length);
    expect(violations, `S5 实跑比对失败（签名漏声明 → 守卫会误放行 → 出错数字）：\n${violations.join("\n")}`).toEqual([]);
  }, 300_000);

  it("S5 比对逻辑有牙（自证非空转）：拿一份删掉真读属性的假声明去比，必判违规", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const ctx: AuthCtx = t.adminCtx;
    const { rec, restore } = installReadRecorder(t);
    try {
      await t.services.solvers.invoke(ctx, "quote_margin", {});
    } finally {
      restore();
    }
    const observed = observedReadSurface(rec);
    // 观测必须真的看见 Material.unitPrice —— 这是 WO-69 的原病例（受限用户曾拿到 margin 0.868 / 真值 0.2565）。
    expect(observed.has("Material")).toBe(true);
    expect([...observed.get("Material")!]).toContain("unitPrice");
    // 反证比对逻辑有牙：拿一份"删掉 unitPrice"的假声明去比，必须判出违规。
    const mutated = [{ typeKey: "Material", propKeys: ["bomUnit"] }];
    const byType = new Map(mutated.map((d) => [d.typeKey, d]));
    const missing = [...observed.get("Material")!].filter((p) => !byType.get("Material")!.propKeys.includes(p));
    expect(missing).toContain("unitPrice");
  }, 300_000);

  // ── S6：命名必须在已发布本体里解析 ───────────────────────────────────────────
  it("S6 不许自造命名：签名里的 typeKey / propKey / linkKey 全部能在已发布本体解析", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const ctx: AuthCtx = t.adminCtx;
    const types = await t.services.ontology.listTypes(ctx);
    const propsByType = new Map(
      types.map((ty) => [
        ty.key,
        new Set([...ty.properties.map((p) => p.propKey), ...(ty.derivedProperties ?? []).map((p) => p.propKey)]),
      ]),
    );
    const linkKeys = new Set((await t.repos.ontologyLinks.list(ctx.tenantId)).map((l) => l.key));

    const bad: string[] = [];
    for (const [solverKey, sig] of Object.entries(SOLVER_ONTOLOGY_SIGNATURES)) {
      for (const surface of [...(sig.reads ?? []), ...(sig.writes ?? [])]) {
        const known = propsByType.get(surface.typeKey);
        if (!known) {
          bad.push(`${solverKey}: 对象类型 "${surface.typeKey}" 在已发布本体中不存在`);
          continue;
        }
        for (const p of surface.propKeys ?? []) {
          if (!known.has(p)) bad.push(`${solverKey}: ${surface.typeKey}.${p} 在已发布本体中不存在`);
        }
        for (const l of (surface as OntologyReadSurface).linkKeys ?? []) {
          if (!linkKeys.has(l)) bad.push(`${solverKey}: 链路 "${l}" 在已发布本体中不存在`);
        }
      }
    }
    expect(bad, `S6 失败（签名引用了本体里不存在的名字）：\n${bad.join("\n")}`).toEqual([]);
    // 门本身非空转：确实校验了不止一个类型。
    expect(Object.keys(SOLVER_ONTOLOGY_SIGNATURES).length).toBeGreaterThanOrEqual(8);
  }, 300_000);

  // ── S7-narrow：P2 的收益 —— 收窄而不放水 ─────────────────────────────────────
  it("S7-narrow (a) 受限调用者 × 不读受限类型的求解器 → 200 真数字（P1 粗守卫下这里是 403）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/solvers/metric_rollup/invoke",
      headers: OPERATOR,
      payload: { args: {} },
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { metrics: { metricId: string; actual: number }[]; total?: number } }).data;
    expect(data.metrics.length).toBeGreaterThan(0);
    // 「真数字」：不是空壳、不是全 0 —— 否则就是另一种"装成答案的非答案"。
    expect(data.metrics.some((m) => Number.isFinite(m.actual) && m.actual !== 0)).toBe(true);
  });

  it("S7-narrow (b) 受限调用者 × 真读受限列的求解器 → 仍 403 SOLVER_COLUMN_RESTRICTED（绝不出错数字）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/solvers/quote_margin/invoke",
      headers: OPERATOR,
      payload: { args: {} },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("SOLVER_COLUMN_RESTRICTED");
    expect(body.error.message).toContain("Material");
  });

  it("S7-narrow (c) **无签名 = 读取面未知 → 拒**（未知 ≠ 安全；这条塌了整个收窄就是放水）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // capex_scenario 刻意未签名（读取面未经实跑比对）→ 受限调用者必须被拒。
    expect(SOLVER_ONTOLOGY_SIGNATURES.capex_scenario).toBeUndefined();
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/solvers/capex_scenario/invoke",
      headers: OPERATOR,
      payload: { args: { scenario: "baseline" } },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe("SOLVER_COLUMN_RESTRICTED");
  });

  it("S7-narrow (d) 属性级精度：禁的列**不在**求解器读取面 → 放行；禁的列**在**读取面 → 拒", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const tenantId = t.adminCtx.tenantId;
    // metric_rollup 声明只读 Metric 的 12 个属性（不含 businessType）。
    const put = async (denyRead: string[]) => {
      await t.repos.policies.put({
        id: "pol_demo_object_type_metric_col",
        tenantId,
        resource: { kind: "OBJECT_TYPE", key: "Metric" },
        grants: [{ role: "line_operator", ops: ["READ"] }],
        propertyPolicy: { denyRead },
      });
    };
    const call = () =>
      t.app.inject({ method: "POST", url: "/a/v1/solvers/metric_rollup/invoke", headers: OPERATOR, payload: { args: {} } });

    await put(["businessType"]); // 读取面之外 → 放行
    const ok = await call();
    expect(ok.statusCode).toBe(200);

    await put(["actual"]); // 读取面之内（metric_rollup 真读 Metric.actual）→ 拒
    const denied = await call();
    expect(denied.statusCode).toBe(403);
    expect((denied.json() as { error: { code: string } }).error.code).toBe("SOLVER_COLUMN_RESTRICTED");
  });

  it("S7-narrow (e) 声明读取面里有**整型不可读**的类型 → 拒（不许拿空集/原始数据算出个数来）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // line_operator 在 Order/Base 上**没有任何 grant**（种子策略只授 admin/planner/base_manager）。
    // gap_attribution 声明读 Order/Base：
    //   · 它是 ⑩ 洞早返回求解器 → 直取 repos 原始数据，连列投影都不经 → 继续算就是**把无权读的行算进结果**；
    //   · 换成 loadContext 路径则退化成空集 → 算得出数字但是错的。
    // 两种都是「装成真的假答案」，故必须拒。
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/solvers/gap_attribution/invoke",
      headers: OPERATOR,
      payload: { args: { metricKey: "market_share" } },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error: { code: string; message: string }; data?: unknown };
    expect(body.error.code).toBe("SOLVER_COLUMN_RESTRICTED");
    expect(body.data, "拒绝时不得夹带任何结果").toBeUndefined();
    // 对照：同一调用者调只读**无策略类型**的 metric_rollup 仍然出真数字（收窄没有被这条规则吃回去）。
    const ok = await t.app.inject({ method: "POST", url: "/a/v1/solvers/metric_rollup/invoke", headers: OPERATOR, payload: { args: {} } });
    expect(ok.statusCode).toBe(200);
  });

  // ── S8：向后兼容（P1 的 S4 底线在 P2 之后仍成立）────────────────────────────
  it("S8-compat admin / 无列级约束调用者 → 逐字节现行为（收窄不许把 admin 卷进来）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // plan_generate 刻意**未签名**（读取面未经实跑比对）—— admin 无列级约束 → 守卫走快路径 → 照常出数。
    for (const key of ["metric_rollup", "quote_margin", "plan_generate", "bottleneck_matrix"]) {
      const res = await t.app.inject({
        method: "POST",
        url: `/a/v1/solvers/${key}/invoke`,
        headers: ADMIN,
        payload: { args: {} },
      });
      expect(res.statusCode, `${key} 对 admin 必须照常出数`).toBe(200);
    }
    // 同一入参重复调用逐字节一致（R6 确定性未被守卫破坏）。
    const a = await t.app.inject({ method: "POST", url: "/a/v1/solvers/bottleneck_matrix/invoke", headers: ADMIN, payload: { args: {} } });
    const b = await t.app.inject({ method: "POST", url: "/a/v1/solvers/bottleneck_matrix/invoke", headers: ADMIN, payload: { args: {} } });
    expect(a.body).toBe(b.body);
  });

  it("S8-compat 无任何列级策略的租户 → 未签名求解器照常可用（守卫不越界）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // planner 在 demo 租户没有任何 propertyPolicy 命中 → columnRestrictedObjectTypes 为空 → 快路径。
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/solvers/plan_generate/invoke",
      headers: debugUser("demo", "p1", "planner"),
      payload: { args: {} },
    });
    expect(res.statusCode).toBe(200);
  });

  // ── 目录 / DRIL：签名只有一份，下游全是派生 ────────────────────────────────
  it("目录投影：solverRegistry 附带 ontologySignature（DRIL inputSpec 的唯一派生源）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({ method: "GET", url: "/a/v1/solvers/registry", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const solvers = (res.json() as { solvers: { key: string; ontologySignature?: { reads?: { typeKey: string }[] } }[] }).solvers;
    const qm = solvers.find((s) => s.key === "quote_margin")!;
    expect(qm.ontologySignature?.reads?.map((r) => r.typeKey)).toContain("Material");
    // 未签名的求解器**不附字段**（诚实空缺，而不是"读取面为空"）。
    expect(solvers.find((s) => s.key === "capex_scenario")?.ontologySignature).toBeUndefined();
  });
});
