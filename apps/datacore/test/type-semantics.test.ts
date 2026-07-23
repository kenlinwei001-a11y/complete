import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, debugUser, type TestApp } from "./helpers.js";
import type { AuthCtx, ObjectTypeDef, PropertyDef } from "../src/domain.js";
import type { TypeSemanticsResponse } from "@platform/contracts";

/**
 * WO-QOS-ONTOLOGY-CONTEXT · GET /a/v1/ontology/type-semantics 端点（缺口③·文档三层投喂第二层 A-半）。
 *
 * 断言口径语义只读投影 = A 单一真值：属性 description/unit/dataType + 派生 formula + 相关已发布规则 expression/severity。
 * SEAM 之 A-半：改 DataCore prop.description / rule.expression → 端点输出同步变（证端点即真值·非快照漂移）。
 * B-半（agentcore ontology-context.test）证组装器忠实渲染端点输出无硬编码 mirror；两半合闭「口径来自 A 单一真值」。
 */
const ADMIN_CTX: AuthCtx = { tenantId: "demo", userId: "usr_demo_admin", roles: ["admin"], attributes: {} };

const prop = (propKey: string, opts: Partial<PropertyDef> = {}): PropertyDef => ({
  propKey,
  dataType: "number",
  isPrimaryKey: false,
  ...opts,
});

/** 播一个带口径的最小本体：Metric（描述 + 单位 + gap 派生公式）+ Order（数量口径）+ 一条 C03 产能上限规则。 */
async function seedSemanticOntology(t: TestApp, ctx = ADMIN_CTX): Promise<void> {
  const types: Omit<ObjectTypeDef, "id" | "tenantId" | "version" | "status">[] = [
    {
      key: "Metric",
      displayName: "经营指标",
      properties: [
        prop("metricKey", { dataType: "string", isPrimaryKey: true, description: "指标键" }),
        prop("actual", { description: "实际值", unit: "%" }),
        prop("target", { description: "目标值", unit: "%" }),
        prop("gap", { description: "缺口" }),
      ],
      derivedProperties: [{ propKey: "gap", formula: "actual - target" }],
      sourceBindings: [],
    },
    {
      key: "Order",
      displayName: "订单",
      properties: [
        prop("so", { dataType: "string", isPrimaryKey: true, description: "订单号" }),
        prop("qty", { description: "订单数量", unit: "台" }),
        prop("demandDelta", { description: "需求偏差率" }),
      ],
      derivedProperties: [],
      sourceBindings: [],
    },
  ];
  for (const ty of types) await t.services.ontology.upsertType(ctx, ty);
  await t.services.ontology.publishVersion(ctx);
  await t.services.rules.create(ctx, {
    key: "C03",
    name: "产能上限约束",
    expression: "Order.demandDelta > 0.5",
    scopeObjectTypes: ["Order"],
    severity: "BLOCK",
    status: "PUBLISHED",
  });
}

const getSemantics = async (t: TestApp, types: string, headers = ADMIN): Promise<TypeSemanticsResponse> =>
  (await (await t.app.inject({ method: "GET", url: `/a/v1/ontology/type-semantics?types=${encodeURIComponent(types)}`, headers })).json()) as TypeSemanticsResponse;

describe("WO-QOS-ONTOLOGY-CONTEXT · GET /a/v1/ontology/type-semantics（口径语义只读投影）", () => {
  it("对请求类型返回属性口径(description/unit/dataType) + 派生公式(formula) + 规则表达式(expression/severity)", async () => {
    const t = await makeApp();
    await seedSemanticOntology(t);
    const res = await getSemantics(t, "Metric,Order");
    const metric = res.types.find((x) => x.typeKey === "Metric")!;
    expect(metric.displayName).toBe("经营指标");
    const actual = metric.props.find((p) => p.propKey === "actual")!;
    expect(actual.description).toBe("实际值");
    expect(actual.unit).toBe("%");
    expect(actual.dataType).toBe("number");
    // 派生公式（口径核心：gap = actual - target）
    expect(metric.derived.find((d) => d.propKey === "gap")?.formula).toBe("actual - target");
    // 规则表达式挂到 scope 命中的 Order
    const order = res.types.find((x) => x.typeKey === "Order")!;
    const c03 = order.rules.find((r) => r.key === "C03")!;
    expect(c03.expression).toBe("Order.demandDelta > 0.5");
    expect(c03.severity).toBe("BLOCK");
    expect(c03.name).toBe("产能上限约束");
  });

  it("确定性排序（R6）：types/props/rules 均按 key 字典序", async () => {
    const t = await makeApp();
    await seedSemanticOntology(t);
    const res = await getSemantics(t, "Order,Metric");
    // 请求顺序 Order,Metric 但返回按 typeKey 字典序 Metric<Order
    expect(res.types.map((x) => x.typeKey)).toEqual(["Metric", "Order"]);
    const metric = res.types.find((x) => x.typeKey === "Metric")!;
    const keys = metric.props.map((p) => p.propKey);
    expect([...keys].sort()).toEqual(keys);
  });

  it("SEAM A-半：改 rule.expression / prop.description → 端点输出同步变（端点即单一真值·无快照漂移）", async () => {
    const t = await makeApp();
    await seedSemanticOntology(t);
    const before = await getSemantics(t, "Metric,Order");
    expect(before.types.find((x) => x.typeKey === "Order")!.rules.find((r) => r.key === "C03")!.expression).toBe("Order.demandDelta > 0.5");
    // 改口径真值：新版本规则表达式 + 改 Metric.actual 描述
    await t.services.rules.create(ADMIN_CTX, {
      key: "C03",
      name: "产能上限约束",
      expression: "Order.demandDelta > 0.8",
      scopeObjectTypes: ["Order"],
      severity: "WARN",
      status: "PUBLISHED",
    });
    await t.services.ontology.upsertType(ADMIN_CTX, {
      key: "Metric",
      displayName: "经营指标",
      properties: [
        prop("metricKey", { dataType: "string", isPrimaryKey: true, description: "指标键" }),
        prop("actual", { description: "当期实际达成", unit: "pct" }),
        prop("target", { description: "目标值", unit: "%" }),
        prop("gap", { description: "缺口" }),
      ],
      derivedProperties: [{ propKey: "gap", formula: "actual - target" }],
      sourceBindings: [],
    });
    await t.services.ontology.publishVersion(ADMIN_CTX);
    const after = await getSemantics(t, "Metric,Order");
    const c03 = after.types.find((x) => x.typeKey === "Order")!.rules.filter((r) => r.key === "C03");
    // 仅当前 PUBLISHED 版本（旧版 RETIRED 不出）→ 表达式已变
    expect(c03).toHaveLength(1);
    expect(c03[0].expression).toBe("Order.demandDelta > 0.8");
    expect(c03[0].severity).toBe("WARN");
    const actual = after.types.find((x) => x.typeKey === "Metric")!.props.find((p) => p.propKey === "actual")!;
    expect(actual.description).toBe("当期实际达成");
    expect(actual.unit).toBe("pct");
  });

  it("R2 租户隔离：他租户看不到 demo 的类型语义", async () => {
    const t = await makeApp();
    await seedSemanticOntology(t);
    const other = await getSemantics(t, "Metric,Order", debugUser("other-tenant", "u1", "admin"));
    expect(other.types).toEqual([]);
  });

  it("未知/未请求类型静默略过（不报错）", async () => {
    const t = await makeApp();
    await seedSemanticOntology(t);
    const res = await getSemantics(t, "Metric,NoSuchType");
    expect(res.types.map((x) => x.typeKey)).toEqual(["Metric"]);
  });
});
