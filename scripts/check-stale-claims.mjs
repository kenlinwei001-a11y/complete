#!/usr/bin/env node
/**
 * 过期「自称实测」声明门 —— 本体 §8 `G-STALE-MEASURED-CLAIM` 的机械那一半。
 *
 * ── 存在理由（一族真实病灶，不是假想）────────────────────────────────────────
 * 2026-08-08 一天之内在本仓实测到 **6 例**同一个病：**过期声明自称「运行态实测」**。
 * 最毒的一例在 `apps/frontend-shell/src/views/sim/inspectorModel.ts`：屏上写着
 * 「`Cadence` 对象全仓 0 条（**运行态实测** `GET /a/v1/objects?type=Cadence` → total 0）」，
 * 而当天 `apps/datacore/src/synthetic/service.ts` 已经在 `putAll("Cadence", …)` 真落库、
 * `app.ts` 的推演 tick 已经在读它。**「自称实测」把可疑度压到最低**，因此比普通过期注释更能骗过复审——
 * 复审看见"运行态实测"四个字就默认这是查过的，于是不再追一层。
 *
 * 病的机理是**保质期**：实测的保质期等于做实测的那一天。一句没有日期、没有复验方式的
 * "实测 X 是 0"，写下的当天是真的，上游一补齐就变成屏上说谎，而且没有任何人会被通知。
 *
 * ── 本门的三层判据 ──────────────────────────────────────────────────────────
 *  ① `STALE-1 · 无实测日期`   —— 声明式地使用了「实测/实跑/运行态/现算」却没写下**哪天测的**。
 *                                 没有日期 = 没有保质期 = 永远没人知道它该复验了。
 *  ② `STALE-2 · 无复验方式`   —— 没有端点 / 命令 / `file:line` 锚点，复审无从"亲手跑一遍"
 *                                 （CLAUDE.md 铁律 0.5 第 4 条：「我 grep 了」不是复验）。
 *  ③ `STALE-3/4 · 事实当场读回` —— 声明里若引用了**机器可复验的事实**
 *                                 （「某对象类型 0 条 / 无承载」「某符号零消费方」），
 *                                 本门**当场把那个事实读回来核**：
 *                                   · 对象类型 → 查 `apps/datacore/src/synthetic/service.ts` 的 `putAll("<Type>"` 清单；
 *                                   · 符号     → 在 `apps/<app>/src` `packages/<pkg>/src` 下真数非声明处的引用。
 *                                 **上游一补齐，声明当场红** —— 这一层才是治本的，前两层只是逼人留下保质期。
 *
 * ── 为什么不是「凡出现这四个字就要日期」──────────────────────────────────────
 * 因为「实测」在本仓还是**词汇**：`provenance.kind === "实测"` 的徽章、`<dt>实测值 vs 阈值</dt>`、
 * 「合成·未接实测」的诚实灰标。对这些要求日期是纯噪声，只会训练出一张几百条的白名单，
 * 白名单一大就没人看，门就死了。故本门只咬**声明式用法** = 关键词 + 同一声明单元内出现
 * **可被证伪的观测结果**（数字+量词 / `0 命中` / `零消费方` / 端点回值 / `grep` 计数）。
 * 这是本门自觉的**边界**，见文件末尾《做不到的部分》。
 *
 * ── 金丝雀（门自己会瞎）────────────────────────────────────────────────────
 * 本会话实测过两个"工具骗人"的陷阱：`git grep -- "apps/<星>/src"` 恒 0 命中（⚠️ 病因**不是**
 * "pathspec 的通配符不跨 `/`"——那是 2026-08-11 已被实测推翻的错病因，`*` 确实跨 `/`；
 * 真因是**含通配的 pathspec 不当目录前缀用**，须补一段成 `apps/<星>/src/<星>`。
 * 详见 CLAUDE.md 铁律 0.5 判据 #5 的订正段）；
 * 正则 `BUILTIN_VIEWS[^=]*=` 被 `_RENAMED: BuiltInView[] ` 吞掉。两者的共同后果都是
 * **门报绿，而它其实一个字都没扫到**。故本门开跑前先跑 `selftest()`：
 * 拿内嵌的必咬样例过一遍检测器，任一条没被咬 ⇒ 打印「⛔ 门自己瞎了」并 exit 1，
 * 而不是安安静静报「代码干净」。扫描规模（文件数/命中数）也设下限，扫空即红。
 *
 * 用法：
 *   node scripts/check-stale-claims.mjs             # 门（CI/gate.sh 用）
 *   node scripts/check-stale-claims.mjs --list      # 列出全部现存违规（写基线用）
 *   node scripts/check-stale-claims.mjs --selftest  # 只跑金丝雀
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
  console.error(`⛔ check-stale-claims.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_ROOT = "apps/frontend-shell/src";
const BASELINE_PATH = "scripts/stale-claim-baseline.json";

// ══════════════════════════════════════════════════════════════════════════════
// § 1 · 词法：什么算「声明式使用」
// ══════════════════════════════════════════════════════════════════════════════

/** 触发词。出现即进入审查（但是否算声明，还要看 §1.2 的观测结果标记）。 */
const CLAIM_KEYWORDS = ["实测", "实跑", "运行态", "现算"];

/**
 * **观测结果标记** —— 有它才算「声明」，没它只是把「实测」当词用。
 * 判据是「这句话可不可能被证伪」：一个数、一个命中计数、一个端点回值，都能被后来的事实推翻；
 * 一个徽章标签不能。
 */
const MEASURED_RESULT_PATTERNS = [
  /\d+\s*(条|行|格|命中|个|次|台|组|页|字节|KB|MB|ms|px|天|%)/,
  /0\s*命中|零\s*命中|零消费方|零调用方|零生产调用方|零直接消费方|零运行时消费方/,
  /total\s*[=＝:：]?\s*\d|→\s*total/,
  /\bGET\s+\/|\bPOST\s+\/|\/a\/v1|\/b\/v1|\/api\/v1/,
  /grep/,
];

/** ① 实测日期：ISO 或中文年月日。**年月即可**——精确到天最好，但月份也构成保质期。 */
const DATE_PATTERNS = [/\b20\d{2}-\d{2}-\d{2}\b/, /\b20\d{2}-\d{2}\b/, /20\d{2}\s*年\s*\d{1,2}\s*月/];

/** ② 复验方式：端点 / 命令 / 文件锚点。任一即可——目的是让复审能**亲手跑一遍**。 */
const HOWTO_PATTERNS = [
  /[\w./@-]+\.(ts|tsx|mjs|js|sql|json|md|yml|yaml)(:\d+)?/, // 文件锚点（带不带行号都算）
  /\/a\/v1|\/b\/v1|\/api\/v1/, // 端点
  /\bgrep\b|\bpnpm\b|\bnode\s+scripts\/|\bcurl\b|\bgit\s+grep\b/, // 命令
];

// ══════════════════════════════════════════════════════════════════════════════
// § 2 · 声明单元 —— 判据挂在「单元」上，不是「行」上
// ══════════════════════════════════════════════════════════════════════════════
//
// 单元 = 该断言所在的**最小完整表述**，三种形态：
//   (a) 块注释 `/* … */`      → 整块；
//   (b) 连续 `//` 行注释段     → 整段；
//   (c) 代码（多为拼接字符串） → 按**续行**上下扩张：行尾是 `+ ( , : [ {` 等续行符则继续，
//                               遇到以 `,` `;` `{` `}` 收尾的行即封口。
// 为何不用固定行窗：日期与锚点常写在同一条 evidence 的**另一行**上，固定窗要么切断要么串味；
// 按续行扩张才让「一条 evidence」= 「一条声明」。

/** 标出每一行是否落在块注释内，并给出所属块的 [start, end]。 */
function blockCommentRanges(lines) {
  const owner = new Array(lines.length).fill(null);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (start === -1) {
      const open = l.indexOf("/*");
      if (open !== -1 && l.indexOf("*/", open + 2) === -1) start = i;
      else if (open !== -1) owner[i] = [i, i]; // 单行 /* … */
    }
    if (start !== -1) {
      if (l.includes("*/") && !(l.indexOf("/*") !== -1 && l.indexOf("/*") === l.lastIndexOf("/*") && start === i && l.indexOf("*/") < l.indexOf("/*"))) {
        if (i > start || l.indexOf("*/") > l.indexOf("/*")) {
          for (let k = start; k <= i; k++) owner[k] = [start, i];
          start = -1;
        }
      } else {
        owner[i] = [start, -1]; // 暂记，闭合时回填
      }
    }
  }
  if (start !== -1) for (let k = start; k < lines.length; k++) owner[k] = [start, lines.length - 1];
  // 回填未闭合标记
  for (let i = 0; i < owner.length; i++) if (owner[i] && owner[i][1] === -1) owner[i] = null;
  return owner;
}

const isLineComment = (s) => /^\s*(\/\/|\*)/.test(s);
/**
 * 续行符收尾 ⇒ 下一行仍属同一条声明。
 *
 * ⚠ **`,` 刻意不在这张表里**（第一版栽在这儿）：对象字面量里每个属性都以 `,` 收尾，
 *   把 `,` 当续行符 ⇒ 从 `evidence:` 一路吞到相邻的兄弟属性、再吞下一个变量对象，
 *   于是「K1 的日期」会被算成「K2 也有日期」——**漏报**。`,` 是属性收口，不是续行。
 */
const continuesDown = (s) => /[+({[:=?&|]\s*$/.test(s.replace(/\s+$/, ""));
/** 语句/属性收口。 */
const closesUnit = (s) => /[;}]\s*$/.test(s.trim()) || /^\s*$/.test(s);

function unitRange(lines, hit, blockOwner) {
  if (blockOwner[hit]) return blockOwner[hit];
  if (isLineComment(lines[hit])) {
    let a = hit;
    let b = hit;
    while (a > 0 && isLineComment(lines[a - 1])) a--;
    while (b < lines.length - 1 && isLineComment(lines[b + 1])) b++;
    return [a, b];
  }
  let a = hit;
  let b = hit;
  // 向上：只要**上一行**是续行状态（以续行符收尾）就并进来
  while (a > 0 && continuesDown(lines[a - 1]) && !blockOwner[a - 1] && !isLineComment(lines[a - 1])) a--;
  // 向下：只要**本行**以续行符收尾就并下一行
  while (b < lines.length - 1 && continuesDown(lines[b]) && !closesUnit(lines[b])) b++;
  return [a, b];
}

// ══════════════════════════════════════════════════════════════════════════════
// § 3 · 事实当场读回（治本的那一层）
// ══════════════════════════════════════════════════════════════════════════════

/** `apps/datacore/src/synthetic/service.ts` 的 `putAll("<Type>"` 清单 = 「这个对象类型今天有承载」的单一事实源。 */
function loadMaterializedTypes(root) {
  const p = join(root, "apps/datacore/src/synthetic/service.ts");
  if (!existsSync(p)) return null; // 上游文件没了：不静默放行，交给调用方判红
  const src = readFileSync(p, "utf8");
  const types = new Set();
  for (const m of src.matchAll(/putAll\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g)) types.add(m[1]);
  return types;
}

/**
 * 声明里「某对象类型没有承载」的说法。
 * 只咬**否定承载**的措辞——「Cadence 已落库」这类肯定句不该被这一层碰。
 */
const ABSENCE_ASSERTIONS = [
  /`?([A-Z][A-Za-z0-9_]{2,})`?\s*(?:对象)?\s*(?:全仓\s*)?0\s*条/g,
  /`?([A-Z][A-Za-z0-9_]{2,})`?\s*(?:对象)?\s*(?:全仓\s*)?(?:0|零)\s*命中/g,
  /(?:无|没有|不存在)\s*`?([A-Z][A-Za-z0-9_]{2,})`?\s*(?:对象|实例|承载|行)/g,
  /`?([A-Z][A-Za-z0-9_]{2,})`?\s*(?:对象类型)?\s*尚?不存在/g,
];

/**
 * 声明里「某符号零消费方」的说法。
 *
 * ⚠ 主语必须**认得出来才判**（第一版栽在这儿）：原先用「关键词前 24 字内的任意标识符」当主语，
 *   于是 "`apps/datacore/src/solvers/` **零直接消费方**" 里被抠出 `datacore` 当符号去数引用，
 *   数到 21 处 ⇒ 三条**误报**。真相是那句话的主语是 `transitDays`，`apps/datacore/src/solvers/`
 *   只是**作用域**。故：主语只认反引号里的**非路径标识符**（不含 `/`、不含空格）；
 *   认不出主语就**什么都不说** —— 宁可漏，不可诬。
 */
const DEAD_CLAIM_RE = /(?:零|0)\s*(?:直接|生产|运行时)?\s*(?:消费方|调用方)/g;
const SYMBOLISH = /^[A-Za-z_][A-Za-z0-9_.]{3,}$/;

/** 行级触发器：这一行看着像在断言「某某没有/是 0」⇒ 值得把它所在的声明单元拿去核事实。 */
const FACT_CLAIM_TRIGGER = /(?:0\s*条|0\s*命中|零\s*命中|零\s*(?:直接|生产|运行时)?\s*(?:消费方|调用方)|(?:无|没有|不存在)\s*`?[A-Z][A-Za-z0-9_]{2,}`?\s*(?:对象|实例|承载|行)|尚?不存在)/;

/**
 * 从「零消费方」这句话里认主语：先看左窗最近的反引号标识符，再看右窗最近的。
 *
 * ⚠ **作用域限定的声明一律跳过**（第二版栽在这儿）：
 *   "…`etaDay` 派生管线消费），但 `apps/datacore/src/solvers/` **零直接消费方**…"
 *   这句的主语是更前面的 `transitDays`、作用域是 `solvers/`，而左窗最近的合法标识符是 `etaDay`
 *   ⇒ 抓错主语、全仓计数 12 处 ⇒ 又一条**误报**。这类"某目录下零消费方"的声明，
 *   主语与作用域都要认对才能复验，本门认不准 ⇒ **不判**（它仍会被 STALE-1/2 咬到日期与复验方式）。
 */
function subjectsOfDeadClaims(text) {
  const found = new Set();
  for (const m of text.matchAll(DEAD_CLAIM_RE)) {
    const i = m.index ?? 0;
    // ⚠ **主语必须与断言同行**（第三版栽在这儿）：
    //   跨行取主语时，`* 每一种都必须配 \`inertReason\`：` 的下一行 `（零消费方 / 换算缺承载）`
    //   ——那是一句**分类标签**，根本不是在说 `inertReason` 没人用 —— 也被当成声明去数引用 ⇒ 误报。
    //   同行取到的最后一个反引号标识符 = 主语；同行取不到就**不判**（宁可漏，不可诬）。
    //   刻意不用"前 N 字"这种窗：窗宽一改结论就变，等于把判据交给运气。
    const lineStart = text.lastIndexOf("\n", i) + 1;
    const lineEndRaw = text.indexOf("\n", i);
    const lineEnd = lineEndRaw === -1 ? text.length : lineEndRaw;
    const before = text.slice(lineStart, i);
    const after = text.slice(i + m[0].length, lineEnd);
    // 作用域限定（左窗近处出现路径）⇒ 主语与作用域都认不准，跳过
    if (/`[^`\n]*\/[^`\n]*`\s*\*{0,2}\s*$/.test(before.slice(-45))) continue;
    const pick = (win, last) => {
      const toks = [...win.matchAll(/`([^`\n]+)`/g)].map((x) => x[1].trim()).filter((t) => SYMBOLISH.test(t));
      return toks.length === 0 ? null : last ? toks[toks.length - 1] : toks[0];
    };
    const s = pick(before, true) ?? pick(after, false);
    if (s !== null) found.add(s);
  }
  return found;
}

/** 在每个 `apps/<app>/src` 与 `packages/<pkg>/src` 下真数引用（排除声明所在文件与 test）。 */
function countSrcReferences(root, symbol, excludeFile) {
  const roots = [];
  for (const group of ["apps", "packages"]) {
    const g = join(root, group);
    if (!existsSync(g)) continue;
    for (const pkg of readdirSync(g)) {
      const s = join(g, pkg, "src");
      if (existsSync(s) && statSync(s).isDirectory()) roots.push(s);
    }
  }
  let n = 0;
  const hits = [];
  for (const r of roots) {
    for (const f of walk(r)) {
      const rel = relative(root, f);
      if (rel === excludeFile) continue;
      if (/\.(test|spec)\.[jt]sx?$/.test(f)) continue;
      const src = readFileSync(f, "utf8");
      // 只数**代码**里的引用：剥掉注释与中文串里的提及，否则"注释里提了一嘴"会被当成消费方
      const code = stripCommentsAndCjkStrings(src);
      if (code.includes(symbol)) {
        n += 1;
        hits.push(rel);
      }
    }
  }
  return { n, hits };
}

function stripCommentsAndCjkStrings(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ")
    .replace(/"[^"\n]*[一-鿿][^"\n]*"/g, '""')
    .replace(/'[^'\n]*[一-鿿][^'\n]*'/g, "''");
}

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(e.name)) yield p;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// § 4 · 检测器（**纯函数** —— 金丝雀就靠它能被单独喂样例）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * @param {string} text  一个声明单元的原文
 * @param {{ materializedTypes: Set<string>|null, refCounter: (sym:string)=>{n:number,hits:string[]} }} facts
 * @returns {{code:string, detail:string}[]}
 */
export function judgeUnit(text, facts) {
  const out = [];

  // ── ①② 保质期两问：只对**声明式**用法发问（把"实测"当词用的不问）────────────
  const declarative = CLAIM_KEYWORDS.some((k) => text.includes(k)) && MEASURED_RESULT_PATTERNS.some((re) => re.test(text));
  if (declarative) {
    if (!DATE_PATTERNS.some((re) => re.test(text))) {
      out.push({ code: "STALE-1", detail: "自称实测/实跑/运行态却没写**哪天测的** —— 没有日期就没有保质期，上游一变没人知道该复验" });
    }
    if (!HOWTO_PATTERNS.some((re) => re.test(text))) {
      out.push({ code: "STALE-2", detail: "没有可复验方式（端点 / 命令 / file:line 锚点）—— 复审无法亲手跑一遍，只能选择相信" });
    }
  }

  // ── ③ 事实当场读回：**不挂在关键词上** ──────────────────────────────────────
  //
  // 刻意与 ①② 解耦。本单三处病灶里的第 ② 处（K2 「同上无 `Cadence` 实例；且全仓零运行时消费方」）
  // **一个「实测」字都没有**，却同样是假话 —— 若把事实层也挂在关键词上，它就从门下溜过去了。
  // 「这句话能不能被机器证伪」与「作者有没有自称实测」是两件事：能证伪的就当场证。
  if (facts.materializedTypes !== null) {
    const claimed = new Set();
    for (const re of ABSENCE_ASSERTIONS) for (const m of text.matchAll(re)) claimed.add(m[1]);
    for (const t of claimed) {
      if (facts.materializedTypes.has(t)) {
        out.push({
          code: "STALE-3",
          detail: `声明「${t} 无承载 / 0 条」，但 apps/datacore/src/synthetic/service.ts 今天有 putAll("${t}", …) —— 上游已补齐，这句话已经是假的`,
        });
      }
    }
  }
  for (const s of subjectsOfDeadClaims(text)) {
    const { n, hits } = facts.refCounter(s);
    if (n > 0) {
      out.push({
        code: "STALE-4",
        detail: `声明「${s} 零消费方」，但 src 下实有 ${n} 处引用（${hits.slice(0, 3).join(" · ")}${hits.length > 3 ? " …" : ""}）—— 这句话已经是假的`,
      });
    }
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════════
// § 5 · 金丝雀 —— 门自己得先被咬一口
// ══════════════════════════════════════════════════════════════════════════════

/** 必咬样例（每条都对应一个真实病灶形态）。任一条没被咬 ⇒ 门瞎了。 */
const MUST_BITE = [
  {
    name: "自称实测但没日期",
    text: '"公式有但值缺：`Cadence` 对象全仓 0 条（运行态实测 `GET /a/v1/objects?type=Cadence` → total 0）"',
    expect: "STALE-1",
  },
  {
    name: "自称实测但没复验方式",
    text: '"实测 130 行，够用且留余量（2026-08-08）"',
    expect: "STALE-2",
  },
  {
    name: "声称某对象类型 0 条，而它其实在册",
    text: '"2026-08-08 运行态实测 `GET /a/v1/objects?type=Cadence` → Cadence 对象全仓 0 条"',
    expect: "STALE-3",
  },
  {
    name: "声称某符号零消费方，而它其实有生产调用方",
    text: '"`buildCadenceGates` 全仓零运行时消费方（2026-08-08 实测 grep 计数 0，见 apps/datacore/src/sim/propagation.ts:120）"',
    expect: "STALE-4",
  },
  {
    // 本单病灶 ②：**一个「实测」字都没有**的假话。若事实层挂在关键词上，这条就溜过去了。
    name: "不含任何触发词、但事实已被上游推翻",
    text: '"`Cadence.offsetDays` · chain-sim.ts:73（契约字段在），但同上无 `Cadence` 实例"',
    expect: "STALE-3",
  },
];

/** 必**不**咬样例（把「实测」当词用的，咬了就是噪声门）。 */
const MUST_NOT_BITE = [
  { name: "provenance 徽章标签", text: 'const PROV_KIND_COLOR = { 实测: "#62BE77", 派生: "#4C90F0" };' },
  { name: "屏上字段名", text: "<dt>实测值 vs 阈值</dt>" },
  { name: "诚实灰标", text: '<span>合成·未接实测</span>' },
];

function selftest(facts, scanStats) {
  const blind = [];
  for (const c of MUST_BITE) {
    const codes = judgeUnit(c.text, facts).map((v) => v.code);
    if (!codes.includes(c.expect)) blind.push(`必咬样例「${c.name}」没被咬（期望 ${c.expect}，实得 ${codes.join(",") || "无"}）`);
  }
  for (const c of MUST_NOT_BITE) {
    const codes = judgeUnit(c.text, facts).map((v) => v.code);
    if (codes.length > 0) blind.push(`必不咬样例「${c.name}」被误咬（${codes.join(",")}）`);
  }
  // 扫描规模下限：防「工具报 0 命中而其实一个文件都没读到」（本会话真踩过的 pathspec 陷阱同源）
  if (scanStats !== null) {
    if (scanStats.files < 50) blind.push(`只扫到 ${scanStats.files} 个源文件（<50）—— 扫描根 ${SCAN_ROOT} 是不是没读到？`);
    if (scanStats.keywordHits < 20) blind.push(`只扫到 ${scanStats.keywordHits} 处关键词（<20）—— 正则或编码坏了，不是代码干净了`);
  }
  if (facts.materializedTypes === null || facts.materializedTypes.size < 20) {
    blind.push(`putAll 事实源读不出（读到 ${facts.materializedTypes?.size ?? "null"} 个类型）—— STALE-3 这一层等于没开`);
  }
  return blind;
}

// ══════════════════════════════════════════════════════════════════════════════
// § 6 · 主流程
// ══════════════════════════════════════════════════════════════════════════════

const unitKey = (file, text) => `${file}#${createHash("sha256").update(text.trim()).digest("hex").slice(0, 16)}`;

function scan(root, facts) {
  const violations = [];
  let files = 0;
  let keywordHits = 0;
  const scanDir = join(root, SCAN_ROOT);
  if (!existsSync(scanDir)) return { violations, files, keywordHits, missing: true };
  for (const f of walk(scanDir)) {
    files += 1;
    const rel = relative(root, f);
    const src = readFileSync(f, "utf8");
    const lines = src.split("\n");
    const owner = blockCommentRanges(lines);
    const seen = new Set();
    for (let i = 0; i < lines.length; i++) {
      const kw = CLAIM_KEYWORDS.some((k) => lines[i].includes(k));
      // 触发两路：① 自称实测的关键词；② **可机器证伪的事实断言**（不必自称实测 —— 病灶 ② 就是这一路）
      if (!kw && !FACT_CLAIM_TRIGGER.test(lines[i])) continue;
      if (kw) keywordHits += 1;
      const [a, b] = unitRange(lines, i, owner);
      const rk = `${a}:${b}`;
      if (seen.has(rk)) continue;
      seen.add(rk);
      const text = lines.slice(a, b + 1).join("\n");
      for (const v of judgeUnit(text, { ...facts, excludeFile: rel })) {
        violations.push({ file: rel, line: a + 1, endLine: b + 1, code: v.code, detail: v.detail, key: unitKey(rel, text), sample: firstClaimLine(lines.slice(a, b + 1)) });
      }
    }
  }
  return { violations, files, keywordHits, missing: false };
}

function firstClaimLine(unitLines) {
  const l = unitLines.find((x) => CLAIM_KEYWORDS.some((k) => x.includes(k))) ?? unitLines[0] ?? "";
  const t = l.trim();
  return t.length > 120 ? `${t.slice(0, 120)}…` : t;
}

function main() {
  const argv = process.argv.slice(2);
  const materializedTypes = loadMaterializedTypes(REPO_ROOT);
  const refCache = new Map();
  const facts = {
    materializedTypes,
    refCounter: (sym) => {
      if (!refCache.has(sym)) refCache.set(sym, countSrcReferences(REPO_ROOT, sym, null));
      return refCache.get(sym);
    },
  };

  const res = argv.includes("--selftest") ? { violations: [], files: 999, keywordHits: 999, missing: false } : scan(REPO_ROOT, facts);
  if (res.missing) {
    console.error(`⛔ 门自己瞎了：扫描根 ${SCAN_ROOT} 不存在 —— 这不是"代码干净"，是门没扫到东西。`);
    process.exit(1);
  }

  const blind = selftest(facts, argv.includes("--selftest") ? null : res);
  if (blind.length > 0) {
    console.error("⛔ 门自己瞎了（金丝雀未被咬 / 扫描规模异常）—— **不是代码干净**：");
    for (const b of blind) console.error(`   · ${b}`);
    console.error("   修门，别改结论。");
    process.exit(1);
  }
  if (argv.includes("--selftest")) {
    console.log(`✅ 金丝雀：${MUST_BITE.length} 条必咬全部咬中，${MUST_NOT_BITE.length} 条必不咬全部放过，putAll 事实源 ${materializedTypes.size} 个类型`);
    return;
  }

  if (argv.includes("--list")) {
    console.log(JSON.stringify({ generated: new Date().toISOString().slice(0, 10), count: res.violations.length, violations: res.violations }, null, 2));
    return;
  }

  // ── 棘轮 ──────────────────────────────────────────────────────────────────
  const baseline = JSON.parse(readFileSync(join(REPO_ROOT, BASELINE_PATH), "utf8"));
  const allowed = new Map(baseline.exemptions.map((e) => [e.key, e]));
  const fresh = res.violations.filter((v) => !allowed.has(v.key));
  const usedKeys = new Set(res.violations.map((v) => v.key));
  const stale = baseline.exemptions.filter((e) => !usedKeys.has(e.key));

  console.log(`扫描：${res.files} 个源文件 · ${res.keywordHits} 处关键词命中 · ${res.violations.length} 条声明违规 · 豁免 ${baseline.exemptions.length} 条（上限 ${baseline.maxExemptions}）`);

  let bad = false;
  if (fresh.length > 0) {
    bad = true;
    console.error(`\n❌ 新增「自称实测」声明违规 ${fresh.length} 条：`);
    for (const v of fresh) {
      console.error(`   ${v.file}:${v.line}-${v.endLine}  [${v.code}]`);
      console.error(`      ${v.detail}`);
      console.error(`      原文：${v.sample}`);
    }
    console.error("\n   修法：① 补上实测日期（YYYY-MM-DD）；② 补上复验方式（端点 / 命令 / file:line）；");
    console.error("         ③ 若是 STALE-3/4：上游已经补齐了，**把话改对**，不要加豁免。");
  }
  if (stale.length > 0) {
    bad = true;
    console.error(`\n❌ 棘轮回弹：${stale.length} 条豁免已经匹配不到任何声明（文案改过了？）—— 请从 ${BASELINE_PATH} 删掉，让上限跟着降：`);
    for (const e of stale) console.error(`   ${e.key}  —— ${e.why}`);
  }
  // ── 棘轮三条（都写在 baseline 的 note 里）───────────────────────────────────
  if (baseline.exemptions.length !== baseline.maxExemptions) {
    bad = true;
    console.error(
      `\n❌ 棘轮失守：maxExemptions=${baseline.maxExemptions} 与实际豁免数 ${baseline.exemptions.length} 不等。` +
        `\n   这个数必须**恒等于**豁免条数 —— 加一条豁免就得同时改这个数，让它在 diff 里躲不掉。`,
    );
  }
  if (baseline.exemptions.length > baseline.ratchetHigh) {
    bad = true;
    console.error(
      `\n❌ 棘轮回升：豁免数 ${baseline.exemptions.length} 超过历史最高水位 ratchetHigh=${baseline.ratchetHigh}。` +
        `\n   ratchetHigh **只降不升**。评审唯一必须拒绝的一行，就是把它调大。`,
    );
  }
  const noReason = baseline.exemptions.filter((e) => typeof e.why !== "string" || e.why.trim().length < 10);
  if (noReason.length > 0) {
    bad = true;
    console.error(`\n❌ ${noReason.length} 条豁免没写理由（why < 10 字）—— 无理由白名单本身就是本门要治的病。`);
    for (const e of noReason) console.error(`   ${e.key}`);
  }

  if (bad) {
    console.error("\n❌ stale-claims:check 未通过");
    process.exit(1);
  }
  console.log(`✅ stale-claims:check 通过（金丝雀 ${MUST_BITE.length}+${MUST_NOT_BITE.length} 条全中 · 无新增声明违规 · 豁免棘轮 ${baseline.exemptions.length}/${baseline.maxExemptions}）`);
}

if (process.argv[1] && process.argv[1].endsWith("check-stale-claims.mjs")) main();

/**
 * ── 《本门做不到的部分》（诚实边界，不圆场）──────────────────────────────────
 * 1. **只认四个触发词**。一句「我查过了，Cadence 一条都没有」不含「实测/实跑/运行态/现算」，
 *    本门一个字都看不见。治的是「自称实测」这一族，不是全部过期声明。
 * 2. **只扫 `apps/frontend-shell/src`**。同族病灶在 `docs/` 与后端注释里同样存在
 *    （`docs/AUDIT-zombie-and-orphan-code.md` 另记 3 条），本门不碰。
 * 3. **日期只验"有没有"，不验"对不对"**。写 `2026-08-08` 而实际是三个月前测的，本门看不出来；
 *    它逼出的是**保质期**，不是真实性。真实性靠 STALE-3/4 那一层的事实读回，而那一层
 *    只覆盖两类可机器复验的事实（对象类型承载 / 符号消费方）。
 * 4. **STALE-4 的引用计数是"文件级 + 剥注释"的近似**：同名子串会误计（如 `Base` 之于 `BaseX`），
 *    故 `DEAD_SYMBOL_ASSERTIONS` 只抓 ≥4 字符的标识符；间接调用（字符串键分发 / 依赖注入 /
 *    事件订阅）本门同样看不见 —— 它只能证伪「零消费方」，不能证实「真的零消费方」。
 * 5. **声明单元靠续行符切分**，是启发式：单元切大了会把邻居的日期算成自己的（漏报），
 *    切小了会把同一条声明劈成两半（误报）。故金丝雀里必咬样例是**整段原文**喂进来的，
 *    保证判据本身对；切分错只影响个别条目，不影响判据。
 */
