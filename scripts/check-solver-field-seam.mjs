#!/usr/bin/env node
/**
 * 门 `solver-field-seam:check` · 后端↔前端接缝门 **字段粒度**（WO-BEFE-SEAM-FIELD · 闭本体 §8 `G-BE-FE-FIELD-DEAD`）
 *
 * ── 治什么（这道门治的是审核方 2026-08-11 亲身犯的错） ────────────────────────
 * 已有 `befe-seam:check` 的头注自己写着：它是为「后端做完、前端零消费方」这个病建的。
 * **但它量的是端点粒度**（`routes.push({method, path, line})`）与 SSE 事件字段，
 * 于是漏掉了一整类：**长在已有端点上的新字段**。
 *
 * 实测（2026-08-11）：求解器 `chain_impediments` 的端点早就有、前端也在调（`views/sim/chainImpediment.ts`
 * 直接用契约 `ChainImpedimentSchema` 解析载荷），而 WO-SANDBOX-S3 给它新长出来的输出
 * `candidates`（阻滞点→方案候选）与 `candidateStats` / `candidatesTruncated` / `candidateProbes`
 * （"为什么这个阻滞点没有方案"的逐点账）**前端一个消费方都没有**。`befe-seam:check` 全绿——
 * 因为端点有人调、事件也没变，它压根不看端点**下发的是什么字段**。
 *
 * **形态**（照 CLAUDE.md 铁律 0.6 的句式）：
 *   **「我用『端点有人调』当作『这个端点的输出都有人看』的证据，而前者并不度量后者。」**
 *
 * ── 三类载体 ──────────────────────────────────────────────────────────────────
 *  **载体③ 求解器输出顶层字段**
 *    源 = `SOLVER_OUTPUT_SHAPES`（`apps/datacore/src/solvers/service.ts`，R11-SHAPE 的输出形状单一来源）。
 *    静态解析、不执行 TS；`shapeKeys(XSchema)` 那 5 条回到 `packages/contracts/src` 的 zod schema 单源取键。
 *    判据（强证据）：字段名在**前端生产代码全域**零提及 ⇒ 死字段。
 *
 *  **载体④ 求解器侧契约 schema 字段（嵌套那一层的真载体）**
 *    源 = `packages/contracts/src` 里被 `apps/datacore/src/solvers/**` 引用的 zod 对象 schema。
 *    `candidates` 就长在这里：它不是 `chain_impediments` 的顶层键，而是 `impediments[]` 元素
 *    （`ChainImpedimentSchema`）的一个键 —— **只查顶层键的门抓不到它**。
 *    判据（精确作用域）：前端 import 了该 schema（或其 `z.infer` 别名）的文件 ∪ 其直接 importer
 *    构成**作用域**，字段名在作用域内零提及 ⇒ 死字段。
 *    为什么必须作用域化：`candidates` 是通名 —— 前端 `DisruptionRadiusView` / `GlobalSimLevers` 里
 *    都有同名局部变量。**全域名字匹配会把它放过去**（实测：全域命中 9 个文件），
 *    只有"在解析这个 schema 的那几个文件里找"才判得出它零消费。
 *
 *  **载体⑤ 求解器结果接口的内联行字段（嵌套一层）**
 *    源 = `apps/datacore/src/solvers/**` 导出的 TS 结果接口，按**结构 join**（唯一最优超集 + 三道护栏）
 *    对上 `SOLVER_OUTPUT_SHAPES` 的求解器。治的是「顶层键有名字、但**行结构**没有契约可锚」那一片：
 *    `candidateStats` 顶层键载体③ 抓得到，而它每行的 `emitted`（下发了几个候选）没人看 —— 那正是
 *    "为什么这个阻滞点没有方案"的答案所在。详见 §2b。
 *
 * ── 未判定：不许把"我没排除掉"写成"它是死的"（铁律 0.5） ──────────────────────
 * 前端可能经**解构 / 重命名 / 类型透传 / `...rest`** 消费。前三种仍会让字段名在源码里出现，
 * 故名字判据排得掉；**绑定位对象 rest**（`const { a, ...rest } = row`）排不掉 —— 它把没点名的字段
 * 整包带走。故：作用域里出现绑定位对象 rest ⇒ 该 schema 全字段进**未判定**，**不当死字段报**。
 * 载体③ 另有一档未判定：名字全域有提及、但**不在该求解器的前端作用域内** ——
 * 分不清是同名撞车还是跨模块消费，如实列出、**不 gate**。
 *
 * ── 诚实边界（先读，免得把这道门当成它不是的东西） ────────────────────────────
 *  · 载体③ 的强判据是「全域零提及」：通名（`rows`/`summary`/`total`）撞车会**漏报**。抓得住的是
 *    `candidateStats` / `candidatesTruncated` / `scopeBaseId` 这类专名零消费——正是今天真实的缺口。
 *  · 载体④ 只覆盖**契约 schema**；载体⑤ 只覆盖**结构 join 得上结果接口**的求解器（当前 5/59）。
 *    其余求解器的结果类型是内联对象字面量，没有具名类型可锚 —— 本门**不猜**，把未 join 上的数目
 *    与原因分布**打印出来**。那是盲区，不是干净。
 *  · 入参族 schema（`*Args` / `*Input*`）**结构性豁免**：前端没传入参是另一种病（arg-drop），
 *    归 `arg-drop-seam:check` 管辖，本门只管**输出**字段。
 *  · JSX 的 `{...row}` 展开（非绑定位）本门不追——那要类型流分析。这是边界，写在这里而不是藏起来；
 *    真撞上时把该条加进基线并写明「经 JSX 展开消费」，是一个可评审的显式动作。
 *
 * ── 金丝雀（本门的核心，比断言本身更重要） ──────────────────────────────────
 * 铁律 0.6：任何扫描/解析/计数在报出结论前，必须先跑一个「已知必中」样例。
 * 本门的金丝雀**与主逻辑共用同一批函数**（`parseSolverOutputShapes` / `buildSchemaRegistry` /
 * `buildSolverInterfaces` / `rootSolverInterface` / `verdictTopLevel` / `verdictScoped` /
 * `mentionsInProd`），不另抄一份判定 ——
 * 抄了就是装饰品：改主判定时金丝雀拿旧的去测、照样绿（本仓 2026-08-08 实测踩过）。
 * 金丝雀是**双向**的：`candidates` / `candidateStats` / `candidateStats.emitted`（已知真死）**必须被咬中**；
 * 前端真在消费的字段（`impediments` / `ChainImpedimentSchema.severity` / `counts.total`）**必须放过**。
 * 单向金丝雀测不出恒真/恒假判定器：一个恒不咬的把全仓报成"干净"，一个恒咬的把全仓报成缺口。
 * 金丝雀不中 ⇒ 打印「⛔ 门自己坏了」并 `exit 2`，**绝不允许**报「字段都干净 / 零死字段」。
 *
 * 用法：node scripts/check-solver-field-seam.mjs [--update] [--seed] [--verbose]
 *   （无参 = 判定；--seed = 首次建账；--update = 收紧基线，只减不增；--verbose = 列明细含未判定档）
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7（门 `solver-field-seam:check`）· §8（断点 `G-BE-FE-FIELD-DEAD`）。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import {
  lex, splitTopLevel, splitTopLevelMembers, stripComments, lineOf, walk,
  frontendProdFiles, readProdTexts, mentionsInProd, M_CODE, M_COMMENT,
} from "./lib/seam-lex.mjs";
import { buildBaselineDoc, baselineDocCanary } from "./lib/baseline-doc.mjs";

/* ── 退出码纪律 · 顶层兜底（WO-R1 收编时补 · `gate-exit-discipline:check` 当场报红逼出来的）──
 * 本门原有的 RC 是三分的（0 干净 / 1 真有死字段 / 2 金丝雀不中 ⇒ 门自己坏了），
 * **但缺顶层兜底**：任何未预期异常（缺依赖 / 只读 FS / 权限 / OOM / node 版本差异 / 基线 JSON 坏了）
 * 都会走 node 默认的退 **1** —— 恰好撞上「真有死字段」那个码，于是「我没扫成」被读成「你有违规」。
 * 照铁律 0.6 的句式：**「我用『进程退 1』当作『字段有缺口』的证据，而前者并不度量后者。」**
 * 本门是**扫描器**（顶层执行、无 main() 可包），故用 `check-gate-exit-discipline.mjs` 认的形态 (b)：
 * 顶层无条件注册 `uncaughtException` / `unhandledRejection`，统一走 `toolBroken()` ⇒ RC=2。
 * 真正的 RC=1 只剩一条路径：第 9 节 `fails.length` 那一处显式判负。
 * ⚠ 这段不是装饰：`node scripts/check-gate-exit-discipline.mjs` 会现算「有无通向 exit(2) 的顶层兜底」，
 *   删掉它那道门当场红（2026-08-13 实测：收编时它就是这么把这个缺口抓出来的）。
 * ───────────────────────────────────────────────────────────────────────────── */
function toolBroken(what, hint) {
  console.error(`⛔ ${what} ⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「字段都干净 / 零死字段 / 无新增缺口」——");
  console.error("   本门这次根本没有扫描成功，它什么都没证明。");
  if (hint) console.error(`   ${hint}`);
  process.exit(2); // 2 = 工具自己坏了（1 = 真有新增死字段），两者处置完全不同，不许合并
}
process.on("uncaughtException", (e) =>
  toolBroken(`未预期异常（${e?.message || e}）`, (e?.stack || "").split("\n").slice(1, 4).join("\n   ")),
);
process.on("unhandledRejection", (e) =>
  toolBroken(`未处理的 Promise 拒绝（${e?.message || e}）`, (e?.stack || "").split("\n").slice(1, 4).join("\n   ")),
);

const ROOT = process.cwd();
const BASELINE = join(ROOT, "scripts/solver-field-seam-baseline.json");
const SOLVER_SERVICE = join(ROOT, "apps/datacore/src/solvers/service.ts");
const SOLVER_DIR = join(ROOT, "apps/datacore/src/solvers");
const CONTRACTS_SRC = join(ROOT, "packages/contracts/src");
const CATALOG = join(ROOT, "apps/datacore/src/catalog.ts");

const argv = new Set(process.argv.slice(2));
const UPDATE = argv.has("--update");
const SEED = argv.has("--seed");
const VERBOSE = argv.has("--verbose");

const rel = (p) => relative(ROOT, p);
const srcFiles = (dir) => walk(dir).filter((p) => !/\.(test|spec)\.tsx?$/.test(p) && !p.includes("/__tests__/"));

/* ════════════════════════════════════════════════════════════════════════════
 * 1 · 载体③ 源：`SOLVER_OUTPUT_SHAPES` 静态解析
 *
 * 两种写法都要认（漏掉任一种 ⇒ 该批求解器的字段全部读作不存在 ⇒ 报"干净"）：
 *   ① 字面量数组   `capacity_rollup: ["bases", "ruleRefs"],`
 *   ② 契约单源     `capacity_forecast: shapeKeys(CapacityForecastOutputSchema),`
 * ═══════════════════════════════════════════════════════════════════════════ */

export function parseSolverOutputShapes(src) {
  const anchor = /export const SOLVER_OUTPUT_SHAPES\s*:[^=]*=\s*\{/.exec(src);
  if (!anchor) return { shapes: new Map(), anchorLine: -1 };
  const openIdx = src.indexOf("{", anchor.index + anchor[0].length - 1);
  const { parts } = splitTopLevel(src, openIdx);
  const shapes = new Map();
  for (const raw of parts) {
    const p = stripComments(raw).trim();   // 键名上方满是注释；不抹掉则「有注释的求解器」一律读作不存在
    if (!p) continue;
    const km = /^([A-Za-z_$][\w$]*)\s*:\s*([\s\S]*)$/.exec(p);
    if (!km) continue;
    const v = km[2].trim();
    if (v.startsWith("[")) {
      shapes.set(km[1], { keys: [...v.matchAll(/["']([^"']+)["']/g)].map((x) => x[1]), from: "literal", schema: null });
      continue;
    }
    const sm = /^shapeKeys\(\s*([A-Za-z_$][\w$]*)\s*\)$/.exec(v);
    if (sm) shapes.set(km[1], { keys: null, from: "schema", schema: sm[1] });
  }
  return { shapes, anchorLine: lineOf(src, anchor.index) };
}

/* ════════════════════════════════════════════════════════════════════════════
 * 2 · 契约 zod 对象 schema 注册表（载体③ 的 shapeKeys 解析源 + 载体④ 的字段源）
 *
 * ⚠ 成员切分（`objectMemberProps`）必须同时认 `,` 与 `;`：zod 对象用逗号、TS interface 用分号。
 *   本节（契约 zod）只需要逗号；**分号那一半的负载点在 §2b 载体⑤**（求解器层 TS 接口）。
 *   开发期变异反证实测：换回只按逗号切 ⇒ `ChainScanResult` 只抽出 1 个成员（真值 11）⇒
 *   载体⑤ 根解析失败 ⇒ 金丝雀 C12 当场开火报「门自己坏了」。
 *   ——写下这一段是因为**更早的一版没有载体⑤**：那时同样的变异让全门指标逐字节不变，
 *   分号能力等于「接了线没数据」的死分支（CLAUDE.md 铁律 0.5 三态之一），是变异反证把它抖出来的。
 * ═══════════════════════════════════════════════════════════════════════════ */

const ZOD_OBJ_RE = /export const ([A-Za-z_$][\w$]*)\s*=\s*z\s*\r?\n?\s*\.?\s*(?:strictObject|object)\s*\(\s*\{/g;
const INFER_RE = /export type ([A-Za-z_$][\w$]*)\s*=\s*z\.infer<typeof ([A-Za-z_$][\w$]*)>/g;
/**
 * 「这份 schema 自己声明它**不穷尽**」：`z.object({…}).catchall(z.unknown())` / `.passthrough()`。
 * ⚠ `)?` 不能省 —— 本仓写法是 `})\n  .catchall(...)`，闭合括号夹在中间；第一版漏了它，
 *   两个真·开放 schema 一个都没认出来（又一次"抽出 0 条却报干净"，靠拿已知样例复跑才发现）。
 */
const OPEN_TAIL_RE = /^\s*\)?\s*\.\s*(catchall|passthrough)\s*\(/;

/** 从 `{` 起抽顶层成员（`name: type` / `"name": type` / 可选 `?`）。 */
export function objectMemberProps(text, braceIdx) {
  const { parts } = splitTopLevelMembers(text, braceIdx);
  const out = [];
  for (const raw of parts) {
    const p = stripComments(raw).trim();
    if (!p) continue;
    const mm = /^([A-Za-z_$][\w$]*)\s*\??\s*:\s*([\s\S]*)$/.exec(p) || /^["']([^"']+)["']\s*\??\s*:\s*([\s\S]*)$/.exec(p);
    if (!mm) continue;
    out.push({ name: mm[1], typeText: mm[2].trim() });
  }
  return out;
}

export function buildSchemaRegistry(files) {
  const schemas = new Map();   // SchemaName -> { props, file, line, open }
  const aliasOf = new Map();   // TypeName   -> SchemaName（`z.infer<typeof X>`）
  for (const f of files) {
    const s = readFileSync(f, "utf8");
    const { mask } = lex(s);
    ZOD_OBJ_RE.lastIndex = 0;
    for (const mt of s.matchAll(ZOD_OBJ_RE)) {
      if (mask[mt.index] !== M_CODE) continue;
      if (schemas.has(mt[1])) continue;
      const brace = mt.index + mt[0].length - 1;
      const { end } = splitTopLevel(s, brace);
      // `.catchall(...)` / `.passthrough()` = 该 schema **自己声明它不穷尽**：实现可以再多下发键而 schema 不管。
      // 这类 schema 当"输出字段全集"用是不成立的 —— 必须自曝，否则本门会把"我只看得见声明的那些"说成"全都看过了"。
      const tail = s.slice(end, end + 160);
      schemas.set(mt[1], { props: objectMemberProps(s, brace), file: rel(f), line: lineOf(s, mt.index), open: OPEN_TAIL_RE.test(tail) });
    }
    for (const mt of s.matchAll(INFER_RE)) aliasOf.set(mt[1], mt[2]);
  }
  return { schemas, aliasOf };
}

/* ════════════════════════════════════════════════════════════════════════════
 * 2b · 载体⑤ 源：求解器层 TS 结果接口 → 嵌套一层内联对象字段
 *
 * 为什么还要这一层：`candidateStats` 是**顶层**键（载体③ 抓得到），但它的行结构
 * （`{ impedimentId, anchors, probes, effective, emitted, gaps }`）没有契约 schema 可锚 ——
 * 载体④ 看不见它。而"为什么这个阻滞点没有方案"的答案就住在那些行里。
 *
 * 求解器→结果接口的对应关系用**结构 join**（不是猜）：接口的键集 ⊇ 该求解器
 * `SOLVER_OUTPUT_SHAPES` 声明的键集，且**唯一最优**、多余键 ≤4、形状本身 ≥5 键。
 * 三道护栏缺一不可 —— 小形状（1–4 键）会撞上一堆无关接口，非唯一匹配就是在猜。
 * 解析结果、歧义数、未解析数**一律报出来**：这是盲区，不是干净。
 *
 * ⚠ 这一层是 `;` 成员切分**唯一的负载点**（TS interface 用分号）。开发期变异反证实测：
 *   把 `splitTopLevelMembers` 换回只按逗号切，若没有本层，全门指标**逐字节不变**——
 *   那就是「接了线没数据」（CLAUDE.md 铁律 0.5 三态之一），分号能力等于死代码。
 *   现在换回逗号 ⇒ `ChainScanResult` 抽出 0 个成员 ⇒ 根解析失败 ⇒ 金丝雀 C12 当场开火。
 * ═══════════════════════════════════════════════════════════════════════════ */

const SOLVER_IFACE_RE = /export (?:interface|type) ([A-Za-z_$][\w$]*)(?:[^{;=]*)(?:=\s*)?\{/g;

export function buildSolverInterfaces(files) {
  const out = new Map();
  for (const f of files) {
    const s = readFileSync(f, "utf8");
    const { mask } = lex(s);
    SOLVER_IFACE_RE.lastIndex = 0;
    for (const mt of s.matchAll(SOLVER_IFACE_RE)) {
      if (mask[mt.index] !== M_CODE) continue;
      if (out.has(mt[1])) continue;
      const brace = mt.index + mt[0].length - 1;
      out.set(mt[1], { props: objectMemberProps(s, brace), file: rel(f), line: lineOf(s, mt.index) });
    }
  }
  return out;
}

/** 结构 join：唯一最优超集接口才算根；否则如实报「歧义」/「未解析」，绝不将就挑一个。 */
export function rootSolverInterface(declaredKeys, ifaces, { minKeys = 5, maxExtra = 4 } = {}) {
  if (declaredKeys.length < minKeys) return { root: null, reason: `形状仅 ${declaredKeys.length} 键（<${minKeys}）——太小，结构 join 会撞上无关接口` };
  const cands = [];
  for (const [name, t] of ifaces) {
    const have = new Set(t.props.map((p) => p.name));
    if (declaredKeys.every((k) => have.has(k))) cands.push({ name, extra: have.size - declaredKeys.length });
  }
  if (cands.length === 0) return { root: null, reason: "无接口的键集覆盖该形状（结果类型多半是内联对象字面量，无具名类型可锚）" };
  cands.sort((a, b) => a.extra - b.extra);
  const best = cands.filter((c) => c.extra === cands[0].extra);
  if (best.length > 1) return { root: null, ambiguous: best.map((b) => b.name), reason: `${best.length} 个接口并列最优（${best.map((b) => b.name).join(" | ")}）——并列即是在猜，不取` };
  if (cands[0].extra > maxExtra) return { root: null, reason: `最优接口多出 ${cands[0].extra} 键（>${maxExtra}）——差太多，多半不是同一个东西` };
  return { root: cands[0].name, extra: cands[0].extra };
}

/* ════════════════════════════════════════════════════════════════════════════
 * 3 · 前端 import 图（载体④ 作用域的骨架）
 *
 * ⚠ 必须认 ESM 的 `./x.js` 说明符：本仓 TS 源码里 import 写的是 `.js` 后缀而磁盘上是 `.ts`。
 *   不认就会**整张图丢边**（铁律 0.6 那五连犯的第 2 例：import 图解析器不认 `./x.js`，
 *   barrel 边全丢 ⇒ 得出「contracts 整包是死代码」）。金丝雀 C9 钉死这一条。
 * ═══════════════════════════════════════════════════════════════════════════ */

const IMPORT_FROM_RE = /(?:^|\n)\s*(?:import|export)\s[\s\S]*?from\s*["']([^"']+)["']/g;

export function buildImportGraph(texts) {
  const byRel = new Map(texts.map((t) => [t.rel, t]));
  const importsOf = new Map();
  const importersOf = new Map();
  const resolveLocal = (fromRel, spec) => {
    if (!spec.startsWith(".")) return null;
    const base = resolve(dirname(join(ROOT, fromRel)), spec).replace(/\.js$/, "");
    for (const suffix of [".ts", ".tsx", "/index.ts", "/index.tsx", ""]) {
      const cand = relative(ROOT, base + suffix);
      if (byRel.has(cand)) return cand;
    }
    return null;
  };
  for (const t of texts) {
    const set = new Set();
    for (const mt of t.src.matchAll(IMPORT_FROM_RE)) {
      const r = resolveLocal(t.rel, mt[1]);
      if (!r || r === t.rel) continue;
      set.add(r);
      if (!importersOf.has(r)) importersOf.set(r, new Set());
      importersOf.get(r).add(t.rel);
    }
    importsOf.set(t.rel, set);
  }
  return { byRel, importsOf, importersOf };
}

/** 前端从 `@platform/contracts` 具名 import 的符号 → 落到 schema 名（经 `z.infer` 别名折回）。 */
const CONTRACT_IMPORT_RE = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']@platform\/contracts["']/g;
export function frontendSchemaImporters(texts, schemas, aliasOf) {
  const out = new Map(); // SchemaName -> Set<rel>
  for (const t of texts) {
    for (const mt of t.src.matchAll(CONTRACT_IMPORT_RE)) {
      for (const raw of mt[1].split(",")) {
        const nm = raw.replace(/\btype\b/g, " ").trim().split(/\s+as\s+/)[0].trim();
        if (!nm) continue;
        const schema = schemas.has(nm) ? nm : aliasOf.get(nm);
        if (!schema || !schemas.has(schema)) continue;
        if (!out.has(schema)) out.set(schema, new Set());
        out.get(schema).add(t.rel);
      }
    }
  }
  return out;
}

/** 作用域 = 种子文件 ∪ 直接 importer（消费常常发生在上一层组件里）。 */
export function expandScope(seeds, importersOf) {
  const scope = new Set(seeds);
  for (const f of seeds) for (const up of importersOf.get(f) ?? []) scope.add(up);
  return scope;
}

/**
 * **绑定位对象 rest** 探测：`const { a, ...rest } = x` / `({ a, ...rest }) =>`。
 * 只认绑定位（右侧紧跟 `=` 或 `) =>`），不认对象字面量里的 `{ ...prev }` 展开
 * —— 后者是"造一个新对象"，不是"把没点名的字段带走给渲染"。
 * 这是本门唯一承认排不掉的透传形态，命中即把该载体全字段降级为**未判定**。
 */
const BINDING_REST_RE = /\{[^{}]*\.\.\.\s*[A-Za-z_$][\w$]*\s*,?\s*\}\s*(?::\s*[^=;]+)?(?:=(?!=)|\)\s*=>)/g;
export function hasBindingRest(text) {
  for (const m of text.src.matchAll(BINDING_REST_RE)) if (text.mask[m.index] !== M_COMMENT) return true;
  return false;
}

/* ════════════════════════════════════════════════════════════════════════════
 * 4 · 判定（主逻辑与金丝雀共用**同一个**函数——不许各判各的）
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 载体③ 判定：全域零提及=DEAD · 作用域内有提及=CONSUMED · 只在作用域外有提及=UNDECIDED。 */
export function verdictTopLevel(field, allTexts, scopeTexts) {
  const global = mentionsInProd(field, allTexts);
  if (global.length === 0) return { verdict: "DEAD", why: "全前端生产代码零提及", hits: [] };
  const inScope = mentionsInProd(field, scopeTexts);
  if (inScope.length > 0) return { verdict: "CONSUMED", why: `作用域内 ${inScope.length} 个文件提到`, hits: inScope };
  return { verdict: "UNDECIDED", why: `名字只在该求解器作用域外出现（${global.length} 个文件）——同名撞车与跨模块消费本门分不清`, hits: global };
}

/** 载体④ 判定：作用域内零提及=DEAD（作用域有对象 rest ⇒ 降级 UNDECIDED）；无作用域时退回全域弱判据。 */
export function verdictScoped(field, scopeTexts, allTexts, scopeHasRest) {
  if (scopeTexts.length === 0) {
    const global = mentionsInProd(field, allTexts);
    return global.length === 0
      ? { verdict: "DEAD", why: "前端未 import 该契约 schema，且字段名全域零提及", hits: [] }
      : { verdict: "UNDECIDED", why: `前端未 import 该契约 schema，无精确作用域可查；名字全域有 ${global.length} 处同名`, hits: global };
  }
  const inScope = mentionsInProd(field, scopeTexts);
  if (inScope.length > 0) return { verdict: "CONSUMED", why: `作用域内 ${inScope.length} 个文件提到`, hits: inScope };
  if (scopeHasRest) return { verdict: "UNDECIDED", why: "作用域里有绑定位对象 rest（`...rest`），可能整包透传——排不掉，不当死字段报", hits: [] };
  return { verdict: "DEAD", why: "解析该 schema 的前端文件（含其直接 importer）里零提及", hits: [] };
}

/** 入参族结构性豁免（每条带理由 · 不许无理由豁免）。 */
const SCHEMA_EXEMPTIONS = [
  { re: /Args$/, why: "入参契约·前端不传入参是另一种病（arg-drop），归 arg-drop-seam:check 管辖；本门只管**输出**字段" },
  { re: /Input(Schema)?$/, why: "入参契约·同上，输入侧不在本门判据内" },
];
const schemaExemptReason = (n) => SCHEMA_EXEMPTIONS.find((e) => e.re.test(n))?.why;

/* ════════════════════════════════════════════════════════════════════════════
 * 5 · 采集
 * ═══════════════════════════════════════════════════════════════════════════ */

const serviceSrc = existsSync(SOLVER_SERVICE) ? readFileSync(SOLVER_SERVICE, "utf8") : "";
const { shapes, anchorLine } = parseSolverOutputShapes(serviceSrc);

const contractFiles = srcFiles(CONTRACTS_SRC);
const { schemas, aliasOf } = buildSchemaRegistry(contractFiles);

// shapeKeys(XSchema) 回到契约单源取键
let shapeKeysResolved = 0, shapeKeysUnresolved = [];
for (const [k, v] of shapes) {
  if (v.keys !== null) continue;
  const t = schemas.get(v.schema);
  if (!t) { v.keys = []; shapeKeysUnresolved.push(`${k}→${v.schema}`); continue; }
  v.keys = t.props.map((p) => p.name);
  shapeKeysResolved++;
}

// 形状源自己声明「不穷尽」的求解器 —— 盲区，必须自曝（见报告段）
const openShapeSolvers = [...shapes]
  .filter(([, v]) => v.from === "schema" && schemas.get(v.schema)?.open)
  .map(([solver, v]) => ({ solver, schema: v.schema }));

// 求解器层引用到的契约 schema（载体④ 的源）
const solverFiles = srcFiles(SOLVER_DIR);
const usedBySolvers = new Map(); // SchemaName -> "file:line"（首个引用点）
for (const f of solverFiles) {
  const s = readFileSync(f, "utf8");
  const { mask } = lex(s);
  for (const name of schemas.keys()) {
    if (usedBySolvers.has(name)) continue;
    const re = new RegExp(String.raw`(?<![\w$])${name}(?![\w$])`, "g");
    for (const m of s.matchAll(re)) {
      if (mask[m.index] === M_COMMENT) continue;
      usedBySolvers.set(name, `${rel(f)}:${lineOf(s, m.index)}`);
      break;
    }
  }
}

// 载体⑤：求解器层结果接口 → 根解析 → 嵌套一层内联对象字段
const solverIfaces = buildSolverInterfaces(solverFiles);
const ifaceRoots = new Map();      // solverKey -> { root, extra }
const ifaceRootFail = [];          // { solver, reason }
for (const [solver, v] of shapes) {
  const r = rootSolverInterface(v.keys, solverIfaces);
  if (r.root) ifaceRoots.set(solver, r);
  else ifaceRootFail.push({ solver, reason: r.reason });
}

const prodFiles = frontendProdFiles(ROOT);
const prodTexts = readProdTexts(prodFiles, ROOT);
const { byRel, importersOf } = buildImportGraph(prodTexts);
const feSchemaImporters = frontendSchemaImporters(prodTexts, schemas, aliasOf);

/** 某求解器的前端作用域：提到该 solverKey 的文件 ∪ 其直接 importer。 */
const solverScopeCache = new Map();
function solverScopeTexts(solverKey) {
  if (solverScopeCache.has(solverKey)) return solverScopeCache.get(solverKey);
  const seeds = new Set(mentionsInProd(solverKey, prodTexts));
  const scope = expandScope(seeds, importersOf);
  const texts = [...scope].map((r) => byRel.get(r)).filter(Boolean);
  solverScopeCache.set(solverKey, texts);
  return texts;
}

/* ════════════════════════════════════════════════════════════════════════════
 * 6 · 金丝雀（与主逻辑共用同一批函数 · 不中即「门自己坏了」exit 2）
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ── 三载体枚举的**唯一**实现（主判定与金丝雀共用）────────────────────────────
 * 抽出来的理由不是整洁，是本仓的硬纪律：**金丝雀必须与主逻辑共用同一份实现，不许各抄一份**
 * ——抄了就是装饰品，改主逻辑时金丝雀拿旧的去测、照样绿（2026-08-08 实测踩过）。
 * 下面三个函数被 §7 主判定与 §6 金丝雀两处调用，改一处两处一起变。
 */
function censusS3() {
  const rows = [];
  for (const [solver, v] of [...shapes].sort()) {
    const scope = solverScopeTexts(solver);
    const declaredAt = v.from === "schema" ? `${rel(SOLVER_SERVICE)}:${anchorLine}→${v.schema}` : `${rel(SOLVER_SERVICE)}:${anchorLine}`;
    for (const f of v.keys) {
      const r = verdictTopLevel(f, prodTexts, scope);
      rows.push({ id: `S3:${solver}.${f}`, carrier: "S3", owner: solver, field: f, cls: r.verdict, why: r.why, evidence: declaredAt });
    }
  }
  return rows;
}
function censusS5() {
  const rows = [];
  for (const [solver, r] of [...ifaceRoots].sort()) {
    const t = solverIfaces.get(r.root);
    const scope = solverScopeTexts(solver);
    for (const p of t.props) {
      const bi = p.typeText.indexOf("{");
      if (bi < 0) continue;                       // 非内联对象（`string` / 具名类型）——具名的归载体④，本层不重复算
      for (const q of objectMemberProps(p.typeText, bi)) {
        const v = verdictTopLevel(q.name, prodTexts, scope);
        rows.push({ id: `S5:${solver}.${p.name}.${q.name}`, carrier: "S5", owner: `${solver}.${p.name}`, field: q.name, cls: v.verdict, why: v.why, evidence: `${t.file}:${t.line}（接口 ${r.root}）` });
      }
    }
  }
  return rows;
}
function censusS4() {
  const rows = [];
  let exempt = 0, covered = 0, noScope = 0;
  for (const [name, usedAt] of [...usedBySolvers].sort()) {
    if (schemaExemptReason(name)) { exempt++; continue; }
    covered++;
    const seeds = feSchemaImporters.get(name) ?? new Set();
    const scopeTexts = [...expandScope(seeds, importersOf)].map((r) => byRel.get(r)).filter(Boolean);
    if (scopeTexts.length === 0) noScope++;
    const scopeHasRest = scopeTexts.some(hasBindingRest);
    const decl = schemas.get(name);
    for (const p of decl.props) {
      const r = verdictScoped(p.name, scopeTexts, prodTexts, scopeHasRest);
      rows.push({ id: `S4:${name}.${p.name}`, carrier: "S4", owner: name, field: p.name, cls: r.verdict, why: r.why, evidence: `${decl.file}:${decl.line}（求解器侧引用 ${usedAt}）` });
    }
  }
  return { rows, exempt, covered, noScope };
}

function canaries() {
  const list = [];
  const add = (name, why, fn) => list.push({ name, why, fn });

  // C1 形状表解析（真文件）：抽 0 条就会把全仓报成"没有可查的字段"
  add("shapes/SOLVER_OUTPUT_SHAPES 解析", "抽不到形状表 ⇒ 字段全集恒空 ⇒ 门永远报「零死字段」", () => {
    const n = shapes.size;
    const fields = [...shapes.values()].reduce((a, b) => a + b.keys.length, 0);
    return { ok: n >= 40 && fields >= 300, got: `求解器 ${n} · 顶层字段 ${fields}（锚点行 ${anchorLine}）`, want: "≥40 求解器 且 ≥300 字段" };
  });

  // C2 契约单源解析（真文件）：shapeKeys(XSchema) 那 5 条必须真的回到契约取到键
  add("shapes/shapeKeys 回契约取键", "解析不到 ⇒ 那 5 个求解器字段读作 0 条，而它们恰是契约声明最全的几个", () => {
    const keys = shapes.get("capacity_forecast")?.keys ?? [];
    return { ok: keys.includes("perBaseRows") && keys.length >= 15, got: `capacity_forecast ${keys.length} 键 · 含 perBaseRows=${keys.includes("perBaseRows")}`, want: "≥15 键 且 含 perBaseRows" };
  });

  // C3 契约 schema 成员切分（真文件）：只按逗号切 ⇒ 分号分隔的成员一条都抽不到
  add("schema/ChainImpedimentSchema 含 candidates", "抽不到嵌套键 ⇒ 本门要治的头号实例整个漏掉，门照样绿", () => {
    const props = (schemas.get("ChainImpedimentSchema")?.props ?? []).map((p) => p.name);
    return { ok: props.includes("candidates") && props.includes("severity"), got: props.join(","), want: "含 candidates 与 severity" };
  });

  /* ⛔ C4/C5/C13 原先各点名一个**活代码里的具体字段**当"今天已知的真死字段"
   *   （`candidateStats` / `ChainImpedimentSchema.candidates` / `candidateStats.emitted`）。
   *   2026-08-14 三条**同时**报「期望 DEAD、实际 CONSUMED」，门整体 RC=2、连续多日不产出任何结论。
   *   追一层（不许照 grep 收工）：不是判定器坏了，是 **WO-SANDBOX-CANDIDATES-FE 把它们全接上了** ——
   *     · `chainImpediment.ts:655` `for (const s of payload.candidateStats ?? []) statById.set(...)` 真运行时消费
   *     · `SandboxConsole.tsx:1644` `t.statLine(..., im.stat.emitted)` 真上屏
   *     · `chainImpediment.ts:526/529/682/743` `im.candidates` 真进逻辑
   *   ⇒ 金丝雀过期，门是好的。**这是好消息被门报成了坏消息。**
   *
   *   根因不是"选错了字段"，改指另一个字段只是把过期时间往后推。形态（铁律 0.6 句式）：
   *   **「我用『今天这个字段是死的』当作『判定器能判死』的永久证据，而前者会过期、后者不会。」**
   *   金丝雀的标的有自己的生命周期，而金丝雀控制不了它 —— 死字段被接线是**本门存在的目的**，
   *   一道门不该在自己成功时崩掉。
   *
   *   改法：把"必中"从**点名字段**改成**群体判据** —— 判定器跑遍真实仓库，
   *   必须**既**判得出 DEAD **又**判得出 CONSUMED。两个方向都咬：
   *     · 恒不咬（全 CONSUMED）⇒ 报出的"干净"是假的 ⇒ 红；
   *     · 恒咬（全 DEAD）⇒ 全仓报成缺口、门变噪音 ⇒ 红。
   *   它永不过期，且仍跑在**真源码**上（不是合成样例）。
   *   唯一会让它红的真实事件是「全仓死字段清零」——那本就该停下来看一眼，不该静默通过。 */
  add("必中/载体③ 判定器双向可判（群体）", "点名单个字段的必中金丝雀会在该字段被接线时误报「门坏了」——把成功报成失败；群体判据永不过期且两个方向都咬", () => {
    const rows = censusS3();
    const d = rows.filter((r) => r.cls === "DEAD"), c = rows.filter((r) => r.cls === "CONSUMED");
    return {
      ok: d.length > 0 && c.length > 0,
      got: `载体③ 扫 ${rows.length} 字段 · DEAD ${d.length}（例 ${d[0]?.id ?? "无"}）· CONSUMED ${c.length}（例 ${c[0]?.id ?? "无"}）`,
      want: "DEAD>0 且 CONSUMED>0（恒不咬与恒咬两种坏法都要红）",
    };
  });

  // C5 **必中**（载体④·作用域判据）：同样改成群体判据，但多咬一层 ——
  //    必须存在**至少一个**「作用域内判死、而全域同名命中 >0」的字段。
  //    这一层单靠 DEAD>0 咬不住：一个退化成全域匹配的判定器照样能产出 DEAD（那些全域也没人提的字段），
  //    只有"全域有同名却仍判死"才证明**作用域**这层真的在起作用。作用域判据失效 ⇒ 本门等于没建。
  add("必中/载体④ 作用域判据严于全域（群体）", "退化成全域名字匹配的判定器照样有 DEAD 输出——只有「全域有同名却仍判死」才证明作用域这层在起作用", () => {
    const { rows } = censusS4();
    const strict = rows.filter((r) => r.cls === "DEAD" && mentionsInProd(r.field, prodTexts).length > 0);
    const consumed = rows.filter((r) => r.cls === "CONSUMED");
    return {
      ok: strict.length > 0 && consumed.length > 0,
      got: `载体④ 扫 ${rows.length} 字段 · 作用域判死且全域有同名 ${strict.length}（例 ${strict[0]?.id ?? "无"}，全域 ${strict[0] ? mentionsInProd(strict[0].field, prodTexts).length : 0} 文件）· CONSUMED ${consumed.length}`,
      want: "「作用域判死 且 全域同名>0」的字段 >0，且 CONSUMED>0",
    };
  });

  // C6 **必不中**（载体③）：前端真在消费的字段必须放过
  add("必不中/载体③ chain_impediments.impediments", "放不过真消费字段 ⇒ 判定器恒咬 ⇒ 全仓报成缺口，门变噪音", () => {
    const v = verdictTopLevel("impediments", prodTexts, solverScopeTexts("chain_impediments"));
    return { ok: v.verdict === "CONSUMED", got: `${v.verdict}（${v.why}）`, want: "CONSUMED" };
  });

  // C6b **必不中**（载体④）：作用域内真被读的字段必须放过
  add("必不中/载体④ ChainImpedimentSchema.severity", "同上，载体④ 侧的恒咬检测", () => {
    const seeds = feSchemaImporters.get("ChainImpedimentSchema") ?? new Set();
    const texts = [...expandScope(seeds, importersOf)].map((r) => byRel.get(r)).filter(Boolean);
    const v = verdictScoped("severity", texts, prodTexts, texts.some(hasBindingRest));
    return { ok: v.verdict === "CONSUMED", got: `${v.verdict}（${v.why}）`, want: "CONSUMED" };
  });

  // C7 消费判据**双向**（共用 mentionsInProd）
  add("consume/双向判据", "单向金丝雀测不出恒真/恒假匹配器——一个报「零缺口」一个报「全是缺口」", () => {
    const present = mentionsInProd("impediments", prodTexts);
    const absent = mentionsInProd("__solver_field_seam_canary_never_exists__", prodTexts);
    return { ok: present.length > 0 && absent.length === 0, got: `已知存在命中 ${present.length} 文件 · 已知不存在命中 ${absent.length} 文件`, want: "前者>0 且 后者=0" };
  });

  // C8 消费判据剔注释：注释里提一嘴不算消费
  add("consume/注释不算消费", "把注释当消费 ⇒ 「后端注释承诺前端会接」自证成功 ⇒ 门永远绿", () => {
    const src = "// 候选 candidates 供前端渲染\nconst a = 1;";
    const hits = mentionsInProd("candidates", [{ rel: "fake.ts", src, mask: lex(src).mask }]);
    return { ok: hits.length === 0, got: hits, want: [] };
  });

  // C9 import 图认 ESM `./x.js` 说明符（铁律 0.6 五连犯第 2 例）
  add("import/图边不丢（认 ./x.js）", "不认 .js 说明符 ⇒ 整张图丢边 ⇒ 作用域恒只剩种子文件 ⇒ 大批字段被误报成死", () => {
    const edges = [...importersOf.values()].reduce((a, b) => a + b.size, 0);
    const target = "apps/frontend-shell/src/views/sim/chainImpediment.ts";
    const ups = [...(importersOf.get(target) ?? [])];
    return { ok: edges >= 50 && ups.length > 0, got: `总边 ${edges} · chainImpediment.ts 的 importer ${ups.length} 个（${ups.slice(0, 3).join(", ")}）`, want: "总边≥50 且 该文件有 importer" };
  });

  // C10 前端面剔 mocks/测试（只有 mock 引用 = 已排练，不是已实现）
  add("scan/前端面剔 mocks 与测试", "把 MSW mock 当消费方 ⇒ 「前端有了」是假的", () => {
    const bad = prodFiles.map(rel).filter((p) => p.includes("/mocks/") || /\.(test|spec)\.tsx?$/.test(p));
    return { ok: bad.length === 0 && prodFiles.length > 50, got: `生产文件 ${prodFiles.length} · 混入 mocks/测试 ${bad.length}`, want: ">50 且 0" };
  });

  // C11b 开放形状探测（真文件）：本仓已知有 2 个 `.catchall` 输出 schema，探不到就等于把盲区说成干净
  //      —— 第一版正则漏了闭合括号（本仓写法是 `})\n  .catchall(...)`），两个真样例一个都没认出来。
  add("open/catchall 输出 schema 探测", "探不到 ⇒ 「形状声明不穷尽」这个盲区被静默吞掉，本门会把「我只看得见声明的那些」说成「全都看过了」", () => {
    const open = [...schemas].filter(([, v]) => v.open).map(([n]) => n);
    return { ok: open.includes("CapacityForecastOutputSchema") && open.includes("AuditTimelineOutputSchema"), got: `开放 schema ${open.length} 个：${open.join(", ")}`, want: "含 CapacityForecastOutputSchema 与 AuditTimelineOutputSchema" };
  });

  // C12 载体⑤ 根解析（真文件）：`ChainScanResult` 必须解析到成员并被 join 上
  //     —— 这条同时是 `;` 成员切分的**负载证明**：换回只按逗号切 ⇒ 该接口抽出 0 个成员 ⇒ 本条当场开火
  add("iface/chain_impediments→ChainScanResult 根解析", "抽不到接口成员（如只按逗号切 TS interface）⇒ 载体⑤ 恒空 ⇒ 嵌套行字段整层看不见，门照样绿", () => {
    const props = (solverIfaces.get("ChainScanResult")?.props ?? []).map((p) => p.name);
    const r = ifaceRoots.get("chain_impediments");
    return { ok: props.includes("candidateStats") && r?.root === "ChainScanResult", got: `ChainScanResult 成员 ${props.length} 个 · 根=${r?.root ?? "未解析"}`, want: "成员含 candidateStats 且 根=ChainScanResult" };
  });

  // C13 **必中**（载体⑤）：candidateStats 行里的 `emitted` 是今天已知的真死字段
  // 同 C4/C5 改成群体判据（原先点名 `candidateStats.emitted`，已被 SandboxConsole.tsx:1644 接线）。
  // 本层多咬一条**结构性**判据：`censusS5` 必须真的产出行 —— 嵌套内联对象的成员抽取一旦失效，
  // 它会安静地返回空数组，而"扫了 0 个字段"和"扫了 N 个字段全是 CONSUMED"在汇总数字上都写着「没缺口」。
  // **一个恒空的枚举器是最完美的假绿**：它永远不报错，永远说干净。
  add("必中/载体⑤ 嵌套内联行字段可判（群体）", "嵌套成员抽取失效时枚举器安静返回空数组 —— 「扫了 0 个」与「全干净」在汇总数字上无法区分，恒空枚举器是最完美的假绿", () => {
    const rows = censusS5();
    const d = rows.filter((r) => r.cls === "DEAD"), c = rows.filter((r) => r.cls === "CONSUMED");
    return {
      ok: rows.length > 0 && d.length > 0 && c.length > 0,
      got: `载体⑤ 扫 ${rows.length} 个嵌套行字段 · DEAD ${d.length}（例 ${d[0]?.id ?? "无"}）· CONSUMED ${c.length}（例 ${c[0]?.id ?? "无"}）`,
      want: "扫描数>0 且 DEAD>0 且 CONSUMED>0",
    };
  });

  // C13b **必不中**（载体⑤）：counts 行里的 total 前端真在读
  add("必不中/载体⑤ chain_impediments.counts.total", "放不过真消费的嵌套字段 ⇒ 载体⑤ 恒咬", () => {
    const v = verdictTopLevel("total", prodTexts, solverScopeTexts("chain_impediments"));
    return { ok: v.verdict === "CONSUMED", got: `${v.verdict}（${v.why}）`, want: "CONSUMED" };
  });

  // C11 绑定位 rest 探测双向：认得出真 rest，且不把 `{...prev}` 字面量展开误判成 rest
  add("rest/绑定位探测双向", "恒真 ⇒ 全字段永远「未判定」，门变摆设；恒假 ⇒ 真透传被报成死字段", () => {
    const mk = (s) => ({ rel: "x.ts", src: s, mask: lex(s).mask });
    const yes = hasBindingRest(mk("const { a, ...rest } = row;"));
    const yes2 = hasBindingRest(mk("const f = ({ a, ...others }) => a;"));
    const no = hasBindingRest(mk("const n = { ...prev }; setX({ ...prev, a: 1 });"));
    return { ok: yes && yes2 && !no, got: `解构rest=${yes} 参数rest=${yes2} 字面量展开=${no}`, want: "true true false" };
  });

  return list;
}

const canaryResults = canaries().map((c) => ({ ...c, ...c.fn() }));
const broken = canaryResults.filter((c) => !c.ok);
if (broken.length) {
  console.error("⛔ 门自己坏了 —— solver-field-seam:check 的金丝雀未命中，本次**不产出任何结论**。");
  console.error("   （铁律 0.6：金丝雀不中只许报「工具坏了」，绝不许报「字段都干净 / 零死字段」。）\n");
  for (const c of broken) {
    console.error(`  ✗ 金丝雀「${c.name}」未中`);
    console.error(`      为什么它重要：${c.why}`);
    console.error(`      期望：${JSON.stringify(c.want)}`);
    console.error(`      实际：${JSON.stringify(c.got)}`);
  }
  process.exit(2);
}
console.log(
  `· 金丝雀 ${canaryResults.length}/${canaryResults.length} 全中` +
    `（形状解析 2 · 契约 schema 成员 1 · 开放形状探测 1 · 结果接口根解析 1 · **必中** 3 · **必不中** 3 · 消费判据 2 · import 图 1 · 扫描面 1 · rest 探测双向 1）` +
    ` —— 抽取器与判定器在真源码上有效，下面的否定结论才有资格被相信。`,
);
console.log("  必中证据：" + canaryResults.filter((c) => c.name.startsWith("必中/")).map((c) => `${c.name.split("/")[1]} ⇒ ${c.got}`).join(" ｜ "));

/* ════════════════════════════════════════════════════════════════════════════
 * 7 · 判定
 * ═══════════════════════════════════════════════════════════════════════════ */

const dead = [];        // { id, carrier, owner, field, cls, why, evidence }
const undecided = [];   // 同形状，但不 gate
let consumedCount = 0, scannedFields = 0;

// 三载体一律走 census*()——与金丝雀**同一份实现**。这里只做分档累加，不再各写一遍枚举。
const file2 = (rows) => { for (const row of rows) { scannedFields++; if (row.cls === "DEAD") dead.push(row); else if (row.cls === "UNDECIDED") undecided.push(row); else consumedCount++; } };

// ── 载体③ ──
file2(censusS3());

// ── 载体⑤（求解器层结果接口的嵌套一层内联对象字段）──
const s5rows = censusS5();
const ifaceNestedScanned = s5rows.length;
file2(s5rows);

// ── 载体④ ──
const s4 = censusS4();
const schemaCovered = s4.covered, schemaExempt = s4.exempt, schemaNoScope = s4.noScope;
file2(s4.rows);

/* ════════════════════════════════════════════════════════════════════════════
 * 8 · 棘轮基线（每条带理由 · 条数只降不升 · maxEntries 恒等于条数）
 * ═══════════════════════════════════════════════════════════════════════════ */

const BASELINE_NOTE = [
  "① 本文件是 `scripts/check-solver-field-seam.mjs` 的**存量死字段棘轮**：后端声明会下发、前端零消费方的求解器输出字段。",
  "② 每条必须写 `why`（<10 字即判红）。**无理由白名单正是本门要治的病**——豁免要说清「凭什么这条今天可以不接」。",
  "③ `maxEntries` 必须**恒等于** `entries.length`；`ratchetHigh` 是历史最高水位，**只降不升**。",
  "   评审唯一必须拒绝的一行，就是把 ratchetHigh 调大。加一条豁免 = 同时改 maxEntries = 一处显眼 diff，评审必然看见。",
  "④ `--update` **只删不加**（修好的摘掉），新增死字段**不自动收编**——要记进存量必须人手编辑本文件。",
  "⑤ `id` 形如 `S3:<求解器>.<字段>`（输出顶层字段）/ `S4:<契约schema>.<字段>`（契约 schema 嵌套一层）/ `S5:<求解器>.<顶层字段>.<行字段>`（结果接口内联行，嵌套一层）。",
].join("\n");

const emptyBase = { note: BASELINE_NOTE, ratchetHigh: 0, maxEntries: 0, entries: [] };
const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : emptyBase;
const baseIds = new Set((base.entries ?? []).map((e) => e.id));

const curIds = dead.map((d) => d.id);
const newDead = dead.filter((d) => !baseIds.has(d.id));
const fixed = [...baseIds].filter((id) => !curIds.includes(id));

/** 建账时给每条生成**可复验的**理由（不是"以后再说"，是"证据 + 修法 + 归类"）。 */
function seedEntry(d) {
    const kind =
    d.carrier === "S3" ? "求解器输出顶层字段"
    : d.carrier === "S4" ? "求解器侧契约 schema 字段（嵌套一层）"
    : "求解器结果接口的内联行字段（嵌套一层）";
  return {
    id: d.id,
    carrier: d.carrier,
    owner: d.owner,
    field: d.field,
    why:
      `存量（${new Date().toISOString().slice(0, 10)} 建门当日快照）：${kind} \`${d.owner}.${d.field}\` 由后端声明下发（声明处 ${d.evidence}）。` +
      `判死证据：${d.why}（前端生产面已剔 mocks/ 与测试、注释不算消费）。` +
      `归类=引擎已算、前端未接 —— 记账待排期，**不是**判它没用；` +
      `修法二选一：在 apps/frontend-shell/src 里真接上（reducer/选择器/组件读它），或后端别再声明下发。`,
    evidence: d.evidence,
  };
}

if (SEED) {
  if (existsSync(BASELINE)) {
    console.error("✗ --seed 拒绝执行：基线已存在。首次建账才用 --seed；日常收紧用 --update（只减不增）。");
    process.exit(1);
  }
  const bcSeed = baselineDocCanary();
  if (!bcSeed.ok) toolBroken(`基线写入器金丝雀不过（${bcSeed.got}）`, `期望：${bcSeed.want}`);
  const entries = dead.map(seedEntry);
  writeFileSync(
    BASELINE,
    JSON.stringify(buildBaselineDoc({
      prev: null, // --seed 只在基线不存在时可达（上面已挡），故首次建账必落常量 note
      generatedBy: "node scripts/check-solver-field-seam.mjs --seed",
      prose: { note: BASELINE_NOTE },
      computed: { ratchetHigh: entries.length, maxEntries: entries.length, entries: entries.sort((a, b) => (a.id < b.id ? -1 : 1)) },
    }), null, 2) + "\n",
  );
  console.log(`· 首次建账：死字段 ${entries.length} 条记为今天的存量基线（此后只减不增）。`);
  process.exit(0);
}

if (UPDATE) {
  // 只删不加：修好的（或已不再是死字段的）摘掉；新增缺口**不**自动招安。
  const kept = (base.entries ?? []).filter((e) => curIds.includes(e.id));
  // 棘轮水位只降不升：取「历史水位」与「现条数」的较小者。
  const nextHigh = Math.min(base.ratchetHigh ?? kept.length, Math.max(kept.length, 0)) || kept.length;
  const before = (base.entries ?? []).length;
  // 基线写入器四向金丝雀（与 buildBaselineDoc 共用同一份实现，不另抄）——
  // 原实现 note 无条件落常量、且不摊开 base ⇒ 人手挂账与人手新增顶层键都会被 --update 吞掉。
  const bcUpd = baselineDocCanary();
  if (!bcUpd.ok) toolBroken(`基线写入器金丝雀不过（${bcUpd.got}）`, `期望：${bcUpd.want}`);
  writeFileSync(
    BASELINE,
    JSON.stringify(buildBaselineDoc({
      prev: base,
      generatedBy: "node scripts/check-solver-field-seam.mjs --update",
      prose: { note: BASELINE_NOTE },
      computed: { ratchetHigh: nextHigh, maxEntries: kept.length, entries: kept },
    }), null, 2) + "\n",
  );
  // ⚠ 把内存里的 base 同步到刚写下去的那份：否则下面的「基线自检」拿的是**收紧前**的旧对象，
  //   会对着一个已经修好的状态报「条数 > ratchetHigh」。实测发生过（注入幽灵条目跑 --update 时）。
  base.entries = kept;
  base.maxEntries = kept.length;
  base.ratchetHigh = nextHigh;
  baseIds.clear();
  for (const e of kept) baseIds.add(e.id);
  console.log(`· 基线已收紧：${before} → ${kept.length} 条 · ratchetHigh ${nextHigh}（新增死字段 ${newDead.length} 条**未**收编）`);
}

/* ════════════════════════════════════════════════════════════════════════════
 * 9 · 报告（④ 自证扫描规模：扫了几个求解器 / 几个字段 / 前端几个文件）
 * ═══════════════════════════════════════════════════════════════════════════ */

const catalogSrc = existsSync(CATALOG) ? readFileSync(CATALOG, "utf8") : "";
const catalogKeys = new Set([...catalogSrc.matchAll(/\bkey:\s*"([a-z0-9_]+)"/g)].map((m) => m[1]));
const shapeless = [...catalogKeys].filter((k) => !shapes.has(k));

console.log(
  `· 扫描规模自证：求解器 ${shapes.size} 个（形状表锚点 ${rel(SOLVER_SERVICE)}:${anchorLine}；其中 ${shapeKeysResolved} 个走契约 schema 单源）` +
    ` · 载体④ 契约 schema ${schemaCovered} 个（入参族结构性豁免 ${schemaExempt} · 前端无 import 作用域 ${schemaNoScope}）` +
    ` · 载体⑤ 结果接口 ${solverIfaces.size} 个候选、结构 join 上 ${ifaceRoots.size} 个求解器（嵌套行字段 ${ifaceNestedScanned} 个）` +
    ` · 逐字段核对 ${scannedFields} 个` +
    ` · 前端生产代码 ${prodFiles.length} 个文件（已剔 mocks/ 与测试）· import 边 ${[...importersOf.values()].reduce((a, b) => a + b.size, 0)} 条`,
);
console.log(
  `· ⚠ 盲区自曝（载体⑤）：${ifaceRootFail.length} 个求解器没 join 到结果接口 ⇒ 它们的嵌套行字段本门看不见。` +
    `按原因分：${[...ifaceRootFail.reduce((m, x) => m.set(x.reason.split("——")[0].trim(), (m.get(x.reason.split("——")[0].trim()) ?? 0) + 1), new Map())].map(([r, n]) => `${r} ×${n}`).join(" · ")}`,
);
console.log(
  `· 判定：有消费方 ${consumedCount} · **死字段 ${dead.length}**（基线 ${baseIds.size} · 新增 ${newDead.length} · 已修复 ${fixed.length}）· 未判定 ${undecided.length}（不 gate，见 --verbose）`,
);
if (shapeless.length) {
  console.log(`· ⚠ 盲区自曝：目录里有 ${shapeless.length} 个求解器**未声明输出形状**（${shapeless.join(", ")}）⇒ 本门看不见它们的字段。这是缺口不是干净。`);
}
if (shapeKeysUnresolved.length) {
  console.log(`· ⚠ 盲区自曝：${shapeKeysUnresolved.length} 条 shapeKeys(...) 未解析到契约 schema（${shapeKeysUnresolved.join(", ")}）。`);
}
if (openShapeSolvers.length) {
  console.log(
    `· ⚠ 盲区自曝（**最重要的一条**）：${openShapeSolvers.length} 个求解器的输出 schema 用了 \`.catchall/.passthrough\`，` +
      `即它**自己声明不穷尽** —— ${openShapeSolvers.map((x) => `${x.solver}←${x.schema}`).join(" · ")}。` +
      `\n    实测标本：\`capacityForecast\`（apps/datacore/src/solvers/capacity.ts:407）把 \`scopeOut\` 展开进 3 个 return` +
      `（:547 / :659 / :688），下发 \`scope\`/\`scopeBaseId\`/\`scopeBaseName\`/\`scopeNote\` 四个键，` +
      `而 \`CapacityForecastOutputSchema\` 一个都没声明，前端 \`scopeNote\`/\`scopeBaseName\` 也零消费 ——` +
      `**这类字段本门看不见**，因为它们压根不在"后端声明会下发的字段"这个集合里。` +
      `\n    这不是本门漏判，是**上游单一来源本身不完整**：修法是让形状声明穷尽（或另立一道"实现返回键 ⊄ 声明形状"的漂移门），` +
      `不是把它当成"没问题"。写在这里，是因为不写下来它就会变成下一次「我以为都查过了」。`,
  );
}
if (fixed.length) {
  console.log(`· ✅ 有人把字段接上了：${fixed.slice(0, 8).join(", ")}${fixed.length > 8 ? " …" : ""}`);
  console.log("  → 跑 `node scripts/check-solver-field-seam.mjs --update` 收紧基线（只减不增，不会招安新缺口）。");
}
if (VERBOSE) {
  console.log("\n— 死字段明细 —");
  for (const d of dead) console.log(`  ${baseIds.has(d.id) ? "存量" : "新增"} ${d.id}  ←  ${d.evidence}  · ${d.why}`);
  console.log("\n— 未判定明细（本门排不掉，**不当死字段报**）—");
  for (const u of undecided) console.log(`  ${u.id}  ·  ${u.why}`);
}

/* ── 基线自身的完整性（无理由白名单 = 本门要治的病） ── */
const fails = [];
if (existsSync(BASELINE)) {
  const entries = base.entries ?? [];
  if (base.maxEntries !== entries.length) {
    fails.push(`基线自检：maxEntries=${base.maxEntries} ≠ entries.length=${entries.length} —— 加豁免必须同时改这个数（那是评审必然看见的显眼 diff）。`);
  }
  if (typeof base.ratchetHigh === "number" && entries.length > base.ratchetHigh) {
    fails.push(`基线自检：条数 ${entries.length} > ratchetHigh ${base.ratchetHigh} —— 棘轮只降不升。`);
  }
  const noWhy = entries.filter((e) => !e.why || String(e.why).trim().length < 10);
  if (noWhy.length) fails.push(`基线自检：${noWhy.length} 条豁免没写理由（<10 字）：${noWhy.slice(0, 5).map((e) => e.id).join(", ")}`);
}

if (newDead.length) {
  fails.push(
    `新增「后端声明下发·前端零消费方」**字段** ${newDead.length} 条（逐条见下）` +
      `\n      → 这就是 G-BE-FE-FIELD-DEAD：端点早就有、前端也在调，**但这个字段没人看**。` +
      `\n        「端点有人调」不度量「这个端点的输出都有人看」——befe-seam:check 只量前者，故它全绿也说明不了什么。` +
      `\n        修：在 apps/frontend-shell/src 里真接上（reducer/选择器/组件读它），或者后端别再声明下发这个字段；` +
      `\n        确属暂不接 → 人手把它加进 scripts/solver-field-seam-baseline.json 的 entries（**必须写 why**）并同步 maxEntries；` +
      `\n        误报（经 JSX \`{...row}\` 展开等本门追不到的形态消费）→ 同样加基线并把消费点写进 why，那是一个可评审的显式动作。` +
      newDead.map((d) => `\n        · ${d.id}  ←  ${d.evidence}  · ${d.why}`).join(""),
  );
}

if (fails.length) {
  console.error(`\n✗ solver-field-seam:check 未通过：`);
  for (const m of fails) console.error("  - " + m);
  process.exit(1);
}
console.log(
  `\n✓ solver-field-seam:check 通过：求解器输出字段无**新增**「后端声明下发、前端零消费方」缺口` +
    `（存量 ${dead.length} 已记基线，只减不增；未判定 ${undecided.length} 条如实列出、不冒充干净）。`,
);
