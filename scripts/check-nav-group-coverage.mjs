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
 *
 * ③ 是这道门的保命判据。①②④⑤⑥ 的解析都是「从 TS 源码里正则捞字面量」，
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
 *
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7（门）· §8 `G-NAV-FALLBACK-BUCKET`（本门所闭断点的机械门那一半）。
 * 用法：node scripts/check-nav-group-coverage.mjs   ·   pnpm nav-group-coverage:check
 * 退出码非 0 即失败。
 */
import { readFileSync, existsSync } from "node:fs";

const MANIFEST = "apps/datacore/src/synthetic/view-manifest.ts";
const FIXTURES = "apps/frontend-shell/src/mocks/fixtures.ts";
const SHELL = "apps/frontend-shell/src/pages/ShellLayout.tsx";
const APP = "apps/frontend-shell/src/App.tsx";
const CANARY = "dash"; // 后端/mock/NAV_GROUPS 三侧都必然含有的视图键；解析器坏掉时它会缺席 → 判据③ 红
const ROUTE_CANARY = "sim-sandbox"; // App.tsx 与 NAV_GROUPS 两侧都必然含有的专用 route 键（同上）
const BACKEND_FLOOR = 10; // 后端内置视图下界（当前 13）；解析崩了会掉到 0
const ROUTE_FLOOR = 5; // 专用 route 下界（当前 7）；解析崩了会掉到 0 → ④ 差集恒空 → 恒绿

/**
 * 刻意不给导航的专用 route（显式豁免·每条必须写理由）。
 *
 * 空表是**当前的真实状态**（7 条专用 route 全部已有入口），不是"还没填"。
 * 往这里加一条 = 公开声明「这个页面用户找不到是有意的」，理由要经得起问；
 * 且键必须是 App.tsx 里真实存在的 route（判据④ 会红出陈旧豁免）。
 * @type {Record<string, string>}
 */
const INTENTIONALLY_NO_NAV = {};

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

/** 从 `<decl>` 之后的第一个 `[` 起做括号配对，返回数组字面量内容（含首尾 `[]` 之内的部分）。 */
function arrayBlock(src, declRe, label) {
  const m = declRe.exec(src);
  if (!m) {
    fail.push(`✗ 解析失败：${label} —— 找不到声明（写法变了就必须同步改本门，别让它悄悄读空）`);
    return null;
  }
  const start = src.indexOf("[", m.index + m[0].length - 1);
  if (start < 0) {
    fail.push(`✗ 解析失败：${label} —— 声明后找不到 '['`);
    return null;
  }
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return src.slice(start + 1, i);
    }
  }
  fail.push(`✗ 解析失败：${label} —— 数组括号未配对`);
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
}

/* ---------- 后端真相源：BUILTIN_VIEWS 里 seed:true 那批 ---------- */
const manifestSrc = read(MANIFEST);
let seeded = [];
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
          if (k && /seed:\s*true/.test(obj)) seeded.push(k[1]);
          objStart = -1;
        }
      }
    }
  }
}

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
      ` · NAV_GROUPS route 键=${navRouteSet.size} · App.tsx 专用 route=${routeSet.size}`,
  );
  process.exit(1);
}
const exemptNote =
  Object.keys(INTENTIONALLY_NO_NAV).length === 0
    ? "无刻意豁免"
    : `刻意不给导航 ${Object.entries(INTENTIONALLY_NO_NAV).map(([k, why]) => `${k}（${why}）`).join(" · ")}`;
console.log(
  `✓ nav-group-coverage:check：后端 ${seeded.length} 个 seeded 内置视图全部有 NAV_GROUPS 归属且全在 mock allViews 里；` +
    `${routeSet.size} 条专用 route 全部有 kind:"route" 入口且无悬空条目 —— ${exemptNote}` +
    `（mock allViews=${mockKeys.length} · NAV_GROUPS view 键=${navSet.size} · route 键=${navRouteSet.size}）`,
);
