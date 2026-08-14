#!/usr/bin/env node
/**
 * 门 `baseline-writer-honesty:check` · **基线写入器诚实门**（WO-BASELINE-WRITER-HONESTY）
 *
 * ══ 治什么 ═════════════════════════════════════════════════════════════════════
 * 本仓十几道门各自维护一份**棘轮基线 JSON**，并各自带一个 `--update` / `--seed` 自更新入口。
 * 真实发生过的病：`check-backend-frontend-seam.mjs` 的 `--update` 曾**无条件**写
 * `note: BASELINE_NOTE`，把 978 字、两笔人手挂账（每笔都写着「为何这条不许走豁免」）
 * 静默吞掉 —— 已于 `0e19f2c4` 修好。
 *
 * **病的形态**：`note` 这个字段**有两个主人**（脚本里的常量说它归脚本，基线正文里的挂账说它归人手），
 * **谁最后写谁赢，而 `--update` 永远最后写**。后果不是「少一句话」，是**复审下次只看到一份没有理由的名单**
 * —— 挂账理由恰恰是棘轮唯一能被人审的部分，吞掉它等于把棘轮降级成白名单。
 *
 * 已有的修法是 `scripts/lib/baseline-doc.mjs`（**唯一**的共享写入器，四向判据见该文件）。
 * **但那只是一份实现，不是一个机制** —— 没有任何东西拦住「新写的门自己手搓一份基线写入逻辑」。
 * 绕开一次，那道门的基线就又回到「机器抹人话」的老路，**而且没人会发现**。
 * 照 CLAUDE.md 铁律 0.6 三级处置：第 3 次必须建机制，**机制的判据只有一条 ——
 * 下次同样的错发生时，是机器先说话，不是人先想起来。本门就是那一层。**
 *
 * ══ 守的命题 ═══════════════════════════════════════════════════════════════════
 * **凡是「会写基线 JSON」的 `scripts/*.mjs`，其每一处基线写入都必须经由
 *   `scripts/lib/baseline-doc.mjs` 的 `buildBaselineDoc()`，且开写前跑过 `baselineDocCanary()`。**
 *
 * 「会写基线」的识别**要两路证据同时成立**（单路必然误判，铁律 0.5）：
 *   路 A · 存在 `writeFileSync(<目标>, …)` / `writeFile(<目标>, …)`，且 `<目标>` 解析到形如
 *          `*-baseline.json` 的路径（字面量，或某个 `const X = …"*-baseline.json"…` 标识符）；
 *   路 B · 文件里存在自更新入口标志字面量（`--update` / `--seed` / `--write`）。
 * 只有 A 会把「读基线来比对」的门（`check-gate-ledger.mjs` 等）误算成写入方；
 * 只有 B 会把任何带 `--write` 的普通脚本算进来。**两路都要**。
 * ⚠ 判定全程走 **AST**：注释与散文里写的 `writeFileSync(BASELINE …)` 一律不算数
 *   （同 css-token 门栽过的「注释里的散文被当成真引用」）。
 *
 * 合规的三个条件（缺一不可，各治一半）：
 *   ① 该文件从 `./lib/baseline-doc.mjs` **导入** `buildBaselineDoc`（静态或动态 import 皆可）；
 *   ② **每一处**基线写入点的实参里真的调了 `buildBaselineDoc(…)`
 *      —— 「导入了」证明不了「写的时候用了」，这正是路径开关式假绿（铁律 0.5 判据 #6）；
 *   ③ 文件里调了 `baselineDocCanary()`。少了它，写入器哪天被改坏，
 *      各门照样静默写出「抹掉人话」的基线 —— 共享实现的价值一半在金丝雀上。
 * **同名局部函数视为不合规**：`check-backend-frontend-seam.mjs` 就是自己定义了一个
 * 同名 `buildBaselineDoc` —— 光看「写入点文本里有 `buildBaselineDoc(`」会把它读成合规，
 * 而它是**第二份实现**：共享写入器哪天补第五向判据，它不会跟着变。
 *
 * ══ 诚实边界（本门**测不出**什么 · 不许当成「基线写入已全部诚实」）═══════════════
 *  · **只认命名形如 `*-baseline.json` 的写入目标**。谁把棘轮存成 `foo-ratchet.json` /
 *    `bar.baseline.json`，本门**看不见**（`scripts/feature-rollout.json`、`scripts/gate-ledger.json`
 *    这类非 `-baseline.json` 命名的账本同样在射程外）。
 *  · **只认结构，不认语义**：一处写入调了 `buildBaselineDoc()` 就算合规，
 *    但它把人手 `note` 塞进 `computed`（那样照样会被覆盖）本门判不出 —— 那是
 *    `baselineDocCanary()` 的四向判据要守的，不是静态分析能判的。
 *  · **不验基线内容**：豁免条目写没写 `why`、数字对不对，归各门自己的棘轮。
 *  · 目标路径若是运行期拼出来的（局部变量层层传递、模板串拼接），本门解析不到 ⇒
 *    该文件**落在射程外而不是被判绿** —— `--census` 会把「解析到的写入点」逐条列出来，
 *    没列出来的就是没看见，不是看过了没问题。
 *  · ⚠ **已知未收口且不在本单范围内**：`scripts/check-ui-first-layer.mjs` 目前**不走**
 *    共享写入器（它是本单的**禁改文件**）。它连同其余存量违规**逐条进豁免基线并写明 why**，
 *    **不是**把判据放宽到它也算通过 —— 放宽判据是隐形的，豁免是看得见的，
 *    做成前者这道门当天就是装饰品。
 *
 * ══ 金丝雀（保命判据 · 任何模式下先跑）════════════════════════════════════════
 * 全部**喂进 `analyze()` 本体**，与主扫描同一份实现，**不另抄一份正则**
 * （抄一份就是装饰品：改主逻辑时金丝雀拿旧的去测、照样绿。本仓 2026-08-08 实测过）。
 * 必中 4 条（手搓写入器 / 同名局部函数伪装 / 导入了但写入点没用 / 用了但没跑金丝雀）+
 * 必不中 4 条（走共享写入器 / 非基线写入 / 只读基线不写 / 注释里的写入不算数）+
 * 真实文件 2 条 + 规模下界。**任一不符预期 ⇒ RC=2「工具坏了」，绝不报「全仓都合规」。**
 *
 * ══ 退出码三分（本仓铁律，`check-gate-exit-discipline.mjs` 机检本文件）══════════
 *   0 = 干净 · 1 = **主判据明确判负** · 2 = **门自己坏了**（读不到基线/参数错/未预期异常）。
 * ⚠ 顶层兜底刻意用 `try { await main() } catch`，**不用** `process.on("uncaughtException")`：
 *   全局 handler 会随 `import` 装进跑测试的进程、把无关异常抢走并 exit(2)
 *   （`check-edge-active-mounts.mjs` 头注记了这个坑）。本文件导出 `analyze()` 供复用，
 *   故必须用不污染宿主进程的那一种形态。
 *
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7（门）。门账：scripts/gate-ledger.json（同批登账）。
 * 用法：
 *   node scripts/check-baseline-writer-honesty.mjs            # 门（0/1/2）
 *   node scripts/check-baseline-writer-honesty.mjs --census    # 全表：谁在写基线、走不走共享写入器
 *   node scripts/check-baseline-writer-honesty.mjs --explain <file>
 *   node scripts/check-baseline-writer-honesty.mjs --update    # 棘轮豁免基线（只许降不许升）
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { buildBaselineDoc, baselineDocCanary } from "./lib/baseline-doc.mjs";

const require = createRequire(import.meta.url);
/** 只有被直接执行时才跑门；被 `import`（复用 analyze()）时一行副作用都不许有。 */
const IS_ENTRY = !!process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
const ROOT = process.cwd();
const SCRIPTS_DIR = join(ROOT, "scripts");
const BASELINE = join(ROOT, "scripts/baseline-writer-honesty-baseline.json");
const SHARED_WRITER = "scripts/lib/baseline-doc.mjs";
const SELF = "check-baseline-writer-honesty.mjs";

/* ═══════════════════════════════════════════════════════════════════════════
 * RC=2 统一出口 —— 「我没查出来」与「你有问题」处置相反，不许合并
 * ═══════════════════════════════════════════════════════════════════════════ */
function toolBroken(what, hint) {
  console.error(`⛔ ${SELF}：${what} ⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「基线写入都诚实 / 无违规 / 通过」——");
  console.error("   本门这次没有扫描成功，它什么都没证明。");
  if (hint) console.error(`   ${hint}`);
  process.exit(2); // 2 = 门自己坏了（1 只留给主判据明确判负）
}

/** typescript 是本门的解析器；缺了它不是「全仓都合规」，是「没得扫」。 */
function loadTypeScript() {
  if (process.env.BASELINE_WRITER_HONESTY_FORCE_NO_TS === "1") {
    toolBroken("（故障注入）typescript 不可用", "这是 --selftest 在自检「缺依赖 ⇒ RC=2」这条路径。");
  }
  try {
    return require("typescript");
  } catch {
    toolBroken(
      "缺 typescript（本门的解析器）",
      "多半是这个 worktree 没装依赖：先跑 `pnpm install --prefer-offline` 再重跑本门。",
    );
  }
  return null;
}
const ts = loadTypeScript();

/* ═══════════════════════════════════════════════════════════════════════════
 * 判据本体 —— 金丝雀与主扫描**共用这一个 analyze()**，不许各抄一份
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 写基线用的函数名（node:fs 同步/异步两种写法） */
const WRITE_FNS = new Set(["writeFileSync", "writeFile"]);
/** 自更新入口标志（路 B）。只认 AST 里的字符串字面量，注释不算。 */
const SELF_UPDATE_FLAGS = new Set(["--update", "--seed", "--write"]);
/** 目标路径是不是一份棘轮基线（路 A） */
const BASELINE_PATH_RE = /-baseline\.json$/;

function walk(node, fn) {
  fn(node);
  node.forEachChild((c) => walk(c, fn));
}

/** 子树里第一个形如 `*-baseline.json` 的字符串字面量（含模板串首段） */
function baselineLiteralIn(node, tsapi) {
  let found = null;
  walk(node, (x) => {
    if (found) return;
    if (tsapi.isStringLiteralLike(x) && BASELINE_PATH_RE.test(x.text)) found = x.text;
  });
  return found;
}

/** 子树里有没有对 `name` 的调用（`f()` 或 `o.f()` 都算） */
function hasCallTo(node, name, tsapi) {
  let hit = false;
  walk(node, (x) => {
    if (hit || !tsapi.isCallExpression(x)) return;
    const c = x.expression;
    if (tsapi.isIdentifier(c) && c.text === name) hit = true;
    else if (tsapi.isPropertyAccessExpression(c) && c.name.text === name) hit = true;
  });
  return hit;
}

/** `import(...)` 调用里的模块说明符 */
function dynamicImportSpec(node, tsapi) {
  if (!tsapi.isCallExpression(node)) return null;
  if (node.expression.kind !== tsapi.SyntaxKind.ImportKeyword) return null;
  const a0 = node.arguments[0];
  return a0 && tsapi.isStringLiteralLike(a0) ? a0.text : null;
}

const isSharedSpec = (s) => /(^|\/)lib\/baseline-doc\.mjs$/.test(s || "");

/**
 * **本门的判据本体**。返回一份可被金丝雀、`--census`、`--explain`、门本体共用的判定。
 *
 * @param {string} source 文件正文
 * @param {string} fileName 仅用于报行号
 * @returns {{
 *   isWriter: boolean, writes: Array<{line:number,target:string,viaShared:boolean,viaShadow:boolean,usesBuild:boolean}>,
 *   flags: string[], importsBuild: boolean, importsCanary: boolean, localShadow: number|null,
 *   canaryCalled: boolean, compliant: boolean, verdict: string, reasons: string[]
 * }}
 */
export function analyze(source, fileName = "sample.mjs", tsapi = ts) {
  const sf = tsapi.createSourceFile(fileName, source, tsapi.ScriptTarget.Latest, true, tsapi.ScriptKind.JS);
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  // ── 基线路径标识符：`const BASELINE = join(ROOT, "scripts/x-baseline.json")` ──
  const baselineIdents = new Map();
  walk(sf, (n) => {
    if (!tsapi.isVariableDeclaration(n) || !n.initializer) return;
    if (!n.name || !tsapi.isIdentifier(n.name)) return;
    const lit = baselineLiteralIn(n.initializer, tsapi);
    if (lit) baselineIdents.set(n.name.text, lit);
  });

  // ── 共享写入器的导入（静态 / 动态两种形态都认）──
  let importsBuild = false;
  let importsCanary = false;
  walk(sf, (n) => {
    // 静态：import { buildBaselineDoc, baselineDocCanary } from "./lib/baseline-doc.mjs"
    if (tsapi.isImportDeclaration(n) && tsapi.isStringLiteralLike(n.moduleSpecifier) && isSharedSpec(n.moduleSpecifier.text)) {
      const nb = n.importClause?.namedBindings;
      if (nb && tsapi.isNamedImports(nb)) {
        for (const el of nb.elements) {
          const src = (el.propertyName ?? el.name).text;
          if (src === "buildBaselineDoc") importsBuild = true;
          if (src === "baselineDocCanary") importsCanary = true;
        }
      } else if (nb && tsapi.isNamespaceImport(nb)) {
        importsBuild = true;
        importsCanary = true; // `import * as bd` ⇒ 两个名字都够得着，交给调用点判
      }
      return;
    }
    // 动态：const { buildBaselineDoc } = await import("./lib/baseline-doc.mjs")
    if (tsapi.isVariableDeclaration(n) && n.initializer) {
      let spec = null;
      walk(n.initializer, (x) => {
        if (spec) return;
        const s = dynamicImportSpec(x, tsapi);
        if (s && isSharedSpec(s)) spec = s;
      });
      if (!spec) return;
      if (tsapi.isObjectBindingPattern(n.name)) {
        for (const el of n.name.elements) {
          const src = (el.propertyName ?? el.name);
          const t = tsapi.isIdentifier(src) ? src.text : null;
          if (t === "buildBaselineDoc") importsBuild = true;
          if (t === "baselineDocCanary") importsCanary = true;
        }
      } else if (tsapi.isIdentifier(n.name)) {
        importsBuild = true;
        importsCanary = true;
      }
    }
  });

  // ── 同名局部实现（= 第二份写入器，最像合规的那种不合规）──
  let localShadow = null;
  walk(sf, (n) => {
    if (localShadow) return;
    if (tsapi.isFunctionDeclaration(n) && n.name?.text === "buildBaselineDoc") localShadow = lineOf(n);
    if (
      tsapi.isVariableDeclaration(n) && n.name && tsapi.isIdentifier(n.name) &&
      n.name.text === "buildBaselineDoc" && n.initializer &&
      (tsapi.isArrowFunction(n.initializer) || tsapi.isFunctionExpression(n.initializer))
    ) localShadow = lineOf(n);
  });

  // ── 路 A：写基线的调用点 ──
  const writes = [];
  walk(sf, (n) => {
    if (!tsapi.isCallExpression(n)) return;
    const c = n.expression;
    const fn = tsapi.isIdentifier(c) ? c.text : tsapi.isPropertyAccessExpression(c) ? c.name.text : null;
    if (!fn || !WRITE_FNS.has(fn)) return;
    const a0 = n.arguments[0];
    if (!a0) return;
    const target = tsapi.isIdentifier(a0)
      ? (baselineIdents.get(a0.text) ?? null)
      : baselineLiteralIn(a0, tsapi);
    if (!target) return; // 不是基线写入（或路径解析不到 ⇒ 射程外，见诚实边界）
    const usesBuild = hasCallTo(n, "buildBaselineDoc", tsapi);
    writes.push({
      line: lineOf(n),
      target,
      usesBuild,
      viaShadow: usesBuild && localShadow != null,
      viaShared: usesBuild && importsBuild && localShadow == null,
    });
  });

  // ── 路 B：自更新入口 ──
  const flags = new Set();
  walk(sf, (n) => {
    if (tsapi.isStringLiteralLike(n) && SELF_UPDATE_FLAGS.has(n.text)) flags.add(n.text);
  });

  const canaryCalled = hasCallTo(sf, "baselineDocCanary", tsapi) && importsCanary;
  const isWriter = writes.length > 0 && flags.size > 0;

  const reasons = [];
  let verdict = "NOT_WRITER";
  if (isWriter) {
    const handRolled = writes.filter((w) => !w.viaShared);
    if (handRolled.length) {
      verdict = writes.some((w) => w.viaShadow) ? "SHADOWED" : "HAND_ROLLED";
      for (const w of handRolled) {
        reasons.push(
          w.viaShadow
            ? `L${w.line} 写 ${w.target} 时调的 \`buildBaselineDoc()\` 是**本文件第 ${localShadow} 行的同名局部实现**，不是共享写入器 —— 这是第二份实现：共享写入器补新判据时它不会跟着变`
            : `L${w.line} 手搓写入 ${w.target}（实参里没有共享写入器 \`buildBaselineDoc()\`）—— \`--update\` 会把人手写进基线的 note/挂账整份覆盖掉`,
        );
      }
    } else if (!canaryCalled) {
      verdict = "NO_CANARY";
      reasons.push(
        "写入点走了共享写入器，但全文件没调 `baselineDocCanary()` —— " +
          "写入器哪天被改坏，这道门照样静默写出「抹掉人话」的基线（共享实现的价值一半在金丝雀上）",
      );
    } else {
      verdict = "COMPLIANT";
    }
  }

  return {
    isWriter,
    writes,
    flags: [...flags].sort(),
    importsBuild,
    importsCanary,
    localShadow,
    canaryCalled,
    verdict,
    compliant: !isWriter || verdict === "COMPLIANT",
    reasons,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 金丝雀 —— 全部喂进上面那个 analyze()，不另抄逻辑
 * ═══════════════════════════════════════════════════════════════════════════ */

const SAMPLE_SHARED = [
  'import { writeFileSync, existsSync, readFileSync } from "node:fs";',
  'import { buildBaselineDoc, baselineDocCanary } from "./lib/baseline-doc.mjs";',
  'const BASELINE = "scripts/canary-baseline.json";',
  'if (process.argv.includes("--update")) {',
  "  const bc = baselineDocCanary();",
  '  if (!bc.ok) toolBroken("金丝雀不过");',
  "  const prev = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, \"utf8\")) : null;",
  "  writeFileSync(BASELINE, JSON.stringify(buildBaselineDoc({",
  '    prev, generatedBy: "node x --update", prose: { note: "常量" }, computed: { entries: {} },',
  "  }), null, 2));",
  "}",
].join("\n");

const SAMPLE_HAND_ROLLED = [
  'import { writeFileSync } from "node:fs";',
  'const BASELINE = "scripts/canary-baseline.json";',
  'const NOTE = "这段话归脚本所有";',
  'if (process.argv.includes("--update")) {',
  "  writeFileSync(BASELINE, JSON.stringify({ note: NOTE, entries: {} }, null, 2));",
  "}",
].join("\n");

const SAMPLE_SHADOW = [
  'import { writeFileSync, existsSync, readFileSync } from "node:fs";',
  'import { baselineDocCanary } from "./lib/baseline-doc.mjs";',
  'const BASELINE = "scripts/canary-baseline.json";',
  "function buildBaselineDoc(prev, computed) {",
  '  return { ...(prev ?? {}), note: prev?.note ?? "常量", ...computed };',
  "}",
  'if (process.argv.includes("--seed")) {',
  "  const prev = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, \"utf8\")) : null;",
  "  writeFileSync(BASELINE, JSON.stringify(buildBaselineDoc(prev, { entries: {} })));",
  "}",
].join("\n");

const SAMPLE_IMPORTED_UNUSED = [
  'import { writeFileSync } from "node:fs";',
  'import { buildBaselineDoc, baselineDocCanary } from "./lib/baseline-doc.mjs";',
  'const BASELINE = "scripts/canary-baseline.json";',
  "const bc = baselineDocCanary();",
  'if (process.argv.includes("--update")) {',
  '  writeFileSync(BASELINE, JSON.stringify({ note: "常量", entries: {} }));',
  "}",
  "export { buildBaselineDoc };",
].join("\n");

const SAMPLE_NO_CANARY = [
  'import { writeFileSync } from "node:fs";',
  'import { buildBaselineDoc } from "./lib/baseline-doc.mjs";',
  'const BASELINE = "scripts/canary-baseline.json";',
  'if (process.argv.includes("--update")) {',
  '  writeFileSync(BASELINE, JSON.stringify(buildBaselineDoc({ prev: null, prose: { note: "n" }, computed: {} })));',
  "}",
].join("\n");

const SAMPLE_OTHER_FILE = [
  'import { writeFileSync } from "node:fs";',
  'const OUT = "docs/ONTOLOGY-SLICE-GAPS.md";',
  'if (process.argv.includes("--write")) writeFileSync(OUT, "# 报告\\n");',
].join("\n");

const SAMPLE_READER_ONLY = [
  'import { readFileSync, existsSync } from "node:fs";',
  'const BASELINE = "scripts/canary-baseline.json";',
  "const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, \"utf8\")) : {};",
  'if (process.argv.includes("--update")) console.log("这里只读不写", base);',
].join("\n");

const SAMPLE_COMMENT_ONLY = [
  "/**",
  ' * 用法：node x --update  ⇒ 会 writeFileSync(BASELINE, …) 重写 scripts/canary-baseline.json',
  " */",
  'const DOC = "writeFileSync(\\"scripts/canary-baseline.json\\", body)";',
  "console.log(DOC);",
].join("\n");

const CANARIES = [
  {
    name: "必中·手搓写入器（写 note 常量 + --update）判为不合规",
    src: SAMPLE_HAND_ROLLED,
    expect: (r) => r.isWriter === true && r.compliant === false && r.verdict === "HAND_ROLLED" && r.writes.length === 1,
  },
  {
    name: "必中·同名局部 buildBaselineDoc 伪装（写入点文本里有它，但那是第二份实现）",
    src: SAMPLE_SHADOW,
    expect: (r) => r.isWriter === true && r.compliant === false && r.verdict === "SHADOWED" && r.localShadow === 4,
  },
  {
    name: "必中·导入了共享写入器却没在写入点用（「导入了」≠「写的时候用了」）",
    src: SAMPLE_IMPORTED_UNUSED,
    expect: (r) => r.isWriter === true && r.compliant === false && r.verdict === "HAND_ROLLED" && r.importsBuild === true,
  },
  {
    name: "必中·走了共享写入器但没跑 baselineDocCanary()",
    src: SAMPLE_NO_CANARY,
    expect: (r) => r.isWriter === true && r.compliant === false && r.verdict === "NO_CANARY",
  },
  {
    name: "必不中·标准写法（共享写入器 + 金丝雀）判为合规",
    src: SAMPLE_SHARED,
    expect: (r) => r.isWriter === true && r.compliant === true && r.verdict === "COMPLIANT" && r.writes[0]?.viaShared === true,
  },
  {
    name: "必不中·写的不是基线 JSON（路 A 不成立 ⇒ 不进射程）",
    src: SAMPLE_OTHER_FILE,
    expect: (r) => r.isWriter === false && r.writes.length === 0,
  },
  {
    name: "必不中·只读基线不写（防「读基线的门被误算成写入方」）",
    src: SAMPLE_READER_ONLY,
    expect: (r) => r.isWriter === false && r.writes.length === 0,
  },
  {
    name: "必不中·注释与字符串里的 writeFileSync(BASELINE…) 不算数（AST 不收注释）",
    src: SAMPLE_COMMENT_ONLY,
    expect: (r) => r.isWriter === false && r.writes.length === 0,
  },
  {
    name: "必不中·真实文件 check-carrier-has-instances.mjs（本仓合规样板，不是编的）",
    real: "check-carrier-has-instances.mjs",
    expect: (r) => r.isWriter === true && r.compliant === true && r.canaryCalled === true,
  },
  {
    name: "必中·真实文件 check-ui-first-layer.mjs 确实是基线写入方（本单已知的存量豁免）",
    real: "check-ui-first-layer.mjs",
    // 只断言「它在射程内」：它哪天被改成走共享写入器，本条仍成立（棘轮会另行点名豁免过期）。
    expect: (r) => r.isWriter === true && r.writes.length >= 1,
  },
];

function runCanaries() {
  const fails = [];
  for (const c of CANARIES) {
    let src = c.src;
    if (c.real) {
      const p = join(SCRIPTS_DIR, c.real);
      if (!existsSync(p)) {
        fails.push(`${c.name} —— 样例文件 scripts/${c.real} 不存在（金丝雀自身失效，**不是**「代码干净」）`);
        continue;
      }
      try {
        src = readFileSync(p, "utf8");
      } catch (e) {
        fails.push(`${c.name} —— 读不到 scripts/${c.real}：${e?.message || e}`);
        continue;
      }
    }
    let r;
    try {
      r = analyze(src, c.real || "canary.mjs"); // ← 与主扫描同一个函数
    } catch (e) {
      fails.push(`${c.name} —— 分析器抛异常：${e?.message || e}`);
      continue;
    }
    if (!c.expect(r)) {
      fails.push(
        `${c.name} —— 实得 isWriter=${r.isWriter} verdict=${r.verdict} compliant=${r.compliant} ` +
          `writes=[${r.writes.map((w) => `L${w.line}:${w.target}${w.viaShared ? "→shared" : w.viaShadow ? "→shadow" : "→hand"}`).join(",")}] ` +
          `importsBuild=${r.importsBuild} canaryCalled=${r.canaryCalled} localShadow=${r.localShadow}`,
      );
    }
  }
  return fails;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 扫描面
 * ═══════════════════════════════════════════════════════════════════════════ */

const MIN_SCRIPTS = 60; // 规模下界：扫到的 .mjs 少于它 ⇒ 多半 cwd 不对，报工具坏了
const MIN_WRITERS = 12; // 基线写入方下界：本仓现算 19；跌破它 ⇒ 判据失配而不是「大家都不写基线了」

function listScripts() {
  let files;
  try {
    files = readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith(".mjs")).sort();
  } catch (e) {
    toolBroken(`读不到 scripts/ 目录（${e?.message || e}）`, "本门必须在仓根跑。");
  }
  return files;
}

function analyzeAll(files) {
  const rows = [];
  for (const f of files) {
    let src;
    try {
      src = readFileSync(join(SCRIPTS_DIR, f), "utf8");
    } catch (e) {
      // 读文件失败是**环境**失败，不是违规 —— 归 RC=2，绝不 bad++ 变成 RC=1
      toolBroken(`读不到 scripts/${f}（${e?.message || e}）`);
    }
    let r;
    try {
      r = analyze(src, f);
    } catch (e) {
      toolBroken(`分析 scripts/${f} 时抛异常（${e?.message || e}）`, "解析器对该文件失配 ⇒ 这次没扫成，不许读作它合规。");
    }
    rows.push({ file: f, ...r });
  }
  return rows;
}

function loadBaseline() {
  if (!existsSync(BASELINE)) {
    toolBroken("豁免基线不存在（scripts/baseline-writer-honesty-baseline.json）", "从 canonical 取回，或先跑 `--update` 生成。");
  }
  let j;
  try {
    j = JSON.parse(readFileSync(BASELINE, "utf8"));
  } catch (e) {
    toolBroken(`豁免基线不是合法 JSON（${e?.message || e}）`);
  }
  if (!j || typeof j.exempt !== "object" || j.exempt === null) {
    toolBroken("豁免基线结构不对（缺 `exempt` 对象）", "重跑 `--update` 或从 canonical 取回该文件。");
  }
  return j;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * CLI
 * ═══════════════════════════════════════════════════════════════════════════ */
async function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const val = (f) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : null;
  };

  // ── 金丝雀先跑，任何模式都跑 ────────────────────────────────────────────
  const canaryFails = runCanaries();
  if (canaryFails.length) {
    console.error("⛔ 金丝雀不中 ⇒ **门自己瞎了**，本次结论作废：");
    console.error("   **不许**读作「全仓基线写入都诚实 / 无违规 / 通过」——本门这次没有正确分析任何东西。");
    canaryFails.forEach((f) => console.error("   · " + f));
    process.exit(2);
  }
  // 诚实位：**现算**，不写死（写死是「加了样例而计数不动」那种假绿）
  const CANARY_LINE =
    `✅ 金丝雀 ${CANARIES.length}/${CANARIES.length} 全中（必中 ${CANARIES.filter((c) => /^必中/.test(c.name)).length}` +
    ` · 必不中 ${CANARIES.filter((c) => /^必不中/.test(c.name)).length}` +
    ` · 其中真实文件样例 ${CANARIES.filter((c) => c.real).length} 条；与主扫描共用 analyze()）`;

  if (!existsSync(join(ROOT, SHARED_WRITER))) {
    toolBroken(`找不到共享写入器 ${SHARED_WRITER}`, "本门的整条判据以它为准；它不在 ⇒ 这次什么都没证明。");
  }

  const files = listScripts();
  if (files.length < MIN_SCRIPTS) {
    toolBroken(`只枚举到 ${files.length} 个 scripts/*.mjs（下界 ${MIN_SCRIPTS}）`, "多半是 cwd 不在仓根：本门必须在仓根跑。");
  }
  const rows = analyzeAll(files);
  const writers = rows.filter((r) => r.isWriter);
  if (writers.length < MIN_WRITERS) {
    toolBroken(
      `只识别出 ${writers.length} 个基线写入方（下界 ${MIN_WRITERS}）`,
      "这更像判据失配（写法变了/解析器坏了），不是「大家都不写基线了」—— 先自证工具，再下结论。",
    );
  }

  if (has("--explain")) {
    const f = val("--explain");
    if (!f || f.startsWith("--")) toolBroken("`--explain` 没给文件名", "用法：`--explain check-xxx.mjs`");
    const r = rows.find((x) => x.file === f || x.file === String(f).replace(/^scripts\//, ""));
    if (!r) toolBroken(`${f} 不在扫描面里`, `本门只看 scripts/*.mjs（现算 ${rows.length} 个）。`);
    console.log(`# ${r.file}`);
    console.log(`verdict=${r.verdict}  isWriter=${r.isWriter}  compliant=${r.compliant}`);
    console.log(`importsBuild=${r.importsBuild}  importsCanary=${r.importsCanary}  canaryCalled=${r.canaryCalled}  localShadow=${r.localShadow ?? "-"}`);
    console.log(`自更新入口：${r.flags.join(" ") || "（无）"}`);
    for (const w of r.writes) {
      console.log(`  写入点 L${w.line}\t${w.target}\t${w.viaShared ? "→ 共享写入器 ✓" : w.viaShadow ? "→ 同名局部实现 ✗" : "→ 手搓 ✗"}`);
    }
    for (const m of r.reasons) console.log("  ✗ " + m);
    process.exit(0);
  }

  if (has("--census")) {
    console.log(CANARY_LINE);
    console.log(
      `scripts/*.mjs ${rows.length} 个 · 基线写入方 ${writers.length} · 走共享写入器 ${writers.filter((r) => r.compliant).length} · 未走 ${writers.filter((r) => !r.compliant).length}`,
    );
    for (const r of writers) {
      console.log(
        `${r.compliant ? "✓" : "✗"} ${r.file}\t${r.verdict}\t${r.writes.map((w) => `L${w.line}:${w.target.split("/").pop()}`).join(" ")}`,
      );
    }
    console.log("⚠ 诚实边界：只认命名形如 `*-baseline.json` 的写入目标；路径拼不出来的文件落在射程外（= 没看见，不是看过没问题）。");
    process.exit(0);
  }

  if (has("--update")) {
    // 本门自己写基线，当然也走共享写入器 + 四向金丝雀（自扫时它必须判自己合规）
    const bc = baselineDocCanary();
    if (!bc.ok) toolBroken(`基线写入器金丝雀不过（${bc.got}）`, `期望：${bc.want}`);
    const prev = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : null;
    const exempt = {};
    for (const r of writers.filter((x) => !x.compliant)) {
      exempt[r.file] = prev?.exempt?.[r.file] || {
        form: r.verdict,
        why: "TODO：写清楚为什么这道门今天还不走共享写入器（空 why 或留着 TODO 会被门判红）",
      };
      // form 是**算出来的**，永远刷新；why 归人手，只在首次挂账时落 TODO
      exempt[r.file].form = r.verdict;
      exempt[r.file].sites = r.writes.filter((w) => !w.viaShared).map((w) => `L${w.line} → ${w.target}`);
    }
    writeFileSync(
      BASELINE,
      JSON.stringify(
        buildBaselineDoc({
          prev,
          generatedBy: "node scripts/check-baseline-writer-honesty.mjs --update",
          prose: {
            note:
              "baseline-writer-honesty 棘轮基线：**存量**「自己手搓基线写入逻辑、绕开 scripts/lib/baseline-doc.mjs」的具名豁免，只许降不许升。" +
              "每条必须写 why（空 why / 留着 TODO 一律判红）。`form` 与 `sites` 是门现算的，`why` 归人手 —— " +
              "这份基线自己就是用共享写入器写的，故人手写在这里的话不会被 `--update` 吞掉。",
          },
          computed: { exempt },
        }),
        null,
        2,
      ) + "\n",
    );
    console.log(`已写基线：豁免 ${Object.keys(exempt).length} 条（${BASELINE}）`);
    process.exit(0);
  }

  /* ── 门本体 ───────────────────────────────────────────────────────────── */
  const baseline = loadBaseline();
  const exempt = baseline.exempt || {};

  const scanned = [...rows];
  // 故障注入：塞一个确知违规的虚拟脚本，验「真违规 ⇒ RC=1」没被兜底吞成 2
  if (process.env.BASELINE_WRITER_HONESTY_INJECT_VIOLATION === "1") {
    scanned.push({ file: "check-INJECTED-violation.mjs", ...analyze(SAMPLE_HAND_ROLLED, "check-INJECTED-violation.mjs") });
  }
  if (process.env.BASELINE_WRITER_HONESTY_FORCE_BOOM === "1") {
    throw new TypeError("（故障注入）未预期异常，验顶层兜底 ⇒ RC=2");
  }

  const bad = scanned.filter((r) => r.isWriter && !r.compliant);
  const badSet = new Set(bad.map((r) => r.file));

  const fail = [];
  for (const r of bad) {
    const e = exempt[r.file];
    if (!e) {
      fail.push(
        `✗ ${r.file} 绕开共享写入器 ${SHARED_WRITER}，且不在豁免基线里：\n      ` +
          r.reasons.join("\n      ") +
          `\n      修法：改成 \`import { buildBaselineDoc, baselineDocCanary } from "./lib/baseline-doc.mjs"\`，` +
          `\n           人手散文（note 等）走 \`prose\`、算出来的字段走 \`computed\`，开写前先跑 \`baselineDocCanary()\`。` +
          `\n           **别为了变绿把判据放宽**：真要挂账，写进 scripts/baseline-writer-honesty-baseline.json 并写清 why。`,
      );
    } else if (!e.why || !String(e.why).trim() || /^TODO/.test(String(e.why))) {
      fail.push(`✗ ${r.file} 在豁免基线里但没写 why —— 豁免必须说清理由，否则等于永久居留权`);
    }
  }
  // 棘轮反向：已合规/已不再写基线却仍挂在豁免名单上 ⇒ 红，逼名单单调收缩
  for (const f of Object.keys(exempt)) {
    if (badSet.has(f)) continue;
    const cur = scanned.find((r) => r.file === f);
    if (!cur) fail.push(`✗ 豁免基线里有 ${f}，但 scripts/ 下没有这个文件（删脚本须同批删豁免）`);
    else if (!cur.isWriter) fail.push(`✗ ${f} 已不再写基线 JSON，豁免已过期 —— 请从 scripts/baseline-writer-honesty-baseline.json 删掉该条（只降不升）`);
    else fail.push(`✗ ${f} 已经走共享写入器，却仍挂在豁免基线里 —— 棘轮只许降不许升，请删掉该条`);
  }

  const writersNow = scanned.filter((r) => r.isWriter);
  const okCount = writersNow.length - bad.length;
  console.log(CANARY_LINE);
  console.log(
    `· scripts/*.mjs ${scanned.length} 个 · 基线写入方 ${writersNow.length} · 走共享写入器 ${okCount} · 未走 ${bad.length}（其中已豁免 ${bad.filter((r) => exempt[r.file]).length}）`,
  );
  for (const r of bad) console.log(`  ✗ ${r.file}（${r.verdict}）${exempt[r.file] ? "【基线豁免】" : ""}`);
  console.log("· ⚠ 诚实边界：只认 `*-baseline.json` 命名的写入目标 · 只认结构不认语义 · 路径拼不出来的落射程外（没看见，不是看过没问题）。");

  if (fail.length) {
    console.error(`\n✗ baseline-writer-honesty:check 未通过（${fail.length} 条）：`);
    for (const m of fail) console.error("  - " + m);
    process.exit(1);
  }
  // 通过语必须带棘轮实况：一句「基线写入都诚实」盖住 N 条挂账，就是屏上说谎的那种绿。
  console.log(
    `\n✓ baseline-writer-honesty:check 通过（无**新增**绕开；存量 ${bad.length} 条具名挂账在 scripts/baseline-writer-honesty-baseline.json，逐条带 why；豁免名单无冗余）。`,
  );
  if (bad.length) {
    console.log(`  ⚠ 「通过」= 没有变得更糟，**不等于**干净：这 ${bad.length} 道门今天仍然各自手搓基线写入逻辑。`);
  }
}

/* ── 顶层兜底：任何未预期异常一律归 RC=2 ────────────────────────────────────
 * 刻意**不用** `process.on("uncaughtException")` —— 本文件导出 analyze() 供别处 import，
 * 全局 handler 会装进宿主（如测试）进程、把无关异常抢走并 exit(2)，连累整个进程。 */
try {
  if (IS_ENTRY) await main();
} catch (e) {
  toolBroken(`未预期异常（${e?.message || e}）`, String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
}
