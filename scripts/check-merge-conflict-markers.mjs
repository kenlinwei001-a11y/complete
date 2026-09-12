#!/usr/bin/env node
/**
 * 门 `merge-markers:check` · **合并冲突标记不许进正线**
 *
 * ══ 守的命题 ═══════════════════════════════════════════════════════════════════
 * **`<<<<<<<` / `=======` / `>>>>>>>` 这三种行首标记，一条都不许出现在被跟踪的文件里。**
 *
 * ══ 来历（2026-08-17 实测·这道门是被真事故逼出来的）═══════════════════════════
 * canonical `d9d71faa` 上有**两个文件**带着未解决的冲突标记，而且已经在正线上活了多轮：
 *   · `docs/SYSTEM-ONTOLOGY.md`  —— 行 1 `<<<<<<< HEAD`，行 2253/2254 收尾（theirs 侧是空的）
 *   · `docs/PRD-harness-ux-adoption.md` —— 两处，其中一处把判据表**从中间截断**
 * 后果不是"难看"，是**结论被改写**：
 *   ① 本体（铁律 0 指定的接线单一来源）**首行就是一行标记**，任何按标题解析它的工具都从第一行开始就错位；
 *   ② 判据表被 `<<<<<<< ours` 拦腰截断 ⇒ **任何按「行首是 `|` 就继续读」的解析器只读到 4 行**，
 *      12 页的表报成 4 页 40 格。同一份文件里还并排躺着**三行互相矛盾的「合计」**
 *      （68/45/0/7 · 62/50/0/8 · 70/43/0/7），没有一行等于逐格现算的 80/32/8/0。
 *
 * **为什么四包 gate、61 道门、`pnpm -r build`、`pnpm -r test` 全绿却没人吭声**：
 *   · 它们在 `.md` 上一个字都不看；
 *   · 唯一读这两份文档的 `sim-ux-criteria:check` 用的是"扫全文所有 `|` 开头的行"的宽松解析，
 *     **恰好跨过了标记**，所以它算出的 80 是对的 —— 但它对"表被截断"这件事**免疫**，
 *     于是这个信号既没红、也没能力红。
 * 形态（铁律 0.6）：**「我用『四包 gate 全绿』当作『文件内容完整』的证据，而前者并不度量后者。」**
 *
 * ══ 为什么判据落在行首 ═══════════════════════════════════════════════════════
 * git 写出的冲突标记**一律顶格**。而文档里正当地"谈论"这些标记时，
 * 它们要么在反引号里、要么被缩进（如引用块 `> `）—— 两种都不在行首。
 * 这条区分让本门可以做到**零白名单**：白名单迟早被例外吃光，而行首规则对新文件照样生效。
 * `=======` 另有一个真实的良性形态：markdown 的 setext 二级标题下划线。故它**只在
 * 同一文件里已经出现过 `<<<<<<<` 时才算数** —— 单独一行等号不构成冲突。
 *
 * ══ 诚实边界（本门做不到什么，不许当成"合并没出错"）═══════════════════════════
 *  · **只查标记，不查内容对不对。** 逐块取 theirs 把别人的函数定义删掉、并集造出重复键、
 *    合并时丢掉整节 —— 这些**合并事故本门一个都看不见**，它们不留标记。
 *  · **只查被 git 跟踪的文本文件**（`git ls-files`）。未跟踪文件、二进制、submodule 不看。
 *  报"0 命中"时必须连同这两条一起报 —— **「我没找到」和「它不存在」是两个命题。**
 *
 * ══ 金丝雀 ════════════════════════════════════════════════════════════════════
 * 与主逻辑**共用同一份 `analyze()`**，不另抄正则（抄一份 = 装饰品：改主正则时金丝雀
 * 拿旧的去测、照样绿。本仓 2026-08-08 实测过）。含「必咬」与「必不咬」两侧。
 * ⚠ 金丝雀样例里的标记**用字符拼出来**，不写成字面量 —— 写成字面量它们就会在本文件里
 * 顶格出现，本门会把自己判红（真发生过一次，改法记在这里免得下一个人再踩）。
 * ⚠ 金丝雀只证明**工具没瞎**，不证明**扫描面选对了**：故另有独立口径 `MIN_FILES`
 * 对总数 —— 扫到的文件数低于下限即判"工具坏了"，不许读作"仓库干净"。
 *
 * ══ 退出码 ════════════════════════════════════════════════════════════════════
 *   0 = 干净 · 1 = 真有标记 · 2 = **工具自己坏了**（金丝雀不中 / 扫不到文件 / git 不可用）
 * 与本仓其余门同约定：任何"我没能扫描"一律 RC=2，默认失败方向必须是
 * 「我没查出来」，不是「你的仓库干净」。
 *
 * 用法：
 *   node scripts/check-merge-conflict-markers.mjs            # 门
 *   node scripts/check-merge-conflict-markers.mjs --selftest # 只跑金丝雀
 *   node scripts/check-merge-conflict-markers.mjs --list     # 逐条列出命中
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.cwd();
/** 独立口径下限：本仓被跟踪的文本文件远多于此。扫到的比它少 ⇒ 是我瞎了，不是仓库空了。 */
const MIN_FILES = 300;

function toolBroken(what, hint) {
  console.error(`⛔ ${what} ⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「仓库里没有冲突标记 / 合并干净」——");
  console.error("   本门这次根本没有扫描成功，它什么都没证明。");
  if (hint) console.error(`   ${hint}`);
  process.exit(2);
}

/* ── 判据本体 —— 门 / --list / 金丝雀三者共用这一份 ─────────────────────────── */
const RE_OURS = /^<{7}(\s|$)/;
const RE_THEIRS = /^>{7}(\s|$)/;
const RE_SEP = /^={7}\s*$/;

/**
 * @param {string} src 文件全文
 * @returns {{line:number,kind:string,text:string}[]} 命中（行号从 1 起）
 */
export function analyze(src) {
  const lines = src.split("\n");
  const hits = [];
  let sawOurs = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (RE_OURS.test(l)) { sawOurs = true; hits.push({ line: i + 1, kind: "开始标记", text: l.slice(0, 60) }); }
    else if (RE_THEIRS.test(l)) hits.push({ line: i + 1, kind: "结束标记", text: l.slice(0, 60) });
    // 七个等号单独一行也可能是 markdown 的 setext 标题下划线 ⇒
    // 只有在同一文件里已经见过开始标记时才算冲突分隔符。
    else if (RE_SEP.test(l) && sawOurs) hits.push({ line: i + 1, kind: "分隔符", text: l.slice(0, 60) });
  }
  return hits;
}

/* ── 金丝雀（标记一律拼出来，不写字面量：写了本门会把自己判红）───────────────── */
const LT = "<".repeat(7);
const GT = ">".repeat(7);
const EQ = "=".repeat(7);

const CANARIES = [
  {
    name: "必咬-1 完整的三段冲突（git 真实写法·本次事故的形状）",
    src: ["正文上半", `${LT} ours`, "我这边的行", EQ, "他那边的行", `${GT} origin/claude/handoff-x`, "正文下半"].join("\n"),
    expect: (h) => h.length === 3 && h[0].kind === "开始标记" && h[1].kind === "分隔符" && h[2].kind === "结束标记",
  },
  {
    name: "必咬-2 首行就是标记（本体那份的形状）",
    src: [`${LT} HEAD`, "# 标题", "正文"].join("\n"),
    expect: (h) => h.length === 1 && h[0].line === 1,
  },
  {
    name: "必咬-3 theirs 侧为空的退化形（本体那份的收尾形状）",
    src: [`${LT} HEAD`, "内容", EQ, `${GT} origin/claude/handoff-y`].join("\n"),
    expect: (h) => h.length === 3,
  },
  {
    name: "必不咬-1 反引号里谈论标记（文档正当用法·本门的活路）",
    src: ["> 夹在未解决的 `" + LT + " / " + GT + "` 冲突标记里造成的", "正文"].join("\n"),
    expect: (h) => h.length === 0,
  },
  {
    name: "必不咬-2 缩进/引用块里的标记不算（同上）",
    src: ["    " + LT + " ours", "  " + GT + " theirs", "> " + EQ].join("\n"),
    expect: (h) => h.length === 0,
  },
  {
    name: "必不咬-3 markdown setext 二级标题下划线（无开始标记 ⇒ 不算分隔符）",
    src: ["某某小节", EQ, "正文"].join("\n"),
    expect: (h) => h.length === 0,
  },
  {
    name: "必不咬-4 代码里的位移/比较运算符不误伤",
    src: ["const a = x >> 2;", "if (a <= b) {}", "const s = '===';"].join("\n"),
    expect: (h) => h.length === 0,
  },
];

function runCanaries() {
  const fails = [];
  for (const c of CANARIES) {
    let h;
    try { h = analyze(c.src); } catch (e) { fails.push(`${c.name} —— analyze() 抛异常：${e.message}`); continue; }
    if (!c.expect(h)) fails.push(`${c.name} —— 实测命中 ${h.length} 条：${h.map((x) => `${x.line}:${x.kind}`).join(" / ") || "（无）"}`);
  }
  return fails;
}

/* ── 扫描面：被 git 跟踪的文本文件 ──────────────────────────────────────────── */
const SKIP_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".pdf",
  ".woff", ".woff2", ".ttf", ".eot", ".zip", ".gz", ".tgz", ".lock",
]);

function listFiles() {
  let out;
  try {
    out = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
  } catch (e) {
    toolBroken(`git ls-files 失败：${e.message}`, "本门靠 git 取扫描面；不在 git 仓库里就无法判定。");
  }
  return out.split("\0").filter((p) => {
    if (!p) return false;
    const dot = p.lastIndexOf(".");
    if (dot > 0 && SKIP_EXT.has(p.slice(dot).toLowerCase())) return false;
    return true;
  });
}

/* ── 主流程 ────────────────────────────────────────────────────────────────── */
function main() {
  const argv = process.argv.slice(2);
  const selftest = argv.includes("--selftest");
  const list = argv.includes("--list");

  const canaryFails = runCanaries();
  if (canaryFails.length) {
    console.error("⛔ 金丝雀不中 ⇒ **判据逻辑瞎了**，本次不产出任何结论：");
    for (const f of canaryFails) console.error(`   · ${f}`);
    process.exit(2);
  }
  if (selftest) {
    console.log(`✅ 金丝雀 ${CANARIES.length}/${CANARIES.length} 全中（必咬 3 · 必不咬 4）⇒ 判据逻辑活着。`);
    process.exit(0);
  }

  const files = listFiles();
  if (files.length < MIN_FILES) {
    toolBroken(
      `扫描面只有 ${files.length} 个文件（独立口径下限 ${MIN_FILES}）`,
      "扫到的文件数远低于本仓实际规模 ⇒ 是扫描面塌了，不是仓库干净。先确认 cwd 是仓库根。",
    );
  }

  const hits = [];
  let read = 0;
  for (const rel of files) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) continue; // 已删未提交的条目
    let src;
    try { src = readFileSync(abs, "utf8"); } catch { continue; }
    if (src.includes("\0")) continue; // 二进制
    read++;
    for (const h of analyze(src)) hits.push({ file: rel, ...h });
  }
  if (read < MIN_FILES) {
    toolBroken(`真正读进来的只有 ${read} 个文件（列出 ${files.length}）`, "读文件这一步塌了，结论作废。");
  }

  if (list) {
    for (const h of hits) console.log(`${h.file}:${h.line}  [${h.kind}]  ${h.text}`);
    console.log(`—— 共 ${hits.length} 条 / ${read} 个文件`);
    process.exit(hits.length ? 1 : 0);
  }

  if (hits.length) {
    const byFile = new Map();
    for (const h of hits) byFile.set(h.file, (byFile.get(h.file) || 0) + 1);
    console.error(`❌ merge-markers:check 判负 —— ${hits.length} 条合并冲突标记留在了 ${byFile.size} 个文件里：`);
    for (const [f, n] of [...byFile].sort((a, b) => b[1] - a[1])) console.error(`   · ${f}（${n} 条）`);
    console.error("   逐条位置：node scripts/check-merge-conflict-markers.mjs --list");
    console.error("   ⚠ 这不是「难看」：标记会把文件从中间截断 —— 本仓实测中，一行 `<<<<<<< ours`");
    console.error("     把一张 12 行的判据表在解析器眼里截成 4 行，12 页 120 格报成 4 页 40 格。");
    console.error("   ⚠ 解冲突时**先看两侧到底差什么**再取，不许逐块取 theirs（曾因此删掉别人的函数定义）；");
    console.error("     结构化文件（JSON/YAML）解完必须先解析成功再提交，**顺序不许倒**。");
    process.exit(1);
  }

  console.log(`✅ merge-markers:check 通过 —— ${read} 个被跟踪文本文件，零合并冲突标记。`);
  console.log(`   金丝雀 ${CANARIES.length}/${CANARIES.length} 全中（必咬 3 · 必不咬 4）⇒ 检测逻辑活着；`);
  console.log(`   独立口径：扫描面 ${read} 个文件 ≥ 下限 ${MIN_FILES} ⇒ 扫描面没塌。`);
  console.log("   ⚠ 诚实边界（不许读成「这次合并没出错」）：① 本门**只查标记，不查内容对不对** ——");
  console.log("     逐块取错侧、并集造重复键、合并时丢整节，这些事故不留标记，本门一个都看不见；");
  console.log("     ② 只查 `git ls-files` 里的文本文件（未跟踪 / 二进制 / submodule 不看）。");
  process.exit(0);
}

try {
  main();
} catch (e) {
  toolBroken(`本门自身抛异常：${e && e.stack ? e.stack.split("\n")[0] : e}`);
}
