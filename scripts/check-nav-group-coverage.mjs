#!/usr/bin/env node
/**
 * 导航归组覆盖门 `nav-group-coverage:check` —— **后端下发的每个内置视图都必须有前端归属**。
 *
 * ## 由来：同一个病的第四层（本体 §8 `G-NAV-FALLBACK-BUCKET`）
 *
 * 「可达 ≠ 可发现」。前三层都补过门了：
 *   · 第一层 组件写了没注册 renderer      → #97 registry 接线
 *   · 第二层 注册了没人引用（孤儿模块）  → `check-view-reachable.mjs`（#119）
 *   · 第三层 前端全齐但后端不派单        → `BUILTIN_VIEWS` 入册 + `assertViewManifestIntegrity`
 *   · **第四层 后端派单了、前端没归组**  → 落进 `ShellLayout.tsx` 那个叫「其它」的兜底桶。
 *
 * 第四层实拍坐实：沙盘四子视图（chain-line-map / transit-flow / physical-topology / node-inspector）
 * 全部落「其它」组，而那个组**不多不少正好只有它们四个** —— 一个专为「没人登记的东西」而生的桶，
 * 且默认折叠态（▸）。仓主连问三轮「四个新入口在哪」。
 * 更刺眼的是：`ShellLayout.tsx` 里本来就有一道结构守卫防此事（前例 boundary / prototype-intake 曾落「其它」），
 * 但它**只覆盖 `ADMIN_PAGES`** —— 门存在、门有牙、咬的是另一半。
 *
 * ## 为什么这道门必须是脚本，不能只是前端 vitest
 *
 * 真相源在 **datacore**（`apps/datacore/src/synthetic/view-manifest.ts` 的 `BUILTIN_VIEWS`），
 * 消费方在 **frontend-shell**。R1 contracts-only-shared 禁止前端跨 app import 源码，
 * 所以前端测试**永远看不见后端加了什么视图** —— 它只能在自己的 mock 上自说自话（那正是哑门的成因）。
 * 门脚本跨 app **读文件**是允许的（`scripts/**` 本来就这么干，见 check-view-reachable / check-boundary-singlesource），
 * 于是这道门是全仓唯一能把「后端加了视图」和「前端归了组」这两件事对上账的地方。
 *
 * ## 三条判据（同时成立才算过）
 *
 *   ① 归组无遗漏   后端 `BUILTIN_VIEWS` 里 seed:true 的每个 key，都在 `ShellLayout.NAV_GROUPS`
 *                  的 kind:"view" 键集合里 —— 漏一个 = 它在真实导航里落「其它」兜底桶。
 *   ② mock 不失真   同一批 key 都在 `apps/frontend-shell/src/mocks/fixtures.ts` 的 `allViews` 里 ——
 *                  mock 缺了它，前端所有 render 断言对它就是**恒真**的空转（哑门）。
 *   ③ 门自身没坏   三个解析结果各自非空且含金丝雀键 `dash`（铁律 0.5 §5：报 0 命中前先自证工具是对的）。
 *
 * ③ 是这道门的保命判据。①② 的解析都是「从 TS 源码里正则捞字面量」，
 * 一旦某侧被重构成解析不了的写法：①② 那侧集合会**变小**——
 *   · mock/NAV_GROUPS 侧变小 → 差集变大 → **红**（失败安全）；
 *   · **后端侧变小 → 差集变空 → 恒绿**（失败危险，= 又一个哑门）。
 * 故后端侧必须有下界与金丝雀自证，否则这道门会在最需要它的那天悄悄失效。
 *
 * ## 诚实边界
 *
 * · 只查 seed:true 的内置视图。非 seed 的（不进 scenarioSeed.views）本来就不下发，不该要求归组。
 * · 只查「有没有归属」，不查「归得对不对」（归到哪个组是产品判断，机器判不了）。
 * · `NAV_GROUPS` 里有而后端没有的键（如 decision-play，走 App.tsx 静态路由）**不报** ——
 *   反向是幽灵条目问题，与本门要守的「可发现性」不是一回事，另案。
 *
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7（门）· §8 `G-NAV-FALLBACK-BUCKET`（本门所闭断点的机械门那一半）。
 * 用法：node scripts/check-nav-group-coverage.mjs   ·   pnpm nav-group-coverage:check
 * 退出码非 0 即失败。
 */
import { readFileSync, existsSync } from "node:fs";

const MANIFEST = "apps/datacore/src/synthetic/view-manifest.ts";
const FIXTURES = "apps/frontend-shell/src/mocks/fixtures.ts";
const SHELL = "apps/frontend-shell/src/pages/ShellLayout.tsx";
const CANARY = "dash"; // 三侧都必然含有的键；解析器坏掉时它会缺席 → 判据③ 红
const BACKEND_FLOOR = 10; // 后端内置视图下界（当前 13）；解析崩了会掉到 0

const fail = [];

function read(p) {
  if (!existsSync(p)) {
    fail.push(`✗ 输入文件不存在：${p}（本门的三个输入缺一即不可判，宁可红也不放行）`);
    return null;
  }
  return readFileSync(p, "utf8");
}

/**
 * 去注释 —— **这一步是命门**：三个文件的注释里都逐字写着视图 key
 * （view-manifest 注释里有 `chain-line-map`，ShellLayout 注释里有 `sim-sandbox`…）。
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

/* ---------- 前端归组表：NAV_GROUPS 的 kind:"view" 键 ---------- */
const shellSrc = read(SHELL);
let navViewKeys = [];
if (shellSrc) {
  const body = arrayBlock(stripComments(shellSrc), declOf("NAV_GROUPS"), `${SHELL} NAV_GROUPS`);
  if (body !== null) {
    // 形态 A：{ kind: "view", key: "dash" }
    for (const m of body.matchAll(/\{\s*kind:\s*"view"[^}]*?key:\s*"([^"]+)"\s*\}/g)) navViewKeys.push(m[1]);
    // 形态 B：["a","b",…].map((key) => ({ kind: "view" as const, key }))
    for (const m of body.matchAll(/\[([^\]]*)\]\s*\.map\(\s*\(\s*key\s*\)\s*=>\s*\(\s*\{\s*kind:\s*"view"/g)) {
      for (const s of m[1].matchAll(/"([^"]+)"/g)) navViewKeys.push(s[1]);
    }
  }
}

/* ---------- 判据③ 门自身没坏（先跑，坏了后面两条的"绿"没有意义） ---------- */
const canaries = [
  [`${MANIFEST} BUILTIN_VIEWS(seed:true)`, seeded],
  [`${FIXTURES} allViews`, mockKeys],
  [`${SHELL} NAV_GROUPS(kind:"view")`, navViewKeys],
];
for (const [label, set] of canaries) {
  if (!set.includes(CANARY)) {
    fail.push(
      `✗ 判据③ 门自身没坏：${label} 解析结果不含金丝雀键 "${CANARY}"（解析到 ${set.length} 项）——` +
        ` 这不是代码死了，是本门的解析器坏了。修门，别改被测代码。`,
    );
  }
}
if (seeded.length < BACKEND_FLOOR) {
  fail.push(
    `✗ 判据③ 门自身没坏：后端 seeded 内置视图只解析出 ${seeded.length} 项（下界 ${BACKEND_FLOOR}）——` +
      ` 后端侧解析变空会让 ①② 的差集恒空、门恒绿，这正是本门最怕的失效方式。`,
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

/* ---------- 判决 ---------- */
if (fail.length > 0) {
  console.error("✗ nav-group-coverage:check 失败（本体 §8 G-NAV-FALLBACK-BUCKET）\n");
  for (const f of fail) console.error(f + "\n");
  console.error(
    `参考：后端 seeded=${seeded.length} · mock allViews=${mockKeys.length} · NAV_GROUPS view 键=${navSet.size}`,
  );
  process.exit(1);
}
console.log(
  `✓ nav-group-coverage:check：后端 ${seeded.length} 个 seeded 内置视图全部有 NAV_GROUPS 归属且全在 mock allViews 里` +
    `（mock allViews=${mockKeys.length} · NAV_GROUPS view 键=${navSet.size}）`,
);
