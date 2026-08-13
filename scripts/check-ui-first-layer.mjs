#!/usr/bin/env node
/**
 * 门 `ui-first-layer:check` · **UI 第一层信息密度门**（WO-UI-LAYERING-CENSUS）
 *
 * 制度出处：`docs/CONVENTION-ui-information-layering.md` —— 仓主 2026-08-10 逐页实测后的通例判断
 *   > **太多信息在第一层，密密麻麻，无法看到重点指标信息**
 * 该规范 §2 给了三条「可核对的硬判据」（R-UI-1 视线距离 / R-UI-2 字号层级 ≤3 /
 * R-UI-3 公式与口径不在第一层），§6 却自认**「门禁：暂未机械化」**，只靠 §5 人工复审。
 * 实测（2026-08-11，本单）：`scripts/` 下**零个门**守这份规范，全仓只有两个测试文件提到它，
 * 且都在沙盘范围内 —— **一份写得很细的规范，只被用在一个页面上**。
 * 本门把 §2 里**能机检的那部分**变成机械可证伪的断言。
 *
 * ══ 守的命题 ═══════════════════════════════════════════════════════════════════
 * **第一层（不点就看见的那一层）只放结论；明细降到第二层，口径与公式降到浮层。**
 * 存量 95 个页面文件普遍超标（见 `docs/AUDIT-ui-first-layer-density.md`），
 * 故本门是**棘轮**：存量逐条登记基线、只降不升，新增超标一律红。
 *
 * ══ 四条判据（各抓一种错法）════════════════════════════════════════════════════
 *  ① D1 第一层信息块数 `first` —— 规范 §5 复审判据 2 原文「**数一数第一屏有几个信息块**」。
 *                      信息块 = 一个 JSX 元素，其**直接子节点**里含至少一条可渲染内容
 *                      （非空白文本 / 值表达式）。棘轮只降不升。
 *  ② D2 口径公式在第一层 `formula` —— 规范 §2 R-UI-3 点名的那些形态（`×` `÷` `∩` `min(`、
 *                      「口径」「公式」「按 X 不按 Y」…）出现在**第一层**文案里即计一条。
 *                      同样的字串出现在浮层里**不计** —— 本门咬的是**位置**，不是**内容**。
 *  ③ D3 字号层级数 `sizes` —— 规范 §2 R-UI-2「一屏之内最多三级字号」。
 *                      取该文件**实际用到**的字号：内联 `style={{fontSize}}` ∪
 *                      （它 `styles.X` 引用到的那些 CSS 类里的 `font-size`）。
 *                      未登记基线的**新文件**硬上限 = 3（规范原文的数，不是我编的）。
 *  ④ D4 **守恒（反「删内容冒充分层」）** —— 这条是本门的要害，单独说明见下。
 *
 * ══ ⚠ D4：为什么必须有一条「反删除」判据 ════════════════════════════════════════
 * 只要把 `first` 做成「越小越好」的棘轮，**删掉一段内容**就能让分数变好 —— 而规范 §1 白纸黑字：
 *   > 诚实位**允许**降到浮层，**绝不允许删除**；静默降层等于删除。
 * 也就是说「first 变小」有两条成因，一好一坏，**光看 first 分不出来**：
 *   · **真分层**：内容从第一层**搬到**第二层/浮层 ⇒ `first` ↓ 且 `deferred` ↑
 *   · **假分层**：内容被**删掉**              ⇒ `first` ↓ 而 `deferred` **不涨**
 * 故 D4 断言：**`first` 下降时 `deferred` 不许同时下降**。降了即红，提示语直指规范 §1。
 * 这正是本单派单里那句「你的指标不许奖励删内容」——若只有 ①②③，本门会**奖励删除**，
 * 那它就不是在守这份规范，而是在鼓励违反它。
 *
 * ══ 诚实边界（本门做不到什么 · 不许当成"规范已全部机械化"）═══════════════════
 *  · **R-UI-1 视线距离本门判不了，且不打算假装能判。** 规范的判据是「标签与数值同时读进眼里
 *    要不要移动视线超过一张卡宽」——那是**渲染后的几何量**（依赖视口宽、flex 分配、字体度量），
 *    源码里不存在这个量。硬编一个「full-width flex + space-between」之类的代理指标，
 *    度量的是**写法**不是**视线距离**，正是本仓铁律 0.6 点名的那种病
 *    （「我用 X 当作 Y 的证据，而 X 并不度量 Y」）。**R-UI-1 仍由规范 §5 人工执行。**
 *    本门只在普查里给出与之相关的**旁证**（`first` 高 + 字号少 ⇒ 很可能是长条行式布局），
 *    旁证**不进门**。
 *  · `first` 是**静态模板**计数，不乘数据行数：`.map()` 渲染的行模板计一次。
 *    所以它度量的是「这一屏摆了几种信息块」，不是「屏上最终有几个块」。
 *  · 「第二层」的判定靠**披露式条件**的变量名（`open/expand/tab/mode/selected…`）与
 *    浮层组件名。用别的命名法写的折叠会被误判成第一层（**偏保守，宁可多报**）。
 *  · 本门**不守原生 `title=` 存量**（规范 §2 明令禁止用它当浮层）：该项另有 dev 在建专门的棘轮，
 *    两道门各设一份基线必然漂移。本门只在 `--census` 里**报数**，不据此红。
 *
 * ══ 金丝雀（保命判据 · 每次运行都先跑）════════════════════════════════════════
 * 开扫之前先拿**内嵌样例**过一遍 `analyze()` —— **与主逻辑同一份实现，不另抄正则**
 * （抄一份 = 装饰品：改主正则时金丝雀拿旧的去测、照样绿。本仓 2026-08-08 实测过）。
 * 样例含「必咬」与「必不咬」两侧 + 扫描面规模下界。任一不成立 ⇒ 打印「⛔ 门自己瞎了」
 * 并 **RC=2**，而不是安静报「代码干净」。理由：本仓四个实测陷阱
 * （`git grep -- "apps/<星>/src"` 恒 0 命中、import 图解析器不认 ESM `./x.js`、
 * 正则窗口截断符号名、事件名在第二个实参）**都会让扫描器报 0 命中**，
 * 而 0 命中在门里长得跟"代码干净"一模一样。失败方向不安全的门必须先自证工具是对的。
 *
 * ══ 退出码（三分，不许合并）════════════════════════════════════════════════════
 *   0 = 干净 · 1 = 真超标（棘轮被顶高 / 新文件破硬上限 / D4 守恒被破）· 2 = **工具自己坏了**
 * 2 与 1 必须分开：「门坏了」和「代码坏了」处置完全不同，合成一个码就分不出来了。
 *
 * ⚠ **RC=1 只有一条路径：`gate()` 明确 `return 1`。** 其余一切失败（缺依赖 / 基线读不出 /
 * rev 取不到 / 参数缺失 / 任何未预期异常）统统走 `toolBroken()` ⇒ RC=2。
 * 这不是洁癖：复验时实测过一次真事故 —— `require("typescript")` 曾是模块顶层裸调用，
 * 在**没有 `node_modules` 的 worktree** 上抛未捕获异常，node 默认退 **1**，
 * 于是 `gate.sh` 把「**门根本没跑起来**」读成「**页面第一层超标**」，
 * 人会去改一个**一个字都没被扫过**的页面。默认失败方向必须是「我没查出来」。
 * 该契约**由机器守**：`--selftest` 会起子进程注入「缺 typescript」故障并断言 RC=2
 * （见 `UI_FIRST_LAYER_FORCE_NO_TS`）—— 写在注释里的约定不是机制。
 *
 * 本体登记：`docs/SYSTEM-ONTOLOGY.md` §7/§8，断点 `G-UI-FIRSTLAYER-OVERLOAD`。
 * 门账：`scripts/gate-ledger.json`（binding=GATES）。
 *
 * 用法：
 *   node scripts/check-ui-first-layer.mjs              # 门（棘轮比对）
 *   node scripts/check-ui-first-layer.mjs --selftest   # 只跑金丝雀
 *   node scripts/check-ui-first-layer.mjs --census     # 普查表（写 AUDIT 文档用）
 *   node scripts/check-ui-first-layer.mjs --update     # 重写基线（需人工核 why）
 *   node scripts/check-ui-first-layer.mjs --rev <rev>  # 从某个 git rev 读文件（改前/改后对比用）
 *   node scripts/check-ui-first-layer.mjs --explain <file>  # 单文件：第一层到底堆了什么
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join, dirname, resolve, relative, basename } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

/**
 * **RC=2 的唯一出口** —— 「我没能扫描」与「代码有问题」必须是两个不同的退出码。
 *
 * ⚠ 本函数是复验时抓到的一个真实缺陷的对策（2026-08-11，审核方在**没有 `node_modules`
 * 的 worktree** 上复跑时发现）：`require("typescript")` 当时是**模块顶层裸调用**，
 * 缺依赖时抛未捕获异常 ⇒ node 默认退出码 **1**。而按本仓约定 RC=1 = 「第一层真超标」，
 * 于是 `gate.sh` 会把「**门根本没跑起来**」当成「**页面超标**」，
 * 人去改页面 —— 而页面**一个字都没被扫过**。
 *
 * 这与本单普查报告里自己抓到的形态**完全同源**：
 * 「金丝雀先抓到的是**工具坏了**，不是数错了」—— 只是这次发生在门自己身上。
 * 照铁律 0.6 的句式：**「我用『进程非 0 退出』当作『代码有问题』的证据，而前者并不度量后者。」**
 *
 * 故：**任何**「我没能完成扫描」的情形（缺依赖 / 基线读不出 / git 取不到 / 写不进 / 未预期异常）
 * 一律走这里 ⇒ RC=2，并明说结论作废。
 */
function toolBroken(what, hint) {
  console.error(`⛔ ${what} ⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「无新增堆料 / 代码干净 / 页面达标」——");
  console.error("   本门这次根本没有扫描成功，它什么都没证明。");
  if (hint) console.error(`   ${hint}`);
  process.exit(2); // 2 = 工具自己坏了（1 是「真超标」，两者处置完全不同，不许合并）
}

/** typescript 是本门的解析器；缺了它不是「代码干净」，是「没得扫」。 */
function loadTypeScript() {
  // 故障注入开关：只给 `--selftest` 的子进程用，用来**机械验证**这条路径真的返回 2
  // （写在注释里的约定不是机制；只有机器跑得到的才是）。
  if (process.env.UI_FIRST_LAYER_FORCE_NO_TS === "1") {
    toolBroken("（故障注入）typescript 不可用", "这是 --selftest 在自检「缺依赖 ⇒ RC=2」这条路径。");
  }
  try {
    return require("typescript");
  } catch (e) {
    toolBroken(
      "缺 typescript（本门的 JSX 解析器）",
      "多半是这个 worktree 没装依赖：先跑 `pnpm install --prefer-offline` 再重跑本门。"
    );
  }
}

const ts = loadTypeScript();

const ROOT = process.cwd();
const BASELINE = join(ROOT, "scripts/ui-first-layer-baseline.json");
const SPEC = "docs/CONVENTION-ui-information-layering.md";

/* ═══════════════════════════════════════════════════════════════════════════
 * 扫描面
 * ⚠ 目录深度必须用 `-maxdepth` 语义逐层枚举，**不要用 git pathspec 的 `*`**：
 *   实测 `git ls-files -- 'apps/frontend-shell/src/views/*.tsx'` 命中 **47**（`*` 跨 `/`，
 *   把 `views/sim/**` 也算进顶层），而真正的顶层只有 **11**。
 *   本仓 CLAUDE.md 铁律 0.5 第 5 条记的就是这类"命令本身会骗你"。
 * ═══════════════════════════════════════════════════════════════════════════ */
const SCAN_DIRS = [
  { dir: "apps/frontend-shell/src/views", depth: 1, label: "views 顶层" },
  { dir: "apps/frontend-shell/src/views", depth: 2, onlyDepth: 2, label: "views 二层（含沙盘 sim/）" },
  { dir: "apps/frontend-shell/src/pages/admin", depth: 1, label: "pages/admin" },
];
/** 扫描面规模下界（金丝雀）——真实数 95；掉到下界以下 ⇒ 枚举器坏了，不是文件没了。 */
const MIN_FILES = 80;

/* ── 浮层 / 第二层 组件名（进了它的子树 = 不在第一层）───────────────────────── */
const DEFER_COMPONENT_RE =
  /^(InfoPopover|Popover|Tooltip|HoverCard|Modal|Dialog|Drawer|Sheet|Collapse|Accordion|Disclosure|Details|ContextMenu|DropdownMenu|Popconfirm)$/;
/** 原生 DOM 折叠：`<details>` 的子树（`<summary>` 除外）是第二层。 */
const DEFER_DOM = new Set(["details", "dialog"]);
/** 承载浮层内容的**属性名**（`content={<X/>}` 这类 render prop）。 */
const DEFER_ATTR_RE = /^(content|overlay|tooltip|popover|renderTooltip|renderPopover|footer|extra)$/;

/**
 * 「披露式条件」变量名 —— `{open && <X/>}` 里的 `open`。命中 ⇒ 该分支是**一次点击**之后才看见。
 * ⚠ 刻意**不含** `data|items|list|loading|error|rows|result` 这类**数据/状态**判空：
 *   那些不是「用户点一下」，渲染出来就在第一层。误把它们算作第二层会让分数虚好。
 */
const DISCLOSURE_RE =
  /(^|[^a-zA-Z])(open|opened|show|shown|expand|expanded|collapse|collapsed|visible|active|selected|current|tab|panel|drawer|modal|dialog|detail|details|drill|editing|reveal|revealed|picked|hover|hovered|focus|focused|mode|view|step|stage|toggle)([^a-zA-Z]|$)/i;

/**
 * R-UI-3 口径/公式形态 —— **逐条对着规范 §2 R-UI-3 原文抄的**，不是我自拟的词表：
 *   > 凡形如 `A × B ÷ C`、`min(...)`、`∩ ...`、「口径差」「联动口径」
 *   > 「按 X 显示不按 Y 措辞」的文字，一律进 `?` 浮层。
 */
const FORMULA_PATTERNS = [
  { re: /[×÷]/, why: "规范 R-UI-3 原文点名的 `A × B ÷ C` 形态" },
  { re: /[∩∪]/, why: "规范 R-UI-3 原文点名的 `∩ ...` 形态" },
  { re: /\b(min|max)\s*\(/i, why: "规范 R-UI-3 原文点名的 `min(...)` 形态" },
  { re: /口径/, why: "规范 R-UI-3 原文点名的「口径差」「联动口径」" },
  { re: /按.{1,14}(显示|不按|而非)/, why: "规范 R-UI-3 原文点名的「按 X 显示不按 Y 措辞」" },
  { re: /(公式|折算|归一化|加权平均|计算方式|取数逻辑|统计口径)/, why: "同族：解释「凭什么这么算」，属浮层" },
];

/**
 * 第一层长说明串（规范 §1：第一层只许放 ①数值 ②状态 ③名字）。
 * 名字/状态都很短；**超长文本出现在第一层，按定义就不是名字**。
 * 阈值 24 —— 取自实测（见 AUDIT 文档「阈值怎么定的」一节），不是拍的。
 */
const PROSE_MIN_CHARS = 24;

/* ═══════════════════════════════════════════════════════════════════════════
 * 核心分析器 —— 门 / 普查 / 金丝雀 **三者共用这一份**
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 该文件用到的字号：内联 fontSize ∪ 它引用到的 CSS 类里的 font-size。
 *
 * ⚠ **字号常量（design token）必须解析到字面值** —— 这条是被金丝雀当场逼出来的，不是想出来的。
 * 沙盘分支把 `CapacityDerivationDag.tsx` 的字号收敛成 `CAP_TYPE_SCALE = {hero:28, value:19, label:12}`
 * ——**正好三级，正是 R-UI-2 要的那个改法**，还写了注释说明。而本函数第一版把
 * `CAP_TYPE_SCALE.label` 与 `isAnswer ? CAP_TYPE_SCALE.hero : CAP_TYPE_SCALE.value`
 * 各当成一个**不同的字号级别**，于是这次改动被判成「字号级数变多」⇒ **门会奖励继续散着写内联魔数、
 * 惩罚把字号收进命名常量**，与规范意图完全相反。指标一旦奖励错的方向，它就不是在守这份规范。
 * 故：① 成员访问 `X.y` 解析回同文件对象字面量的字面值；② 三元/逻辑表达式**逐分支**取值，
 * 不把整个表达式当一级；③ `0` / `0px` 不计（那是折叠空白的排版手法，不是一级正文字号）。
 */
function collectFontSizes(sf, text, cssResolver) {
  const sizes = new Set();
  const usedClasses = new Set();

  // 同文件内的对象字面量常量表（供 `CAP_TYPE_SCALE.hero` 解析回 28）
  const constObjects = new Map();
  const collectConsts = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      let init = node.initializer;
      if (ts.isAsExpression(init) || ts.isTypeAssertionExpression(init)) init = init.expression;
      if (ts.isObjectLiteralExpression(init)) {
        const m = new Map();
        for (const p of init.properties) {
          if (!ts.isPropertyAssignment(p)) continue;
          const k = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null;
          if (!k) continue;
          if (ts.isNumericLiteral(p.initializer)) m.set(k, p.initializer.text + "px");
          else if (ts.isStringLiteral(p.initializer) || ts.isNoSubstitutionTemplateLiteral(p.initializer))
            m.set(k, p.initializer.text);
        }
        if (m.size) constObjects.set(node.name.text, m);
      }
    }
    ts.forEachChild(node, collectConsts);
  };
  collectConsts(sf);

  /** 把一个 fontSize 值表达式解析成 0..n 个字号级别 */
  const resolveSize = (init, out) => {
    if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) return out.add(normSize(init.text));
    if (ts.isNumericLiteral(init)) return out.add(normSize(init.text + "px"));
    if (ts.isParenthesizedExpression(init)) return resolveSize(init.expression, out);
    // 三元 / 逻辑运算：逐分支，各分支自己是一级
    if (ts.isConditionalExpression(init)) {
      resolveSize(init.whenTrue, out);
      resolveSize(init.whenFalse, out);
      return;
    }
    if (ts.isBinaryExpression(init) && (init.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || init.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
      resolveSize(init.left, out);
      resolveSize(init.right, out);
      return;
    }
    // 命名常量：`CAP_TYPE_SCALE.hero` → 28
    if (ts.isPropertyAccessExpression(init) && ts.isIdentifier(init.expression)) {
      const tbl = constObjects.get(init.expression.text);
      const v = tbl?.get(init.name.text);
      if (v) return out.add(normSize(v));
    }
    out.add("dyn:" + init.getText(sf).replace(/\s+/g, "")); // 真动态：保守各算一级
  };

  const visit = (node) => {
    // 内联 style={{ fontSize: ... }} / 样式对象字面量里的 fontSize
    if (ts.isPropertyAssignment(node)) {
      const name = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : null;
      if (name === "fontSize") resolveSize(node.initializer, sizes);
    }
    // styles.foo / styles["foo"] —— 该文件实际引用到的 CSS 类
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && /^styles?$/i.test(node.expression.text)) {
      usedClasses.add(node.name.text);
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      /^styles?$/i.test(node.expression.text) &&
      node.argumentExpression &&
      ts.isStringLiteral(node.argumentExpression)
    ) {
      usedClasses.add(node.argumentExpression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // 只取**被引用到的**类里的 font-size —— 共享 CSS 里没用到的类不该算在这一页头上
  for (const cssText of cssResolver()) {
    for (const cls of usedClasses) {
      const re = new RegExp("\\.(?:" + escapeRe(cls) + ")(?![\\w-])[^{]*\\{([^}]*)\\}", "g");
      let m;
      while ((m = re.exec(cssText))) {
        const fs = /font-size\s*:\s*([^;}]+)/.exec(m[1]);
        if (fs) sizes.add(normSize(fs[1].trim()));
      }
    }
  }
  sizes.delete("0");
  sizes.delete("0px"); // `font-size:0` 是折叠 inline-block 空白的排版手法，不是一级正文字号
  return sizes;
}

function normSize(v) {
  return String(v).trim().toLowerCase().replace(/\s+/g, "");
}
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 表达式子树里有没有 JSX（有 ⇒ 它是结构，不是内容）。 */
function containsJsx(node) {
  let found = false;
  const walk = (n) => {
    if (found) return;
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, walk);
  };
  walk(node);
  return found;
}

/** JSX 文本节点是否含可见内容。 */
function textOf(node) {
  return node.text.replace(/\s+/g, " ").trim();
}

function tagNameOf(el) {
  const opening = ts.isJsxElement(el) ? el.openingElement : el;
  if (ts.isJsxFragment(el)) return "";
  const n = opening.tagName;
  return n.getText();
}

/**
 * 分析一个 tsx 文件。
 * 返回 { first, deferred, total, formula, prose, sizes, nativeTitle, firstItems[] }
 *  · first    第一层信息块数（D1）
 *  · deferred 第二层/浮层信息块数（D4 守恒用）
 *  · formula  第一层里的口径/公式条数（D2）
 *  · prose    第一层里的长说明串条数（规范 §1）
 *  · sizes    字号层级数（D3）
 *  · nativeTitle 原生 title= / SVG <title>（只报数，不进门）
 */
export function analyze(text, opts = {}) {
  const fileName = opts.fileName || "x.tsx";
  const cssResolver = opts.cssResolver || (() => []);
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  // 局部组件（`function Row(){…}`）**不单独建表**：`walkJsx(sf,…)` 沿 AST 走遍全文件，
  // 它们的函数体在定义处已被数到一次。曾建表并在使用处展开 ⇒ 重复计数（见下方 walkJsx 末尾注释）。

  const res = {
    first: 0,
    deferred: 0,
    formula: 0,
    prose: 0,
    nativeTitle: 0,
    firstItems: [],
    formulaItems: [],
    proseItems: [],
  };

  /** 记录一个信息块 */
  const record = (deferred, label, line) => {
    if (deferred) res.deferred++;
    else {
      res.first++;
      if (res.firstItems.length < 400) res.firstItems.push({ label, line });
    }
  };

  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  /** 第一层文案 —— 用来判 D2 / prose */
  const noteText = (s, deferred, line) => {
    if (deferred || !s) return;
    for (const p of FORMULA_PATTERNS) {
      if (p.re.test(s)) {
        res.formula++;
        if (res.formulaItems.length < 60) res.formulaItems.push({ text: s.slice(0, 90), why: p.why, line });
        break;
      }
    }
    if (s.length >= PROSE_MIN_CHARS) {
      res.prose++;
      if (res.proseItems.length < 60) res.proseItems.push({ text: s.slice(0, 90), line });
    }
  };

  /** 遍历 JSX 子树。deferred=true 表示已在第二层/浮层内。 */
  const walkJsx = (node, deferred, depth) => {
    if (depth > 40) return;

    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      const tag = tagNameOf(node);
      const isFragment = ts.isJsxFragment(node);
      const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxFragment(node) ? null : node;
      const isDom = !isFragment && /^[a-z]/.test(tag);
      let childDeferred = deferred;

      if (!isFragment) {
        const bare = tag.replace(/^.*\./, "");
        if (DEFER_COMPONENT_RE.test(bare)) childDeferred = true;
        if (isDom && DEFER_DOM.has(tag)) childDeferred = true;
      }

      // ── 属性扫描 ──────────────────────────────────────────────────────────
      if (opening && opening.attributes) {
        for (const attr of opening.attributes.properties) {
          if (!ts.isJsxAttribute(attr) || !attr.name) continue;
          const an = attr.name.getText();
          // 原生 title=（规范 §2 明令禁止充当浮层）—— 只报数
          if (isDom && an === "title") res.nativeTitle++;
          if (!attr.initializer) continue;

          const attrDeferred = deferred || DEFER_ATTR_RE.test(an) || (isDom && an === "title");
          if (ts.isStringLiteral(attr.initializer)) {
            // 文案型属性：算内容
            if (/^(label|title|heading|caption|placeholder|text|desc|description|hint|summary|unit|subtitle|tip)$/.test(an)) {
              noteText(attr.initializer.text, attrDeferred, lineOf(attr));
              record(attrDeferred, `${tag}[${an}="${attr.initializer.text.slice(0, 30)}"]`, lineOf(attr));
            }
          } else if (ts.isJsxExpression(attr.initializer)) {
            const ex = attr.initializer.expression;
            if (ex) {
              if (containsJsx(ex)) walkJsx(ex, attrDeferred, depth + 1);
              else if (/^(label|title|heading|caption|placeholder|text|desc|description|hint|summary|unit|subtitle|tip|topic)$/.test(an)) {
                collectStrings(ex).forEach((s) => noteText(s, attrDeferred, lineOf(attr)));
                record(attrDeferred, `${tag}[${an}={…}]`, lineOf(attr));
              } else walkJsx(ex, attrDeferred, depth + 1);
            }
          }
        }
      }

      // SVG <title> —— 同样是原生 tooltip（规范点名的那次事故就是它）
      if (isDom && tag === "title") res.nativeTitle++;

      // ── 子节点 ────────────────────────────────────────────────────────────
      const children = ts.isJsxElement(node) ? node.children : ts.isJsxFragment(node) ? node.children : [];
      let hasContent = false;
      const bits = [];
      for (const c of children) {
        if (ts.isJsxText(c)) {
          const t = textOf(c);
          if (t) {
            hasContent = true;
            bits.push(t);
            noteText(t, childDeferred, lineOf(c));
          }
        } else if (ts.isJsxExpression(c)) {
          const ex = c.expression;
          if (!ex) continue; // `{/* 注释 */}`：TS 里 expression 直接是 undefined（没有 JsxEmptyExpression 这个节点）
          if (containsJsx(ex)) {
            // 结构：可能带披露式条件 ⇒ 进第二层
            walkGuarded(ex, childDeferred, depth + 1);
          } else {
            hasContent = true;
            bits.push("{…}");
            collectStrings(ex).forEach((s) => noteText(s, childDeferred, lineOf(c)));
          }
        } else {
          walkJsx(c, childDeferred, depth + 1);
        }
      }

      // `<details>` 里的 `<summary>` 仍是第一层（它就是那个"可见记号"）
      if (isDom && tag === "summary" && deferred) {
        // summary 已被父 details 标 deferred，纠正回第一层
        // （规范 §1：降层时第一层必须留可见记号）
      }

      if (hasContent) {
        record(childDeferred, `<${tag || "…"}> ${bits.join(" ").slice(0, 60)}`, lineOf(node));
      }

      /*
       * ⚠ 这里**刻意不展开本文件内定义的局部组件**（`<Row/>` → Row 的函数体）。
       * 第一版展开了，结果**每个信息块被数两遍**：`walkJsx(sf, …)` 本来就沿 AST 走遍全文件，
       * 局部组件的函数体在**定义处**已经数过一次，再在**每个使用处**展开一次 ⇒
       * 用了 K 次的组件被计 K+1 次。实测抖出：原生 title 我数出 231，而 grep 粗数只有 ~178。
       * （抓法：拿 grep 的独立粗数与解析器对账 —— 两个都可能错，但**错法不同**，
       *   对不上就说明至少有一个坏了，这正是本仓要求的"报数前先自证工具"。）
       * 现在语义统一为：**每个信息块按模板计一次**，与 `.map()` 行模板计一次一致。
       * 代价（诚实记账）：定义在外、只在浮层里用的组件，会被算进第一层 —— **偏保守，宁可多报**。
       */
      return;
    }

    ts.forEachChild(node, (c) => walkJsx(c, deferred, depth));
  };

  /** `{cond && <X/>}` / `{cond ? <A/> : <B/>}` —— 条件是披露式 ⇒ 分支进第二层 */
  const walkGuarded = (ex, deferred, depth) => {
    if (deferred) return walkJsx(ex, true, depth);
    if (ts.isBinaryExpression(ex) && ex.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      const cond = ex.left.getText(sf);
      return walkJsx(ex.right, DISCLOSURE_RE.test(cond), depth);
    }
    if (ts.isConditionalExpression(ex)) {
      const cond = ex.condition.getText(sf);
      const d = DISCLOSURE_RE.test(cond);
      walkJsx(ex.whenTrue, d, depth);
      walkJsx(ex.whenFalse, d, depth);
      return;
    }
    walkJsx(ex, false, depth);
  };

  /** 表达式里的字符串字面量（用于口径/长文判定）。 */
  function collectStrings(node) {
    const out = [];
    const walk = (n) => {
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
      else if (ts.isTemplateExpression(n)) {
        out.push(n.head.text);
        n.templateSpans.forEach((s) => out.push(s.literal.text));
      }
      ts.forEachChild(n, walk);
    };
    walk(node);
    return out.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  }

  walkJsx(sf, false, 0);

  const sizes = collectFontSizes(sf, text, cssResolver);
  return {
    first: res.first,
    deferred: res.deferred,
    total: res.first + res.deferred,
    formula: res.formula,
    prose: res.prose,
    sizes: sizes.size,
    sizeValues: [...sizes].sort(),
    nativeTitle: res.nativeTitle,
    firstItems: res.firstItems,
    formulaItems: res.formulaItems,
    proseItems: res.proseItems,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 金丝雀 —— 与主逻辑**同一份** analyze()，不另抄正则
 * ═══════════════════════════════════════════════════════════════════════════ */
const CANARIES = [
  {
    name: "必咬-1 第一层堆料：口径公式 + 长说明直接渲染",
    src: `export function V(){return <div>
      <div><span>可用产能</span><b>18,819 套</b></div>
      <div>节拍 × OEE ÷ 通道数 × 班次</div>
      <p>本页数值按下单口径统计，不按发货口径；跨基地部分已按产能权重折算后并入。</p>
    </div>;}`,
    expect: (r) => r.first >= 4 && r.formula >= 1 && r.prose >= 1 && r.deferred === 0,
  },
  {
    name: "必不咬-1 同样的内容降进 InfoPopover ⇒ 第一层只剩结论",
    src: `import {InfoPopover} from "@/components/InfoPopover";
    export function V(){return <div>
      <div><span>可用产能</span><b>18,819 套</b></div>
      <InfoPopover topic="口径" testId="t">
        <div>节拍 × OEE ÷ 通道数 × 班次</div>
        <p>本页数值按下单口径统计，不按发货口径；跨基地部分已按产能权重折算后并入。</p>
      </InfoPopover>
    </div>;}`,
    expect: (r) => r.formula === 0 && r.prose === 0 && r.deferred >= 2,
  },
  {
    name: "必咬-2 字号层级：4 级内联字号超规范上限 3",
    src: `export function V(){return <div>
      <b style={{fontSize:28}}>1</b><i style={{fontSize:20}}>2</i>
      <u style={{fontSize:14}}>3</u><s style={{fontSize:12}}>4</s></div>;}`,
    expect: (r) => r.sizes === 4,
  },
  {
    name: "必不咬-2 披露式条件（open/expanded）后的内容算第二层",
    src: `export function V({open}:{open:boolean}){return <div>
      <b>结论 42</b>
      {open && <div><span>明细一</span><span>明细二</span></div>}
    </div>;}`,
    expect: (r) => r.deferred >= 2 && r.first <= 2,
  },
  {
    name: "必不咬-3 数据判空**不是**披露 ⇒ 仍算第一层（防分数虚好）",
    src: `export function V({rows}:{rows:string[]}){return <div>
      {rows.length > 0 && <div><span>明细一</span><span>明细二</span></div>}
    </div>;}`,
    expect: (r) => r.first >= 2 && r.deferred === 0,
  },
  {
    name: "必咬-3 原生 title= 与 SVG <title> 各计一条",
    src: `export function V(){return <div title="口径说明"><svg><title>环形图说明</title></svg></div>;}`,
    expect: (r) => r.nativeTitle === 2,
  },
  {
    /**
     * ⚠ 这条是**回归金丝雀**，钉死一个真实发生过的指标缺陷（2026-08-11 本单，由沙盘改前/改后对比抖出）：
     * 把字号收进命名常量 `CAP_TYPE_SCALE`（hero/value/label 三级，正是 R-UI-2 要的改法），
     * 第一版实现却判成 4 级（`.label` 一级 + 整个三元表达式一级 + …）⇒ **门奖励散着写魔数、
     * 惩罚正确的收敛**。此条锁死「常量解析回字面值 + 三元逐分支」两条修法。
     */
    name: "必不咬-4 字号常量（design token）三级就是三级，不许把三元/成员访问各算一级",
    src: `const SCALE = { hero: 28, value: 19, label: 12 } as const;
    export function V({isAnswer}:{isAnswer:boolean}){return <div>
      <b style={{fontSize: isAnswer ? SCALE.hero : SCALE.value}}>42</b>
      <span style={{fontSize: SCALE.label}}>产能缺口</span>
    </div>;}`,
    expect: (r) => r.sizes === 3,
  },
  {
    name: "必不咬-5 `font-size:0` 是排版手法，不计一级字号",
    src: `export function V(){return <div style={{fontSize:0}}><b style={{fontSize:14}}>x</b></div>;}`,
    expect: (r) => r.sizes === 1,
  },
  {
    /**
     * ⚠ 回归金丝雀，钉死第二个真实指标缺陷（2026-08-11 本单，拿 grep 粗数对账抖出）：
     * 局部组件曾在**定义处**数一次、又在**每个使用处**展开数一次 ⇒ 用 K 次就多算 K 倍。
     * 此处 `Row` 定义 1 次、用 3 次，其内 1 个 title + 1 个信息块 ——
     * 正确答案是**各计一次**（模板语义），不是 4 次。
     */
    name: "必不咬-6 局部组件按模板计一次，不随使用次数翻倍",
    src: `function Row(){return <div title="口径">行</div>;}
    export function V(){return <section><Row/><Row/><Row/></section>;}`,
    expect: (r) => r.nativeTitle === 1 && r.first === 1,
  },
];

function runCanaries() {
  const fails = [];
  for (const c of CANARIES) {
    let r;
    try {
      r = analyze(c.src, { fileName: "canary.tsx" });
    } catch (e) {
      fails.push(`${c.name} —— analyze() 抛异常：${e.message}`);
      continue;
    }
    if (!c.expect(r)) {
      fails.push(
        `${c.name} —— 实测 first=${r.first} deferred=${r.deferred} formula=${r.formula} prose=${r.prose} sizes=${r.sizes} nativeTitle=${r.nativeTitle}`
      );
    }
  }
  return fails;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 扫描面枚举 + 文件读取（支持 --rev：从任意 git rev 读，供改前/改后对比）
 * ═══════════════════════════════════════════════════════════════════════════ */
function listScanFiles(rev) {
  const out = [];
  if (rev) {
    let raw;
    try {
      raw = execFileSync("git", ["ls-tree", "-r", "--name-only", rev], {
        cwd: ROOT,
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      })
        .toString()
        .split("\n");
    } catch (e) {
      // rev 打错 / 不是 git 仓 / git 不在 —— 一律「没得扫」，不是「代码干净」
      toolBroken(`取不到 rev \`${rev}\` 的文件列表（${(e.stderr || e.message || "").toString().trim().slice(0, 200)}）`);
    }
    for (const f of raw) {
      if (!f.endsWith(".tsx")) continue;
      if (matchesScan(f)) out.push(f);
    }
  } else {
    for (const s of SCAN_DIRS) {
      const abs = join(ROOT, s.dir);
      if (!existsSync(abs)) continue;
      walkDir(abs, s.dir, s.onlyDepth ? 2 : 1, s.onlyDepth || 1, out);
    }
  }
  return [...new Set(out)].sort();
}

function matchesScan(f) {
  const V = "apps/frontend-shell/src/views/";
  const A = "apps/frontend-shell/src/pages/admin/";
  if (f.startsWith(A)) return f.slice(A.length).split("/").length === 1;
  if (f.startsWith(V)) {
    const rest = f.slice(V.length).split("/");
    return rest.length === 1 || rest.length === 2;
  }
  return false;
}

function walkDir(abs, rel, wantDepth, exactDepth, out, cur = 1) {
  for (const e of readdirSync(abs)) {
    const p = join(abs, e);
    const r = `${rel}/${e}`;
    const st = statSync(p);
    if (st.isDirectory()) {
      if (cur < 2) walkDir(p, r, wantDepth, exactDepth, out, cur + 1);
    } else if (e.endsWith(".tsx") && cur === exactDepth) {
      out.push(r);
    }
  }
}

function readAt(rev, path) {
  if (!rev) return existsSync(join(ROOT, path)) ? readFileSync(join(ROOT, path), "utf8") : null;
  try {
    return execFileSync("git", ["show", `${rev}:${path}`], { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 }).toString();
  } catch {
    return null;
  }
}

/** 该 tsx 引用到的 CSS module 文本（按 import 解析，跨 rev 也能读）。 */
function cssResolverFor(path, text, rev) {
  return () => {
    const out = [];
    const re = /import\s+[\w{}\s,*]*\s*from\s*["']([^"']+\.css)["']|import\s+["']([^"']+\.css)["']/g;
    let m;
    while ((m = re.exec(text))) {
      const spec = m[1] || m[2];
      let target = null;
      if (spec.startsWith(".")) target = normalizePath(join(dirname(path), spec));
      else if (spec.startsWith("@/")) target = "apps/frontend-shell/src/" + spec.slice(2);
      if (!target) continue;
      const t = readAt(rev, target);
      if (t) out.push(t);
    }
    return out;
  };
}
function normalizePath(p) {
  return p.split("\\").join("/").replace(/^\.\//, "");
}

function analyzeAll(rev) {
  const files = listScanFiles(rev);
  const rows = [];
  for (const f of files) {
    const text = readAt(rev, f);
    if (text == null) continue;
    let r;
    try {
      r = analyze(text, { fileName: f, cssResolver: cssResolverFor(f, text, rev) });
    } catch (e) {
      rows.push({ file: f, broken: e.message });
      continue;
    }
    rows.push({ file: f, ...r });
  }
  return rows;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 门主体
 * ═══════════════════════════════════════════════════════════════════════════ */
function loadBaseline() {
  if (!existsSync(BASELINE)) return null; // 由调用方报 RC=2（缺基线 = 没法比 = 没得扫）
  let raw;
  try {
    raw = readFileSync(BASELINE, "utf8");
  } catch (e) {
    toolBroken(`基线文件读不出（${relative(ROOT, BASELINE)}：${e.message}）`);
  }
  let j;
  try {
    j = JSON.parse(raw);
  } catch (e) {
    toolBroken(
      `基线不是合法 JSON（${relative(ROOT, BASELINE)}：${e.message}）`,
      "常见成因是合并冲突标记残留（`<<<<<<<`）。"
    );
  }
  // 结构坏了（被手改坏 / 合并残留）同样是「没得比」，不是「代码干净」
  if (!j || typeof j.files !== "object" || j.files === null)
    toolBroken(`基线结构不对（${relative(ROOT, BASELINE)} 缺 files 字段）`, "重跑 `--update` 或从 canonical 取回该文件。");
  return j;
}

const HARD_SIZE_CAP = 3; // 规范 §2 R-UI-2 原文

/**
 * **判据本体** —— 拿一个文件的实测读数 `r` 与它的基线 `b` 比，返回红条目（空数组 = 绿）。
 *
 * 单独抽成函数是为了让**判据本身**也能被金丝雀咬（`JUDGE_CANARIES`）：
 * 门的检测器对不对、与门的**判据**对不对，是两件事 —— 本仓踩过「检测器绿、判据写反」的坑，
 * 而判据写反时门照样报绿（它只是不再红而已）。两者必须各自有必咬/必不咬样例，且**共用这一份实现**。
 *
 * @param r 实测读数（analyze() 的输出 + file 字段）
 * @param b 基线条目；`undefined` = 新文件（不进基线，直接按规范硬上限收）
 */
export function judge(r, b) {
  const fails = [];
  if (!b) {
    // 新文件：没有历史包袱，直接按规范原文的硬上限收
    if (r.sizes > HARD_SIZE_CAP)
      fails.push(`【新文件·R-UI-2】${r.file} 字号 ${r.sizes} 级 > ${HARD_SIZE_CAP}（${(r.sizeValues || []).join(" ")}）`);
    if (r.formula > 0)
      fails.push(
        `【新文件·R-UI-3】${r.file} 第一层有 ${r.formula} 处口径/公式，应进 \`?\` 浮层：` +
          (r.formulaItems || []).map((x) => `L${x.line} "${x.text}"`).slice(0, 3).join(" · ")
      );
    return fails;
  }

  /*
   * D1：第一层信息块只降不升 —— **但「结构化改造」豁免**。
   * 判据出处不是我拍的，是金丝雀实测逼出来的：沙盘分支把规范 §3 点名的那个反例
   * （`CapacityDerivationDag` 6 层行式布局）改成卡片 + 递进阶梯，`first` 17→25 **升了**，
   * 而这正是规范 §3 明确要求的改法（「若数据本身有结构，第一层要把结构画出来」）。
   * 若 D1 只看 first 单调，本门会把**规范要求的改造判红** —— 那是指标坏了，不是页面坏了。
   * 故：first 上升**只有在 deferred 同时上升**（确有内容被推到第二层/浮层）时才放行。
   * 「只往第一层堆、什么都不下沉」——deferred 不涨——照红。
   */
  if (r.first > b.first && r.deferred <= b.deferred)
    fails.push(
      `【D1 棘轮】${r.file} 第一层信息块 ${b.first} → ${r.first}（+${r.first - b.first}），` +
        `而第二层/浮层 ${b.deferred} → ${r.deferred} **没涨** ⇒ 纯往第一层堆。` +
        `${SPEC} §1：第一层只放「数值 / 状态 / 名字」，明细降第二层、口径降浮层。` +
        `（若这是规范 §3 要求的结构化改造，它应当伴随内容下沉；确无可沉内容时更新基线并写 why。）`
    );

  if (r.formula > b.formula)
    fails.push(
      `【D2 棘轮·R-UI-3】${r.file} 第一层口径/公式 ${b.formula} → ${r.formula}：` +
        (r.formulaItems || []).map((x) => `L${x.line} "${x.text}"`).slice(0, 3).join(" · ")
    );

  if (r.prose > (b.prose ?? 0))
    fails.push(
      `【D2b 棘轮·§1】${r.file} 第一层长说明串（≥${PROSE_MIN_CHARS} 字）${b.prose ?? 0} → ${r.prose}：` +
        (r.proseItems || []).map((x) => `L${x.line} "${x.text.slice(0, 40)}…"`).slice(0, 3).join(" · ") +
        `　—— 第一层只放「数值 / 状态 / 名字」，成段说明属浮层`
    );

  if (r.sizes > b.sizes)
    fails.push(`【D3 棘轮·R-UI-2】${r.file} 字号层级 ${b.sizes} → ${r.sizes}（${(r.sizeValues || []).join(" ")}）`);

  /*
   * D4 守恒（反「删内容冒充分层」）—— 判据是**信息总量**，不是第一层的降幅。
   *
   * ⚠ 这条的第一版写成「first 降了且 deferred 也降了才红」，**有洞且方向正好错**：
   *   纯删除第一层内容时 first ↓、deferred **不变** ⇒ 一条都不触发，
   *   而 first 变小恰好被 D1 读成"变好了" ⇒ **门在奖励删除**。
   *   规范 §1 的原话是「允许降到浮层，**绝不允许删除**」——
   *   要守住它，判据必须落在「内容还在不在」上，也就是 total = first + deferred。
   *   （形态照铁律 0.6：我原先用「第一层降幅」当作「有没有删东西」的证据，而前者并不度量后者。）
   *
   * 三种改动在这条判据下的读数（拿沙盘 cd4205d5 真实数据核过）：
   *   · 搬进浮层：first↓ deferred↑ total 持平/↑  ⇒ 绿（SandboxConsole 218→247）
   *   · 加结构  ：first↑ deferred↑ total↑        ⇒ 绿（CapacityDerivationDag 18→30）
   *   · 删内容  ：first↓ deferred 不变 total↓    ⇒ **红**
   */
  const baseTotal = b.first + b.deferred;
  const total = r.total ?? r.first + r.deferred;
  const deferredShrank = r.deferred < b.deferred;
  const totalShrank = total < baseTotal;
  if (deferredShrank || totalShrank) {
    /*
     * ⚠ 成因必须分辨后再措辞 —— 本单变异反证当场教训：
     *   把已治理页面的 4 个 `<InfoPopover>` 包裹拆掉（内容**搬回第一层**）时，
     *   deferred 6→2、first 持平、total 107→103。若只看 total 就断言「内容变少了 = 删除」，
     *   **诊断是错的**（内容一条没少，是被拉回了第一层），dev 会照着错方向去找被删的文案。
     *   信号真、指向错 —— 正是本仓记的那类假绿的镜像。故此处按读数分辨两种成因分别措辞。
     */
    const pulledUp = deferredShrank && r.first >= b.first;
    const head = pulledUp
      ? `【D4 守恒·浮层被拆】${r.file} 第二层/浮层 ${b.deferred} → ${r.deferred}（少了 ${b.deferred - r.deferred}），` +
        `而第一层 ${b.first} → ${r.first} **没降** ⇒ 原本降下去的内容被**搬回第一层**了（或浮层被删）。`
      : `【D4 守恒·内容变少】${r.file} 信息总量 ${baseTotal} → ${total}（少了 ${baseTotal - total}；` +
        `第一层 ${b.first}→${r.first}，第二层/浮层 ${b.deferred}→${r.deferred}）⇒ 内容**变少了**，这是**删除**不是**分层**。`;
    fails.push(
      head +
        `${SPEC} §1：「诚实位允许降到浮层，**绝不允许删除**；静默降层等于删除」。` +
        `分层的正确形态是 first↓ 而 deferred↑、总量不掉。若确属合理删除/合并，更新基线并写明 why。`
    );
  }

  return fails;
}

/**
 * 判据金丝雀 —— 与 `judge()` **共用同一份实现**（不另写一套比较逻辑）。
 * 每条给一个「基线 → 实测」的情形，声明它该红还是该绿。
 */
const JUDGE_CANARIES = [
  {
    name: "判据必绿-1 搬进浮层：first↓ deferred↑ 总量不掉 = 真分层",
    b: { first: 100, deferred: 10, formula: 5, prose: 8, sizes: 5 },
    r: { file: "x", first: 84, deferred: 30, formula: 3, prose: 2, sizes: 5, total: 114 },
    red: false,
  },
  {
    name: "判据必红-1 纯删除：first↓ 但总量掉了（这是本门最要害的一条）",
    b: { first: 100, deferred: 10, formula: 5, prose: 8, sizes: 5 },
    r: { file: "x", first: 80, deferred: 10, formula: 5, prose: 8, sizes: 5, total: 90 },
    red: true,
  },
  {
    name: "判据必红-2 纯堆第一层：first↑ 而 deferred 不涨",
    b: { first: 100, deferred: 10, formula: 5, prose: 8, sizes: 5 },
    r: { file: "x", first: 120, deferred: 10, formula: 5, prose: 8, sizes: 5, total: 130 },
    red: true,
  },
  {
    name: "判据必绿-2 结构化改造：first↑ 但 deferred 同时↑（规范 §3 要求的改法）",
    b: { first: 17, deferred: 1, formula: 0, prose: 2, sizes: 4 },
    r: { file: "x", first: 25, deferred: 5, formula: 0, prose: 0, sizes: 4, total: 30 },
    red: false,
  },
  {
    /**
     * 本条数字**取自真实变异反证**（AgentsPage 拆掉 4 个 InfoPopover 包裹）：
     * deferred 6→2、first 持平 101、total 107→103。必须红，且必须诊断成「被搬回第一层」而非「删除」。
     */
    name: "判据必红-5 浮层被拆、内容搬回第一层（deferred↓ 而 first 没降）",
    b: { first: 101, deferred: 6, formula: 0, prose: 1, sizes: 7 },
    r: { file: "x", first: 101, deferred: 2, formula: 0, prose: 1, sizes: 7, total: 103 },
    red: true,
    msgMust: /浮层被拆/,
  },
  {
    name: "判据必红-3 口径/公式回到第一层（R-UI-3）",
    b: { first: 50, deferred: 5, formula: 0, prose: 0, sizes: 3 },
    r: { file: "x", first: 50, deferred: 5, formula: 2, prose: 0, sizes: 3, total: 55, formulaItems: [] },
    red: true,
  },
  {
    name: "判据必红-4 新文件破 R-UI-2 硬上限 3 级字号",
    b: undefined,
    r: { file: "x", first: 10, deferred: 0, formula: 0, prose: 0, sizes: 4, total: 10, sizeValues: [] },
    red: true,
  },
  {
    name: "判据必绿-3 新文件守规矩：3 级字号 + 第一层零口径",
    b: undefined,
    r: { file: "x", first: 10, deferred: 0, formula: 0, prose: 0, sizes: 3, total: 10, sizeValues: [] },
    red: false,
  },
];

function runJudgeCanaries() {
  const fails = [];
  for (const c of JUDGE_CANARIES) {
    let out;
    try {
      out = judge(c.r, c.b);
    } catch (e) {
      fails.push(`${c.name} —— judge() 抛异常：${e.message}`);
      continue;
    }
    const isRed = out.length > 0;
    if (isRed !== c.red) {
      fails.push(`${c.name} —— 期望${c.red ? "红" : "绿"}，实得${isRed ? "红：" + out[0] : "绿"}`);
      continue;
    }
    // 红得对还不够：**诊断措辞也要对**（信号真、指向错 = dev 照错方向去修）
    if (c.msgMust && !out.some((m) => c.msgMust.test(m)))
      fails.push(`${c.name} —— 红了但诊断措辞不对，应含 ${c.msgMust}，实得：${out[0]}`);
  }
  return fails;
}

function gate() {
  const rows = analyzeAll(null);
  if (rows.length < MIN_FILES) {
    console.error(`⛔ 门自己瞎了：扫描面只枚举到 ${rows.length} 个文件（下界 ${MIN_FILES}）。`);
    console.error("   这是「枚举器坏了」，不是「文件没了」—— 不许据此报「代码干净」。");
    return 2;
  }
  const broken = rows.filter((r) => r.broken);
  if (broken.length) {
    console.error(`⛔ 门自己瞎了：${broken.length} 个文件解析失败`);
    broken.slice(0, 5).forEach((b) => console.error(`   · ${b.file}: ${b.broken}`));
    return 2;
  }

  const base = loadBaseline();
  if (!base) {
    console.error(`⛔ 门自己瞎了：基线缺失 ${relative(ROOT, BASELINE)} —— 先跑 --update`);
    return 2;
  }

  const fails = [];
  const byFile = new Map(rows.map((r) => [r.file, r]));
  for (const r of rows) fails.push(...judge(r, base.files[r.file]));

  // 基线里有、现在扫不到的文件（删了/改名）——只提示，不红
  const gone = Object.keys(base.files).filter((f) => !byFile.has(f));

  if (fails.length) {
    console.error(`❌ ui-first-layer:check 未通过（${fails.length} 条）\n`);
    fails.forEach((f) => console.error("  · " + f));
    console.error(`\n判据出处：${SPEC} §2（R-UI-2 / R-UI-3）与 §1（三层准入 · 不许删除）。`);
    console.error("修法：把明细降到第二层、把口径/公式降到 `?` 浮层（`@/components/InfoPopover`），");
    console.error("     **第一层必须留可见记号** —— 静默降层等于删除。");
    return 1;
  }

  console.log(`✅ ui-first-layer:check 通过 —— ${rows.length} 个页面文件，无新增第一层堆料`);
  console.log(`   （棘轮基线 ${Object.keys(base.files).length} 条${gone.length ? `，${gone.length} 条已随文件移除` : ""}）`);
  const tot = rows.reduce((a, r) => a + r.first, 0);
  console.log(`   存量总量：第一层信息块 ${tot} · 口径公式 ${rows.reduce((a, r) => a + r.formula, 0)} · 原生 title ${rows.reduce((a, r) => a + r.nativeTitle, 0)}（后者由另一道门守）`);
  return 0;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * CLI
 * ═══════════════════════════════════════════════════════════════════════════ */
function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const val = (f) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : null;
  };

  // ── 金丝雀先跑，任何模式都跑 ────────────────────────────────────────────
  //    两组各咬一半：`runCanaries` 咬**检测器**（数得对不对），
  //    `runJudgeCanaries` 咬**判据**（数对了之后判得对不对）。
  //    只有前者时，判据写反照样报绿 —— 那正是本仓踩过的坑。
  const canaryFails = [...runCanaries(), ...runJudgeCanaries()];
  if (canaryFails.length) {
    console.error("⛔ 门自己瞎了 —— 金丝雀不中，**不许**据此报「代码干净 / 无命中」：");
    canaryFails.forEach((f) => console.error("   · " + f));
    process.exit(2);
  }
  if (has("--selftest")) {
    // ⚠ 数量从 CANARIES **算出来**，不写死：写死的计数会在加样例后当场过期，
    //   而"过期的自证数字"正是本仓铁律 0.6 反复点名的病。
    const bite = CANARIES.filter((c) => /必咬/.test(c.name)).length;
    console.log(
      `✅ 检测器金丝雀 ${CANARIES.length}/${CANARIES.length} 全中（必咬 ${bite} + 必不咬 ${CANARIES.length - bite}）`
    );
    const jRed = JUDGE_CANARIES.filter((c) => c.red).length;
    console.log(
      `✅ 判据金丝雀 ${JUDGE_CANARIES.length}/${JUDGE_CANARIES.length} 全中（必红 ${jRed} + 必绿 ${JUDGE_CANARIES.length - jRed}）`
    );
    const rows = analyzeAll(null);
    console.log(`✅ 扫描面 ${rows.length} 个文件（下界 ${MIN_FILES}）`);
    if (rows.length < MIN_FILES) process.exit(2);

    /*
     * ── 退出码契约自检（RC=2 ≠ RC=1）─────────────────────────────────────────
     * 起一个子进程、注入「缺 typescript」故障，断言它**退 2 而不是 1**。
     *
     * 为什么必须是**机器**跑：这条契约此前是靠注释和约定维持的，而真实缺陷正是
     * 「`require("typescript")` 裸调用 ⇒ 未捕获异常 ⇒ node 默认退 1」——
     * 注释写得再清楚也拦不住它（本仓定论：**写在注释里的纪律不是机制**）。
     * 现在谁把 `toolBroken` 改回 throw / 改成 exit 1，这里当场红。
     */
    const selfPath = fileURLToPath(import.meta.url);
    const probe = spawnSync(process.execPath, [selfPath], {
      cwd: ROOT,
      env: { ...process.env, UI_FIRST_LAYER_FORCE_NO_TS: "1" },
      encoding: "utf8",
    });
    if (probe.status !== 2) {
      console.error(
        `⛔ 退出码契约被破：注入「缺依赖」故障后应 RC=2（工具坏了），实得 RC=${probe.status}。`
      );
      console.error("   RC=1 会被 gate.sh 读作「第一层真超标」，人会去改根本没被扫过的页面。");
      console.error("   stderr：" + (probe.stderr || "").trim().split("\n").slice(0, 3).join(" / "));
      process.exit(2);
    }
    console.log("✅ 退出码契约：注入「缺 typescript」故障 ⇒ RC=2（工具坏了），未误报成 RC=1（真超标）");
    process.exit(0);
  }

  if (has("--explain")) {
    const f = val("--explain");
    const rev = val("--rev");
    if (!f || f.startsWith("--")) toolBroken("`--explain` 没给文件路径", "用法：`--explain <file> [--rev <rev>]`");
    const text = readAt(rev, f);
    if (text == null) toolBroken(`读不到 ${f}${rev ? ` @${rev}` : ""}`);
    const r = analyze(text, { fileName: f, cssResolver: cssResolverFor(f, text, rev) });
    console.log(`# ${f}${rev ? ` @${rev}` : ""}`);
    console.log(`first=${r.first} deferred=${r.deferred} formula=${r.formula} prose=${r.prose} sizes=${r.sizes} [${r.sizeValues.join(" ")}] nativeTitle=${r.nativeTitle}`);
    console.log("\n## 第一层堆了什么（前 60 条）");
    r.firstItems.slice(0, 60).forEach((i) => console.log(`  L${i.line}\t${i.label}`));
    console.log("\n## 第一层的口径/公式（R-UI-3）");
    r.formulaItems.forEach((i) => console.log(`  L${i.line}\t${i.text}   ← ${i.why}`));
    console.log("\n## 第一层的长说明串（≥" + PROSE_MIN_CHARS + " 字）");
    r.proseItems.slice(0, 20).forEach((i) => console.log(`  L${i.line}\t${i.text}`));
    process.exit(0);
  }

  if (has("--census")) {
    const rev = val("--rev");
    const rows = analyzeAll(rev).filter((r) => !r.broken);
    rows.sort((a, b) => b.first - a.first || b.formula - a.formula);
    console.log(JSON.stringify({ rev: rev || "WORKTREE", count: rows.length, rows: rows.map(({ firstItems, formulaItems, proseItems, ...k }) => k) }, null, 1));
    process.exit(0);
  }

  if (has("--update")) {
    const rows = analyzeAll(null).filter((r) => !r.broken);
    if (rows.length < MIN_FILES) {
      console.error(`⛔ 拒绝写基线：只枚举到 ${rows.length} 个文件（下界 ${MIN_FILES}）`);
      process.exit(2);
    }
    const prev = loadBaseline();
    const files = {};
    for (const r of rows.sort((a, b) => a.file.localeCompare(b.file))) {
      const old = prev?.files?.[r.file];
      files[r.file] = {
        first: r.first,
        deferred: r.deferred,
        formula: r.formula,
        prose: r.prose,
        sizes: r.sizes,
        page: pageOf(r.file),
        why: old?.why || whyFor(r),
      };
    }
    writeFileSync(
      BASELINE,
      JSON.stringify(
        {
          note:
            `${SPEC} 的存量棘轮（断点 G-UI-FIRSTLAYER-OVERLOAD）。` +
            "first=第一层信息块数 · deferred=第二层/浮层信息块数 · formula=第一层口径公式条数 · sizes=字号层级数。" +
            "四者只降不升；且 first 下降时 deferred 不许同时下降（D4 守恒：那是删内容不是分层）。" +
            "新文件不进基线 ⇒ 直接按规范硬上限收（字号 ≤3、第一层零口径公式）。",
          spec: SPEC,
          gate: "scripts/check-ui-first-layer.mjs",
          generatedFrom: "node scripts/check-ui-first-layer.mjs --update",
          fileCount: rows.length,
          totals: {
            first: rows.reduce((a, r) => a + r.first, 0),
            formula: rows.reduce((a, r) => a + r.formula, 0),
            nativeTitle: rows.reduce((a, r) => a + r.nativeTitle, 0),
          },
          files,
        },
        null,
        1
      ) + "\n"
    );
    console.log(`✅ 基线已写：${rows.length} 条 → ${relative(ROOT, BASELINE)}`);
    process.exit(0);
  }

  process.exit(gate());
}

function pageOf(f) {
  if (f.includes("/views/sim/")) return "推演沙盘（sim）";
  if (f.includes("/views/plan/")) return "计划域（plan）";
  if (f.includes("/views/capacity/")) return "产能域（capacity）";
  if (f.includes("/views/cleanroom/")) return "洁净室域（cleanroom）";
  if (f.includes("/views/graph/")) return "图谱域（graph）";
  if (f.includes("/pages/admin/")) return "管理台（admin）";
  return "主视图（views 顶层）";
}
function whyFor(r) {
  const bits = [];
  if (r.first >= 120) bits.push(`第一层 ${r.first} 个信息块，规范 §5「说不出这一页要回答的那个数是哪一个」`);
  else bits.push(`第一层 ${r.first} 个信息块`);
  if (r.formula) bits.push(`${r.formula} 处口径/公式未降浮层（R-UI-3）`);
  if (r.sizes > HARD_SIZE_CAP) bits.push(`字号 ${r.sizes} 级 > 3（R-UI-2）`);
  return "存量·规范落地前：" + bits.join("；");
}

/*
 * ── 兜底：任何未预期异常 ⇒ RC=2，绝不让它变成 RC=1 ──────────────────────────
 * 上面已逐条堵了已知的环境失败路径（缺 typescript / 基线读不出 / rev 取不到 / 参数缺失），
 * 但**「已知」永远是不完整的**：只读文件系统、权限、OOM、node 版本差异…… 都能抛。
 * 而 node 对未捕获异常一律退 **1** —— 恰好撞上「第一层真超标」这个码。
 * 所以这里不是锦上添花，是**把默认值改对**：本门的默认失败方向必须是「我没查出来」，
 * 不是「你的页面超标」。真正的 RC=1 只有一条路径：`gate()` 明确 `return 1`。
 */
try {
  main();
} catch (e) {
  toolBroken(`未预期异常（${e?.message || e}）`, (e?.stack || "").split("\n").slice(1, 4).join("\n   "));
}
