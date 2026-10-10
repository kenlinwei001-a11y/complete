#!/usr/bin/env node
/**
 * 门 `gate-exit-discipline:check` · **门的退出码纪律门**（WO-GATE-RC2-DISCIPLINE）
 *
 * ══ 治什么 ═════════════════════════════════════════════════════════════════════
 * 本仓门的退出码是**三分**约定（`docs/SOP-reviewer-claim-discipline.md` §3）：
 *
 *   | RC | 含义         | 允许说什么                                           |
 *   |----|--------------|------------------------------------------------------|
 *   | 0  | 干净         | 可以下结论                                           |
 *   | 1  | **真有问题** | 你看到的证据不可信，先修                             |
 *   | 2  | **工具坏了** | **只许说「我没查出来」，绝不许说「它不存在/代码干净」** |
 *
 * 而 **node 对任何未捕获异常一律退 1** —— 恰好撞上「真有问题」这个码。于是：
 * 门根本没跑起来（缺依赖 / 基线读不出 / 权限 / OOM / rev 取不到 / 参数打错）
 * 被 `gate.sh` 和人一起读成「你的代码有问题」，方向**正好相反**。
 *
 * 2026-08-11 一天之内两道**不同**的门各撞一次，形态完全相同：
 *   ① `check-ui-first-layer.mjs`：缺 `node_modules` 时 `require("typescript")` 抛未捕获异常
 *      ⇒ RC=1 ⇒ 读作「UI 第一层超标」，真相是「我根本没扫描」。同一次还顺出 4 条同病路径
 *      （基线非法 JSON / 基线缺 `files` 字段 / `--rev` 打错 / `--explain` 缺参）。
 *   ② `check-backend-frontend-seam.mjs`：某变异下崩出裸 `TypeError` ⇒ RC=1
 *      ⇒ 读作「你的代码有接缝缺口」。
 *
 * 形态（CLAUDE.md 铁律 0.6 句式）：
 *   > **「我用『进程非 0 退出』当作『代码有问题』的证据，而前者并不度量后者。」**
 *
 * 铁律 0.6 三级处置：**同一个错第 2 次必须当场建机制**，而
 * **机制的判据只有一条 —— 下次同样的错发生时，是机器先说话，不是人先想起来。**
 * 逐个门补 `catch` 是一次性的：明天新加的门天然不带纪律，病当天复发。
 * **本门就是那个机制本体。**
 *
 * ══ 守的命题 ═══════════════════════════════════════════════════════════════════
 * **每一个 `scripts/check-*.mjs` 的默认失败方向必须是「我没查出来」（RC=2），
 *   而不是「你的代码有问题」（RC=1）。RC=1 只留给主判据明确判负的那一条路径。**
 *
 * 两条判据同时成立才算合规（缺一不可，各治一半）：
 *   ① **有 RC=2 出口**    —— 文件里存在 `process.exit(2)` 可达路径
 *                            （直接写，或调用一个「必退 2」的函数如 `toolBroken()`）。
 *                            没有它 ⇒ 这道门**根本没有**表达「我没查出来」的能力。
 *   ② **有顶层兜底**      —— 任何**未预期**异常也归 2。三种合法形态之一：
 *                            (a) 顶层 `try { … } catch { …exit(2) }`（包住主流程）
 *                            (b) 顶层 `process.on("uncaughtException"|"unhandledRejection", …exit(2))`
 *                            (c) 顶层 `main().catch(…exit(2))`
 *                            没有它 ⇒ ①只堵住了**已知**失败路径，而「已知」永远不完整
 *                            （只读 FS / 权限 / OOM / node 版本差异 / 依赖缺失都能抛）。
 *
 * ⚠ **①②必须同时查，只查一条会得出相反的安心感**：本仓实测 11 个门有 `exit(2)`，
 *   其中只有 2 个有顶层兜底 —— 光看①会以为「11 个门已守纪律」，实际 9 个门
 *   仍然会把「未预期崩溃」报成 RC=1。
 *
 * ══ ⚠ 反向判据（本门最容易被做坏的地方）═══════════════════════════════════════
 * 给门加兜底有一种**做坏了比不做更糟**的改法：兜底把**真违规**也吞成 2，
 * 于是门**永远不红** —— 那是拿一个更糟的假绿换掉一个假红。
 * 故本门 `--selftest` 必须**双向**机验：
 *   · 注入环境故障 ⇒ RC=**2**（不许是 1）
 *   · 注入真违规   ⇒ RC=**1**（不许被兜底吞成 2）
 * 只做前者的门 = 装饰品。
 *
 * ══ 诚实边界（本门做不到什么 · 不许当成「退出码已全部正确」）═══════════════════
 *  · **静态 `import` 的解析失败堵不住**：ESM 的 `import` 在**链接期**失败，早于任何用户代码，
 *    `process.on` 和 `try/catch` 都来不及注册。实测（node v22.22.2）：
 *    `import x from "not-installed"` ⇒ 钩子不触发、RC=**1**。
 *    幸而本仓 57 个门**零个**静态 import 三方包（本文件 `--census` 现算此数），
 *    受影响的只剩「本地 `./x.mjs` 被删」这种情形。要彻底堵死只能改用
 *    `createRequire` / 动态 `import()`（`check-ui-first-layer.mjs` 对 typescript 就是这么做的）。
 *  · 本门查的是**结构上存在**兜底，不是**语义上兜得住**。一个 `catch(e){}` 空吞异常
 *    然后 `exit(2)` 也会被判合规 —— 那不是本门能静态判定的。真正的证明是各门自己的
 *    `--selftest`（起子进程注入故障断言退出码），本门只保证「兜底这个结构在」。
 *  · 判据②的 (b) 形态只认**顶层无条件注册**（无函数祖先）。写在 `if` 里或某个函数里
 *    的注册，本门当它不存在 —— 偏保守，宁可多报。
 *
 * ══ 金丝雀（保命判据 · 每次运行都先跑）════════════════════════════════════════
 * 开扫之前先拿**内嵌样例**过一遍 `analyzeGate()` —— **与主逻辑同一份实现，不另抄正则**
 * （抄一份 = 装饰品：改主逻辑时金丝雀拿旧的去测、照样绿。本仓 2026-08-08 实测过）。
 * 金丝雀至少咬三件事，各对应一个真实踩过的坑：
 *   ① **确知合规的门认得出**（拿 `check-ui-first-layer.mjs` 的真实文件当样例，不是编的）
 *   ② **确知不合规的认得出**（裸脚本，无 exit(2) 无兜底）
 *   ③ **跨行结构真的能识别** —— `grep -E` 是**行式**的，`[\s\S]*` 跨行模式**永远不匹配**；
 *      派单人第一次数这三个数就是这么数错的，被金丝雀当场抖出。故必须有一条常驻金丝雀
 *      钉住「try 在第 1 行、catch 在第 3 行、exit(2) 在另一个函数里」这种真实形状。
 *   ④ 外加：**注释/字符串里的 `process.exit(2)` 不算数**（同 css-token 门栽过的「注释里的
 *      散文被当成真引用」）。本门走 AST，注释天然不进树 —— 这条金丝雀就是钉住这个性质。
 * 任一不中 ⇒ 打印「⛔ 门自己瞎了」并 **RC=2**，而不是安静报「全仓都合规」。
 *
 * ══ 棘轮 ═══════════════════════════════════════════════════════════════════════
 * 存量豁免记在 `scripts/gate-exit-discipline-baseline.json`，每条必须写 `why`。
 * **只许降不许升**：不在豁免名单里的不合规 ⇒ 红；已经合规却还挂在名单上 ⇒ 也红
 * （逼着名单单调收缩，否则豁免会变成永久居留权）。
 *
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7（门）· §8 G-GATE-RC1-MASQUERADE。
 * 门账：scripts/gate-ledger.json（同批登账，否则新门天然免疫 gate-ledger:check 治理）。
 *
 * 用法：
 *   node scripts/check-gate-exit-discipline.mjs            # 门（0 干净 / 1 有违规 / 2 工具坏了）
 *   node scripts/check-gate-exit-discipline.mjs --census    # 全表：谁有 exit2、谁有兜底、什么形态
 *   node scripts/check-gate-exit-discipline.mjs --explain <file>
 *   node scripts/check-gate-exit-discipline.mjs --selftest  # 金丝雀 + 三个退出码机验
 *   node scripts/check-gate-exit-discipline.mjs --update    # 重写豁免基线（只许收缩）
 */

/* ── 兜底必须**最先**注册：它要覆盖的正是「后面任何一行崩了」──────────────────
 * （本门自己当然要遵守它自己守的纪律；且它**自扫**，见下 SCAN 集合。）
 * 实测（node v22.22.2）：顶层同步 throw 走 `uncaughtException`，
 * 顶层 await 之后的 throw 走 `unhandledRejection` —— 两个都要挂，只挂一个有洞。 */
process.on("uncaughtException", (e) => bail(e));
process.on("unhandledRejection", (e) => bail(e));
function bail(e) {
  toolBroken(`未预期异常（${e?.message || e}）`, (e?.stack || "").split("\n").slice(1, 4).join("\n   "));
}

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildBaselineDoc, baselineDocCanary } from "./lib/baseline-doc.mjs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const SCRIPTS_DIR = join(ROOT, "scripts");
const BASELINE = join(ROOT, "scripts/gate-exit-discipline-baseline.json");
const SELF = "check-gate-exit-discipline.mjs";

/* ═══════════════════════════════════════════════════════════════════════════
 * RC=2 统一出口
 * ═══════════════════════════════════════════════════════════════════════════ */
/**
 * **任何**「我没能完成扫描」的情形一律走这里 ⇒ RC=2，并明说结论作废。
 * 与 RC=1（主判据明确判负）严格分开：两者的处置方向相反，合并即事故。
 */
function toolBroken(what, hint) {
  console.error(`⛔ ${what} ⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——");
  console.error("   本门这次根本没有扫描成功，它什么都没证明。");
  if (hint) console.error(`   ${hint}`);
  process.exit(2); // 2 = 工具自己坏了（1 是「真有违规」，两者处置完全不同，不许合并）
}

/** typescript 是本门的解析器；缺了它不是「全仓都合规」，是「没得扫」。 */
function loadTypeScript() {
  // 故障注入开关：只给 `--selftest` 的子进程用，用来**机械验证**这条路径真的返回 2
  // （写在注释里的约定不是机制；只有机器跑得到的才是）。
  if (process.env.GATE_EXIT_DISCIPLINE_FORCE_NO_TS === "1") {
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
}
const ts = loadTypeScript();

/* ═══════════════════════════════════════════════════════════════════════════
 * 分析本体 —— 金丝雀与主逻辑**共用这一份**，不另抄正则
 * ═══════════════════════════════════════════════════════════════════════════ */

const GUARD_EVENTS = new Set(["uncaughtException", "unhandledRejection"]);

/** `process.exit(2)` / `exit(2)`（实参必须是字面量 2） */
function isExit2Call(n) {
  if (!ts.isCallExpression(n)) return false;
  const a0 = n.arguments[0];
  if (!a0 || !ts.isNumericLiteral(a0) || a0.text !== "2") return false;
  const c = n.expression;
  if (ts.isIdentifier(c)) return c.text === "exit";
  if (ts.isPropertyAccessExpression(c)) return c.name.text === "exit";
  return false;
}

/** `process.on("uncaughtException"|"unhandledRejection", handler)` */
function guardEventOf(n) {
  if (!ts.isCallExpression(n)) return null;
  const c = n.expression;
  if (!ts.isPropertyAccessExpression(c) || c.name.text !== "on") return null;
  if (!ts.isIdentifier(c.expression) || c.expression.text !== "process") return null;
  const a0 = n.arguments[0];
  if (!a0 || !ts.isStringLiteralLike(a0) || !GUARD_EVENTS.has(a0.text)) return null;
  return { event: a0.text, handler: n.arguments[1] };
}

/** `<expr>.catch(handler)` */
function catchTailOf(n) {
  if (!ts.isCallExpression(n)) return null;
  const c = n.expression;
  if (!ts.isPropertyAccessExpression(c) || c.name.text !== "catch") return null;
  return { handler: n.arguments[0] };
}

function walk(node, fn) {
  fn(node);
  node.forEachChild((c) => walk(c, fn));
}

/** 该子树里直接出现的 `exit(2)`，以及它调用到的标识符 */
function scanSubtree(node) {
  let direct = false;
  const calls = new Set();
  walk(node, (n) => {
    if (isExit2Call(n)) direct = true;
    if (ts.isCallExpression(n)) {
      const c = n.expression;
      if (ts.isIdentifier(c)) calls.add(c.text);
      else if (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression)) {
        calls.add(`${c.expression.text}.${c.name.text}`);
      }
    }
  });
  return { direct, calls };
}

/**
 * 收集「必退 2 的函数」名集合，做**不动点**传播。
 *
 * ⚠ 这一层是铁律 0.5 的直接落地：`toolBroken()` 里才有 `process.exit(2)`，
 * 而顶层 `catch` 里只写着 `toolBroken(e)` —— 只追直接命中会把
 * `check-ui-first-layer.mjs`（本仓公认合规的样板）判成「兜底不通向 2」，
 * 得出与事实相反的结论。故必须再追一层，且追到不动点。
 */
function collectExitingFns(sf) {
  const bodies = new Map(); // name -> body node
  walk(sf, (n) => {
    if (ts.isFunctionDeclaration(n) && n.name && n.body) bodies.set(n.name.text, n.body);
    if (ts.isVariableDeclaration(n) && n.name && ts.isIdentifier(n.name) && n.initializer) {
      const init = n.initializer;
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) bodies.set(n.name.text, init.body);
    }
  });
  const scanned = new Map();
  for (const [name, body] of bodies) scanned.set(name, scanSubtree(body));

  const exiting = new Set();
  for (const [name, s] of scanned) if (s.direct) exiting.add(name);
  for (let i = 0; i < 8; i++) {
    let grew = false;
    for (const [name, s] of scanned) {
      if (exiting.has(name)) continue;
      for (const c of s.calls) {
        if (exiting.has(c)) { exiting.add(name); grew = true; break; }
      }
    }
    if (!grew) break;
  }
  return exiting;
}

/** 该子树是否**能到达** RC=2（直接 exit(2)，或调用一个必退 2 的函数） */
function reachesExit2(node, exitingFns) {
  if (!node) return false;
  const s = scanSubtree(node);
  if (s.direct) return true;
  for (const c of s.calls) if (exitingFns.has(c)) return true;
  return false;
}

/** 某节点是否处在「模块顶层无条件执行」的位置（无函数祖先） */
function isUnconditionalTopLevel(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (
      ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isArrowFunction(p) ||
      ts.isMethodDeclaration(p) || ts.isClassDeclaration(p)
    ) return false;
  }
  return true;
}

/**
 * **本门的判据本体**。金丝雀与主扫描调的是同一个函数 —— 不许各抄一份。
 * @returns {{exit2:boolean, exit2Sites:number[], guards:Array<{kind:string,line:number,toExit2:boolean}>,
 *            guarded:boolean, compliant:boolean, reasons:string[]}}
 */
export function analyzeGate(source, fileName = "gate.mjs") {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const exitingFns = collectExitingFns(sf);

  // ① RC=2 出口：直接 exit(2)，或调用一个必退 2 的函数
  const exit2Sites = [];
  walk(sf, (n) => { if (isExit2Call(n)) exit2Sites.push(lineOf(n)); });
  const callsExiting = [];
  walk(sf, (n) => {
    if (!ts.isCallExpression(n)) return;
    const c = n.expression;
    if (ts.isIdentifier(c) && exitingFns.has(c.text)) callsExiting.push(lineOf(n));
  });
  const exit2 = exit2Sites.length > 0;

  // ② 顶层兜底：三种合法形态
  const guards = [];
  //   (a) 顶层 try/catch —— 必须是 Program 的直接子语句（嵌在函数里的 try 不覆盖全流程）
  for (const st of sf.statements) {
    if (ts.isTryStatement(st) && st.catchClause) {
      guards.push({ kind: "top-level try/catch", line: lineOf(st), toExit2: reachesExit2(st.catchClause.block, exitingFns) });
    }
  }
  //   (b) process.on("uncaughtException"|"unhandledRejection") —— 顶层无条件注册
  //   (c) <expr>.catch(handler) —— 顶层无条件
  walk(sf, (n) => {
    const g = guardEventOf(n);
    if (g && isUnconditionalTopLevel(n)) {
      guards.push({ kind: `process.on("${g.event}")`, line: lineOf(n), toExit2: reachesExit2(g.handler, exitingFns) });
      return;
    }
    const t = catchTailOf(n);
    if (t && isUnconditionalTopLevel(n) && t.handler) {
      guards.push({ kind: "top-level .catch()", line: lineOf(n), toExit2: reachesExit2(t.handler, exitingFns) });
    }
  });

  const guarded = guards.some((g) => g.toExit2);
  const reasons = [];
  if (!exit2) reasons.push("① 无 RC=2 出口：全文件找不到 `process.exit(2)` —— 这道门没有能力说「我没查出来」，任何环境故障都会退 1（= 「你的代码有问题」）");
  if (!guarded) {
    reasons.push(
      guards.length
        ? `② 顶层兜底不通向 RC=2：找到 ${guards.length} 处兜底结构（${guards.map((g) => `${g.kind}@L${g.line}`).join("、")}），但没有一处能到达 exit(2)`
        : "② 无顶层兜底：未预期异常（缺依赖 / 只读 FS / 权限 / OOM / node 版本差异）会走 node 默认退 1，被读成「真有违规」",
    );
  }
  return { exit2, exit2Sites, callsExiting, guards, guarded, compliant: exit2 && guarded, reasons };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 金丝雀 —— 与主逻辑同一份实现（上面那个 analyzeGate），只喂样例
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ③ 跨行结构金丝雀的样例：`try` 在第 1 行、`catch` 在第 3 行、
 *    而 `exit(2)` 根本不在 catch 里（在另一个函数 `toolBroken` 里）。
 *    行式 `grep -E 'catch[\s\S]*exit\(2\)'` 对它**永远 0 命中** —— 这正是派单人数错的那次。
 */
const CROSS_LINE_SAMPLE = [
  "try {",
  "  main();",
  "} catch (e) {",
  "  toolBroken(e.message);",
  "}",
  "function toolBroken(w) {",
  "  console.error(w);",
  "  process.exit(2);",
  "}",
].join("\n");

const CANARIES = [
  {
    name: "必咬·裸脚本（无 exit(2) 无兜底）判为不合规",
    src: "import { readFileSync } from 'node:fs';\nconst t = readFileSync('x');\nif (!t) process.exit(1);\nconsole.log('ok');\n",
    expect: (r) => r.compliant === false && r.exit2 === false && r.guarded === false,
  },
  {
    name: "必咬·有 exit(2) 但无顶层兜底 —— 判为不合规（①②必须同时查）",
    src: "function toolBroken(w) { console.error(w); process.exit(2); }\nif (!process.env.X) toolBroken('no X');\nconsole.log('ok');\n",
    expect: (r) => r.exit2 === true && r.guarded === false && r.compliant === false,
  },
  {
    name: "必不咬·跨行 try/catch + 间接 exit(2)（行式正则恒 0 命中的那个形状）",
    src: CROSS_LINE_SAMPLE,
    expect: (r) => r.compliant === true && r.guarded === true &&
      r.guards.some((g) => g.kind === "top-level try/catch" && g.toExit2),
  },
  {
    name: "必不咬·process.on(uncaughtException) 顶层注册 + 间接 exit(2)",
    src: "process.on('uncaughtException', (e) => bail(e));\nfunction bail(e) { console.error(e); process.exit(2); }\nconsole.log('scan');\n",
    expect: (r) => r.compliant === true && r.guards.some((g) => g.kind.includes("uncaughtException") && g.toExit2),
  },
  {
    name: "必不咬·main().catch() 顶层链式兜底",
    src: "async function main() { return 0; }\nmain().catch((e) => { console.error(e); process.exit(2); });\n",
    expect: (r) => r.compliant === true && r.guards.some((g) => g.kind === "top-level .catch()" && g.toExit2),
  },
  {
    name: "必咬·注释与字符串里的 `process.exit(2)` 不算数（AST 不收注释）",
    src: "// 本门约定：坏了要 process.exit(2)\nconst doc = 'process.exit(2)';\nconsole.log(doc);\n",
    expect: (r) => r.exit2 === false && r.compliant === false,
  },
  {
    name: "必咬·嵌在函数里的 try/catch 不算顶层兜底（偏保守，宁可多报）",
    src: "function main() { try { work(); } catch (e) { process.exit(2); } }\nmain();\nfunction work() {}\n",
    expect: (r) => r.exit2 === true && r.guarded === false && r.compliant === false,
  },
  {
    name: "必咬·顶层 try/catch 但 catch 里退 1（兜底不通向 2 ⇒ 仍不合规）",
    src: "try { main(); } catch (e) { console.error(e); process.exit(1); }\nfunction main() {}\n",
    expect: (r) => r.guards.length > 0 && r.guarded === false && r.compliant === false,
  },
  {
    name: "必不咬·真实样板 check-ui-first-layer.mjs（本仓公认合规，不是编的样例）",
    real: "check-ui-first-layer.mjs",
    expect: (r) => r.compliant === true && r.exit2 === true && r.guarded === true,
  },
];

function runCanaries() {
  const fails = [];
  for (const c of CANARIES) {
    let src = c.src;
    if (c.real) {
      const p = join(SCRIPTS_DIR, c.real);
      if (!existsSync(p)) { fails.push(`${c.name} —— 样例文件 scripts/${c.real} 不存在（金丝雀自身失效，不是「代码干净」）`); continue; }
      src = readFileSync(p, "utf8");
    }
    let r;
    try {
      r = analyzeGate(src, c.real || "canary.mjs"); // ← 与主扫描同一个函数
    } catch (e) {
      fails.push(`${c.name} —— 分析器抛异常：${e?.message || e}`);
      continue;
    }
    if (!c.expect(r)) {
      fails.push(`${c.name} —— 实得 compliant=${r.compliant} exit2=${r.exit2} guarded=${r.guarded} guards=[${r.guards.map((g) => g.kind + (g.toExit2 ? "→2" : "→x")).join(",")}]`);
    }
  }
  return fails;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 扫描面
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 门脚本清单。**与 `gate-census.mjs` 共用同一份真值**（文件系统），
 * 不另立清单 —— 两份清单必然漂移，而漂移的那个差集正好是「天然免疫治理」的门。
 * 用动态 import 而非静态 import：静态 import 失败在链接期，兜底钩子来不及注册（见诚实边界）。
 */
async function listGates() {
  try {
    const m = await import("./gate-census.mjs");
    return m.listGateScripts();
  } catch (e) {
    toolBroken(`读不到门脚本清单（./gate-census.mjs：${e?.message || e}）`, "本门的扫描面来自它；取不到就是「我没查出来」，不是「没有门」。");
  }
}

const MIN_GATES = 40; // 规模下界：扫到的门数低于它 ⇒ 多半是 cwd 不对/目录读错，报工具坏了

function loadBaseline() {
  if (!existsSync(BASELINE)) {
    toolBroken(`基线文件不存在（scripts/${BASELINE.split("/").pop()}）`, "从 canonical 取回该文件，或先跑 `--update` 生成。");
  }
  let j;
  try {
    j = JSON.parse(readFileSync(BASELINE, "utf8"));
  } catch (e) {
    toolBroken(`基线文件读不出/不是合法 JSON（${e?.message || e}）`);
  }
  if (!j || typeof j.exempt !== "object" || j.exempt === null) {
    toolBroken("基线结构不对（缺 `exempt` 字段）", "重跑 `--update` 或从 canonical 取回该文件。");
  }
  return j;
}

function analyzeAll(files) {
  const rows = [];
  for (const f of files) {
    const p = join(SCRIPTS_DIR, f);
    let src;
    try {
      src = readFileSync(p, "utf8");
    } catch (e) {
      toolBroken(`读不到门脚本 scripts/${f}（${e?.message || e}）`);
    }
    rows.push({ file: f, ...analyzeGate(src, f) });
  }
  return rows;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * CLI
 * ═══════════════════════════════════════════════════════════════════════════ */
async function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

  // ── 金丝雀先跑，任何模式都跑 ────────────────────────────────────────────
  const canaryFails = runCanaries();
  if (canaryFails.length) {
    console.error("⛔ 金丝雀不中 ⇒ **门自己瞎了**，本次结论作废：");
    console.error("   **不许**读作「全仓门都守纪律 / 无违规 / 通过」——本门这次没有正确分析任何东西。");
    canaryFails.forEach((f) => console.error("   · " + f));
    process.exit(2);
  }
  // 诚实位：**现算**，不写死（写死是假绿第 11 形态：加了样例而计数不动，屏上照旧「N/N 全中」）
  const CANARY_LINE = `✅ 金丝雀 ${CANARIES.length}/${CANARIES.length} 全中` +
    `（必咬 ${CANARIES.filter((c) => /必咬/.test(c.name)).length} + 必不咬 ${CANARIES.filter((c) => /必不咬/.test(c.name)).length}` +
    `；其中真实文件样例 ${CANARIES.filter((c) => c.real).length} 条）`;

  const files = await listGates();
  if (files.length < MIN_GATES) {
    toolBroken(`只枚举到 ${files.length} 个门脚本（下界 ${MIN_GATES}）`, "多半是 cwd 不在仓根：本门必须在仓根跑。");
  }
  const rows = analyzeAll(files);

  if (has("--explain")) {
    const f = val("--explain");
    if (!f || f.startsWith("--")) toolBroken("`--explain` 没给文件名", "用法：`--explain check-xxx.mjs`");
    const r = rows.find((x) => x.file === f || x.file === f.replace(/^scripts\//, ""));
    if (!r) toolBroken(`${f} 不在门脚本集合里`, `本门只看 scripts/check-*.mjs（现算 ${rows.length} 个）。`);
    console.log(`# ${r.file}`);
    console.log(`compliant=${r.compliant}  exit2=${r.exit2}（L${r.exit2Sites.join(" L") || "-"}）  guarded=${r.guarded}`);
    for (const g of r.guards) console.log(`  兜底 L${g.line}\t${g.kind}\t${g.toExit2 ? "→ 通向 exit(2) ✓" : "→ 不通向 exit(2) ✗"}`);
    for (const m of r.reasons) console.log("  ✗ " + m);
    process.exit(0);
  }

  if (has("--census")) {
    const ok = rows.filter((r) => r.compliant);
    console.log(CANARY_LINE);
    console.log(`门脚本 ${rows.length} 个 · 有 exit(2) 出口 ${rows.filter((r) => r.exit2).length} · 有顶层兜底(通向2) ${rows.filter((r) => r.guarded).length} · 两者兼备 ${ok.length} · 不合规 ${rows.length - ok.length}`);
    for (const r of rows) {
      console.log(`${r.compliant ? "✓" : "✗"} ${r.file}\texit2=${r.exit2 ? r.exit2Sites.length : 0}\tguards=${r.guards.map((g) => g.kind + (g.toExit2 ? "→2" : "→x")).join("|") || "-"}`);
    }
    process.exit(0);
  }

  if (has("--update")) {
    // 基线写入器四向金丝雀（与 buildBaselineDoc 共用同一份实现，不另抄）——
    // 治「--update 静默吞掉人手挂账」那一族病，来历见 scripts/lib/baseline-doc.mjs。
    const bc = baselineDocCanary();
    if (!bc.ok) toolBroken(`基线写入器金丝雀不过（${bc.got}）`, `期望：${bc.want}`);
    const bad = rows.filter((r) => !r.compliant).map((r) => r.file);
    const prev = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : null;
    const exempt = {};
    for (const f of bad) exempt[f] = prev?.exempt?.[f] || { why: "TODO：写清楚为什么这道门今天还不能守纪律（空 why 会被门判红）" };
    writeFileSync(BASELINE, JSON.stringify(buildBaselineDoc({
      prev,
      generatedBy: "node scripts/check-gate-exit-discipline.mjs --update",
      prose: { note: "gate-exit-discipline 棘轮基线：存量豁免，只许降不许升。每条必须写 why。" },
      computed: { exempt },
    }), null, 2) + "\n");
    console.log(`已写基线：豁免 ${Object.keys(exempt).length} 条（${BASELINE}）`);
    process.exit(0);
  }

  if (has("--selftest")) {
    console.log(CANARY_LINE);
    console.log(`✅ 扫描面 ${rows.length} 个门脚本（下界 ${MIN_GATES}）`);
    const selfRow = rows.find((r) => r.file === SELF);
    if (!selfRow) toolBroken(`本门没有自扫到自己（${SELF} 不在扫描面里）`, "自扫是本门的最低要求：一道不管自己的门是装饰品。");
    if (!selfRow.compliant) toolBroken(`本门自己不合规（${selfRow.reasons.join("；")}）`);
    console.log(`✅ 自扫：${SELF} 自身合规（exit2 ${selfRow.exit2Sites.length} 处 · 兜底 ${selfRow.guards.filter((g) => g.toExit2).length} 处）`);

    /*
     * ── 退出码契约自检（三个码各验一次 · **双向**）────────────────────────────
     * 只验「故障 ⇒ 2」会把门做成**永远不红**（拿更糟的假绿换掉假红）。
     * 故必须同时验「真违规 ⇒ 仍是 1，没被兜底吞成 2」。
     */
    const selfPath = fileURLToPath(import.meta.url);
    const run = (env) => spawnSync(process.execPath, [selfPath], { cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf8" });

    const probes = [
      { want: 2, label: "注入「缺 typescript」故障 ⇒ RC=2（工具坏了）", env: { GATE_EXIT_DISCIPLINE_FORCE_NO_TS: "1" } },
      { want: 2, label: "注入「基线读不出」故障 ⇒ RC=2（工具坏了）", env: { GATE_EXIT_DISCIPLINE_FORCE_BAD_BASELINE: "1" } },
      { want: 2, label: "注入「未预期异常」⇒ 顶层兜底把它归 2，而非 node 默认的 1", env: { GATE_EXIT_DISCIPLINE_FORCE_BOOM: "1" } },
      { want: 1, label: "注入「真违规」⇒ 仍是 RC=1，**没有**被兜底吞成 2", env: { GATE_EXIT_DISCIPLINE_INJECT_VIOLATION: "1" } },
      { want: 0, label: "无注入 ⇒ RC=0（干净）", env: {} },
    ];
    for (const p of probes) {
      const r = run(p.env);
      if (r.status !== p.want) {
        console.error(`⛔ 退出码契约被破：${p.label}，实得 RC=${r.status}`);
        console.error("   stderr：" + (r.stderr || "").trim().split("\n").slice(0, 4).join(" / "));
        console.error("   stdout：" + (r.stdout || "").trim().split("\n").slice(-3).join(" / "));
        process.exit(2);
      }
      console.log(`✅ ${p.label}`);
    }
    console.log("\n✓ gate-exit-discipline --selftest 通过（金丝雀全中 · 自扫合规 · 三个退出码双向机验）");
    process.exit(0);
  }

  /* ── 门本体 ───────────────────────────────────────────────────────────── */
  const baseline = loadBaseline();
  // 故障注入：基线损坏这条路径也必须是 2（--selftest 用）
  if (process.env.GATE_EXIT_DISCIPLINE_FORCE_BAD_BASELINE === "1") {
    toolBroken("（故障注入）基线文件读不出", "这是 --selftest 在自检「基线坏 ⇒ RC=2」这条路径。");
  }
  // 故障注入：完全未预期的异常，验顶层兜底把它归 2 而不是 node 默认的 1
  if (process.env.GATE_EXIT_DISCIPLINE_FORCE_BOOM === "1") {
    // 故意不 catch：这就是「未预期」的定义
    throw new TypeError("（故障注入）未预期异常，验顶层兜底");
  }

  const scanned = [...rows];
  // 故障注入：塞一个确知不合规的虚拟门，验「真违规 ⇒ RC=1」没被兜底吞成 2
  if (process.env.GATE_EXIT_DISCIPLINE_INJECT_VIOLATION === "1") {
    scanned.push({ file: "check-INJECTED-violation.mjs", ...analyzeGate("console.log('no exit2, no guard');\n", "check-INJECTED-violation.mjs") });
  }

  const exempt = baseline.exempt || {};
  const bad = scanned.filter((r) => !r.compliant);
  const badSet = new Set(bad.map((r) => r.file));

  const fail = [];
  for (const r of bad) {
    const e = exempt[r.file];
    if (!e) {
      fail.push(`✗ ${r.file} 不守退出码纪律，且不在豁免基线里：\n      ${r.reasons.join("\n      ")}`);
    } else if (!e.why || !String(e.why).trim() || /^TODO/.test(String(e.why))) {
      fail.push(`✗ ${r.file} 在豁免基线里但没写 why —— 豁免必须说清理由，否则等于永久居留权`);
    }
  }
  // 棘轮：只许降不许升 —— 已合规却仍挂在豁免名单上 ⇒ 红，逼名单单调收缩
  for (const f of Object.keys(exempt)) {
    if (!badSet.has(f)) {
      if (!scanned.some((r) => r.file === f)) fail.push(`✗ 豁免基线里有 ${f}，但 scripts/ 下没有这个门（删脚本须同批删豁免）`);
      else fail.push(`✗ ${f} 已经合规，却仍挂在豁免基线里 —— 棘轮只许降不许升，请从 scripts/gate-exit-discipline-baseline.json 删掉该条`);
    }
  }

  const okCount = scanned.length - bad.length;
  console.log(CANARY_LINE);
  console.log(`· 门脚本 ${scanned.length} 个 · 守纪律 ${okCount} · 不守 ${bad.length}（其中已豁免 ${bad.filter((r) => exempt[r.file]).length}）`);
  console.log(`· 分项：有 RC=2 出口 ${scanned.filter((r) => r.exit2).length} · 有顶层兜底(通向 exit(2)) ${scanned.filter((r) => r.guarded).length}`);

  if (fail.length) {
    console.error(`\n✗ gate-exit-discipline:check 未通过（${fail.length} 条）：`);
    for (const m of fail) console.error("  - " + m);
    console.error("\n  修法（照 scripts/check-ui-first-layer.mjs 的样板）：");
    console.error("    ① 加一个统一出口 `toolBroken(why)`：打印「本次结论作废」并 `process.exit(2)`；");
    console.error("    ② 顶层挂兜底 —— `process.on(\"uncaughtException\"/\"unhandledRejection\", …)` 或 `try { main() } catch { toolBroken(…) }`；");
    console.error("    ③ 把「读基线 / 取 rev / 缺依赖 / 参数打错」这类**环境**失败全部改走 toolBroken；");
    console.error("    ④ RC=1 只留给主判据明确判负那一条路径 —— 别让兜底把真违规也吞成 2（那是更糟的假绿）。");
    console.error("    ⑤ 实在改不动就登记 scripts/gate-exit-discipline-baseline.json 的 exempt，并写清 why。");
    process.exit(1); // 1 = 真有违规（与上面所有 toolBroken 的 2 严格分开）
  }
  console.log("\n✓ gate-exit-discipline:check 通过（每道门都有 RC=2 出口 + 顶层兜底 · 豁免名单无冗余）");
  process.exit(0);
}

/*
 * ── 兜底之二：把主流程也包起来 ──────────────────────────────────────────────
 * 上面的 process.on 钩子已经覆盖了同步与异步两侧，这里再包一层不是冗余：
 * 它让「兜底」这件事在**源码结构上**也成立（本门自扫的判据②认的就是这个结构），
 * 且异常在这里被 toolBroken 拿住时，栈更短、提示更准。
 */
try {
  await main();
} catch (e) {
  toolBroken(`未预期异常（${e?.message || e}）`, (e?.stack || "").split("\n").slice(1, 4).join("\n   "));
}
