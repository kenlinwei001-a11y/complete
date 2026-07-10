/**
 * E2 转换引擎：MAP 计算列 / FILTER 谓词的小型确定性表达式求值器。
 *
 * 支持：列引用（裸标识符，含 CJK）、数值/字符串/布尔/null 字面量、算术 + - * /（含一元 -）、
 * 比较 == != > >= < <=、逻辑 and/or/not（及 && || !）、括号、少量内建函数
 * （coalesce/concat/upper/lower/abs/round/floor/ceil/length）。
 *
 * 无 eval/Function。数值结果定点到 6 位小数（避免浮点漂移，保证同输入字节级一致）。
 */
import { validationError } from "../errors.js";

const DECIMAL_SCALE = 6;
export function round6(v: number): number {
  const f = 10 ** DECIMAL_SCALE;
  return Math.round((v + Number.EPSILON) * f) / f;
}

export type ExprAst =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "null" }
  | { kind: "col"; name: string }
  | { kind: "unary"; op: "-" | "not"; operand: ExprAst }
  | { kind: "binary"; op: "+" | "-" | "*" | "/"; left: ExprAst; right: ExprAst }
  | { kind: "cmp"; op: "==" | "!=" | ">" | ">=" | "<" | "<="; left: ExprAst; right: ExprAst }
  | { kind: "and"; left: ExprAst; right: ExprAst }
  | { kind: "or"; left: ExprAst; right: ExprAst }
  | { kind: "call"; name: string; args: ExprAst[] };

// ---------------------------------------------------------------------------
// Tokeniser
// ---------------------------------------------------------------------------

type Token = { type: "num" | "str" | "ident" | "op" | "punc"; value: string };

const TWO_CHAR_OPS = new Set(["==", "!=", ">=", "<=", "&&", "||"]);
const ONE_CHAR_OPS = new Set(["+", "-", "*", "/", ">", "<", "!"]);
const PUNC = new Set(["(", ")", ","]);
const BUILTINS = new Set(["coalesce", "concat", "upper", "lower", "abs", "round", "floor", "ceil", "length"]);

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
      if (j >= src.length) throw validationError(`unterminated string literal in expression`);
      tokens.push({ type: "str", value: str });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j] as string)) j++;
      const num = src.slice(i, j);
      if ((num.match(/\./g) ?? []).length > 1) throw validationError(`bad number "${num}" in expression`);
      tokens.push({ type: "num", value: num });
      i = j;
      continue;
    }
    // identifiers: latin/underscore/CJK + digits (not leading digit)
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
    throw validationError(`unexpected character "${c}" in expression`);
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Recursive-descent parser (precedence: or < and < cmp < add < mul < unary < factor)
// ---------------------------------------------------------------------------

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): ExprAst {
    const ast = this.parseOr();
    if (this.pos !== this.tokens.length) {
      throw validationError(`trailing tokens in expression near "${this.peek()?.value ?? "<eof>"}"`);
    }
    return ast;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }
  private next(): Token {
    const t = this.tokens[this.pos];
    if (!t) throw validationError("unexpected end of expression");
    this.pos++;
    return t;
  }
  private isKeyword(v: string): boolean {
    const t = this.peek();
    return t?.type === "ident" && t.value === v;
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return t?.type === "op" && t.value === v;
  }

  private parseOr(): ExprAst {
    let left = this.parseAnd();
    while (this.isKeyword("or") || this.isOp("||")) {
      this.next();
      left = { kind: "or", left, right: this.parseAnd() };
    }
    return left;
  }
  private parseAnd(): ExprAst {
    let left = this.parseCmp();
    while (this.isKeyword("and") || this.isOp("&&")) {
      this.next();
      left = { kind: "and", left, right: this.parseCmp() };
    }
    return left;
  }
  private parseCmp(): ExprAst {
    const left = this.parseAdd();
    const t = this.peek();
    if (t?.type === "op" && (["==", "!=", ">", ">=", "<", "<="] as string[]).includes(t.value)) {
      this.next();
      return { kind: "cmp", op: t.value as "==" | "!=" | ">" | ">=" | "<" | "<=", left, right: this.parseAdd() };
    }
    return left;
  }
  private parseAdd(): ExprAst {
    let left = this.parseMul();
    for (;;) {
      const t = this.peek();
      if (t?.type === "op" && (t.value === "+" || t.value === "-")) {
        this.next();
        left = { kind: "binary", op: t.value, left, right: this.parseMul() };
      } else break;
    }
    return left;
  }
  private parseMul(): ExprAst {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t?.type === "op" && (t.value === "*" || t.value === "/")) {
        this.next();
        left = { kind: "binary", op: t.value, left, right: this.parseUnary() };
      } else break;
    }
    return left;
  }
  private parseUnary(): ExprAst {
    if (this.isOp("-")) {
      this.next();
      return { kind: "unary", op: "-", operand: this.parseUnary() };
    }
    if (this.isOp("!") || this.isKeyword("not")) {
      this.next();
      return { kind: "unary", op: "not", operand: this.parseUnary() };
    }
    return this.parseFactor();
  }
  private parseFactor(): ExprAst {
    const t = this.peek();
    if (!t) throw validationError("unexpected end of expression");
    if (t.type === "num") {
      this.next();
      return { kind: "num", value: Number(t.value) };
    }
    if (t.type === "str") {
      this.next();
      return { kind: "str", value: t.value };
    }
    if (t.type === "punc" && t.value === "(") {
      this.next();
      const inner = this.parseOr();
      const close = this.next();
      if (close.type !== "punc" || close.value !== ")") throw validationError(`expected ")" in expression`);
      return inner;
    }
    if (t.type === "ident") {
      if (t.value === "true" || t.value === "false") {
        this.next();
        return { kind: "bool", value: t.value === "true" };
      }
      if (t.value === "null") {
        this.next();
        return { kind: "null" };
      }
      // function call?
      const nextTok = this.tokens[this.pos + 1];
      if (nextTok && nextTok.type === "punc" && nextTok.value === "(") {
        const name = t.value;
        if (!BUILTINS.has(name)) throw validationError(`unknown function "${name}" in expression`);
        this.next(); // name
        this.next(); // (
        const args: ExprAst[] = [];
        if (!(this.peek()?.type === "punc" && this.peek()?.value === ")")) {
          args.push(this.parseOr());
          while (this.peek()?.type === "punc" && this.peek()?.value === ",") {
            this.next();
            args.push(this.parseOr());
          }
        }
        const close = this.next();
        if (close.type !== "punc" || close.value !== ")") throw validationError(`expected ")" after ${name}(...)`);
        return { kind: "call", name, args };
      }
      this.next();
      return { kind: "col", name: t.value };
    }
    throw validationError(`unexpected token "${t.value}" in expression`);
  }
}

export function parseExpr(src: string): ExprAst {
  const tokens = tokenize(src);
  if (tokens.length === 0) throw validationError("empty expression");
  return new Parser(tokens).parse();
}

/** Column identifiers referenced by an AST (deduped, sorted) — drives lineage + validation. */
export function refsOf(ast: ExprAst): string[] {
  const seen = new Set<string>();
  const walk = (n: ExprAst): void => {
    switch (n.kind) {
      case "col":
        seen.add(n.name);
        break;
      case "unary":
        walk(n.operand);
        break;
      case "binary":
      case "cmp":
      case "and":
      case "or":
        walk(n.left);
        walk(n.right);
        break;
      case "call":
        n.args.forEach(walk);
        break;
      default:
        break;
    }
  };
  walk(ast);
  return [...seen].sort();
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export type Scalar = number | string | boolean | null;

function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function truthy(v: Scalar): boolean {
  if (v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return v !== "";
}

export function evalExpr(ast: ExprAst, row: Record<string, unknown>): Scalar {
  switch (ast.kind) {
    case "num":
      return ast.value;
    case "str":
      return ast.value;
    case "bool":
      return ast.value;
    case "null":
      return null;
    case "col": {
      const v = row[ast.name];
      if (v === undefined || v === null) return null;
      if (typeof v === "number") return Number.isFinite(v) ? v : null;
      if (typeof v === "string" || typeof v === "boolean") return v;
      return null; // objects/arrays not scalar
    }
    case "unary": {
      const v = evalExpr(ast.operand, row);
      if (ast.op === "not") return !truthy(v);
      if (v === null) return null;
      const n = toNum(v);
      return n === null ? null : round6(-n);
    }
    case "binary": {
      const l = evalExpr(ast.left, row);
      const r = evalExpr(ast.right, row);
      if (l === null || r === null) return null;
      const ln = toNum(l);
      const rn = toNum(r);
      if (ln === null || rn === null) return null;
      switch (ast.op) {
        case "+":
          return round6(ln + rn);
        case "-":
          return round6(ln - rn);
        case "*":
          return round6(ln * rn);
        case "/":
          return rn === 0 ? null : round6(ln / rn);
      }
      return null;
    }
    case "cmp": {
      const l = evalExpr(ast.left, row);
      const r = evalExpr(ast.right, row);
      if (ast.op === "==" || ast.op === "!=") {
        const eq = scalarEq(l, r);
        return ast.op === "==" ? eq : !eq;
      }
      if (l === null || r === null) return null;
      const ln = toNum(l);
      const rn = toNum(r);
      const [a, b]: [number | string, number | string] =
        ln !== null && rn !== null ? [ln, rn] : [String(l), String(r)];
      switch (ast.op) {
        case ">":
          return a > b;
        case ">=":
          return a >= b;
        case "<":
          return a < b;
        case "<=":
          return a <= b;
      }
      return null;
    }
    case "and": {
      const l = evalExpr(ast.left, row);
      if (!truthy(l)) return false;
      return truthy(evalExpr(ast.right, row));
    }
    case "or": {
      const l = evalExpr(ast.left, row);
      if (truthy(l)) return true;
      return truthy(evalExpr(ast.right, row));
    }
    case "call":
      return evalCall(ast, row);
  }
}

function scalarEq(l: Scalar, r: Scalar): boolean {
  if (l === null || r === null) return l === r;
  const ln = toNum(l);
  const rn = toNum(r);
  if (ln !== null && rn !== null) return ln === rn;
  return String(l) === String(r);
}

function evalCall(ast: Extract<ExprAst, { kind: "call" }>, row: Record<string, unknown>): Scalar {
  const args = ast.args.map((a) => evalExpr(a, row));
  switch (ast.name) {
    case "coalesce": {
      for (const a of args) if (a !== null) return a;
      return null;
    }
    case "concat":
      return args.map((a) => (a === null ? "" : String(a))).join("");
    case "upper":
      return args[0] === null || args[0] === undefined ? null : String(args[0]).toUpperCase();
    case "lower":
      return args[0] === null || args[0] === undefined ? null : String(args[0]).toLowerCase();
    case "length":
      return args[0] === null || args[0] === undefined ? null : String(args[0]).length;
    case "abs": {
      const n = toNum(args[0]);
      return n === null ? null : round6(Math.abs(n));
    }
    case "round": {
      const n = toNum(args[0]);
      if (n === null) return null;
      const digits = args.length > 1 ? toNum(args[1]) ?? 0 : 0;
      const f = 10 ** digits;
      return Math.round((n + Number.EPSILON) * f) / f;
    }
    case "floor": {
      const n = toNum(args[0]);
      return n === null ? null : Math.floor(n);
    }
    case "ceil": {
      const n = toNum(args[0]);
      return n === null ? null : Math.ceil(n);
    }
    default:
      throw validationError(`unknown function "${ast.name}"`);
  }
}
