import { describe, expect, it } from "vitest";
import { evaluateExpression, parseExpression } from "../src/ruledsl.js";

describe("rule DSL", () => {
  it("C03: BLOCK condition fires at demandDelta > 0.5", () => {
    const expr = "Order.demandDelta > 0.5";
    expect(evaluateExpression(expr, { payload: { demandDelta: 0.6 } })).toBe(true);
    expect(evaluateExpression(expr, { payload: { demandDelta: 0.5 } })).toBe(false);
    expect(evaluateExpression(expr, { payload: { Order: { demandDelta: 0.7 } } })).toBe(true);
    expect(evaluateExpression(expr, { payload: {} })).toBe(false);
  });

  it("supports AND / OR / NOT and parentheses", () => {
    const p = { payload: { a: 5, b: 1 } };
    expect(evaluateExpression("a > 3 AND b < 2", p)).toBe(true);
    expect(evaluateExpression("a > 9 OR b < 2", p)).toBe(true);
    expect(evaluateExpression("NOT a > 3", p)).toBe(false);
    expect(evaluateExpression("(a > 9 OR b < 2) AND a == 5", p)).toBe(true);
  });

  it("supports comparison operators and string/boolean literals", () => {
    expect(evaluateExpression("status == 'OPEN'", { payload: { status: "OPEN" } })).toBe(true);
    expect(evaluateExpression("status != 'OPEN'", { payload: { status: "OPEN" } })).toBe(false);
    expect(evaluateExpression("flag == true", { payload: { flag: true } })).toBe(true);
    expect(evaluateExpression("x >= 2 AND x <= 3", { payload: { x: 2.5 } })).toBe(true);
  });

  it("aggregate funcs SUM/MIN/MAX/COUNT/AVG over bound collections", () => {
    const payload = { Order: [{ qty: 10 }, { qty: 20 }, { qty: 30 }] };
    expect(evaluateExpression("SUM(Order.qty) == 60", { payload })).toBe(true);
    expect(evaluateExpression("MIN(Order.qty) == 10", { payload })).toBe(true);
    expect(evaluateExpression("MAX(Order.qty) == 30", { payload })).toBe(true);
    expect(evaluateExpression("COUNT(Order.qty) == 3", { payload })).toBe(true);
    expect(evaluateExpression("AVG(Order.qty) == 20", { payload })).toBe(true);
  });

  it("rowFilter subset: ${user.attr} references and IN", () => {
    const user = { userId: "u1", roles: ["base_manager:常州"], attributes: { baseScope: ["changzhou"] } };
    expect(
      evaluateExpression("Object.baseId IN ${user.attributes.baseScope}", {
        payload: { Object: { baseId: "changzhou" } },
        user,
      }),
    ).toBe(true);
    expect(
      evaluateExpression("Object.baseId IN ${user.attributes.baseScope}", {
        payload: { Object: { baseId: "hefei" } },
        user,
      }),
    ).toBe(false);
    // array-valued left side: overlap semantics
    expect(
      evaluateExpression("Object.bases IN ${user.baseScope}", {
        payload: { Object: { bases: ["hefei", "changzhou"] } },
        user,
      }),
    ).toBe(true);
  });

  it("rejects malformed expressions", () => {
    expect(() => parseExpression("a >")).toThrow();
    expect(() => parseExpression("")).toThrow();
    expect(() => parseExpression("a > 1 AND")).toThrow();
  });
});
