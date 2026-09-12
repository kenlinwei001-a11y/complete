/**
 * WO-PREDICATE-EDGE · **谓词边**：由一个谓词（而非仅外键存在性）决定两个对象之间有没有关系。
 *
 * ── 这个文件为什么存在，以及它**刻意不做**什么 ────────────────────────────────
 * `materializeDeclaredLinks` 今天的连接口径是「carrier.props[viaProperty] === anchor 业务主键」。
 * 它只问「值对不对得上」，不问「这一行**该不该**参与这条边」。实测本仓有三条边正是差这一问：
 *
 * | 边 | 种子里的守卫 | 缺了谓词会怎样 |
 * |---|---|---|
 * | `material_carbon` Material→CarbonFactor | `if (cf.kind === "material")`（`synthetic/service.ts:1103`） | `CarbonFactor(kind,key)` 是**通用查表**，`kind==="energy"` 的行 `key` 也可能撞上 matId ⇒ 连出脏边 |
 * | `defect_raises_exception` DefectRecord→ExceptionEvent | `if (refType === "DefectRecord")`（`:1129`） | 另外 4 种 `refType` 的异常会被一起连进缺陷链 |
 * | `exc_sourced_from` ExceptionEvent→* | 多态（`refType` 决定目标类型） | 谓词能筛行，**不能让目标类型随行变**（见下「诚实边界」） |
 *
 * **「能连出边」和「连对了边」是两个命题**（铁律 1.5）：没有谓词，上面两条要么不声明（图上没有），
 * 要么声明后静默多连 —— 多出来的边不会报错，只会让下钻结果变多。
 *
 * ── 复用，不另造（本单硬约束）──────────────────────────────────────────────
 * 表达式的**词法 / 语法 / 求值**全部复用 `ruledsl.ts`（A5 规则 DSL，同一份 `parseExpression`
 * + `evaluateAst`）。本文件**一行解析代码都没有**，只做两件事：**收窄子集** 与 **写入期校验**。
 * 另造一套 = 两套机制不对接，正是本仓踩过的坑。
 *
 * ── 诚实边界（写下来防止被当成「表达式边」）────────────────────────────────
 * 谓词只能**筛掉 carrier 行**，不能**算出端点**。所以它治不了这些形态：
 * · 端点由值变换得出（`lineId.replace("LINE-","")` / `PT-${due.slice(0,7)}` / 串匹配出 segment）
 * · 端点由条件常量得出（`level==="month" ? "prin-plan" : "prin-coo"`）
 * · 叉积（每基地 × 每数据源）—— 谓词能收窄一个连接，造不出一个连接
 * · 多态目标（`exc_sourced_from` 的 `toTypeKey` 随行变；`LinkTypeDef.toTypeKey` 是固定的）
 * 这四类要的是**表达式产边**，是另一件事、另一份代价。谓词可后加成表达式，反向不可逆 ⇒ 先只做这一半。
 *
 * ── 为什么子集收得这么窄（每一条都是「哑弹边」的堵口）──────────────────────
 * `ruledsl` 的求值器在**取不到值**时一律 `compare(...) === false`。用在规则上那是「不越线」，
 * 用在物化上那是**每一行都被筛掉 ⇒ 0 实例的死边，且全程不报错**。本仓已经因为
 * 「打错一个字就静默造一条永远 0 实例的死边」吃过一次亏（见 `ontology.ts` 里 `viaProperty` 的 400）。
 * 所以下面每一样**在写入期就 400 点名**，而不是留到物化期变成一个安静的 0：
 * · **字段必须真是 carrier 的属性** —— 打错字 ⇒ `undefined == "material"` ⇒ 恒 false ⇒ 死边
 * · **禁 `params.*`** —— 结构边没有 `params` 袋子，`evalOperand` 会在物化中途抛 DslError
 * · **禁 `user.*`** —— 它让**同一份数据对不同用户产出不同边集**，直接破 R6 确定性
 * · **禁 `SUSTAIN`** —— 没有 `ctx.sustain` 提供者时 `evaluateAst` 恒返回 false ⇒ 死边
 * · **禁 `SUM/MIN/MAX/COUNT/AVG`** —— 谓词是**逐行**判定，聚合在单行上无意义且会静默给 0
 */

import {
  DslError,
  evaluateAst,
  parseExpression,
  type AstNode,
  type Operand,
} from "./ruledsl.js";

/** 编译后的谓词。`src` 原样留着——报错/审计要能回显用户写的那一句。 */
export interface LinkPredicate {
  readonly src: string;
  readonly ast: AstNode;
}

/** 一次遍历收齐所有操作数与节点种类，供子集校验逐条点名。 */
function walk(node: AstNode, onOperand: (o: Operand) => void, onSustain: () => void): void {
  switch (node.kind) {
    case "and":
    case "or":
      walk(node.left, onOperand, onSustain);
      walk(node.right, onOperand, onSustain);
      break;
    case "not":
      walk(node.operand, onOperand, onSustain);
      break;
    case "cmp":
      onOperand(node.left);
      onOperand(node.right);
      break;
    case "sustain":
      onSustain();
      walk(node.inner, onOperand, onSustain);
      break;
  }
}

/**
 * 把 `viaWhere` 原文编译成谓词，并在**写入期**把全部「会变成哑弹边」的写法拒掉。
 *
 * @param carrierTypeKey  外键长在哪一侧的类型 key（`viaSide === "from" ? fromTypeKey : toTypeKey`）——
 *                        谓词是对 **carrier 行**求值的，所以字段只能引用它的属性。
 * @param carrierPropKeys carrier 类型的属性名全集；用于「字段真存在」校验（打错字当场 400）。
 * @throws DslError 语法错误（带字符位）或用到被禁子集 / 引用了不存在的属性。
 */
export function compileLinkPredicate(
  src: string,
  carrierTypeKey: string,
  carrierPropKeys: readonly string[],
): LinkPredicate {
  const ast = parseExpression(src); // 语法错误直接抛 DslError（带字符位），不吞
  const known = new Set(carrierPropKeys);
  const badFields: string[] = [];
  const banned: string[] = [];

  walk(
    ast,
    (o) => {
      switch (o.kind) {
        case "param":
          banned.push(`params.${o.name}（结构边没有命名阈值袋子）`);
          break;
        case "user":
          banned.push(`user.${o.path.join(".")}（会让同一份数据对不同用户产出不同边集，破坏确定性）`);
          break;
        case "func":
          banned.push(`${o.name}(…)（谓词是逐行判定，聚合在单行上无意义）`);
          break;
        case "field": {
          // 只认两种形状：`prop` 与 `<carrierTypeKey>.prop`。别的一律点名拒绝，
          // 不做「前缀可省」那种静默回退 —— 回退在这里等于把打错的字段读成 undefined。
          const p = o.path;
          const bare = p.length === 1 ? p[0] : p.length === 2 && p[0] === carrierTypeKey ? p[1] : undefined;
          if (bare === undefined || !known.has(bare)) badFields.push(p.join("."));
          break;
        }
        case "literal":
          break;
      }
    },
    () => banned.push("SUSTAIN(…)（物化路径没有时序桶提供者，恒为假 ⇒ 死边）"),
  );

  if (banned.length > 0) {
    throw new DslError(
      `谓词 viaWhere 用到了结构边不支持的写法：${banned.join("；")}。` +
        `谓词只支持对 ${carrierTypeKey} 自身属性的比较与 AND/OR/NOT`,
    );
  }
  if (badFields.length > 0) {
    throw new DslError(
      `谓词 viaWhere 引用了 ${carrierTypeKey} 上不存在的属性 ${badFields.map((f) => `'${f}'`).join(" / ")}` +
        `（可选：${carrierPropKeys.join("/") || "该类型没有任何属性"}）。` +
        `⚠ 不拦下来的话，取不到的字段会恒判为假 ⇒ 这条边静默变成 0 实例的死边`,
    );
  }
  return { src, ast };
}

/**
 * 对一个 carrier 行求值。**纯函数**：只读 `props`，不碰时钟 / 随机 / 遍历顺序 ⇒ R6 确定性。
 *
 * 载荷同时提供**带类型前缀**与**裸字段**两种形状（`CarbonFactor.kind` 与 `kind` 都解析得到），
 * 与 `ruledsl.resolveField` 的既有口径一致。类型 key 放在展开之后 ⇒ 万一某个属性恰好叫
 * 类型名，以类型前缀语义为准（此时该属性只能用裸名引用，已在编译期允许）。
 */
export function linkPredicateHolds(
  pred: LinkPredicate,
  carrierTypeKey: string,
  props: Record<string, unknown>,
): boolean {
  return evaluateAst(pred.ast, { payload: { ...props, [carrierTypeKey]: props } });
}
