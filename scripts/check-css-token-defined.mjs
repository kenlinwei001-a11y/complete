#!/usr/bin/env node
/**
 * 门 · G-CSS-TOKEN-UNDEFINED —— 前端主题令牌「引用了但从没定义」。
 *
 * ## 病因（2026-08-11 仓主实测报的「这截屏里面的文字显示有问题，黑色的不对」）
 *
 * `InferenceProcessDag.module.css:60` 写的是 `fill: var(--text)`，
 * 而全仓根本没有 `--text` 这个令牌 —— 真名叫 `--txt`（tokens.css:12）。
 *
 * 关键在于**它不会报错，也不会退化成"没上色"**：
 * var() 替换失败 ⇒ 该声明「在计算值时无效」⇒ 属性取 `unset`；
 * 而 `fill` 是**可继承**属性 ⇒ `unset` = `inherit` ⇒ 一路继承到根的初始值 = **纯黑**。
 * 于是深色节点底上叠一层黑字，肉眼全黑，控制台一声不吭，测试全绿。
 *
 * 这是假绿的又一形态：**拼错一个名字，产出的不是「缺省」而是「反向」**。
 * 同批实测还查出 `--fg`（3 处）与 `--border`（10 处）两个同病的幽灵令牌。
 *
 * ## 判据
 *
 * 「被 var() 无兜底引用」∖「有定义」= 必须为空。其中"有定义"包含两个来源：
 *   ① CSS 里 `--foo: …`；
 *   ② TSX 内联样式里运行时注入 `style={{ "--foo": … }}` —— **grep CSS 一次都看不见**，
 *      按 CLAUDE.md 铁律 0.5「必须再追一层」，这类必须去 TSX 里取证，不许当作未定义。
 *
 * 有 fallback 的 `var(--foo, X)` 不计：写了兜底就是有意为之，坏不了。
 *
 * ## 金丝雀（铁律 0.6：必须与主逻辑共用同一份实现，不许各抄一份正则）
 *
 * 下面的 canary 直接调 collectDefined/collectUsed 本体去扫一段合成源码。
 * 主正则改坏时金丝雀跟着坏 —— 这正是要的：抄一份旧正则的金丝雀是装饰品。
 *
 * 退出码：0 = 干净；1 = 有幽灵令牌；2 = 工具自己坏了（不许据此报「干净」）。
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.argv[2] ?? "apps/frontend-shell/src";

/**
 * 先剥注释再扫 —— 否则注释里的散文会被当成代码。
 *
 * 这不是假想：本门第一版就栽在这上面。`ChainImpedimentView.module.css:4` 等 4 个文件的
 * 注释里写着「用到的每个 var(--x) 必须定义在 tokens.css 的 :root」——**那正是本门要执行的纪律本身**，
 * 结果门把散文里的 `--x` / `--token` 当成真引用报了幽灵。
 * 顺带一提：这条纪律以注释形式在仓里躺了很久，仍被违反 14 次 ⇒ **写在注释里的纪律不是机制**。
 */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");

/** CSS 自定义属性的**定义**：`--foo:` 出现在声明位（行首/分号/花括号之后）。 */
const DEF_RE = /(?:^|[;{\s])(--[A-Za-z0-9_-]+)\s*:/g;
/** **无兜底**引用：`var(--foo)`。第 2 组捕到逗号即说明有 fallback，跳过。 */
const USE_RE = /var\(\s*(--[A-Za-z0-9_-]+)\s*(,)?/g;
/** TSX 内联样式里的运行时注入：`"--foo":` / `'--foo':` / `["--foo"]:`。 */
const INJECT_RE = /\[?\s*["'](--[A-Za-z0-9_-]+)["']\s*\]?\s*:/g;

/** @param {Array<[string,string]>} sources [文件名, 源码] */
function collectDefined(sources) {
  const out = new Map();
  for (const [f, raw] of sources) {
    const s = stripComments(raw);
    for (const re of [DEF_RE, INJECT_RE]) {
      re.lastIndex = 0;
      for (const m of s.matchAll(re)) if (!out.has(m[1])) out.set(m[1], f);
    }
  }
  return out;
}

/** @param {Array<[string,string]>} sources */
function collectUsed(sources) {
  const out = new Map();
  for (const [f, raw] of sources) {
    const s = stripComments(raw);
    USE_RE.lastIndex = 0;
    for (const m of s.matchAll(USE_RE)) {
      if (m[2]) continue; // 有 fallback，坏不了
      if (!out.has(m[1])) out.set(m[1], new Set());
      out.get(m[1]).add(f);
    }
  }
  return out;
}

function orphans(sources) {
  const defined = collectDefined(sources);
  const used = collectUsed(sources);
  return [...used].filter(([k]) => !defined.has(k)).map(([k, fs]) => [k, [...fs]]);
}

// ── 金丝雀：拿一段**已知必中**的合成源码过一遍主逻辑 ──────────────────────────
// 三条断言分别咬住三件事：定义认得出、无兜底引用认得出、有兜底的不误报。
// 任何一条不中 ⇒ 报「工具坏了」，绝不报「代码干净」。
{
  const fake = [
    ["canary.css", ":root { --canary-yes: #fff; }\n.a { color: var(--canary-yes); fill: var(--canary-no); }\n.b { color: var(--canary-fb, #000); }"],
    ["canary.tsx", 'const s = { "--canary-injected": "1px" }; // 运行时注入'],
    // 只在注释里出现的令牌 —— 本门第一版正是栽在这里，故常驻金丝雀
    ["canary-comment.css", "/* 纪律：用到的每个 var(--canary-prose) 都要有定义 */\n.c { color: red; }"],
  ];
  const d = collectDefined(fake);
  const o = new Map(orphans(fake));
  const bad = [];
  // 条数**现算**，不写死 —— 写死的诚实位是假绿第 11 形态：加了断言而计数不动，
  // 屏上照旧「5/5 全中」，读者以为覆盖没变。
  let checks = 0;
  const check = (ok, why) => { checks++; if (!ok) bad.push(why); };
  check(d.has("--canary-yes"), "CSS 定义认不出（DEF_RE 坏了）");
  check(d.has("--canary-injected"), "TSX 运行时注入认不出（INJECT_RE 坏了）");
  check(o.has("--canary-no"), "未定义引用抓不到（USE_RE 坏了）");
  check(!o.has("--canary-fb"), "把有 fallback 的误报成幽灵（USE_RE 的兜底分支坏了）");
  check(!o.has("--canary-yes"), "把已定义的误报成幽灵");
  check(!o.has("--canary-prose"), "把**注释里的散文**当成真引用（stripComments 坏了/被摘了）");
  globalThis.__canaryTotal = checks;
  if (bad.length) {
    console.error("⛔ 金丝雀不中 ⇒ **工具坏了**，本次结论作废（不许读作「无幽灵令牌」）：");
    for (const b of bad) console.error("   · " + b);
    process.exit(2);
  }
}

if (!existsSync(ROOT)) {
  console.error(`⛔ 扫描根 ${ROOT} 不存在 —— 工具坏了，不许报「干净」`);
  process.exit(2);
}

const walk = (d) =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : /\.(css|tsx|ts)$/.test(e.name) ? [join(d, e.name)] : [],
  );
const files = walk(ROOT);
if (files.length < 50) {
  console.error(`⛔ 只扫到 ${files.length} 个源文件，远低于预期 ⇒ 扫描器坏了或扫错了目录`);
  process.exit(2);
}
const sources = files.map((f) => [f, readFileSync(f, "utf8")]);

const defined = collectDefined(sources);
const found = orphans(sources);

console.log(`扫描 ${files.length} 个源文件 · 已定义令牌 ${defined.size} 个 · 金丝雀 ${globalThis.__canaryTotal}/${globalThis.__canaryTotal} 命中`);

if (found.length === 0) {
  console.log("✅ 无幽灵令牌：每个无兜底的 var(--x) 都能找到定义处");
  process.exit(0);
}

console.error(`\n🔴 ${found.length} 个**幽灵令牌**：被 var() 无兜底引用，却全仓无定义。`);
console.error("   后果不是「没上色」而是「取继承值」——可继承属性（color/fill）会一路继承到黑。\n");
for (const [tok, fs] of found) {
  const near = [...defined.keys()].filter((d) => d.includes(tok.slice(2, 5)) || tok.includes(d.slice(2, 5)));
  console.error(`   ${tok}${near.length ? `   （疑似想写：${near.slice(0, 4).join(" / ")}）` : ""}`);
  for (const f of fs) console.error(`      ← ${f}`);
}
console.error("\n   修：改成真令牌名，或显式写 fallback `var(--x, <具体色值>)` 表明是有意为之。");
process.exit(1);
