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
  // ← 坑 ②b（实测踩到）：**不许直接覆盖 options.paths** —— frontend-shell 自己有
  //    `"@/*": ["./src/*"]`，覆盖掉之后它 624 个文件里所有 `@/...` 的 import 全部解析不了，
  //    于是整包读成「没有跨文件引用」。⇒ 先把本包自己的 paths 按 REPO 重新定基，再并上我的。
  //    金丝雀见 runCanaries 的「frontend-shell 内部跨文件引用数」。
  const ownBase = path.resolve(REPO, pkg.root, own.baseUrl ?? ".");
  const rebased = {};
  for (const [k, arr] of Object.entries(own.paths ?? {})) {
    rebased[k] = (arr ?? []).map((t) => path.relative(REPO, path.resolve(ownBase, t)).split(path.sep).join("/"));
  }
  options.baseUrl = REPO;
  options.paths = {
    ...rebased,
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
      noteSideEffects(sf);
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

// 哪些模块**不能 import 求值** —— 顶层有裸调用语句的（`main()` / `app.listen()`）会产生副作用。
// 机器判据，⛔ 不开人工黑名单：黑名单迟早漏掉新入口，语法规则对新文件照样生效。
// 实测必须有这条：apps/datacore/src/server.ts 末尾就是 `main().catch(...)`，import 它会真起服务。
const sideEffectFiles = new Set();
function noteSideEffects(sf) {
  for (const st of sf.statements) {
    if (ts.isExpressionStatement(st)) {
      let e = st.expression;
      if (ts.isAwaitExpression(e)) e = e.expression;
      if (ts.isCallExpression(e) || (ts.isPropertyAccessExpression(e) && ts.isCallExpression(e.expression))) {
        sideEffectFiles.add(rel(sf.fileName));
        return;
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
  // ⚠ 预筛按「标识符文本在导出名集合里」，**别名 import 会整条漏掉**：
  //   `import { globalSimOptimize as runGlobalSimOptimize } from "./portfolio.js"`
  //   之后生产代码调的是 `runGlobalSimOptimize`，那个名字不在导出名集合里 ⇒ 预筛直接丢掉
  //   ⇒ 求解器 globalSimOptimize 被判「零生产调用方 / test-only」，而 service.ts:3552 真在用。
  //   ⇒ 把所有 `X as Y` 的**本地名 Y** 也并进预筛集合。实测全仓 17 处别名 import。
  for (const { program, owned } of ctxs) {
    for (const sf of program.getSourceFiles()) {
      if (!owned.has(rel(sf.fileName))) continue;
      const visit = (n) => {
        if (ts.isImportSpecifier(n) && n.propertyName && ts.isIdentifier(n.name)) exportNames.add(n.name.text);
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
  }
  const byDeclId = new Map();
  for (const a of atoms.values()) if (!a.reexportOf) byDeclId.set(a.id, a);

  for (const { program, checker, owned } of ctxs) {
    for (const sf of program.getSourceFiles()) {
      const fromFile = rel(sf.fileName);
      if (!owned.has(fromFile)) continue;
      const isTest = fromFile.includes("/test/");
      const record = (atom, line) => {
        if (!atom) return;
        const bucket = isTest ? atom.inboundTest : atom.inboundSrc;
        if (!bucket.has(fromFile)) bucket.set(fromFile, line);
      };
      const visit = (node) => {
        // ── 动态 import 解构绑定：`const { mapMcpConfig } = await import("./x.js")` ──
        // 这一形态**标识符走不通**：`mapMcpConfig` 在这里是个 BindingElement 局部符号，
        // getSymbolAtLocation 给的是局部变量，不是被导出的那个原子 ⇒ 恒判「零生产调用方」。
        // 实测代价：apps/agentcore/src/engine.ts:634 这样拿到 mapMcpConfig 并在 :649 真调用，
        // 而图谱把它标成 test-only（假绿检测器的假阳性）。⇒ 经模块类型的属性桥回去。
        if (ts.isVariableDeclaration(node) && node.name && ts.isObjectBindingPattern(node.name) && node.initializer) {
          let init = node.initializer;
          if (ts.isAwaitExpression(init)) init = init.expression;
          if (ts.isCallExpression(init) && init.expression.kind === ts.SyntaxKind.ImportKeyword) {
            try {
              const modType = checker.getTypeAtLocation(node.initializer);
              for (const el of node.name.elements) {
                const propName = (el.propertyName ?? el.name);
                if (!propName || !ts.isIdentifier(propName)) continue;
                let ps = checker.getPropertyOfType(modType, propName.text);
                if (ps && ps.flags & ts.SymbolFlags.Alias) { try { ps = checker.getAliasedSymbol(ps); } catch { /* keep */ } }
                const pd = (ps?.getDeclarations() ?? []).find((x) => kindOfDecl(x));
                if (pd) record(byDeclId.get(atomId(rel(pd.getSourceFile().fileName), ps.getName())), lineOf(propName, sf));
              }
            } catch { /* 解析不了就算了，⛔ 不猜 */ }
          }
        }
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
              if (atom) {
                // 声明点自己那个名字不算引用（`export function foo` 里的 foo）。
                const isOwnName = p && p.name === node && kindOfDecl(p);
                if (!isOwnName) {
                  if (tFile !== fromFile) {
                    record(atom, lineOf(node, sf));
                  } else if (!isTest) {
                    // ⚠ **同文件内的生产使用也是生产使用**。实测：取样的 3 个 test-only 全是这一形态
                    // （defaultAdapterFactory providers.ts:231 · seedWorldCompleteness seed-world.ts:584
                    //  · RefKindSchema refs.ts:22/30/50），三个都在生产代码里真被调用，
                    // 却因为「只看跨文件」被判成「零生产调用方」—— 这是假绿检测器最不该犯的**假阳性**。
                    atom.selfUses = (atom.selfUses ?? 0) + 1;
                    if (atom.selfLine === undefined) atom.selfLine = lineOf(node, sf);
                  }
                }
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
// wired     = 有生产引用（跨文件 src **或同文件内的生产使用**）
// test-only = 只有 test 引用，且同文件内零生产使用 ← 假绿第 9 形态：
//             实现有、测试有、绿的、零生产调用方
// no-ref    = 任何地方都没有引用（含同文件）
// ⚠ 三个计数 srcCount / selfUses / testCount 全部落进产物，谁都能自己重算这个判定。
function stateOf(a) {
  if (a.inboundSrc.size > 0 || (a.selfUses ?? 0) > 0) return "wired";
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
    if (Array.isArray(v)) {
      // 数组元素的「条目名」：字符串元素取自身；对象元素取**第一个字符串值属性**（插入序 ⇒ 确定性）。
      // ⛔ 不用人工列 key/id/solverKey 白名单 —— 白名单迟早漏掉新形状；取不到就退化成 #i，
      //    这样 count 仍然对得上（宁可条目名难看，也不许边数悄悄变成 0）。
      const label = (x, i) => {
        if (typeof x === "string") return x;
        if (x && typeof x === "object") {
          for (const k of Object.keys(x)) if (typeof x[k] === "string" && x[k]) return `${k}=${x[k]}`;
        }
        return `#${i}`;
      };
      return { count: v.length, keys: v.map(label) };
    }
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

/**
 * fieldStats：每个字段在 **src（非 test）** 对象字面量里被赋的值有多长。
 * ⚠ 精确定义（别当成别的东西）：只统计**字面量**赋值，`x: "abc"` 记字符串长度 3，
 * `x: [1,2,3]` 记数组元素数 3。变量/函数调用赋的值一律**不计**（静态看不见它的长度）。
 * 两类分开报（`strLen` / `arrLen`）—— 把字符串长度和数组长度混进一个分布是拿一个数盖两个事实。
 */
function collectFieldStats(ctxs, fields) {
  const acc = new Map();   // field -> {str:[], arr:[]}
  const bump = (f, k, v) => {
    if (!acc.has(f)) acc.set(f, { str: [], arr: [] });
    acc.get(f)[k].push(v);
  };
  for (const { program, owned } of ctxs) {
    for (const sf of program.getSourceFiles()) {
      const f = rel(sf.fileName);
      if (!owned.has(f) || f.includes("/test/")) continue;
      const visit = (n) => {
        if (ts.isObjectLiteralExpression(n)) {
          for (const p of n.properties) {
            if (!ts.isPropertyAssignment(p) || !p.name) continue;
            if (!(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) continue;
            const key = p.name.text;
            if (!fields.has(key)) continue;
            const v = p.initializer;
            if (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) bump(key, "str", v.text.length);
            else if (ts.isArrayLiteralExpression(v)) bump(key, "arr", v.elements.length);
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
  }
  const pct = (a, q) => (a.length === 0 ? null : a[Math.min(a.length - 1, Math.floor(a.length * q))]);
  const rows = [];
  for (const [field, v] of [...acc.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    v.str.sort((a, b) => a - b); v.arr.sort((a, b) => a - b);
    const row = { field };
    if (v.str.length) row.strLen = { n: v.str.length, p50: pct(v.str, 0.5), p90: pct(v.str, 0.9), max: v.str[v.str.length - 1] };
    if (v.arr.length) row.arrLen = { n: v.arr.length, p50: pct(v.arr, 0.5), p90: pct(v.arr, 0.9), max: v.arr[v.arr.length - 1] };
    if (row.strLen || row.arrLen) rows.push(row);
  }
  return rows;
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

  // ④b 包内 `@/*` 别名可解析（坑 ②b：覆盖掉本包 paths 时 frontend-shell 内部引用恒 0
  //     ⇒「前端 624 个文件全是死代码」。实测就踩过一次，是逐条手工复核才发现的）
  const feInternal = [...atoms.values()].filter((a) => a.pkg === "frontend-shell" &&
    [...a.inboundSrc.keys()].some((f) => f.startsWith("apps/frontend-shell/"))).length;
  add("frontend-shell 内部跨文件引用数", ">0", feInternal, feInternal > 0,
      "为 0 ⇒ `@/*` 别名没解析（本包 paths 被覆盖），不是前端全是死代码");
  const knownAlias = A("sym:apps/frontend-shell/src/views/sim/console/SandboxDetail.tsx#NodeDetailProvenance");
  const ka = knownAlias ? knownAlias.inboundTest.size + knownAlias.inboundSrc.size + (knownAlias.selfUses ?? 0) : -1;
  add("已知经 `@/` 别名被测试引用的符号（NodeDetailProvenance）", ">0", ka, ka > 0,
      "出处：apps/frontend-shell/test/sim-honest-fallback-b.test.tsx:168/179/206 三处类型位使用");

  // ④c 动态 import 解构绑定可见（标识符路走不通的那一形态）
  const dyn = A("sym:apps/agentcore/src/dsh-runtime/setup-spec.ts#mapMcpConfig");
  const dynN = dyn ? dyn.inboundSrc.size : -1;
  add("已知只经 `await import()` 解构拿到的符号（mapMcpConfig）src 入边", ">0", dynN, dynN > 0,
      "出处：apps/agentcore/src/engine.ts:634 解构 → :649 真调用；为 0 ⇒ 动态 import 桥断了");

  // ④d 别名 import 可见（预筛按名字时最容易整条漏掉的一类）
  const ali = A("sym:apps/datacore/src/solvers/portfolio.ts#globalSimOptimize");
  const aliN = ali ? ali.inboundSrc.size : -1;
  add("已知经别名 import 被调用的符号（globalSimOptimize）src 入边", ">0", aliN, aliN > 0,
      "出处：apps/datacore/src/solvers/service.ts:42 `globalSimOptimize as runGlobalSimOptimize` → :3552 真调用");

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
  // ⑧ 求值确实比 AST 强 —— 拿一个 AST 数不出来、求值数得出的注册表当证据。
  //    没有这一条，「求值和 AST 总是一致」就无法与「求值根本没起作用」区分开。
  const uncE = edges.filter((e) => e.kind === "registers" && e.confidence === "evaluated-uncountable");
  add("AST 数不出、靠求值拿到的 registers 边", ">0", uncE.length, uncE.length > 0,
      "为 0 ⇒ 求值这一步没有鉴别力，「AST 与求值一致」就不构成证据");
  // ⑨ 验收 ① 本身机器化：每个可求值注册表的 registers 边数必须 == 真数组 .length。
  //    （上一版这里悄悄漏了：对象数组求值出 63，边却发了 0 条 —— count 对、边空，屏上看不出来。）
  const regAll = [...atoms.values()].filter((a) => a.registry?.evaluatedCount !== null && a.registry);
  const byFrom = new Map();
  for (const e of edges) if (e.kind === "registers") byFrom.set(e.from, (byFrom.get(e.from) ?? 0) + 1);
  const offenders = regAll.filter((a) => (byFrom.get(a.id) ?? 0) !== a.registry.evaluatedCount);
  add("registers 边数 == 真数组 .length 的注册表", `${regAll.length}/${regAll.length}`,
      `${regAll.length - offenders.length}/${regAll.length}`, offenders.length === 0,
      offenders.length ? `不符：${offenders.slice(0, 5).map((a) => `${a.name}(边${byFrom.get(a.id) ?? 0}≠值${a.registry.evaluatedCount})`).join(", ")}` : undefined);

  // ⑩ 盲区 dims 必须全在枚举里（消费方按 dims 匹配；写错一个词它就静默匹配不上）
  const DIMS = new Set(["COUNT", "NOREF", "EMPTYFILE", "COORD", "LENGTH"]);
  const badDims = BLIND_SPOTS.filter((b) => !b.dims.length || b.dims.some((d) => !DIMS.has(d)));
  add("blindSpots 的 dims 全在枚举内且非空", "0 条越界", `${badDims.length} 条越界`, badDims.length === 0,
      badDims.length ? `越界：${badDims.map((b) => b.id).join(", ")}` : undefined);
  const covered = new Set(BLIND_SPOTS.flatMap((b) => b.dims));
  add("五类对账维度都至少有一条盲区", "5/5", `${covered.size}/5`, covered.size === DIMS.size,
      "少一类 ⇒ 消费方在那一维上拿不到任何自认盲区，会误以为该维无风险");

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
  // ⚠ 这条边**必须来自真数组的求值**（派单硬要求）。三种结局，三种 confidence，不许混：
  //   evaluated               AST 数得出 && dist 求值一致
  //   evaluated-mismatch      两者不一致 ⇒ **以求值为准**，并把两个数都留在产物里
  //   evaluated-uncountable   AST **数不出来**（展开 / 计算键 / Object.keys(...)），但求值得出
  //                           ← 这一档就是「求解器 60/62/63」那个病的真身：
  //                             ALL_SOLVER_CATALOG = [...A,...B,...C] 按 AST 数是 0，求值是 63。
  //   parsed                  只有 AST（该包没 build）⇒ **不可信**，产物里明写
  let evaluated = 0, parsedOnly = 0, uncountable = 0, mismatch = 0;
  const SCREAMING = /^[A-Z][A-Z0-9_]{2,}$/;
  for (const a of [...atoms.values()].sort((x, y) => x.id.localeCompare(y.id))) {
    const entries = registryEntriesOf(a.decl);
    const evalable = a.kind === "const" && !a.reexportOf && !sideEffectFiles.has(a.file);
    let real = null;
    if (entries) real = evalable ? await evalFromDist(a.file, a.name) : null;
    else if (evalable && SCREAMING.test(a.name)) {
      // AST 数不出来的注册表：只对 SCREAMING_SNAKE 命名的常量试求值（注册表命名约定，机器判）
      const r = await evalFromDist(a.file, a.name);
      if (r && r.count >= REGISTRY_MIN) real = r;
    }
    if (!entries && !real) continue;
    let confidence, list;
    if (!entries) { confidence = "evaluated-uncountable"; list = real.keys ?? []; uncountable++; }
    else if (!real) { confidence = "parsed"; list = entries; parsedOnly++; }
    else if (real.count === entries.length) { confidence = "evaluated"; list = real.keys ?? entries; evaluated++; }
    else { confidence = "evaluated-mismatch"; list = real.keys ?? entries; mismatch++; }
    a.registry = { parsedCount: entries ? entries.length : null, evaluatedCount: real?.count ?? null, confidence };
    for (const e of list) pushEdge({ kind: "registers", from: a.id, to: `entry:${e}`, confidence, pkg: a.pkg });
  }
  log(`  注册表 evaluated ${evaluated} · evaluated-uncountable ${uncountable} · mismatch ${mismatch} · parsed-only ${parsedOnly}`);
  log(`  （顶层有副作用、拒绝 import 求值的模块：${sideEffectFiles.size} 个）`);

  log("── seeds / asserts / fieldStats ───────────────────");
  collectSeeds(ctxs, declaredFields);
  collectAsserts(ctxs, declaredFields);
  const fieldStats = collectFieldStats(ctxs, declaredFields);
  log(`  fieldStats ${fieldStats.length} 个字段有字面量赋值观测`);

  // 注册表清单（给消费方当真值表用；parsed 一律标不可信）
  const registries = [...atoms.values()].filter((a) => a.registry)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((a) => ({
      name: a.name, file: a.file, line: a.line,
      parsedCount: a.registry.parsedCount, evaluatedCount: a.registry.evaluatedCount,
      confidence: a.registry.confidence,
      trustworthy: a.registry.confidence !== "parsed",
      entries: edges.filter((e) => e.kind === "registers" && e.from === a.id).length,
    }));
  log(`  registries ${registries.length}（可信 ${registries.filter((r) => r.trustworthy).length}）`);

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

  const g = { ctxs, sliceInfo, inSliceBySlice, inSliceCount, declaredFields, fieldStats, registries };
  g.canaries = runCanaries(g);
  log(`── 总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s · 峰值 RSS ${(process.memoryUsage().rss / 1e6).toFixed(0)}MB ──`);
  return g;
}

function commitHash() {
  try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO }).toString().trim(); }
  catch { return "unknown"; }
}

// ════════════════════════════════════════════════════════════════════════════
// 盲区清单（机器可读）· 消费方靠 dims 判「这条结论可不可信」，⛔ 不许去撞 text 的关键词
//   —— WO-ONTOGRAPH-CONSUME 实测：散文「引用图看不见 re-export」本意是 NOREF，
//      被关键词撞到 EMPTYFILE 上，给一条本来可信的结论错扣了「自认盲区」。
//      **散文只配说「疑似」；判定必须落在 dims 这个枚举上。**
// 维度枚举（五类对账维度，消费方按这个匹配）：
//   COUNT     计数类结论（有几个 X）
//   NOREF     零调用方 / 死代码 / 没接线类结论
//   EMPTYFILE 空文件 / 该处无内容类结论
//   COORD     坐标类结论（file:line 指到哪）
//   LENGTH    长度 / 分布类结论
// ════════════════════════════════════════════════════════════════════════════
const BLIND_SPOTS = [
  { id: "structural-type-use", dims: ["NOREF", "COUNT"],
    text: "interface/type 可被结构匹配使用而名字从不出现 ⇒ no-ref 的 type/interface 不等于没被用。" },
  { id: "string-key-dispatch", dims: ["NOREF"],
    text: "字符串键分发 / 事件订阅 / DI 容器：运行时按名字派发的调用，静态一条都看不见。" },
  { id: "higher-order-trigger", dims: ["NOREF", "COUNT"],
    text: "高阶函数只见「被传进去」不见「何时真触发」⇒ 答不了「接了线没数据」这一态，只有 seeds 边能侧面答。" },
  { id: "transitive-liveness", dims: ["NOREF"],
    text: "不做传递性存活：只被另一个死符号引用的符号仍读作 wired（如 SimRunDisclosureSchema 只被自己的 z.infer 用）。" },
  { id: "import-plumbing-not-edge", dims: ["NOREF"],
    text: "import/export 说明符与 re-export 转手**有意不发 calls 边**（那是管道不是使用）；命名空间成员访问（import * as ns 后的 ns.foo）同样不发边（本仓今天 import * as 实测 0 处）。" },
  { id: "non-ts-surfaces", dims: ["COUNT", "COORD", "EMPTYFILE"],
    text: "非 TS 出口整体不在图里：packages/dsh-harness（vendored .mjs，无 src/）、SQL migrations、nginx/docker-compose、YAML 配置。对这些位置的任何结论本图谱都无发言权。" },
  { id: "runtime-gating", dims: ["NOREF"],
    text: "feature flag / entitlement 关掉的分支，图上仍是 wired。" },
  { id: "docsource-jsdoc-only", dims: ["COUNT"],
    text: "docSource 只认 /** */；`//` 行注释一律记 none ⇒ 「没有自述」的计数偏高，不等于没有注释。" },
  { id: "brief-truncated-300", dims: ["LENGTH"],
    text: "brief 截断到 300 字符 ⇒ 不可用于任何「描述有多长」的长度结论。" },
  { id: "inbound-samples-capped-25", dims: ["COORD"],
    text: "inbound.src/test 的**样例**封顶 25 条；srcCount/selfUses/testCount 是**全量、从不截断** ⇒ 计数可信，坐标清单可能不全。" },
  { id: "inslice-string-literal-only", dims: ["COUNT", "NOREF"],
    text: "inSlice 判据是原子声明里以字符串字面量出现某 spannedType ⇒ 用变量拼出来的类型键看不见，切片成员数偏低。" },
  { id: "sideeffect-modules-not-evaluated", dims: ["COUNT"],
    text: "顶层有裸调用语句的模块（如 server.ts 末尾 main()）拒绝 import 求值 ⇒ 其中的注册表只有 parsed 计数，不可信。" },
  { id: "fieldstats-literals-only", dims: ["LENGTH", "COUNT"],
    text: "fieldStats 只统计字面量赋值（x:\"abc\" 记 3、x:[1,2,3] 记 3）；变量/函数调用赋的值不计 ⇒ n 偏低，不能当「该字段出现次数」用。" },
  { id: "fieldstats-distinctive-only", dims: ["LENGTH", "COUNT"],
    text: "fieldStats / seeds / asserts 只覆盖**有鉴别力的字段**（被 ≤3 个 schema 声明）；id/name/key 这类被 400+ schema 声明的字段整批不在清单里，缺席不等于没有数据。" },
];

const INBOUND_CAP = 25;
const cap = (arr) => (arr.length <= INBOUND_CAP ? arr : arr.slice(0, INBOUND_CAP));

function emit(g) {
  // ⛔ 只清生成物，**不许整目录 rm** —— README.md 是手写的，整目录删会把它一起干掉。
  // （第一版就是 rmSync(OUT_DIR)，写完 README 跑第二次才会发现它没了。）
  for (const sub of ["atoms", "slices"]) fs.rmSync(path.join(OUT_DIR, sub), { recursive: true, force: true });
  fs.rmSync(path.join(OUT_DIR, "INDEX.yaml"), { force: true });
  fs.mkdirSync(path.join(OUT_DIR, "atoms"), { recursive: true });
  fs.mkdirSync(path.join(OUT_DIR, "slices"), { recursive: true });

  const all = [...atoms.values()].sort((a, b) => a.id.localeCompare(b.id));
  const byState = { wired: 0, "test-only": 0, "no-ref": 0 };
  // ⚠ 两套口径并列，**不许只给一个数** —— 只给一个等于拿一个数盖住两个不同事实
  //   （铁律 0.5 第 ① 条自己犯过的病：把 dependsOn 与 references 合成一句）。
  //   两者差 2396 个原子，差在「只在自己文件里被用」的那批。
  const byStateStrict = { wired: 0, "test-only": 0, "no-ref": 0 };
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
      // 严格跨文件口径：**忽略 selfUses**，只看跨文件引用
      byStateStrict[a.inboundSrc.size > 0 ? "wired" : a.inboundTest.size > 0 ? "test-only" : "no-ref"]++;
      return {
        id: a.id, name: a.name, kind: a.kind, file: a.file, line: a.line,
        brief: a.brief || "", docSource: a.brief ? "jsdoc" : "none",
        tags: a.tags, wo: a.wo, state: st, reexportOf: a.reexportOf,
        ...(a.registry ? { registry: a.registry } : {}),
        ...(sliceOfAtom.has(a.id) ? { slices: sliceOfAtom.get(a.id).slice().sort() } : {}),
        inbound: {
          // 计数是**全量**（state 就是从它判的）；样例封顶 INBOUND_CAP 条，只为体积。
          // ⚠ 封顶只截样例、⛔ 绝不截计数 —— 截了计数就等于把「有多少人在用」改成「我列了几条」。
          srcCount: a.inboundSrc.size, selfUses: a.selfUses ?? 0, selfLine: a.selfLine ?? null,
          testCount: a.inboundTest.size,
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
      byEdgeKind: kindCounts,
      docSourceNone: docNone,
      docSourceNonePct: all.length ? Number(((docNone / all.length) * 100).toFixed(2)) : 0,
    })}`,
    `# ⚠ 三态有**两套口径**，差 ${Math.abs(byState.wired - byStateStrict.wired)} 个原子（差在「只在自己文件里被用」那批）。`,
    `# ⛔ 引用时必须说清用的是哪一套 —— 只报一个数等于拿一个数盖住两个不同事实。`,
    `byState:`,
    `  includingSelfFileUse:`,
    `    question: ${q("这个符号有没有生产代码在用？（跨文件 src 或同文件内的生产使用都算）")}`,
    `    useFor: ${q("找真死代码、找假绿第 9 形态（实现有·测试有·绿的·零生产调用方）。假阳性代价高的场合用这套。")}`,
    `    counts: ${yv(byState)}`,
    `  strictCrossFile:`,
    `    question: ${q("这个符号有没有**别的文件**在用？（忽略同文件内的使用）")}`,
    `    useFor: ${q("找「导出了但没人跨文件用」的过度导出面 —— 这批可以降成文件内私有。")}`,
    `    counts: ${yv(byStateStrict)}`,
    `canary:`,
    yBlockList(g.canaries),
    `# 盲区（机器可读）：消费方按 dims 判「这条结论可不可信」，⛔ 不许去撞 text 的关键词。`,
    `# dims 枚举：COUNT 计数 · NOREF 零调用方 · EMPTYFILE 空文件 · COORD 坐标 · LENGTH 长度分布`,
    `blindSpotDims: ["COUNT", "NOREF", "EMPTYFILE", "COORD", "LENGTH"]`,
    `blindSpots:`,
    yBlockList(BLIND_SPOTS),
    `# 注册表真值：confidence=parsed 的一律不可信（那个包没 build，只有 AST 数）。`,
    `registries:`,
    g.registries.length ? yBlockList(g.registries) : "  []",
    `# 字段长度分布：只统计**字面量**赋值（x:"abc"→3 / x:[1,2,3]→3），变量与函数调用赋值不计。`,
    `# 覆盖面 = 有鉴别力的字段（被 ≤3 个 schema 声明）。缺席 ≠ 没有数据，见 blindSpots。`,
    `fieldStats:`,
    g.fieldStats.length ? yBlockList(g.fieldStats) : "  []",
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
  const mism = regs.filter((a) => a.registry.evaluatedCount !== null && a.registry.parsedCount !== null && a.registry.evaluatedCount !== a.registry.parsedCount);
  const unc = regs.filter((a) => a.registry.confidence === "evaluated-uncountable");
  say(`  注册表候选 ${regs.length} 个；其中 dist 可求值 ${regs.filter((a) => a.registry.evaluatedCount !== null).length} 个`);
  say(`  ⚠ AST **数不出来**、只能靠求值的：${unc.length} 个 —— 这一档若没有求值，registers 边会是 0 条（而不是报错）：`);
  for (const a of unc) {
    const edgeN = edges.filter((e) => e.kind === "registers" && e.from === a.id).length;
    say(`     ${a.name.padEnd(30)} AST解析= 数不出   真求值=${String(a.registry.evaluatedCount).padStart(4)}  registers边=${String(edgeN).padStart(4)}   ${a.file}:${a.line}`);
  }
  say(`  ── 逐条对照（前 40） ──`);
  for (const a of regs.slice(0, 40)) {
    const edgeN = edges.filter((e) => e.kind === "registers" && e.from === a.id).length;
    say(`  ${a.name.padEnd(28)} AST解析=${String(a.registry.parsedCount).padStart(4)}  真求值=${String(a.registry.evaluatedCount ?? "n/a").padStart(4)}  registers边=${String(edgeN).padStart(4)}  ${a.registry.confidence}${a.registry.evaluatedCount !== null && a.registry.evaluatedCount !== a.registry.parsedCount ? "   ⚠ 不一致" : ""}`);
  }
  say(`  ⇒ AST 与真求值不一致的注册表：${mism.length} 个${mism.length ? "（" + mism.map((a) => a.name).join(", ") + "）" : ""}`);
  // 对照：天真 grep 数法 vs 真求值 —— 这就是「求解器 60 / 62 / 63」那次的三个数。
  const solverKeys = atoms.get("sym:apps/datacore/src/solvers/service.ts#SOLVER_KEYS");
  if (solverKeys) {
    const src = fs.readFileSync(path.join(REPO, solverKeys.file), "utf8").split("\n");
    const declLine = solverKeys.line - 1;
    let end = declLine; while (end < src.length && !/^\] as const;/.test(src[end])) end++;
    const block = src.slice(declLine, end + 1);
    const naive = block.filter((l) => /^\s*"[a-z0-9_]+",\s*$/.test(l)).length;
    const withComments = block.filter((l) => /"[a-z0-9_]+"/.test(l)).length;
    say(`  ── 对照实验：SOLVER_KEYS 到底几条 ──`);
    say(`     天真 grep（任何含 "xxx" 的行）        = ${withComments}   ← 把注释里的串也数进去`);
    say(`     稍好的正则（只认整行 "xxx",）          = ${naive}`);
    say(`     本抽取器 AST 解析                      = ${solverKeys.registry.parsedCount}`);
    say(`     import dist 真求值 .length             = ${solverKeys.registry.evaluatedCount}   ← 唯一可信的那个`);
  }

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
    // ⚠ 问句集必须有**鉴别力**：若全部返回 null，一个「恒返回 null」的坏实现也会 100% 一致。
    // 故：① 每条切片用它自己的 brief 当问句（必然命中，且 47 条切片各命中各的）
    //     ② 三条对抗问句（必然不命中）③ 几条真人口吻的问句。
    const questions = [
      ...descriptors.map((d) => [d.rootType, d.description, "自描述"]),
      ["Model", "这个电池型号能在哪些基地生产，认证状态如何", "真人口吻"],
      ["Base", "生产基地 车间 产线", "真人口吻"],
      ["Order", "销售订单 电池型号", "真人口吻"],
      ["Base", "天气怎么样适合钓鱼吗", "对抗"],
      ["Base", "aaaaa bbbbb ccccc", "对抗"],
      ["NoSuchType", "生产基地 车间 产线", "对抗·不存在的 rootType"],
    ];
    let agree = 0, hits = 0, distinct = new Set(), shown = 0;
    for (const [root, qq, tag] of questions) {
      const a = indexOnlyLookup(root, qq);
      const b = idx.lookupReusableByQuestion(descriptors, root, qq);
      const same = JSON.stringify(a) === JSON.stringify(b);
      if (same) agree++;
      if (b) { hits++; distinct.add(b.sliceKey); }
      // 全打 53 行太长：自描述那批只打不一致的，其余全打。
      if (!same || tag !== "自描述" || shown < 2) {
        shown++;
        say(`  [${same ? "一致" : "❌差异"}] (${tag}) root=${root} q=${q(qq.length > 46 ? qq.slice(0, 46) + "…" : qq)}`);
        say(`          只读INDEX → ${a ? `${a.sliceKey} (${a.score.toFixed(4)})` : "null"}`);
        say(`          真实现     → ${b ? `${b.sliceKey} (${b.score.toFixed(4)})` : "null"}`);
      }
    }
    say(`  ⇒ ${agree}/${questions.length} 一致`);
    say(`  ⇒ 鉴别力金丝雀：非 null 命中 ${hits}/${questions.length} 次，落在 ${distinct.size} 条不同切片上`);
    say(`     （若命中数为 0，则「全部一致」不构成证据 —— 恒 null 的坏实现也会全一致）`);
  }

  say("");
  say("═══ 验收 ④ 确定性（R6）：本次产物的逐文件 sha256 ═══");
  const { createHash } = await import("node:crypto");
  const files = [];
  // 只 hash **生成物**；README.md 是手写的，不该进确定性判据。
  const walkOut = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = path.join(d, e.name); if (e.isDirectory()) walkOut(p); else if (e.name !== "README.md") files.push(p); } };
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
