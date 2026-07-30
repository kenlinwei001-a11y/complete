import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, debugUser, ADMIN, PLANNER, type TestApp } from "./helpers.js";

/**
 * WO-69 P1 · A6 列级（属性级）Security —— SEAM（接缝驱动）测试。
 *
 * 四条红线各配**变异反证**（把实现改坏 → 该条必红）：
 *  S1 读：不可读属性是**剔除的键**，不是 null（null 会被下游读作"业务值为空"= 凭空造数据）。
 *  S2 写：写不可写属性 → 显式 403 PROPERTY_FORBIDDEN，且**值不落库**（复读证明原值未变）。
 *  S3 求解器上下文（头号·最易假绿）：列级约束必须**同样作用于 loadContext**，不能只接 REST。
 *  S4 向后兼容：没配 propertyPolicy 的策略**逐字节保持现行为**（admin 旁路 + 无策略 default-allow）。
 *
 * 受限角色 = `line_operator`（种子策略见 synthetic/service.ts seedPolicies）：
 * Material 可读可写，但 `unitPrice` 既不可读也不可写。
 */

const OPERATOR = debugUser("demo", "operator1", "line_operator");

async function materials(t: TestApp, headers: Record<string, string>) {
  const res = await t.app.inject({
    method: "POST",
    url: "/a/v1/objects/query",
    headers,
    payload: { objectType: "Material", limit: 50 },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { data: { id: string; props: Record<string, unknown> }[] }).data;
}

describe("A6 列级（属性级）Security · WO-69 P1", () => {
  // ── S1：读投影 —— 剔除而非置空 ────────────────────────────────────────────────
  it("S1 受限角色查询对象：unitPrice 键**不存在**（不是 null），admin 仍看得到", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const asOperator = await materials(t, OPERATOR);
    expect(asOperator.length).toBeGreaterThan(0);
    for (const m of asOperator) {
      // 剔除而非置空：键必须整个消失。`in` 判定同时挡住 undefined 和 null 两种伪装。
      expect("unitPrice" in m.props).toBe(false);
      expect(Object.keys(m.props)).not.toContain("unitPrice");
      // 其余属性照常可见（列级是精确剔除，不是把对象打空）。
      expect(m.props.matId).toBeDefined();
    }

    // 对照组：admin 走 :47 旁路，看得到完整列。
    const asAdmin = await materials(t, ADMIN);
    expect(asAdmin.some((m) => m.props.unitPrice !== undefined)).toBe(true);
  });

  it("S1b 聚合/图遍历不是列级安全的绕行口", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 聚合：对不可读列求和 → 拿不到该列（rows 已投影，sum 落空）。
    const agg = await t.app.inject({
      method: "POST",
      url: "/a/v1/objects/aggregate",
      headers: OPERATOR,
      payload: { typeKey: "Material", metrics: [{ prop: "unitPrice", fn: "sum" }] },
    });
    expect(agg.statusCode).toBe(200);
    const rows = (agg.json() as { rows: { metrics: Record<string, number | null> }[] }).rows ?? [];
    for (const r of rows) expect(Number(r.metrics["sum_unitPrice"] ?? 0)).toBe(0);

    // 对照：admin 聚合得到非零合计（证明数据本身有值，S1b 不是"因为没数据才为 0"）。
    const aggAdmin = await t.app.inject({
      method: "POST",
      url: "/a/v1/objects/aggregate",
      headers: ADMIN,
      payload: { typeKey: "Material", metrics: [{ prop: "unitPrice", fn: "sum" }] },
    });
    expect(aggAdmin.statusCode).toBe(200);
    const adminRows = (aggAdmin.json() as { rows: { metrics: Record<string, number | null> }[] }).rows ?? [];
    expect(adminRows.some((r) => Number(r.metrics["sum_unitPrice"] ?? 0) > 0)).toBe(true);
  });

  // ── S2：写拒绝 —— 显式报错 + 值不落库 ─────────────────────────────────────────
  it("S2 受限角色写 unitPrice → 403 PROPERTY_FORBIDDEN，且值未落库", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const target = (await materials(t, ADMIN))[0]!;
    const before = target.props.unitPrice;
    expect(before).toBeDefined();

    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: OPERATOR,
      payload: {
        actionTypeKey: "对象数据变更",
        payload: { objectId: target.id, patch: { unitPrice: 999999 }, reason: "列级安全 SEAM 测试" },
      },
    });
    // 拒绝而非静默丢弃：必须是显式错误，且走统一错误信封（R7）。
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error: { code: string; message: string; requestId?: string } };
    expect(body.error.code).toBe("PROPERTY_FORBIDDEN");
    expect(body.error.message).toContain("unitPrice");

    // 值不落库：复读证明原值原封不动。
    const after = (await materials(t, ADMIN)).find((m) => m.id === target.id)!;
    expect(after.props.unitPrice).toBe(before);
  });

  it("S2b 受限角色写**可写**属性照常放行（列级不是把整个对象锁死）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const target = (await materials(t, ADMIN))[0]!;

    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/action-drafts",
      headers: OPERATOR,
      payload: {
        actionTypeKey: "对象数据变更",
        payload: { objectId: target.id, patch: { onHand: 12345 }, reason: "列级安全 SEAM 测试" },
      },
    });
    expect(res.statusCode).toBe(201);
  });

  // ── S3：求解器上下文（头号坑）────────────────────────────────────────────────
  it("S3 求解器上下文同受列级约束：quote_margin 以受限角色跑，unitPrice 真没进 context", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // quote_margin 的 BOM 成本直接由 Material.unitPrice 派生（extended.ts spotPrice: num(m.unitPrice, 1)），
    // 与库存水位无关 —— 每次调用都必然读这个字段，故能真正驱动接缝（不像 inventory_optimize
    // 在本 seed 下 over=[] 时根本不读 unitPrice，那种断言是**空过的假绿**）。
    const run = async (headers: Record<string, string>) => {
      const res = await t.app.inject({
        method: "POST",
        url: "/a/v1/solvers/quote_margin/invoke",
        headers,
        payload: { args: {} },
      });
      expect(res.statusCode).toBe(200);
      return (res.json() as { data: { margin: number; breakdown: { bomCost: number } } }).data;
    };

    const admin = await run(ADMIN);
    const operator = await run(OPERATOR);

    // admin 用真单价算 BOM 成本；受限角色 context 里 unitPrice 已被剔除 → 回落默认 1 → 成本坍塌。
    // **这就是"字段真没进求解器"的活证据**：若只接 REST 而漏接 loadContext，两者会完全相等（假绿）。
    expect(admin.breakdown.bomCost).toBeGreaterThan(100);
    expect(operator.breakdown.bomCost).toBeLessThan(admin.breakdown.bomCost / 10);
    expect(operator.margin).not.toBe(admin.margin);
  });

  // ── S4：向后兼容（无 propertyPolicy 逐字节现行为）────────────────────────────
  it("S4 未配 propertyPolicy 的策略行为不变：admin 旁路 + 无策略 default-allow + 既有角色不受影响", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // ① admin 旁路（authz.ts:47）：全列可见。
    const asAdmin = await materials(t, ADMIN);
    expect(asAdmin.some((m) => m.props.unitPrice !== undefined)).toBe(true);

    // ② planner 匹配的是**未配 propertyPolicy** 的宽策略 → 全列可见（不受列级收窄）。
    const asPlanner = await materials(t, PLANNER);
    expect(asPlanner.length).toBeGreaterThan(0);
    expect(asPlanner.some((m) => m.props.unitPrice !== undefined)).toBe(true);

    // ③ 无策略附着的对象类型：default allow（authz.ts:55）全列可见。
    const noPolicyType = await t.app.inject({
      method: "POST",
      url: "/a/v1/objects/query",
      headers: PLANNER,
      payload: { objectType: "Equipment", limit: 5 },
    });
    expect(noPolicyType.statusCode).toBe(200);
    const eq = (noPolicyType.json() as { data: { props: Record<string, unknown> }[] }).data;
    expect(eq.length).toBeGreaterThan(0);
    expect(Object.keys(eq[0]!.props).length).toBeGreaterThan(1);

    // ④ 决策自证：无列级配置时 columnRestricted=false（= 零成本恒等路径，逐字节现行为）。
    const explain = await t.app.inject({
      method: "POST",
      url: "/a/v1/authz/explain",
      headers: PLANNER,
      payload: { resource: { kind: "OBJECT_TYPE", key: "Material" }, op: "READ" },
    });
    expect(explain.statusCode).toBe(200);
    expect((explain.json() as { columnRestricted: boolean }).columnRestricted).toBe(false);

    // ⑤ 受限角色则确实 restricted（对照，证明 ④ 的 false 不是因为特性没生效）。
    const explainOp = await t.app.inject({
      method: "POST",
      url: "/a/v1/authz/explain",
      headers: OPERATOR,
      payload: { resource: { kind: "OBJECT_TYPE", key: "Material" }, op: "READ" },
    });
    expect(explainOp.statusCode).toBe(200);
    expect((explainOp.json() as { columnRestricted: boolean }).columnRestricted).toBe(true);
  });

  // ── 多角色解析语义（最宽松者胜）──────────────────────────────────────────────
  it("多角色：受限角色 + 未受限角色 = 并集（宽者胜），加角色不会让人看得更少", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // line_operator 单独 → 看不到；叠加 planner（匹配未配 propertyPolicy 的宽策略）→ 看得到。
    const both = await materials(t, debugUser("demo", "u2", "line_operator|planner"));
    expect(both.some((m) => m.props.unitPrice !== undefined)).toBe(true);

    const onlyOperator = await materials(t, OPERATOR);
    expect(onlyOperator.every((m) => !("unitPrice" in m.props))).toBe(true);
  });
});
