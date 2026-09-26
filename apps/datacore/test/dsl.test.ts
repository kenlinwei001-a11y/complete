import { describe, expect, it } from "vitest";
import { evaluateAst, evaluateExpression, parseExpression } from "../src/ruledsl.js";

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

  it("A8.5 SUSTAIN(comparison, days): parses, evaluates via the provider, false without one", () => {
    const ast = parseExpression("SUSTAIN(Line.utilization > 95, 3)");
    expect(ast).toMatchObject({ kind: "sustain", days: 3 });
    // without a sustain provider the clause is false (snapshot single values are never used)
    expect(evaluateExpression("SUSTAIN(Line.utilization > 95, 3)", { payload: { Line: { utilization: 99 } } })).toBe(false);
    // with a provider, the inner comparison is delegated bucket-by-bucket
    const buckets = [96, 97, 96];
    expect(
      evaluateExpression("SUSTAIN(Line.utilization > 95, 3)", {
        payload: {},
        sustain: (inner, days) =>
          buckets.length >= days &&
          buckets.slice(-days).every((v) => evaluateAst(inner, { payload: { Line: { utilization: v } } })),
      }),
    ).toBe(true);
    expect(() => parseExpression("SUSTAIN(Line.utilization > 95)")).toThrow();
  });
});

import { BATTERY_TEMPLATE } from "../src/synthetic/battery.js";

describe("rule DSL · IMPLIES（C33 招牌算子）+ catalog C26–C33 注册（规则引擎可见）", () => {
  it("IMPLIES 真值表（a IMPLIES b ≡ NOT a OR b）：T→T=T · T→F=F · F→T=T · F→F=T", () => {
    const expr = "a > 0 IMPLIES b > 0";
    expect(evaluateExpression(expr, { payload: { a: 1, b: 1 } })).toBe(true); // T→T
    expect(evaluateExpression(expr, { payload: { a: 1, b: -1 } })).toBe(false); // T→F（唯一假）
    expect(evaluateExpression(expr, { payload: { a: -1, b: 1 } })).toBe(true); // F→T（前件假→真）
    expect(evaluateExpression(expr, { payload: { a: -1, b: -1 } })).toBe(true); // F→F（前件假→真）
  });

  it("IMPLIES 脱糖等价 NOT a OR b（四组合逐一一致）", () => {
    for (const a of [1, -1]) {
      for (const b of [1, -1]) {
        const p = { payload: { a, b } };
        expect(evaluateExpression("a > 0 IMPLIES b > 0", p)).toBe(evaluateExpression("NOT a > 0 OR b > 0", p));
      }
    }
  });

  it("IMPLIES 最低优先级 + 可嵌套 AND/OR", () => {
    // a AND b IMPLIES c ≡ (a AND b) IMPLIES c
    expect(evaluateExpression("a > 0 AND b > 0 IMPLIES c > 0", { payload: { a: 1, b: 1, c: -1 } })).toBe(false);
    expect(evaluateExpression("a > 0 AND b > 0 IMPLIES c > 0", { payload: { a: 1, b: -1, c: -1 } })).toBe(true); // 前件假
  });

  it("C33 碳护照（NOT(EU IMPLIES carbon<=阈值)= 违规）：EU 超阈→违规;EU 达标/非EU→不违规", () => {
    const expr = "NOT (Order.destination == 'EU' IMPLIES Order.carbonFootprint <= Order.euCarbonThreshold)";
    expect(evaluateExpression(expr, { payload: { destination: "EU", carbonFootprint: 90, euCarbonThreshold: 80 } })).toBe(true); // EU 超阈 → 违规
    expect(evaluateExpression(expr, { payload: { destination: "EU", carbonFootprint: 70, euCarbonThreshold: 80 } })).toBe(false); // EU 达标
    expect(evaluateExpression(expr, { payload: { destination: "US", carbonFootprint: 999, euCarbonThreshold: 80 } })).toBe(false); // 非 EU → 前件假，不违规
  });

  it("C26–C33 全注册进规则库（规则引擎可见，补审计「0/8 注册」缺口）+ 每条 DSL 可解析", () => {
    const keys = BATTERY_TEMPLATE.rules.map((r) => r.key);
    for (const k of ["C26", "C27", "C28", "C29", "C30", "C31", "C32", "C33"]) expect(keys, `${k} 未注册`).toContain(k);
    // 每条表达式 DSL 合法（parseExpression 不抛）
    for (const r of BATTERY_TEMPLATE.rules) expect(() => parseExpression(r.expression), `${r.key} DSL 非法: ${r.expression}`).not.toThrow();
    // 严重度按 PRD §3：C26/C29/C30/C31/C32/C33=BLOCK · C27/C28=WARN
    const sev = Object.fromEntries(BATTERY_TEMPLATE.rules.map((r) => [r.key, r.severity]));
    for (const k of ["C26", "C29", "C30", "C31", "C32", "C33"]) expect(sev[k], `${k} 应 BLOCK`).toBe("BLOCK");
    for (const k of ["C27", "C28"]) expect(sev[k], `${k} 应 WARN`).toBe("WARN");
  });

  it("C28/C32 违规谓词求值（pass + violation 两侧）", () => {
    expect(evaluateExpression("Batch.idleDays > 90", { payload: { idleDays: 120 } })).toBe(true); // 呆滞违规
    expect(evaluateExpression("Batch.idleDays > 90", { payload: { idleDays: 30 } })).toBe(false);
    expect(evaluateExpression("Customer.maxOverdueDays > 30", { payload: { maxOverdueDays: 45 } })).toBe(true); // 逾期冻结
    expect(evaluateExpression("Customer.maxOverdueDays > 30", { payload: { maxOverdueDays: 10 } })).toBe(false);
  });
});
