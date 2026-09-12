#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// WO-ONTOGRAPH · 本体图谱抽取器（原子层 + 关系边 + 切片层 + 切片目录索引 → YAML 集）
//
// 这不是门、不是棘轮、不是基线。**没有红绿判定，没有 --tighten。**
// 它只产出一份「可检索的事实快照」，100% 从源码抽取，零人工维护字段。
//
// 用法：
//   node scripts/ontology-graph/extract.mjs            # 抽取 → docs/ontology-graph/
//   node scripts/ontology-graph/extract.mjs --canary   # 只跑金丝雀（自证工具没坏）
//   node scripts/ontology-graph/extract.mjs --verify   # 跑四条对照实验（验收）
//
// ── 已知会骗人的工具（本仓实测，全部写死在这里防复发） ──────────────────────
// ① `parseJsonConfigFileContent(...).fileNames` —— apps/*/tsconfig.json 的 include
//    只有 ["src"]，program 里**一个测试文件都没有** ⇒ 「只有 test 引用 = 0」是工具坏了，
//    不是事实。本脚本自己 walk src+test 喂给 createProgram，并 delete rootDir。
// ② 不给 `paths` 映射 ⇒ `@platform/contracts` 解析到 dist/*.d.ts，跨包引用**全丢**
//    ⇒ 「contracts 整包是死代码」。本脚本把它映射回 packages/contracts/src。
// ③ `grep -c '"'` 数注册表条目 ⇒ 把注释里的字符串也数进去（求解器 60/62/63 那次）。
//    本脚本的 registers 边优先**真 import dist 求值**，退化时才标 confidence: parsed。
// ④ 任何否定结论（零调用方 / 没有命中 / 不存在）之前必须先跑金丝雀。见 CANARIES。
// ════════════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const require = createRequire(path.join(REPO, "package.json"));
const ts = require("typescript");

const OUT_DIR = path.join(REPO, "docs", "ontology-graph");

// ── 包清单（有 src/ 的 TS 包；packages/dsh-harness 是 vendored .mjs，无 src/，不在内） ──
const PACKAGES = [
  { name: "datacore", root: "apps/datacore" },
  { name: "agentcore", root: "apps/agentcore" },
  { name: "frontend-shell", root: "apps/frontend-shell" },
  { name: "contracts", root: "packages/contracts" },
  { name: "llm-adapters", root: "packages/llm-adapters" },
];

const rel = (p) => path.relative(REPO, p).split(path.sep).join("/");
const log = (...a) => process.stderr.write(a.join(" ") + "\n");

// ════════════════════════════════════════════════════════════════════════════
// 0 · 文件遍历（确定性：目录项排序后递归，⛔ 不依赖文件系统返回顺序）
// ════════════════════════════════════════════════════════════════════════════
function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) acc.push(p);
  }
  return acc;
}

function readJsonc(p) {
  // tsconfig 允许注释 —— 用 ts 自己的解析器，别手写正则。
  const r = ts.readConfigFile(p, ts.sys.readFile);
  if (r.error) throw new Error(`readConfigFile ${p}: ${ts.flattenDiagnosticMessageText(r.error.messageText, " ")}`);
  return r.config;
}

function compilerOptionsFor(pkg) {
  const base = readJsonc(path.join(REPO, "tsconfig.base.json")).compilerOptions ?? {};
  const own = readJsonc(path.join(REPO, pkg.root, "tsconfig.json")).compilerOptions ?? {};
  const merged = { ...base, ...own };
  const { options, errors } = ts.convertCompilerOptionsFromJson(merged, path.join(REPO, pkg.root));
  if (errors.length) log(`  ⚠ ${pkg.name} compilerOptions: ${errors.map((e) => ts.flattenDiagnosticMessageText(e.messageText, " ")).join("; ")}`);
  delete options.rootDir;      // ← 坑 ①：test/ 在 rootDir 外，不删会报错
  delete options.outDir;
  delete options.composite;
  delete options.declarationDir;
  options.noEmit = true;
  options.declaration = false;
  options.sourceMap = false;
  options.skipLibCheck = true;
  options.allowJs = false;
  options.jsx = options.jsx ?? ts.JsxEmit.ReactJSX;
  options.types = options.types ?? [];
  // ← 坑 ②：把 workspace 包映射回**源码**，否则跨包引用解析到 dist/*.d.ts 全丢
  options.baseUrl = REPO;
  options.paths = {
    "@platform/contracts": ["packages/contracts/src/index.ts"],
    "@platform/contracts/*": ["packages/contracts/src/*"],
    "@platform/llm-adapters": ["packages/llm-adapters/src/index.ts"],
    "@platform/llm-adapters/*": ["packages/llm-adapters/src/*"],
  };
  return options;
}

// ════════════════════════════════════════════════════════════════════════════
// 1 · 原子层：导出符号 → atom
// ════════════════════════════════════════════════════════════════════════════
const atoms = new Map();   // id -> atom
const edges = [];          // {kind, from, to, ...}
const pushEdge = (e) => edges.push(e);

const atomId = (relPath, name) => `sym:${relPath}#${name}`;

function kindOfDecl(d) {
  if (ts.isFunctionDeclaration(d)) return "function";
  if (ts.isClassDeclaration(d)) return "class";
  if (ts.isInterfaceDeclaration(d)) return "interface";
  if (ts.isTypeAliasDeclaration(d)) return "type";
  if (ts.isEnumDeclaration(d)) return "enum";
  if (ts.isVariableDeclaration(d)) {
    const init = d.initializer;
    // const f = () => {} / function(){} 语义上是函数，标 function（比 const 有用，且仍是机器判的）
    if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) return "function";
    return "const";
  }
  return null;
}

/** 取 JSDoc 描述。⛔ 只认 /** *\/，抽不到就是 none —— 绝不编造、绝不让 LLM 补。 */
function briefOf(sym, checker) {
  const parts = sym.getDocumentationComment(checker);
  const s = ts.displayPartsToString(parts).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, 300) : "";
}

/** 从「目录段 / 包名 / 本体域」派生 tags。⛔ 不许人手起名。 */
function tagsOf(pkgName, relPath) {
  const segs = relPath.split("/");
  const i = segs.indexOf("src") >= 0 ? segs.indexOf("src") : segs.indexOf("test");
  const dirs = segs.slice(i + 1, -1).filter((s) => s && s !== "index");
  return [...new Set([pkgName, ...dirs])].sort();
}

/** 注释里的 WO-XXX 锚点（机器抽，没有就是 null）。 */
const WO_RE = /\bWO-[A-Z0-9][A-Z0-9-]{2,}\b/;
function woOf(node, sf) {
  const full = sf.getFullText();
  const lead = full.slice(node.getFullStart(), node.getStart(sf));
  const m = WO_RE.exec(lead);
  return m ? m[0] : null;
}

const lineOf = (node, sf) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

function ensureAtom(id, fields) {
  let a = atoms.get(id);
  if (!a) {
    a = { id, inboundSrc: new Map(), inboundTest: new Map(), ...fields };
    atoms.set(id, a);
  }
  return a;
}

// ════════════════════════════════════════════════════════════════════════════
// 2 · 建 program（逐包，避免一个 719 文件的巨型 program 撑爆内存）
// ════════════════════════════════════════════════════════════════════════════
function buildPrograms() {
  const out = [];
  for (const pkg of PACKAGES) {
    const srcDir = path.join(REPO, pkg.root, "src");
    const testDir = path.join(REPO, pkg.root, "test");
    const files = [...walk(srcDir), ...walk(testDir)];
    if (files.length === 0) { log(`  ⚠ ${pkg.name}: 0 个 .ts 文件 —— 跳过`); continue; }
    const t0 = Date.now();
    const program = ts.createProgram(files, compilerOptionsFor(pkg));
    const checker = program.getTypeChecker();
    const owned = new Set(files.map(rel));
    log(`  ${pkg.name}: ${files.length} 文件 (${walk(srcDir).length} src + ${walk(testDir).length} test) · program ${Date.now() - t0}ms · RSS ${(process.memoryUsage().rss / 1e6).toFixed(0)}MB`);
    out.push({ pkg, program, checker, owned, files });
  }
  return out;
}

// ── 2a · 收原子 ──────────────────────────────────────────────────────────────
function collectAtoms(ctxs) {
  for (const { pkg, program, checker, owned } of ctxs) {
    for (const sf of program.getSourceFiles()) {
      const r = rel(sf.fileName);
      if (!owned.has(r)) continue;          // 只收本包 walk 出来的文件（别把 lib.d.ts 收进来）
      if (r.includes("/test/")) continue;    // 原子 = src 导出符号；test 只当引用来源
      const modSym = checker.getSymbolAtLocation(sf);
      if (!modSym) continue;                 // 非模块（无 import/export）
      for (const sym of checker.getExportsOfModule(modSym)) {
        const name = sym.getName();
        if (name === "default" || name === "__esModule") continue;
        const isAlias = !!(sym.flags & ts.SymbolFlags.Alias);
        let target = sym;
        if (isAlias) { try { target = checker.getAliasedSymbol(sym); } catch { target = sym; } }
        const tDecls = target.getDeclarations() ?? [];
        const tDecl = tDecls.find((d) => kindOfDecl(d)) ?? tDecls[0];
        if (!tDecl) continue;
        const tFile = rel(tDecl.getSourceFile().fileName);
        if (tFile.startsWith("node_modules") || !/^(apps|packages)\//.test(tFile)) continue;

        if (isAlias && tFile !== r) {
          // 薄 re-export：本文件只是壳，真实现在 tFile
          const id = atomId(r, name);
          const localDecl = (sym.getDeclarations() ?? [])[0];
          ensureAtom(id, {
            name, kind: kindOfDecl(tDecl) ?? "const", file: r,
            line: localDecl ? lineOf(localDecl, localDecl.getSourceFile()) : 1,
            brief: briefOf(target, checker), tags: tagsOf(pkg.name, r),
            wo: localDecl ? woOf(localDecl, localDecl.getSourceFile()) : null,
            reexportOf: tFile, pkg: pkg.name, symbol: target,
          });
          pushEdge({ kind: "reexports", from: id, to: atomId(tFile, target.getName()), pkg: pkg.name });
          continue;
        }
        const k = kindOfDecl(tDecl);
        if (!k) continue;                    // 模块/命名空间/参数等，不是原子
        const id = atomId(tFile, target.getName());
        ensureAtom(id, {
          name: target.getName(), kind: k, file: tFile, line: lineOf(tDecl, tDecl.getSourceFile()),
          brief: briefOf(target, checker), tags: tagsOf(pkgOfFile(tFile), tFile),
          wo: woOf(tDecl, tDecl.getSourceFile()), reexportOf: null,
          pkg: pkgOfFile(tFile), symbol: target, decl: tDecl,
        });
      }
    }
  }
}

function pkgOfFile(relPath) {
  const p = PACKAGES.find((x) => relPath.startsWith(x.root + "/"));
  return p ? p.name : "unknown";
}

// ── 2b · 收引用边（calls，带 origin src/test） ────────────────────────────────
// 性能：先用「名字在导出名集合里」做廉价预筛，再 getSymbolAtLocation。
function collectRefs(ctxs) {
  const exportNames = new Set([...atoms.values()].map((a) => a.name));
  const byDeclId = new Map();
  for (const a of atoms.values()) if (!a.reexportOf) byDeclId.set(a.id, a);

  for (const { program, checker, owned } of ctxs) {
    for (const sf of program.getSourceFiles()) {
      const fromFile = rel(sf.fileName);
      if (!owned.has(fromFile)) continue;
      const isTest = fromFile.includes("/test/");
      const visit = (node) => {
        if (ts.isIdentifier(node) && exportNames.has(node.text)) {
          const p = node.parent;
          // 跳过 import/export 语句里的说明符 —— 那是管道，不是使用。
          // （包含它们会让「barrel 里转一手」被读成 wired，state 就不再度量「有没有人真用」。）
          const inPlumbing =
            (p && (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) ||
                   ts.isExportSpecifier(p) || ts.isImportEqualsDeclaration(p))) ||
            (p && ts.isPropertyAccessExpression(p) && p.name === node);
          if (!inPlumbing) {
            let sym = checker.getSymbolAtLocation(node);
            if (sym && sym.flags & ts.SymbolFlags.Alias) { try { sym = checker.getAliasedSymbol(sym); } catch { /* keep */ } }
            const decls = sym?.getDeclarations() ?? [];
            const d = decls.find((x) => kindOfDecl(x)) ?? decls[0];
            if (d) {
              const tFile = rel(d.getSourceFile().fileName);
              const id = atomId(tFile, sym.getName());
              const atom = byDeclId.get(id);
              // ⛔ 同文件引用不算「跨文件引用」；声明点本身也不算。
              if (atom && tFile !== fromFile) {
                const bucket = isTest ? atom.inboundTest : atom.inboundSrc;
                if (!bucket.has(fromFile)) bucket.set(fromFile, lineOf(node, sf));
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
  }
}

// ── 2c · 三态判定 ────────────────────────────────────────────────────────────
// no-ref  = 无任何跨文件引用
// test-only = 有引用，但**全部**来自 test  ← 假绿第 9 形态：实现有、测试有、绿的、零生产调用方
// wired   = 有 src 引用
function stateOf(a) {
  if (a.inboundSrc.size > 0) return "wired";
  if (a.inboundTest.size > 0) return "test-only";
  return "no-ref";
}

// ════════════════════════════════════════════════════════════════════════════
// 3 · 其余 6 种边（registers / seeds / asserts / reads / declares / inSlice）
// ════════════════════════════════════════════════════════════════════════════

/** 从 dist 求值注册表真数组。拿不到就返回 null（调用方标 confidence: parsed）。 */
async function evalFromDist(relSrcFile, exportName) {
  const distFile = relSrcFile.replace(/^(apps\/[^/]+|packages\/[^/]+)\/src\//, "$1/dist/").replace(/\.tsx?$/, ".js");
  const abs = path.join(REPO, distFile);
  if (!fs.existsSync(abs)) return null;
  try {
    const mod = await import(pathToFileURL(abs).href);
    const v = mod[exportName];
    if (Array.isArray(v)) return { count: v.length, keys: v.every((x) => typeof x === "string") ? v.slice() : null };
    if (v && typeof v === "object") { const k = Object.keys(v); return { count: k.length, keys: k }; }
    return null;
  } catch { return null; }
}

const unwrapAsConst = (e) => (e && ts.isAsExpression(e) ? e.expression : e);

/** 注册表候选：导出 const，初值是 ≥REGISTRY_MIN 条的字符串数组 或 对象字面量。 */
const REGISTRY_MIN = 8;
function registryEntriesOf(decl) {
  if (!decl || !ts.isVariableDeclaration(decl)) return null;
  const init = unwrapAsConst(decl.initializer);
  if (!init) return null;
  if (ts.isArrayLiteralExpression(init)) {
    const lits = init.elements.filter((e) => ts.isStringLiteral(e));
    if (lits.length >= REGISTRY_MIN && lits.length === init.elements.length) return lits.map((e) => e.text);
    return null;
  }
  if (ts.isObjectLiteralExpression(init)) {
    const keys = [];
    for (const p of init.properties) {
      if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) || ts.isMethodDeclaration(p)) && p.name) {
        if (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) keys.push(p.name.text);
        else return null;                       // 计算键 ⇒ AST 数不准，别硬数
      } else if (ts.isSpreadAssignment(p)) return null; // 展开 ⇒ AST 数必然偏小，别硬数
    }
    return keys.length >= REGISTRY_MIN ? keys : null;
  }
  return null;
}

/** zod schema 字段：找 z.object({...}) 的属性名。 */
function zodFieldsOf(decl) {
  if (!decl) return null;
  const fields = new Set();
  const visit = (n) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === "object" && ts.isIdentifier(n.expression.expression) &&
        n.expression.expression.text === "z" && n.arguments[0] && ts.isObjectLiteralExpression(n.arguments[0])) {
      for (const p of n.arguments[0].properties) {
        if (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) fields.add(p.name.text);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(decl);
  return fields.size ? [...fields].sort() : null;
}

/** reads 边：函数体里读的 ctx/context/state/world/worldState 字段。 */
const STATE_ROOTS = new Set(["ctx", "context", "state", "world", "worldState", "worldstate"]);
function stateReadsOf(decl) {
  if (!decl) return null;
  const hits = new Set();
  const visit = (n) => {
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && STATE_ROOTS.has(n.expression.text)) {
      hits.add(`${n.expression.text}.${n.name.text}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(decl);
  return hits.size ? [...hits].sort() : null;
}

// ⚠ seeds / asserts 只对**有鉴别力的字段**发边（机器判，⛔ 不开人工停用词表 —— 停用词表要人维护）。
// 判据：该字段名被**几个 schema 声明**。`id`/`name`/`key`/`status` 这类被 400+ 个 schema 声明，
// 它出现在某个测试里**不构成**「这个契约字段以字符串形态被钉住」的证据；被 1–3 个 schema
// 声明的字段才构成。不加这条过滤时 asserts = 18,847 条，其中绝大多数是 `id:`/`name:` 的噪声。
const DISTINCTIVE_MAX_SCHEMAS = 3;
function distinctiveFields(declaredBy) {
  return new Set([...declaredBy.entries()].filter(([, n]) => n <= DISTINCTIVE_MAX_SCHEMAS).map(([f]) => f));
}

/** asserts 边：测试里被断言的**字符串字面量数据键**（typecheck 一个都看不见的那批）。 */
const MATCHER_RE = /^(toContain|toMatch|toBe|toEqual|toStrictEqual|toHaveProperty|toContainEqual)$/;
function collectAsserts(ctxs, declaredFields) {
  for (const { program, owned } of ctxs) {
    for (const sf of program.getSourceFiles()) {
      const f = rel(sf.fileName);
      if (!owned.has(f) || !f.includes("/test/")) continue;
      const hits = new Map();                    // key -> line
      const note = (txt, node) => {
        if (declaredFields.has(txt) && !hits.has(txt)) hits.set(txt, lineOf(node, sf));
      };
      const visit = (n) => {
        // ① matcher 期望串：toContain("DemandSegment.p50")
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && MATCHER_RE.test(n.expression.name.text)) {
          for (const a of n.arguments) {
            if (ts.isStringLiteral(a)) { for (const tok of a.text.split(/[^A-Za-z0-9_]+/)) if (tok) note(tok, a); }
          }
        }
        // ② 对象字面量数据键：{ p50: 1 }
        if (ts.isObjectLiteralExpression(n)) {
          for (const p of n.properties) {
            if (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) note(p.name.text, p.name);
          }
        }
        // ③ 下标取值：props["p50"]
        if (ts.isElementAccessExpression(n) && n.argumentExpression && ts.isStringLiteral(n.argumentExpression)) {
          note(n.argumentExpression.text, n.argumentExpression);
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
      for (const [k, line] of [...hits.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        pushEdge({ kind: "asserts", from: `file:${f}`, to: `field:${k}`, line, pkg: pkgOfFile(f) });
      }
    }
  }
}

/** seeds 边：种子/mock/fixture 文件 → 它填的**已声明字段**，带 count。 */
const SEED_RE = /\/(seed|seeds|mock|mocks|fixture|fixtures|synthetic)[-/.]|\/(seed|mocks|fixtures)\.[tj]sx?$/i;
function collectSeeds(ctxs, declaredFields) {
  for (const { program, owned } of ctxs) {
    for (const sf of program.getSourceFiles()) {
      const f = rel(sf.fileName);
      if (!owned.has(f) || f.includes("/test/")) continue;
      if (!SEED_RE.test("/" + f)) continue;
      const counts = new Map();
      const visit = (n) => {
        if (ts.isObjectLiteralExpression(n)) {
          for (const p of n.properties) {
            if (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && declaredFields.has(p.name.text)) {
              counts.set(p.name.text, (counts.get(p.name.text) ?? 0) + 1);
            }
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
      for (const [k, c] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        pushEdge({ kind: "seeds", from: `file:${f}`, to: `field:${k}`, count: c, pkg: pkgOfFile(f) });
      }
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 4 · 切片层 —— ⛔ 复用本仓真实现，不重造
// ════════════════════════════════════════════════════════════════════════════
async function loadSliceLayer() {
  const need = [
    "apps/datacore/dist/synthetic/battery.js",
    "apps/datacore/dist/ontology/slice-library.js",
    "apps/datacore/dist/ontology/slice-index.js",
  ];
  for (const n of need) if (!fs.existsSync(path.join(REPO, n))) {
    log(`  ⚠ 切片层跳过：${n} 不存在（需先 pnpm --filter datacore build）`);
    return null;
  }
  const battery = await import(pathToFileURL(path.join(REPO, need[0])).href);
  const lib = await import(pathToFileURL(path.join(REPO, need[1])).href);
  const idx = await import(pathToFileURL(path.join(REPO, need[2])).href);

  const objectTypes = battery.batteryObjectTypes();
  const linkTypes = battery.batteryLinkTypes();
  const types = objectTypes.map((t) => ({ key: t.key, domain: t.domain }));
  const links = linkTypes.map((l) => ({ linkKey: l.key, fromTypeKey: l.fromTypeKey, toTypeKey: l.toTypeKey }));
  const displayOf = new Map(objectTypes.map((t) => [t.key, t.displayName ?? t.key]));

  const { intra, cross } = lib.deriveSliceLibrary(types, links);
  const entries = [...intra, ...cross];
  // 机器派生 brief：⛔ 无人工文案。跨域切片点名接缝（§10.4 接缝=断点高发区）。
  const briefOf = (e) =>
    e.scope === "intra"
      ? `域内切片·域 ${e.domain}·根 ${displayOf.get(e.rootType) ?? e.rootType}(${e.rootType})·覆盖 ${e.spannedTypes.length} 类型：${e.spannedTypes.map((t) => displayOf.get(t) ?? t).join("、")}`
      : `跨域接缝切片·${e.spannedDomains.join("↔")}·${e.spannedTypes.map((t) => `${displayOf.get(t) ?? t}(${t})`).join(" → ")}`;
  const descriptors = entries.map((e) => ({
    sliceKey: e.sliceKey, rootType: e.rootType,
    description: briefOf(e),
    indexEntities: [...new Set([...e.spannedTypes, ...e.spannedTypes.map((t) => displayOf.get(t) ?? t)])].sort(),
  }));
  return { entries, descriptors, types, links, displayOf, idx, lib, briefOf, objectTypes, linkTypes };
}

// ════════════════════════════════════════════════════════════════════════════
// 5 · YAML 输出（自写，无新依赖。所有字符串走 JSON.stringify —— JSON 是 YAML1.2 子集）
// ════════════════════════════════════════════════════════════════════════════
const q = (s) => JSON.stringify(String(s));
function yv(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.length === 0 ? "[]" : `[${v.map(yv).join(", ")}]`;
  if (typeof v === "object") {
    const ks = Object.keys(v);
    return ks.length === 0 ? "{}" : `{ ${ks.map((k) => `${k}: ${yv(v[k])}`).join(", ")} }`;
  }
  return q(v);
}
/** 块式对象（用于原子这种字段多的），嵌套用内联流式 —— 稳定、可 diff。 */
function yBlockList(items, indent = "  ") {
  const out = [];
  for (const it of items) {
    const ks = Object.keys(it);
    out.push(`${indent}- ${ks[0]}: ${yv(it[ks[0]])}`);
    for (const k of ks.slice(1)) out.push(`${indent}  ${k}: ${yv(it[k])}`);
  }
  return out.join("\n");
}

// ════════════════════════════════════════════════════════════════════════════
// 6 · 金丝雀 —— ⛔ 任何否定结论之前必须先跑；不中就报「工具坏了」，不许报「没有」
//     判据与主逻辑**共用同一份实现**（读的就是 atoms/edges 本身），不另抄一套。
// ════════════════════════════════════════════════════════════════════════════
function runCanaries(g) {
  const { sliceInfo, inSliceCount } = g;
  const A = (id) => atoms.get(id);
  const C = [];
  const add = (probe, expect, actual, ok, note) => C.push({ probe, expect, actual, ok, ...(note ? { note } : {}) });

  // ① 已知符号在节点表里（工具没坏的最低证据）
  const bsi = A("sym:apps/datacore/src/ontology/slice-index.ts#buildSliceIndex");
  add("buildSliceIndex 在节点表里", "present", bsi ? "present" : "ABSENT", !!bsi);

  // ② 已知被调符号入边 > 0，且来源与手工 grep 一致（app.ts）
  const srcFiles = bsi ? [...bsi.inboundSrc.keys()] : [];
  add("buildSliceIndex src 入边数", ">0", srcFiles.length, srcFiles.length > 0);
  add("buildSliceIndex 入边含 apps/datacore/src/app.ts", "true",
      String(srcFiles.includes("apps/datacore/src/app.ts")), srcFiles.includes("apps/datacore/src/app.ts"));

  // ③ 已知切片的 inSlice 入边 > 0
  add("inSlice 边总数", ">0", inSliceCount, inSliceCount > 0);
  if (sliceInfo) {
    const k = sliceInfo.entries[0]?.sliceKey;
    const n = k ? (g.inSliceBySlice.get(k)?.length ?? 0) : 0;
    add(`切片 ${k ?? "(none)"} 的 inSlice 入边`, ">0", n, n > 0);
  }

  // ④ 跨包边可见（坑 ②：不给 paths 时这条恒 0 ⇒「contracts 整包是死代码」）
  const crossPkg = [...atoms.values()].filter((a) => a.pkg === "contracts" &&
    [...a.inboundSrc.keys()].some((f) => !f.startsWith("packages/contracts/"))).length;
  add("contracts 原子被外包引用数", ">0", crossPkg, crossPkg > 0, "为 0 ⇒ paths 映射坏了，不是 contracts 死了");

  // ⑤ test 引用可见（坑 ①：include 只有 src 时这条恒 0 ⇒「只有 test 引用 = 0」）
  const withTest = [...atoms.values()].filter((a) => a.inboundTest.size > 0).length;
  add("有 test 入边的原子数", ">0", withTest, withTest > 0, "为 0 ⇒ program 里没有 test 文件，不是没人写测试");

  // ⑥ 薄 re-export 可见（本维度派单方自己没自证成功，故独立立金丝雀）
  const reexp = edges.filter((e) => e.kind === "reexports");
  const known = "sym:apps/datacore/src/solvers/service.ts#LEVER_PROP_META";
  const hasKnown = reexp.some((e) => e.from === known);
  add("reexports 边总数", ">0", reexp.length, reexp.length > 0);
  add("已知 re-export（service.ts 转 LEVER_PROP_META）命中", "true", String(hasKnown), hasKnown,
      "出处：apps/datacore/src/solvers/service.ts 的 `export { LEVER_PROP_META, ... } from \"./lever-meta.js\"`");

  // ⑦ registers 边至少有一条是**真求值**来的，不是正则数的
  const ev = edges.filter((e) => e.kind === "registers" && e.confidence === "evaluated");
  add("evaluated 置信度的 registers 边", ">0", ev.length, ev.length > 0,
      "为 0 ⇒ dist 没建，全部退化成 parsed（正则/AST 数，会把注释里的串数进去）");

  return C;
}

// ════════════════════════════════════════════════════════════════════════════
// 主流程
// ════════════════════════════════════════════════════════════════════════════
async function build() {
  log("── 建 program（逐包） ─────────────────────────────");
  const t0 = Date.now();
  const ctxs = buildPrograms();
  log("── 收原子 ─────────────────────────────────────────");
  collectAtoms(ctxs);
  log(`  原子 ${atoms.size}`);
  log("── 收引用边（calls） ──────────────────────────────");
  collectRefs(ctxs);

  // declares（先做，seeds/asserts 要用它的字段集）
  const declaredBy = new Map();   // field -> 声明它的 schema 原子数
  for (const a of [...atoms.values()].sort((x, y) => x.id.localeCompare(y.id))) {
    const fs_ = zodFieldsOf(a.decl);
    if (fs_) for (const f of fs_) {
      declaredBy.set(f, (declaredBy.get(f) ?? 0) + 1);
      pushEdge({ kind: "declares", from: a.id, to: `field:${f}`, pkg: a.pkg });
    }
    const rd = stateReadsOf(a.decl);
    if (rd) for (const f of rd) pushEdge({ kind: "reads", from: a.id, to: `state:${f}`, pkg: a.pkg });
  }
  const declaredFields = distinctiveFields(declaredBy);
  log(`  declares 字段 ${declaredBy.size}（其中有鉴别力的 ${declaredFields.size} —— seeds/asserts 只对这批发边）`);

  log("── registers（优先 dist 真求值） ──────────────────");
  let evaluated = 0, parsedOnly = 0;
  for (const a of [...atoms.values()].sort((x, y) => x.id.localeCompare(y.id))) {
    const entries = registryEntriesOf(a.decl);
    if (!entries) continue;
    const real = await evalFromDist(a.file, a.name);
    const confidence = real && real.count === entries.length ? "evaluated"
      : real ? "evaluated-mismatch" : "parsed";
    const list = real?.keys ?? entries;
    if (confidence === "parsed") parsedOnly++; else evaluated++;
    a.registry = { parsedCount: entries.length, evaluatedCount: real?.count ?? null, confidence };
    for (const e of list) pushEdge({ kind: "registers", from: a.id, to: `entry:${e}`, confidence, pkg: a.pkg });
  }
  log(`  注册表 evaluated ${evaluated} · parsed-only ${parsedOnly}`);

  log("── seeds / asserts ────────────────────────────────");
  collectSeeds(ctxs, declaredFields);
  collectAsserts(ctxs, declaredFields);

  log("── 切片层（复用真实现） ───────────────────────────");
  const sliceInfo = await loadSliceLayer();
  const inSliceBySlice = new Map();
  let inSliceCount = 0;
  if (sliceInfo) {
    // 原子 ∈ 切片 的判据：原子声明节点里以**字符串字面量**出现该切片覆盖的类型键。
    // ⚠ 用字符串字面量而不是标识符：Model/Order/Base/Line 这些是极常见英文词，
    //   按标识符匹配会造出海量假边；而本体类型键在运行时正是以字符串键形态使用。
    const litCache = new Map();
    const litsOf = (a) => {
      if (!a.decl) return new Set();
      if (litCache.has(a.id)) return litCache.get(a.id);
      const s = new Set();
      const visit = (n) => {
        if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) s.add(n.text);
        ts.forEachChild(n, visit);
      };
      visit(a.decl);
      litCache.set(a.id, s);
      return s;
    };
    const allAtoms = [...atoms.values()].filter((a) => a.decl);
    for (const e of sliceInfo.entries) {
      const span = new Set(e.spannedTypes);
      const members = [];
      for (const a of allAtoms) {
        const lits = litsOf(a);
        const hit = [...span].filter((t) => lits.has(t)).sort();
        if (hit.length) { members.push({ atom: a.id, via: hit }); }
      }
      members.sort((x, y) => x.atom.localeCompare(y.atom));
      inSliceBySlice.set(e.sliceKey, members);
      inSliceCount += members.length;
      for (const m of members) pushEdge({ kind: "inSlice", from: m.atom, to: `slice:${e.sliceKey}`, via: m.via });
    }
    log(`  切片 ${sliceInfo.entries.length}（域内 ${sliceInfo.entries.filter((e) => e.scope === "intra").length} · 跨域 ${sliceInfo.entries.filter((e) => e.scope === "cross").length}） · inSlice 边 ${inSliceCount}`);
  }

  const g = { ctxs, sliceInfo, inSliceBySlice, inSliceCount, declaredFields };
  g.canaries = runCanaries(g);
  log(`── 总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s · 峰值 RSS ${(process.memoryUsage().rss / 1e6).toFixed(0)}MB ──`);
  return g;
}

function commitHash() {
  try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO }).toString().trim(); }
  catch { return "unknown"; }
}

const INBOUND_CAP = 25;
const cap = (arr) => (arr.length <= INBOUND_CAP ? arr : arr.slice(0, INBOUND_CAP));

function emit(g) {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT_DIR, "atoms"), { recursive: true });
  fs.mkdirSync(path.join(OUT_DIR, "slices"), { recursive: true });

  const all = [...atoms.values()].sort((a, b) => a.id.localeCompare(b.id));
  const byState = { wired: 0, "test-only": 0, "no-ref": 0 };
  const sliceOfAtom = new Map();
  for (const [k, ms] of g.inSliceBySlice) for (const m of ms) {
    if (!sliceOfAtom.has(m.atom)) sliceOfAtom.set(m.atom, []);
    sliceOfAtom.get(m.atom).push(k);
  }

  // ── atoms/<package>.yaml ──
  const shards = [];
  for (const pkg of PACKAGES) {
    const mine = all.filter((a) => a.pkg === pkg.name);
    if (mine.length === 0) continue;
    const rows = mine.map((a) => {
      const st = stateOf(a); byState[st]++;
      return {
        id: a.id, name: a.name, kind: a.kind, file: a.file, line: a.line,
        brief: a.brief || "", docSource: a.brief ? "jsdoc" : "none",
        tags: a.tags, wo: a.wo, state: st, reexportOf: a.reexportOf,
        ...(a.registry ? { registry: a.registry } : {}),
        ...(sliceOfAtom.has(a.id) ? { slices: sliceOfAtom.get(a.id).slice().sort() } : {}),
        inbound: {
          // 计数是**全量**（state 就是从它判的）；样例封顶 INBOUND_CAP 条，只为体积。
          // ⚠ 封顶只截样例、⛔ 绝不截计数 —— 截了计数就等于把「有多少人在用」改成「我列了几条」。
          srcCount: a.inboundSrc.size, testCount: a.inboundTest.size,
          src: cap([...a.inboundSrc.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([file, line]) => ({ file, line }))),
          test: cap([...a.inboundTest.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([file, line]) => ({ file, line }))),
        },
      };
    });
    const myEdges = edges.filter((e) => e.pkg === pkg.name && e.kind !== "inSlice")
      .sort((a, b) => (a.kind + a.from + a.to).localeCompare(b.kind + b.from + b.to));
    const lines = [
      `# 生成物 —— ⛔ 不要手改。改了下次抽取会被覆盖。`,
      `# 生成命令：node scripts/ontology-graph/extract.mjs`,
      `package: ${q(pkg.name)}`,
      `counts: ${yv({ atoms: rows.length, edges: myEdges.length })}`,
      `atoms:`,
      yBlockList(rows),
      `edges:`,
      myEdges.length ? yBlockList(myEdges.map(({ pkg: _p, ...r }) => r)) : "  []",
      ``,
    ];
    const f = `atoms/${pkg.name}.yaml`;
    fs.writeFileSync(path.join(OUT_DIR, f), lines.join("\n"));
    shards.push({ package: pkg.name, file: f, count: rows.length, edges: myEdges.length });
  }

  // ── slices/<sliceKey>.yaml + INDEX 的 slices: 段 ──
  const sliceRows = [];
  if (g.sliceInfo) {
    const { entries, descriptors, idx } = g.sliceInfo;
    const descByKey = new Map(descriptors.map((d) => [d.sliceKey, d]));
    for (const e of entries) {
      const d = descByKey.get(e.sliceKey);
      const members = g.inSliceBySlice.get(e.sliceKey) ?? [];
      // consumers：从引用边**反查**（⛔ 不是人填）—— 引用了本切片任一原子的 src 文件。
      const consumers = new Set();
      for (const m of members) {
        const a = atoms.get(m.atom);
        if (a) for (const f of a.inboundSrc.keys()) consumers.add(f);
      }
      const consumerList = [...consumers].sort();
      // tokens：复用真实现 tokenizeQuestion（⛔ 别自己写分词），且与 lookupReusableByQuestion
      // 内部算法逐字一致 —— 这样只读 INDEX.yaml 就能复现它的选择（验收 ③）。
      const tokens = [...new Set([...idx.tokenizeQuestion(d.description), ...d.indexEntities.map((x) => x.toLowerCase())])].sort();
      const body = [
        `# 生成物 —— ⛔ 不要手改。`,
        `sliceKey: ${q(e.sliceKey)}`,
        `scope: ${q(e.scope)}`,
        `rootType: ${q(e.rootType)}`,
        `domain: ${q(e.domain)}`,
        `spannedTypes: ${yv(e.spannedTypes)}`,
        `spannedDomains: ${yv(e.spannedDomains)}`,
        `paths: ${yv(e.paths)}`,
        `brief: ${q(d.description)}`,
        `indexEntities: ${yv(d.indexEntities)}`,
        `tokens: ${yv(tokens)}`,
        `counts: ${yv({ atoms: members.length, consumers: consumerList.length })}`,
        `atoms:`,
        members.length ? yBlockList(members.map((m) => ({ atom: m.atom, via: m.via }))) : "  []",
        `consumers: ${yv(consumerList)}`,
        ``,
      ].join("\n");
      const fname = `slices/${e.sliceKey}.yaml`;
      fs.writeFileSync(path.join(OUT_DIR, fname), body);
      sliceRows.push({
        key: e.sliceKey, file: fname, rootType: e.rootType, scope: e.scope,
        domain: e.domain, brief: d.description, tags: d.indexEntities,
        spannedTypes: e.spannedTypes, spannedDomains: e.spannedDomains,
        atomCount: members.length, consumerCount: consumerList.length,
        tokens, span: d.indexEntities.length,
      });
    }
    sliceRows.sort((a, b) => a.key.localeCompare(b.key));
  }

  // ── INDEX.yaml ──
  const kindCounts = {};
  for (const e of edges) kindCounts[e.kind] = (kindCounts[e.kind] ?? 0) + 1;
  const docNone = all.filter((a) => !a.brief).length;
  const idxLines = [
    `# 本体图谱 · 索引目录（唯一入口 —— 只靠这一份就能回答「哪条切片覆盖 rootType=X 且跨到 Y」）`,
    `# 生成物 —— ⛔ 不要手改。生成命令：node scripts/ontology-graph/extract.mjs`,
    `# 人读的散文本体在 docs/SYSTEM-ONTOLOGY.md，**保留不动**，本目录是它旁边的机器抽取面。`,
    `version: 1`,
    `generatedFrom: ${q(commitHash())}`,   // ⛔ 不打时间戳 —— 会破坏字节级确定性（R6）
    `counts: ${yv({
      atoms: all.length, edges: edges.length, slices: sliceRows.length,
      byState, byEdgeKind: kindCounts,
      docSourceNone: docNone,
      docSourceNonePct: all.length ? Number(((docNone / all.length) * 100).toFixed(2)) : 0,
    })}`,
    `canary:`,
    yBlockList(g.canaries),
    `atomShards:`,
    yBlockList(shards),
    `slices:`,
    sliceRows.length ? yBlockList(sliceRows) : "  []",
    ``,
  ];
  fs.writeFileSync(path.join(OUT_DIR, "INDEX.yaml"), idxLines.join("\n"));

  return { all, byState, shards, sliceRows, kindCounts, docNone };
}

// ════════════════════════════════════════════════════════════════════════════
// --verify · 四条对照实验（验收）。⛔ 这不是门：它只打印数字，rc 恒 0。
// ════════════════════════════════════════════════════════════════════════════
async function verify(g, summary) {
  const R = [];
  const say = (s) => { R.push(s); process.stdout.write(s + "\n"); };

  say("═══ 验收 ① 注册表计数对照（registers 边数 vs 真数组 .length） ═══");
  const regs = [...atoms.values()].filter((a) => a.registry).sort((a, b) => a.id.localeCompare(b.id));
  const mism = regs.filter((a) => a.registry.evaluatedCount !== null && a.registry.evaluatedCount !== a.registry.parsedCount);
  say(`  注册表候选 ${regs.length} 个；其中 dist 可求值 ${regs.filter((a) => a.registry.evaluatedCount !== null).length} 个`);
  for (const a of regs.slice(0, 40)) {
    const edgeN = edges.filter((e) => e.kind === "registers" && e.from === a.id).length;
    say(`  ${a.name.padEnd(28)} AST解析=${String(a.registry.parsedCount).padStart(4)}  真求值=${String(a.registry.evaluatedCount ?? "n/a").padStart(4)}  registers边=${String(edgeN).padStart(4)}  ${a.registry.confidence}${a.registry.evaluatedCount !== null && a.registry.evaluatedCount !== a.registry.parsedCount ? "   ⚠ 不一致" : ""}`);
  }
  say(`  ⇒ AST 与真求值不一致的注册表：${mism.length} 个${mism.length ? "（" + mism.map((a) => a.name).join(", ") + "）" : ""}`);

  say("");
  say("═══ 验收 ③ 切片目录索引可独立检索（只读 INDEX.yaml vs 真实现 lookupReusableByQuestion） ═══");
  if (!g.sliceInfo) say("  切片层未加载（dist 缺失），跳过");
  else {
    const { descriptors, idx } = g.sliceInfo;
    // 只读 INDEX.yaml：重新从磁盘 parse，⛔ 不碰内存里的切片对象，也不加载任何分片。
    const raw = fs.readFileSync(path.join(OUT_DIR, "INDEX.yaml"), "utf8");
    const rows = [];
    let inSlices = false;
    for (const line of raw.split("\n")) {
      if (/^slices:/.test(line)) { inSlices = true; continue; }
      if (!inSlices) continue;
      if (/^\s{2}- key: /.test(line)) rows.push({});
      const m = /^\s{2,4}(-\s)?(\w+): (.*)$/.exec(line);
      if (m && rows.length) { try { rows[rows.length - 1][m[2]] = JSON.parse(m[3]); } catch { /* 非 JSON 标量，本实验用不到 */ } }
    }
    const jac = (a, b) => { if (!a.size || !b.size) return 0; let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i); };
    const indexOnlyLookup = (rootType, question, threshold = 0.2) => {
      const qt = new Set(idx.tokenizeQuestion(question));      // 分词复用真实现（README 已声明）
      if (!qt.size) return null;
      const scored = rows.filter((r) => r.rootType === rootType)
        .map((r) => ({ sliceKey: r.key, score: jac(qt, new Set(r.tokens ?? [])), span: r.span ?? 0 }))
        .filter((s) => s.score >= threshold)
        .sort((a, b) => b.score - a.score || a.span - b.span || a.sliceKey.localeCompare(b.sliceKey));
      return scored[0] ? { sliceKey: scored[0].sliceKey, score: scored[0].score } : null;
    };
    say(`  只从 INDEX.yaml 读回切片目录行：${rows.length} 条（金丝雀：应等于 counts.slices=${summary.sliceRows.length}）`);
    const questions = [
      ["Base", "这个生产基地的产线和工序瓶颈在哪"],
      ["Model", "这个电池型号能在哪些基地生产，认证状态如何"],
      ["Order", "销售订单交付受影响了吗"],
      ["Base", "天气怎么样适合钓鱼吗"],
      ["Metric", "经营指标的归因"],
    ];
    let agree = 0;
    for (const [root, qq] of questions) {
      const a = indexOnlyLookup(root, qq);
      const b = idx.lookupReusableByQuestion(descriptors, root, qq);
      const same = JSON.stringify(a) === JSON.stringify(b);
      if (same) agree++;
      say(`  [${same ? "一致" : "差异"}] root=${root} q=${q(qq)}`);
      say(`          只读INDEX → ${a ? `${a.sliceKey} (${a.score.toFixed(4)})` : "null"}`);
      say(`          真实现     → ${b ? `${b.sliceKey} (${b.score.toFixed(4)})` : "null"}`);
    }
    say(`  ⇒ ${agree}/${questions.length} 一致`);
  }

  say("");
  say("═══ 验收 ④ 确定性（R6）：本次产物的逐文件 sha256 ═══");
  const { createHash } = await import("node:crypto");
  const files = [];
  const walkOut = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = path.join(d, e.name); e.isDirectory() ? walkOut(p) : files.push(p); } };
  walkOut(OUT_DIR);
  const h = createHash("sha256");
  for (const f of files) h.update(rel(f)).update(fs.readFileSync(f));
  say(`  文件 ${files.length} 份 · 合并 sha256 = ${h.digest("hex")}`);
  say(`  （复验：再跑一次 extract.mjs，这个 hash 必须逐字节相同）`);
  return R;
}

// ════════════════════════════════════════════════════════════════════════════
const argv = process.argv.slice(2);
const g = await build();
const summary = emit(g);

log("");
log(`原子 ${summary.all.length} · 边 ${edges.length} · 切片 ${summary.sliceRows.length}`);
log(`三态：wired ${summary.byState.wired} · test-only ${summary.byState["test-only"]} · no-ref ${summary.byState["no-ref"]}`);
log(`docSource=none：${summary.docNone}/${summary.all.length} = ${((summary.docNone / summary.all.length) * 100).toFixed(1)}%`);
log(`边种类：${Object.entries(summary.kindCounts).sort().map(([k, v]) => `${k} ${v}`).join(" · ")}`);
log("");
log("── 金丝雀 ─────────────────────────────────────────");
for (const c of g.canaries) log(`  ${c.ok ? "✅" : "❌ 工具坏了"} ${c.probe}: expect ${c.expect}, actual ${c.actual}${c.note ? "  — " + c.note : ""}`);
const bad = g.canaries.filter((c) => !c.ok);
if (bad.length) log(`\n⚠⚠ ${bad.length} 条金丝雀不中 ⇒ 以上任何「零/没有/不存在」结论都**不成立**，先修工具。`);

if (argv.includes("--verify")) await verify(g, summary);
if (argv.includes("--canary")) process.exit(0);
