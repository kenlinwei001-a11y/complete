/**
 * ══ 推演页名册 · **判据的单一来源**（WO-INFER-PAGE-SSOT · 闭 `G-GATE-ROSTER-HANDCOPIED`）══
 *
 * ── 它治什么病 ────────────────────────────────────────────────────────────────
 * 本仓多道门要回答同一个问题：「**哪些页面是推演页**」。此前每道门**各自把名单手抄成数组**
 * （`check-edge-active-mounts.mjs` 的 `PAGES` 9 条 · `edge-active.seam.test.tsx` 的第二份 9 条）。
 * 后果不是「名单不准」，是**新增的推演页永远绿** —— 不在名单里 ⇒ 不受检 ⇒ 门证明的只是
 * 「它问过的那些是对的」，证明不了「该问的都问了」。
 * 形态（铁律 0.6 句式）：**「我用『名单里那几个都合格』当作『所有该合格的都合格』的证据。」**
 *
 * ── 为什么本文件存的是**判据**，不是名单（这是本单的核心裁决）────────────────────
 * 三个候选权威**没有一个能单独当权威**，且原因是结构性的，不是谁维护得不好（实测见下）：
 *
 *  ① `BUILTIN_VIEWS`（`apps/datacore/src/synthetic/view-manifest.ts`）—— **按设计不完整**。
 *     它的头注自己写着 decision-play「不在此列且不种入 … 诚实排除」，并把
 *     what-if / cleanroom-attr / disruption-radius / optimize-whatif 归为「净室通用页」走
 *     **前端专用 route**。它是「后端派单」这**半个机制**的单一来源，不是全体推演页的册子。
 *     实测：词面命中 3 页，而全集 12 页 ⇒ 拿它当权威直接漏 9。
 *
 *  ② `features.ts` 的 VIEW 级注册 —— **它本身就是 ① 的派生物**
 *     （`features.ts` 顶部 `...builtInViewFeatureDefs()` + `VIEW_FEATURE_MAP` 的
 *     `...builtInViewFeatureMap()`）。拿派生物当权威 = 循环。
 *     ⚠ 附带治好一个真缺陷：只扫**字面量**行的抽取器在这里只看得见 `sim.sandbox` **1 条**，
 *     而运行时真注册的推演类 VIEW 功能是 **4 条**（另 3 条由 spread 派生进来）。
 *     本文件因此**把 spread 展开后再判**（`featureViewDefs()`），不再拿字面量条数当注册条数。
 *
 *  ③ `NAV_GROUPS`（`ShellLayout.tsx`）—— 它是**导航信息架构**，判据是「用户从哪儿点进去」，
 *     不是「这页是不是推演」。两处结构性偏差实测在案：
 *       · `cleanroom-attr` / `disruption-radius` 被归进「归因与风险」组（文件注释写明理由：
 *         它们答「现状为什么这样」不是「改一个假设会怎样」），可它们同时是沙盘的两个模式
 *         （`SANDBOX_MODE_ORIGIN_VIEW.attribute/radius`）⇒ **同一页在两张表里分类相反**；
 *       · 收编进沙盘的页带 `consolidatedWhen: "sim.sandbox"` ⇒ **沙盘一开它们就从导航消失**，
 *         以导航为准会得出「开了沙盘就没有推演页了」。
 *
 * ⇒ 裁决：**单一来源 = 判据 + 依据链的唯一实现（本文件），名单一律现算。**
 *   「哪些页是推演页」这件事本身是**产品语义**，本仓此前从没有任何注册册显式声明过它 ——
 *   四个源头用的全是**代理指标**（标题里有没有「推演」二字 / 归在哪个导航组）。
 *   代理指标度量的是**写法**不是**语义**，正是铁律 0.6 点名的病。故本单同批做了两件事：
 *     (a) 在 `BUILTIN_VIEWS` 里加一个**显式字段** `sim: true`（声明在注册点，不在门里），
 *         把「这页是推演页」从猜写法升级成读声明；
 *     (b) 把原来的词面判据降级为**一致性交叉断言**（C1）：标题/功能名里带「推演|沙盘」
 *         却没标 `sim: true` ⇒ **漏标，红**。名单不再靠人抄，漏标由机器先说话。
 *
 * ── 五条纳入判据（每页带依据链 `why`，可 `--census` 逐条看）────────────────────────
 *   R1 `builtin-sim-flag`  后端内置视图显式标了 `sim: true`
 *   R2 `entitlement-view`  VIEW 级 entitlement（**含 spread 派生**）功能名含「推演|沙盘」
 *   R3 `nav-sim-group`     左导航「推演」组的成员（专用 route 与后端派单两类都在这里现身）
 *   R4 `sandbox-mode`      `SANDBOX_MODE_ORIGIN_VIEW` 里某个沙盘模式的原独立页
 *   R5 `consolidated-page` `CONSOLIDATED_INTO_SANDBOX` 里 `via: "static-route"` 的条目
 *   R6 `route-no-nav`      `ROUTE_NO_NAV` 里的条目（有专用 route、按产品裁决不占导航位）
 *                          （= 被收编成沙盘模式、但**本身仍是一整页**的那批）
 *
 * ── 一条排除判据（不是漏掉，是**有理由地不算**）────────────────────────────────
 *   X1 `sandbox-internal`  `CONSOLIDATED_INTO_SANDBOX` 里 `via: "workspace.views"` 的条目 ——
 *      它们已收编成沙盘**一屏之内**的画布模式 / 图层 / 常驻栏（五个沙盘子视图），
 *      不是独立页；`sim-sandbox` 这一页已经代表它们。排除也带依据链，不许静默。
 *
 * ── 三条交叉断言（「名单 vs 现算」那一层，本体 §8 判据明令要有）─────────────────
 *   C1 词面命中却没标 `sim: true`            ⇒ 漏标
 *   C2 沙盘家族成员（`requires: sim.sandbox`）既没标 `sim`、也不在 X1 里 ⇒ 归属不明
 *   C3 名册里的页解析不到源码文件            ⇒ 声明了一页却没有组件
 *
 * ── 金丝雀纪律 ────────────────────────────────────────────────────────────────
 * `rosterCanary()` 把**内嵌合成样例**喂给**本文件导出的那几个解析器本体**，不另抄一份正则
 * （抄了就是装饰品：改主正则时金丝雀拿旧的去测、照样绿）。任一不符预期 ⇒ 调用方必须报
 * 「**工具坏了**」并 RC=2，**不许**报「推演页都合格 / 名册是空的」。
 *
 * 本文件是**纯函数库**：不读文件、不 `process.exit`、无顶层副作用。读盘与退出码归各道门。
 */

/** 词面判据（**只用于交叉断言 C1**，不再当纳入判据 —— 它度量写法不度量语义）。 */
export const SIM_WORD = /推演|沙盘/;

/** 五个源头 + 两个文件解析源的相对路径（唯一一处写死路径的地方）。 */
export const SIM_SOURCE_FILES = {
  viewManifest: "apps/datacore/src/synthetic/view-manifest.ts",
  features: "apps/datacore/src/features.ts",
  shellLayout: "apps/frontend-shell/src/pages/ShellLayout.tsx",
  sandboxModes: "apps/frontend-shell/src/views/sim/sandboxModes.ts",
  registry: "apps/frontend-shell/src/views/registry.ts",
  app: "apps/frontend-shell/src/App.tsx",
};

/**
 * `sandbox` ≡ `sim-sandbox` —— 唯一一条**不能**从 `VIEW_ALIAS` 派生的等价对，故显式写死并说明理由：
 * 沙盘主入口是 `App.tsx` 直挂 Guard 的静态路由、**不经 registry 字符串键分发**
 * （本体 §7 `nav-group-coverage` 判据⑦ 已记：「反向 1 个 `sim-sandbox` 属 App.tsx 直挂 Guard
 * 不经 registry 分发，非缺陷」）。历史上的手抄名单用渲染器侧的 `sandbox`，四个枚举源用视图键
 * `sim-sandbox`，不对齐就会凭空多出一页。规范键统一取 `sim-sandbox`。
 */
export const EXTRA_ALIAS = { sandbox: "sim-sandbox" };

/** 注释行不算数（`//` 开头 / 块注释续行 `*` 开头）—— 注释里提一嘴 ≠ 真登记了一个视图。 */
export function isComment(line) {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

/** `VIEW_ALIAS`（短键 → 规范键）：单一来源是前端 registry，本库不另抄一份别名表。 */
export function parseViewAlias(registrySrc) {
  const out = {};
  const block = (registrySrc ?? "").split("const VIEW_ALIAS")[1] ?? "";
  const body = block.split("};")[0] ?? "";
  for (const line of body.split("\n")) {
    if (isComment(line)) continue;
    const m = line.match(/^\s*"?([a-z0-9-]+)"?\s*:\s*"([a-z0-9-]+)"\s*,/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** 规范化：短键 → 规范键 → 沙盘等价对。各源各用各的键，必须先对齐再比集合。 */
export function canon(key, alias) {
  const a = (alias ?? {})[key] ?? key;
  return EXTRA_ALIAS[a] ?? a;
}

/**
 * `BUILTIN_VIEWS` 逐条解析。**不只取 key** —— `sim` 标记 / `requires` / 词面都要，
 * 因为纳入判据 R1、排除判据 X1、交叉断言 C1/C2 全落在这几个字段上。
 * @returns {Array<{key:string,title:string,featureName:string,renderer:string,sim:boolean,requires:string[],word:boolean}>}
 */
export function parseBuiltinViews(src) {
  const out = [];
  for (const line of (src ?? "").split("\n")) {
    if (isComment(line)) continue;
    const m = line.match(/\{\s*key:\s*"([^"]+)",\s*title:\s*"([^"]*)"/);
    if (!m) continue;
    const featureName = (line.match(/featureName:\s*"([^"]*)"/) ?? [])[1] ?? "";
    const featureKey = (line.match(/featureKey:\s*"([^"]*)"/) ?? [])[1] ?? "";
    const renderer = (line.match(/renderer:\s*"([^"]*)"/) ?? [])[1] ?? "";
    const requires = [...(line.match(/requires:\s*\[([^\]]*)\]/) ?? ["", ""])[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    out.push({
      key: m[1],
      title: m[2],
      featureKey,
      featureName,
      renderer,
      // `sim: true` = 显式声明「这是一页推演页」。写 `sim: false` / 不写 = 不是。
      sim: /\bsim:\s*true\b/.test(line),
      requires,
      word: SIM_WORD.test(m[2]) || SIM_WORD.test(featureName),
    });
  }
  return out;
}

/**
 * VIEW 级 entitlement 的**完整**集合 = `features.ts` 里的 VIEW 字面量 ∪ **spread 派生**的内置视图功能。
 * 后半截是本单修掉的真缺陷：`features.ts` 顶部是 `...builtInViewFeatureDefs()`，
 * 只扫字面量的抽取器在这里只看得见 1 条（`sim.sandbox`），真值是 4 条。
 * @returns {Array<{key:string,name:string,from:"literal"|"builtin-spread"}>}
 */
export function featureViewDefs(featuresSrc, builtinViews) {
  const out = [];
  for (const line of (featuresSrc ?? "").split("\n")) {
    if (isComment(line)) continue;
    // BLOCK 级刻意不取：它是页**内**的块不是页，取进来会凭空多出 dash/graph 这种非推演页。
    const m = line.match(/\{\s*key:\s*"([^"]+)",\s*name:\s*"([^"]*)",\s*level:\s*"VIEW"/);
    if (m) out.push({ key: m[1], name: m[2], from: "literal" });
  }
  // spread 展开：与 `builtInViewFeatureDefs()` **同一支语义**（key=featureKey · name=featureName · level=VIEW）。
  // ⚠ 这里必须取 `featureKey` 而不是 `view.${key}` —— 两者在 `risk` 这一条上真的不同
  //   （key=`risk` / featureKey=`view.risk-board`），拿后者拼会得到一个仓里不存在的功能键。
  const spread = /\.\.\.builtInViewFeatureDefs\(\)/.test(featuresSrc ?? "");
  if (spread) {
    for (const bv of builtinViews ?? []) {
      if (!bv.featureKey) continue;
      out.push({ key: bv.featureKey, name: bv.featureName, from: "builtin-spread" });
    }
  }
  return out;
}

/** entitlement 功能键 → 规范视图键（`view.risk-board`→`risk-board` · `sim.sandbox`→`sim-sandbox`）。 */
export function featureKeyToViewKey(featureKey, alias) {
  return canon(String(featureKey).replace(/\./g, "-").replace(/^view-/, ""), alias);
}

/**
 * `NAV_GROUPS` 逐组解析（组标题 → 成员键）。`.map()` 展开那一行也要认，
 * 否则「推演」组会平白少掉 project-sim / global-sim / risk / order-chain 四个。
 * @returns {Record<string,string[]>}
 */
/**
 * `ROUTE_NO_NAV`（`ShellLayout.tsx`）逐键解析 —— R6 的来源。
 *
 * ⚠️ **注释行不算数**：与 `parseNavGroups` 同一条纪律 —— 注释里提一嘴某个键
 * （如「`decision-play` 原也在此列」这种说明历史的话）**不等于**它真登记在表里。
 * 抽取器只认 `"key":` 这种真键位，且必须落在 `ROUTE_NO_NAV = {` 到匹配 `};` 之间。
 */
export function parseRouteNoNav(shellSrc) {
  const start = shellSrc.indexOf("export const ROUTE_NO_NAV");
  if (start < 0) return [];
  const open = shellSrc.indexOf("{", start);
  const end = shellSrc.indexOf("\n};", open);
  if (open < 0 || end < 0) return [];
  const body = shellSrc.slice(open + 1, end);
  const keys = [];
  for (const line of body.split("\n")) {
    if (isComment(line)) continue;
    const m = line.match(/^\s*"([a-z0-9-]+)"\s*:/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

export function parseNavGroups(shellSrc) {
  const groups = {};
  let title = null;
  for (const line of (shellSrc ?? "").split("\n")) {
    const t = line.match(/title:\s*"([^"]+)"/);
    if (t && /^\s{2,4}(\{\s*)?title:/.test(line)) {
      title = t[1];
      groups[title] ??= [];
      continue;
    }
    if (title === null) continue;
    if (/^\s{2}\},\s*$/.test(line)) { title = null; continue; }
    if (isComment(line)) continue;
    const one = line.match(/kind:\s*"(?:route|view)"\s*as\s*const,\s*key:\s*"([^"]+)"/);
    if (one) groups[title].push(one[1]);
    const spread = line.match(/\.\.\.\[([^\][{}]+)\]\.map\(/);
    if (spread) for (const q of spread[1].match(/"([^"]+)"/g) ?? []) groups[title].push(q.replace(/"/g, ""));
  }
  return groups;
}

/**
 * 取一个**顶层声明**的对象字面量体（`export const NAME … = { … \n};`）。
 *
 * ⚠ **2026-08-17 实测的一个真「门瞎了」，记在这里防复发**（WO-SANDBOX-NAV-CONSOLIDATE）：
 * 本文件原来用 `src.split("<NAME>")[1]` 取块 —— 那取的是**第一次出现之后**的那一段。
 * 只要有人在声明**之前**的注释里提一嘴这个名字（本仓注释密度下这是迟早的事），
 * `[1]` 就变成「第一次提及 → 第二次提及」之间的那段**纯注释**，body 为空 ⇒
 * 判据 R5 提取 **0 条**。当天实测：给 `NavItemRef` 的 JSDoc 里加了一句
 * 「收编表 `CONSOLIDATED_INTO_SANDBOX` 里原来那五个子视图…」，`sim-ux-criteria:check`
 * 当场 RC=2、`edge-active-mounts` RC=1 —— 而**被扫的代码一个字都没错**。
 * 形态（铁律 0.6 句式）：**「我用『名字第一次出现的位置』当作『声明的位置』的证据。」**
 * ⇒ 判据必须锚在 **`export const <NAME>` / `const <NAME>`** 上（同文件 `parseRouteNoNav`
 *   早就是这么写的，只是这两个抽取器当时没跟着改）。
 */
function declBody(src, name) {
  const s = src ?? "";
  const start = s.search(new RegExp(String.raw`(export\s+)?const\s+${name}\b`));
  if (start < 0) return "";
  const open = s.indexOf("{", start);
  if (open < 0) return "";
  const end = s.indexOf("\n};", open);
  return end < 0 ? s.slice(open + 1) : s.slice(open + 1, end);
}

/**
 * `CONSOLIDATED_INTO_SANDBOX`（收编登记表）→ `{ key: via }`。
 * `via` 正是 R5 与 X1 的分水岭：`static-route` 那批仍是**整页**，`workspace.views` 那批
 * 已经是沙盘一屏之内的构件。这个区分是表里**自己写着**的，不是我在门里另定的。
 *
 * ⚠ `via` 的取值**不在这里写死**（原来只认 `workspace.views|static-route`）：
 * 表里新增第三种 `view-defs`（后端增量视图桶）时，写死的正则会**静默丢掉**那一条 ——
 * 少一条只会让 R5/X1 的集合变小、判据更容易恒绿，正是失败危险那一侧。
 * 故这里照实抽取，"哪一种算 R5、哪一种算 X1" 由调用方按值判断（判据留在判据处）。
 * @returns {Record<string,string>}
 */
export function parseConsolidated(shellSrc) {
  const out = {};
  const body = declBody(shellSrc, "CONSOLIDATED_INTO_SANDBOX");
  for (const line of body.split("\n")) {
    if (isComment(line)) continue;
    const m = line.match(/"?([a-z0-9-]+)"?\s*:\s*\{\s*via:\s*"([a-z.-]+)"/);
    if (m) out[m[1]] = m[2];
  }
  // 多行写法（`"key": {\n  via: "…",\n  where: "…",\n},`）—— 单行正则看不见它。
  // 不认这一形态 = 表里换个排版就少几条，同样是"集合变小、门更容易绿"那一侧。
  const multi = body.matchAll(/"?([a-z0-9-]+)"?\s*:\s*\{\s*(?:\/\/[^\n]*\n\s*)*via:\s*"([a-z.-]+)"/g);
  for (const m of multi) out[m[1]] ??= m[2];
  return out;
}

/** `SANDBOX_MODE_ORIGIN_VIEW` → `{ mode: originViewKey|null }`（锚在声明上，理由见 `declBody`）。 */
export function parseSandboxModes(src) {
  const out = {};
  const body = declBody(src, "SANDBOX_MODE_ORIGIN_VIEW");
  for (const line of body.split("\n")) {
    if (isComment(line)) continue;
    const m = line.match(/^\s*(\w+):\s*(?:"([a-z0-9-]+)"|null)\s*,/);
    if (m) out[m[1]] = m[2] ?? null;
  }
  return out;
}

/**
 * 渲染器注册表 → `{ rendererKey: 源码相对路径 }`。这就是把「页 → 文件」也从手抄改成现算的那一半：
 * 挂载点门原先连**文件路径**都是手抄的，页改名/搬家时它会读到 ENOENT 而不是读到真相。
 */
export function parseRendererFiles(registrySrc) {
  const out = {};
  for (const line of (registrySrc ?? "").split("\n")) {
    if (isComment(line)) continue;
    const m = line.match(/registerRenderer\(\s*"([^"]+)"\s*,\s*\(\)\s*=>\s*import\("\.\/([^"]+)"\)/);
    if (m) out[m[1]] = `apps/frontend-shell/src/views/${m[2]}.tsx`;
  }
  return out;
}

/**
 * `App.tsx` 的专用静态 route → `{ routeKey: 源码相对路径 }`。
 * 两跳：`{ path: "v/<key>", element: <X …/> }` 取组件名 X；X 若是本文件里的守卫函数
 * （如 `SimSandboxGuard`），再从它的函数体里取第一个**被 lazy import 过**的组件。
 * 沙盘就是这条路 —— 它不经 registry 分发，只认这一跳。
 */
export function parseStaticRouteFiles(appSrc) {
  const src = appSrc ?? "";
  const lazyMap = {};
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*lazy\(\(\)\s*=>\s*import\("@\/([^"]+)"\)\)/g)) {
    lazyMap[m[1]] = `apps/frontend-shell/src/${m[2]}.tsx`;
  }
  const out = {};
  for (const line of src.split("\n")) {
    if (isComment(line)) continue;
    const m = line.match(/\{\s*path:\s*"v\/([a-z0-9-]+)",\s*element:\s*(?:lazyWrap\(\s*)?<(\w+)/);
    if (!m) continue;
    const [, key, comp] = m;
    if (lazyMap[comp]) { out[key] = lazyMap[comp]; continue; }
    // 守卫函数：进它的函数体找第一个 lazy 组件（沙盘 = SimSandboxGuard → SandboxView）
    const body = (src.split(new RegExp(`function\\s+${comp}\\s*\\(`))[1] ?? "").split("\n}")[0] ?? "";
    const inner = [...body.matchAll(/<(\w+)\s*\/>/g)].map((x) => x[1]).find((n) => lazyMap[n]);
    if (inner) out[key] = lazyMap[inner];
  }
  return out;
}

/**
 * ══ 唯一实现 · 现算推演页名册 ══
 * @param {{viewManifest:string,features:string,shellLayout:string,sandboxModes:string,registry:string,app:string}} texts
 * @returns {{pages:Array<{key:string,file:string|null,why:string[]}>,excluded:Array<{key:string,why:string}>,
 *            violations:Array<{code:string,key:string,detail:string}>,sources:object,alias:object}}
 */
export function computeRoster(texts) {
  const alias = parseViewAlias(texts.registry);
  const c = (k) => canon(k, alias);

  const builtins = parseBuiltinViews(texts.viewManifest);
  const featureDefs = featureViewDefs(texts.features, builtins);
  const navGroups = parseNavGroups(texts.shellLayout);
  const routeNoNav = parseRouteNoNav(texts.shellLayout);
  const consolidated = parseConsolidated(texts.shellLayout);
  const modes = parseSandboxModes(texts.sandboxModes);
  const files = { ...parseRendererFiles(texts.registry), ...parseStaticRouteFiles(texts.app) };

  // ── 排除判据 X1（先算，因为纳入判据要拿它做交叉断言 C2）────────────────────────
  const excluded = [];
  const internal = new Set();
  for (const [k, via] of Object.entries(consolidated)) {
    if (via !== "workspace.views") continue;
    internal.add(c(k));
    excluded.push({ key: c(k), why: "X1 sandbox-internal：CONSOLIDATED_INTO_SANDBOX 记为 via=workspace.views ⇒ 已收编为沙盘一屏之内的画布模式/图层/常驻栏，不是独立页（sim-sandbox 已代表它）" });
  }

  // ── 五条纳入判据，逐条留依据链 ────────────────────────────────────────────────
  const why = new Map();
  const add = (key, tag) => {
    const k = c(key);
    if (internal.has(k)) return; // X1 排除优先：沙盘内部构件不因别的源头被拉回来
    if (!why.has(k)) why.set(k, []);
    if (!why.get(k).includes(tag)) why.get(k).push(tag);
  };

  for (const bv of builtins) if (bv.sim) add(bv.key, `R1 builtin-sim-flag（BUILTIN_VIEWS「${bv.title}」显式 sim:true）`);
  for (const fd of featureDefs) {
    if (!SIM_WORD.test(fd.name ?? "")) continue;
    add(featureKeyToViewKey(fd.key, alias), `R2 entitlement-view（${fd.key}「${fd.name}」· 来源 ${fd.from}）`);
  }
  for (const k of navGroups["推演"] ?? []) add(k, "R3 nav-sim-group（左导航「推演」组成员）");
  // ── R6 route-no-nav（2026-08-16 加）──────────────────────────────────────────
  // **它补的是 E2 造出来的一个新类别**：仓主裁决「决策推演不该占导航位」⇒ 导航项删了、
  // route 留着（`imp*` 深链契约一个键没动）。于是该页：
  //   · R3 抓不到（不在导航「推演」组了）；
  //   · R1 也抓不到（`view-manifest.ts` 有意把 decision-play 排除在 BUILTIN_VIEWS 之外 ——
  //     它只有前端 renderer + 静态路由，没有 VIEW_DEF/功能键，「配置不完整·诚实排除」）。
  // ⇒ **页还在、还是推演页，却掉出了受检面** —— 这正是 `G-GATE-ROSTER-HANDCOPIED` 那一族
  //   「不在名单里就永远绿」的新变种，只不过这次不是手抄名单漏了，是**判据没跟上产品裁决**。
  // 判据落在 `ROUTE_NO_NAV` 这张表上：它是 E2 那张单为「有 route 无导航项」建的**单一登记表**
  //   （`check-nav-group-coverage.mjs` 判据④ 与 `test/f61.admin-nav-groups.test.tsx` 都读它，
  //    不许另抄一份），且表自带纪律「route 一删，本表条目必须同删」——
  //   所以拿它当来源不会造出第二真相源。
  for (const k of routeNoNav) add(k, "R6 route-no-nav（ROUTE_NO_NAV：有专用 route、按产品裁决不占导航位）");
  for (const [mode, origin] of Object.entries(modes)) {
    if (origin) add(origin, `R4 sandbox-mode（沙盘模式「${mode}」的原独立页）`);
  }
  for (const [k, via] of Object.entries(consolidated)) {
    if (via === "static-route") add(k, "R5 consolidated-page（CONSOLIDATED_INTO_SANDBOX via=static-route ⇒ 收编成模式但本身仍是整页）");
  }

  // ── 三条交叉断言 ──────────────────────────────────────────────────────────────
  const violations = [];
  for (const bv of builtins) {
    if (bv.word && !bv.sim && !internal.has(c(bv.key))) {
      violations.push({ code: "C1", key: bv.key, detail: `BUILTIN_VIEWS「${bv.title}/${bv.featureName}」词面含「推演|沙盘」却没标 sim:true —— 漏标（判据必须落在声明上，不是标题写法上）` });
    }
    if (bv.requires.includes("sim.sandbox") && !bv.sim && !internal.has(c(bv.key))) {
      violations.push({ code: "C2", key: bv.key, detail: `沙盘家族成员「${bv.title}」（requires: sim.sandbox）既没标 sim:true、也不在 CONSOLIDATED_INTO_SANDBOX 里 —— 归属不明，说不清它是独立推演页还是沙盘内部构件` });
    }
  }

  const pages = [...why.keys()].sort().map((key) => ({ key, file: files[key] ?? null, why: why.get(key) }));
  for (const p of pages) {
    if (!p.file) violations.push({ code: "C3", key: p.key, detail: "名册里声明为推演页，却在 registry.ts / App.tsx 里解析不到源码文件 —— 声明了一页却没有组件" });
  }

  return {
    pages,
    excluded: excluded.sort((a, b) => a.key.localeCompare(b.key)),
    violations,
    alias,
    sources: {
      builtins,
      featureDefs,
      navGroups,
      consolidated,
      modes,
      files,
      // 各判据各自贡献了哪些页（`--census` 用；也是「四源分歧」这件事的现算出处）
      byRule: {
        R1: builtins.filter((b) => b.sim).map((b) => c(b.key)).sort(),
        R2: featureDefs.filter((f) => SIM_WORD.test(f.name ?? "")).map((f) => featureKeyToViewKey(f.key, alias)).filter((k, i, a) => a.indexOf(k) === i).sort(),
        R3: [...new Set((navGroups["推演"] ?? []).map(c))].sort(),
        R4: [...new Set(Object.values(modes).filter(Boolean).map(c))].sort(),
        R5: Object.entries(consolidated).filter(([, v]) => v === "static-route").map(([k]) => c(k)).sort(),
      },
    },
  };
}

/* ═══════════════════ 金丝雀 —— 喂的是上面那些函数本体，不另抄正则 ═══════════════ */

/** 合成样例：每个源头都埋了「注释行不算」「BLOCK 不算」「别名归一」「spread 派生」四类陷阱。 */
export const CANARY_TEXTS = {
  viewManifest: [
    '  // { key: "comment-only", title: "推演注释", featureKey: "view.comment-only", featureName: "推演注释" },   ← 注释里的不算',
    '  { key: "risk", title: "产能推演", renderer: "risk-board", featureKey: "view.risk-board", featureName: "风险推演看板", sim: true, seed: true },',
    '  { key: "plan-generate", title: "方案生成", renderer: "plan-generate", featureKey: "view.plan-generate", featureName: "规划建议", sim: true, seed: true },',
    '  { key: "order", title: "订单台账", renderer: "ledger", featureKey: "view.ledger", featureName: "订单台账", seed: true },',
    '  { key: "chain-line-map", title: "全链线路图", renderer: "chain-line-map", featureKey: "view.chain-line-map", featureName: "全链线路图", seed: true, requires: ["sim.sandbox"] },',
    // C1 样例：**只有 title** 带「推演」、featureName 不带 ⇒ R2（读 featureName）不收它，
    // 而 C1（读 title ∪ featureName）必须把它当漏标抓出来。两条判据的入口不同，故能各验各的。
    '  { key: "leaky-sim", title: "泄漏推演", renderer: "leaky-sim", featureKey: "view.leaky-sim", featureName: "泄漏看板", seed: true },',
  ].join("\n"),
  features: [
    "export const FEATURE_REGISTRY: FeatureDef[] = assertSharedFeatureNames([",
    "  ...builtInViewFeatureDefs(),",
    '  { key: "sim.sandbox", name: "推演沙盘", level: "VIEW", defaultOn: false },',
    '  { key: "view.graph.persp.flow", name: "图谱·产能推演网络", level: "BLOCK", defaultOn: true },',
  ].join("\n"),
  shellLayout: [
    // ⚠ 陷阱（2026-08-17 真踩过）：**声明之前**先在注释里提一嘴这个名字。
    //   抽取器若按 `split("<NAME>")[1]` 取块，从这里就断了 ⇒ 下面整张表读成空、R5 = 0 条。
    "  /** 收编开关的语义见收编表 `CONSOLIDATED_INTO_SANDBOX`（注释里提一嘴不等于声明在这里）。 */",
    "export const CONSOLIDATED_INTO_SANDBOX: Record<string, { via: string; where: string }> = {",
    '  "chain-line-map": { via: "workspace.views", where: "沙盘中栏画布默认模式" },',
    '  "cleanroom-attr": { via: "static-route", where: "沙盘模式切换 →「归因」" },',
    // ⚠ 陷阱二：**多行写法** + 第三种 via 取值。单行正则或写死 via 枚举都会静默丢掉它。
    '  "canary-multiline": {',
    '    via: "view-defs",',
    '    where: "沙盘模式「归因」→ 档（多行写法 + 第三种 via）",',
    "  },",
    "};",
    "export const NAV_GROUPS = [",
    "  {",
    '    title: "推演",',
    '      { kind: "route" as const, key: "sim-sandbox", label: "推演沙盘", feature: "sim.sandbox" },',
    '      ...["project-sim", "risk"].map((key) => ({ kind: "view" as const, key })),',
    "  },",
    "  {",
    '    title: "归因与风险",',
    '      { kind: "view" as const, key: "process-wait" },',
    "  },",
  ].join("\n"),
  sandboxModes: [
    "export const SANDBOX_MODE_ORIGIN_VIEW: Record<SandboxMode, string | null> = {",
    "  now: null,",
    '  attribute: "cleanroom-attr",',
    "};",
  ].join("\n"),
  registry: [
    "const VIEW_ALIAS: Record<string, string> = {",
    '  risk: "risk-board",',
    '  optimize: "optimize-whatif",',
    "};",
    '// registerRenderer("comment-only", () => import("./CommentOnlyView"));   ← 注释里的不算',
    'registerRenderer("risk-board", () => import("./RiskBoardView"));',
    'registerRenderer("project-sim", () => import("./sim/ProjectSimView"));',
    'registerRenderer("plan-generate", () => import("./sim/PlanGenerateView"));',
    'registerRenderer("cleanroom-attr", () => import("./cleanroom/CleanroomAttrView"));',
  ].join("\n"),
  app: [
    'const SandboxView = lazy(() => import("@/views/sim/SandboxView"));',
    "function SimSandboxGuard() {",
    "  return lazyWrap(<SandboxView />);",
    "}",
    '      { path: "v/sim-sandbox", element: <SimSandboxGuard /> },',
    '      { path: "v/:viewKey", element: <ViewPage /> },',
  ].join("\n"),
};

/**
 * 已知答案 · 十向金丝雀。**任一不符预期 ⇒ 调用方必须报「工具坏了」并 RC=2。**
 * @returns {{ok:boolean, bad:string[], roster:object}}
 */
export function rosterCanary() {
  const bad = [];
  const r = computeRoster(CANARY_TEXTS);
  const keys = r.pages.map((p) => p.key).join(",");

  // ① 全集：R1(risk-board·plan-generate) ∪ R2(sim-sandbox) ∪ R3(project-sim) ∪ R4/R5(cleanroom-attr)
  const want = "cleanroom-attr,plan-generate,project-sim,risk-board,sim-sandbox";
  if (keys !== want) bad.push(`①全集=「${keys}」应为「${want}」`);
  // ② 注释行不算：comment-only 一个都不许进来
  if (keys.includes("comment-only")) bad.push("②注释行被当成了真登记（comment-only 混进名册）");
  // ③ BLOCK 级不算：view.graph.persp.flow 名字里带「推演」，但它是页内的块
  if (keys.includes("graph")) bad.push("③BLOCK 级被当成了 VIEW 级（graph 混进名册）");
  // ④ 别名归一：源里写的是 `risk`，名册里必须是 `risk-board`
  if (!keys.includes("risk-board") || r.pages.some((p) => p.key === "risk")) bad.push("④别名未归一（risk 未归到 risk-board）");
  // ⑤ 沙盘等价对：`sandbox` → `sim-sandbox`
  if (!keys.includes("sim-sandbox")) bad.push("⑤沙盘键未归一到 sim-sandbox");
  // ⑥ spread 派生：features 里只有 sim.sandbox 一条字面量，但 view.risk-board 必须由 spread 补进来
  const fd = r.sources.featureDefs;
  if (!fd.some((f) => f.from === "builtin-spread" && f.key === "view.risk-board")) {
    bad.push(`⑥spread 派生失效：featureDefs 里没有 builtin-spread 的 view.risk-board（共 ${fd.length} 条）`);
  }
  // ⑦ X1 排除：沙盘子视图 chain-line-map 必须被排除，且排除要留依据
  if (!r.excluded.some((e) => e.key === "chain-line-map") || keys.includes("chain-line-map")) {
    bad.push("⑦X1 排除失效：chain-line-map（via=workspace.views）没被排除");
  }
  // ⑧ C1 漏标：leaky-sim 词面带「推演」却没标 sim:true，必须报 C1
  if (!r.violations.some((v) => v.code === "C1" && v.key === "leaky-sim")) {
    bad.push(`⑧C1 漏标未被抓（violations=${JSON.stringify(r.violations.map((v) => v.code + ":" + v.key))}）`);
  }
  // ⑨ 文件解析：registry 一条 + App.tsx 守卫两跳各验一条
  const byKey = Object.fromEntries(r.pages.map((p) => [p.key, p.file]));
  if (byKey["risk-board"] !== "apps/frontend-shell/src/views/RiskBoardView.tsx") bad.push(`⑨registry 文件解析=${byKey["risk-board"]}`);
  if (byKey["sim-sandbox"] !== "apps/frontend-shell/src/views/sim/SandboxView.tsx") bad.push(`⑨App.tsx 守卫两跳解析=${byKey["sim-sandbox"]}`);
  // ⑩ 依据链非空：每一页都必须说得出它凭哪条判据进来
  const noWhy = r.pages.filter((p) => (p.why ?? []).length === 0).map((p) => p.key);
  if (noWhy.length) bad.push(`⑩依据链为空：${noWhy.join(" ")}`);
  /* ⑪ 收编表抽取器的三个坑（2026-08-17 实测·WO-SANDBOX-NAV-CONSOLIDATE）：
   *   a. 声明**之前**的注释里提一嘴同名 ⇒ `split(NAME)[1]` 从注释处起切，整张表读空（R5 = 0）；
   *   b. **多行**写法（`"key": {\n via: …`）⇒ 单行正则看不见；
   *   c. **第三种 via** 取值（`view-defs`）⇒ 写死枚举的正则静默丢掉那一条。
   * 三者都只让集合**变小** = 判据更容易恒绿，属失败危险那一侧，故必须由金丝雀正面咬。 */
  const cons = parseConsolidated(CANARY_TEXTS.shellLayout);
  const consKeys = Object.keys(cons).sort().join(",");
  if (consKeys !== "canary-multiline,chain-line-map,cleanroom-attr") {
    bad.push(
      `⑪收编表抽取器漏条：实得「${consKeys}」应为「canary-multiline,chain-line-map,cleanroom-attr」` +
        `（三个坑：声明前的同名注释 / 多行写法 / 第三种 via 取值 —— 每一个都只让集合变小、门更容易绿）`,
    );
  }
  if (cons["canary-multiline"] !== "view-defs") {
    bad.push(`⑪via 取值被写死：多行条目的 via 实得「${cons["canary-multiline"]}」应为「view-defs」`);
  }

  return { ok: bad.length === 0, bad, roster: r };
}
