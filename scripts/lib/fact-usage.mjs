/**
 * ══ 事实使用注册表 · **「哪个事实出现在哪几屏」的唯一实现**（WO-FACT-USAGE-REGISTRY）══
 *
 * ── 它是什么的前置 ────────────────────────────────────────────────────────────
 * `docs/PRD-harness-ux-adoption.md` §4.2 的明账 **B-3（U5 跨屏面）** 要判
 * 「**同一事实**在两屏上的值一不一致」。那道判据当时被判「不能机检」，理由原话是：
 *
 *   > 要比对「同一事实在两屏的值」，先得知道**哪个事实出现在哪两屏**。
 *   > 本仓没有「事实 → 读取它的页面集合」的可枚举注册表 ——
 *   > **连该比哪两个数都列不出来，真浏览器也无从下手。**
 *
 * ⇒ 缺的前置**比「有没有浏览器 harness」更靠前**。本文件造那份注册表：**现算，不手抄**。
 * 本文件**不**判「两屏的值相不相等」（那要渲染，归 `WO-GATE-B-BROWSER-HARNESS`），
 * 只回答**「该比哪两个数」**。
 *
 * ── ⛔ 为什么名单必须现算（断点 `G-GATE-ROSTER-HANDCOPIED`）─────────────────
 * 手抄名单里**没有的对象永远绿**：门证明的只是「它问过的那些是对的」，
 * 证明不了「该问的都问了」。本文件因此一条名单都不写死，全部从源码 AST 现算，
 * 且**每条带依据链**（`why`：在哪个文件哪一行、经哪个绑定、走哪条路进来的）。
 *
 * ══ 一 · 「事实」的粒度裁决（本文件最要紧的一步，选错整份注册表就没用）══════════
 *
 * 三个候选口径，逐个论证（**结论：三者组合，按数据源分族；理由是它们各自覆盖的
 * 读取路径互不包含，任取其一都会漏掉另外两族的全部读取位**）：
 *
 * ① **后端端点 + 字段路径** —— 单独用**太粗，且是结构性的粗**，不是「今天恰好粗」。
 *    实测：本仓前端**所有**求解器读取都走同一条 URL 模板
 *    `POST /a/v1/solvers/{solverKey}/invoke`（`api/endpoints.ts` `invokeSolver`）与
 *    `POST /b/v1/solvers/{solverKey}/run`（`runSolver`）。以 URL 模板作键 ⇒
 *    **十几个语义完全不同的求解器塌缩成 1 个「事实源」**，`risk_timeline.threshold` 与
 *    `quote_margin.grossMargin` 会被判成「同一个端点」。这正是 WO 点名的「太粗」失效态。
 *    ⇒ **保留端点这一维，但只用于非求解器的 REST 读取**（那里 URL 模板与语义 1:1）。
 *
 * ② **对象类型 + 属性键**（`Equipment.oee_current`）—— 语义上**最正确**，但单独用**覆盖不到**。
 *    它是本仓「同一事实两屏不一致」最刺眼那一族的天然键（三套 OEE 口径、
 *    `docs/DECISION-oee-ssot.md`）。前端确实有可静态解析的入口：
 *    `searchObjects("Order", …)` / `queryObjectsPaged("Order", …)` / `fetchObjectByKey("Line", …)`
 *    的**第一个实参就是类型键**，随后 `.items[].props.<key>` 就是属性键 ⇒ 可现算。
 *    但求解器输出字段（`risk_timeline.cards[].tightness`）**回不到** `objectType.prop`：
 *    那要读后端求解器实现才知道它算在哪个属性之上，前端源码里没有这个信息。
 *    ⇒ **保留对象这一维，用于直接对象读取**；求解器输出**不许**硬凑成 `objectType.prop`
 *    （凑了就是编，且会编出一个 B-3 拿去比会比错的键）。
 *
 * ③ **求解器 + 输出字段**（`risk_timeline#cards[].tightness`）—— 覆盖本仓推演页读数的主体，
 *    且**同族比较的语义恰好对**：两屏调同一求解器读同一字段，值就该相等。
 *    单独用则漏掉全部对象直读与全部管理台 REST 读取。
 *
 * **裁决：事实键 = `<族>:<源键>#<字段路径>`**，三族并存、互不翻译：
 *   · `solver:<solverKey>#<字段路径>`      —— `invokeSolver` / `runSolver` 的输出字段
 *   · `object:<TypeKey>#props.<属性键>`    —— 对象直读（类型键取自调用第一实参）
 *   · `rest:<METHOD /url/模板>#<字段路径>` —— 其余 `api/endpoints.ts` 导出函数（URL 现算自该文件）
 *
 * **为什么不把三族翻译成一族**：翻译需要「求解器输出字段 ↔ 对象属性」的映射，
 * 那份映射今天**不存在**（后端只在 `bottleneck_matrix` 的 marks、`generic_inference` 的
 * levers、`whatif` 的 deltas 这三处零星带了 `objectType`/`prop`）。硬编一份就是造第二真相源。
 * 三族并存的代价是「同一个物理量跨族出现时本表看不出它们是同一个」——
 * 这一条**如实登记在 §「静态分析看不见的部分」，不藏**。
 *
 * **口径（args）不是键的一部分，是键的限定词**：两屏调同一求解器同一字段但**参数不同**
 * （`{horizon:7}` vs `{horizon:14}`），值本来就该不同 —— 那是「口径分家」不是「有一处算错」，
 * 两者的修法完全相反。故本表把 args 单独记成 `argsSig`，并把跨屏对分成两类：
 *   · `EQUAL-EXPECTED`（同源同字段**同 args**）⇒ B-3 该断言**相等**
 *   · `CALIBER-DIVERGENT`（同源同字段**不同 args**）⇒ B-3 该断言**屏上各自标明口径**
 * 这个区分不是理论：`docs/AUDIT-*` 记过「标题分叉（7 日 vs 14 日）」正是后者。
 *
 * ══ 二 · 「屏」的粒度：页 = 路由入口，读取面 = 该页组件的**本地 import 传递闭包**══════
 * 一个事实可能不是在页文件里读的，而是在它挂的共享面板里读的（`DispositionDetailPanel`
 * 挂在 `risk` 与 `sim-sandbox` 两页 ⇒ 它读的事实**确实**出现在两屏）。
 * 故页的读取面 = 从页根组件出发、沿 `@/` `./` `../` 本地 import 的**传递闭包**。
 * ⚠️ 这是**扫描面**判据（金丝雀纪律①：金丝雀证明的是工具没瞎，不是扫描面选对了）。
 * 只扫页根文件会漏掉共享面板里的全部读取位 —— 本文件因此现算闭包，并把闭包规模一并报出，
 * 让「我扫的这个面包不包含所有会读它的地方」这个问题有数可查。
 *
 * ══ 三 · 覆盖率必须拿独立口径对总数（金丝雀纪律②）═══════════════════════════════
 * 金丝雀全中**也不保证抽取器覆盖全**。故 `computeFactUsage` 一并返回 `coverage`：
 * 用**与 AST 完全无关的第二把尺**（剥注释后的词面计数 `countSourceCallsLexically`）
 * 数出「源码里到底有多少个数据源调用位」，与 AST 认出的条数对账。
 * 两个数差得多 ⇒ **抽取器瞎了**，调用方必须报「工具坏了」而不是「注册表就这么大」。
 *
 * ══ 四 · 金丝雀样例的形状取自生产实物（金丝雀纪律③）═════════════════════════════
 * `CANARY_FILES` 的每一段都是从真文件**照抄形状**（多行 `useQuery({queryKey, queryFn})`、
 * `RiskTimelineOutputSchema.parse(res.data)` 包一层、`{ out: res.data, snapshotVersion }`
 * 包一层、`(q.data?.items ?? []).map((o) => o.props.so)` 回调绑定、`for (const l of …)`），
 * 不是手写单行。手写单行与 prettier 格式化后的真实形状交集为空 ⇒ 站点被静默跳过而门照绿。
 *
 * 本文件是**纯函数库**：不读文件、不 `process.exit`、无顶层副作用。读盘与退出码归门。
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** typescript 是可选依赖：拿不到就让调用方报「工具坏了」（RC=2），**不许**降级成正则然后报「干净」。 */
export function loadTs() {
  return require("typescript");
}

export const FRONTEND_SRC = "apps/frontend-shell/src";
export const ENDPOINTS_FILE = `${FRONTEND_SRC}/api/endpoints.ts`;
export const REGISTRY_FILE = `${FRONTEND_SRC}/views/registry.ts`;
export const APP_FILE = `${FRONTEND_SRC}/App.tsx`;

/**
 * 对象直读函数 → 类型键在第几个实参。
 * **这张表是判据不是名册**：它答的是「哪些调用的第一实参是本体类型键」，
 * 每条都能在 `api/endpoints.ts` 里逐字复核（签名第一形参就叫 `type`/`typeKey`）。
 */
export const OBJECT_READ_FNS = {
  searchObjects: 0,
  queryObjectsPaged: 0,
  fetchObjectByKey: 0,
  fetchNeighbors: -1, // 第一实参是 objectId 不是类型键 ⇒ 类型未知，记 `object:?`
};

/** 求解器读取函数（第一实参 = solverKey）。 */
export const SOLVER_READ_FNS = new Set(["invokeSolver", "runSolver"]);

/** 数组迭代方法：命中它就不再往上拼字段路径，改为把回调首参绑成 `<路径>[]` 的元素符号。 */
export const ITER_METHODS = new Set(["map", "filter", "find", "forEach", "flatMap", "reduce", "some", "every", "sort", "slice", "findIndex", "flat", "concat", "join"]);

/** 不算「字段路径」的尾巴（它们是 JS 惯用法不是数据字段）。 */
export const NON_FIELD_SEGS = new Set(["length", "toString", "valueOf", "then", "catch", "finally"]);

/* ═══════════════════ 一 · `api/endpoints.ts` → 导出函数名 ⇒ 端点 ═══════════════ */

/**
 * 现算「导出函数 → (api 侧, URL 模板)」。**这是候选①「后端端点」那一维的唯一来源**，
 * 且顺带产出本文件粒度裁决的关键证据：多少个求解器塌缩进同一条 URL 模板。
 *
 * 判据：函数体里第一处 `api.a<…>("…")` / `api.b<…>("…")` 调用的第一实参（字符串或模板串）。
 * 模板串里的 `${…}` 一律归一成 `{}`（`/a/v1/solvers/${solverKey}/invoke` → `/a/v1/solvers/{}/invoke`）,
 * 因为**同一条模板的不同取值就是同一个端点**——这恰恰是候选①太粗的机制本身。
 * @returns {Record<string,{side:"a"|"b",url:string,line:number}>}
 */
export function parseEndpointsModule(ts, src) {
  const out = {};
  const sf = ts.createSourceFile("endpoints.ts", src ?? "", ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const urlOf = (node) => {
    let found = null;
    const visit = (n) => {
      if (found) return;
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const obj = n.expression.expression;
        const side = n.expression.name.text;
        if (ts.isIdentifier(obj) && obj.text === "api" && (side === "a" || side === "b")) {
          const arg = n.arguments[0];
          if (arg) {
            const u = literalUrl(ts, arg);
            if (u) { found = { side, url: u, line: lineOf(n) }; return; }
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
    return found;
  };

  const record = (name, node) => {
    if (!name || out[name]) return;
    const u = urlOf(node);
    if (u) out[name] = u;
  };

  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) {
      const exported = st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (!exported) continue;
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer) record(d.name.text, d.initializer);
      }
    } else if (ts.isFunctionDeclaration(st) && st.name) {
      const exported = st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (exported && st.body) record(st.name.text, st.body);
    }
  }
  return out;
}

/** 字符串/模板串 → 归一化 URL（`${…}` ⇒ `{}`）。非字面量返回 null。 */
export function literalUrl(ts, node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let s = node.head.text;
    for (const sp of node.templateSpans) s += "{}" + sp.literal.text;
    return s;
  }
  return null;
}

/* ═══════════════════ 二 · 页名册（路由入口 → 根组件文件）══════════════════════ */

/**
 * 页名册 = `views/registry.ts` 的 `registerRenderer` ∪ `App.tsx` 的静态 route ∪ `admin(...)` 路由。
 * **一条都不手抄**。`registry` / 静态 route 两支复用 `sim-page-roster.mjs` 的已有解析器
 * （RL3 单一来源：那两支已经是本仓的唯一实现，本文件不另抄一份）。
 * @returns {Array<{key:string,kind:"renderer"|"route"|"admin",file:string,why:string}>}
 */
export function buildPageRoster({ registrySrc, appSrc, rendererFiles, staticRouteFiles }) {
  const pages = [];
  for (const [key, file] of Object.entries(rendererFiles ?? {})) {
    pages.push({ key, kind: "renderer", file, why: `registry.ts registerRenderer("${key}") → ${file}` });
  }
  for (const [key, file] of Object.entries(staticRouteFiles ?? {})) {
    if (pages.some((p) => p.key === key)) continue;
    pages.push({ key, kind: "route", file, why: `App.tsx 静态 route \`v/${key}\` → ${file}` });
  }
  // admin(...) 路由 + 直写的 admin 路由对象：`admin("catalog", <CatalogPage />)` / `path: "admin/org"` + `<OrgWorldPage />`
  const lazyMap = {};
  for (const m of (appSrc ?? "").matchAll(/const\s+(\w+)\s*=\s*lazy\(\(\)\s*=>\s*import\("@\/([^"]+)"\)\)/g)) {
    lazyMap[m[1]] = `${FRONTEND_SRC}/${m[2]}.tsx`;
  }
  for (const m of (appSrc ?? "").matchAll(/admin\("([^"]+)",\s*<(\w+)\s*\/>\)/g)) {
    const file = lazyMap[m[2]];
    if (!file) continue;
    pages.push({ key: `admin/${m[1]}`, kind: "admin", file, why: `App.tsx admin("${m[1]}", <${m[2]} />) → ${file}` });
  }
  for (const m of (appSrc ?? "").matchAll(/path:\s*"(admin\/[a-z0-9/-]+)",\s*\n\s*element:\s*\(?[\s\S]{0,320}?lazyWrap\(<(\w+)\s*\/>\)/g)) {
    if (pages.some((p) => p.key === m[1])) continue;
    const file = lazyMap[m[2]];
    if (!file) continue;
    pages.push({ key: m[1], kind: "admin", file, why: `App.tsx path:"${m[1]}" → <${m[2]}/> → ${file}` });
  }
  // 非 `v/`、非 admin 的顶层页（深链页 · `tasks/:taskId` `o/:typeKey/:objectKey` 之流）
  for (const m of (appSrc ?? "").matchAll(/\{\s*path:\s*"((?!admin\/)(?!v\/)[^"]+)",\s*element:\s*lazyWrap\(<(\w+)\s*\/>\)/g)) {
    const file = lazyMap[m[2]];
    if (!file || pages.some((p) => p.key === m[1])) continue;
    pages.push({ key: m[1], kind: "route", file, why: `App.tsx path:"${m[1]}" → <${m[2]}/> → ${file}` });
  }
  return pages.sort((a, b) => a.key.localeCompare(b.key));
}

/* ═══════════════════ 三 · 本地 import 图与传递闭包 ═══════════════════════════ */

/** `@/x` / `./x` / `../x` → 仓内相对路径（试 `.ts` `.tsx` `/index.ts` `/index.tsx`）；外部包返回 null。 */
export function resolveImport(fromFile, spec, hasFile) {
  let base;
  if (spec.startsWith("@/")) base = `${FRONTEND_SRC}/${spec.slice(2)}`;
  else if (spec.startsWith("./") || spec.startsWith("../")) {
    const dir = fromFile.split("/").slice(0, -1);
    const parts = spec.split("/");
    for (const p of parts) {
      if (p === ".") continue;
      else if (p === "..") dir.pop();
      else dir.push(p);
    }
    base = dir.join("/");
  } else return null;
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (hasFile(cand)) return cand;
  }
  return null;
}

/**
 * 文件 → 本地 import 目标集合（只认本地，外部包不进图）。
 *
 * ⚠️ **两类边刻意不入图 —— 这是扫描面判据，不是性能优化**（金丝雀纪律①：扫描面选错时，
 * 金丝雀会陪你一起给出自信的错误答案。下面这两条各自都被实测抓过一次）：
 *
 *  ① **`import type` 一律不入图**。它在编译期被完全擦除，**运行期没有这条边**，
 *     页面也就不会因它渲染出任何东西。实测代价是**结构性的**：本仓 20+ 个视图都写着
 *     `import type { ViewRendererProps } from "./registry"` —— 一条纯类型边，
 *     却把 `views/registry.ts` 拖进闭包，而后者的 `() => import("./XxxView")` 又把
 *     **全部 28 个渲染器**拉进来。第一版实测的后果：**23 个互不相干的页闭包全是 104 个文件、
 *     读取位全是 510**（`dashboard` 与 `risk-board` 一模一样）⇒ 每个事实都"出现在 23 屏"，
 *     跨屏对全是噪声。金丝雀那时**全中** —— 它证明的是工具没瞎，证明不了扫描面选对了。
 *
 *  ② **动态 `import()` 一律不入图**。本仓的动态 import 全部是**代码分割边界**
 *     （`registerRenderer(key, () => import("./XxxView"))` 与 `lazy(() => import("@/pages/…"))`），
 *     它们指向的是**另一个页**，不是本页的子组件。跟着走 = 把「别的页读了什么」记到本页头上。
 *     代价如实登记：沙盘经 `workspace.views` **字符串键运行时分发**挂子视图，那条边静态看不见 ——
 *     见审计文档「静态分析看不见的部分」，**不许**当成本表已覆盖。
 */
export function fileImports(ts, src, fileName, hasFile) {
  const sf = ts.createSourceFile(fileName, src ?? "", ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = new Set();
  const add = (spec) => {
    const r = resolveImport(fileName, spec, hasFile);
    if (r) out.add(r);
  };
  const visit = (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const c = n.importClause;
      // `import type { X } from "…"` ⇒ 整条是类型边，不入图
      if (c?.isTypeOnly) { ts.forEachChild(n, visit); return; }
      // `import { type X } from "…"`：全部具名说明符都是 type ⇒ 同样是纯类型边
      const nb = c?.namedBindings;
      if (c && !c.name && nb && ts.isNamedImports(nb) && nb.elements.length > 0 && nb.elements.every((e) => e.isTypeOnly)) {
        ts.forEachChild(n, visit);
        return;
      }
      add(n.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(n) && !n.isTypeOnly && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      add(n.moduleSpecifier.text);
    }
    // 动态 `import()` 刻意不入图（见头注②）
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return [...out];
}

/** 传递闭包（含起点自身）。 */
export function importClosure(root, graph) {
  const seen = new Set([root]);
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    for (const nxt of graph.get(cur) ?? []) if (!seen.has(nxt)) { seen.add(nxt); stack.push(nxt); }
  }
  return seen;
}

/* ═══════════════════ 四 · 单文件读取位抽取（本库的核心）═════════════════════ */

/** 剥掉注释（注释里提一嘴 ≠ 真读了一个字段）。保留换行以免行号漂。 */
export function stripComments(src) {
  return String(src ?? "")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(Math.max(0, m.length - p1.length)));
}

/**
 * **独立口径**（金丝雀纪律②）：与 AST 完全无关的第二把尺 —— 剥注释后数「数据源调用位」的词面数。
 * 用来给 AST 的抽取条数**对总数**：两个数差得多 ⇒ 抽取器瞎了，**不许**报「注册表就这么大」。
 * @returns {{solver:number,object:number,total:number}}
 */
export function countSourceCallsLexically(src) {
  const t = stripComments(src);
  const solver = (t.match(/\b(?:invokeSolver|runSolver)\s*\(\s*["'`]/g) ?? []).length;
  const objectFns = Object.keys(OBJECT_READ_FNS).filter((f) => OBJECT_READ_FNS[f] >= 0);
  const re = new RegExp(`\\b(?:${objectFns.join("|")})\\s*\\(\\s*["'\`]`, "g");
  const object = (t.match(re) ?? []).length;
  return { solver, object, total: solver + object };
}

/** args 签名：调用第二实参的对象字面量键（值不取——值常是变量）。`{}` / 无参 ⇒ `∅`。 */
export function argsSignature(ts, node) {
  if (!node) return "∅";
  if (ts.isObjectLiteralExpression(node)) {
    const keys = [];
    for (const p of node.properties) {
      if (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) {
        const n = p.name;
        keys.push(ts.isIdentifier(n) || ts.isStringLiteral(n) ? n.text : "?");
      } else if (ts.isSpreadAssignment(p)) keys.push("...");
    }
    return keys.length ? keys.sort().join(",") : "∅";
  }
  if (ts.isConditionalExpression(node)) {
    const a = argsSignature(ts, node.whenTrue);
    const b = argsSignature(ts, node.whenFalse);
    return a === b ? a : `${a}|${b}`;
  }
  if (ts.isIdentifier(node)) return `«${node.text}»`;
  return "«expr»";
}

/**
 * 一个调用是不是「数据源调用」。
 * @returns {{kind:"solver"|"object"|"rest",key:string,argsSig:string,resolved:boolean}|null}
 */
export function classifySourceCall(ts, call, endpointMap) {
  const callee = call.expression;
  const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
  if (!name) return null;

  if (SOLVER_READ_FNS.has(name)) {
    const a0 = call.arguments[0];
    const key = a0 && (ts.isStringLiteral(a0) || ts.isNoSubstitutionTemplateLiteral(a0)) ? a0.text : null;
    return { kind: "solver", key: key ?? "?", argsSig: argsSignature(ts, call.arguments[1]), resolved: key != null };
  }
  if (name in OBJECT_READ_FNS) {
    const idx = OBJECT_READ_FNS[name];
    if (idx < 0) return { kind: "object", key: "?", argsSig: "∅", resolved: false };
    const a = call.arguments[idx];
    const key = a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) ? a.text : null;
    return { kind: "object", key: key ?? "?", argsSig: "∅", resolved: key != null };
  }
  if (endpointMap && endpointMap[name]) {
    const ep = endpointMap[name];
    return { kind: "rest", key: `${ep.side.toUpperCase()} ${ep.url}`, argsSig: "∅", resolved: true, via: name };
  }
  return null;
}

/** 事实键拼装。`object` 族的字段路径统一带 `props.` 前缀（那是它在响应里的真实位置）。 */
export function factKey(kind, key, path) {
  return `${kind}:${key}#${path || "«整包»"}`;
}

/**
 * 单文件抽取：找出所有「数据源绑定」与由它们派生的字段读取路径。
 *
 * @returns {{
 *   bindings:Array<{sym:string,kind:string,key:string,argsSig:string,line:number,resolved:boolean,rootPrefix:string,via:string}>,
 *   reads:Array<{kind:string,key:string,argsSig:string,path:string,line:number,sym:string,srcLine:number}>,
 *   sourceCalls:number, unresolvedCalls:Array<{line:number,text:string,reason:string}>,
 *   bindingsWithNoRead:Array<{kind:string,key:string,line:number}>
 * }}
 */
export function analyzeFile(ts, src, fileName, endpointMap) {
  const kindScript = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, src ?? "", ts.ScriptTarget.Latest, true, kindScript);
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  /** 作用域符号表：{name, base, src:{kind,key,argsSig,line}, from, to} */
  const syms = [];
  const bindings = [];
  const unresolvedCalls = [];
  /** 每个**物理调用位**只数一次（按 AST 起始位置去重）。
   * ⚠ 不许在多处 `+= 1` 累加 —— 同一个 `await runSolver(...)` 既会被 `useQuery` 的取数函数扫到、
   * 又会被 `const res = await …` 的绑定扫到，重复计数会把「AST 覆盖率」算得虚高，
   * 而覆盖率正是本库用来自证「抽取器没瞎」的那把尺（金丝雀纪律②）。尺子自己虚高＝白装。 */
  const sourceCallPos = new Map(); // pos -> kind

  const declare = (name, base, source, node, scope, strip, requireData) => {
    if (!name || !source) return;
    syms.push({ name, base, src: source, from: scope.getStart(sf), to: scope.getEnd(), strip: strip ?? null, requireData: !!requireData });
  };

  /* ── 4.1 找所有数据源调用，并把它绑到某个符号上 ───────────────────────────── */

  /** queryFn / mutationFn 的返回形状 → [{prefix, node}]；用来吃掉 `{ out: res.data }` 这一层包装。 */
  const returnPrefixes = (fnNode) => {
    const outs = [];
    const scan = (expr) => {
      if (!expr) return;
      if (ts.isObjectLiteralExpression(expr)) {
        for (const p of expr.properties) {
          if (!ts.isPropertyAssignment(p)) continue;
          const nm = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null;
          if (!nm) continue;
          if (/\.data\b/.test(p.initializer.getText(sf))) outs.push(nm);
        }
        return;
      }
    };
    const body = fnNode.body;
    if (!body) return [""];
    if (!ts.isBlock(body)) scan(body);
    else {
      const visit = (n) => {
        if (ts.isReturnStatement(n)) scan(n.expression);
        if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)) return;
        ts.forEachChild(n, visit);
      };
      ts.forEachChild(body, visit);
    }
    return outs.length ? outs : [""];
  };

  /** 在一段子树里找唯一的数据源调用（多于一个 ⇒ 取第一个并记为「多源」）。 */
  const findSourceIn = (node) => {
    const hits = [];
    const visit = (n) => {
      if (ts.isCallExpression(n)) {
        const c = classifySourceCall(ts, n, endpointMap);
        if (c) hits.push({ c, node: n });
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
    return hits;
  };

  /** `useQuery({...})` / `useMutation({...})` 的 fn 属性节点。 */
  const hookFn = (call) => {
    if (!ts.isIdentifier(call.expression)) return null;
    const hook = call.expression.text;
    if (hook !== "useQuery" && hook !== "useMutation" && hook !== "useInfiniteQuery") return null;
    const arg = call.arguments[0];
    if (!arg || !ts.isObjectLiteralExpression(arg)) return null;
    for (const p of arg.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      const nm = ts.isIdentifier(p.name) ? p.name.text : null;
      if (nm === "queryFn" || nm === "mutationFn") {
        if (ts.isArrowFunction(p.initializer) || ts.isFunctionExpression(p.initializer)) return { hook, fn: p.initializer };
      }
    }
    return null;
  };

  const enclosingScope = (n) => {
    for (let p = n.parent; p; p = p.parent) {
      if (ts.isBlock(p) || ts.isSourceFile(p)) return p;
    }
    return sf;
  };

  const visitDecls = (n) => {
    if (ts.isVariableDeclaration(n) && n.initializer) {
      const init = n.initializer;
      const scope = enclosingScope(n);

      // (a) const { data } = useQuery({...})  /  const q = useQuery({...})
      if (ts.isCallExpression(init)) {
        const hf = hookFn(init);
        if (hf) {
          const hits = findSourceIn(hf.fn);
          for (const h of hits) sourceCallPos.set(h.node.getStart(sf), h.c.kind);
          if (!hits.length) {
            unresolvedCalls.push({ line: lineOf(init), text: oneLine(init.getText(sf)), reason: `${hf.hook} 的取数函数里找不到已知数据源调用（可能经自定义封装/变量键下发）` });
          } else {
            const { c, node } = hits[0];
            const source = { kind: c.kind, key: c.key, argsSig: c.argsSig, line: lineOf(node), resolved: c.resolved, via: c.via ?? hf.hook };
            if (!c.resolved) unresolvedCalls.push({ line: lineOf(node), text: oneLine(node.getText(sf)), reason: "数据源键不是字符串字面量（变量/常量表间接下发）⇒ 事实键不可静态定名" });
            const prefixes = returnPrefixes(hf.fn);
            bindings.push({ sym: nameOf(ts, n.name), kind: c.kind, key: c.key, argsSig: c.argsSig, line: lineOf(node), resolved: c.resolved, rootPrefix: prefixes.join("|"), via: source.via });
            // `useMutation` 的结果对象同样是 react-query API（`mutate` / `isPending` / `error` / `data`），
            // 只有 `.data` 是后端下发的事实 ⇒ 与 `useQuery` 同一条纪律，不因 hook 名不同而放宽。
            bindTarget(ts, n.name, source, prefixes, true, declare, scope, sf);
          }
          ts.forEachChild(n, visitDecls);
          return;
        }
        // (b) const res = await invokeSolver(...) / const x = searchObjects(...)
        const c = classifySourceCall(ts, init, endpointMap);
        if (c) {
          sourceCallPos.set(init.getStart(sf), c.kind);
          const source = { kind: c.kind, key: c.key, argsSig: c.argsSig, line: lineOf(init), resolved: c.resolved, via: c.via ?? "direct" };
          if (!c.resolved) unresolvedCalls.push({ line: lineOf(init), text: oneLine(init.getText(sf)), reason: "数据源键不是字符串字面量 ⇒ 事实键不可静态定名" });
          bindings.push({ sym: nameOf(ts, n.name), kind: c.kind, key: c.key, argsSig: c.argsSig, line: lineOf(init), resolved: c.resolved, rootPrefix: "", via: source.via });
          bindTarget(ts, n.name, source, [""], false, declare, scope, sf);
          ts.forEachChild(n, visitDecls);
          return;
        }
      }
      // (c) const res = await invokeSolver(...)  —— await 包一层
      if (ts.isAwaitExpression(init) && ts.isCallExpression(init.expression)) {
        const c = classifySourceCall(ts, init.expression, endpointMap);
        if (c) {
          sourceCallPos.set(init.expression.getStart(sf), c.kind);
          const source = { kind: c.kind, key: c.key, argsSig: c.argsSig, line: lineOf(init), resolved: c.resolved, via: c.via ?? "await" };
          if (!c.resolved) unresolvedCalls.push({ line: lineOf(init), text: oneLine(init.getText(sf)), reason: "数据源键不是字符串字面量 ⇒ 事实键不可静态定名" });
          bindings.push({ sym: nameOf(ts, n.name), kind: c.kind, key: c.key, argsSig: c.argsSig, line: lineOf(init), resolved: c.resolved, rootPrefix: "", via: source.via });
          bindTarget(ts, n.name, source, [""], false, declare, scope, sf);
          ts.forEachChild(n, visitDecls);
          return;
        }
      }
    }
    ts.forEachChild(n, visitDecls);
  };
  visitDecls(sf);

  // 裸调用（不绑到任何符号）也要计入，否则对总数会假性偏低 —— 位置去重，同一个调用不会数两次。
  {
    const visit = (n) => {
      if (ts.isCallExpression(n)) {
        const c = classifySourceCall(ts, n, endpointMap);
        if (c) sourceCallPos.set(n.getStart(sf), c.kind);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  const sourceCalls = { solver: 0, object: 0, rest: 0, total: sourceCallPos.size };
  for (const k of sourceCallPos.values()) sourceCalls[k] = (sourceCalls[k] ?? 0) + 1;

  /* ── 4.2 从绑定符号出发，沿属性链现算字段路径（含回调/for-of 元素绑定，最多传播 4 轮）─ */

  const reads = [];
  const seenRead = new Set();
  for (let round = 0; round < 4; round++) {
    const before = syms.length;
    const snapshot = syms.slice();
    const visit = (n) => {
      if (ts.isIdentifier(n)) {
        const pos = n.getStart(sf);
        const hit = snapshot.find((s) => s.name === n.text && pos >= s.from && pos <= s.to && !isDeclName(ts, n));
        if (hit) {
          const r = walkPath(ts, n, sf);
          const segs = applyStrip(hit, r.segs);
          if (segs === null) { ts.forEachChild(n, visit); return; } // 读的是包装层的兄弟键（`snapshotVersion`）⇒ 不是这个源的事实
          const full = joinPath(hit.base, segs);
          if (r.iter && r.callNode) {
            // 回调首参 ⇒ 元素符号
            const fn = r.callNode.arguments?.[0];
            if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
              const p0 = fn.parameters?.[0];
              if (p0) bindTarget(ts, p0.name, hit.src, [""], false, (nm, base2, s2) => {
                if (!syms.some((x) => x.name === nm && x.from === fn.getStart(sf))) {
                  syms.push({ name: nm, base: joinPath(full, ["[]"]) + (base2 ? "." + base2 : ""), src: hit.src, from: fn.getStart(sf), to: fn.getEnd() });
                }
              }, fn, sf);
            }
          }
          if (full && !r.iter) {
            const clean = normalizePath(full);
            // 源键没解析出来（`object:?` / `solver:?`）⇒ **不许**进注册表。
            // 第一版让它们进来了，后果是**不同对象类型的读取被并进同一条 `object:?#items`**，
            // 凭空造出一个「7 屏都有」的伪跨屏对 —— B-3 拿它去比会比两个本来就不同的数。
            // 这类调用位一律落进 `unresolvedCalls`（已在绑定处登记），在审计文档里如实留白。
            if (clean && hit.src.resolved !== false) {
              const kk = `${hit.src.kind}|${hit.src.key}|${clean}|${lineOf(n)}`;
              if (!seenRead.has(kk)) {
                seenRead.add(kk);
                reads.push({ kind: hit.src.kind, key: hit.src.key, argsSig: hit.src.argsSig, path: clean, line: lineOf(n), sym: hit.name, srcLine: hit.src.line });
              }
            }
          }
          // 二次绑定：`const cards = data.cards`
          const declParent = r.endNode?.parent;
          if (declParent && ts.isVariableDeclaration(declParent) && declParent.initializer && containsNode(declParent.initializer, r.endNode)) {
            const scope2 = declParent.parent?.parent ?? sf;
            bindTarget(ts, declParent.name, hit.src, [""], false, (nm, base2, s2) => {
              const b = joinPath(full, base2 ? [base2] : []);
              if (!syms.some((x) => x.name === nm && x.base === b)) syms.push({ name: nm, base: b, src: hit.src, from: scope2.getStart(sf), to: scope2.getEnd() });
            }, declParent, sf);
          }
        }
      }
      // for (const l of X)
      if (ts.isForOfStatement(n) && ts.isIdentifier(getRootId(ts, n.expression) ?? {})) {
        const rootId = getRootId(ts, n.expression);
        const hit = rootId && snapshot.find((s) => s.name === rootId.text && rootId.getStart(sf) >= s.from && rootId.getStart(sf) <= s.to);
        if (hit) {
          const r = walkPath(ts, rootId, sf);
          const segsFo = applyStrip(hit, r.segs);
          const full = segsFo === null ? null : joinPath(hit.base, segsFo);
          const decl = n.initializer;
          if (full === null) { ts.forEachChild(n, visit); return; }
          if (ts.isVariableDeclarationList(decl) && decl.declarations[0]) {
            bindTarget(ts, decl.declarations[0].name, hit.src, [""], false, (nm, base2) => {
              const b = joinPath(joinPath(full, ["[]"]), base2 ? [base2] : []);
              if (!syms.some((x) => x.name === nm && x.base === b)) syms.push({ name: nm, base: b, src: hit.src, from: n.getStart(sf), to: n.getEnd() });
            }, n, sf);
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    if (syms.length === before) break;
  }

  const readKeys = new Set(reads.map((r) => `${r.kind}|${r.key}`));
  const bindingsWithNoRead = bindings.filter((b) => !readKeys.has(`${b.kind}|${b.key}`)).map((b) => ({ kind: b.kind, key: b.key, line: b.line }));

  return { bindings, reads, sourceCalls, unresolvedCalls, bindingsWithNoRead };
}

/* ═══════════════════ 五 · AST 小工具 ═══════════════════════════════════════ */

function oneLine(s) { return String(s).replace(/\s+/g, " ").slice(0, 160); }

function nameOf(ts, name) {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isObjectBindingPattern(name)) return name.elements.map((e) => (ts.isIdentifier(e.name) ? e.name.text : "?")).join("+");
  return "?";
}

function isDeclName(ts, id) {
  const p = id.parent;
  return !!p && ((ts.isVariableDeclaration(p) && p.name === id) || ts.isParameter(p) || ts.isBindingElement(p) || ts.isPropertyAssignment(p) && p.name === id);
}

function containsNode(root, node) {
  return node.getStart() >= root.getStart() && node.getEnd() <= root.getEnd();
}

/**
 * 剥掉本地包装层。`hit.strip` 非空时：
 *  · 首段（跳过可选的 `data`）命中包装键 ⇒ 剥掉它，其余照拼；
 *  · 首段不在包装键里 ⇒ 返回 `null`，表示「这个读取根本不是该数据源的字段」
 *    （`{ out: res.data, snapshotVersion }` 里的 `snapshotVersion` 是前端自己塞的元数据，不是事实）。
 */
function applyStrip(hit, segs) {
  let s = segs.slice();
  if (hit.requireData) {
    if (s[0] !== "data") return null;   // react-query 的 isLoading/error/refetch… 一律不是事实
    s = s.slice(1);
  }
  if (!hit.strip || !hit.strip.length) return s;
  if (!s.length) return [];
  if (!hit.strip.includes(s[0])) return null;
  return s.slice(1);
}

function getRootId(ts, expr) {
  let n = expr;
  for (let i = 0; i < 12 && n; i++) {
    if (ts.isIdentifier(n)) return n;
    if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) { n = n.expression; continue; }
    if (ts.isNonNullExpression(n) || ts.isParenthesizedExpression(n) || ts.isAsExpression(n)) { n = n.expression; continue; }
    if (ts.isBinaryExpression(n)) { n = n.left; continue; }
    if (ts.isCallExpression(n)) { n = n.expression; continue; }
    return null;
  }
  return null;
}

/**
 * 把「绑定目标」（identifier 或解构模式）登记成符号。
 * `useQuery` 结果有两种拿法，必须分开处理，否则路径会差一层 `data`：
 *   · `const { data: bn } = useQuery(...)` ⇒ bn 直接就是结果   （base = rootPrefix）
 *   · `const q = useQuery(...)`            ⇒ 要写 `q.data.…`   （base = ""，路径里那个 `data` 由 normalizePath 吃掉）
 */
function bindTarget(ts, nameNode, source, prefixes, isQueryHook, declare, scope, sf) {
  // `prefixes` 是**要剥掉的包装层**，不是要拼上去的前缀：
  //   `queryFn: async () => ({ out: res.data, snapshotVersion })` ⇒ 屏上写 `data.out.threshold`，
  //   而它指的事实是 `solver:<k>#threshold`。`out` 是本地包装，不是后端字段 —— 拼上去就造了个假事实键，
  //   且它与另一屏直接 `data.threshold` 读同一个数**对不上**，B-3 会漏掉这一对（正是本表要抓的那一类）。
  const strip = (prefixes ?? []).filter(Boolean);
  if (ts.isIdentifier(nameNode)) {
    // `const q = useQuery(...)` ⇒ **只有 `q.data.*` 是事实**。`q.isLoading` / `q.error` / `q.refetch`
    // 是 react-query 自己的 API，不是后端下发的字段 —— 第一版把它们当成了事实，
    // 于是注册表里冒出 `object:Cadence#isLoading` 这种「两屏都有」的伪跨屏对。
    // 判据落在**结构**（必须经 `.data`）而不是**字段名黑名单**：黑名单迟早被例外吃光，
    // 而且 `error` 这种名字后端真的可能下发（`mitigation_select` 就有）。
    declare(nameNode.text, "", source, nameNode, scope, strip.length ? strip : null, !!isQueryHook);
    return;
  }
  if (ts.isObjectBindingPattern(nameNode)) {
    for (const el of nameNode.elements) {
      const prop = el.propertyName ? (ts.isIdentifier(el.propertyName) ? el.propertyName.text : null) : (ts.isIdentifier(el.name) ? el.name.text : null);
      const local = ts.isIdentifier(el.name) ? el.name.text : null;
      if (!prop || !local) continue;
      if (isQueryHook) {
        if (prop !== "data") continue; // isLoading/error 不是事实
        declare(local, "", source, el, scope, strip.length ? strip : null);
      } else {
        // 非 hook 的解构（`const { items } = await queryObjectsPaged(...)`）：解构键本身就是字段第一段
        if (strip.length && !strip.includes(prop)) continue;
        declare(local, strip.length ? "" : prop, source, el, scope, null);
      }
    }
  }
}

/** 从标识符向上拼字段路径；命中数组迭代方法则停下并交出回调节点。 */
function walkPath(ts, idNode, sf) {
  const segs = [];
  let node = idNode;
  for (let i = 0; i < 24; i++) {
    const p = node.parent;
    if (!p) break;
    if (ts.isNonNullExpression(p) || ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression?.(p)) { node = p; continue; }
    if (ts.isBinaryExpression(p) && p.left === node &&
        (p.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || p.operatorToken.kind === ts.SyntaxKind.BarBarToken)) { node = p; continue; }
    if (ts.isPropertyAccessExpression(p) && p.expression === node) {
      const nm = p.name.text;
      if (ITER_METHODS.has(nm) && p.parent && ts.isCallExpression(p.parent) && p.parent.expression === p) {
        return { segs, iter: true, callNode: p.parent, endNode: p.parent };
      }
      segs.push(nm);
      node = p;
      continue;
    }
    if (ts.isElementAccessExpression(p) && p.expression === node) {
      const a = p.argumentExpression;
      segs.push(a && ts.isStringLiteral(a) ? a.text : "[]");
      node = p;
      continue;
    }
    break;
  }
  return { segs, iter: false, callNode: null, endNode: node };
}

function joinPath(base, segs) {
  const parts = [];
  if (base) parts.push(base);
  for (const s of segs ?? []) parts.push(s);
  return parts.filter(Boolean).join(".").replace(/\.\[\]/g, "[]");
}

/**
 * 路径归一：
 *  · 开头的 `data` 吃掉（`const q = useQuery(...)` ⇒ `q.data.items` 与 `{data} = useQuery` 的 `items` 是同一条）
 *  · 尾巴上的非字段段（`length` / `toString` …）截掉
 *  · 连续 `[]` 合一
 *  · 只剩空串 ⇒ 不是一条字段读取（整包传递，另计）
 */
export function normalizePath(path) {
  let p = String(path ?? "");
  p = p.replace(/^data(\.|\[|$)/, (m, g) => (g === "." ? "" : g));
  p = p.replace(/(\[\])+/g, "[]");
  const segs = p.split(".").filter(Boolean);
  while (segs.length && NON_FIELD_SEGS.has(segs[segs.length - 1].replace(/\[\]$/, ""))) segs.pop();
  return segs.join(".");
}

/* ═══════════════════ 六 · 全仓现算：事实 → 页面集合 ═════════════════════════ */

/**
 * @param {object} o
 * @param {Map<string,string>} o.files    仓内相对路径 → 源码（`apps/frontend-shell/src/**`）
 * @param {Array<{key:string,kind:string,file:string,why:string}>} o.pages 页名册
 * @returns {{facts:Array, pairs:Array, pages:Array, coverage:object, unresolved:Array, stats:object}}
 */
export function computeFactUsage({ ts, files, pages, endpointMap }) {
  const hasFile = (p) => files.has(p);

  // 6.1 import 图
  const graph = new Map();
  for (const [f, src] of files) graph.set(f, fileImports(ts, src, f, hasFile));

  // 6.2 逐文件抽取
  const perFile = new Map();
  const lex = { solver: 0, object: 0, total: 0 };
  const ast = { solver: 0, object: 0, rest: 0, total: 0 };
  const unresolved = [];
  for (const [f, src] of files) {
    if (f === ENDPOINTS_FILE) continue; // 端点定义文件本身不是屏
    const a = analyzeFile(ts, src, f, endpointMap);
    perFile.set(f, a);
    for (const k of ["solver", "object", "rest", "total"]) ast[k] += a.sourceCalls[k] ?? 0;
    const l = countSourceCallsLexically(src);
    lex.solver += l.solver; lex.object += l.object; lex.total += l.total;
    for (const u of a.unresolvedCalls) unresolved.push({ file: f, ...u });
  }

  // 6.3 页 → 闭包 → 读取位
  const factMap = new Map(); // factKey -> { kind,key,path,argsSigs:Set, pages:Map<pageKey, why[]> }
  const pageOut = [];
  for (const p of pages) {
    if (!files.has(p.file)) { pageOut.push({ ...p, files: 0, reads: 0, missing: true }); continue; }
    const clo = importClosure(p.file, graph);
    let n = 0;
    for (const f of clo) {
      const a = perFile.get(f);
      if (!a) continue;
      for (const r of a.reads) {
        if (!r.path) continue;
        const fk = factKey(r.kind, r.key, r.path);
        let e = factMap.get(fk);
        if (!e) { e = { fact: fk, kind: r.kind, key: r.key, path: r.path, argsSigs: new Set(), pages: new Map() }; factMap.set(fk, e); }
        e.argsSigs.add(r.argsSig);
        if (!e.pages.has(p.key)) e.pages.set(p.key, []);
        const why = `${f}:${r.line}（绑定源 ${f}:${r.srcLine} · 符号 \`${r.sym}\` · args[${r.argsSig}]${f === p.file ? "" : " · 经 import 闭包"}）`;
        if (e.pages.get(p.key).length < 6 && !e.pages.get(p.key).includes(why)) e.pages.get(p.key).push(why);
        n++;
      }
    }
    pageOut.push({ ...p, files: clo.size, reads: n, missing: false });
  }

  // 6.4 ≥2 屏的事实 ⇒ B-3 真正要比的那些对
  const facts = [...factMap.values()]
    .map((e) => ({ fact: e.fact, kind: e.kind, key: e.key, path: e.path, argsSigs: [...e.argsSigs].sort(), pages: [...e.pages.keys()].sort(), why: Object.fromEntries(e.pages) }))
    .sort((a, b) => (b.pages.length - a.pages.length) || a.fact.localeCompare(b.fact));

  const multi = facts.filter((f) => f.pages.length >= 2);
  const pairs = [];
  for (const f of multi) {
    for (let i = 0; i < f.pages.length; i++) {
      for (let j = i + 1; j < f.pages.length; j++) {
        pairs.push({
          fact: f.fact,
          a: f.pages[i],
          b: f.pages[j],
          verdict: f.argsSigs.length === 1 ? "EQUAL-EXPECTED" : "CALIBER-DIVERGENT",
          argsSigs: f.argsSigs,
        });
      }
    }
  }

  /**
   * **独立口径对总数**（金丝雀纪律②：金丝雀全中也不保证抽取器覆盖全）。
   * 两把尺**逐族**对，不许拿总数对总数 —— 词面尺只量 solver/object 两族（rest 族靠端点表解析，
   * 词面量不了），拿含 rest 的 AST 总数去盖住 solver 的缺口，正是「我用 X 当作 Y 的证据」。
   * 判负方向：**任一族 AST < 词面 ⇒ 抽取器瞎了**（该报「工具坏了」而不是「注册表就这么大」）。
   */
  const coverage = {
    lexical: lex,
    ast,
    solverCovered: ast.solver >= lex.solver,
    objectCovered: ast.object >= lex.object,
    ok: ast.solver >= lex.solver && ast.object >= lex.object,
    solverRatio: lex.solver === 0 ? null : Number((ast.solver / lex.solver).toFixed(3)),
    objectRatio: lex.object === 0 ? null : Number((ast.object / lex.object).toFixed(3)),
  };

  return {
    facts,
    multi,
    pairs,
    pages: pageOut,
    coverage,
    unresolved,
    stats: {
      files: files.size,
      pages: pages.length,
      facts: facts.length,
      multiScreenFacts: multi.length,
      pairs: pairs.length,
      equalExpected: pairs.filter((p) => p.verdict === "EQUAL-EXPECTED").length,
      caliberDivergent: pairs.filter((p) => p.verdict === "CALIBER-DIVERGENT").length,
      byKind: {
        solver: facts.filter((f) => f.kind === "solver").length,
        object: facts.filter((f) => f.kind === "object").length,
        rest: facts.filter((f) => f.kind === "rest").length,
      },
    },
  };
}

/* ═══════════════════ 七 · 金丝雀 —— 喂的是上面那些函数本体 ═════════════════ */

/**
 * 金丝雀样例。**形状取自生产实物**（金丝雀纪律③）：
 *  · `RiskBoardView.tsx:158` 的多行 `useQuery({queryKey, queryFn: async()=>{ … Schema.parse(res.data) }})`
 *  · `OrderChainView.tsx:376` 的 `{ out: res.data as X, snapshotVersion }` 包一层
 *  · `GlobalSimView.tsx:198` 的 `useQuery({queryFn: () => searchObjects("Order","")})` + `(orders.data?.items ?? []).map((o)=>o.props.so)`
 *  · `GlobalSimView.tsx:209` 的 `for (const l of linesQ.data?.items ?? [])`
 *  · 一条**注释里**的假读取（注释不算数）
 *  · 一条**变量键**下发的求解器（`invokeSolver(dynKey, …)` ⇒ 必须落进 unresolved，不许静默丢）
 */
export const CANARY_FILES = new Map([
  ["apps/frontend-shell/src/api/endpoints.ts", [
    'export const invokeSolver = (solverKey: string, args: Record<string, unknown>) =>',
    '  api.a<{ data: unknown; snapshotVersion: string }>(`/a/v1/solvers/${solverKey}/invoke`, { body: { args } });',
    'export const runSolver = (solverKey: string, args: Record<string, unknown>, signal?: AbortSignal) =>',
    '  api.b<{ data: unknown; snapshotVersion: string }>(`/b/v1/solvers/${encodeURIComponent(solverKey)}/run`, { body: { args }, signal });',
    'export const searchObjects = (type: string, q: string) => api.a<{ items: ObjRow[] }>(`/a/v1/objects?type=${type}&q=${q}`);',
    'export const fetchWorkspace = async (): Promise<Workspace> => api.a<Workspace>("/a/v1/me/workspace");',
  ].join("\n")],
  ["apps/frontend-shell/src/views/AlphaView.tsx", [
    'import { useQuery } from "@tanstack/react-query";',
    'import { invokeSolver, searchObjects } from "@/api/endpoints";',
    'import { SharedPanel } from "./SharedPanel";',
    // 生产实物：`useScenarioLaunch.ts:7` 逐字写着 `import { resolveViewKey } from "@/views/registry"`
    // —— 一条**值导入**，静态可达 registry。它是金丝雀⑯（动态 import 不入图）能被证伪的前提：
    // 没有这条边，registry 根本不在任何页的闭包里，⑯ 永远不会红 = 装饰品。
    'import { resolveViewKey } from "./registry";',
    'import { RiskTimelineOutputSchema } from "@platform/contracts";',
    '',
    '// 注释里的假读取：invokeSolver("ghost_solver", {}) 与 data.ghostField —— 一条都不许进注册表',
    'export default function AlphaView() {',
    '  const { data, isLoading } = useQuery({',
    '    queryKey: ["a", "risk-timeline", { horizon }],',
    '    queryFn: async () => {',
    '      const res = await invokeSolver("risk_timeline", { horizon });',
    '      return RiskTimelineOutputSchema.parse(res.data);',
    '    },',
    '  });',
    '  const orders = useQuery({ queryKey: ["a", "objects", { type: "Order" }], queryFn: () => searchObjects("Order", "") });',
    '  const soList = (orders.data?.items ?? []).map((o) => String(o.props.so));',
    '  if (isLoading || !data) return null;',
    '  const threshold = data.threshold;',
    '  return <div>{threshold}{data.cards[0].base}{soList.length}<SharedPanel /></div>;',
    '}',
  ].join("\n")],
  ["apps/frontend-shell/src/views/BetaView.tsx", [
    'import { useQuery } from "@tanstack/react-query";',
    'import { runSolver, searchObjects } from "@/api/endpoints";',
    // ⚠ 形状取自生产实物：本仓 20+ 视图逐字写着 `import type { ViewRendererProps } from "./registry"`。
    //   这条**纯类型边**曾把 registry.ts（连同它 lazy 到的全部 28 个渲染器）拖进闭包 ⇒
    //   23 个互不相干的页闭包全变成 104 文件 / 510 读取位。金丝雀当时全中，扫描面却是错的。
    'import type { ViewRendererProps } from "./registry";',
    '',
    'export default function BetaView() {',
    '  const { data } = useQuery({',
    '    queryKey: ["b", "risk-timeline", { horizon: 14 }],',
    '    queryFn: async () => {',
    '      const res = await runSolver("risk_timeline", { horizon, base });',
    '      return { out: res.data as RiskOut, snapshotVersion: res.snapshotVersion };',
    '    },',
    '  });',
    '  const linesQ = useQuery({ queryKey: ["a", "objects", "Line"], queryFn: () => searchObjects("Line", ""), retry: false });',
    '  const names: string[] = [];',
    '  for (const l of linesQ.data?.items ?? []) {',
    '    names.push(String(l.props.baseId));',
    '  }',
    '  const dyn = useQuery({ queryKey: ["x"], queryFn: () => invokeSolver(dynKey, {}) });',
    // react-query 自己的 API：`isLoading` / `error` / `mutate` 一律不是后端下发的事实
    '  if (linesQ.isLoading || linesQ.error) return null;',
    '  return <div>{data?.out.threshold}{names.length}{dyn.data}</div>;',
    '}',
  ].join("\n")],
  ["apps/frontend-shell/src/views/SharedPanel.tsx", [
    'import { useQuery } from "@tanstack/react-query";',
    'import { invokeSolver } from "@/api/endpoints";',
    '',
    'export function SharedPanel() {',
    '  const { data: mit } = useQuery({',
    '    queryKey: ["a", "mitigation_select"],',
    '    queryFn: async () => (await invokeSolver("mitigation_select", { baseName })).data as MitOut,',
    '  });',
    '  return <div>{mit?.plans[0].deltaTightness}</div>;',
    '}',
  ].join("\n")],
  ["apps/frontend-shell/src/views/registry.ts", [
    'const VIEW_ALIAS: Record<string, string> = {',
    '  alpha: "alpha-view",',
    '};',
    'import { TypeLeakPanel } from "./TypeLeakPanel";',
    'registerRenderer("alpha-view", () => import("./AlphaView"));',
    'registerRenderer("beta-view", () => import("./BetaView"));',
    'registerRenderer("delta-view", () => import("./DeltaView"));',
  ].join("\n")],
  // registry 的**静态**下游。只有当「类型导入也入图」时，beta-view 才会经
  // `import type … from "./registry"` 吸到它 ⇒ 金丝雀⑮ 借此可被证伪（变异即红）。
  ["apps/frontend-shell/src/views/TypeLeakPanel.tsx", [
    'import { useQuery } from "@tanstack/react-query";',
    'import { invokeSolver } from "@/api/endpoints";',
    '',
    'export function TypeLeakPanel() {',
    '  const { data: t } = useQuery({ queryKey: ["t"], queryFn: async () => (await invokeSolver("type_leak_solver", {})).data as T });',
    '  return <div>{t?.typeLeakField}</div>;',
    '}',
  ].join("\n")],
  // 只被 registry 的动态 `import()` 触达的页 —— 它读的事实**不许**记到 beta-view 头上
  // （动态 import = 代码分割边界 = 另一个页，不是本页的子组件）。
  ["apps/frontend-shell/src/views/DeltaView.tsx", [
    'import { useQuery } from "@tanstack/react-query";',
    'import { invokeSolver } from "@/api/endpoints";',
    '',
    'export default function DeltaView() {',
    '  const { data: d } = useQuery({ queryKey: ["d"], queryFn: async () => (await invokeSolver("delta_only_solver", {})).data as D });',
    '  return <div>{d?.deltaOnlyField}</div>;',
    '}',
  ].join("\n")],
  ["apps/frontend-shell/src/App.tsx", [
    'const GammaPage = lazy(() => import("@/pages/admin/GammaPage"));',
    '      admin("gamma", <GammaPage />),',
  ].join("\n")],
  ["apps/frontend-shell/src/pages/admin/GammaPage.tsx", [
    'import { useQuery } from "@tanstack/react-query";',
    'import { fetchWorkspace } from "@/api/endpoints";',
    '',
    'export default function GammaPage() {',
    '  const { data: ws } = useQuery({ queryKey: ["ws"], queryFn: () => fetchWorkspace() });',
    '  return <div>{ws?.tenantId}</div>;',
    '}',
  ].join("\n")],
]);

/**
 * 金丝雀判据编号（**现算条数的单一来源**）。每条钉一个真实踩过的坑：
 *  ①端点解析 ②admin 路由现算 ③多行 useQuery+Schema 包装 ④数组下标归一 ⑤`{out:…}` 包装
 *  ⑥回调元素绑定 ⑦for-of 元素绑定 ⑧import 闭包 ⑨注释不算 ⑩跨屏对与口径分家
 *  ⑪变量键落 unresolved ⑫依据链非空 ⑬独立词面口径逐族对总数 ⑭调用位去重
 *  ⑮类型导入不入图 ⑯动态 import 不入图 ⑰react-query API 不是事实 ⑱未解析源键不进表
 */
export const CANARY_IDS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫", "⑬", "⑭", "⑮", "⑯", "⑰", "⑱"];

/** 金丝雀：任一不符 ⇒ 调用方必须报「工具坏了」并 RC=2，**不许**报「注册表就这么大」。 */
export function factUsageCanary() {
  const bad = [];
  /** 判据条数**现算**（`CANARY_IDS` 是逐条编号的单一来源）——写死一个 `14/14` 迟早过期，
   *  而「金丝雀 N 条全中」这句话一旦过期，它就从证据退化成装饰。 */
  const total = CANARY_IDS.length;
  let ts;
  try { ts = loadTs(); } catch (e) { return { ok: false, bad: [`typescript 加载失败：${e?.message || e}`], result: null }; }

  const files = CANARY_FILES;
  const endpointMap = parseEndpointsModule(ts, files.get(ENDPOINTS_FILE));

  // ① 端点解析：候选①「太粗」的机制必须被现算出来 —— 两个求解器函数塌缩成两条模板
  if (endpointMap.invokeSolver?.url !== "/a/v1/solvers/{}/invoke") bad.push(`①invokeSolver 端点=${JSON.stringify(endpointMap.invokeSolver)}`);
  if (endpointMap.fetchWorkspace?.url !== "/a/v1/me/workspace") bad.push(`①fetchWorkspace 端点=${JSON.stringify(endpointMap.fetchWorkspace)}`);

  const pages = buildPageRoster({
    registrySrc: files.get(REGISTRY_FILE),
    appSrc: files.get(APP_FILE),
    rendererFiles: { "alpha-view": "apps/frontend-shell/src/views/AlphaView.tsx", "beta-view": "apps/frontend-shell/src/views/BetaView.tsx" },
    staticRouteFiles: {},
  });
  if (!pages.some((p) => p.key === "admin/gamma")) bad.push(`②admin 路由没被现算出来（pages=${pages.map((p) => p.key).join(",")}）`);

  const r = computeFactUsage({ ts, files, pages, endpointMap });
  const has = (f) => r.facts.some((x) => x.fact === f);
  const pagesOf = (f) => (r.facts.find((x) => x.fact === f)?.pages ?? []).join(",");

  // ③ 多行 useQuery + Schema.parse(res.data) 包一层 ⇒ 字段路径要能穿透
  if (!has("solver:risk_timeline#threshold")) bad.push(`③多行 useQuery + Schema.parse 包装穿不透（facts=${r.facts.map((f) => f.fact).join(" | ").slice(0, 400)}）`);
  // ④ 数组下标归一 `cards[0].base` ⇒ `cards[].base`
  if (!has("solver:risk_timeline#cards[].base")) bad.push("④数组下标未归一成 `[]`（cards[0].base）");
  // ⑤ `{ out: res.data }` 包一层 ⇒ 前缀 `out` 要被吃掉后仍指向同一事实
  if (!has("solver:risk_timeline#out.threshold") && !has("solver:risk_timeline#threshold")) bad.push("⑤`{ out: res.data }` 包装未解析");
  // ⑥ 回调元素绑定：`(orders.data?.items ?? []).map((o) => o.props.so)`
  if (!has("object:Order#items[].props.so")) bad.push(`⑥回调元素绑定失效（object 族 facts=${r.facts.filter((f) => f.kind === "object").map((f) => f.fact).join(" | ")}）`);
  // ⑦ for-of 元素绑定：`for (const l of linesQ.data?.items ?? [])`
  if (!has("object:Line#items[].props.baseId")) bad.push("⑦for-of 元素绑定失效");
  // ⑧ import 闭包：SharedPanel 只被 AlphaView import ⇒ 它读的事实必须记在 alpha-view 名下
  if (pagesOf("solver:mitigation_select#plans[].deltaTightness") !== "alpha-view") {
    bad.push(`⑧import 闭包失效（mitigation_select 的页集合=「${pagesOf("solver:mitigation_select#plans[].deltaTightness")}」应为「alpha-view」）`);
  }
  // ⑨ 注释里的假读取一条都不许进来
  if (r.facts.some((f) => /ghost/.test(f.fact))) bad.push("⑨注释里的假读取混进了注册表");
  // ⑩ 跨屏对：risk_timeline#threshold 两屏都有，且 args 不同 ⇒ CALIBER-DIVERGENT
  const pr = r.pairs.find((p) => p.fact === "solver:risk_timeline#threshold");
  if (!pr) bad.push(`⑩跨屏对没算出来（pairs=${r.pairs.map((p) => p.fact).join(" | ").slice(0, 300)}）`);
  else if (pr.verdict !== "CALIBER-DIVERGENT") bad.push(`⑩口径分家未识别（verdict=${pr.verdict} argsSigs=${JSON.stringify(pr.argsSigs)}）`);
  // ⑪ 变量键下发的求解器必须落进 unresolved（不许静默丢）
  if (!r.unresolved.some((u) => /不是字符串字面量|找不到已知数据源/.test(u.reason))) {
    bad.push(`⑪变量键求解器没落进 unresolved（unresolved=${JSON.stringify(r.unresolved).slice(0, 300)}）`);
  }
  // ⑫ 依据链非空：每条事实的每个页都要说得出在哪个 file:line 读的
  const noWhy = r.facts.filter((f) => f.pages.some((pg) => !(f.why?.[pg]?.length)));
  if (noWhy.length) bad.push(`⑫依据链为空：${noWhy.map((f) => f.fact).join(" ")}`);
  // ⑬ 独立口径**逐族**对总数（金丝雀纪律②）：词面尺 solver=3 / object=2，AST 不许更少
  if (r.coverage.lexical.solver !== 5 || r.coverage.lexical.object !== 2) {
    bad.push(`⑬词面尺自身读数异常（solver=${r.coverage.lexical.solver} object=${r.coverage.lexical.object}，应为 5/2）⇒ **第二把尺坏了**，它无法再给 AST 对账`);
  }
  if (!r.coverage.ok) bad.push(`⑬AST 逐族少于独立词面口径 ⇒ 抽取器瞎了（${JSON.stringify(r.coverage)}）`);
  // ⑭ 计数不许重复：同一个 `await runSolver(...)` 会被 useQuery 与 `const res =` 两条路各扫一次，
  //    重复计数会把覆盖率算虚高。金丝雀样例里 solver 调用位物理上就 6 个（含 dynKey / DeltaView / TypeLeakPanel 那三个）。
  if (r.coverage.ast.solver !== 6) bad.push(`⑭solver 调用位计数=${r.coverage.ast.solver}，应为 6（5 个字面量键 + 1 个变量键）⇒ 位置去重失效或漏认`);

  /* ── ⑮⑯⑰⑱ 是**扫描面**判据，不是解析判据（金丝雀纪律①）──────────────────────
   * 这四条各钉住一个「金丝雀全中、扫描面却是错的」的实测形态。没有它们，
   * 抽取器越瞎门越绿：把不该算的算进来（⑮⑯）或把不是事实的当事实（⑰⑱），
   * 注册表照样"有内容"，而 B-3 拿它去比会比错。 */
  // ⑮ **类型导入不入图**：BetaView 只 `import type … from "./registry"`，
  //    不许因此把 registry 动态 lazy 到的 AlphaView/DeltaView 的事实记到 beta-view 头上。
  const typeLeak = r.facts.find((f) => f.key === "type_leak_solver");
  if (!typeLeak) bad.push("⑮金丝雀自身失效：`type_leak_solver` 一条都没抽到 ⇒ 样例或抽取器坏了，本条无从证伪");
  else if (typeLeak.pages.includes("beta-view")) {
    bad.push(`⑮类型导入被当成了组合边（beta-view 经 \`import type … from "./registry"\` 吸进了 registry 静态下游的事实）⇒ 闭包爆炸，跨屏对全是噪声。实测页集合=${typeLeak.pages.join(",")}`);
  }
  // ⑯ **动态 import 不入图**：DeltaView 只被 registry 的 `() => import("./DeltaView")` 触达，
  //    它读的事实不许出现在任何页名下（它自己不在页名册里）。
  const deltaLeak = r.facts.filter((f) => f.key === "delta_only_solver");
  if (deltaLeak.length) {
    bad.push(`⑯动态 import 被当成了组合边（\`delta_only_solver\` 只经 registry 的 () => import("./DeltaView") 可达，却泄漏到 ${deltaLeak.map((f) => f.pages.join("/")).join(",")}）—— 那是把「别的页读了什么」记到本页头上`);
  }
  // ⑰ **react-query 自身 API 不是事实**：`linesQ.isLoading` / `linesQ.error` 不许成为字段路径。
  const hookApi = r.facts.filter((f) => /#(isLoading|error|isPending|mutate|refetch|isFetching)\b/.test(f.fact));
  if (hookApi.length) bad.push(`⑰react-query API 被当成了后端字段：${hookApi.map((f) => f.fact).join(" ")}`);
  // ⑱ **源键没解析出来的不许进注册表**：否则不同对象类型会被并进同一条 `object:?#items`，
  //    凭空造出「N 屏都有」的伪跨屏对。它们该落在 unresolved 里等人补，不是混进结论里。
  const qmark = r.facts.filter((f) => /^[a-z]+:\?#/.test(f.fact));
  if (qmark.length) bad.push(`⑱未解析源键混进了注册表：${qmark.map((f) => f.fact).join(" ")}`);

  return { ok: bad.length === 0, bad, total, result: r, endpointMap, pages };
}
