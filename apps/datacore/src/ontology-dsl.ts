/**
 * 派生公式 DSL（PRD-addendum-ontology-core §2）。
 *
 * 实现 §2.1 EBNF 文法解析器（or/and/cmp/add/mul/unary/factor；propref `this.x`；
 * 单跳导航 out(linkKey)/in(linkKey)；聚合 SUM/MIN/MAX/AVG/COUNT 带可选 `.prop` 与
 * `WHERE ident==factor`；函数 IF/COALESCE/CLAMP），§2.3 依赖提取，§2.4 求值语义
 * （null 传播、COALESCE 兜底、除零→null+warning、decimal 定点 4 位）。
 *
 * 约束：导航仅单跳；聚合不可嵌套；公式长度 ≤2000。
 */
import { validationError } from "./errors.js";

export const MAX_FORMULA_LENGTH = 2000;
export const DECIMAL_SCALE = 4;

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

export type AggFn = "SUM" | "MIN" | "MAX" | "AVG" | "COUNT";
export type CmpOp = "==" | "!=" | ">" | ">=" | "<" | "<=";

export interface NavNode {
  kind: "nav";
  direction: "out" | "in";
  linkKey: string;
}

export type Ast =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "propref"; prop: string }
  | { kind: "unary"; op: "-"; operand: Ast }
  | { kind: "binary"; op: "+" | "-" | "*" | "/"; left: Ast; right: Ast }
  | { kind: "cmp"; op: CmpOp; left: Ast; right: Ast }
  | { kind: "and"; left: Ast; right: Ast }
  | { kind: "or"; left: Ast; right: Ast }
  | { kind: "agg"; fn: AggFn; nav: NavNode; prop?: string; where?: { prop: string; value: Ast } }
  | { kind: "if"; cond: Ast; then: Ast; else: Ast }
  | { kind: "coalesce"; args: Ast[] }
  | { kind: "clamp"; value: Ast; min: Ast; max: Ast };

// ---------------------------------------------------------------------------
// Tokeniser
// ---------------------------------------------------------------------------

type Token = { type: "num" | "str" | "ident" | "op" | "punc"; value: string };

const PUNC = new Set(["(", ")", ",", "."]);
const TWO_CHAR_OPS = new Set(["==", "!=", ">=", "<="]);
const ONE_CHAR_OPS = new Set(["+", "-", "*", "/", ">", "<"]);

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let str = "";
      while (j < src.length && src[j] !== quote) {
        if (src[j] === "\\" && j + 1 < src.length) {
          str += src[j + 1];
          j += 2;
        } else {
          str += src[j];
          j++;
        }
      }
      if (j >= src.length) throw validationError(`unterminated string literal in formula`);
      tokens.push({ type: "str", value: str });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j] as string)) j++;
      const num = src.slice(i, j);
      if ((num.match(/\./g) ?? []).length > 1) throw validationError(`bad number "${num}" in formula`);
      tokens.push({ type: "num", value: num });
      i = j;
      continue;
    }
    if (/[A-Za-z_一-龥]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_一-龥]/.test(src[j] as string)) j++;
      tokens.push({ type: "ident", value: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      tokens.push({ type: "op", value: two });
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPS.has(c)) {
      tokens.push({ type: "op", value: c });
      i++;
      continue;
    }
    if (PUNC.has(c)) {
      tokens.push({ type: "punc", value: c });
      i++;
      continue;
    }
    throw validationError(`unexpected character "${c}" in formula`);
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Recursive-descent parser (matches §2.1 EBNF)
// ---------------------------------------------------------------------------

const AGG_FNS = new Set(["SUM", "MIN", "MAX", "AVG", "COUNT"]);

class Parser {
  private pos = 0;
  /** true while parsing inside an aggregate (to forbid nested aggregates). */
  private inAgg = false;

  constructor(private readonly tokens: Token[]) {}

  parse(): Ast {
    const ast = this.parseExpr();
    if (this.pos !== this.tokens.length) {
      throw validationError(`trailing tokens in formula near "${this.peek()?.value ?? "<eof>"}"`);
    }
    return ast;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }
  private next(): Token {
    const t = this.tokens[this.pos];
    if (!t) throw validationError("unexpected end of formula");
    this.pos++;
    return t;
  }
  private isKeyword(v: string): boolean {
    const t = this.peek();
    return t?.type === "ident" && t.value === v;
  }
  private expectPunc(v: string): void {
    const t = this.next();
    if (t.type !== "punc" || t.value !== v) throw validationError(`expected "${v}" in formula, got "${t.value}"`);
  }

  private parseExpr(): Ast {
    return this.parseOr();
  }

  private parseOr(): Ast {
    let left = this.parseAnd();
    while (this.isKeyword("OR")) {
      this.next();
      const right = this.parseAnd();
      left = { kind: "or", left, right };
    }
    return left;
  }

  private parseAnd(): Ast {
    let left = this.parseCmp();
    while (this.isKeyword("AND")) {
      this.next();
      const right = this.parseCmp();
      left = { kind: "and", left, right };
    }
    return left;
  }

  private parseCmp(): Ast {
    const left = this.parseAdd();
    const t = this.peek();
    if (t?.type === "op" && (["==", "!=", ">", ">=", "<", "<="] as string[]).includes(t.value)) {
      this.next();
      const right = this.parseAdd();
      return { kind: "cmp", op: t.value as CmpOp, left, right };
    }
    return left;
  }

  private parseAdd(): Ast {
    let left = this.parseMul();
    for (;;) {
      const t = this.peek();
      if (t?.type === "op" && (t.value === "+" || t.value === "-")) {
        this.next();
        const right = this.parseMul();
        left = { kind: "binary", op: t.value, left, right };
      } else break;
    }
    return left;
  }

  private parseMul(): Ast {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t?.type === "op" && (t.value === "*" || t.value === "/")) {
        this.next();
        const right = this.parseUnary();
        left = { kind: "binary", op: t.value, left, right };
      } else break;
    }
    return left;
  }

  private parseUnary(): Ast {
    const t = this.peek();
    if (t?.type === "op" && t.value === "-") {
      this.next();
      return { kind: "unary", op: "-", operand: this.parseFactor() };
    }
    return this.parseFactor();
  }

  private parseFactor(): Ast {
    const t = this.peek();
    if (!t) throw validationError("unexpected end of formula");
    if (t.type === "num") {
      this.next();
      return { kind: "number", value: Number(t.value) };
    }
    if (t.type === "str") {
      this.next();
      return { kind: "string", value: t.value };
    }
    if (t.type === "punc" && t.value === "(") {
      this.next();
      const inner = this.parseExpr();
      this.expectPunc(")");
      return inner;
    }
    if (t.type === "ident") {
      if (t.value === "true" || t.value === "false") {
        this.next();
        return { kind: "bool", value: t.value === "true" };
      }
      if (t.value === "this") return this.parsePropref();
      if (AGG_FNS.has(t.value)) return this.parseAgg();
      if (t.value === "IF") return this.parseIf();
      if (t.value === "COALESCE") return this.parseCoalesce();
      if (t.value === "CLAMP") return this.parseClamp();
      if (t.value === "out" || t.value === "in") {
        throw validationError(`navigation "${t.value}(...)" must appear inside an aggregate`);
      }
      throw validationError(`unexpected identifier "${t.value}" in formula`);
    }
    throw validationError(`unexpected token "${t.value}" in formula`);
  }

  private parsePropref(): Ast {
    this.next(); // this
    this.expectPunc(".");
    const id = this.next();
    if (id.type !== "ident") throw validationError(`expected property name after "this."`);
    return { kind: "propref", prop: id.value };
  }

  private parseNav(): NavNode {
    const dir = this.next();
    if (dir.type !== "ident" || (dir.value !== "out" && dir.value !== "in")) {
      throw validationError(`expected out(...) or in(...) navigation`);
    }
    this.expectPunc("(");
    const id = this.next();
    if (id.type !== "ident") throw validationError(`expected link key inside ${dir.value}(...)`);
    this.expectPunc(")");
    return { kind: "nav", direction: dir.value, linkKey: id.value };
  }

  private parseAgg(): Ast {
    if (this.inAgg) throw validationError(`nested aggregate is not allowed`);
    const fnTok = this.next();
    const fn = fnTok.value as AggFn;
    this.expectPunc("(");
    this.inAgg = true;
    const nav = this.parseNav();
    let prop: string | undefined;
    if (this.peek()?.type === "punc" && this.peek()?.value === ".") {
      this.next();
      const id = this.next();
      if (id.type !== "ident") throw validationError(`expected property name after "."`);
      prop = id.value;
    }
    let where: { prop: string; value: Ast } | undefined;
    if (this.peek()?.type === "punc" && this.peek()?.value === ",") {
      this.next();
      if (!this.isKeyword("WHERE")) throw validationError(`expected WHERE clause in aggregate`);
      this.next();
      const wprop = this.next();
      if (wprop.type !== "ident") throw validationError(`expected property name in WHERE`);
      const eq = this.next();
      if (eq.type !== "op" || eq.value !== "==") throw validationError(`WHERE only supports == equality`);
      const val = this.parseFactor();
      where = { prop: wprop.value, value: val };
    }
    this.inAgg = false;
    this.expectPunc(")");
    return { kind: "agg", fn, nav, ...(prop ? { prop } : {}), ...(where ? { where } : {}) };
  }

  private parseIf(): Ast {
    this.next();
    this.expectPunc("(");
    const cond = this.parseExpr();
    this.expectPunc(",");
    const then = this.parseExpr();
    this.expectPunc(",");
    const els = this.parseExpr();
    this.expectPunc(")");
    return { kind: "if", cond, then, else: els };
  }

  private parseCoalesce(): Ast {
    this.next();
    this.expectPunc("(");
    const args: Ast[] = [this.parseExpr()];
    while (this.peek()?.type === "punc" && this.peek()?.value === ",") {
      this.next();
      args.push(this.parseExpr());
    }
    this.expectPunc(")");
    if (args.length < 2) throw validationError(`COALESCE requires at least 2 arguments`);
    return { kind: "coalesce", args };
  }

  private parseClamp(): Ast {
    this.next();
    this.expectPunc("(");
    const value = this.parseExpr();
    this.expectPunc(",");
    const min = this.parseExpr();
    this.expectPunc(",");
    const max = this.parseExpr();
    this.expectPunc(")");
    return { kind: "clamp", value, min, max };
  }
}

/** Parse a §2 derivation formula into an AST. Throws VALIDATION_ERROR on malformed input. */
export function parseFormula(formula: string): Ast {
  if (formula.length > MAX_FORMULA_LENGTH) {
    throw validationError(`formula exceeds ${MAX_FORMULA_LENGTH} characters`);
  }
  const tokens = tokenize(formula);
  if (tokens.length === 0) throw validationError("empty formula");
  return new Parser(tokens).parse();
}

// ---------------------------------------------------------------------------
// §2.3 dependency extraction
// ---------------------------------------------------------------------------

export interface Dep {
  /** Target type for the dependency: own type (propref) or the navigated type (aggregate). */
  typeKey: string;
  prop: string;
  /** link key for aggregate navigation; absent for `this.x`. */
  via?: string;
  direction?: "out" | "in";
}

/**
 * Extract the dependency set for a spec whose target object type is `ownType`.
 * `linkResolve(linkKey, direction)` returns the navigated object type key.
 * `this.x` → { ownType, x }; aggregate over `out(L).p` → { navType, p, via: L }.
 */
export function extractDeps(
  ast: Ast,
  ownType: string,
  linkResolve: (linkKey: string, direction: "out" | "in") => string | undefined,
): Dep[] {
  const seen = new Set<string>();
  const deps: Dep[] = [];
  const add = (d: Dep) => {
    const k = `${d.typeKey}|${d.prop}|${d.via ?? ""}`;
    if (seen.has(k)) return;
    seen.add(k);
    deps.push(d);
  };
  const walk = (node: Ast): void => {
    switch (node.kind) {
      case "propref":
        add({ typeKey: ownType, prop: node.prop });
        break;
      case "agg": {
        const navType = linkResolve(node.nav.linkKey, node.nav.direction);
        if (!navType) throw validationError(`unknown link key "${node.nav.linkKey}" in formula`);
        // COUNT without prop still depends on the navigated type's existence; record the WHERE prop too.
        if (node.prop) add({ typeKey: navType, prop: node.prop, via: node.nav.linkKey, direction: node.nav.direction });
        else add({ typeKey: navType, prop: "*", via: node.nav.linkKey, direction: node.nav.direction });
        if (node.where) add({ typeKey: navType, prop: node.where.prop, via: node.nav.linkKey, direction: node.nav.direction });
        break;
      }
      case "unary":
        walk(node.operand);
        break;
      case "binary":
      case "cmp":
      case "and":
      case "or":
        walk(node.left);
        walk(node.right);
        break;
      case "if":
        walk(node.cond);
        walk(node.then);
        walk(node.else);
        break;
      case "coalesce":
        node.args.forEach(walk);
        break;
      case "clamp":
        walk(node.value);
        walk(node.min);
        walk(node.max);
        break;
      default:
        break;
    }
  };
  walk(ast);
  return deps;
}

// ---------------------------------------------------------------------------
// §2.4 evaluation (null-propagating, decimal fixed-point)
// ---------------------------------------------------------------------------

export function decimalRound(v: number): number {
  // Fixed-point at DECIMAL_SCALE to avoid float drift (0.1 + 0.2 == 0.3).
  const f = 10 ** DECIMAL_SCALE;
  return Math.round((v + Number.EPSILON) * f) / f;
}

export type Scalar = number | string | boolean | null;

export interface EvalContext {
  /** Own object's properties. */
  self: Record<string, unknown>;
  /** Resolve navigated objects for an aggregate (already A6-agnostic; derivation runs as system). */
  navigate: (nav: NavNode) => Record<string, unknown>[];
  /** Sink for divide-by-zero and similar warnings. */
  warn: (msg: string) => void;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

/** Evaluate an aggregate over a navigated object set. */
function evalAgg(node: Extract<Ast, { kind: "agg" }>, ctx: EvalContext): Scalar {
  let objs = ctx.navigate(node.nav);
  if (node.where) {
    const wv = evaluate(node.where.value, ctx);
    objs = objs.filter((o) => o[node.where!.prop] === wv);
  }
  if (node.fn === "COUNT") return objs.length;
  const prop = node.prop;
  if (!prop) throw validationError(`${node.fn} requires a .prop`);
  const nums: number[] = [];
  for (const o of objs) {
    const n = asNumber(o[prop]);
    if (n !== null) nums.push(n);
  }
  if (nums.length === 0) return null; // empty set → null (propagates unless COALESCE)
  switch (node.fn) {
    case "SUM":
      return decimalRound(nums.reduce((a, b) => a + b, 0));
    case "MIN":
      return Math.min(...nums);
    case "MAX":
      return Math.max(...nums);
    case "AVG":
      return decimalRound(nums.reduce((a, b) => a + b, 0) / nums.length);
  }
}

/** Evaluate an AST against an object. Returns null when any required input is null. */
export function evaluate(node: Ast, ctx: EvalContext): Scalar {
  switch (node.kind) {
    case "number":
      return node.value;
    case "string":
      return node.value;
    case "bool":
      return node.value;
    case "propref": {
      const v = ctx.self[node.prop];
      if (v === undefined || v === null) return null;
      if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
      return null;
    }
    case "unary": {
      const v = evaluate(node.operand, ctx);
      if (v === null) return null;
      const n = asNumber(v);
      if (n === null) return null;
      return decimalRound(-n);
    }
    case "binary": {
      const l = evaluate(node.left, ctx);
      const r = evaluate(node.right, ctx);
      if (l === null || r === null) return null;
      const ln = asNumber(l);
      const rn = asNumber(r);
      if (ln === null || rn === null) return null;
      switch (node.op) {
        case "+":
          return decimalRound(ln + rn);
        case "-":
          return decimalRound(ln - rn);
        case "*":
          return decimalRound(ln * rn);
        case "/":
          if (rn === 0) {
            ctx.warn(`division by zero`);
            return null;
          }
          return decimalRound(ln / rn);
      }
      return null;
    }
    case "cmp": {
      const l = evaluate(node.left, ctx);
      const r = evaluate(node.right, ctx);
      if (l === null || r === null) return null;
      switch (node.op) {
        case "==":
          return l === r;
        case "!=":
          return l !== r;
        default: {
          const ln = asNumber(l);
          const rn = asNumber(r);
          if (ln === null || rn === null) return null;
          if (node.op === ">") return ln > rn;
          if (node.op === ">=") return ln >= rn;
          if (node.op === "<") return ln < rn;
          return ln <= rn;
        }
      }
    }
    case "and": {
      const l = evaluate(node.left, ctx);
      if (l === null) return null;
      if (l === false) return false;
      const r = evaluate(node.right, ctx);
      if (r === null) return null;
      return Boolean(l) && Boolean(r);
    }
    case "or": {
      const l = evaluate(node.left, ctx);
      if (l === null) return null;
      if (l === true) return true;
      const r = evaluate(node.right, ctx);
      if (r === null) return null;
      return Boolean(l) || Boolean(r);
    }
    case "agg":
      return evalAgg(node, ctx);
    case "if": {
      const c = evaluate(node.cond, ctx);
      if (c === null) return null;
      return c ? evaluate(node.then, ctx) : evaluate(node.else, ctx);
    }
    case "coalesce": {
      for (const arg of node.args) {
        const v = evaluate(arg, ctx);
        if (v !== null) return v;
      }
      return null;
    }
    case "clamp": {
      const v = evaluate(node.value, ctx);
      const mn = evaluate(node.min, ctx);
      const mx = evaluate(node.max, ctx);
      if (v === null || mn === null || mx === null) return null;
      const vn = asNumber(v);
      const mnn = asNumber(mn);
      const mxn = asNumber(mx);
      if (vn === null || mnn === null || mxn === null) return null;
      return decimalRound(Math.min(Math.max(vn, mnn), mxn));
    }
  }
}
