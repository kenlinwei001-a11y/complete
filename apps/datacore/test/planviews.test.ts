import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AopResponseSchema,
  GraphOptionsSchema,
  MappingRowSchema,
  MappingRegistriesSchema,
  OrderProblemGroupSchema,
  QuarterlyResponseSchema,
} from "@platform/contracts";
import { makeApp, seedBattery, invokeSolver, ADMIN, PLANNER, type TestApp } from "./helpers.js";
import { round } from "../src/prng.js";

async function aop(t: TestApp) {
  const res = await t.app.inject({ method: "GET", url: "/a/v1/plan/aop?year=2026", headers: ADMIN });
  expect(res.statusCode).toBe(200);
  return AopResponseSchema.parse(res.json());
}

describe("剩余视图增量 · 计划域（§7.14/§7.15）", () => {
  it("F21/AOP: 三情景（基准已拍板）+ C18/C23 走规则引擎 + 已触发挂牌行 + 年→季→月分解", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const body = await aop(t);

    // 三情景卡：保守/基准/激进，基准 finalized
    expect(body.scenarios.map((s) => s.key)).toEqual(["conservative", "baseline", "aggressive"]);
    const baseline = body.scenarios[1]!;
    expect(baseline.finalized).toBe(true);
    expect(baseline.finalizedAt).toBeTruthy();
    expect(baseline.demand).toBeGreaterThan(0);
    expect(baseline.finance.revenue).toBeGreaterThan(0);
    // 规则校验行来自真实 A5 引擎：激进情景 C18（现金 42 < 50）与 C23（CAPEX 27 ≥ 10）不通过
    const aggressive = body.scenarios[2]!;
    const c18 = aggressive.ruleChecks.find((r) => r.ruleKey === "C18")!;
    expect(c18.passed).toBe(false);
    expect(c18.explanation).toContain("AnnualScenario.cashCushion < 50");
    expect(aggressive.ruleChecks.find((r) => r.ruleKey === "C23")!.passed).toBe(false);
    expect(body.scenarios[0]!.ruleChecks.every((r) => r.passed)).toBe(true);

    // 触发条件挂牌表：一条 TRIGGERED（带触发时间与通知记录），其余 MONITORING
    const triggered = body.triggers.filter((x) => x.status === "TRIGGERED");
    expect(triggered).toHaveLength(1);
    expect(triggered[0]!.triggeredAt).toBeTruthy();
    expect(triggered[0]!.notifiedTo).toContain("planner");
    expect(body.triggers.filter((x) => x.status === "MONITORING").length).toBeGreaterThanOrEqual(2);

    // 分解流：年 = Σ季 = Σ月（同一目标对象）
    const year = body.decomposition.find((d) => d.level === "year")!;
    const quarters = body.decomposition.filter((d) => d.level === "quarter");
    const months = body.decomposition.filter((d) => d.level === "month");
    expect(quarters).toHaveLength(4);
    expect(months).toHaveLength(12);
    expect(round(quarters.reduce((a, q) => a + q.value, 0), 2)).toBe(year.value);
    expect(round(months.reduce((a, m) => a + m.value, 0), 2)).toBe(year.value);
    expect(year.value).toBe(baseline.demand); // 分解锚定已拍板（基准）情景年需求
  });

  it("F21/同源勾稽: 分解季度值 === S&OP 平衡台目标线（同一 PlanTarget 对象，targetRef 一致）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const body = await aop(t);
    const quarters = body.decomposition.filter((d) => d.level === "quarter");
    const sopLine = await t.services.sop.targetLine("demo", quarters.map((q) => q.period));
    expect(sopLine).toHaveLength(4);
    for (const q of quarters) {
      const sopRow = sopLine.find((r) => r.period === q.period)!;
      expect(sopRow.value).toBe(q.value); // 数值同源
      expect(sopRow.targetRef).toBe(q.targetRef); // 同一对象实例（悬停溯源指向处）
    }
    // S&OP ② 缺省目标线也从同一对象推导（payload 不带 segments 时）
    const created = await t.app.inject({
      method: "POST",
      url: "/a/v1/sop/versions",
      headers: ADMIN,
      payload: { month: "2026-07" },
    });
    const id = (created.json() as { id: string }).id;
    await t.app.inject({ method: "POST", url: `/a/v1/sop/versions/${id}/advance`, headers: ADMIN, payload: { step: 1, payload: {} } });
    const s2 = (
      await t.app.inject({ method: "POST", url: `/a/v1/sop/versions/${id}/advance`, headers: ADMIN, payload: { step: 2, payload: {} } })
    ).json() as { steps: { s2: { rows: { target: number }[]; total: { target: number } } } };
    const month7 = body.decomposition.find((d) => d.period === "2026-07")!;
    expect(round(s2.steps.s2.total.target, 1)).toBe(round(month7.value, 1));
  });

  it("触发判定后端驱动：RULE_SCAN 式扫描把 MONITORING 翻为 TRIGGERED（前端只读）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 收窄 TRG-3 阈值（长协偏差 |>5%| 行存在 → 命中）
    const trg = (await t.repos.objects.listByType("demo", "ScenarioTrigger")).find((x) => x.props.trigId === "TRG-3")!;
    trg.props.expr = "ltaDevMaxAbs > 5";
    await t.repos.objects.put(trg);
    const r = await t.services.plan.scanTriggers("demo");
    expect(r.fired).toContain("TRG-3");
    const body = await aop(t);
    const t3 = body.triggers.find((x) => x.id === "TRG-3")!;
    expect(t3.status).toBe("TRIGGERED");
    expect(t3.triggeredAt).toBeTruthy();
    expect((await t.repos.outboxEvents.list("demo")).some((e) => e.event === "scenario.trigger_fired")).toBe(true);
  });

  it("F21/拍板情景：AOP情景拍板 Action（EXECUTED 后才落库），act.aop-finalize 已注册", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const reg = (await t.app.inject({ method: "GET", url: "/a/v1/features/registry", headers: ADMIN })).json() as { key: string }[];
    expect(reg.some((f) => f.key === "act.aop-finalize")).toBe(true);

    const created = await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: PLANNER,
      payload: { actionTypeKey: "AOP情景拍板", payload: { scenarioKey: "aggressive", year: 2026 } },
    });
    expect(created.statusCode).toBe(201);
    const draftId = (created.json() as { draftId: string }).draftId;
    // 审批前不落库
    expect((await aop(t)).scenarios.find((s) => s.key === "aggressive")!.finalized).toBe(false);
    const done = (
      await t.app.inject({ method: "POST", url: `/a/v1/action-drafts/${draftId}/approve`, headers: ADMIN, payload: {} })
    ).json() as { status: string; executionResult: { targetRef: string } };
    expect(done.status).toBe("EXECUTED");
    expect(done.executionResult.targetRef).toBe("AOP-2026-aggressive");
    const after = await aop(t);
    expect(after.scenarios.find((s) => s.key === "aggressive")!.finalized).toBe(true);
    expect(after.scenarios.find((s) => s.key === "baseline")!.finalized).toBe(false);
  });

  it("F22/quarterly: 缺口三档（红>4/黄>0/绿≤0）、需求=分解×滚动修正、长协 −8% 行带 baseId", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({ method: "GET", url: "/a/v1/plan/quarterly?n=6", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const body = QuarterlyResponseSchema.parse(res.json());
    expect(body.rows).toHaveLength(6);
    expect(body.rows[0]!.q).toBe("2026-Q2"); // forecastStart 所在季度起
    for (const r of body.rows) expect(round(r.dem - r.sup, 2)).toBe(r.gap);
    // 三档齐备
    expect(body.rows.some((r) => r.gap > 4)).toBe(true);
    expect(body.rows.some((r) => r.gap > 0 && r.gap <= 4)).toBe(true);
    expect(body.rows.some((r) => r.gap <= 0)).toBe(true);
    // 需求与年度分解同源：dem(Q3) = PlanTarget(2026-Q2) × (1 + rollingCorrPct[0]=0.02)
    const decomp = (await aop(t)).decomposition.find((d) => d.period === "2026-Q2")!;
    expect(body.rows[0]!.dem).toBe(round(decomp.value * 1.02, 2));
    // 事件注释：检修窗口/交付高峰（规则可点）/已决策增量
    expect(body.rows[0]!.events.some((e) => e.label.includes("检修窗口"))).toBe(true);
    expect(body.rows.some((r) => r.events.some((e) => e.ruleKey === "C03"))).toBe(true);
    expect(body.rows.some((r) => r.events.some((e) => e.label.includes("产能增量")))).toBe(true);
    // 长协执行偏差：恰好一行 |偏差|>5%（−8%），升级供应风险 + 跳转基地
    const over = body.ltaDeviation.filter((r) => Math.abs(r.deviationPct) > 5);
    expect(over).toHaveLength(1);
    expect(over[0]!.deviationPct).toBe(-8);
    expect(over[0]!.baseId).toBeTruthy();
    expect(over[0]!.note).toContain("升级供应风险");
    for (const r of body.ltaDeviation) expect(r.actual).toBe(round(r.planned * (1 + r.deviationPct / 100), 1));
  });

  it("Entitlement: view.annual-scenario 关闭 → /plan/aop 404 FEATURE_NOT_FOUND（先于 authz）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await t.app.inject({
      method: "PUT",
      url: "/a/v1/tenants/demo/features",
      headers: ADMIN,
      payload: { overrides: { "view.annual-scenario": false } },
    });
    const gone = await t.app.inject({ method: "GET", url: "/a/v1/plan/aop?year=2026", headers: ADMIN });
    expect(gone.statusCode).toBe(404);
    expect((gone.json() as { error: { code: string } }).error.code).toBe("FEATURE_NOT_FOUND");
    // quarterly 不受影响
    expect((await t.app.inject({ method: "GET", url: "/a/v1/plan/quarterly", headers: ADMIN })).statusCode).toBe(200);
  });

  it("F23/§S1.5: affected_orders problems[] 确定性归并 + 逐单 4 层根因链（既有字段不变）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 常州基地：多类归并（DELIVERY/KIT/CREDIT），含 KIT（到货晚于交期）
    const run = async () =>
      (await invokeSolver(t, "affected_orders", { baseId: "changzhou", fromDay: 0, toDay: 180 })).json() as {
        data: { affected: { so: string }[]; total: number; fallback: boolean; problems: unknown[] };
      };
    const r1 = await run();
    const r2 = await run();
    expect(r2.data).toEqual(r1.data); // 确定性：同输入同输出
    // 既有输出字段保持
    expect(r1.data.total).toBe(r1.data.affected.length);
    expect(typeof r1.data.fallback).toBe("boolean");
    const problems = z.array(OrderProblemGroupSchema).parse(r1.data.problems);
    expect(problems.length).toBeGreaterThanOrEqual(2); // 非空组才下发
    const sum = problems.reduce((a, p) => a + p.orderCount, 0);
    expect(sum).toBe(r1.data.total); // 每单恰好归并到一类
    for (const p of problems) {
      expect(p.orderCount).toBe(p.rootChains.length);
      expect(p.financeImpact).toBeGreaterThan(0);
      for (const chain of p.rootChains) {
        expect(chain.layers.map((l) => l.kind)).toEqual(["order", "judgement", "rootCause", "remedy"]);
        expect(chain.layers[1]!.label).toMatch(/规则 C/); // 判定层引用规则键
      }
    }
    // 轨R #1：母版 ROOT_LIB 8 根源（credit/cost/frame/crm/lta/maint/ramp/push）。常州（动力/乘用车）出 push（交期越线兜底）/credit；
    // cost 在储能基地（眉山，客户名含「储能/电网」→ess 细分毛利 13%<13.5% 底线 → 成本结构）。frame/crm/lta/ramp/maint 由 override.root 种子真相。
    expect(problems.some((p) => p.category === "push")).toBe(true);
    const meishan = (await invokeSolver(t, "affected_orders", { baseId: "meishan", fromDay: 0, toDay: 180 })).json() as {
      data: { problems: { category: string }[] };
    };
    expect(meishan.data.problems.some((p) => p.category === "cost")).toBe(true);
  });

  it("F27/§7.20: mapping 行按数据域分组排序、血缘 fieldCount 正确、含求解器/Agent 行", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({ method: "GET", url: "/a/v1/ontology/mapping?packageId=pkg_battery_manufacturing", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const rows = z.array(MappingRowSchema).parse(res.json());
    // 分组：同一 domain 连续出现（服务端已分组排序）
    const seen: string[] = [];
    for (const r of rows) {
      if (seen[seen.length - 1] !== r.domain) seen.push(r.domain);
    }
    expect(new Set(seen).size).toBe(seen.length);
    // 血缘 fieldCount = sourceBindings.fieldMappings 字段数
    const order = rows.find((r) => r.objectKey === "Order")!;
    expect(order.lineage.fieldCount).toBe(6);
    expect(order.lineage.dataset).toBe("erp_sales_orders");
    expect(order.sourceSystem).toBe("ERP");
    // catalog §3 C29（排产冻结期）/C33（碳护照）+ 规则即引用补全 C15（经营毛利底线）/C22（换型损失）
    // 作用域含 Order → 映射表含这些行（规则一等化后真定义可见，非"未找到定义"）。
    // QUERY30-RULES（C34–C50）新增 6 条作用域含 Order 的规则：C34 挤占优先级[Order,Line]/C35 ≥2方案门[Order]/
    // C36 锁价现金敞口[Order,Customer]/C37 违约金权衡[Order]/C44 谷段不破交期[EnergyMeter,Order]/C49 断料口径[Shipment,Order]。
    expect(order.rules).toEqual([
      "C03", "C08", "C13", "C15", "C22", "C29", "C33", "C34", "C35", "C36", "C37", "C44", "C49",
    ]);
    expect(order.derivations.some((d) => d.includes("qty * unitPrice"))).toBe(true);
    // 求解器与 Agent 行
    const solverRows = rows.filter((r) => r.kind === "solver");
    expect(solverRows.length).toBe(8); // C1：新增 capex_scenario 年度情景测算求解器
    expect(solverRows.every((r) => r.domain === "solver")).toBe(true);
    expect(rows.filter((r) => r.kind === "agent").map((r) => r.displayName)).toContain("学习Agent");
    // 计划域对象也在映射表（源系统 = 平台·计划域）
    expect(rows.find((r) => r.objectKey === "AnnualScenario")!.sourceSystem).toBe("平台·计划域");
  });

  it("order §4.5-D: affected_orders 聚合明细按交期升序（最早到期最先看）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const out = (await invokeSolver(t, "affected_orders", { fromDay: 0, toDay: 180 })).json() as {
      data: { rows: { so: string; due: string }[] };
    };
    const dues = out.data.rows.map((r) => r.due);
    expect(dues.length).toBeGreaterThan(1);
    expect([...dues].sort()).toEqual(dues); // 交期字符串升序 = dueDay 升序
  });

  it("§4.5-③: mapping/registries 四注册表段（关系类型←本体 / 规则←规则库 / Action·事件←静态种子）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({ method: "GET", url: "/a/v1/ontology/mapping/registries", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const reg = MappingRegistriesSchema.parse(res.json());
    // 关系类型来自真实 OntologyLink（含 model_producible_at N:N）
    expect(reg.linkTypes.length).toBeGreaterThan(0);
    expect(reg.linkTypes.find((l) => l.key === "model_producible_at")?.cardinality).toBe("N:N");
    // 规则来自规则库（含 C03，级别中文化），按 key 升序
    expect(reg.rules.some((r) => r.key === "C03")).toBe(true);
    expect(["阻断", "告警", "提示"]).toContain(reg.rules[0]!.severity);
    expect([...reg.rules].sort((a, b) => (a.key < b.key ? -1 : 1)).map((r) => r.key)).toEqual(reg.rules.map((r) => r.key));
    // Action 4 行 + 事件 3 行（静态种子逐字）
    expect(reg.actions.map((a) => a.name)).toEqual(["采纳产能保障方案", "预警处置方案", "调整排产分配", "定稿月度计划版本"]);
    expect(reg.events.map((e) => e.name)).toEqual(["检修窗口", "交付高峰", "到货间隙"]);
    expect(reg.actions[0]!.check).toContain("C10");
  });

  it("F25/GRAPH-PANORAMA-ONLY: 图谱边带 kind；全景唯一 ViewConfig（七视角+graph-all 零下发·重新加回即红）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const g = (await t.app.inject({ method: "GET", url: "/a/v1/ontology/graph", headers: ADMIN })).json() as {
      nodes: { id: string; kind: string; domain: string }[];
      edges: { kind?: string }[];
    };
    expect(g.edges.length).toBeGreaterThan(0);
    expect(g.edges.every((e) => typeof e.kind === "string" && e.kind.length > 0)).toBe(true);
    const kinds = new Set(g.edges.map((e) => e.kind));
    for (const k of ["flow", "agg", "calc", "fb", "orch"]) expect(kinds.has(k)).toBe(true);

    const ws = (await t.app.inject({ method: "GET", url: "/a/v1/me/workspace", headers: ADMIN })).json() as {
      views: { viewKey: string; renderer: string; options: Record<string, unknown>; layout: Record<string, unknown> }[];
      navigation: { key: string; label: string }[];
    };
    // 用户亲定（2026-07-05）：七视角全删仅存全景——workspace 不得再下发任何 graph-* 视图。
    expect(ws.views.filter((v) => v.viewKey.startsWith("graph-")).map((v) => v.viewKey)).toEqual([]);
    expect(ws.navigation.filter((n) => n.key.startsWith("graph-"))).toEqual([]);
    // 全景唯一入口：graph（与 graph-all 同质合一·label「图谱全景」·domain 着色全景配置下发）。
    const graph = ws.views.find((v) => v.viewKey === "graph")!;
    expect(graph.renderer).toBe("ontology-graph");
    const opts = GraphOptionsSchema.parse((graph.options as { graphOptions: unknown }).graphOptions);
    expect(opts.colorBy).toBe("domain");
    expect(opts.nodeFilter).toBeUndefined(); // 全景 = 无子集过滤
    expect((graph.options as { desc?: string }).desc).toContain("全景");
    expect(ws.navigation.find((n) => n.key === "graph")?.label).toBe("图谱全景");
    // 导航仅此一个图谱业务视图入口（原「图谱·」前缀视角项归零）。
    expect(ws.navigation.filter((n) => n.label.startsWith("图谱·"))).toEqual([]);
  });

  it("F25/修订点4: feature key 可解析；view.graph.persp.* 声明退役（解析零残留·override 引用即 400 防幽灵）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const resolved = (await t.app.inject({ method: "GET", url: "/a/v1/tenants/demo/features", headers: ADMIN })).json() as {
      features: string[];
    };
    for (const k of [
      "view.annual-scenario", "view.quarterly-rolling", "view.order-chain", "view.geo-map", "view.task-dag",
      "view.ontology-graph", "act.aop-finalize",
    ]) {
      expect(resolved.features, k).toContain(k);
    }
    // GRAPH-PANORAMA-ONLY teeth：八个退役键（七视角 + persp.all）解析集零残留——重新注册即红。
    for (const p of ["all", "backbone", "flow", "source", "solver", "mvp", "agent", "loop"]) {
      expect(resolved.features, `view.graph.persp.${p}`).not.toContain(`view.graph.persp.${p}`);
      expect(resolved.features, `view.graph-${p}`).not.toContain(`view.graph-${p}`);
    }
    // 防幽灵：写入 override 引用退役键 → 400 VALIDATION_ERROR 显式拒绝（registry 声明退役，非静默未知键）。
    const ghost = await t.app.inject({
      method: "PUT",
      url: "/a/v1/tenants/demo/features",
      headers: ADMIN,
      payload: { overrides: { "view.graph.persp.loop": true } },
    });
    expect(ghost.statusCode).toBe(400);
    expect(ghost.json().error.message).toContain("retired");
    // 常规 entitlement 关断仍工作：关 view.geo-map → workspace 消失。
    await t.app.inject({
      method: "PUT",
      url: "/a/v1/tenants/demo/features",
      headers: ADMIN,
      payload: { overrides: { "view.geo-map": false } },
    });
    const ws = (await t.app.inject({ method: "GET", url: "/a/v1/me/workspace", headers: PLANNER })).json() as {
      views: { viewKey: string }[];
      navigation: { key: string }[];
      features: string[];
    };
    const keys = ws.views.map((v) => v.viewKey);
    expect(keys).not.toContain("geo-map");
    expect(keys).toContain("annual-scenario");
    expect(keys).toContain("graph"); // 全景仍在（view.ontology-graph 门控不动）
    expect(ws.navigation.map((n) => n.key)).not.toContain("geo-map");
    expect(ws.features).not.toContain("view.geo-map");
  });
});
