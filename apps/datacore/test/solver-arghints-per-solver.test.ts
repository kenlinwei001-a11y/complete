/**
 * WO-ARGHINTS-12-LOUD · 目录 `argHints` 与求解器实现的**逐求解器**一致性（门形态的测试，非门脚本）。
 *
 * ── 它挡的是哪一类事故 ────────────────────────────────────────────────────────────
 * 目录（**模型看得见的那一份** —— `agentcore` 的 `tools/executor.ts` 把 `argHints` 原样放进 `discover`
 * 返回给 LLM 的 items）说要传 A，实现读的是 B。模型照 A 生成参数 → **400 响亮失败**：
 *   · `shared_bottleneck` 声明 `upstreamType`，实现要 `resourceType/sharedByType/viaField`
 *   · `selection_optimize` 声明 `items`，实现要 `itemType + budget`
 *   · `combinatorial_auction` 声明 `items`，实现要 `bids[]`
 * 危害不是「静默错答」（那一档由 `silent-wrong-answer-3.seam.test.ts` +
 * `scripts/check-solver-arg-key-drift.mjs` 咬），而是「**照说明书做做不通、白跑一趟**」——
 * 模型可能重试几次，也可能就此把这个能力放弃了。
 *
 * ── 为什么必须**逐求解器**，不能沿用既有门的全树口径 ──────────────────────────────
 * `scripts/check-solver-arg-key-drift.mjs` 的判据是「**全仓求解器源里有没有人读这个键名**」，
 * 它自己的注释里就写明了这条已知局限。实测差别（本文件跑出来的数）：
 *   · 全树口径：`concentration_risk.rootType` **不报** —— 因为 `supplier_disruption_radius`
 *     在读 `args.rootType`，**一个键被别的求解器读到会把这条盖住**；
 *   · 逐求解器口径：当场报出来。
 * 两道口径形态不同、都要在：静态全树门覆盖面广但粒度粗，本测试粒度准。
 *
 * ── 扫描器必须处理的两类陷阱（不处理就会把真的报成假的）──────────────────────────
 * ① **整包委派**：`finance_world_projection` 的方法体只有两行，把整包 `args` 交给
 *    `solvers/finance-world.ts:projectFinanceWorld` —— 朴素的「只扫入口方法体」会把 5 个
 *    **真读**的入参全报成空头支票。故扫描器沿「实参里出现 args 令牌」的调用**递归展开**。
 * ② **整包 zod 解析**：`ontology_query` 把整包 `args` 交 `OntologyQueryInputSchema.safeParse`，
 *    源码里一个 `args.rootFilter` 都没有。故这类走 `SCHEMA_PARSED` 注册表，用**运行时 schema 的
 *    真 shape**（不是再写一个解析器）来判。
 *
 * ── 铁律 0.6：扫描类结论一律先自证工具 ───────────────────────────────────────────
 * 报「某键没被读」这种**否定结论**之前，先跑金丝雀：
 *   · 正金丝雀：一批**确定被真读**的键必须命中（含委派与 zod 两条难路）；
 *   · 负金丝雀：一个绝不存在的键必须**不**命中（防正则宽到什么都匹）；
 *   · 覆盖面金丝雀：每个目录条目都必须解析出入口 —— 解析不出 ⇒ 报「**工具坏了**」，
 *     **不许**报「这条干净」。
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OntologyQueryInputSchema } from "@platform/contracts";
import { ALL_SOLVER_CATALOG } from "../src/catalog.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const SOLVER_DIR = join(SRC, "solvers");

// ── 扫描面：求解器实现 + 少数在别处实现的条目（slice 走 ontology.ts，个别入参在 app.ts 路由层读） ──
const FILES = new Map<string, string>();
for (const f of readdirSync(SOLVER_DIR).filter((f) => f.endsWith(".ts"))) {
  FILES.set(`solvers/${f}`, readFileSync(join(SOLVER_DIR, f), "utf8"));
}
for (const f of ["app.ts", "ontology.ts"]) FILES.set(f, readFileSync(join(SRC, f), "utf8"));

// ── 源码切块：声明索引（不做花括号配对——返回类型里的 `{}` 会把配对带歪） ──────────────
// 判据：行首缩进 + 修饰符 + 名字 + `(`，且**括号配对之后**跟的是 `{` 或 `:`（调用点跟的是 `;,).` 等）。
// 区块 = 从本声明起，到**下一个缩进 ≤ 本缩进**的声明为止（宁可多含嵌套 helper，也不漏读取点）。
interface Decl { name: string; file: string; start: number; end: number; indent: number }

function matchParen(src: string, open: number): number {
  let d = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const q = ch;
      i++;
      while (i < src.length && src[i] !== q) { if (src[i] === "\\") i++; i++; }
      continue;
    }
    if (ch === "(") d++;
    else if (ch === ")") { d--; if (d === 0) return i; }
  }
  return -1;
}

function nextMeaningful(src: string, from: number): string {
  for (let i = from; i < src.length; i++) {
    const ch = src[i]!;
    if (/\s/.test(ch)) continue;
    if (ch === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (ch === "/" && src[i + 1] === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i++; continue; }
    return ch;
  }
  return "";
}

const DECL_RE =
  /(?:^|\n)([ \t]*)(?:export\s+)?(?:default\s+)?(?:(?:private|public|protected|static|abstract|readonly)\s+)*(?:async\s+)?(?:function\s*\*?\s+)?([A-Za-z_$][\w$]*)\s*(?:<[^<>()]*>)?\s*\(/g;
const ARROW_RE =
  /(?:^|\n)([ \t]*)(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=\s*(?:async\s*)?\(/g;

const DECLS: Decl[] = [];
for (const [file, src] of FILES) {
  const found: Omit<Decl, "end">[] = [];
  for (const re of [DECL_RE, ARROW_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const name = m[2]!;
      if (["if", "for", "while", "switch", "catch", "return", "else", "do", "try", "typeof", "await", "new"].includes(name)) continue;
      const open = src.indexOf("(", m.index + m[0].length - 1);
      const close = matchParen(src, open);
      if (close < 0) continue;
      const after = nextMeaningful(src, close + 1);
      const ok = re === ARROW_RE ? after === "=" || after === ":" : after === "{" || after === ":";
      if (!ok) continue;
      found.push({ name, file, start: m.index, indent: m[1]!.length });
    }
  }
  found.sort((a, b) => a.start - b.start);
  for (let i = 0; i < found.length; i++) {
    const d = found[i]!;
    let end = src.length;
    for (let j = i + 1; j < found.length; j++) {
      if (found[j]!.indent <= d.indent) { end = found[j]!.start; break; }
    }
    DECLS.push({ ...d, end });
  }
}
const BY_NAME = new Map<string, Decl[]>();
for (const d of DECLS) {
  if (!BY_NAME.has(d.name)) BY_NAME.set(d.name, []);
  BY_NAME.get(d.name)!.push(d);
}
const bodyOf = (d: Decl): string => FILES.get(d.file)!.slice(d.start, d.end);

/** 形参里可能承载 args 的名字（排掉上下文/仓储类形参，其余全试 —— 宁宽勿漏）。 */
function argParams(body: string): string[] {
  const open = body.indexOf("(");
  const close = matchParen(body, open);
  if (open < 0 || close < 0) return [];
  const inner = body.slice(open + 1, close);
  const parts: string[] = [];
  let depth = 0, cur = "";
  for (const ch of inner) {
    if ("<([{".includes(ch)) depth++;
    if (">)]}".includes(ch)) depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts
    .map((p) => p.split(":")[0]!.replace(/[?\s]/g, ""))
    .filter((n) => /^[A-Za-z_$][\w$]*$/.test(n))
    .filter((n) => !/^_?(ctx|c|view|repos|tenantId|tid|orders|presetScope|self|deps)$/.test(n));
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 一个函数体里、经形参 `p` 读到的键。 */
function readsVia(body: string, p: string): Set<string> {
  const out = new Set<string>();
  const pe = esc(p);
  for (const m of body.matchAll(new RegExp(`\\b${pe}\\.([A-Za-z_$][\\w$]*)`, "g"))) out.add(m[1]!);
  for (const m of body.matchAll(new RegExp(`\\b${pe}\\[["']([^"']+)["']\\]`, "g"))) out.add(m[1]!);
  for (const m of body.matchAll(new RegExp(`\\{([^{}]*)\\}\\s*=\\s*${pe}\\b`, "g"))) {
    for (const part of m[1]!.split(",")) {
      const n = part.split(":")[0]!.split("=")[0]!.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n)) out.add(n);
    }
  }
  return out;
}

/** 从一段代码出发，union 直接读到的键 + 沿「实参里出现 args 令牌」的调用递归展开。 */
function keysFrom(body: string, params: string[], depth: number, seen: Set<string>): Set<string> {
  const out = new Set<string>();
  if (depth > 5) return out;
  for (const p of params) {
    for (const k of readsVia(body, p)) out.add(k);
    const pe = esc(p);
    for (const m of body.matchAll(/(?:this\.)?([A-Za-z_$][\w$]*)\s*\(/g)) {
      const callee = m[1]!;
      const open = body.indexOf("(", m.index! + m[0].length - 1);
      const close = matchParen(body, open);
      if (close < 0) continue;
      if (!new RegExp(`\\b${pe}\\b`).test(body.slice(open + 1, close))) continue;
      for (const k of keysOfFn(callee, depth + 1, seen)) out.add(k);
    }
  }
  return out;
}

function keysOfFn(name: string, depth: number, seen: Set<string>): Set<string> {
  const out = new Set<string>();
  if (depth > 5) return out;
  for (const d of BY_NAME.get(name) ?? []) {
    const sig = `${d.file}:${d.start}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    const body = bodyOf(d);
    for (const k of keysFrom(body, argParams(body), depth, seen)) out.add(k);
  }
  return out;
}

const SERVICE = FILES.get("solvers/service.ts")!;
const EXTENDED = FILES.get("solvers/extended.ts")!;
const ONTOLOGY = FILES.get("ontology.ts")!;

/** solverKey → 入口（函数名集合 ∪ 内联代码块）。解析不出任何入口 = 扫描器盲区，判「工具坏了」。 */
function entriesOf(key: string): { fns: Set<string>; blocks: string[] } {
  const fns = new Set<string>();
  const blocks: string[] = [];
  const k = esc(key);
  // A) service.ts 异步派发：if (solverKey === "KEY") return this.METHOD(
  for (const m of SERVICE.matchAll(new RegExp(`solverKey === "${k}"\\)\\s*return\\s+this\\.(\\w+)\\(`, "g"))) fns.add(m[1]!);
  // B) service.ts 同步 switch：case "KEY": …（块**自身**也要扫 —— affected_orders 的 args.baseId 就读在块里）
  const ci = SERVICE.indexOf(`case "${key}":`);
  if (ci >= 0) {
    const rest = SERVICE.slice(ci);
    const stop = rest.search(/\n {6}(case "|default:)/);
    const blk = stop > 0 ? rest.slice(0, stop) : rest.slice(0, 2000);
    blocks.push(blk);
    for (const m of blk.matchAll(/(?:return|=)\s+(?:this\.)?([A-Za-z_$][\w$]*)\s*\(/g)) fns.add(m[1]!);
  }
  // C) extended.ts 字符串键分发表：KEY: fnName,
  const em = EXTENDED.match(new RegExp(`\\n\\s*${k}:\\s*([A-Za-z_$][\\w$]*)\\s*,`));
  if (em) fns.add(em[1]!);
  // D) ontology.ts slice 分发：if (sliceKey === "KEY") { … }
  const si = ONTOLOGY.indexOf(`sliceKey === "${key}"`);
  if (si >= 0) blocks.push(ONTOLOGY.slice(si, si + 2500));
  return { fns, blocks };
}

/** 该求解器实现**真读**的键全集。 */
function realKeysOf(key: string): { keys: Set<string>; resolved: boolean } {
  const { fns, blocks } = entriesOf(key);
  const keys = new Set<string>();
  const seen = new Set<string>();
  for (const f of fns) for (const x of keysOfFn(f, 0, seen)) keys.add(x);
  for (const b of blocks) for (const x of keysFrom(b, ["args"], 0, seen)) keys.add(x);
  return { keys, resolved: fns.size > 0 || blocks.length > 0 };
}

/**
 * **整包 zod 解析**的条目：源码里没有 `args.<key>` 字面读取点，整包交给 schema。
 * 判据落在**运行时 schema 的真 shape** 上（不是再写一个解析器去猜）。
 */
const SCHEMA_PARSED: Record<string, Set<string>> = {
  // service.ts `ontologyQuery()`：`OntologyQueryInputSchema.safeParse(rawInput)`
  ontology_query: new Set(Object.keys(OntologyQueryInputSchema.shape)),
};

/**
 * **存量空头支票登记**（WO-ARGHINTS-12-LOUD 之外的残口·逐条已追一层到读取点）。
 *
 * ⚠ 这**不是**豁免名单，是「已查证 + 已定性 + 待另立单修」的台账：本单的范围边界是
 * 「照目录调用会 400 响亮失败」的那 12 条；下面这些**性质不同**（要么另有病历已被别的门咬着，
 * 要么修法要动实现 = 行为改动，按本单交付判据 ②「停手顶回来」）。新增任何一条未登记的
 * 空头支票 ⇒ 本测试红。
 */
const KNOWN_RESIDUAL: Record<string, Record<string, string>> = {
  plan_audit: {
    versionId: "REAL-DRIFT · service.ts `compute()` 的 case \"plan_audit\" 强制 10 个必填数值 "
      + "(dem/seg_pas/seg_ess/seg_com/sup/ltaCov/kitGap/gmTarget/cashCushion/capex)，versionId 无读者。"
      + "改对要把 argHints 换成那 10 个键 —— 与本单 12 条同形但不在本单范围（既有门 KNOWN_DRIFT 亦已登记）。",
  },
  plan_generate: {
    objective: "REAL-DRIFT · plan.ts `planGenerate` 实读 targets/base/hard，objective 无读者（既有门 KNOWN_DRIFT 亦已登记）。",
  },
  optimize_whatif: {
    perturbation: "REAL-DRIFT · service.ts `optimizeWhatif` 实读 `perturbations`（复数）；单数无读者（既有门 KNOWN_DRIFT 亦已登记）。",
  },
  capacity_rollup: {
    modelId: "REAL-DRIFT · capacity.ts `computeRollup(c)` **一个入参都不收**（只吃 SolverContext），modelId 无处可读。",
  },
  bottleneck_matrix: {
    baseId: "REAL-DRIFT · risk.ts `bottleneckMatrix(c, args)` 实读 `dataMode`/`baseIds`（复数），baseId 无读者。",
  },
  kit_readiness: {
    base: "别名已登记 · `SOLVER_ARG_ALIASES.kit_readiness = { base: [baseId, baseName] }`，"
      + "extended.ts `kitReadiness` 经 `normalizeChainScope(args)` 消费；本扫描器只认字面读取点，属**已知假阳性**。",
    toDay: "REAL-DRIFT · extended.ts `kitReadiness` 实读 fromDay/kitScope/orders，toDay 无读者。",
  },
  yield_diagnosis: {
    processKey: "REAL-DRIFT · extended.ts `yieldDiagnosis` 实读 series/events；processKey 由 "
      + "`injectYieldDiagnosisSeries` 在**注入阶段**用（service.ts），不是求解器读的键 —— 定性待另立单。",
  },
  outsourcing_split: {
    weeks: "REAL-DRIFT · extended.ts `outsourcingSplit` 实读 gap/totalDemand，weeks 无读者。",
  },
  quote_margin: {
    custName: "REAL-DRIFT · extended.ts `quoteMargin` 实读 bom/price/scope/quoteScope/…；custName 在 "
      + "`deriveExtendedArgs`(service.ts) 的派生阶段用，不是求解器读的键 —— 定性待另立单。",
    modelId: "REAL-DRIFT · 同 custName（派生阶段用，求解器不读）。",
  },
  credit_exposure: {
    custName: "REAL-DRIFT · extended.ts `creditExposure` 实读 creditLimit/receivables/wipUnbilled/overdue；"
      + "custName 同样在 `deriveExtendedArgs` 派生阶段用 —— 定性待另立单。",
  },
};

describe("WO-ARGHINTS-12-LOUD · 目录 argHints ⊆ 该求解器实现真读的键（逐求解器口径）", () => {
  it("金丝雀：扫描器自证（正/负/覆盖面）—— 不过就报「工具坏了」，不许报「目录干净」", () => {
    // 正金丝雀：确定被真读的键，含两条难路（委派 / zod 整包）。
    const POSITIVE: [string, string][] = [
      ["shared_bottleneck", "viaField"], // service.ts sharedBottleneck: str(args.viaField)
      ["selection_optimize", "budget"], // service.ts selectionOptimize: args.budget
      ["set_cover", "universe"], // service.ts setCover: args.universe
      ["finance_world_projection", "worldId"], // ★整包委派：finance-world.ts:171 str(args.worldId)
      ["finance_world_projection", "pressureUnit"], // ★同上，入口方法体里一个字都没有
      ["affected_orders", "baseId"], // ★读在 switch case 块自身（service.ts case "affected_orders"）
      ["model_capacity_network", "modelId"], // ★slice：ontology.ts resolveSlice
    ];
    const misses = POSITIVE.filter(([s, k]) => !realKeysOf(s).keys.has(k));
    expect(misses, `正金丝雀未命中（这些键源码里确实在读）⇒ 扫描器坏了，本次结论作废：${JSON.stringify(misses)}`).toEqual([]);

    // 负金丝雀：正则不能宽到什么都匹。
    expect(realKeysOf("shared_bottleneck").keys.has("__key_that_must_never_exist_zzz__")).toBe(false);

    // 覆盖面金丝雀：每个目录条目都必须解析出入口。
    const unresolved = ALL_SOLVER_CATALOG.filter((s) => !realKeysOf(s.key).resolved).map((s) => s.key);
    expect(unresolved, `这些目录条目解析不出实现入口 ⇒ 扫描器盲区，**不许**读作「它们干净」：${unresolved.join(", ")}`).toEqual([]);
    expect(ALL_SOLVER_CATALOG.length).toBeGreaterThan(50);
  });

  it("本单治的 12 条：声明键必须全部落在实现真读的键里（照目录调用不再 400）", () => {
    const TARGETS = [
      "shared_bottleneck", "concentration_risk", "margin_attribution",
      "selection_optimize", "assignment_optimize", "sequencing_optimize", "packing_optimize",
      "facility_location", "set_cover", "combinatorial_auction",
    ];
    const bad: string[] = [];
    for (const key of TARGETS) {
      const item = ALL_SOLVER_CATALOG.find((s) => s.key === key)!;
      const { keys } = realKeysOf(key);
      for (const hint of Object.keys(item.argHints ?? {})) {
        if (!keys.has(hint)) bad.push(`${key}.${hint}（实现真读：${[...keys].sort().join("/")}）`);
      }
    }
    expect(bad, `目录声明了实现不读的键 ⇒ 照目录调用 = 400 响亮失败：\n  ${bad.join("\n  ")}`).toEqual([]);
  });

  it("全目录：不许新长出未登记的空头支票", () => {
    const fresh: string[] = [];
    for (const item of ALL_SOLVER_CATALOG) {
      const schemaKeys = SCHEMA_PARSED[item.key];
      const { keys } = realKeysOf(item.key);
      for (const hint of Object.keys(item.argHints ?? {})) {
        if (keys.has(hint)) continue;
        if (schemaKeys?.has(hint)) continue;
        if (KNOWN_RESIDUAL[item.key]?.[hint]) continue;
        fresh.push(`${item.key}.${hint}（实现真读：${[...keys].sort().join("/") || "(无)"}）`);
      }
    }
    expect(fresh, `新增的空头支票（目录声明、该求解器不读）——要么改目录声明成真读的键，要么登记到 KNOWN_RESIDUAL 并附证据：\n  ${fresh.join("\n  ")}`).toEqual([]);
  });

  it("KNOWN_RESIDUAL 台账不许养僵尸：登记的每一条今天仍然是空头支票", () => {
    const stale: string[] = [];
    for (const [key, hints] of Object.entries(KNOWN_RESIDUAL)) {
      const { keys } = realKeysOf(key);
      const declared = new Set(Object.keys(ALL_SOLVER_CATALOG.find((s) => s.key === key)?.argHints ?? {}));
      for (const hint of Object.keys(hints)) {
        if (!declared.has(hint)) stale.push(`${key}.${hint}（目录已不再声明该键 ⇒ 删掉这条登记）`);
        else if (keys.has(hint)) stale.push(`${key}.${hint}（实现现在读它了 ⇒ 删掉这条登记）`);
      }
    }
    expect(stale, `登记表过期 —— 台账留着不清会把「已修好」读成「还欠着」：\n  ${stale.join("\n  ")}`).toEqual([]);
  });
});
