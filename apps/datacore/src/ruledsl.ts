/**
 * Rule DSL (platform PRD §4.2) — shared by A5 rule engine and the A6 rowFilter subset.
 *
 *   expr       := implies
 *   implies    := orExpr ("IMPLIES" orExpr)*           // a IMPLIES b ≡ NOT a OR b（C33）
 *   orExpr     := comparison | orExpr ("AND"|"OR") orExpr | "NOT" orExpr
 *   comparison := operand op operand
 *   operand    := field | literal | func "(" args ")" | userRef
 *   field      := objectType "." propName            // e.g. Order.demandDelta
 *   func       := SUM | MIN | MAX | COUNT | AVG
 *   op         := > | >= | < | <= | == | != | IN     // IN: rowFilter subset (scalar/array overlap)
 *   userRef    := user.<path>  |  ${user.<path>}     // rowFilter subset, resolved on AuthCtx
 */

export type AstNode =
  | { kind: "and"; left: AstNode; right: AstNode }
  | { kind: "or"; left: AstNode; right: AstNode }
  | { kind: "not"; operand: AstNode }
  | { kind: "cmp"; op: CmpOp; left: Operand; right: Operand }
  /** A8.5: SUSTAIN(comparison, days) — comparison held over the last `days` aggregation buckets. */
  | { kind: "sustain"; inner: AstNode; days: number };

export type CmpOp = ">" | ">=" | "<" | "<=" | "==" | "!=" | "IN";

export type Operand =
  | { kind: "field"; path: string[] }
  | { kind: "literal"; value: unknown }
  | { kind: "func"; name: "SUM" | "MIN" | "MAX" | "COUNT" | "AVG"; arg: { path: string[] } }
  | { kind: "user"; path: string[] };

export class DslError extends Error {
  /** 管理平台增量 §5：语法错误定位到字符位（0 起，相对原始 expression 字符串）。 */
  constructor(
    message: string,
    public readonly position: number | null = null,
  ) {
    super(message);
    this.name = "DslError";
  }
}

// --------------------------------------------------------------------------
// Lexer
// --------------------------------------------------------------------------

type Token = (
  | { t: "ident"; v: string }
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "op"; v: string }
  | { t: "punct"; v: string }
  | { t: "userref"; v: string } // ${user.x.y}
) & { pos: number }; // 字符位（0 起，token 起始）

const KEYWORDS = new Set(["AND", "OR", "NOT", "IN", "TRUE", "FALSE", "NULL", "IMPLIES"]);
const FUNCS = new Set(["SUM", "MIN", "MAX", "COUNT", "AVG"]);

function lex(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "$" && src[i + 1] === "{") {
      const end = src.indexOf("}", i);
      if (end < 0) throw new DslError("unterminated ${...}", i);
      tokens.push({ t: "userref", v: src.slice(i + 2, end).trim(), pos: i });
      i = end + 1;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== quote) {
        s += src[j];
        j++;
      }
      if (j >= src.length) throw new DslError("unterminated string literal", i);
      tokens.push({ t: "str", v: s, pos: i });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "-" && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < src.length && /[0-9.eE_]/.test(src[j] as string)) j++;
      tokens.push({ t: "num", v: Number(src.slice(i, j).replace(/_/g, "")), pos: i });
      i = j;
      continue;
    }
    if (/[A-Za-z_À-￿]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_.À-￿]/.test(src[j] as string)) j++;
      tokens.push({ t: "ident", v: src.slice(i, j), pos: i });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === ">=" || two === "<=" || two === "==" || two === "!=") {
      tokens.push({ t: "op", v: two, pos: i });
      i += 2;
      continue;
    }
    if (c === ">" || c === "<") {
      tokens.push({ t: "op", v: c, pos: i });
      i++;
      continue;
    }
    if (c === "(" || c === ")" || c === "," || c === "[" || c === "]") {
      tokens.push({ t: "punct", v: c, pos: i });
      i++;
      continue;
    }
    throw new DslError(`unexpected character '${c}' at ${i}`, i);
  }
  return tokens;
}

// --------------------------------------------------------------------------
// Parser (recursive descent)
// --------------------------------------------------------------------------

class Parser {
  private pos = 0;
  constructor(
    private tokens: Token[],
    private endPos = 0,
  ) {}

  /** 抛出带字符位的语法错误（当前 token 起始位；流耗尽 → 表达式末尾）。 */
  private fail(message: string): never {
    throw new DslError(message, this.tokens[this.pos]?.pos ?? this.endPos);
  }

  parse(): AstNode {
    const node = this.parseImplies();
    if (this.pos < this.tokens.length) this.fail("unexpected trailing tokens");
    return node;
  }

  /** IMPLIES（最低优先级）：`a IMPLIES b` ≡ `NOT a OR b`（PRD-catalog §3 C33；解析期脱糖,复用 or/not 节点,求值器零改）。 */
  private parseImplies(): AstNode {
    let left = this.parseOr();
    while (this.isKeyword("IMPLIES")) {
      this.pos++;
      const right = this.parseOr();
      left = { kind: "or", left: { kind: "not", operand: left }, right };
    }
    return left;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private isKeyword(kw: string): boolean {
    const t = this.peek();
    return t?.t === "ident" && t.v.toUpperCase() === kw;
  }

  private parseOr(): AstNode {
    let left = this.parseAnd();
    while (this.isKeyword("OR")) {
      this.pos++;
      left = { kind: "or", left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): AstNode {
    let left = this.parseUnary();
    while (this.isKeyword("AND")) {
      this.pos++;
      left = { kind: "and", left, right: this.parseUnary() };
    }
    return left;
  }

  private parseUnary(): AstNode {
    if (this.isKeyword("NOT")) {
      this.pos++;
      return { kind: "not", operand: this.parseUnary() };
    }
    if (this.isKeyword("SUSTAIN")) {
      const open = this.tokens[this.pos + 1];
      if (open?.t === "punct" && open.v === "(") {
        this.pos += 2;
        const inner = this.parseOr();
        const comma = this.peek();
        if (!(comma?.t === "punct" && comma.v === ",")) this.fail("SUSTAIN expects (comparison, days)");
        this.pos++;
        const daysTok = this.peek();
        if (daysTok?.t !== "num") this.fail("SUSTAIN days must be a number");
        this.pos++;
        const close = this.peek();
        if (!(close?.t === "punct" && close.v === ")")) this.fail("expected ) after SUSTAIN");
        this.pos++;
        return { kind: "sustain", inner, days: Math.max(1, Math.floor(daysTok.v)) };
      }
    }
    const t = this.peek();
    if (t?.t === "punct" && t.v === "(") {
      // Could be a parenthesized expression
      const save = this.pos;
      this.pos++;
      try {
        const inner = this.parseImplies(); // 括号内走最高层（含 IMPLIES，支持 NOT (a IMPLIES b)）
        const close = this.peek();
        if (close?.t === "punct" && close.v === ")") {
          this.pos++;
          return inner;
        }
        this.fail("expected )");
      } catch (e) {
        this.pos = save;
        throw e;
      }
    }
    return this.parseComparison();
  }

  private parseComparison(): AstNode {
    const left = this.parseOperand();
    const t = this.peek();
    if (t?.t === "op") {
      this.pos++;
      return { kind: "cmp", op: t.v as CmpOp, left, right: this.parseOperand() };
    }
    if (t?.t === "ident" && t.v.toUpperCase() === "IN") {
      this.pos++;
      return { kind: "cmp", op: "IN", left, right: this.parseOperand() };
    }
    this.fail("expected comparison operator");
  }

  private parseOperand(): Operand {
    const t = this.peek();
    if (!t) this.fail("unexpected end of expression");
    if (t.t === "num") {
      this.pos++;
      return { kind: "literal", value: t.v };
    }
    if (t.t === "str") {
      this.pos++;
      return { kind: "literal", value: t.v };
    }
    if (t.t === "userref") {
      this.pos++;
      const path = t.v.split(".").filter(Boolean);
      if (path[0] === "user") path.shift();
      return { kind: "user", path };
    }
    if (t.t === "punct" && t.v === "[") {
      this.pos++;
      const values: unknown[] = [];
      for (;;) {
        const el = this.peek();
        if (!el) this.fail("unterminated array literal");
        if (el.t === "punct" && el.v === "]") {
          this.pos++;
          break;
        }
        if (el.t === "punct" && el.v === ",") {
          this.pos++;
          continue;
        }
        if (el.t === "num" || el.t === "str") {
          values.push(el.v);
          this.pos++;
          continue;
        }
        this.fail("array literals may only contain numbers/strings");
      }
      return { kind: "literal", value: values };
    }
    if (t.t === "ident") {
      const upper = t.v.toUpperCase();
      if (upper === "TRUE" || upper === "FALSE") {
        this.pos++;
        return { kind: "literal", value: upper === "TRUE" };
      }
      if (upper === "NULL") {
        this.pos++;
        return { kind: "literal", value: null };
      }
      if (FUNCS.has(upper)) {
        const next = this.tokens[this.pos + 1];
        if (next?.t === "punct" && next.v === "(") {
          this.pos += 2;
          const arg = this.peek();
          if (arg?.t !== "ident") this.fail(`${upper}() expects a field argument`);
          this.pos++;
          const close = this.peek();
          if (!(close?.t === "punct" && close.v === ")")) this.fail("expected )");
          this.pos++;
          return {
            kind: "func",
            name: upper as "SUM" | "MIN" | "MAX" | "COUNT" | "AVG",
            arg: { path: arg.v.split(".") },
          };
        }
      }
      if (KEYWORDS.has(upper)) this.fail(`unexpected keyword ${t.v}`);
      this.pos++;
      const path = t.v.split(".");
      if (path[0] === "user") return { kind: "user", path: path.slice(1) };
      return { kind: "field", path };
    }
    this.fail(`unexpected token ${JSON.stringify(t)}`);
  }
}

export function parseExpression(src: string): AstNode {
  const trimmed = src.trim();
  if (!trimmed) throw new DslError("empty expression", 0);
  const offset = src.indexOf(trimmed); // 前导空白长度（字符位换算回原始字符串）
  try {
    return new Parser(lex(trimmed), trimmed.length).parse();
  } catch (e) {
    if (e instanceof DslError && e.position != null && offset > 0) {
      throw new DslError(e.message, e.position + offset);
    }
    throw e;
  }
}

// --------------------------------------------------------------------------
// Evaluator
// --------------------------------------------------------------------------

export interface EvalContext {
  /** Rule payload or object props. Field `Order.demandDelta` resolves
   *  payload.Order.demandDelta, then payload.demandDelta. */
  payload: Record<string, unknown>;
  /** User for ${user.attr} references (rowFilter subset). */
  user?: { userId?: string; roles?: string[]; attributes?: Record<string, unknown> };
  /**
   * A8.5 SUSTAIN evaluator — supplied by the rule-scan engine, which checks the
   * inner comparison against the last `days` ts_agg_runs buckets (NOT snapshot
   * single values). Without a provider SUSTAIN evaluates to false.
   */
  sustain?: (inner: AstNode, days: number) => boolean;
}

/** First field operand inside a SUSTAIN comparison (e.g. Line.utilization). */
export function sustainField(inner: AstNode): string[] | null {
  switch (inner.kind) {
    case "cmp":
      if (inner.left.kind === "field") return inner.left.path;
      if (inner.right.kind === "field") return inner.right.path;
      return null;
    case "and":
    case "or":
      return sustainField(inner.left) ?? sustainField(inner.right);
    case "not":
      return sustainField(inner.operand);
    default:
      return null;
  }
}

/** 收集表达式引用的所有字段路径（field operand）。规则即引用：用于判定该规则字段是否在
 *  求解器 payload 内可解析——全不可解析 → NOT_APPLICABLE（诚实标，不冒充 PASS）。 */
export function collectFieldPaths(node: AstNode, acc: string[][] = []): string[][] {
  const op = (o: Operand): void => { if (o.kind === "field") acc.push(o.path); };
  switch (node.kind) {
    case "and":
    case "or":
      collectFieldPaths(node.left, acc);
      collectFieldPaths(node.right, acc);
      break;
    case "not":
      collectFieldPaths(node.operand, acc);
      break;
    case "cmp":
      op(node.left);
      op(node.right);
      break;
    case "sustain":
      collectFieldPaths(node.inner, acc);
      break;
  }
  return acc;
}

function drill(root: unknown, path: string[]): unknown {
  let cur = root;
  for (const seg of path) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Resolve a field path with the leading objectType prefix being optional. */
export function resolveField(payload: Record<string, unknown>, path: string[]): unknown {
  const direct = drill(payload, path);
  if (direct !== undefined) return direct;
  if (path.length > 1) {
    const skipped = drill(payload, path.slice(1));
    if (skipped !== undefined) return skipped;
  }
  return undefined;
}

function resolveCollection(payload: Record<string, unknown>, path: string[]): unknown[] {
  // SUM(Order.qty): payload.Order (array of objects) -> map .qty ; or payload.qty as number[]
  for (let split = path.length - 1; split >= 1; split--) {
    const head = path.slice(0, split);
    const rest = path.slice(split);
    let coll = drill(payload, head);
    if (coll === undefined && head.length > 1) coll = drill(payload, head.slice(1));
    if (Array.isArray(coll)) {
      return rest.length === 0 ? coll : coll.map((el) => drill(el, rest));
    }
  }
  const whole = resolveField(payload, path);
  if (Array.isArray(whole)) return whole;
  return whole === undefined ? [] : [whole];
}

function evalOperand(op: Operand, ctx: EvalContext): unknown {
  switch (op.kind) {
    case "literal":
      return op.value;
    case "field":
      return resolveField(ctx.payload, op.path);
    case "user": {
      const root: Record<string, unknown> = {
        userId: ctx.user?.userId,
        roles: ctx.user?.roles,
        attributes: ctx.user?.attributes ?? {},
        ...(ctx.user?.attributes ?? {}),
      };
      return drill(root, op.path);
    }
    case "func": {
      const values = resolveCollection(ctx.payload, op.arg.path);
      if (op.name === "COUNT") return values.length;
      const nums = values.filter((v): v is number => typeof v === "number");
      if (nums.length === 0) return 0;
      switch (op.name) {
        case "SUM":
          return nums.reduce((a, b) => a + b, 0);
        case "MIN":
          return Math.min(...nums);
        case "MAX":
          return Math.max(...nums);
        case "AVG":
          return nums.reduce((a, b) => a + b, 0) / nums.length;
      }
    }
  }
}

function compare(op: CmpOp, l: unknown, r: unknown): boolean {
  if (op === "IN") {
    const arr = Array.isArray(r) ? r : r == null ? [] : [r];
    if (Array.isArray(l)) return l.some((v) => arr.includes(v));
    return arr.includes(l);
  }
  if (op === "==") return l === r;
  if (op === "!=") return l !== r;
  if (typeof l !== "number" || typeof r !== "number") return false;
  switch (op) {
    case ">":
      return l > r;
    case ">=":
      return l >= r;
    case "<":
      return l < r;
    case "<=":
      return l <= r;
  }
  return false;
}

export function evaluateAst(node: AstNode, ctx: EvalContext): boolean {
  switch (node.kind) {
    case "and":
      return evaluateAst(node.left, ctx) && evaluateAst(node.right, ctx);
    case "or":
      return evaluateAst(node.left, ctx) || evaluateAst(node.right, ctx);
    case "not":
      return !evaluateAst(node.operand, ctx);
    case "cmp":
      return compare(node.op, evalOperand(node.left, ctx), evalOperand(node.right, ctx));
    case "sustain":
      return ctx.sustain ? ctx.sustain(node.inner, node.days) : false;
  }
}

export function evaluateExpression(src: string, ctx: EvalContext): boolean {
  return evaluateAst(parseExpression(src), ctx);
}
