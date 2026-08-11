#!/usr/bin/env node
/**
 * check-worktree-canonical —— 主工作目录必须待在 canonical 分支上。
 *
 * ## 为什么有这道门（2026-08-09 · 同一形态一天犯两次，照 CLAUDE.md 铁律 0.6 第 2 级建机制）
 *
 * 形态：**「我用『git push 返回成功』当作『我的提交进了 canonical』的证据，而前者只度量
 * 那个被命名的 ref 推没推成，不度量 HEAD 有没有进去。」**
 *
 * - 第 1 次（真事故）：主工作目录被一个 agent 的 checkout 带到了 `claude/handoff-check-spec-aut`。
 *   我照旧敲 `git push -u origin claude/inspiring-gates-aqczjg` —— git 推的是**那个同名本地 ref**
 *   （它没动过），于是「推送成功」但 canonical 纹丝不动，卡在 `f392ae00` 整整 10 个提交。
 * - 第 2 次（虚惊，但同一个病）：stop hook 报「2 个提交未推」。实测那 2 个提交**已在 canonical**，
 *   hook 比的是同名旁支。两次的根因是同一个：**主工作目录的分支名 ≠ 我实际要推的目标**。
 *
 * 根因再往下一层：canonical 分支名被一个停在旧提交的 worktree 占着
 * （`scratchpad/wt88` @ `f392ae00`），主目录**没法**待在 canonical 上，只能待在别名分支。
 *
 * ## 这道门量什么
 *
 * ① 主工作目录的当前分支 === canonical；
 * ② 没有**别的** worktree 占着 canonical 分支（占了就会把主目录挤走，第①条迟早再破）。
 *
 * 判据是**分支名本身**，不是「有没有未推提交」——后者会被 cherry-pick / 旁支同步之类的操作糊弄过去。
 *
 * ## 金丝雀
 *
 * 报「一切正常」之前，先证明本脚本真的能解析出 worktree 列表与当前分支：
 * 拿「至少解析出 1 个 worktree」和「当前分支非空」当已知必中样例。
 * 解析不出 ⇒ 报「**门自己坏了**」(exit 2)，**不许**报「干净」。
 * 金丝雀与主逻辑**共用同一份解析实现**（`parseWorktrees` / `currentBranch`），不许各抄一份 ——
 * 抄了就是装饰品：改主逻辑时金丝雀拿旧的去测、照样绿。
 */
import { execFileSync } from "node:child_process";

const CANONICAL = process.env.CANONICAL_BRANCH || "claude/inspiring-gates-aqczjg";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** 单一来源①：解析 `git worktree list --porcelain` → [{path, branch|null, bare}] */
function parseWorktrees() {
  const out = git(["worktree", "list", "--porcelain"]);
  const items = [];
  let cur = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (cur) items.push(cur);
      cur = { path: line.slice("worktree ".length), branch: null, bare: false };
    } else if (line.startsWith("branch ") && cur) {
      cur.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    } else if (line === "bare" && cur) {
      cur.bare = true;
    }
  }
  if (cur) items.push(cur);
  return items;
}

/** 单一来源②：当前工作目录所在分支（detached 返回 null） */
function currentBranch() {
  const b = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  return b === "HEAD" ? null : b;
}

// ---------------- 金丝雀（与主逻辑共用上面两个函数）----------------
const worktrees = parseWorktrees();
const branch = currentBranch();
const canaryProblems = [];
if (worktrees.length < 1) canaryProblems.push("`git worktree list --porcelain` 解析出 0 个 worktree —— 至少该有主目录自己");
if (!worktrees.some((w) => w.path)) canaryProblems.push("解析出的 worktree 全都没有 path 字段 —— 解析器坏了");
if (branch === null && worktrees.length === 0) canaryProblems.push("既拿不到分支也拿不到 worktree —— 不在 git 仓库里？");
if (canaryProblems.length) {
  console.error("⛔ 门自己坏了（金丝雀不中）—— 这不是「工作目录干净」，是本脚本没读到东西：");
  for (const p of canaryProblems) console.error(`   · ${p}`);
  process.exit(2);
}
console.log(`金丝雀：解析到 ${worktrees.length} 个 worktree · 当前分支 = ${branch ?? "(detached)"} ⇒ 解析器有效`);

// ---------------- 主判据 ----------------
const problems = [];

// ① 主工作目录（= 列表第一项，git 保证主 worktree 排第一）必须在 canonical 上
const main = worktrees[0];
const mainBranch = main?.branch ?? null;
if (mainBranch !== CANONICAL) {
  problems.push(
    `主工作目录 ${main?.path} 当前在分支 \`${mainBranch ?? "(detached)"}\`，不是 canonical \`${CANONICAL}\`。\n` +
      `      ⚠️ 这正是 2026-08-09 那次「push 成功但 canonical 纹丝不动」的前置条件：\n` +
      `         在别名分支上敲 \`git push origin ${CANONICAL}\` 推的是**那个同名本地 ref**，不是你的 HEAD。\n` +
      `      修法：git checkout ${CANONICAL} && git merge --ff-only origin/${CANONICAL}\n` +
      `      （若 canonical 被别的 worktree 占着，先按下面第②条处理。）`,
  );
}

// ② 不许有**别的** worktree 占着 canonical —— 占了就会把主目录挤到别名分支上
const squatters = worktrees.slice(1).filter((w) => w.branch === CANONICAL);
for (const w of squatters) {
  problems.push(
    `worktree ${w.path} 占着 canonical 分支 \`${CANONICAL}\`，主工作目录因此上不来。\n` +
      `      ⚠️ 拆它之前必须先定性，不许直接删（本仓 2026-08-09 实操路径）：\n` +
      `         git -C <path> status --porcelain            # 有没有未提交改动\n` +
      `         git -C <path> write-tree                    # 暂存区写成 tree\n` +
      `         git log --all --format=%T | grep <tree>      # 该 tree 在历史里出现过 ⇒ 零独有内容\n` +
      `         git commit-tree <tree> -p <HEAD> -m "forensic" && git tag forensic/... <sha>   # 兜底快照\n` +
      `      三步都过了，再 git worktree remove --force <path>。`,
  );
}

if (problems.length) {
  console.error(`\n🔴 worktree-canonical:check 失败（${problems.length} 项）\n`);
  for (const p of problems) console.error(`   · ${p}\n`);
  process.exit(1);
}

console.log(`✅ 主工作目录在 canonical \`${CANONICAL}\` 上，且无其他 worktree 占用 —— 分支名 == 推送目标。`);
