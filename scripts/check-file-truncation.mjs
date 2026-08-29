#!/usr/bin/env node
/**
 * 门 `file-truncation:check` · **受保护文件不许被一次提交清空/截没**（WO-ONTO-TRUNCATE-GUARD）
 *
 * ══ 守的命题 ═══════════════════════════════════════════════════════════════════
 * 2026-08-17 真事故：提交 `3298add3` 的信息白纸黑字写着「SYSTEM-ONTOLOGY §8 …追加闭合段」，
 * 而它的 diffstat 是 **docs/SYSTEM-ONTOLOGY.md 2127 行删除、0 行新增** —— 整份本体被写成
 * 空 blob（`e69de29b`）。救援合并 `8d70bcdb` 解冲突取 ours 才把文件救回来，那次真做了的
 * 回写一并丢失。形态（铁律 0.6 句式）：
 *   **「我用『提交信息里写了已回写』当作『本体真被回写了』的证据，而前者并不度量后者。」**
 * ⇒ 判据落在**行数比**上，**不落在提交信息说了什么上**。
 *
 * ══ 保护清单（≥ 工单要求的三组，按 numstat 路径现配，不靠「文件现在还在不在」）══════
 *   ① `docs/SYSTEM-ONTOLOGY.md`（精确）
 *   ② `docs/PRD-*.md`
 *   ③ `scripts/*-baseline.json`
 * 按路径模式匹配 ⇒ 被整删的文件（已不在 HEAD）照样被守住。
 *
 * ══ 判据（阈值不是拍的，是扫全历史分布定的）═══════════════════════════════════════
 * 取证（926 个「提交×受保护文件」样本，`/tmp/scan-trunc.mjs` 复算口径）：
 *   删除比分布 p50=0.0016 · p90=0.0197 · p95=0.0612 · p99=0.7247 · max=1.0；
 *   ratio≥0.8 全历史共 9 个样本，逐个数剩余行数后分三类：
 *     · 事故 3298add3：old=2127 → new=0（唯一该咬的）；
 *     · 整文件重写（new≈old，如 old=1140→new=1146）：**合法**，靠「剩余比 ≤ 0.2」排除；
 *     · 小文件合法收紧（old=10→new=1 · old=89→new=6）：**合法**，靠「old ≥ 100」排除。
 * ⇒ 双阈值：**old_lines ≥ 100 且 new/old ≤ 0.2 ⇒ 红**。926 样本里**唯事故命中**。
 *   （工单队列里写的「少 50%」单阈值被取证推翻：50% 会把上面两次合法收紧误报成违规
 *    —— old=10→1 剩 10%、old=89→6 剩 7% 都 < 50%。照 0.5 顶回来，以实测为准。）
 * 另一条独立判据：**任何受保护文件被清空或整删（new=0，无论 old 多大）⇒ 红**，
 *   唯一的放行路是 `scripts/file-truncation-exemptions.json` 里同 (commit, path) 的
 *   **带理由豁免**（理由 <20 字不算理由）。历史两次合法整删
 *   （`2eeeb2c2` 删 21 行 dark-launch-baseline · `7a613c74` 换版删 PRD-addendum-a9）
 *   都已在集成线祖先里，落在任何 merge-base..HEAD 区间之外 ⇒ 豁免册**天生为空**，
 *   谁要清空受保护文件，谁当场写理由。
 *
 * ══ 扫描区间 ════════════════════════════════════════════════════════════════════
 * 默认 `merge-base(HEAD, origin/claude/verify-reclaim-6)..HEAD` —— **逐提交**审，
 * 不只看 HEAD~1：只比最后一跳，区间中段的事故会被后续的合法提交盖过去。
 * 合并提交按**第一父** diff（并入的截断记在合并者头上，拦在收编前）。
 * ⚠ 诚实边界①：在集成线本体上跑时 merge-base == HEAD、区间为空 ⇒ 本门无事可审、
 *   如实打印「区间为空」——**它是收编前的拦门，不是考古工具**；要考古用 `--range A..B`。
 * ⚠ 诚实边界②：numstat 的 rename 行（`old => new`）按改名后路径匹配；
 *   花括号形态（`dir/{a => b}/f`）不在本仓受保护清单的历史里出现过，不匹配、如实说明。
 * ⚠ 诚实边界③：行数按 `wc -l` 口径（数 `\n`）；阈值带很宽（0.2），末行无换行差不出红线。
 *
 * ══ 金丝雀（双向，工单点名要求）══════════════════════════════════════════════════
 * `--selftest` 跑两层，**与主逻辑共用同一份 judge()/scanCommit()**（各抄一份 = 装饰品）：
 *   纯判定 8 条：必咬 3（事故原样 2127→0 · 1000→150 · 边界 100→20）·
 *               必不咬 5（重写 1140→1146 · 小收紧 10→1 · 新建 0→500 · 99→5 · 100→21）；
 *   真史 2 条：把**真实的** `3298add3` 喂进 scanCommit ⇒ 必须咬在 docs/SYSTEM-ONTOLOGY.md；
 *             把一次正常小改 `2e94e7ff`（4增4删）喂进去 ⇒ 必须不咬。
 * 任一不中 ⇒ RC=2「门自己瞎了」，**不许**报「受保护文件干净」。
 *
 * ══ 退出码 ════════════════════════════════════════════════════════════════════
 *   0 = 干净（区间内受保护文件无清空/截断，或均有带理由豁免）
 *   1 = 真违规（逐条打出 commit · 路径 · old→new · 剩余比 · 怎么豁免/怎么救）
 *   2 = **工具自己坏了**（git 失败 / 基线 ref 不在 / 豁免册读不出 / 金丝雀不中）
 *
 * 用法：
 *   node scripts/check-file-truncation.mjs              # 门（默认 merge-base..HEAD）
 *   node scripts/check-file-truncation.mjs --selftest   # 只跑金丝雀
 *   node scripts/check-file-truncation.mjs --range A..B # 审指定区间（考古/复验用）
 *   node scripts/check-file-truncation.mjs --list       # 逐条打出扫描样本
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const EXEMPTIONS_PATH = join(ROOT, "scripts/file-truncation-exemptions.json");
const DEFAULT_BASE = "origin/claude/verify-reclaim-6";
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

// ── 阈值（来历见头注「判据」节；改它们必须重跑 926 样本分布取证）─────────────
const MIN_OLD_LINES = 100;
const MAX_REMAIN_RATIO = 0.2;

// ── 保护清单（单星号 glob：* 不跨语义、只按有序片段匹配；受保护路径无嵌套目录）─
const PROTECTED_PATTERNS = ["docs/SYSTEM-ONTOLOGY.md", "docs/PRD-*.md", "scripts/*-baseline.json"];

function globMatch(pattern, path) {
  const parts = pattern.split("*");
  if (!path.startsWith(parts[0])) return false;
  let i = parts[0].length;
  for (let k = 1; k < parts.length; k++) {
    if (parts[k] === "") continue;
    const idx = path.indexOf(parts[k], i);
    if (idx < 0) return false;
    i = idx + parts[k].length;
  }
  const last = parts[parts.length - 1];
  if (last !== "" && !path.endsWith(last)) return false;
  return true;
}
const isProtected = (path) => PROTECTED_PATTERNS.some((p) => globMatch(p, path));

function toolBroken(what, hint) {
  console.error(`⛔ ${what} ⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「受保护文件无人截断」——本门这次根本没扫成。");
  if (hint) console.error(`   ${hint}`);
  process.exit(2);
}

function git(args, allowFail = false) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 }).trim();
  } catch (e) {
    if (allowFail) return null;
    toolBroken(`git ${args.slice(0, 3).join(" ")} 失败`, String(e.stderr ?? e.message).slice(0, 400));
  }
}

/** wc -l 口径的行数；文件在该提交不存在 ⇒ null。 */
function gitLines(commit, path) {
  const buf = git(["show", `${commit}:${path}`], true);
  if (buf === null) return null;
  if (buf === "") return 0;
  return buf.endsWith("\n") ? buf.split("\n").length - 1 : buf.split("\n").length;
}

/**
 * 核心判据（金丝雀与主扫描共用的唯一一份）。
 * old<=0 新建放行；new==0 清空/整删（要豁免）；old≥100 且剩余比 ≤0.2 截断。
 */
function judge(oldLines, newLines) {
  if (oldLines <= 0) return { verdict: "ok", kind: "create" };
  if (newLines === 0)
    return { verdict: "violation", kind: "emptied-or-deleted", detail: "文件被清空或整删（new=0）" };
  const remain = newLines / oldLines;
  if (oldLines >= MIN_OLD_LINES && remain <= MAX_REMAIN_RATIO)
    return {
      verdict: "violation",
      kind: "truncate",
      remain,
      detail: `大文件截断：${oldLines}→${newLines} 行，剩余比 ${(remain * 100).toFixed(1)}% ≤ ${MAX_REMAIN_RATIO * 100}%`,
    };
  return { verdict: "ok", kind: "change", remain: newLines / oldLines };
}

/** 扫描单个提交（合并按第一父 diff）。返回该提交触碰的受保护文件样本。 */
function scanCommit(commit) {
  const parentsLine = git(["rev-list", "--parents", "-n", "1", commit]);
  const parts = parentsLine.split(/\s+/);
  const base = parts.length >= 2 ? parts[1] : EMPTY_TREE;
  const ns = git(["diff", "--numstat", base, commit]);
  const samples = [];
  if (!ns) return samples;
  for (const line of ns.split("\n")) {
    const cols = line.split("\t");
    if (cols.length < 3) continue;
    const added = Number(cols[0]);
    const deleted = Number(cols[1]);
    if (Number.isNaN(added) || Number.isNaN(deleted)) continue; // 二进制行
    let path = cols.slice(2).join("\t");
    if (path.includes(" => ") && !path.includes("{")) path = path.split(" => ").pop(); // 简单 rename
    if (!isProtected(path)) continue;
    const newLines = gitLines(commit, path) ?? 0; // 整删 ⇒ 0
    const oldLines = newLines + deleted - added;
    if (oldLines <= 0) continue; // 新建
    samples.push({ commit, path, oldLines, newLines, added, deleted, ...judge(oldLines, newLines) });
  }
  return samples;
}

/** 豁免册：同 (commit 前缀, path) 且理由 ≥20 字才放行。 */
function loadExemptions() {
  if (!existsSync(EXEMPTIONS_PATH)) return [];
  let raw;
  try {
    raw = JSON.parse(readFileSync(EXEMPTIONS_PATH, "utf8"));
  } catch (e) {
    toolBroken(`豁免册 ${EXEMPTIONS_PATH} 不是合法 JSON`, String(e.message));
  }
  if (!Array.isArray(raw)) toolBroken("豁免册顶层必须是数组", `${EXEMPTIONS_PATH}`);
  for (const [i, e] of raw.entries()) {
    if (!e || typeof e.commit !== "string" || typeof e.path !== "string")
      toolBroken(`豁免册第 ${i + 1} 条缺 commit/path`, JSON.stringify(e));
    if (typeof e.reason !== "string" || e.reason.trim().length < 20)
      toolBroken(
        `豁免册第 ${i + 1} 条（${e.commit} ${e.path}）理由不足 20 字`,
        "「清空受保护文件」这种动作的豁免理由必须让下一个 dev 不用猜。"
      );
  }
  return raw;
}
const findExemption = (exemptions, commit, path) =>
  exemptions.find((e) => commit.startsWith(e.commit) && e.path === path);

function scanRange(rangeSpec, exemptions) {
  const commits = git(["rev-list", rangeSpec]).split("\n").filter(Boolean);
  const samples = [];
  const violations = [];
  for (const c of commits) {
    for (const s of scanCommit(c)) {
      samples.push(s);
      if (s.verdict !== "violation") continue;
      const ex = findExemption(exemptions, s.commit, s.path);
      if (ex) {
        samples[samples.length - 1].exempted = ex.reason;
        continue;
      }
      violations.push(s);
    }
  }
  return { commitCount: commits.length, samples, violations };
}

// ── 金丝雀（工单：必须双向；与主逻辑共用 judge/scanCommit）──────────────────
function selftest() {
  const fails = [];
  const expect = (name, cond) => {
    if (!cond) fails.push(name);
  };
  // 必咬
  expect("咬-1 事故原样 2127→0", judge(2127, 0).verdict === "violation");
  expect("咬-2 大截断 1000→150", judge(1000, 150).verdict === "violation");
  expect("咬-3 边界 100→20", judge(100, 20).verdict === "violation");
  // 必不咬
  expect("不咬-1 整文件重写 1140→1146", judge(1140, 1146).verdict === "ok");
  expect("不咬-2 小文件合法收紧 10→1", judge(10, 1).verdict === "ok");
  expect("不咬-3 新建 0→500", judge(0, 500).verdict === "ok");
  expect("不咬-4 old<100 边界 99→5", judge(99, 5).verdict === "ok");
  expect("不咬-5 剩余比>20% 边界 100→21", judge(100, 21).verdict === "ok");
  // 豁免匹配（不碰 judge，只测配对逻辑）
  const ex = [{ commit: "abc123", path: "docs/PRD-x.md", reason: "这是一条长度足够的豁免理由，供金丝雀使用。" }];
  expect("豁免-正 同commit前缀同path 放行", !!findExemption(ex, "abc123ffff", "docs/PRD-x.md"));
  expect("豁免-反 路径不同不放行", !findExemption(ex, "abc123ffff", "docs/PRD-y.md"));
  // 真史金丝雀（走同一份 scanCommit）
  const incident = scanCommit("3298add3aa52014587cc977008645e34e1740072");
  expect(
    "真史-咬 3298add3 咬在本体",
    incident.some((s) => s.path === "docs/SYSTEM-ONTOLOGY.md" && s.verdict === "violation")
  );
  const normal = scanCommit("2e94e7ff7d0d604b03bf9dd966b909986a605337");
  expect("真史-不咬 2e94e7ff 正常小改", normal.every((s) => s.verdict === "ok"));
  // glob 自检
  expect("glob-1 本体精确匹配", isProtected("docs/SYSTEM-ONTOLOGY.md"));
  expect("glob-2 PRD glob", isProtected("docs/PRD-frontend.md"));
  expect("glob-3 baseline glob", isProtected("scripts/ui-first-layer-baseline.json"));
  expect("glob-4 非保护路径", !isProtected("docs/SYSTEM-ONTOLOGY.md.bak") && !isProtected("scripts/foo.json"));
  if (fails.length) {
    console.error(`⛔ 金丝雀 ${fails.length} 条不中 ⇒ **门自己瞎了**：`);
    for (const f of fails) console.error(`   ✗ ${f}`);
    process.exit(2);
  }
  console.log("✓ 金丝雀全中（必咬 3 · 必不咬 5 · 豁免配对 2 · 真史 2 · glob 4，均与主逻辑共用同一份实现）。");
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
function main() {
  const argv = process.argv.slice(2);
  const argVal = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : null;
  };
  if (argv.includes("--selftest")) {
    selftest();
    return;
  }

  const exemptions = loadExemptions();

  let rangeSpec = argVal("--range");
  if (!rangeSpec) {
    const base = argVal("--base") ?? DEFAULT_BASE;
    if (!git(["rev-parse", "--verify", "-q", base], true))
      toolBroken(`基线 ref「${base}」不在本仓`, "先 git fetch origin，或用 --range/--base 显式给区间。");
    const mb = git(["merge-base", "HEAD", base], true);
    if (!mb) toolBroken(`merge-base(HEAD, ${base}) 求不出来`, "基线参考系缺失 ⇒ 无法界定「本分支新引入的改动」。");
    if (mb === git(["rev-parse", "HEAD"]))
      console.log(`· 区间为空（merge-base == HEAD）：本分支相对 ${base} 无新提交，本门无事可审（它是收编前的拦门，不是考古工具）。`);
    rangeSpec = `${mb}..HEAD`;
  }

  const { commitCount, samples, violations } = scanRange(rangeSpec, exemptions);
  const exempted = samples.filter((s) => s.exempted);
  console.log(
    `· 区间 ${rangeSpec.slice(0, 24)}… · 提交 ${commitCount} 个 · 受保护文件触碰 ${samples.length} 次` +
      `（违规 ${violations.length} · 带理由豁免 ${exempted.length}）`
  );
  if (argv.includes("--list")) {
    for (const s of samples)
      console.log(
        `  ${s.verdict === "violation" ? (s.exempted ? "豁" : "红") : "·"} ${s.commit.slice(0, 9)} ${s.path} ${s.oldLines}→${s.newLines} 行${s.exempted ? `（豁免：${s.exempted.slice(0, 40)}…）` : ""}`
      );
  }
  for (const s of exempted) console.log(`· 豁免在案：${s.commit.slice(0, 9)} ${s.path} —— ${s.exempted}`);

  if (violations.length) {
    console.error(`\n⛔ 受保护文件被清空/截断 ${violations.length} 处（判据落行数比，不看提交信息说了什么）：`);
    for (const v of violations)
      console.error(`   ${v.commit.slice(0, 9)} ${v.path} —— ${v.detail}`);
    console.error(
      `\n   处置二选一：① 救回文件内容（参照事故救援合并 8d70bcdb 取父提交 ours）；\n` +
        `   ② 确属有意整删/重写 ⇒ 在 scripts/file-truncation-exemptions.json 加一条\n` +
        `      { "commit": "<短哈希>", "path": "<路径>", "reason": "<≥20 字，让下个 dev 不用猜>" }。`
    );
    process.exit(1);
  }
  console.log("✓ file-truncation:check 通过（区间内受保护文件无清空/截断）。");
}

try {
  main();
} catch (e) {
  // 顶层兜底：任何未预期异常一律读作「工具坏了」，不许读作「受保护文件干净」。
  if (e && typeof e === "object" && "status" in e) process.exit(e.status);
  console.error(`⛔ 未预期异常 ⇒ **工具坏了，不是代码坏了**：${e?.stack ?? e}`);
  process.exit(2);
}
