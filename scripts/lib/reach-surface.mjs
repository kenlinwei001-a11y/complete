/**
 * ══ 门的「实际射程」抽取器 · G-GATE-SCOPE-MISSES-SUBJECT 的普查器 ═════════════════
 *
 * ── 它治什么 ──────────────────────────────────────────────────────────────────
 * 一道门 RC=0、金丝雀全中，**同时**可以 100% 漏检 —— 金丝雀只证明检测逻辑活着，
 * 一个字都不说**扫描面**选没选对（2026-08-17 实测：`dev-jargon:check` 6/6 全中 +
 * 漏掉屏上文案真正住的 `locales/zh.ts`；扩射程后同一份旧代码 10 条 → 135 条）。
 * 形态（CLAUDE.md 铁律 0.6 句式）：
 *   **「我用『门 RC=0 且金丝雀全中』当作『被守的那件事没出问题』的证据，
 *      而前者并不度量后者 —— 射程里有没有被检测对象，金丝雀结构上无从知道。」**
 *
 * 本库做的事：对每道门现算两列，再算差集 —
 *   · **声称**（claimed）：`scripts/gate-ledger.json` 里该门的 `guardedPaths`；
 *   · **实际**（actual） ：读本门源码 AST 抽出来的扫描面（本库 `extractSurface`）。
 * 差集两个方向都要：
 *   · 声称 ⊄ 实际 = **射程缺口候选**（台账说它守 X，实现根本不读 X）；
 *   · 实际 ⊄ 声称 = **台账欠账候选**（实现在守 Y，台账没写 —— 门红时没人知道该找谁）。
 * 两个方向都是**候选**：差集条目一律落 `scripts/gate-reach-baseline.json` 由人定性
 * （真缺口 / 责任指针 / 抽取器边界），机器不定性 —— 拿写法猜语义是铁律 0.6 点名的病。
 *
 * ── 为什么是 AST 不是正则（踩过的坑，不许退回）──────────────────────────────
 * 第一版用正则 + 剥注释 + 抹模板串三件套，死在词法层：正则字面量里一个反引号
 * （`/systemPrompt:\s*`针对…/`，check-bstack-derive.mjs:42 实物）被抹串器当成模板串起点，
 * 其后的真代码全被吞 ⇒ 漏抽；而金丝雀样例里的假路径（`packages/canary`，
 * dist-freshness.mjs 实物）又被当真射程抽进来，23 道 import 它的门全部继承。
 * **词法问题只能用词法器解** —— 故本库走 TypeScript 编译器 API（与
 * `check-gate-exit-discipline.mjs` 同一个解析器，由调用方注入，本库保持纯函数）。
 * AST 天然免疫这两类：注释不进树；模板串文本里的引号不是 StringLiteral 节点。
 *
 * ── 抽取什么（位置纪律）──────────────────────────────────────────────────────
 * 只从这些**语法位置**抽路径字面量，其余（报错文案/散文）一律不算：
 *   ① 顶层常量声明（标量 / 数组 / 对象 / `new Set`，含 `??` 回退的右值字面量）；
 *   ② 调用位：`readFileSync/readdirSync/existsSync/…` 与**任意**读取助手
 *      （`read("apps/…")` / `new URL("apps/…", root)` 都是本仓实物形状）的字符串实参；
 *   ③ `join(ROOT|root|<已知仓根常量>, "a", "b")` 多段拼接（含混段 ⇒ `**` glob）；
 *   ④ 枚举仓根：`readdirSync(ROOT)` / `walk(ROOT, …)` / git 子进程 / for-of 顶层目录数组；
 *   ⑤ 模板串拼路径的静态前缀：`apps/frontend-shell/src/views/${key}.tsx`；
 *   ⑥ 读自己：`readFileSync(fileURLToPath(import.meta.url))`；⑦ 本地 `import "./x.mjs"`。
 * 被 import 的本地模块射程由**门**追一层并入（本库不管跨文件）。
 *
 * ── dist↔src 桥 ─────────────────────────────────────────────────────────────
 * 本仓一族门**读的是构建产物**（`apps/X/dist/Y.js`），台账写的是被守源码
 * （`apps/X/src/Y.ts`）—— 两者经 `assertDistFresh` / `dist-freshness:check` 锁同源，
 * 通道差不是射程缺口。桥只做**同包同相对路径**的 .ts↔.js 映射，跨包/改名一概不猜。
 *
 * ── 诚实边界（不许读成「全仓射程已对齐」）────────────────────────────────────
 *  · 本库抽的是**源码里写得出的**扫描面。靠环境变量 / 运行时参数 / HTTP 响应 /
 *    子进程输出决定的读取，本库看不见 —— 看不见 ⇒ 差集**候选**，由人定性，不是「没有」。
 *  · 「实际 ⊇ 声称」成立**不证明**门真检查了那些内容 —— 只证明它读了那些文件；
 *    读没读到**该看的那几行**，是各门自己的判据课。
 *  · 扩展名关联按**常量粒度**（同一常量里的 `.tsx` 元素算作该常量路径元素的过滤），
 *    对「同一常量里多个目录各有不同 exts」的门会多算一点覆盖；凡差集落账的条目
 *    都经人眼复核，不许拿这一条当消红通道。
 *
 * 本文件是**纯函数库**：不读文件、不 `process.exit`、无顶层副作用。
 * `ts`（typescript 编译器 API）由调用方注入 —— 缺 typescript 是「工具坏了」（RC=2），
 * 不是本库该悄悄降级成正则的理由（退回正则 = 把上面两类坑请回来）。
 */

import { PATHISH_RE } from "./roster-hardcode.mjs";

/** 文件系统读取/写入调用名。 */
export const FS_CALLS = new Set([
  "readFileSync", "readdirSync", "existsSync", "statSync", "lstatSync",
  "writeFileSync", "readFile", "readdir", "stat", "cpSync", "rmSync",
]);

const EXT_RE = /^\.[a-z0-9]{1,6}$/i;
const TOP_DIR_RE = /^(?:apps|packages|scripts|docs|deploy|db-seed|services|\.github)$/;
const ROOT_FILE_RE = /^(?:package\.json|pnpm-[\w.]+|tsconfig[\w.-]*\.json|docker-compose\.yml|THIRD-PARTY-NOTICES\.md)$/;

function kindOf(p) {
  if (p.includes("*")) return "glob";
  if (/\.[a-z0-9]+$/i.test(p)) return "file";
  return "dir";
}

/**
 * 从一份门源码抽出**实际射程**。
 * @param {string} src 门源码原文
 * @param {string} via 来源标注（门文件名或 lib 名）
 * @param {object} ts TypeScript 编译器 API（调用方注入）
 * @returns {Array<{path:string,kind:"dir"|"file"|"glob",exts:string[]|null,via:string,origin:string}>}
 */
export function extractSurface(src, via = "?", ts) {
  if (!ts) throw new Error("extractSurface 需要注入 typescript（缺它是「工具坏了」，不许降级正则）");
  const sf = ts.createSourceFile(via, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const out = [];
  const push = (path, origin, exts = null, loose = false) => {
    path = (path || "").replace(/\/+$/, "");
    const ok = PATHISH_RE.test(path) || TOP_DIR_RE.test(path) || ROOT_FILE_RE.test(path) ||
      // 混段 join 产物：`**/package.json` 这类「首段不可知、尾段是仓根文件」的 glob
      (path.includes("*") && ROOT_FILE_RE.test(path.split("/").pop() || "")) ||
      (loose && /^[A-Za-z][\w.-]*\.[a-z0-9]{1,8}$/i.test(path) && path.length <= 60);
    if (!path || !ok) return;
    out.push({ path, kind: kindOf(path), exts, via, origin });
  };

  /* ── 第一趟：收集「仓根派生的目录常量」 const X = join(ROOT, "a", "b") ──────── */
  const rootVars = new Map(); // 变量名 -> 仓内相对路径
  // 本文件导出的标识符。② 号位（任意调用名的字符串实参）要跳过「调本文件自己导出的函数」：
  // 那是库的**自测/内部复用**（reachCanary 里 covered("apps/x", …) 的样例实参被当射程，
  // 本单实测污染 4 条差集），不是读文件。门的局部读取助手（read/abs）从不导出，不受影响。
  const exportedNames = new Set();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      exportedNames.add(st.name.text);
    }
    if (ts.isVariableStatement(st) && st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) exportedNames.add(d.name.text);
    }
    if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) exportedNames.add((el.propertyName ?? el.name).text);
    }
  }
  const literalArgsOf = (call) => {
    const segs = [];
    for (const a of call.arguments.slice(1)) {
      if (!ts.isStringLiteralLike(a)) return null;
      segs.push(a.text);
    }
    return segs;
  };
  const joinBaseOf = (call) => {
    if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || call.expression.text !== "join") return null;
    const a0 = call.arguments[0];
    if (!a0 || !ts.isIdentifier(a0)) return null;
    if (a0.text === "ROOT" || a0.text === "root") return "";
    return rootVars.has(a0.text) ? rootVars.get(a0.text) : null;
  };
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !d.initializer || !ts.isCallExpression(d.initializer)) continue;
      const init = d.initializer;
      if (!ts.isIdentifier(init.expression) || init.expression.text !== "join") continue;
      const a0 = init.arguments[0];
      if (!a0 || !ts.isIdentifier(a0) || (a0.text !== "ROOT" && a0.text !== "root")) continue;
      const segs = literalArgsOf(init);
      if (segs) rootVars.set(d.name.text, segs.join("/"));
    }
  }

  /* ── 第二趟：主抽取 ──────────────────────────────────────────────────────── */
  const topLevel = new Set(sf.statements);

  // ⑦ 本地 import 的解析基准：**相对于 import 者自己的目录**（lib/feature-defaults.mjs
  //    import "./source-lex.mjs" = scripts/lib/source-lex.mjs，不是 scripts/source-lex.mjs）。
  const importDir = via.includes("/") ? via.slice(0, via.lastIndexOf("/")) : "";
  const resolveLocalImport = (spec) => {
    const parts = `scripts/${importDir ? importDir + "/" : ""}${spec}`.split("/");
    const norm = [];
    for (const seg of parts) {
      if (seg === "." || seg === "") continue;
      if (seg === "..") norm.pop();
      else norm.push(seg);
    }
    const p = norm.join("/");
    return p.startsWith("scripts/") ? p : null;
  };

  // ① 顶层常量声明里的路径字面量（标量 / 集合 / ?? 回退右值）
  // 排除名含 canary 的常量：CANARIES 数组装的是**金丝雀样例**（按铁律 0.6 必须取生产
  // 实物形状，所以里面的路径串个个长成真射程），不是扫描面 —— dsh-dormancy 的
  // CANARIES 实测污染（样例里的 apps/datacore/src/environment.ts 被当射程补登进台账，
  // ledger 门判「指向空气」抖出这个类）。形态判据（常量名），不是文件白名单。
  const CANARY_CONST_RE = /canar/i;
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!d.initializer) continue;
      if (ts.isIdentifier(d.name) && CANARY_CONST_RE.test(d.name.text)) continue;
      const strings = [];
      const exts = [];
      const visit = (n) => {
        if (ts.isStringLiteralLike(n)) {
          if (EXT_RE.test(n.text)) exts.push(n.text);
          else strings.push(n.text);
        } else if (
          (ts.isCallExpression(n) || ts.isNewExpression(n)) &&
          ((ts.isIdentifier(n.expression) && exportedNames.has(n.expression.text)) ||
            (ts.isPropertyAccessExpression(n.expression) && !FS_CALLS.has(n.expression.name.text)))
        ) {
          // 不下降进两类调用的实参：① 调本文件**自己导出**的函数（自测/内部复用，实参是样例
          // 不是声明的扫描面 —— reachCanary 的 `const hit = covered("apps/x", …)` 实测污染）；
          // ② 字符串/数组**方法调用**（`const miss = s.some(e => e.path.startsWith("packages/canary"))`
          // 实测污染）—— `fs.readFileSync` 这类 FS_CALLS 方法位除外。
        } else if (!ts.isTemplateExpression(n) && !ts.isTaggedTemplateExpression(n)) {
          // 模板串里的引号是文本不是节点，天然不进；但模板**头部**静态前缀另走 ⑤
          n.forEachChild(visit);
        }
      };
      visit(d.initializer);
      for (const s of strings) push(s, `const ${ts.isIdentifier(d.name) ? d.name.text : "?"}`, exts.length ? exts : null);
    }
  }

  const isRootIdent = (n) => n && ts.isIdentifier(n) && (n.text === "ROOT" || n.text === "root" || rootVars.has(n.text));

  // 金丝雀/断言包装器调用栈：expect("…", !isProtected("docs/x.bak")) 里嵌套的助手调用，
  // 其字符串实参是**测试样例输入**不是射程（check-file-truncation.mjs 金丝雀实物形状 ——
  // 本单 M3 放宽后它被补登进台账，ledger 门当场判「guardedPaths 指向空气」抖出这个污染类）。
  // 与 ② 号位的「自导出函数」排除同理：形态判据（包装器名叫 expect/assert/…），不是文件白名单。
  const CANARY_WRAP_RE = /^(expect|assert|canary|it|test|describe)$/;
  const callStack = [];

  const walk = (n) => {
    let ownName = null;
    if ((ts.isCallExpression(n) || ts.isNewExpression(n)) && ts.isIdentifier(n.expression)) {
      ownName = n.expression.text;
      callStack.push(ownName);
    }
    // ⑦ 本地 import（静态 + 动态 `await import("./x.mjs")`，ontology-writeback 实物形状）
    if (ts.isImportDeclaration(n) && ts.isStringLiteralLike(n.moduleSpecifier)) {
      const spec = n.moduleSpecifier.text;
      if (/^\.{1,2}\/[\w./-]+\.mjs$/.test(spec)) {
        const p = resolveLocalImport(spec);
        if (p) push(p, "import");
      }
    }
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword &&
        n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) {
      const spec = n.arguments[0].text;
      if (/^\.{1,2}\/[\w./-]+\.mjs$/.test(spec)) {
        const p = resolveLocalImport(spec);
        if (p) push(p, "import");
      }
    }
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
      const callee = n.expression;
      const calleeName = ts.isIdentifier(callee) ? callee.text
        : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
      const args = n.arguments || [];

      // ③ join(ROOT|root|<仓根常量>, "a", "b") / 混段
      if (ts.isIdentifier(callee) && callee.text === "join" && args.length >= 2) {
        const base = joinBaseOf(n);
        if (base !== null) {
          const segs = args.slice(1).map((a) => (ts.isStringLiteralLike(a) ? a.text : "**"));
          if (segs.some((s) => s !== "**")) push([base, ...segs].filter(Boolean).join("/"), "join(…)", null, true);
        }
      }
      // ② fs 调用位与读取助手：字符串实参（含 new URL("apps/…", root)）。
      //    三条排除（都是本单实测污染）：
      //    · 调本文件**自己导出**的函数 —— 那是库的自测/内部复用，实参是样例不是射程；
      //    · **方法调用**（a.startsWith("packages/canary") / x.includes("apps/…")）——
      //      字符串操作永不读文件，只有 `fs.readFileSync` 这类 FS_CALLS 方法位才抽；
      //    · 金丝雀包装器（expect/assert/…）**内部**的调用 —— 实参是测试样例输入。
      if (calleeName && !(ts.isIdentifier(callee) && exportedNames.has(callee.text)) &&
          (!ts.isPropertyAccessExpression(callee) || FS_CALLS.has(calleeName)) &&
          !callStack.some((nm) => CANARY_WRAP_RE.test(nm))) {
        for (const a of args) {
          if (ts.isStringLiteralLike(a)) push(a.text, FS_CALLS.has(calleeName) ? "fs-call" : "helper-call", null, true);
        }
      }
      // ④a 枚举仓根：readdirSync(ROOT) / readdirSync(join(ROOT))
      if (calleeName === "readdirSync" && args[0]) {
        const a0 = args[0];
        if (isRootIdent(a0) || (ts.isCallExpression(a0) && ts.isIdentifier(a0.expression) &&
            a0.expression.text === "join" && a0.arguments.length === 1 && isRootIdent(a0.arguments[0]))) {
          out.push({ path: "", kind: "dir", exts: null, via, origin: "readdirSync(ROOT)" });
        }
      }
      // ④b walk(ROOT, …) 局部遍历器从仓根枚举（dsh-dormancy 实物形状）
      if (ts.isIdentifier(callee) && callee.text === "walk" && args[0] && isRootIdent(args[0])) {
        out.push({ path: "", kind: "dir", exts: null, via, origin: "walk(ROOT)" });
      }
      // ④c git 子进程（射程走 git 索引不走 fs 调用：no-raw-nul / merge-conflict-markers 实物）
      if ((calleeName === "execFileSync" || calleeName === "execSync" || calleeName === "spawnSync") &&
          args[0] && ts.isStringLiteralLike(args[0]) && args[0].text === "git") {
        out.push({ path: "", kind: "dir", exts: null, via, origin: "git 子进程" });
        out.push({ path: ".git", kind: "dir", exts: null, via, origin: "git 子进程" });
      }
      // ⑥ 读自己
      if (calleeName === "readFileSync" && args[0]) {
        const a0 = args[0];
        const isSelf =
          (ts.isCallExpression(a0) && ts.isPropertyAccessExpression(a0.expression) &&
            a0.expression.name.text === "fileURLToPath") ||
          (ts.isIdentifier(a0) && /^(selfPath|SELF_PATH|SELF)$/.test(a0.text));
        if (isSelf) push(`scripts/${via}`, "self-read");
      }
      // ④d for 语句在下方统一看
    }
    // ④d for-of 内联数组枚举：门**逐个遍历**的对象就是它的受检面。
    //    两种生产形状都要：
    //    · 顶层目录名：for (const g of ["apps", "packages"])        （dsh-dormancy / stale-claims）
    //    · 仓内路径（含对子数组）：for (const rel of ["apps/datacore/src/seed.ts", …])  （prd-data-grounding:420）
    //      for (const [f, sym] of [["packages/contracts/src/databuilder.ts", "fromDatasetIds"], …])  （modeling-wire:42）
    if (ts.isForOfStatement(n) && ts.isArrayLiteralExpression(n.expression)) {
      const visitEl = (el) => {
        if (ts.isStringLiteralLike(el)) {
          if (TOP_DIR_RE.test(el.text)) push(el.text, "for-of 目录枚举");
          else push(el.text, "for-of 路径枚举");
        } else el.forEachChild(visitEl);
      };
      n.expression.elements.forEach(visitEl);
    }
    // ⑤ 模板串拼路径的静态前缀：`apps/x/${key}.tsx`（sim-page-roster 实物形状）
    if (ts.isTemplateExpression(n)) {
      const head = n.head.text;
      if (/^(?:apps|packages|scripts|docs|deploy|db-seed|services|\.github)\/[\w./-]*\/$/.test(head)) {
        push(head, "模板串前缀");
      }
    }
    n.forEachChild(walk);
    if (ownName) callStack.pop();
  };
  sf.forEachChild(walk);

  // 去重（同 path+exts 组合只留一条）
  const seen = new Set();
  return out.filter((e) => {
    const k = `${e.path}::${(e.exts || []).sort().join(",")}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * 账本面 / 被守面分类：`scripts/*-baseline.json`、配置文件是门的**账与输入**，
 * 不是被守对象；「实际 ⊄ 声称」的反查只对被守面做，否则每道门都欠一屁股账本条。
 */
export function isSubjectPath(p) {
  return /^(?:apps|packages|docs|deploy|db-seed|services|\.github)\//.test(p);
}

function extOf(p) {
  const m = p.match(/\.([a-z0-9]+)$/i);
  return m ? `.${m[1].toLowerCase()}` : null;
}

function staticPrefixOf(glob) {
  const i = glob.indexOf("*");
  const slash = glob.lastIndexOf("/", i);
  return slash >= 0 ? glob.slice(0, slash + 1) : "";
}

/**
 * dist↔src 桥（见文件头）：`apps/X/src/Y.ts` ⇄ `apps/X/dist/Y.js`，同包同相对路径才映射。
 * 包级桥：`apps/X/src(/…)` ⇄ `apps/X/dist` —— 门读整包构建产物（ontology-descriptions 实物），
 * 台账写的责任主体是同包源码树；经 assertDistFresh / dist-freshness:check 锁同源。
 */
function distBridge(P) {
  const m = P.match(/^((?:apps|packages)\/[^/]+)\/src\/(.+)\.tsx?$/);
  if (m) return `${m[1]}/dist/${m[2]}.js`;
  const pkg = P.match(/^((?:apps|packages)\/[^/]+)\/src(?:\/|$)/);
  return pkg ? `${pkg[1]}/dist` : null;
}
function srcBridge(S) {
  const m = S.match(/^((?:apps|packages)\/[^/]+)\/dist(?:\/|$)/);
  return m ? `${m[1]}/src` : null;
}

/** 声称路径 P 是否被实际射程 surface 覆盖（含 dist↔src 桥）。 */
export function covered(P, surface) {
  if (coveredDirect(P, surface)) return true;
  const alt = distBridge(P);
  return !!alt && coveredDirect(alt, surface);
}

function coveredDirect(P, surface) {
  const pExt = extOf(P);
  const Pn = P.replace(/\/+$/, ""); // 台账里有 "apps/" 这种带尾斜杠的写法（check-case-collision 实测）
  for (const e of surface) {
    if (e.path === "" || e.path === ".") return true; // 仓根枚举 / git 子进程：整仓在射程
    if (e.path === Pn || e.path === P) return true;
    if (e.kind === "dir") {
      const under = Pn === e.path || Pn.startsWith(e.path + "/") ||
        (Pn.includes("*") && staticPrefixOf(Pn).startsWith(e.path + "/"));
      if (!under) continue;
      if (!pExt || !e.exts || e.exts.map((x) => x.toLowerCase()).includes(pExt)) return true;
    }
    if (e.kind === "glob" && !Pn.includes("*")) {
      const re = new RegExp(
        "^" + e.path.split("/").map((seg) =>
          seg === "**" ? "(?:.*)" : seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"),
        ).join("/") + "$",
      );
      if (re.test(Pn)) return true;
    }
  }
  return false;
}

/**
 * 实际射程条目 S 是否被声称集合 claimed 反映（反查方向：台账欠账）。
 * 判据：S 与某条声称 C 有包含关系（C 在 S 下 / S 在 C 下 / 相等 / glob 相罩），含 dist↔src 桥。
 */
export function declared(S, claimed) {
  if (declaredDirect(S, claimed)) return true;
  const alt = srcBridge(S);
  return !!alt && declaredDirect(alt, claimed);
}

function declaredDirect(S, claimed) {
  for (const C of claimed) {
    if (C === S) return true;
    if (!C.includes("*") && (C.startsWith(S + "/") || S.startsWith(C + "/"))) return true;
    if (C.includes("*") && coveredDirect(S, [{ path: C, kind: "glob", exts: null }])) return true;
    if (S.includes("*") && coveredDirect(C, [{ path: S, kind: "glob", exts: null }])) return true;
    // S 恰好是某条声称 glob 的**固定头**（`docs/CHECK-` ⇄ `docs/CHECK-*.md`）：
    // 抽取器从 `x.replace("docs/CHECK-", "")` 这类字符串操作位拿到前缀，语义上就是那条 glob。
    if (C.includes("*") && C.slice(0, C.indexOf("*")).replace(/\/+$/, "") === S) return true;
  }
  return false;
}

/**
 * 一门一行的对账结果。
 * @returns {{gaps:string[], undeclared:string[], claimed:string[], surface:Array}}
 */
export function reconcile(claimedPaths, surface) {
  const gaps = claimedPaths.filter((P) => !covered(P, surface));
  // undeclared（台账欠账候选）= 实际射程里台账没写的条目。
  // 文件级条目也纳入 —— 门多读一个文件而台账没写，与多读一个目录是同一种欠账
  // （M3 变异反证 2026-08-20：首版只认 dir/glob，给门源码加一个 readFileSync 扫描常量
  //   门照样绿 —— 沉默排除 = 给「文件级射程漂移」发永久绿卡，当场放宽）。
  // 唯一排除 self-read：门读自己的源码（如 dedupe 类门）不是射程漂移，
  // 而 100 道门的台账都不登记自己，纳入即全员假差集。
  const undeclared = [
    ...new Set(
      surface
        .filter((e) => isSubjectPath(e.path) && (e.kind !== "file" || e.origin !== "self-read"))
        .map((e) => e.path)
        .filter((S) => !declared(S, claimedPaths)),
    ),
  ];
  return { gaps, undeclared, claimed: claimedPaths, surface };
}

/**
 * **双向**金丝雀 —— 直接喂本文件导出的 `extractSurface/covered/reconcile` 本体，
 * 不另抄一份正则（抄了就是装饰品：改主逻辑时金丝雀拿旧的去测、照样绿）。
 * 样例形状一律取自**生产实物**（每条注明出处），手写单行样例与真实形状交集可能为空。
 * @param {object} ts TypeScript 编译器 API（调用方注入）
 */
export function reachCanary(ts) {
  // ① 必中·对象数组扫描面（check-dev-jargon-onscreen.mjs 的 SCAN 原文形状）
  const SAMPLE_SCAN = `
const SCAN = [
  { dir: "apps/frontend-shell/src", exts: [".tsx"], mode: "jsx", skip: /[\\\\/]locales[\\\\/]/ },
  { dir: "apps/frontend-shell/src/locales", exts: [".ts", ".tsx"], mode: "locale" },
];
const SCAN_SKIP_DIRS = new Set(["node_modules", "dist", "build"]);
`;
  // ② 必中·标量根 + join 多段拼接 + fs 调用位（check-gate-ledger.mjs 实物形状）
  const SAMPLE_JOIN = `
const SCAN_ROOT = "apps/datacore/src";
const LEDGER = join(ROOT, "scripts", "gate-ledger.json");
const a = readFileSync(join(ROOT, "docs", "SYSTEM-ONTOLOGY.md"), "utf8");
const b = existsSync("packages/contracts/src");
`;
  // ③ 必不中·报错文案/散文里的路径不算射程（位置纪律：只在声明与调用位抽）
  const SAMPLE_PROSE = `
console.error(\`请看 apps/frontend-shell/src/views 下的文件，或 docs/PRD-frontend.md\`);
const msg = "④ 责任边界：guardedPaths 含 apps/nowhere/x.ts";
`;
  // ④ 必中·生产实物的另外五种形状：
  //    read 助手（action-wiring）· 混段 join（typecheck-coverage）· git 子进程（no-raw-nul）·
  //    readdirSync(ROOT)（dsh-dormancy）· new URL("apps/…", root)（bstack-derive:46）
  const SAMPLE_SHAPES = `
const batterySrc = read("apps/datacore/src/synthetic/battery.ts");
const cfg = JSON.parse(read(join(ROOT, pkg, "package.json")));
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "buffer" });
for (const e of readdirSync(ROOT)) { scan(e); }
const dist = new URL("apps/datacore/dist/databuilder/comprehend.js", root);
`;
  // ⑤ 必不中·金丝雀样例里的假路径不进射程（dist-freshness.mjs 的 CANARIES 实物形状：
  //    样例代码住模板串里，23 道 import 它的门一度全部继承这批假路径）
  const SAMPLE_CANARY = `
const CANARIES = [
  { name: "门脚本经 dist 动态 import", want: true, path: "scripts/check-canary.mjs",
    code: \`const DIST_DIR = join(DC, "dist");\` },
  { name: "假包", code: \`read("packages/canary/dist/x.js");\` },
];
const REAL = "apps/real/src/a.ts";
`;
  // ⑥ 必中·正则字面量里的反引号不许吞掉其后真代码（check-bstack-derive.mjs:42 实物形状 ——
  //    正则/模板词法纠缠，正则抽取器就死在这里，AST 天然免疫）
  const SAMPLE_REGEX_BACKTICK = `
const strip = "x";
if (/systemPrompt:\\s*\`针对 \\\$\{s\\.solverKey\} 的推演分析 agent/.test(strip)) fail.push("bad");
const dist = new URL("apps/datacore/dist/solvers/service.js", root);
`;
  // ⑦ 必中·for-of 顶层目录枚举（stale-claims 的 srcRoots / dsh-dormancy 的 listSourceFiles 实物形状）
  const SAMPLE_FOROF = `
function srcRoots(root) {
  const roots = [];
  for (const group of ["apps", "packages"]) {
    const g = join(root, group);
    if (!existsSync(g)) continue;
  }
  return roots;
}
`;
  // ⑧ 必中·模板串拼路径的静态前缀（sim-page-roster.mjs 按约定拼页文件路径实物形状）
  const SAMPLE_TPL = `
const fileFor = (key) => \`apps/frontend-shell/src/views/\${key}.tsx\`;
`;
  // ⑨ 必中·for-of 内联路径数组（prd-data-grounding.mjs:420 实物形状）
  const SAMPLE_FOROF_PATHS = `
for (const rel of ["apps/datacore/src/seed.ts", "apps/datacore/src/sim/propagation.ts"]) {
  check(rel);
}
`;
  // ⑩ 必中·for-of 对子数组（modeling-wire.mjs:42 实物形状 —— 路径是对子的第一个元素）
  const SAMPLE_FOROF_PAIRS = `
for (const [f, sym] of [["packages/contracts/src/databuilder.ts", "fromDatasetIds"], ["packages/contracts/src/storybuildrun.ts", "storyBuildRun"]]) {
  assertSymbol(f, sym);
}
`;
  // ⑪ 必中·动态 import 本地模块（ontology-writeback.mjs 的 await import("./gate-census.mjs") 实物形状）
  const SAMPLE_DYNIMPORT = `
async function main() {
  const { census } = await import("./gate-census.mjs");
  return census();
}
`;
  // ⑫ 必不中·读取助手收到的散文实参（含空格/`#` 的章节锚）不算射程
  //    （sim-ux-criteria.mjs 的 section("### 4.1") 实物形状 —— 首版 loose 判据把它当仓根文件收进来）
  const SAMPLE_ANCHOR = `
const rows = section("### 4.1");
`;
  // ⑬ 必中·lib 内 import 相对 **lib 自己**解析（feature-defaults.mjs:12 实物形状 ——
  //     首版一律按 scripts/ 解析，把 scripts/lib/source-lex.mjs 错记成 scripts/source-lex.mjs）
  const SAMPLE_LIB_IMPORT = `
import { stripComments, splitTopLevel } from "./source-lex.mjs";
import { kin } from "../gate-census.mjs";
`;
  // ⑭ 必不中·调本文件**自己导出**的函数，字符串实参不是射程（reachCanary 自测实物形状：
  //     covered("apps/x", …) 的样例实参一度被当射程，污染 4 条差集）；
  //     必中对照：未导出的局部读取助手照抽（action-wiring 的 read 实物形状）。
  const SAMPLE_SELF_EXPORT = `
export function covered(P, surface) { return surface.includes(P); }
const hit = covered("apps/datacore/src/**", s4);
const src = read("apps/datacore/src/synthetic/battery.ts");
const miss = !s5.some((e) => e.path.startsWith("packages/canary"));
const raw = fs.readFileSync("apps/datacore/src/solvers/extended.ts", "utf8");
`;
  // ⑯ 必不中·金丝雀包装器 expect(...) 内嵌助手调用的样例路径不进面
  //     （check-file-truncation.mjs 金丝雀实物形状 —— M3 放宽后它被误补登进台账，
  //     ledger 门判「guardedPaths 指向空气」当场抖出这个污染类）；
  //     必中对照：同文件里包装器外的真读取助手与顶层常量照抽。
  const SAMPLE_CANARY_WRAP = `
const PROTECTED = ["docs/SYSTEM-ONTOLOGY.md"];
expect("glob-4 非保护路径", !isProtected("docs/SYSTEM-ONTOLOGY.md.bak") && !isProtected("scripts/foo.json"));
const raw = read("apps/datacore/src/seed.ts");
`;
  // ⑰ 必不中·CANARIES 常量里的金丝雀样例路径不进面（check-dsh-dormancy.mjs 实物形状 ——
  //     样例按铁律 0.6 取生产形状，路径串个个像真射程；environment.ts 那条被误补登进台账后
  //     由 ledger 门「指向空气」判据抖出）；必中对照：同文件真扫描常量照抽。
  const SAMPLE_CANARY_CONST = `
const CANARIES = [
  { name: "归类·必不咬·src/env.ts 不是部署面", kind: "path",
    src: ["apps/frontend-shell/src/env.ts", "apps/datacore/src/environment.ts"],
    expect: (r) => r.every((x) => x === null) },
];
const SCAN_ROOTS = ["apps/datacore/src"];
`;

  const s1 = extractSurface(SAMPLE_SCAN, "canary-1", ts);
  const s2 = extractSurface(SAMPLE_JOIN, "canary-2", ts);
  const s3 = extractSurface(SAMPLE_PROSE, "canary-3", ts);
  const s4 = extractSurface(SAMPLE_SHAPES, "canary-4", ts);
  const s5 = extractSurface(SAMPLE_CANARY, "canary-5", ts);
  const s6 = extractSurface(SAMPLE_REGEX_BACKTICK, "canary-6", ts);
  const s7 = extractSurface(SAMPLE_FOROF, "canary-7", ts);
  const s8 = extractSurface(SAMPLE_TPL, "canary-8", ts);
  const s9 = extractSurface(SAMPLE_FOROF_PATHS, "canary-9", ts);
  const s10 = extractSurface(SAMPLE_FOROF_PAIRS, "canary-10", ts);
  const s11 = extractSurface(SAMPLE_DYNIMPORT, "canary-11", ts);
  const s12 = extractSurface(SAMPLE_ANCHOR, "canary-12", ts);
  const s13 = extractSurface(SAMPLE_LIB_IMPORT, "lib/feature-defaults.mjs", ts);
  const s14 = extractSurface(SAMPLE_SELF_EXPORT, "canary-14", ts);
  const s16 = extractSurface(SAMPLE_CANARY_WRAP, "canary-16", ts);
  const s17 = extractSurface(SAMPLE_CANARY_CONST, "canary-17", ts);

  const d1 = s1.find((e) => e.path === "apps/frontend-shell/src");
  const d2 = s1.find((e) => e.path === "apps/frontend-shell/src/locales");

  const checks = {
    "①必中·对象数组扫描面的两个 dir 都抽出": !!d1 && !!d2,
    "①必中·exts 关联生效（.ts 在 locales 面的过滤里）": !!d2 && (d2.exts || []).includes(".ts"),
    "①必不中·同常量里的 skip 目录名不进面": !s1.some((e) => e.path === "locales"),
    "②必中·标量根抽出": s2.some((e) => e.path === "apps/datacore/src"),
    "②必中·join 多段拼成 scripts/gate-ledger.json": s2.some((e) => e.path === "scripts/gate-ledger.json"),
    "②必中·fs 调用位的 docs/SYSTEM-ONTOLOGY.md": s2.some((e) => e.path === "docs/SYSTEM-ONTOLOGY.md"),
    "②必中·fs 调用位的裸字面量 packages/contracts/src": s2.some((e) => e.path === "packages/contracts/src"),
    "③必不中·散文/模板串里的路径零命中": s3.length === 0,
    "④必中·局部读取助手 read(\"apps/…\")": s4.some((e) => e.path === "apps/datacore/src/synthetic/battery.ts"),
    "④必中·混段 join ⇒ glob **/package.json": s4.some((e) => e.path === "**/package.json" && e.kind === "glob"),
    "④必中·git 子进程 ⇒ 仓根在射程": s4.some((e) => e.path === "" && e.kind === "dir"),
    "④必中·new URL(\"apps/…\", root)": s4.some((e) => e.path === "apps/datacore/dist/databuilder/comprehend.js"),
    "④混段 glob 罩住声称的包文件": covered("apps/datacore/package.json", s4),
    "④git 射程罩住任意仓内声称": covered("apps/datacore/src/**", s4),
    "⑤必不中·模板串样例里的假路径（packages/canary）不进面": !s5.some((e) => e.path.startsWith("packages/canary")),
    "⑤必中·同文件里的真常量照常抽出": s5.some((e) => e.path === "apps/real/src/a.ts"),
    "⑥必中·正则里的反引号不吞其后真代码": s6.some((e) => e.path === "apps/datacore/dist/solvers/service.js"),
    "⑦必中·for-of 目录枚举 apps+packages": s7.some((e) => e.path === "apps") && s7.some((e) => e.path === "packages"),
    "⑧必中·模板串静态前缀按目录记": s8.some((e) => e.path === "apps/frontend-shell/src/views" && e.kind === "dir"),
    "⑨必中·for-of 内联路径数组两条都抽出":
      s9.some((e) => e.path === "apps/datacore/src/seed.ts") && s9.some((e) => e.path === "apps/datacore/src/sim/propagation.ts"),
    "⑩必中·for-of 对子数组的路径元素抽出（符号元素不进面）":
      s10.some((e) => e.path === "packages/contracts/src/databuilder.ts") &&
      s10.some((e) => e.path === "packages/contracts/src/storybuildrun.ts") &&
      !s10.some((e) => e.path === "fromDatasetIds"),
    "⑪必中·动态 import 本地模块抽出": s11.some((e) => e.path === "scripts/gate-census.mjs" && e.origin === "import"),
    "⑫必不中·散文/章节锚实参不进面": s12.length === 0,
    "⑬必中·lib 内 import 相对 lib 解析（含 ../ 上溯）":
      s13.some((e) => e.path === "scripts/lib/source-lex.mjs") && s13.some((e) => e.path === "scripts/gate-census.mjs"),
    "⑭必不中·自导出函数的样例实参不进面 · 必中·未导出助手照抽":
      !s14.some((e) => e.path === "apps/datacore/src/**") &&
      s14.some((e) => e.path === "apps/datacore/src/synthetic/battery.ts"),
    "⑮必不中·字符串方法调用的实参不进面 · 必中·fs 方法位照抽":
      !s14.some((e) => e.path === "packages/canary") &&
      s14.some((e) => e.path === "apps/datacore/src/solvers/extended.ts"),
    "⑯必不中·金丝雀包装器内的样例路径不进面 · 必中·包装器外真读取照抽":
      !s16.some((e) => e.path === "docs/SYSTEM-ONTOLOGY.md.bak") &&
      !s16.some((e) => e.path === "scripts/foo.json") &&
      s16.some((e) => e.path === "apps/datacore/src/seed.ts") &&
      s16.some((e) => e.path === "docs/SYSTEM-ONTOLOGY.md"),
    "⑰必不中·CANARIES 常量的样例路径不进面 · 必中·同文件真扫描常量照抽":
      !s17.some((e) => e.path === "apps/datacore/src/environment.ts") &&
      !s17.some((e) => e.path === "apps/frontend-shell/src/env.ts") &&
      s17.some((e) => e.path === "apps/datacore/src"),
    "覆盖·目录下的声称文件被罩住": covered("apps/frontend-shell/src/views/X.tsx", [
      { path: "apps/frontend-shell/src", kind: "dir", exts: [".tsx"], via: "c", origin: "c" },
    ]),
    "覆盖·扩展名不符不罩（.ts 文件不在 .tsx 面里）":
      !covered("apps/frontend-shell/src/locales/zh.ts", [
        { path: "apps/frontend-shell/src", kind: "dir", exts: [".tsx"], via: "c", origin: "c" },
      ]) &&
      covered("apps/frontend-shell/src/locales/zh.ts", [
        { path: "apps/frontend-shell/src", kind: "dir", exts: [".tsx"], via: "c", origin: "c" },
        { path: "apps/frontend-shell/src/locales", kind: "dir", exts: [".ts", ".tsx"], via: "c", origin: "c" },
      ]),
    "覆盖·声称 glob 落在递归目录下": covered("apps/frontend-shell/src/views/*.tsx", [
      { path: "apps/frontend-shell/src", kind: "dir", exts: [".tsx"], via: "c", origin: "c" },
    ]),
    "覆盖·dist↔src 桥（声称 src、射程 dist）": covered("apps/agentcore/src/mocks/seed.ts", [
      { path: "apps/agentcore/dist/mocks/seed.js", kind: "file", exts: null, via: "c", origin: "c" },
    ]),
    "覆盖·dist↔src 包级桥（声称包 src 树、射程包 dist 目录）": covered("apps/datacore/src", [
      { path: "apps/datacore/dist", kind: "dir", exts: null, via: "c", origin: "c" },
    ]),
    "差集·声称在射程外 ⇒ gap": reconcile(["apps/elsewhere/x.ts"], s1).gaps.length === 1,
    "差集·射程在台账外 ⇒ undeclared": reconcile([], s1).undeclared.length >= 1,
    "差集·互相覆盖 ⇒ 双向零差": reconcile(
      ["apps/frontend-shell/src"],
      [{ path: "apps/frontend-shell/src", kind: "dir", exts: null, via: "c", origin: "c" }],
    ).gaps.length === 0,
    "差集·射程前缀恰为声称 glob 固定头 ⇒ 非欠账":
      reconcile(["docs/CHECK-*.md"], [{ path: "docs/CHECK-", kind: "dir", exts: null, via: "c", origin: "c" }]).undeclared.length === 0,
  };
  const bad = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  // 向数现算不手抄 —— 本文件曾标「三十七向」而实际 35 条，手写计数天生带保质期。
  const CN = ["零","一","二","三","四","五","六","七","八","九","十"];
  const cn = (n) => (n < 11 ? CN[n] : n < 20 ? "十" + CN[n - 10] : CN[Math.floor(n / 10)] + "十" + (n % 10 ? CN[n % 10] : ""));
  const total = Object.keys(checks).length;
  return {
    ok: bad.length === 0,
    got: bad.length ? `未通过：${bad.join(" · ")}` : `${cn(total)}向全通过`,
    want: `${cn(total)}向全通过（对象数组面 · 标量根 · join 拼接 · fs 调用位 · 散文不抽 · exts 关联 · 局部助手 · 混段 glob · git 子进程 · 样例假路径不抽 · 正则反引号免疫 · for-of 目录/路径/对子三形 · 模板前缀 · 动态 import · 章节锚不抽 · lib 相对 import · 自导出函数样例不抽 · dist↔src 文件桥+包级桥 · glob 固定头归并 · 双向差集 · 金丝雀包装器样例不抽 · CANARIES 常量样例不抽）`,
  };
}
