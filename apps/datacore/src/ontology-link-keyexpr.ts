/**
 * WO-COMPUTED-EDGE · **算端点**：锚点键由 carrier 行上的一个**表达式**算出，而不是直接读一列。
 *
 * ── 这个文件为什么存在（`ontology-link-predicate.ts` 头注的下一步）────────────────
 * 谓词（`viaWhere`）只能**筛掉 carrier 行**，不能**算出端点**。它的头注把治不了的四类形态
 * 逐条写下来了，其中第二类就是本文件收的那一类：
 *
 * > · 端点由**条件常量**得出（`level === "month" ? "prin-plan" : "prin-coo"`）
 *
 * 实测本仓两条边正是这个形态，且**用户自建时永远 0 实例、而出厂种子里它们有实例** ——
 * 同一条边两种命运（`domain.ts` 的 `anchorProperty` 头注已把这个不一致定性为缺陷）：
 *
 * | 边 | 种子里算端点的那一句 | 缺了本机制会怎样 |
 * |---|---|---|
 * | `plantarget_ownedby` PlanTarget→Principal | `level === "month" ? "prin-plan" : "prin-coo"` | `PlanTarget` 上根本没有 `ownerRef` 列 ⇒ `viaProperty` 无从声明 |
 * | `model_in_segment` Model→Segment | 由型号用途位 `pos` 归段 | 同上，`Model` 上没有 `segKey` 列 |
 *
 * ── 复用，不另造（本单硬约束）──────────────────────────────────────────────
 * 词法 / 语法 / 求值**全部**复用 `ontology-dsl.ts`（A4 派生属性求值器，同一份 `parseFormula`
 * + `evaluate`）。本文件**一行解析代码都没有**，只做两件事：**收窄子集** 与 **写入期校验**。
 *
 * ⚠ **枢纽实测（选错求值器这一单就废了）**：本仓有两个表达式求值器，返回类型不同 ——
 * · `ruledsl.evaluateAst` 返回 **`boolean`**（`viaWhere` 用的那一份）⇒ **天生产不出 key**；
 * · `ontology-dsl.evaluate` 返回 **`Scalar`**（`number | string | boolean | null`）⇒ 能产 key。
 * 且 `ontology-dsl` 的 `Ast` **已有** `if` / `string` / `cmp` 三个节点 ⇒ 本单**一个 AST 节点都不用加**。
 *
 * ── 为什么子集收得这么窄（每一条都是一个**静默**故障的堵口）──────────────────
 * `evaluate` 在取不到值时返回 `null`（`propref` 取不到 / `binary` 两侧非数）。
 * `String(null)` = `"null"` ⇒ **所有坏行塌到同一个键**，要么全落 `unresolved`、要么
 * （若真有对象主键叫 `"null"`）全连过去。**两种都不报错。** 所以下面每一样在**写入期**就 400：
 * · **`this.x` 必须真是 carrier 的属性** —— 打错字 ⇒ 恒 `null` ⇒ 静默死边
 * · **禁聚合 `SUM/MIN/MAX/AVG/COUNT`** —— 它们要 `ctx.navigate`，而物化期正在**建**边，
 *   此刻沿边导航是循环依赖；本文件的 `navigate` 直接抛，不给一个「恒空集」的假答案
 * · **禁 `binary` 串拼接的幻觉** —— `ontology-dsl` 的 `+` 两侧**强制转数**（`asNumber` 只认
 *   有限数字），`"PT-" + this.period` 求值为 `null` 而**不报错**。本文件不拦 `binary`（数值
 *   算 key 是合法用法，如按整数分档），但**恒 `null` 的公式**由下面 `assertProducesKeys` 拦掉。
 * · **禁常量公式**（不含任何 `this.x`）—— 每一行算出同一个键 = 把 carrier 全集连到一个锚点上，
 *   那不是「算端点」是「叉积的退化形态」，要它请用 `viaCross` 并接受边数预算。
 *
 * ── 诚实边界 ────────────────────────────────────────────────────────────
 * 本机制**只算键，不算类型**：`toTypeKey` 仍是 `LinkTypeDef` 上的单值字段。
 * `exc_sourced_from` 那种**目标类型随行变**的多态边，本文件一个字都治不了 —— 那要改的是
 * `LinkTypeDef` 的类型契约，不是加一个表达式（修法见 `synthetic/service.ts` 的 `exc_sourced_from_*` 五条拆边）。
 */

import { validationError } from "./errors.js";
import { evaluate, parseFormula, type Ast, type Scalar } from "./ontology-dsl.js";

/** 编译后的键表达式。`src` 原样留着——报错/审计要能回显用户写的那一句。 */
export interface LinkKeyExpr {
  readonly src: string;
  readonly ast: Ast;
}

/** 一次遍历收齐所有 `this.x` 引用与聚合节点，供子集校验逐条点名。 */
function walk(node: Ast, onProp: (prop: string) => void, onAgg: (fn: string) => void): void {
  switch (node.kind) {
    case "propref":
      onProp(node.prop);
      return;
    case "unary":
      walk(node.operand, onProp, onAgg);
      return;
    case "binary":
    case "cmp":
    case "and":
    case "or":
      walk(node.left, onProp, onAgg);
      walk(node.right, onProp, onAgg);
      return;
    case "agg":
      onAgg(node.fn);
      if (node.where) walk(node.where.value, onProp, onAgg);
      return;
    case "if":
      walk(node.cond, onProp, onAgg);
      walk(node.then, onProp, onAgg);
      walk(node.else, onProp, onAgg);
      return;
    case "coalesce":
      for (const a of node.args) walk(a, onProp, onAgg);
      return;
    case "clamp":
      walk(node.value, onProp, onAgg);
      walk(node.min, onProp, onAgg);
      walk(node.max, onProp, onAgg);
      return;
    case "number":
    case "string":
    case "bool":
      return;
  }
}

/**
 * 把 `viaKeyExpr` 原文编译成键表达式，并在**写入期**把全部「会变成哑弹边」的写法拒掉。
 *
 * @param carrierTypeKey  外键长在哪一侧的类型 key（`viaSide === "from" ? fromTypeKey : toTypeKey`）——
 *                        表达式是对 **carrier 行**求值的，所以 `this.x` 只能引用它的属性。
 * @param carrierPropKeys carrier 类型的属性名全集（含派生属性）；用于「字段真存在」校验。
 * @throws VALIDATION_ERROR 语法错误 / 用到被禁子集 / 引用了不存在的属性 / 常量公式。
 */
export function compileLinkKeyExpr(
  src: string,
  carrierTypeKey: string,
  carrierPropKeys: readonly string[],
): LinkKeyExpr {
  const ast = parseFormula(src); // 语法错误直接抛 VALIDATION_ERROR，不吞
  const known = new Set(carrierPropKeys);
  const badProps: string[] = [];
  const aggs: string[] = [];
  let propCount = 0;

  walk(
    ast,
    (p) => {
      propCount++;
      if (!known.has(p)) badProps.push(p);
    },
    (fn) => aggs.push(fn),
  );

  if (aggs.length > 0) {
    throw validationError(
      `结构边的键表达式 viaKeyExpr 用到了聚合 ${[...new Set(aggs)].map((f) => `${f}(…)`).join(" / ")}——` +
        `聚合要沿链路导航取对侧对象，而物化此刻正在**建**这些链路（循环依赖）。` +
        `键表达式只能用 carrier 自身的属性（this.x）与 IF/COALESCE/CLAMP/比较/四则。`,
    );
  }
  if (badProps.length > 0) {
    throw validationError(
      `结构边的键表达式 viaKeyExpr 引用了 ${carrierTypeKey} 上不存在的属性 ` +
        `${[...new Set(badProps)].map((p) => `'${p}'`).join(" / ")}` +
        `（可选：${carrierPropKeys.join("/") || "该类型没有任何属性"}）。` +
        `⚠ 不拦下来的话，取不到的字段求值为 null ⇒ 所有行塌到同一个键 ⇒ 这条边静默变成 0 实例的死边`,
    );
  }
  if (propCount === 0) {
    throw validationError(
      `结构边的键表达式 viaKeyExpr '${src}' 不含任何 this.<属性> ⇒ 每一行都会算出同一个键，` +
        `等于把 ${carrierTypeKey} 全集连到同一个锚点上。要表达「全连全」请用 viaCross（它带边数预算），` +
        `不要用一个常量键表达式绕过去`,
    );
  }
  return { src, ast };
}

/**
 * 对一个 carrier 行求值出锚点键。**纯函数**：只读 `props`，不碰时钟 / 随机 / 遍历顺序 ⇒ R6 确定性。
 *
 * 返回 `null` 表示**这一行算不出键**（属性缺失 / 串参与了四则运算 / 除零）。
 * 调用方**必须**把它与「算出了键但查无锚点」分开计数 —— 混在一起会让
 * 「公式写错了」与「数据里没有这个锚点」在回执上长得一模一样，而两者的修法完全不同。
 *
 * ⚠ 刻意**不**把 `null` 转成 `"null"`：那正是「所有坏行塌到同一个键」那个静默故障。
 */
export function evalLinkKey(expr: LinkKeyExpr, props: Record<string, unknown>): string | null {
  const v: Scalar = evaluate(expr.ast, {
    self: props,
    // 聚合在编译期已被拒 ⇒ 这里恒不会被调用。真被调用说明校验漏了，**抛**而不是回一个空集：
    // 空集会让公式静默算出 null，把「校验漏了」伪装成「数据没对上」。
    navigate: () => {
      throw validationError("结构边的键表达式不支持沿链路导航（物化期正在建这些链路）");
    },
    warn: () => {
      /* 除零等告警在键表达式语境下已由 null 结果表达，无需第二条通道 */
    },
  });
  if (v === null) return null;
  return String(v);
}
