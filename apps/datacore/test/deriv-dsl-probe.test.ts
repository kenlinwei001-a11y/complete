/**
 * WO-DERIV-DSL-PROBE · **探针测试，非门**（只量不改；收编方可直接删除本文件）。
 *
 * 目的：实测 `ontology-dsl.ts`（本体原子规格 §2 派生公式 DSL）的语法边界与求值语义，
 * 为「把推演状态变量改成派生属性」定可行性边界。
 *
 * 纪律：每条「不支持」的否定结论**必须**配一个已知必中的金丝雀 —— 否则「解析器坏了」
 * 与「这个算子真不支持」在屏上一模一样。本文件的 `probe()` 把两侧写在同一张表里。
 */
import { describe, expect, it } from "vitest";
import {
  DECIMAL_SCALE,
  MAX_FORMULA_LENGTH,
  evaluate,
  extractDeps,
  parseFormula,
  type EvalContext,
  type NavNode,
  type Scalar,
} from "../src/ontology-dsl.js";

/** 解析探针：返回 ok / 错误原文，绝不吞异常（吞了就会把"坏了"读成"不支持"）。 */
function probe(formula: string): { ok: boolean; err?: string } {
  try {
    parseFormula(formula);
    return { ok: true };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { ok: false, err: m };
  }
}

/** 求值探针：self 属性 + 可选导航集合。 */
function run(
  formula: string,
  self: Record<string, unknown>,
  nav: Record<string, Record<string, unknown>[]> = {},
): { value: Scalar; warnings: string[] } {
  const warnings: string[] = [];
  const ctx: EvalContext = {
    self,
    navigate: (n: NavNode) => nav[`${n.direction}:${n.linkKey}`] ?? [],
    warn: (m) => warnings.push(m),
  };
  return { value: evaluate(parseFormula(formula), ctx), warnings };
}

describe("WO-DERIV-DSL-PROBE Q1 · §2 DSL 语法边界（支持侧）", () => {
  it("🐤 金丝雀：已知必中的范本公式必须解析 + 求值正确（不中 ⇒ 报「工具坏了」，不许报「不支持」）", () => {
    // 生产在用的三条种子公式（seed-derivation-specs.ts），必须全绿。
    expect(probe("this.qty * this.unitPrice").ok).toBe(true);
    expect(probe("this.qtyOnHand - this.qtyReserved").ok).toBe(true);
    expect(probe("this.dispatchDay + this.transitDays").ok).toBe(true);
    // 逐位核算：协调方在活服务上量到的样本订单 qty=7259 · unitPrice=22198。
    expect(run("this.qty * this.unitPrice", { qty: 7259, unitPrice: 22198 }).value).toBe(161135282);
  });

  it("四则 / 一元负号 / 括号优先级", () => {
    expect(run("this.a + this.b", { a: 3, b: 4 }).value).toBe(7);
    expect(run("this.a - this.b", { a: 3, b: 4 }).value).toBe(-1);
    expect(run("this.a * this.b", { a: 3, b: 4 }).value).toBe(12);
    expect(run("this.a / this.b", { a: 3, b: 4 }).value).toBe(0.75);
    expect(run("-this.a", { a: 3 }).value).toBe(-3);
    expect(run("(this.a + this.b) * 2", { a: 3, b: 4 }).value).toBe(14);
    expect(run("this.a + this.b * 2", { a: 3, b: 4 }).value).toBe(11); // 乘优先
  });

  it("比较 6 个 + AND/OR（返回 boolean，可作 IF 的 cond）", () => {
    for (const [f, want] of [
      ["this.a > 3", false],
      ["this.a >= 3", true],
      ["this.a < 4", true],
      ["this.a <= 3", true],
      ["this.a == 3", true],
      ["this.a != 3", false],
    ] as const) {
      expect(run(f, { a: 3 }).value, f).toBe(want);
    }
    expect(run("this.a > 1 AND this.a < 5", { a: 3 }).value).toBe(true);
    expect(run("this.a > 9 OR this.a < 5", { a: 3 }).value).toBe(true);
  });

  it("三元 IF / COALESCE（≥2 参） / CLAMP（3 参，标量归一的唯一手段）", () => {
    expect(run("IF(this.a > 2, 10, 20)", { a: 3 }).value).toBe(10);
    expect(run("IF(this.a > 2, 10, 20)", { a: 1 }).value).toBe(20);
    expect(run("COALESCE(this.missing, 42)", {}).value).toBe(42);
    expect(run("COALESCE(this.a, 42)", { a: 7 }).value).toBe(7);
    expect(run("CLAMP(this.a, 0, 100)", { a: 150 }).value).toBe(100);
    expect(run("CLAMP(this.a, 0, 100)", { a: -5 }).value).toBe(0);
    expect(run("CLAMP(this.a, 0, 100)", { a: 55.5 }).value).toBe(55.5);
  });

  it("聚合 5 个 SUM/MIN/MAX/AVG/COUNT · 单跳导航 out()/in() · 可选 WHERE ==", () => {
    const nav = {
      "in:wo_line": [
        { qty: 10, status: "OPEN" },
        { qty: 20, status: "OPEN" },
        { qty: 30, status: "DONE" },
      ],
    };
    expect(run("SUM(in(wo_line).qty)", {}, nav).value).toBe(60);
    expect(run("MIN(in(wo_line).qty)", {}, nav).value).toBe(10);
    expect(run("MAX(in(wo_line).qty)", {}, nav).value).toBe(30);
    expect(run("AVG(in(wo_line).qty)", {}, nav).value).toBe(20);
    expect(run("COUNT(in(wo_line))", {}, nav).value).toBe(3);
    // WHERE 只支持 ==，右侧是 factor（字面量或 this.x）
    expect(run("SUM(in(wo_line).qty, WHERE status == 'OPEN')", {}, nav).value).toBe(30);
    expect(run("COUNT(in(wo_line), WHERE status == 'DONE')", {}, nav).value).toBe(1);
    expect(run("SUM(in(wo_line).qty, WHERE status == this.mine)", { mine: "DONE" }, nav).value).toBe(30);
    // out 方向同样可用
    expect(run("MAX(out(line_base).cap)", {}, { "out:line_base": [{ cap: 5 }, { cap: 9 }] }).value).toBe(9);
  });

  it("空值语义：null 传播 · 除零→null+warning · 空集合→null · COALESCE 兜底", () => {
    expect(run("this.a + this.missing", { a: 1 }).value).toBeNull();
    const dz = run("this.a / this.b", { a: 1, b: 0 });
    expect(dz.value).toBeNull();
    expect(dz.warnings).toEqual(["division by zero"]); // 除零是 warning 不是异常
    expect(run("SUM(in(wo_line).qty)", {}, { "in:wo_line": [] }).value).toBeNull(); // 空集合 → null
    expect(run("COALESCE(this.a / this.b, 0)", { a: 1, b: 0 }).value).toBe(0); // 除零可被兜住
    // 非数值属性（字符串/对象）按 null 处理
    expect(run("this.s + 1", { s: "abc" }).value).toBeNull();
    expect(run("this.o + 1", { o: { x: 1 } }).value).toBeNull();
  });

  it("定点 4 位：decimalRound 在每个算子后施加（≠ derivedProperties 管线的 6 位）", () => {
    expect(DECIMAL_SCALE).toBe(4);
    expect(run("this.a / this.b", { a: 1, b: 3 }).value).toBe(0.3333);
    expect(run("this.a * this.b", { a: 0.1, b: 0.2 }).value).toBe(0.02);
    expect(run("this.a + this.b", { a: 0.1, b: 0.2 }).value).toBe(0.3); // 浮点漂移被定点吃掉
    // ⚠ 逐算子取整 ⇒ 复合式会积累截断误差（× 100 之后 4 位小数只剩 2 位有效）
    expect(run("this.a / this.b * 100", { a: 1, b: 3 }).value).toBe(33.33); // 不是 33.3333
  });

  it("依赖抽取 §2.3：this.x → 自类型；聚合 → 导航类型 + via + direction；COUNT 无 prop → '*'", () => {
    const resolve = (k: string, d: "out" | "in") => (d === "out" ? `TO_${k}` : `FROM_${k}`);
    expect(extractDeps(parseFormula("this.qty * this.unitPrice"), "Order", resolve)).toEqual([
      { typeKey: "Order", prop: "qty" },
      { typeKey: "Order", prop: "unitPrice" },
    ]);
    expect(extractDeps(parseFormula("SUM(in(wo_line).qty, WHERE status == 'OPEN')"), "Line", resolve)).toEqual([
      { typeKey: "FROM_wo_line", prop: "qty", via: "wo_line", direction: "in" },
      { typeKey: "FROM_wo_line", prop: "status", via: "wo_line", direction: "in" },
    ]);
    expect(extractDeps(parseFormula("COUNT(in(wo_line))"), "Line", resolve)).toEqual([
      { typeKey: "FROM_wo_line", prop: "*", via: "wo_line", direction: "in" },
    ]);
    // 未知 link key 在**编译期**就抛（不是运行期静默给 0）
    expect(() => extractDeps(parseFormula("COUNT(in(nope))"), "Line", () => undefined)).toThrow(/unknown link key/);
  });
});

describe("WO-DERIV-DSL-PROBE Q1 · §2 DSL 语法边界（不支持侧 · 每条配金丝雀）", () => {
  it("标量 MIN/MAX(a,b) 不存在 —— MIN/MAX 只能是导航聚合", () => {
    // 🐤 金丝雀：同名函数在聚合形态下必中 ⇒ 证明识别 MIN 的那条路是通的
    expect(probe("MIN(in(wo_line).qty)").ok).toBe(true);
    // 结论：两参标量形态解析失败
    const r = probe("MIN(this.a, this.b)");
    expect(r.ok).toBe(false);
    expect(r.err).toMatch(/expected out\(\.\.\.\) or in\(\.\.\.\) navigation/);
  });

  it("裸导航（聚合外）不支持 —— out(L).prop 取不到标量", () => {
    expect(probe("SUM(out(order_cust).creditLimit)").ok).toBe(true); // 🐤 聚合内必中
    const r = probe("out(order_cust).creditLimit");
    expect(r.ok).toBe(false);
    expect(r.err).toMatch(/must appear inside an aggregate/);
  });

  it("多跳导航不支持 —— 只认单跳", () => {
    expect(probe("SUM(out(a).x)").ok).toBe(true); // 🐤
    expect(probe("SUM(out(a).out(b).x)").ok).toBe(false);
  });

  it("聚合不可嵌套", () => {
    expect(probe("SUM(in(l).x)").ok).toBe(true); // 🐤
    const r = probe("SUM(in(l).x, WHERE k == SUM(in(m).y))");
    expect(r.ok).toBe(false);
    expect(r.err).toMatch(/nested aggregate/);
  });

  it("WHERE 只支持 == （其余比较符一律拒）", () => {
    expect(probe("SUM(in(l).x, WHERE k == 1)").ok).toBe(true); // 🐤
    for (const op of [">", ">=", "<", "<=", "!="]) {
      const r = probe(`SUM(in(l).x, WHERE k ${op} 1)`);
      expect(r.ok, `WHERE ${op}`).toBe(false);
      expect(r.err).toMatch(/WHERE only supports == equality/);
    }
  });

  it("数学函数一律不存在：ABS / ROUND / FLOOR / CEIL / SQRT / POW / LOG / EXP / MOD", () => {
    expect(probe("CLAMP(this.a, 0, 100)").ok).toBe(true); // 🐤 已知存在的函数必中
    for (const fn of ["ABS", "ROUND", "FLOOR", "CEIL", "SQRT", "POW", "LOG", "EXP", "MOD", "SIGN", "TRUNC"]) {
      const r = probe(`${fn}(this.a)`);
      expect(r.ok, fn).toBe(false);
      expect(r.err, fn).toMatch(/unexpected identifier/);
    }
  });

  it("取模 % 与幂 ** 不是算子（词法层就拒 %）", () => {
    expect(probe("this.a * this.b").ok).toBe(true); // 🐤
    expect(probe("this.a % this.b").err).toMatch(/unexpected character "%"/);
    expect(probe("this.a ** this.b").ok).toBe(false);
  });

  it("NOT 不存在（rule DSL 有，§2 DSL 没有）；取反只能写 == false 或 IF", () => {
    expect(probe("this.a > 1 AND this.b > 1").ok).toBe(true); // 🐤 AND 存在
    expect(probe("NOT this.a > 1").err).toMatch(/unexpected identifier "NOT"/);
    expect(run("IF(this.a > 1, 0, 1)", { a: 0 }).value).toBe(1); // 替代写法
  });

  it("裸标识符（derivedProperties 模板方言）被拒 —— 两种方言不互通", () => {
    expect(probe("this.qty * this.unitPrice").ok).toBe(true); // 🐤 §2 方言必中
    expect(probe("qty * unitPrice").err).toMatch(/unexpected identifier "qty"/);
    expect(probe("COUNT(Order.so BY bases)").ok).toBe(false); // 模板聚合方言
  });

  it("跨类型直接寻址不支持（无 Type.prop 语法）；无变量/无 let/无自定义函数", () => {
    expect(probe("this.priceIndex").ok).toBe(true); // 🐤
    expect(probe("Material.priceIndex").err).toMatch(/unexpected identifier "Material"/);
    expect(probe("this.a.b").ok).toBe(false); // propref 只认一级
  });

  it("公式长度上限 2000", () => {
    expect(MAX_FORMULA_LENGTH).toBe(2000);
    expect(probe(`this.a${" + this.a".repeat(10)}`).ok).toBe(true); // 🐤
    expect(probe(`this.a${" + this.a".repeat(300)}`).err).toMatch(/exceeds 2000 characters/);
  });
});
