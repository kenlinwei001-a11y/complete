#!/usr/bin/env node
/**
 * 导航归组覆盖门 `nav-group-coverage:check`
 *   —— **每一条能打开的业务页面，都必须有一个用户找得到的入口**。
 *
 * ## 由来：同一个病的第四、第五层（本体 §8 `G-NAV-FALLBACK-BUCKET`）
 *
 * 「可达 ≠ 可发现」。前三层都补过门了：
 *   · 第一层 组件写了没注册 renderer      → #97 registry 接线
 *   · 第二层 注册了没人引用（孤儿模块）  → `check-view-reachable.mjs`（#119）
 *   · 第三层 前端全齐但后端不派单        → `BUILTIN_VIEWS` 入册 + `assertViewManifestIntegrity`
 *   · **第四层 后端派单了、前端没归组**  → 落进 `ShellLayout.tsx` 那个叫「其它」的兜底桶。
 *   · **第五层（WO-ROUTE-NAV-COVERAGE）专用 route 根本不经后端下发** → 谁也没管它有没有入口。
 *   · **第六层（WO-IMPEDIMENTS-REACHABLE）renderer 注册了，但零路径能渲染到它** → 判据⑦，见下。
 *
 * ## 第六层为什么两道门都抓不到（本门本次扩的那条）
 *
 * `chain-impediments` 实拍坐实（2026-08-08）：`views/registry.ts:87` 逐字写着
 * `registerRenderer("chain-impediments", () => import("./sim/ChainImpedimentView"))`，
 * 组件 442 行真实现、两条测试全绿 —— 而它**没有任何路径渲染得到**：
 *   · 后端 `BUILTIN_VIEWS` 无此 key ⇒ `workspace.views` 永远没有它 ⇒ `ViewPage` 双闸（feature/views）全关；
 *   · `App.tsx` 无专用静态 route ⇒ 手敲 `/v/chain-impediments` 也只落 `v/:viewKey` 通用守卫 → 404。
 * 它的狡猾之处是**同时躲开既有两道门**：
 *   · `view-reachable:check` 问的是「`src/views/**` 的模块有没有人 import」—— registry 那一行天然满足，绿；
 *   · 本门原有六条判据对账的是「后端 seeded 视图」与「App.tsx 专用 route」两个**集合的入口**，
 *     而它两个集合都不在 ⇒ 根本不在射程里，也绿。
 * 两道门各自都没写错，只是**没有任何一道去问「注册表里这 24 个键，每个都有路径能走到吗」**。
 * 判据⑦ 补的就是这一问。
 *
 * ⚠ 判据⑦ 与 `view-reachable:check` 的分工（别合并）：
 *   后者查**模块图**（文件有没有人 import），前者查**渲染路径**（字符串键有没有人派单/有没有 route）。
 *   一个模块可以「有人 import」而「没有路径渲染」——`chain-impediments` 正是这一形态。
 *
 * 第四层实拍坐实：沙盘四子视图（chain-line-map / transit-flow / physical-topology / node-inspector）
 * 全部落「其它」组，而那个组**不多不少正好只有它们四个** —— 一个专为「没人登记的东西」而生的桶，
 * 且默认折叠态（▸）。仓主连问三轮「四个新入口在哪」。
 *
 * 第五层实测坐实（2026-08-08）：`App.tsx` 有 7 条**专用静态 route**（`{ path: "v/<静态段>" }`，
 * 静态段先于 `:viewKey` 匹配，设计上**免 workspace 下发即可达**），后端 `BUILTIN_VIEWS` 一条都不派单
 * （`view-manifest.ts` 注释里明写"诚实排除"）。而本门的第一版**只对账后端 seeded 视图**，
 * 于是这 7 条整体在射程之外 —— 又一次「门名承诺 > 门实覆盖」：
 *   · `decision-play`  写成 `kind:"view"` → `UnifiedNav` 拿 `viewByKey.get()` 恒查不中 →
 *     `if (!it) return null` **静默消失**，不报错不留痕 = **幽灵条目**（表里写着、屏幕上永远没有）；
 *   · `cleanroom-attr` / `disruption-radius` / `optimize-whatif` / `what-if` **零导航提及** = 只能手敲 URL；
 *   · `sim-sandbox` / `sim-init` 走写死 `<NavLink>` —— 既不在任何分组里，也不在本门射程里。
 *
 * ## 为什么这道门必须是脚本，不能只是前端 vitest
 *
 * 真相源在 **datacore**（`apps/datacore/src/synthetic/view-manifest.ts` 的 `BUILTIN_VIEWS`），
 * 消费方在 **frontend-shell**。R1 contracts-only-shared 禁止前端跨 app import 源码，
 * 所以前端测试**永远看不见后端加了什么视图** —— 它只能在自己的 mock 上自说自话（那正是哑门的成因）。
 * 门脚本跨 app **读文件**是允许的（`scripts/**` 本来就这么干，见 check-view-reachable / check-boundary-singlesource），
 * 于是这道门是全仓唯一能把「后端加了视图」和「前端归了组」这两件事对上账的地方。
 * 第五层（App.tsx ↔ ShellLayout.tsx）虽同在前端，但**同一道门对账才不会各说各话**，故并在此处。
 *
 * ## 六条判据（同时成立才算过）
 *
 *   ① 归组无遗漏     后端 `BUILTIN_VIEWS` 里 seed:true 的每个 key，都在 `ShellLayout.NAV_GROUPS`
 *                    的 kind:"view" 键集合里 —— 漏一个 = 它在真实导航里落「其它」兜底桶。
 *   ② mock 不失真     同一批 key 都在 `apps/frontend-shell/src/mocks/fixtures.ts` 的 `allViews` 里 ——
 *                    mock 缺了它，前端所有 render 断言对它就是**恒真**的空转（哑门）。
 *   ③ 门自身没坏     四个解析结果各自非空、含各自金丝雀键、且过词法自检（见下）。
 *   ④ 专用 route 有入口  `App.tsx` 里每条 `{ path: "v/<静态段>" }`，要么在 `NAV_GROUPS` 有 `kind:"route"`
 *                    条目，要么列进 `INTENTIONALLY_NO_NAV` 并写明理由 —— 没有第三种状态。
 *   ⑤ route 条目不是幽灵（反向）  `NAV_GROUPS` 里每个 `kind:"route"` 键都必须真有对应的专用 route。
 *                    这条堵的是**删路由留条目**：链接还在、点进去落 `:viewKey` 兜底 404。
 *   ⑥ 专用 route 不得挂成 kind:"view"  那正是 `decision-play` 幽灵条目的**确切形态**：
 *                    该 key 不经后端下发 ⇒ `viewByKey` 永远查不中 ⇒ 条目永远不渲染，而且**没有任何报错**。
 *   ⑦ 渲染器可达（第六层）  `views/registry.ts` 里 `registerRenderer("<key>", …)` 的每个 key，
 *                    都必须至少有一条路径渲染得到 —— 二选一：
 *                      · 后端派单：某个 seed:true 的 `BUILTIN_VIEWS` 项 或 `service.ts` `VIEW_DEFS` 项
 *                        的 `renderer` 字段等于该 key（→ `workspace.views[].renderer` → `ViewPage` `getRenderer`）；
 *                      · 专用 route：`App.tsx` 有 `{ path: "v/<该 key>" }`（静态段先于 `:viewKey` 匹配）。
 *                    都没有 = 「实现有、测试绿、页面永远打不开」。豁免须进 `RENDERER_NO_PATH` 并写理由（≥10 字）。
 *
 * ③ 是这道门的保命判据。①②④⑤⑥⑦ 的解析都是「从 TS 源码里正则捞字面量」，
 * 一旦某侧被重构成解析不了的写法：那侧集合会**变小**——
 *   · mock/NAV_GROUPS 侧变小 → 差集变大 → **红**（失败安全）；
 *   · **后端侧 / App.tsx 侧变小 → 差集变空 → 恒绿**（失败危险，= 又一个哑门）。
 * 故供给侧必须有下界 + 金丝雀 + 词法自检三重自证，否则这道门会在最需要它的那天悄悄失效。
 *
 * **词法自检（判据③ 的第三重·每次运行都跑）**：拿一段内嵌样本喂给三个提取器，断言
 * 「注释里的不算 / `:viewKey` 动态段不算 / 非 `v/` 路径不算 / route 项的 label·feature 不得被误读成视图键 /
 *  `.map` 形态的字符串列表提得出」。任一不符即判**「门自己瞎了」**并红 —— 与「被扫代码有问题」分开报，
 * 因为修法完全不同（修门 vs 修代码）。由来：这道门上一版的 `.map` 形态正则写作 `\[([^\]]*)\]`，
 * 在 items 数组里混入 route 对象后会从**外层** `items: [` 起匹配，把 `label`/`feature` 的中文文案
 * 一并当成视图键收进去 —— 集合只会**变大**，①⑥ 恰恰因此更容易恒绿。词法自检当场咬住这一形态。
 *
 * ## 诚实边界（本门抓不到什么·必须当面列出）
 *
 * · 只查 seed:true 的内置视图。非 seed 的（不进 scenarioSeed.views）本来就不下发，不该要求归组。
 * · 只查「有没有入口」，不查「归得对不对」（归到哪个组是产品判断，机器判不了）。
 * · 只查「入口指向的 route 存在」，不查「那个页面打开后有没有内容」——静态扫描看不见运行期渲染，
 *   那半由前端 vitest（`test/f61.admin-nav-groups.test.tsx` 真渲染断言）与门B `ui-smoke` 咬。
 * · 只认 `{ path: "v/<字面量>" }` 这一种写法。若将来有人把路由表改成循环/拼接生成，
 *   解析结果会**变小** → 判据③ 的下界与金丝雀会当场红（这正是下界存在的理由）。
 * · `INTENTIONALLY_NO_NAV` 是**显式豁免**，不是静默放行：每条必须写理由，且理由指向的 route
 *   必须真实存在（陈旧豁免 = 红），门在成功时也把豁免清单打出来，让它无法躺在暗处。
 * · 判据⑦ **不认视图键别名**（`registry.ts` 的 `VIEW_ALIAS`：`sop`→`sop-balance` 那张表）。
 *   别名只会**增加**可达路径，故不认它只可能误红、不可能漏放 —— 失败安全的那一侧。
 *   修法也正确：真要靠别名可达的键，把规范键补进 `BUILTIN_VIEWS`/route，而不是让门去认一层间接。
 * · 判据⑦ 只证「有路径走得到」，**不证「走到了有内容」**。页面打开是空壳、求解器 404，
 *   静态扫描一律看不见 —— 那半由前端 vitest 的可达测试（从注册表字符串键出发真渲染）与门B `ui-smoke` 咬。
 *
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7（门）· §8 `G-NAV-FALLBACK-BUCKET`（本门所闭断点的机械门那一半）。
 * 用法：node scripts/check-nav-group-coverage.mjs   ·   pnpm nav-group-coverage:check
 * 退出码非 0 即失败。
 */
/* ── 退出码纪律 · 顶层兜底（WO-GATE-RC2-DISCIPLINE）─────────────────────────────
 * 本仓门的退出码是**三分**约定（docs/SOP-reviewer-claim-discipline.md §3）：
 *   0 = 干净 · 1 = **真有问题**（先修代码）· 2 = **工具自己坏了**（只许说「我没查出来」）。
 * 而 node 对**未捕获异常一律退 1** —— 恰好撞上「真有问题」这个码。于是「门根本没跑起来」
 * （缺依赖 / 只读 FS / 权限 / OOM / node 版本差异 / dist 没构建）会被 gate.sh 和人一起
 * 读成「你的代码有问题」，方向**正好相反**。2026-08-11 一天之内两道门各撞一次，故建此机制。
 * 形态（铁律 0.6 句式）：「我用『进程非 0 退出』当作『代码有问题』的证据，而前者并不度量后者。」
 *
 * 这段只**加**默认失败方向，**不动**任何既有 exit(0)/exit(1)：兜底若把真违规也吞成 2，
 * 那是拿一个更糟的假绿换掉一个假红。RC=1 仍然只由主判据明确判负产生。
 * 守门的门：scripts/check-gate-exit-discipline.mjs（新加的门不带兜底会被它当场判红）。 */
process.on("uncaughtException", (e) => gateToolBroken(e));
process.on("unhandledRejection", (e) => gateToolBroken(e));
function gateToolBroken(e) {
  console.error(`⛔ check-nav-group-coverage.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


import { readFileSync, existsSync } from "node:fs";

const MANIFEST = "apps/datacore/src/synthetic/view-manifest.ts";
const FIXTURES = "apps/frontend-shell/src/mocks/fixtures.ts";
const SHELL = "apps/frontend-shell/src/pages/ShellLayout.tsx";
const APP = "apps/frontend-shell/src/App.tsx";
const REGISTRY = "apps/frontend-shell/src/views/registry.ts"; // 判据⑦ 的被测集：渲染器注册表
const VIEWDEFS = "apps/datacore/src/synthetic/service.ts"; // 判据⑦ 的第二个供给侧：增量视图 VIEW_DEFS
const CANARY = "dash"; // 后端/mock/NAV_GROUPS 三侧都必然含有的视图键；解析器坏掉时它会缺席 → 判据③ 红
const ROUTE_CANARY = "sim-sandbox"; // App.tsx 与 NAV_GROUPS 两侧都必然含有的专用 route 键（同上）
const RENDERER_CANARY = "dashboard"; // registry.ts 必然含有的渲染器键（判据⑦ 的被测侧金丝雀）
const VIEWDEF_CANARY = "annual-scenario"; // service.ts VIEW_DEFS 必然含有的 renderer 值（判据⑦ 供给侧金丝雀）
const BACKEND_FLOOR = 10; // 后端内置视图下界（当前 14）；解析崩了会掉到 0
const ROUTE_FLOOR = 5; // 专用 route 下界（当前 6）；解析崩了会掉到 0 → ④ 差集恒空 → 恒绿
const RENDERER_FLOOR = 15; // 已注册渲染器下界（当前 24）；**被测侧**解析崩了会掉到 0 → ⑦ 差集恒空 → 恒绿
const VIEWDEF_FLOOR = 4; // VIEW_DEFS 增量 renderer 下界（当前 5）；**供给侧**解析崩了 → ⑦ 误红（失败安全，但仍要看得见）

/**
 * 刻意不给导航的专用 route（显式豁免·每条必须写理由）。
 *
 * 空表是**当前的真实状态**（7 条专用 route 全部已有入口），不是"还没填"。
 * 往这里加一条 = 公开声明「这个页面用户找不到是有意的」，理由要经得起问；
 * 且键必须是 App.tsx 里真实存在的 route（判据④ 会红出陈旧豁免）。
 * @type {Record<string, string>}
 */
const INTENTIONALLY_NO_NAV = {};

/**
 * 判据⑦ 的**带理由豁免清单**（棘轮：只降不升）—— 「这个 renderer 键注册了，但刻意没有任何渲染路径」。
 *
 * 空表是**当前的真实状态**（24 个注册键全部可达），不是"还没填"。
 * 往这里加一条 = 公开声明「这个组件写了、注册了，但用户永远打不开它，而且这是有意的」——
 * 这句话经不起问的时候，正确动作是**删掉那行 `registerRenderer`**（注册表是手工登记表，
 * 删一行的成本比留一个永远打不开的页面低得多），而不是来这里加一行。
 *
 * 三重约束，任一不满足即红：
 *   · 理由 ≥10 字（一个字的"待定"不算理由）；
 *   · 键必须真的在 `registry.ts` 注册过（写错键名的豁免会在下一次同名键出现时悄悄放过它）；
 *   · 键必须**真的不可达**（陈旧豁免 = 红：路已经通了还挂着豁免，等于给下一个真缺口留了后门）。
 * @type {Record<string, string>}
 */
const RENDERER_NO_PATH = {};
/** 棘轮上限（只降不升）：豁免条数不得超过此数。要加豁免就必须先在 diff 里把这个数字改大，藏不住。 */
const RENDERER_NO_PATH_CEILING = 0;

const fail = [];
/** 门自身的故障（与"被扫代码有问题"分开报——修法完全不同）。 */
const gateBroken = [];

function read(p) {
  if (!existsSync(p)) {
    fail.push(`✗ 输入文件不存在：${p}（本门的四个输入缺一即不可判，宁可红也不放行）`);
    return null;
  }
  return readFileSync(p, "utf8");
}

/**
 * 去注释 —— **这一步是命门**：四个文件的注释里都逐字写着视图键 / 路由段
 * （view-manifest 注释里有 `chain-line-map`，ShellLayout 注释里有 `sim-sandbox`，
 *  App.tsx 注释里有 `/v/decision-play`…）。
 * 不去注释，「注释里提了一嘴」会被读成「已登记」，门当场变哑。
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * 声明匹配正则：名字**整词**锚定 + 吃掉可选类型标注直到 `=`。
 *
 * 两个坑都踩过才写成这样（变异实测）：
 *   · 名字若用 `NAME[^=]*=` 松匹配，`BUILTIN_VIEWS_RENAMED: BuiltInView[] =` 也会命中 ——
 *     万一将来有个同前缀的**别的**数组排在前面，门会去读错的那个还照样绿。
 *   · 但名字若只锚到 `NAME\s*:` 就收尾，后面 `indexOf("[")` 会先撞上类型标注 `BuiltInView[]`
 *     里那对**空**方括号 → 解析出 0 项 → 判据③ 误红。
 * 故必须「整词锚定名字」且「一路吃到 `=`」两件事同时做到。
 */
const declOf = (name) => new RegExp(String.raw`export\s+const\s+${name}\s*(?::[^=]*)?=\s*`);
const localDeclOf = (name) => new RegExp(String.raw`const\s+${name}\s*(?::[^=]*)?=\s*`);

/**
 * 从 `<decl>` 之后的第一个 `open` 起做括号配对，返回字面量内容（不含首尾那对括号）。
 * `open` 默认 `[`（数组）；传 `{` 用于对象字面量（`VIEW_DEFS`）。
 */
function arrayBlock(src, declRe, label, open = "[") {
  const close = open === "[" ? "]" : "}";
  const m = declRe.exec(src);
  if (!m) {
    fail.push(`✗ 解析失败：${label} —— 找不到声明（写法变了就必须同步改本门，别让它悄悄读空）`);
    return null;
  }
  const start = src.indexOf(open, m.index + m[0].length - 1);
  if (start < 0) {
    fail.push(`✗ 解析失败：${label} —— 声明后找不到 '${open}'`);
    return null;
  }
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return src.slice(start + 1, i);
    }
  }
  fail.push(`✗ 解析失败：${label} —— ${open === "[" ? "数组" : "对象"}括号未配对`);
  return null;
}

/** 数组体里深度为 1 的 `key: "字面量"`（不下钻 layout/options 等嵌套对象，防把内层 key 当视图键）。 */
function topLevelKeys(body) {
  const keys = [];
  let depth = 0;
  const re = /[{}[\]]|key:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(body))) {
    const t = m[0];
    if (t === "{" || t === "[") depth++;
    else if (t === "}" || t === "]") depth--;
    else if (depth === 1 && m[1]) keys.push(m[1]);
  }
  return keys;
}

/* =====================  三个提取器（纯函数·供门与词法自检共用）  ===================== */

/**
 * App.tsx 专用静态 route：`{ path: "v/<静态段>" }`。
 * 排除动态段（`v/:viewKey` —— 那是兜底，不是专用 route）与非 `v/` 前缀路径（admin/tasks/o/…）。
 * ⚠ 入参必须是**已去注释**的源码。
 */
function parseDedicatedRoutes(strippedSrc) {
  const out = [];
  for (const m of strippedSrc.matchAll(/path:\s*"v\/([^"/]+)"/g)) {
    if (!m[1].startsWith(":")) out.push(m[1]);
  }
  return out;
}

/**
 * NAV_GROUPS 的 `kind:"view"` 键。两种形态：
 *   A `{ kind: "view", key: "dash" }`
 *   B `["a","b",…].map((key) => ({ kind: "view" as const, key }))`
 *
 * ⚠ 形态 B 的数组正则**必须**排掉 `{` `}` `[`（`[^[\]{}]*`）：items 数组里混入 route 对象后，
 *   宽松的 `[^\]]*` 会从**外层** `items: [` 起匹配到内层数组的 `]`，把 route 项的 label/feature 文案
 *   一并当成视图键收进来 —— 集合只会变大，判据 ①⑥ 因此更容易恒绿。词法自检咬这一条。
 */
function parseNavViewKeys(body) {
  const out = [];
  for (const m of body.matchAll(/\{\s*kind:\s*"view"[^}]*?key:\s*"([^"]+)"\s*\}/g)) out.push(m[1]);
  for (const m of body.matchAll(/\[([^[\]{}]*)\]\s*\.map\(\s*\(\s*key\s*\)\s*=>\s*\(\s*\{\s*kind:\s*"view"/g)) {
    for (const s of m[1].matchAll(/"([^"]+)"/g)) out.push(s[1]);
  }
  return out;
}

/**
 * NAV_GROUPS 的 `kind:"route"` 键（WO-ROUTE-NAV-COVERAGE）。
 * 形态：`{ kind: "route" as const, key: "sim-sandbox", label: "推演沙盘", feature: "sim.sandbox" }`
 * —— key 之后还有 label/feature，故**不能**像形态 A 那样锚到 `\}` 收尾。
 */
function parseNavRouteKeys(body) {
  const out = [];
  for (const m of body.matchAll(/\{\s*kind:\s*"route"[^}]*?key:\s*"([^"]+)"/g)) out.push(m[1]);
  return out;
}

/**
 * 判据⑦ 被测侧：`registry.ts` 的 `registerRenderer("<key>", …)` 键集。
 * ⚠ 入参必须是**已去注释**的源码 —— 注册表里到处是「XXX 此前没接线」这类注释，逐字含键名；
 *   不去注释，「注释里提了一嘴」会被读成「已注册」，判据⑦ 当场变成一个**更大**的集合（更容易误红），
 *   而被注释掉的真登记则读成"还在"（漏放）。两个方向都错，所以这一步不是可选项。
 */
function parseRegisteredRenderers(strippedSrc) {
  return [...strippedSrc.matchAll(/registerRenderer\(\s*"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * 判据⑦ 供给侧之一：一段对象字面量里深度为 1 的 `renderer: "字面量"`。
 * 不下钻嵌套（layout/options 里也可能出现 `renderer` 键 —— 例如 ViewConfig 的 `layout.renderer` 兜底，
 * 那不是"后端派了一个用该 renderer 的视图"）。
 */
function parseRendererValues(body) {
  const out = [];
  let depth = 0;
  const re = /[{}[\]]|renderer:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(body))) {
    const t = m[0];
    if (t === "{" || t === "[") depth++;
    else if (t === "}" || t === "]") depth--;
    else if (depth === 1 && m[1]) out.push(m[1]);
  }
  return out;
}

/* =====================  判据③ 第三重：词法自检（每次运行都跑）  ===================== */
{
  const SAMPLE_APP = `
    // { path: "v/commented-out" }        ← 注释里的不算
    /* { path: "v/block-commented" } */
    { path: "v/sim-sandbox", element: <SimSandboxGuard /> },
    { path: "v/what-if", element: lazyWrap(<WhatIfView />) },
    { path: "v/:viewKey", element: <ViewPage /> },
    { path: "tasks/:taskId", element: x },
    { path: "admin/foo", element: y },
  `;
  const gotRoutes = parseDedicatedRoutes(stripComments(SAMPLE_APP));
  const wantRoutes = ["sim-sandbox", "what-if"];
  if (JSON.stringify(gotRoutes) !== JSON.stringify(wantRoutes)) {
    gateBroken.push(
      `✗ 词法自检：parseDedicatedRoutes 提取结果不对 —— 期望 ${JSON.stringify(wantRoutes)}，` +
        `实得 ${JSON.stringify(gotRoutes)}（应做到：注释里的不算 / \`:viewKey\` 动态段不算 / 非 v/ 路径不算）`,
    );
  }

  const SAMPLE_NAV = `
    { title: null, items: [{ kind: "view", key: "canary-view" }] },
    { title: "组", items: [
        { kind: "route" as const, key: "canary-route", label: "标签文案", feature: "feat.x" },
        ...["a1", "a2"].map((key) => ({ kind: "view" as const, key })),
        ...["p1"].map((key) => ({ kind: "admin" as const, key })),
    ] },
  `;
  const gotViews = parseNavViewKeys(SAMPLE_NAV);
  const wantViews = ["canary-view", "a1", "a2"];
  if (JSON.stringify(gotViews.slice().sort()) !== JSON.stringify(wantViews.slice().sort())) {
    gateBroken.push(
      `✗ 词法自检：parseNavViewKeys 提取结果不对 —— 期望 ${JSON.stringify(wantViews)}，实得 ${JSON.stringify(gotViews)}` +
        `（应做到：形态 A/B 都提得出 / admin 项不算 / **route 项的 key·label·feature 一个都不许混进视图键**）`,
    );
  }
  const gotNavRoutes = parseNavRouteKeys(SAMPLE_NAV);
  if (JSON.stringify(gotNavRoutes) !== JSON.stringify(["canary-route"])) {
    gateBroken.push(
      `✗ 词法自检：parseNavRouteKeys 提取结果不对 —— 期望 ["canary-route"]，实得 ${JSON.stringify(gotNavRoutes)}` +
        `（route 项 key 之后还有 label/feature，正则不能锚到 '}' 收尾）`,
    );
  }

  /* ── 判据⑦ 的词法自检 ────────────────────────────────────────────────────────
   * 这一段是判据⑦ 的**反向金丝雀**：拿一个内嵌样本，里面**故意**放一个注册了却无路径的键，
   * 断言差集算法真的把它抓出来。正向金丝雀（真代码里已知可达的键不得被误报）在判据③ 里。
   * 两个方向都跑，才排得掉「门恒绿」与「门恒红」这两种坏法。 */
  const SAMPLE_REG = `
    // registerRenderer("commented-out", () => import("./X"));   ← 注释里的不算
    /* registerRenderer("block-commented", () => import("./Y")); */
    registerRenderer("canary-reachable", () => import("./A"));
    registerRenderer( "spaced-key" , () => import("./B"));
    registerRenderer("canary-orphan", () => import("./C"));
  `;
  const gotReg = parseRegisteredRenderers(stripComments(SAMPLE_REG));
  const wantReg = ["canary-reachable", "spaced-key", "canary-orphan"];
  if (JSON.stringify(gotReg) !== JSON.stringify(wantReg)) {
    gateBroken.push(
      `✗ 词法自检：parseRegisteredRenderers 提取结果不对 —— 期望 ${JSON.stringify(wantReg)}，实得 ${JSON.stringify(gotReg)}` +
        `（应做到：注释里的不算 / 括号内空格不影响）`,
    );
  }

  const SAMPLE_DEFS = `
    "a": { title: "甲", renderer: "canary-reachable", layout: { renderer: "nested-must-not-count" } },
    "b": { title: "乙", renderer: "spaced-key", layout: {} },
  `;
  const gotDefs = parseRendererValues(SAMPLE_DEFS);
  const wantDefs = ["canary-reachable", "spaced-key"];
  if (JSON.stringify(gotDefs) !== JSON.stringify(wantDefs)) {
    gateBroken.push(
      `✗ 词法自检：parseRendererValues 提取结果不对 —— 期望 ${JSON.stringify(wantDefs)}，实得 ${JSON.stringify(gotDefs)}` +
        `（应做到：顶层 renderer 提得出 / **嵌套 layout.renderer 不许算作"后端派了单"**）`,
    );
  }

  // 反向金丝雀：注册 3 个，其中 2 个有供给、1 个只在 route，剩 canary-orphan 无路径 ⇒ 必须被抓出来。
  const sampleReachable = new Set([...gotDefs, "sim-sandbox"]);
  const sampleOrphans = gotReg.filter((k) => !sampleReachable.has(k));
  if (JSON.stringify(sampleOrphans) !== JSON.stringify(["canary-orphan"])) {
    gateBroken.push(
      `✗ 词法自检：判据⑦ 差集算法不对 —— 内嵌样本里 "canary-orphan" 注册了却无任何供给侧路径，` +
        `期望差集 ["canary-orphan"]，实得 ${JSON.stringify(sampleOrphans)}。` +
        `差集算错 = 本门对「注册了但打不开」这件事**恒绿**，正是它要治的那种东西。`,
    );
  }
}

/* ---------- 后端真相源：BUILTIN_VIEWS 里 seed:true 那批 ---------- */
const manifestSrc = read(MANIFEST);
let seeded = [];
/** 判据⑦ 供给侧之一：seed:true 内置视图的 `renderer` 值（**只取 seed:true** —— 非 seed 项不进
 *  `scenarioSeed.views`、永远不下发，把它的 renderer 算作"可达"就是又一次「接了线没数据」误判）。 */
let seededRenderers = [];
if (manifestSrc) {
  const body = arrayBlock(stripComments(manifestSrc), declOf("BUILTIN_VIEWS"), `${MANIFEST} BUILTIN_VIEWS`);
  if (body !== null) {
    // 逐个顶层 `{ … }` 拆开，只留 seed: true 的
    let depth = 0;
    let objStart = -1;
    for (let i = 0; i < body.length; i++) {
      if (body[i] === "{") {
        if (depth === 0) objStart = i;
        depth++;
      } else if (body[i] === "}") {
        depth--;
        if (depth === 0 && objStart >= 0) {
          const obj = body.slice(objStart, i + 1);
          const k = /key:\s*"([^"]+)"/.exec(obj);
          if (k && /seed:\s*true/.test(obj)) {
            seeded.push(k[1]);
            const r = /renderer:\s*"([^"]+)"/.exec(obj);
            // renderer 缺省时 ViewConfig 落 `renderer: VIEW_DEFS[k]?.renderer ?? k`（key 兜底）
            if (r) seededRenderers.push(r[1]);
            else seededRenderers.push(k[1]);
          }
          objStart = -1;
        }
      }
    }
  }
}

/* ---------- 判据⑦ 供给侧之二：service.ts VIEW_DEFS 的增量视图 renderer ---------- */
const viewDefsSrc = read(VIEWDEFS);
let viewDefRenderers = [];
if (viewDefsSrc) {
  const body = arrayBlock(stripComments(viewDefsSrc), localDeclOf("VIEW_DEFS"), `${VIEWDEFS} VIEW_DEFS`, "{");
  if (body !== null) viewDefRenderers = parseRendererValues(body);
}

/* ---------- 判据⑦ 被测侧：registry.ts 的 registerRenderer 键 ---------- */
const registrySrc = read(REGISTRY);
let registeredRenderers = [];
if (registrySrc) registeredRenderers = parseRegisteredRenderers(stripComments(registrySrc));

/* ---------- 前端 mock：allViews ---------- */
const fixturesSrc = read(FIXTURES);
let mockKeys = [];
if (fixturesSrc) {
  const body = arrayBlock(stripComments(fixturesSrc), localDeclOf("allViews"), `${FIXTURES} allViews`);
  if (body !== null) mockKeys = topLevelKeys(body);
}

/* ---------- 前端归组表：NAV_GROUPS 的 kind:"view" / kind:"route" 键 ---------- */
const shellSrc = read(SHELL);
let navViewKeys = [];
let navRouteKeys = [];
if (shellSrc) {
  const body = arrayBlock(stripComments(shellSrc), declOf("NAV_GROUPS"), `${SHELL} NAV_GROUPS`);
  if (body !== null) {
    navViewKeys = parseNavViewKeys(body);
    navRouteKeys = parseNavRouteKeys(body);
  }
}

/* ---------- 前端路由表：App.tsx 的专用静态 route ---------- */
const appSrc = read(APP);
let dedicatedRoutes = [];
if (appSrc) dedicatedRoutes = parseDedicatedRoutes(stripComments(appSrc));

/* ---------- 判据③ 门自身没坏（先跑，坏了后面几条的"绿"没有意义） ---------- */
const canaries = [
  [`${MANIFEST} BUILTIN_VIEWS(seed:true)`, seeded, CANARY],
  [`${FIXTURES} allViews`, mockKeys, CANARY],
  [`${SHELL} NAV_GROUPS(kind:"view")`, navViewKeys, CANARY],
  [`${SHELL} NAV_GROUPS(kind:"route")`, navRouteKeys, ROUTE_CANARY],
  [`${APP} 专用 route`, dedicatedRoutes, ROUTE_CANARY],
  [`${REGISTRY} registerRenderer 键`, registeredRenderers, RENDERER_CANARY],
  [`${MANIFEST} seed:true 的 renderer 值`, seededRenderers, RENDERER_CANARY],
  [`${VIEWDEFS} VIEW_DEFS renderer 值`, viewDefRenderers, VIEWDEF_CANARY],
];
for (const [label, set, canary] of canaries) {
  if (!set.includes(canary)) {
    gateBroken.push(
      `✗ 判据③ 门自身没坏：${label} 解析结果不含金丝雀键 "${canary}"（解析到 ${set.length} 项）——` +
        ` 这不是代码死了，是本门的解析器坏了。修门，别改被测代码。`,
    );
  }
}
if (seeded.length < BACKEND_FLOOR) {
  gateBroken.push(
    `✗ 判据③ 门自身没坏：后端 seeded 内置视图只解析出 ${seeded.length} 项（下界 ${BACKEND_FLOOR}）——` +
      ` 后端侧解析变空会让 ①② 的差集恒空、门恒绿，这正是本门最怕的失效方式。`,
  );
}
if (dedicatedRoutes.length < ROUTE_FLOOR) {
  gateBroken.push(
    `✗ 判据③ 门自身没坏：${APP} 专用 route 只解析出 ${dedicatedRoutes.length} 条（下界 ${ROUTE_FLOOR}）——` +
      ` 路由侧解析变空会让 ④ 的差集恒空、门恒绿（"代码很干净"其实是"门瞎了"）。`,
  );
}
if (registeredRenderers.length < RENDERER_FLOOR) {
  gateBroken.push(
    `✗ 判据③ 门自身没坏：${REGISTRY} 只解析出 ${registeredRenderers.length} 个 registerRenderer 键（下界 ${RENDERER_FLOOR}）——` +
      ` **被测侧**解析变空会让 ⑦ 的差集恒空、门恒绿。这是判据⑦ 最怕的失效方式：` +
      ` 屏幕上写着"全部可达"，其实是"一个都没看"。`,
  );
}
if (viewDefRenderers.length < VIEWDEF_FLOOR) {
  gateBroken.push(
    `✗ 判据③ 门自身没坏：${VIEWDEFS} VIEW_DEFS 只解析出 ${viewDefRenderers.length} 个 renderer 值（下界 ${VIEWDEF_FLOOR}）——` +
      ` 供给侧解析变空只会让 ⑦ 误红（失败安全），但仍要当场说清是"门瞎了"而不是"代码断了"：` +
      ` 修法完全不同（修门 vs 接线）。`,
  );
}

/* ---------- 判据① 归组无遗漏 ---------- */
const navSet = new Set(navViewKeys);
const ungrouped = seeded.filter((k) => !navSet.has(k));
if (ungrouped.length > 0) {
  fail.push(
    `✗ 判据① 归组无遗漏：后端下发的内置视图未登记进 ${SHELL} 的 NAV_GROUPS —— [${ungrouped.join(", ")}]\n` +
      `    后果不是"报错"，是**静悄悄落进侧栏那个叫「其它」的折叠兜底桶**：可达、但用户找不到。\n` +
      `    修法：把这些 key 加进对应业务分组的 items（{ kind: "view", key: "…" }），不是改 leftover 机制。`,
  );
}

/* ---------- 判据② mock 不失真 ---------- */
const mockSet = new Set(mockKeys);
const missingInMock = seeded.filter((k) => !mockSet.has(k));
if (missingInMock.length > 0) {
  fail.push(
    `✗ 判据② mock 不失真：后端下发的内置视图不在 ${FIXTURES} 的 allViews 里 —— [${missingInMock.join(", ")}]\n` +
      `    后果：所有跑在 mock 上的前端断言对这些视图**恒真**（它们根本没进 workspace.navigation），\n` +
      `    于是"业务视图不得落『其它』"这类测试全是空转的哑门。mock 必须反映后端真实下发的视图集。`,
  );
}

/* ---------- 判据④ 专用 route 有入口 ---------- */
const routeSet = new Set(dedicatedRoutes);
const navRouteSet = new Set(navRouteKeys);
const noEntry = dedicatedRoutes.filter((k) => !navRouteSet.has(k) && !(k in INTENTIONALLY_NO_NAV));
if (noEntry.length > 0) {
  fail.push(
    `✗ 判据④ 专用 route 有入口：${APP} 的专用静态 route 在 ${SHELL} 的 NAV_GROUPS 里没有 kind:"route" 条目 ——\n` +
      `    [${noEntry.join(", ")}]\n` +
      `    后果：页面写了、路由通了、点不到 —— 只有知道 URL 的人（= 写它的那个 dev）进得去。\n` +
      `    修法二选一：① 加 { kind: "route", key: "…", label: "…" } 到对应分组；\n` +
      `              ② 若确属刻意不给入口，写进本门的 INTENTIONALLY_NO_NAV 并注明理由（会被打印出来，无处躺平）。`,
  );
}
const staleExempt = Object.keys(INTENTIONALLY_NO_NAV).filter((k) => !routeSet.has(k));
if (staleExempt.length > 0) {
  fail.push(
    `✗ 判据④ 豁免不许陈旧：INTENTIONALLY_NO_NAV 里的 [${staleExempt.join(", ")}] 在 ${APP} 已无对应专用 route。\n` +
      `    陈旧豁免会在下一次同名 route 出现时**悄悄放过它**。删掉即可。`,
  );
}

/* ---------- 判据⑤ route 条目不是幽灵（反向） ---------- */
const danglingNavRoutes = navRouteKeys.filter((k) => !routeSet.has(k));
if (danglingNavRoutes.length > 0) {
  fail.push(
    `✗ 判据⑤ route 条目不是幽灵：${SHELL} 的 NAV_GROUPS 有 kind:"route" 条目，但 ${APP} 没有对应的专用 route ——\n` +
      `    [${danglingNavRoutes.join(", ")}]\n` +
      `    后果：侧栏链接还在，点进去落 \`v/:viewKey\` 兜底 → FEATURE_NOT_FOUND / 404。\n` +
      `    这条专防**跨分支删路由**：谁删了 route 而没删条目，在这里当场红，而不是留一条死链上线。`,
  );
}

/* ---------- 判据⑥ 专用 route 不得挂成 kind:"view"（幽灵条目的确切形态） ---------- */
const seededSet = new Set(seeded);
const ghostViewEntries = navViewKeys.filter((k) => routeSet.has(k) && !seededSet.has(k));
if (ghostViewEntries.length > 0) {
  fail.push(
    `✗ 判据⑥ 专用 route 不得挂成 kind:"view"：[${ghostViewEntries.join(", ")}]\n` +
      `    这些 key 是 ${APP} 的专用静态 route，且**后端 BUILTIN_VIEWS 不派单**（不进 workspace.navigation），\n` +
      `    于是 ShellLayout \`UnifiedNav\` 里 \`viewByKey.get(key)\` 恒查不中 → \`if (!it) return null\` ——\n` +
      `    条目**永远不渲染，且不报错、不留痕**（幽灵条目）。decision-play 就这么隐身了整整一个版本。\n` +
      `    修法：改成 { kind: "route", key: "…", label: "…" }（无条件渲染，不依赖后端下发）。`,
  );
}

/* ---------- 判据⑦ 渲染器可达（第六层：注册了但零路径渲染得到）---------- */
const rendererReachable = new Set([...seededRenderers, ...viewDefRenderers, ...dedicatedRoutes]);
const unreachableRenderers = registeredRenderers.filter(
  (k) => !rendererReachable.has(k) && !(k in RENDERER_NO_PATH),
);
if (unreachableRenderers.length > 0) {
  fail.push(
    `✗ 判据⑦ 渲染器可达：${REGISTRY} 注册了这些 renderer 键，但**没有任何路径渲染得到它们** ——\n` +
      `    [${unreachableRenderers.join(", ")}]\n` +
      `    后果不是"报错"，是**页面根本不存在**：后端不派单 ⇒ workspace.views 没有它 ⇒ ViewPage 双闸全关；\n` +
      `    没有专用 route ⇒ 手敲 URL 也只落 \`v/:viewKey\` 通用守卫 → 404。组件再全、测试再绿，用户一次都打不开。\n` +
      `    ⚠ 这一层**既有两道门都抓不到**：\`view-reachable:check\` 看"模块有没有人 import"（registry 那一行满足了），\n` +
      `      本门原有判据看的是"后端 seeded 视图"与"专用 route"两个集合的入口——不在集合里的键根本不在射程。\n` +
      `    修法二选一（判据是**语义归属**，不是哪个好写）：\n` +
      `      ① 该视图应按租户/行业配置下发（可被行业模板裁剪、需要 requires 级联、需要 view.options 参数）\n` +
      `         → 进 ${MANIFEST} 的 BUILTIN_VIEWS（seed:true），并同步 NAV_GROUPS + mock allViews + report.views 金值；\n` +
      `      ② 该视图是平台自带、与租户配置无关的固定分析页（净室通用页那一类）\n` +
      `         → 在 ${APP} 加 { path: "v/<key>" } 专用 route，并在 NAV_GROUPS 加 kind:"route" 条目（判据④ 会验）。\n` +
      `      ③ 若它**根本不该是一个可打开的视图**（纯图层/子组件/已废弃）→ **删掉那行 registerRenderer**，\n` +
      `         而不是来 RENDERER_NO_PATH 加豁免：豁免名单会把将来的真缺口一起放过，那正是这道门存在的原因。`,
  );
}
// 豁免自身的三重约束（棘轮 + 理由 + 不许陈旧）
if (Object.keys(RENDERER_NO_PATH).length > RENDERER_NO_PATH_CEILING) {
  fail.push(
    `✗ 判据⑦ 豁免棘轮：RENDERER_NO_PATH 有 ${Object.keys(RENDERER_NO_PATH).length} 条，超过上限 ${RENDERER_NO_PATH_CEILING}。\n` +
      `    棘轮只降不升：要加豁免必须在同一个 diff 里把 RENDERER_NO_PATH_CEILING 改大 —— 那一行改动藏不住，必被复审看见。`,
  );
}
for (const [k, why] of Object.entries(RENDERER_NO_PATH)) {
  if (typeof why !== "string" || why.trim().length < 10) {
    fail.push(`✗ 判据⑦ 豁免须有理由：RENDERER_NO_PATH["${k}"] 的理由不足 10 字（"待定"/"TODO" 不是理由）。`);
  }
  if (!registeredRenderers.includes(k)) {
    fail.push(
      `✗ 判据⑦ 豁免不许写错键：RENDERER_NO_PATH["${k}"] 在 ${REGISTRY} 里根本没注册过。\n` +
        `    写错键名的豁免今天什么也不放行，却会在下一次真出现同名键时**悄悄放过它**。`,
    );
  } else if (rendererReachable.has(k)) {
    fail.push(
      `✗ 判据⑦ 豁免不许陈旧：RENDERER_NO_PATH["${k}"] 声明"刻意不可达"，但它现在**已经可达**了。\n` +
        `    删掉这条豁免即可 —— 留着等于给下一个真缺口预留了一个后门。`,
    );
  }
}

/* ---------- 判决 ---------- */
if (gateBroken.length > 0 || fail.length > 0) {
  console.error("✗ nav-group-coverage:check 失败（本体 §8 G-NAV-FALLBACK-BUCKET）\n");
  if (gateBroken.length > 0) {
    console.error("── 门自己瞎了（先修门，别改被测代码）──\n");
    for (const f of gateBroken) console.error(f + "\n");
  }
  if (fail.length > 0) {
    if (gateBroken.length > 0) console.error("── 被扫代码的问题 ──\n");
    for (const f of fail) console.error(f + "\n");
  }
  console.error(
    `参考：后端 seeded=${seeded.length} · mock allViews=${mockKeys.length} · NAV_GROUPS view 键=${navSet.size}` +
      ` · NAV_GROUPS route 键=${navRouteSet.size} · App.tsx 专用 route=${routeSet.size}` +
      ` · 已注册 renderer=${registeredRenderers.length} · 可达 renderer 并集=${rendererReachable.size}`,
  );
  process.exit(1);
}
const exemptNote =
  Object.keys(INTENTIONALLY_NO_NAV).length === 0
    ? "无刻意豁免"
    : `刻意不给导航 ${Object.entries(INTENTIONALLY_NO_NAV).map(([k, why]) => `${k}（${why}）`).join(" · ")}`;
const rendererExemptNote =
  Object.keys(RENDERER_NO_PATH).length === 0
    ? "无豁免"
    : `刻意不可达 ${Object.entries(RENDERER_NO_PATH).map(([k, why]) => `${k}（${why}）`).join(" · ")}`;
console.log(
  `✓ nav-group-coverage:check：后端 ${seeded.length} 个 seeded 内置视图全部有 NAV_GROUPS 归属且全在 mock allViews 里；` +
    `${routeSet.size} 条专用 route 全部有 kind:"route" 入口且无悬空条目 —— ${exemptNote}` +
    `（mock allViews=${mockKeys.length} · NAV_GROUPS view 键=${navSet.size} · route 键=${navRouteSet.size}）`,
);
console.log(
  `✓ 判据⑦ 渲染器可达：${REGISTRY} 的 ${registeredRenderers.length} 个 registerRenderer 键，` +
    `每个都至少有一条路径渲染得到（后端派单 ${new Set([...seededRenderers, ...viewDefRenderers]).size} 个 renderer` +
    ` · 专用 route ${routeSet.size} 条 ⇒ 可达并集 ${rendererReachable.size}）—— 豁免棘轮 ` +
    `${Object.keys(RENDERER_NO_PATH).length}/${RENDERER_NO_PATH_CEILING}，${rendererExemptNote}`,
);
