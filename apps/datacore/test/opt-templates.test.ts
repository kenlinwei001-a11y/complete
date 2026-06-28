import { describe, expect, it } from "vitest";
import { OptModelTemplateSchema } from "@platform/contracts";
import { OPT_MODEL_TEMPLATES, OPT_TEMPLATE_KEYS } from "../src/solvers/opt-templates.js";

/**
 * G-12 收 provenance 门空过：优化模板池 5 核心落为一等可发现的 OptModelTemplate 实例（带 provenance/
 * requiredRoles），而非裸 family 字符串。本测试守：契约合法 + 每例带 license 留痕 + R14 零业务常数。
 */
const INDUSTRY = /(电池|基地|产线|工厂|诊所|社区|仓库|门店|疫苗|冷链|充电站|油田|矿山|battery|factory|clinic)/i;

describe("G-12 · 优化模板池一等实例（provenance 可溯源）", () => {
  it("5 核心实例齐 + 契约 schema 合法", () => {
    expect(OPT_TEMPLATE_KEYS).toEqual(["facility_location", "min_cost_flow", "set_cover", "independent_set", "combinatorial_auction"]);
    for (const t of OPT_MODEL_TEMPLATES) {
      expect(() => OptModelTemplateSchema.parse(t)).not.toThrow();
    }
  });

  it("每例带 provenance.license 留痕（LIC3/LIC4）+ requiredRoles + decisionVars 非空", () => {
    for (const t of OPT_MODEL_TEMPLATES) {
      expect(t.provenance.license.length).toBeGreaterThan(0);
      expect(t.provenance.derivedFrom.length).toBeGreaterThan(0);
      expect(t.requiredRoles.length).toBeGreaterThan(0);
      expect(t.decisionVars.length).toBeGreaterThan(0);
      expect(t.constraintFamilies.length).toBeGreaterThan(0);
    }
  });

  it("R14 零业务常数：模板抽象（role/约束/displayName）不含行业实体名", () => {
    for (const t of OPT_MODEL_TEMPLATES) {
      const blob = JSON.stringify({ roles: t.requiredRoles, vars: t.decisionVars, cons: t.constraintFamilies, name: t.displayName });
      expect(INDUSTRY.test(blob)).toBe(false);
    }
  });
});
