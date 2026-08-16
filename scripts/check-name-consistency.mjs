#!/usr/bin/env node
/**
 * 名字一致性门 `name-consistency:check`
 *   —— **同一个视图，用户在三个地方看到的名字，分歧必须是登记过的分歧**。
 *
 * ## 由来（WO-NAME-CONSISTENCY · 本体 §8 `G-NAME-DUAL-LABEL`）
 *
 * 一个视图的「名字」不是一份，是**三份**，分别上三块屏：
 *
 *   | 命名空间 | 真相源 | 用户在哪看到 |
 *   |---|---|---|
 *   | **功能名** `featureName` | `view-manifest.ts` BUILTIN_VIEWS[].featureName<br>→ `features.ts` FEATURE_REGISTRY[].name<br>（跨服务册 `SHARED_FEATURE_NAMES` 钉死） | 「功能开通配置」页 `FeaturesPage.tsx` 渲染 `{def.name}` |
 *   | **视图标题** `navTitle` | `view-manifest.ts` BUILTIN_VIEWS[].title<br>/ `service.ts` VIEW_DEFS[k].title<br>→ ViewConfig.title + navigation.label → `/a/v1/me/workspace` | **侧栏导航条目**（用户点的那个字） |
 *   | **页内大标题** `pageHeading` | 视图组件里第一个 `<h1>/<h2>/<h3>`<br>（字面量 / `zh.*` 词表 / `view.title`） | **进去以后屏幕最上方那个字** |
 *
 * 三份各有各的真相源、互不校验 —— 于是「导航点 A、进去看到 B」这种事没有任何东西拦得住。
 *
 * ## 这道门守的是什么（判据落在**用户看到的那个名字**上）
 *
 * **不是**「三份必须相同」—— 那是产品决策，归仓主，本门不替他拍板。
 * 是「**不相同的必须登记过**」：存量分歧挂在 `DECLARED` 里明面上等裁决，
 * **新增的未登记分歧一律红**。仓主没拍板之前门也照常工作，这是它的设计目的。
 *
 * 两条判据：
 *   ① `featureName` ↔ `navTitle`   分歧 ⇒ 必须在 `DECLARED` 里
 *   ② `navTitle`    ↔ `pageHeading` 分歧 ⇒ 必须在 `DECLARED` 里
 *      —— 判据② 才是**用户真会撞上**的那一种（导航点一个名字、进去看到另一个）；
 *         判据① 的分歧只在管理台「功能开通配置」页可见，杀伤力小一档，但同样必须登记。
 *
 * **副标题不算分歧**（`compatible()`）：`「全链阻滞点 · 卡点 / 堵点 / 断点」` 与导航
 * 「全链阻滞点」是同一个名字加了一句副标题，不是两个名字。判据是「**其中一个是另一个
 * 以 ` · ` 分隔的前缀**」。把这类算成分歧会报出一堆假分叉，门就没人看了。
 *
 * **`view.title` 派生的页标题天然一致**（`ProcurementLegsView.tsx` 那个形态：
 * `<h2>{view.title || "兜底"}</h2>`）—— 标为 `DERIVED`，结构上不可能分歧，不参与判据②。
 * 这是本仓**唯一正确**的页标题写法，其余组件都是各写各的字面量/词表。
 *
 * ## 为什么必须是脚本，不能只是 vitest
 *
 * 三个真相源分别在 **datacore**（view-manifest/service）、**contracts**（feature-names）、
 * **frontend-shell**（组件 + zh 词表）。R1 contracts-only-shared 禁止跨 app import 源码 ⇒
 * 任何一个包的测试都**看不全三份**，只能在自己那半上自说自话。门脚本跨 app 读文件是允许的
 * （`scripts/**` 本来就这么干），于是这里是全仓唯一能把三份对上账的地方。
 *
 * ## 自证工具（铁律 0.6 —— 报「干净」之前先证明自己没瞎）
 *
 * 三重，且**与主逻辑共用同一份实现**（`analyze()` / `parse*()`，不另抄正则 ——
 * 抄了就是装饰品：改主正则时金丝雀拿旧的去测、照样绿）：
 *   · **正向金丝雀** `view.risk-board`：功能名「风险推演看板」≠ 视图标题「产能推演」，
 *     这是已知必中样例。抓不到 ⇒ 报「工具坏了」`exit 2`，**不许**报「仓库很干净」。
 *   · **反向金丝雀** `plan-audit`：功能名/视图标题/页标题三处都是「规划体检」，
 *     已知必**不**中。被误报 ⇒ 同样是工具坏了（比对方法太松会把全仓都报成分歧）。
 *   · **词法自检** `--self-test`：内嵌样例喂给同一批 parser，含**故意改坏**的变异体，
 *     解析结果不符预期即 `exit 2`。
 *
 * ## 基线纪律（本仓真发生过 `--update` 把基线从 87 悄悄抬到 94、买来一片绿）
 *
 * 本门**不设可自动更新的数字基线**。`DECLARED` 是逐条登记的白名单，加一条要写清理由，
 * 而且：
 *   · **陈旧条目即红** —— `DECLARED` 里登记的分歧若已不存在（名字改一致了），门报红要求删条目。
 *     这就是「只许降不许升」的落地形态：登记条目**不可能**因为改代码而自动增加，
 *     而一旦分歧被修好，门**逼你**把条目降下去。
 *   · `MAX_DECLARED` 是硬上限，**只许改小**。调大它需要跟改 `DECLARED` 一样写理由，
 *     没有 `--update` 之类的自动抬升入口（那正是上次买绿的那把钥匙）。
 *
 * ## 用法
 *
 *   node scripts/check-name-consistency.mjs              # 门（RC 0/1/2）
 *   node scripts/check-name-consistency.mjs --list       # 全表：每个视图三份名字并排
 *   node scripts/check-name-consistency.mjs --self-test  # 只跑词法自检
 *
 * 退出码三分（处置相反，不许合并）：
 *   0 = 干净（无未登记分歧）
 *   1 = 真违规（有未登记分歧 / 有陈旧登记）
 *   2 = 门自己坏了（读不到文件 / 解析器失灵 / 金丝雀不中）⇒ **结论作废**，先修门
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const F = {
  manifest: "apps/datacore/src/synthetic/view-manifest.ts",
  service: "apps/datacore/src/synthetic/service.ts",
  featureMap: "apps/datacore/src/features.ts",
  sharedNames: "packages/contracts/src/feature-names.ts",
  registry: "apps/frontend-shell/src/views/registry.ts",
  zh: "apps/frontend-shell/src/locales/zh.ts",
  viewsDir: "apps/frontend-shell/src/views",
};

/** 门自己坏了 —— 结论作废。**不许**降级成「没找到问题」。 */
function toolBroken(msg, detail) {
  console.error("🛠️  工具坏了 —— 本次结论作废，先修门再谈仓库干不干净。");
  console.error(`    ${msg}`);
  if (detail) console.error(`    ${detail}`);
  process.exit(2);
}

// ══════════════════════════════════════════════════════════════════════════
// 登记表 · 存量分歧（等仓主裁决 —— 见 docs/AUDIT-name-consistency.md）
// ══════════════════════════════════════════════════════════════════════════
/**
 * 每条 = 一处**已知且已登记**的分歧。key = `<viewKey>::<pair>`。
 *
 * `verdict` 三分（定性不同 ⇒ 修法不同，混为一谈必修错地方）：
 *   · `INTENTIONAL` 故意的，两个命名空间本就该不同 ⇒ 不是缺陷，登记以防它被"顺手改一致"
 *   · `DEFECT`      改名漏改 ⇒ 真缺陷，等仓主定用哪个名字后修
 *   · `SPLIT`       两个概念被塞进一个 key ⇒ 要拆键，不是改名
 */
const DECLARED = {
  "dash::featureName-vs-navTitle": {
    verdict: "INTENTIONAL",
    featureName: "驾驶舱",
    navTitle: "经营驾驶舱",
    why:
      "功能册里同级条目是「订单台账 / 规划体检 / 月度规划」这类**短名**，「驾驶舱」与之同构；" +
      "导航条目要在侧栏一眼说清是**经营**驾驶舱（与「决策驾驶舱」等区分）。两个命名空间各自的" +
      "语境不同，同一个东西取两个长度的名字是正常的。`feature-names.ts` 头注释已就此立过规矩。",
  },
  "risk::featureName-vs-navTitle": {
    verdict: "DEFECT",
    featureName: "风险推演看板",
    navTitle: "产能推演",
    why:
      "**不是**同一个名字的长短两版，是**两个不同的词**（「风险」vs「产能」）。用户在管理台开的是" +
      "「风险推演看板」，在导航里点的是「产能推演」，没有任何线索表明这是同一个东西。" +
      "页内大标题写的是「产能推演」，与导航一致 ⇒ 落单的是功能名那一份。等仓主裁决用哪个词。",
  },
  "plan-generate::featureName-vs-navTitle": {
    verdict: "DEFECT",
    featureName: "规划建议",
    navTitle: "方案生成",
    why:
      "同 risk：两个不同的词。且此处**导航是落单的那一份** —— 功能名与页内大标题都写「规划建议」，" +
      "只有视图标题写「方案生成」。三比一，改一处即收敛。",
  },
  "plan-generate::navTitle-vs-pageHeading": {
    verdict: "DEFECT",
    navTitle: "方案生成",
    pageHeading: "规划建议",
    why:
      "**本门判据② 抓到的唯一一条真·用户可见分歧**：侧栏点「方案生成」，进去屏幕最上方写「规划建议」。" +
      "这正是工单描述的那个形态 —— 只是它发生在 plan-generate，不是工单以为的 risk-board。",
  },
  "process-stuck::featureName-vs-navTitle": {
    verdict: "SPLIT",
    featureName: "流程运行时（实例·卡点）",
    navTitle: "流程卡点",
    why:
      "**不是改名问题，是一个功能键管着两样东西**：控制键 `process.runtime` 是**引擎级**开关" +
      "（流程实例运行时），而 `process-stuck` 只是它下面的**一个视图**（卡点面板）。" +
      "功能名描述的是引擎、视图标题描述的是页面，两者本就不是同一个对象 —— " +
      "所以它读起来像分歧，其实是**键的粒度**问题。修法是拆键或改功能名，不是把标题改成一样。",
  },
};

/** 硬上限 —— **只许改小**。调大与改 `DECLARED` 同级，须写理由；无自动抬升入口。 */
const MAX_DECLARED = 5;

/**
 * **盲区**登记：页内大标题解析不出静态字符串的视图（判据② 对它们失效）。
 *
 * 盲区**不是分歧**，但必须**看得见**：不登记就等于「把标题写成动态表达式即可绕过本门」。
 * 逐条登记 + 硬上限 ⇒ 新增盲区当场红，逼人要么写成可解析形态、要么明写理由。
 */
const DECLARED_BLIND = {
  "node-inspector": {
    heading: "{input.node.label}",
    why:
      "**它本来就没有固定页标题**：这一页的大标题是当前被检视节点的名字（用户点哪个节点就显示哪个），" +
      "属于**数据**不属于**页面命名**。判据② 对它天然不适用，不是漏检。",
  },
};

/** 盲区硬上限 —— 同样**只许改小**。 */
const MAX_BLIND = 1;

// ══════════════════════════════════════════════════════════════════════════
// 解析器（主逻辑与金丝雀 / 词法自检**共用同一份实现**）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 剥注释（`//` 与 `/* *\/`），保留字符串字面量里的内容。
 *
 * **必须先剥再配对花括号**：本仓的真相源里注释极长且**含大量花括号**
 * （`view-manifest.ts` 的注释里写着 `` `{ path: "v/<静态段>" }` `` 这类样例），
 * 不剥就会把注释里的括号算进配对深度 ⇒ 对象边界全错 ⇒ 少解析出条目 ⇒ 报「干净」。
 */
export function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    // 字符串 / 模板串：原样抄过去（里面的 // 和 /* 不是注释）
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      out += c;
      i++;
      while (i < n) {
        if (src[i] === "\\") {
          out += src[i] + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += src[i];
        if (src[i] === q) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue; // 换行留给下一轮抄进去，保住行号
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") out += "\n"; // 保住行号
        i++;
      }
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * 把数组体按**花括号配对**切成一个个顶层对象字面量。
 *
 * ⚠ **不能**用 `/\{[^{}]*\}/g` —— 带 `bindings: { … }` 嵌套的条目会被那条正则切成内层的
 * `{ apiTags: […] }`，于是**恰好是配置最全的那些视图**被整条丢掉（本仓 16 条里丢掉 10 条）。
 * 这个坑由本文件的「供给侧下界」当场抓出（解析出 6 条 < 下界 20 ⇒ 报工具坏了，而不是报干净）。
 */
export function splitTopLevelObjects(body) {
  const out = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        out.push(body.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return out;
}

/** 从 `openIdx`（指向 `{`）起做花括号配对，返回块体（不含外层花括号）。 */
export function braceBlock(src, openIdx) {
  if (src[openIdx] !== "{") return null;
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return null;
}

/**
 * `BUILTIN_VIEWS` → `[{ key, title, featureKey, featureName }]`。
 *
 * 逐条对象字面量取四个字段。**不**用一条大正则一把梭：那种写法遇到字段顺序变化就静默漏条，
 * 而漏条的表现是「分歧少了」= 假绿。
 */
export function parseBuiltinViews(rawSrc) {
  const src = stripComments(rawSrc);
  // ⚠ 必须锚在 `= [` 上，**不能**用 `indexOf("[", anchor)` —— 声明里的类型注解
  // `BuiltInView[]` 那个 `[` 先出现，锚错就配对出一个空数组体 ⇒ 解析出 0 条 ⇒ 全表报「干净」。
  // （这个坑是本文件的词法自检当场抓出来的，不是人想起来的 —— 正是金丝雀存在的理由。）
  const am = /export\s+const\s+BUILTIN_VIEWS[^=]*=\s*\[/.exec(src);
  if (!am) return [];
  const open = am.index + am[0].length - 1;
  // 数组体：从 `[` 配对到 `]`
  let depth = 0;
  let body = null;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "[") depth++;
    else if (src[i] === "]") {
      depth--;
      if (depth === 0) {
        body = src.slice(open + 1, i);
        break;
      }
    }
  }
  if (body === null) return [];
  const out = [];
  for (const o of splitTopLevelObjects(body)) {
    const key = /\bkey:\s*"([^"]*)"/.exec(o)?.[1];
    const title = /\btitle:\s*"([^"]*)"/.exec(o)?.[1];
    const featureKey = /\bfeatureKey:\s*"([^"]*)"/.exec(o)?.[1];
    const featureName = /\bfeatureName:\s*"([^"]*)"/.exec(o)?.[1];
    if (key && title && featureKey && featureName) out.push({ key, title, featureKey, featureName });
  }
  return out;
}

/**
 * `service.ts` 的 `VIEW_DEFS` 增量段 → `[{ key, title, renderer }]`。
 *
 * 只取**显式写了 title 字面量**的条目；核心段是 `...Object.fromEntries(BUILTIN_VIEWS.map(...))`
 * 派生的（无字面量）⇒ 天然不进此表，由 `parseBuiltinViews` 负责，两者不重不漏。
 */
export function parseIncrementalViewDefs(rawSrc) {
  const src = stripComments(rawSrc);
  // ⚠ 同 parseBuiltinViews 那个坑：`const VIEW_DEFS: Record<string, { title: string; … }> = {`
  // 的**类型注解**里那个 `{` 先出现，用 `indexOf("{", anchor)` 会配对到类型上 ⇒ 恒 0 条。
  const am = /const\s+VIEW_DEFS[^=]*=\s*\{/.exec(src);
  if (!am) return [];
  const body = braceBlock(src, am.index + am[0].length - 1);
  if (body === null) return [];
  const out = [];
  // 形态 A：`"key": { title: "…", renderer: "…", layout: { … 任意深嵌套 … } }`
  //
  // ⚠ **不能**用「允许一层嵌套」的正则（`\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}`）：
  // `quarterly-rolling` 的 `layout.gapTiers` 是**两层**嵌套 ⇒ 该条目整条匹配不上、静默丢掉。
  // 少一条 = 少报一处潜在分歧 = 假绿。故改为**深度扫描 + 花括号配对**，嵌套多深都不漏。
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "{") continue;
    const before = body.slice(Math.max(0, i - 120), i);
    const km = /"?([A-Za-z0-9._-]+)"?\s*:\s*$/.exec(before);
    const inner = braceBlock(body, i);
    if (inner === null) break;
    if (km) {
      // 只看**第一层**字段：把嵌套块整体挖掉，免得 layout 里万一也有 title 抢答
      const flat = inner.replace(/\{[\s\S]*?\}/g, "");
      const title = /\btitle:\s*"([^"]*)"/.exec(flat)?.[1];
      const renderer = /\brenderer:\s*"([^"]*)"/.exec(flat)?.[1];
      if (title && renderer) out.push({ key: km[1], title, renderer });
    }
    i += inner.length + 1; // 整块跳过 ⇒ 嵌套键永远不会被当成顶层条目
  }
  // 形态 B：`"graph-all": graphView("图谱·全景", …)` —— 视角页走工厂函数，renderer 恒 ontology-graph
  const gv = /(?:^|\n)\s*"?([a-z0-9-]+)"?:\s*graphView\(\s*"([^"]*)"/g;
  let m;
  while ((m = gv.exec(body))) out.push({ key: m[1], title: m[2], renderer: "ontology-graph" });
  return out;
}

/** `features.ts` 的 `VIEW_FEATURE_MAP` → `{ viewKey: featureKey }`。 */
export function parseViewFeatureMap(rawSrc) {
  const src = stripComments(rawSrc);
  const anchor = src.indexOf("VIEW_FEATURE_MAP");
  if (anchor < 0) return {};
  const open = src.indexOf("{", anchor);
  const body = braceBlock(src, open);
  if (body === null) return {};
  const out = {};
  const re = /(?:^|\n)\s*"?([A-Za-z0-9._-]+)"?:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(body))) out[m[1]] = m[2];
  return out;
}

/** `feature-names.ts` 的 `SHARED_FEATURE_NAMES` → `{ featureKey: name }`。 */
export function parseSharedFeatureNames(rawSrc) {
  const src = stripComments(rawSrc);
  const anchor = src.indexOf("SHARED_FEATURE_NAMES");
  if (anchor < 0) return {};
  const open = src.indexOf("{", anchor);
  const body = braceBlock(src, open);
  if (body === null) return {};
  const out = {};
  const re = /"([A-Za-z0-9._-]+)":\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(body))) out[m[1]] = m[2];
  return out;
}

/** `registry.ts` 的 `registerRenderer("k", () => import("./M"))` → `{ renderer: modulePath }`。 */
export function parseRendererMap(src) {
  const out = {};
  const re = /registerRenderer\(\s*"([^"]+)"\s*,\s*\(\)\s*=>\s*import\(\s*"([^"]+)"\s*\)/g;
  let m;
  while ((m = re.exec(src))) out[m[1]] = m[2];
  return out;
}

/**
 * 在 `zh.ts` 源码里按点分路径取字符串：`sim.gen.title` → `"规划建议"`。
 *
 * 逐段花括号下钻（**不** eval、**不** import —— 那会把整个前端依赖图拖进门里）。
 * 末段支持三形态：字面量 / 模板串 / 箭头函数返回模板串（如 `aop.title(year)`）。
 * 函数形态取模板串的**静态前缀**（`年度规划 · AOP ${year}` → `年度规划 · AOP`），
 * 因为参与比对的只有前缀那部分语义。
 */
export function resolveZhPath(rawSrc, dotted) {
  const src = stripComments(rawSrc);
  const segs = dotted.split(".");
  let region = src;
  for (let i = 0; i < segs.length - 1; i++) {
    const re = new RegExp(`(?:^|\\n)\\s*"?${segs[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"?:\\s*\\{`, "m");
    const m = re.exec(region);
    if (!m) return null;
    const open = region.indexOf("{", m.index + m[0].length - 1);
    const body = braceBlock(region, open);
    if (body === null) return null;
    region = body;
  }
  const last = segs[segs.length - 1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 字面量：title: "月度规划"
  let m = new RegExp(`(?:^|\\n)\\s*"?${last}"?:\\s*"([^"]*)"`, "m").exec(region);
  if (m) return m[1];
  // 模板串 / 箭头函数返回模板串：title: (year) => `年度规划 · AOP ${year}`
  m = new RegExp(`(?:^|\\n)\\s*"?${last}"?:\\s*(?:\\([^)]*\\)\\s*=>\\s*)?\`([^\`]*)\``, "m").exec(region);
  if (m) return m[1].replace(/\$\{[^}]*\}/g, "").trim().replace(/\s*·\s*$/, "");
  return null;
}

/**
 * 从视图组件源码里取**页内大标题**（= 文件里第一个 `<h1>/<h2>/<h3>`）。
 *
 * 返回 `{ kind, value, line }`：
 *   · `LITERAL`    字面量（可能带 ` · 副标题`）
 *   · `ZH`         `{zh.a.b.title}` —— 已按词表解析
 *   · `ZH_ALIAS`   `{t.title}` 且文件里有 `const t = zh.X` —— 已解析
 *   · `DERIVED`    `{view.title || "兜底"}` —— **结构上跟随导航标题**，不可能分歧
 *   · `NONE`       文件里没有 hN（该页不设页内大标题，导航 label 是它唯一的名字）
 *   · `UNRESOLVED` 有 hN 但解析不出（如 `{CONST[mode]}`）—— **诚实报出**，不当成"没问题"
 *
 * ⚠ 「文件里第一个 hN」是启发式：若组件把主标题写在文件后半、而前半的辅助子组件也有 hN，
 * 会取错。**正因为是启发式，才必须有反向金丝雀** —— `plan-audit` 已知三处同名，
 * 取错就会把它误报成分歧，门当场 `exit 2` 说自己坏了，而不是安静地放行。
 */
export function parsePageHeading(src) {
  const m = /<h[123]\b([^>]*)>([\s\S]*?)<\/h[123]>/.exec(src);
  if (!m) return { kind: "NONE", value: null, line: null };
  const line = src.slice(0, m.index).split("\n").length;
  const inner = m[2].trim();

  // `{view.title || "兜底"}` —— 唯一正确写法，跟随 ViewConfig.title
  if (/\{\s*view\.title\b/.test(inner)) return { kind: "DERIVED", value: null, line };

  // `{zh.a.b.c}`（后面可以再跟别的表达式/文本 —— 取 zh 那一段当前缀）
  let z = /\{\s*zh\.([A-Za-z0-9_.]+?)\s*(?:\([^)]*\))?\s*\}/.exec(inner);
  if (z) return { kind: "ZH", value: null, zhPath: z[1], line };

  // `{t.title}` —— 别名，需在组件里回查 `const t = zh.X`
  //
  // ⚠ 取**离标题最近的那一处前置绑定**，不是文件里第一处。`ProcessWaitView.tsx` 实测有三处
  // `const t = …`（`:80` = `zh.processWait.instances`、`:211`/`:367` = `zh.processWait`），
  // 而标题在 `:386` ⇒ 归 `:367` 管。取第一处会解析成 `processWait.instances.title`（不存在）
  // ⇒ 该页退成 UNRESOLVED、判据② 对它失效 —— 一个**看不见的漏检**，比报错更危险。
  z = /\{\s*([A-Za-z_$][\w$]*)\.([A-Za-z0-9_.]+?)\s*\}/.exec(inner);
  if (z) {
    const alias = z[1];
    const rest = z[2];
    const bindRe = new RegExp(`const\\s+${alias}\\s*=\\s*zh\\.([A-Za-z0-9_.]+)\\s*;`, "g");
    let best = null;
    let bm;
    while ((bm = bindRe.exec(src))) {
      if (bm.index < m.index) best = bm[1];
      else break;
    }
    if (best) return { kind: "ZH_ALIAS", value: null, zhPath: `${best}.${rest}`, line };
    return { kind: "UNRESOLVED", value: inner, line };
  }

  // 纯字面量（允许内嵌注释/空白）；含任何 `{…}` 表达式则判不可解析
  const plain = inner.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").trim();
  if (plain && !plain.includes("{")) return { kind: "LITERAL", value: plain, line };
  // 形态：`{zh.quarter.title} · {expr}` 已在上面被 ZH 分支吃掉；剩下的才是真不可解析
  return { kind: "UNRESOLVED", value: inner, line };
}

/**
 * 两个名字是否**兼容**（= 不算分歧）。
 *
 * 相等，或其中一个是另一个以 ` · ` 分隔的前缀（副标题形态：
 * 「全链阻滞点 · 卡点 / 堵点 / 断点」与「全链阻滞点」是同一个名字加副标题，不是两个名字）。
 * 判据放松到这一档是**有意的**：不放松会报出一堆假分叉，门就没人看了；
 * 再放松（如只比首字）就会漏掉真分歧。反向金丝雀钉住这个档位。
 */
export function compatible(a, b) {
  if (a == null || b == null) return true;
  if (a === b) return true;
  return a.startsWith(`${b} · `) || b.startsWith(`${a} · `);
}

/**
 * 主判据 —— **金丝雀与门体共用这一个函数**（不许各抄一份）。
 *
 * 入参是**已读好的文本**而非路径，正因如此金丝雀才能拿内嵌样例喂同一条逻辑。
 */
export function analyze(sources) {
  const builtins = parseBuiltinViews(sources.manifest);
  const incremental = parseIncrementalViewDefs(sources.service);
  const featureMap = parseViewFeatureMap(sources.featureMap);
  const sharedNames = parseSharedFeatureNames(sources.sharedNames);
  const rendererMap = parseRendererMap(sources.registry);

  const rows = [];
  const seen = new Set();

  const push = (key, navTitle, featureKey, featureName, renderer) => {
    if (seen.has(key)) return;
    seen.add(key);
    const heading = resolveHeading(key, renderer, rendererMap, sources);
    rows.push({ key, navTitle, featureKey, featureName: featureName ?? null, renderer, heading });
  };

  for (const b of builtins) push(b.key, b.title, b.featureKey, b.featureName, rendererOf(b.key, incremental, sources));
  for (const v of incremental) {
    const fk = featureMap[v.key] ?? null;
    push(v.key, v.title, fk, fk ? (sharedNames[fk] ?? null) : null, v.renderer);
  }

  // BUILTIN 那批的 renderer 取自 manifest 本身（上面 rendererOf 兜底），此处补齐 featureName 来源一致性
  for (const r of rows) {
    if (r.featureName == null && r.featureKey) r.featureName = sharedNames[r.featureKey] ?? null;
  }

  const findings = [];
  for (const r of rows) {
    // 判据① 功能名 ↔ 视图标题
    if (r.featureName && !compatible(r.featureName, r.navTitle)) {
      findings.push({ key: r.key, pair: "featureName-vs-navTitle", a: r.featureName, b: r.navTitle, row: r });
    }
    // 判据② 视图标题 ↔ 页内大标题（DERIVED/NONE 不参与：结构上不可能分歧 / 该页无页标题）
    const h = r.heading;
    if (h && (h.kind === "LITERAL" || h.kind === "ZH" || h.kind === "ZH_ALIAS") && h.value != null) {
      if (!compatible(r.navTitle, h.value)) {
        findings.push({ key: r.key, pair: "navTitle-vs-pageHeading", a: r.navTitle, b: h.value, row: r });
      }
    }
  }
  return { rows, findings };
}

function rendererOf(key, incremental, sources) {
  const m = new RegExp(`key:\\s*"${key}",[^}]*?renderer:\\s*"([^"]+)"`).exec(sources.manifest);
  if (m) return m[1];
  return incremental.find((v) => v.key === key)?.renderer ?? null;
}

function resolveHeading(key, renderer, rendererMap, sources) {
  if (!renderer) return { kind: "NONE", value: null, line: null };
  const mod = rendererMap[renderer];
  if (!mod) return { kind: "NONE", value: null, line: null };
  const rel = path.join(F.viewsDir, `${mod.replace(/^\.\//, "")}.tsx`);
  const src = sources.components[rel];
  if (src == null) return { kind: "NONE", value: null, line: null, file: rel };
  const h = parsePageHeading(src);
  h.file = rel;
  if ((h.kind === "ZH" || h.kind === "ZH_ALIAS") && h.zhPath) {
    h.value = resolveZhPath(sources.zh, h.zhPath);
    if (h.value == null) h.kind = "UNRESOLVED";
  }
  return h;
}

// ══════════════════════════════════════════════════════════════════════════
// 词法自检（内嵌样例 → 同一批 parser）
// ══════════════════════════════════════════════════════════════════════════
const SELF_TEST_CASES = [
  {
    name: "parseBuiltinViews · 四字段齐全才收，字段顺序变化不漏条",
    run: () => {
      const src = `export const BUILTIN_VIEWS: BuiltInView[] = [
  { key: "canary", title: "金丝雀页", renderer: "canary-r", featureKey: "view.canary", featureName: "金丝雀功能", seed: true },
  { featureName: "倒序功能", key: "rev", featureKey: "view.rev", renderer: "r2", title: "倒序页", seed: true },
  { key: "nofeat", title: "缺字段", renderer: "r3", seed: true },
];`;
      const got = parseBuiltinViews(src);
      const want = [
        { key: "canary", title: "金丝雀页", featureKey: "view.canary", featureName: "金丝雀功能" },
        { key: "rev", title: "倒序页", featureKey: "view.rev", featureName: "倒序功能" },
      ];
      return JSON.stringify(got) === JSON.stringify(want) ? null : `期望 ${JSON.stringify(want)}，实得 ${JSON.stringify(got)}`;
    },
  },
  {
    name: "resolveZhPath · 嵌套下钻 + 模板函数取静态前缀",
    run: () => {
      const src = `export default {
  aop: { title: (year: number) => \`年度规划 · AOP \${year}\`, x: "y" },
  sim: {
    gen: { title: "规划建议" },
    audit: { title: "规划体检" },
  },
};`;
      const a = resolveZhPath(src, "sim.gen.title");
      const b = resolveZhPath(src, "aop.title");
      const c = resolveZhPath(src, "sim.missing.title");
      if (a !== "规划建议") return `sim.gen.title 期望「规划建议」，实得 ${JSON.stringify(a)}`;
      if (b !== "年度规划 · AOP") return `aop.title 期望「年度规划 · AOP」，实得 ${JSON.stringify(b)}`;
      if (c !== null) return `不存在的路径应返回 null，实得 ${JSON.stringify(c)}`;
      return null;
    },
  },
  {
    name: "parsePageHeading · 六形态各归各位",
    run: () => {
      const cases = [
        [`return (<div><h3>产能推演</h3></div>);`, "LITERAL", "产能推演"],
        [`return (<div><h3>{zh.sim.gen.title}</h3></div>);`, "ZH", null],
        [`const t = zh.processWait;\nreturn (<h3>{t.title}</h3>);`, "ZH_ALIAS", null],
        [`return (<h2 className={styles.title}>{view.title || "兜底"}</h2>);`, "DERIVED", null],
        [`return (<div>没有标题</div>);`, "NONE", null],
        [`return (<h2 data-testid="x">{CANVAS_MODE_TITLE[mode]}</h2>);`, "UNRESOLVED", null],
      ];
      for (const [src, kind, value] of cases) {
        const got = parsePageHeading(src);
        if (got.kind !== kind) return `源 ${JSON.stringify(src.slice(0, 40))} 期望 kind=${kind}，实得 ${got.kind}`;
        if (value != null && got.value !== value) return `期望 value=${value}，实得 ${JSON.stringify(got.value)}`;
      }
      return null;
    },
  },
  {
    name: "compatible · 副标题不算分歧，两个不同的词算",
    run: () => {
      if (!compatible("全链阻滞点", "全链阻滞点 · 卡点 / 堵点 / 断点")) return "副标题形态被误判成分歧";
      if (!compatible("规划体检", "规划体检")) return "完全相同被误判成分歧";
      if (compatible("方案生成", "规划建议")) return "两个不同的词被误判成兼容 —— 判据太松，全仓会报干净";
      if (compatible("产能推演", "风险推演看板")) return "两个不同的词被误判成兼容";
      return null;
    },
  },
  {
    name: "变异反证 · 喂一个改坏的样例，analyze 必须抓出分歧",
    run: () => {
      const mutated = mkSample({ navTitle: "方案生成", featureName: "规划建议", heading: "规划建议" });
      const { findings } = analyze(mutated);
      const keys = findings.map((f) => `${f.key}::${f.pair}`).sort();
      const want = ["canary::featureName-vs-navTitle", "canary::navTitle-vs-pageHeading"];
      if (JSON.stringify(keys) !== JSON.stringify(want)) {
        return `改坏的样例期望抓出 ${JSON.stringify(want)}，实得 ${JSON.stringify(keys)}`;
      }
      // 反向：三处同名的样例必须一条都不报
      const clean = mkSample({ navTitle: "规划体检", featureName: "规划体检", heading: "规划体检" });
      const n = analyze(clean).findings.length;
      if (n !== 0) return `三处同名的样例不该报分歧，实得 ${n} 条`;
      return null;
    },
  },
];

/** 造一份最小的「四份源码」样例喂给 `analyze`（与真实结构同形，供变异反证用）。 */
function mkSample({ navTitle, featureName, heading }) {
  return {
    manifest: `export const BUILTIN_VIEWS: BuiltInView[] = [
  { key: "canary", title: "${navTitle}", renderer: "canary-r", featureKey: "view.canary", featureName: "${featureName}", seed: true },
];`,
    service: `const VIEW_DEFS: Record<string, X> = {\n  ...Object.fromEntries(BUILTIN_VIEWS.map((bv) => [bv.key, bv])),\n};`,
    featureMap: `const VIEW_FEATURE_MAP: Record<string, string> = {\n  canary: "view.canary",\n};`,
    sharedNames: `export const SHARED_FEATURE_NAMES = {\n  "view.canary": "${featureName}",\n};`,
    registry: `registerRenderer("canary-r", () => import("./CanaryView"));`,
    zh: `export default { canary: { title: "${heading}" } };`,
    components: { [path.join(F.viewsDir, "CanaryView.tsx")]: `return (<div><h3>${heading}</h3></div>);` },
  };
}

function runSelfTest() {
  const fails = [];
  for (const c of SELF_TEST_CASES) {
    let err;
    try {
      err = c.run();
    } catch (e) {
      err = `抛异常：${e && e.message}`;
    }
    if (err) fails.push(`  ✗ ${c.name}\n      ${err}`);
  }
  return fails;
}

// ══════════════════════════════════════════════════════════════════════════
// 主流程
// ══════════════════════════════════════════════════════════════════════════
function readAll() {
  const sources = { components: {} };
  for (const [k, rel] of Object.entries(F)) {
    if (k === "viewsDir") continue;
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) toolBroken(`读不到真相源 ${rel}`, "文件不存在 ⇒ 无法判断仓库是否干净，不是「干净」。");
    sources[k] = fs.readFileSync(abs, "utf8");
  }
  const dir = path.join(ROOT, F.viewsDir);
  if (!fs.existsSync(dir)) toolBroken(`读不到视图目录 ${F.viewsDir}`);
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".tsx")) sources.components[path.relative(ROOT, p)] = fs.readFileSync(p, "utf8");
    }
  };
  walk(dir);
  return sources;
}

function main() {
  const argv = process.argv.slice(2);

  // ── 词法自检（--self-test 单跑；门体每次也跑）──
  const lexFails = runSelfTest();
  if (lexFails.length > 0) {
    toolBroken(`词法自检 ${lexFails.length}/${SELF_TEST_CASES.length} 条不过 —— 解析器坏了，任何结论都不作数。`, `\n${lexFails.join("\n")}`);
  }
  if (argv.includes("--self-test")) {
    console.log(`✅ 词法自检 ${SELF_TEST_CASES.length}/${SELF_TEST_CASES.length} 全过（含变异反证）。`);
    return 0;
  }

  const sources = readAll();
  const { rows, findings } = analyze(sources);

  // ── 供给侧下界：解析结果不该突然变空/变小（变小 = 解析器悄悄失灵）──
  if (rows.length < 20) {
    toolBroken(`只解析出 ${rows.length} 个视图（下界 20）`, "真相源结构变了而解析器没跟上 ⇒ 分歧会被少报成「干净」。");
  }

  // ── 金丝雀（与门体共用 analyze 的输出，不另抄一份判据）──
  const hit = (k, p) => findings.some((f) => f.key === k && f.pair === p);
  if (!hit("risk", "featureName-vs-navTitle")) {
    toolBroken(
      "正向金丝雀不中：`risk` 的功能名「风险推演看板」与视图标题「产能推演」是已知必中样例，本次没抓到。",
      "⇒ 报「工具坏了」，**不许**报「仓库很干净」。\n" +
        "    两种可能，先分清再动手：\n" +
        "      (a) 解析器坏了 —— 修门；\n" +
        "      (b) 仓主**有意**把 risk 的名字改一致了（裁决落地）—— 那就把本金丝雀换成另一处\n" +
        "          已知分歧当样例（候选见 docs/AUDIT-name-consistency.md），同步删 DECLARED 对应条目\n" +
        "          并把 MAX_DECLARED 调小。**不许**直接删掉金丝雀了事 —— 门就此失去自证能力。",
    );
  }
  const riskRow = rows.find((r) => r.key === "risk");
  if (!riskRow || riskRow.featureName !== "风险推演看板" || riskRow.navTitle !== "产能推演") {
    toolBroken(
      `正向金丝雀取值不对：期望 risk = { featureName: "风险推演看板", navTitle: "产能推演" }，实得 ${JSON.stringify(riskRow)}`,
    );
  }
  const auditRow = rows.find((r) => r.key === "plan-audit");
  if (!auditRow) toolBroken("反向金丝雀缺失：解析结果里没有 `plan-audit`。");
  if (auditRow.featureName !== "规划体检" || auditRow.navTitle !== "规划体检" || auditRow.heading.value !== "规划体检") {
    toolBroken(
      "反向金丝雀取值不对：`plan-audit` 三处已知同名「规划体检」，" +
        `实得 featureName=${JSON.stringify(auditRow.featureName)} navTitle=${JSON.stringify(auditRow.navTitle)} pageHeading=${JSON.stringify(auditRow.heading.value)}`,
      "取不到页标题 = 判据② 对该页失效 ⇒ 全表的「无分歧」都不可信。",
    );
  }
  if (findings.some((f) => f.key === "plan-audit")) {
    toolBroken("反向金丝雀被误报：`plan-audit` 三处同名却被判成分歧 ⇒ 比对方法太严，全表结论作废。");
  }

  // ── --list：全表并排 ──
  if (argv.includes("--list")) {
    console.log(`\n视图名字三处并排（共 ${rows.length} 个视图）\n`);
    console.log(`${"viewKey".padEnd(20)}${"功能名".padEnd(26)}${"视图标题(导航)".padEnd(26)}页内大标题`);
    console.log("─".repeat(110));
    for (const r of rows) {
      const h = r.heading;
      const hs =
        h.kind === "DERIVED"
          ? "（跟随视图标题）"
          : h.kind === "NONE"
            ? "（该页无页标题）"
            : h.kind === "UNRESOLVED"
              ? `⟨盲区·解析不出⟩ ${h.value ?? ""}`
              : (h.value ?? `⟨${h.kind}⟩`);
      console.log(`${r.key.padEnd(20)}${(r.featureName ?? "—").padEnd(26)}${r.navTitle.padEnd(26)}${hs}`);
    }
    console.log("");
  }

  // ── 判负 ──
  const declaredKeys = new Set(Object.keys(DECLARED));
  if (declaredKeys.size > MAX_DECLARED) {
    console.error(`🔴 登记表条目 ${declaredKeys.size} 条 > 上限 ${MAX_DECLARED} —— 上限只许改小，不许为了放行而抬高。`);
    return 1;
  }

  const undeclared = findings.filter((f) => !declaredKeys.has(`${f.key}::${f.pair}`));
  const foundKeys = new Set(findings.map((f) => `${f.key}::${f.pair}`));
  const stale = [...declaredKeys].filter((k) => !foundKeys.has(k));

  // 盲区：判据② 解析不出静态标题的页（**不是分歧，但必须看得见**，否则改成动态表达式即可绕门）
  const blind = rows.filter((r) => r.heading && r.heading.kind === "UNRESOLVED");
  const blindKeys = new Set(Object.keys(DECLARED_BLIND));
  const newBlind = blind.filter((r) => !blindKeys.has(r.key));
  const staleBlind = [...blindKeys].filter((k) => !blind.some((r) => r.key === k));

  console.log(`\n🔎 名字一致性：扫 ${rows.length} 个视图 · 分歧 ${findings.length} 处 · 已登记 ${declaredKeys.size} 条 · 上限 ${MAX_DECLARED}`);
  console.log(`   判据② 盲区（页标题非静态串）${blind.length} 处 · 已登记 ${blindKeys.size} 条 · 上限 ${MAX_BLIND}`);
  console.log(`   金丝雀：正向 risk（功能名「风险推演看板」≠ 视图标题「产能推演」）✓ 抓到 · 反向 plan-audit（三处同名）✓ 未误报`);

  if (blindKeys.size > MAX_BLIND) {
    console.error(`🔴 盲区登记 ${blindKeys.size} 条 > 上限 ${MAX_BLIND} —— 上限只许改小。`);
    return 1;
  }
  if (newBlind.length > 0) {
    console.error(`\n🔴 未登记的判据② 盲区 ${newBlind.length} 处 —— 这些页的大标题解析不出静态字符串，本门对它们失效：\n`);
    for (const r of newBlind) {
      console.error(`  · ${r.key}  页标题写法：${r.heading.value ?? "?"}`);
      if (r.heading.file && r.heading.line) console.error(`      ${r.heading.file}:${r.heading.line}`);
    }
    console.error("\n修法二选一：① 把页标题改成 `{view.title || \"兜底\"}`（跟随导航，结构上不可能分歧，本仓唯一正确写法）；");
    console.error("            ② 若它本就没有固定页标题（如显示被选中对象的名字），在 `DECLARED_BLIND` 里登记并写清理由。");
  }
  if (staleBlind.length > 0) {
    console.error(`\n🔴 陈旧盲区登记 ${staleBlind.length} 条（现已可解析）：${staleBlind.join(", ")} —— 请删掉并调小 MAX_BLIND。`);
  }

  if (undeclared.length > 0) {
    console.error(`\n🔴 未登记的名字分歧 ${undeclared.length} 处 —— 同一个视图两个名字，且没人登记过它是故意的：\n`);
    for (const f of undeclared) {
      const h = f.row.heading;
      console.error(`  · ${f.key} 【${f.pair}】`);
      console.error(`      ${f.pair === "featureName-vs-navTitle" ? "功能名" : "视图标题"}：「${f.a}」`);
      console.error(`      ${f.pair === "featureName-vs-navTitle" ? "视图标题" : "页内大标题"}：「${f.b}」`);
      if (h && h.file && h.line) console.error(`      页标题出处：${h.file}:${h.line}`);
      console.error("");
    }
    console.error("修法二选一（**不许**只把门的上限调大）：");
    console.error("  ① 改名字改到一致 —— 名字的真相源见本文件头注的三行表；");
    console.error("  ② 若两个名字**本就该不同**，在 `scripts/check-name-consistency.mjs` 的 `DECLARED` 里登记，");
    console.error("     写清 verdict（INTENTIONAL / DEFECT / SPLIT）与理由，并同步 docs/AUDIT-name-consistency.md。");
  }

  if (stale.length > 0) {
    console.error(`\n🔴 陈旧登记 ${stale.length} 条 —— 登记表里写着的分歧现实中已不存在（名字已改一致？）：\n`);
    for (const k of stale) console.error(`  · ${k}`);
    console.error("\n请从 `DECLARED` 里删掉它们，并把 `MAX_DECLARED` 一并调小（基线只许降不许升）。");
  }

  if (undeclared.length > 0 || stale.length > 0 || newBlind.length > 0 || staleBlind.length > 0) return 1;

  console.log(`✅ 无未登记分歧（${declaredKeys.size} 处存量分歧 + ${blindKeys.size} 处盲区均已登记，裁决清单见 docs/AUDIT-name-consistency.md）。\n`);
  return 0;
}

// 顶层兜底 —— **必须是 Program 的直接子语句**（`check-gate-exit-discipline` 只认这一形态；
// 写成 `if (isMain) { try … }` 会被判「无顶层兜底」，本仓已有两道门各栽过一次）。
// 任何未预期异常一律归 2（门坏了），不许掉进 node 默认的 exit 1 去撞「真违规」那个码。
//
// `isMain` 判在 try **内部**：本文件的 parser 被词法自检与调试脚本 import，
// 顶层无条件跑 main() 会让「import 它」等于「跑一遍门并 exit」，没法单测。
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
let rc = 0;
try {
  if (isMain) rc = main();
} catch (e) {
  toolBroken("未预期异常", (e && e.stack) || String(e));
}
if (isMain) process.exit(rc);
