import { describe, expect, it } from "vitest";
import { ValidationPolicySchema } from "@platform/contracts";
import { validateOutputAgainstOntology } from "../src/ontology-validate.js";
import type { ObjectTypeDef } from "../src/domain.js";
import { makeApp, ADMIN, debugUser } from "./helpers.js";

const CUSTOMER: ObjectTypeDef = {
  key: "Customer", tenantId: "demo", displayName: "客户", domain: "people",
  properties: [
    { propKey: "custId", dataType: "string", isPrimaryKey: true },
    { propKey: "name", dataType: "string", isPrimaryKey: false },
    { propKey: "creditLimit", dataType: "number", isPrimaryKey: false },
    { propKey: "rating", dataType: "enum", isPrimaryKey: false, enumValues: ["A", "B", "C"] },
  ],
  derivedProperties: [],
} as unknown as ObjectTypeDef;

const policy = (o: Record<string, unknown> = {}) => ValidationPolicySchema.parse(o);

describe("约束执行层 · validateOutputAgainstOntology（可配置）", () => {
  it("干净行 → ok、零违规", () => {
    const r = validateOutputAgainstOntology([{ custId: "C1", name: "蔚途", creditLimit: 5000, rating: "A" }], CUSTOMER, policy({ domainOverrides: { creditLimit: { min: 0 } } }));
    expect(r.ok).toBe(true);
    expect(r.violations).toHaveLength(0);
  });

  it("脏外部行 → 值域(负数)/野字段/缺主键/enum 非法 全部捕获", () => {
    const r = validateOutputAgainstOntology(
      [{ creditLimit: -500, rating: "AAA+++", foo: "bar" }], // 缺 custId, 负额度, enum 非法, 野字段
      CUSTOMER,
      policy({ unknownFields: "REJECT", domainOverrides: { creditLimit: { min: 0 } } }),
    );
    expect(r.ok).toBe(false);
    const kinds = r.violations.map((v) => `${v.field}:${v.kind}`);
    expect(kinds).toContain("custId:MISSING_REQUIRED");
    expect(kinds).toContain("creditLimit:DOMAIN");
    expect(kinds).toContain("rating:DOMAIN");
    expect(kinds).toContain("foo:UNKNOWN_FIELD");
  });

  it("可配置：fieldMappings 适配不同源字段名 + QUARANTINE 不致 ok=false（只隔离不拒）", () => {
    const r = validateOutputAgainstOntology(
      [{ cust_no: "C9", 信用额度: -1 }], // 外部源字段名
      CUSTOMER,
      policy({ fieldMappings: { cust_no: "custId", 信用额度: "creditLimit" }, valueDomain: "QUARANTINE", domainOverrides: { creditLimit: { min: 0 } } }),
    );
    // custId 经映射补齐 → 不缺主键；负额度走 QUARANTINE → 隔离但 ok 仍真
    expect(r.violations.some((v) => v.field === "custId" && v.kind === "MISSING_REQUIRED")).toBe(false);
    expect(r.ok).toBe(true);
    expect(r.quarantinedRows).toBe(1);
  });

  it("端点 R2 租户隔离：demo 建域产出 Order 类型可校验；acme 无该类型 → 400（按本租户对象类型）", async () => {
    const t = await makeApp();
    // demo 跑一次建域 → 发布 Order 等对象类型
    await t.app.inject({ method: "POST", url: "/a/v1/data-builders/run", headers: ADMIN, payload: { script: "常州基地产能紧张，影响订单交期与客户信用，请做风险推演", seed: 7 } });
    const ok = await t.app.inject({ method: "POST", url: "/a/v1/ontology/validate-output", headers: ADMIN, payload: { objectType: "Order", rows: [{ so: "SO-1" }] } });
    expect(ok.statusCode).toBe(200);
    // acme 租户没建过域 → 无 Order 对象类型 → 报未知（本租户视角）
    const other = await t.app.inject({ method: "POST", url: "/a/v1/ontology/validate-output", headers: debugUser("acme", "admin", "admin"), payload: { objectType: "Order", rows: [{ so: "SO-1" }] } });
    expect(other.statusCode).toBe(400);
  });
});
