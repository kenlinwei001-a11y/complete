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
 * ③ **主工作目录不落后于 `origin/<canonical>`**（2026-08-10 追加，见判据③处的长注）。
 *
 * ①② 的判据是**分支名本身**，不是「有没有未推提交」——后者会被 cherry-pick / 旁支同步糊弄过去。
 * ③ 补的正是①②的盲区：**名字对不代表树是新的**。本地 ref 叫 canonical，却可以停在 112 个提交之前，
 * ①② 双绿而整棵树是旧的 —— 在它里面 grep，会把「这棵树里还没有」读成「全仓没有」。
 *
 * ## 金丝雀
 *
 * 报「一切正常」之前，先证明本脚本真的能解析出 worktree 列表与当前分支：
 * 拿「至少解析出 1 个 worktree」和「当前分支非空」当已知必中样例。
 * 解析不出 ⇒ 报「**门自己坏了**」(exit 2)，**不许**报「干净」。
 * 金丝雀与主逻辑**共用同一份解析实现**（`parseWorktrees` / `currentBranch`），不许各抄一份 ——
 * 抄了就是装饰品：改主逻辑时金丝雀拿旧的去测、照样绿。
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
  console.error(`⛔ check-worktree-canonical.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


import { execFileSync } from "node:child_process";

const CANONICAL = process.env.CANONICAL_BRANCH || "claude/inspiring-gates-aqczjg";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** 在指定 worktree 目录里跑 git（判据③ 要量主工作目录，而不是本脚本碰巧所在的目录）。 */
function gitAt(cwd, args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
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

/**
 * 单一来源③：`a` 是不是 `b` 的祖先（含 a===b —— git 的定义，每个提交都是自己的祖先）。
 * 判据 ③ 与它的金丝雀**共用这一个函数**，不许各抄一份。
 */
function isAncestor(a, b) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", a, b], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** 解析得出该 ref 的 sha；解析不出返回 null（**不返回输入串本身**）。 */
function shaOf(ref) {
  // 兜住「ref 不存在」的是**捕获退出码**（下面的 try/catch）——2026-08-10 实测本机 git：
  // `rev-parse refs/heads/__nope__` / `rev-parse HEAD:no/such/file` / `rev-parse __nope__`
  // 退出码都是 128，都会抛。`--verify -q` 在此仅作纵深防御（换 git 版本/调用形态时它是对的）。
  // ⚠️ 本仓 2026-08-06 那次「输入串被原样吐回、退出码 0」的教训**仍然成立**，但成立的前提是
  // **调用方只读 stdout、不看退出码** —— 那才是真病根。写成「必须带 --verify -q」是把
  // 药当成了病因（同一形态：拿一个相关但不度量目标的东西当判据）。
  try {
    return execFileSync("git", ["rev-parse", "--verify", "-q", ref], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

// ---------------- 金丝雀（与主逻辑共用上面两个函数）----------------
const worktrees = parseWorktrees();
const branch = currentBranch();
const canaryProblems = [];
if (worktrees.length < 1) canaryProblems.push("`git worktree list --porcelain` 解析出 0 个 worktree —— 至少该有主目录自己");
if (!worktrees.some((w) => w.path)) canaryProblems.push("解析出的 worktree 全都没有 path 字段 —— 解析器坏了");
if (branch === null && worktrees.length === 0) canaryProblems.push("既拿不到分支也拿不到 worktree —— 不在 git 仓库里？");
// 判据③ 的金丝雀：`isAncestor` 必须真的会分辨方向（与主逻辑**同一个函数**）。
// 已知必真：任一提交是它自己的祖先。已知必假：一个提交不是它自己父提交的祖先。
const headSha = shaOf("HEAD");
const parentSha = shaOf("HEAD^");
if (headSha && !isAncestor(headSha, headSha)) canaryProblems.push("isAncestor(HEAD,HEAD) 返回假 —— 祖先判定器坏了（每个提交都是自己的祖先）");
if (headSha && parentSha && isAncestor(headSha, parentSha)) canaryProblems.push("isAncestor(HEAD, HEAD^) 返回真 —— 祖先判定器方向反了");
// ⚠️ 这里**故意没有** shaOf 的金丝雀，原因要写清楚，免得后人以为是漏了：
// 我先写过一条「不存在的 ref 必须回 null」的金丝雀，变异反证时它**打不响**（去掉 `--verify -q`
// 后照样绿）。实测本机 git：`rev-parse refs/heads/__nope__` / `rev-parse HEAD:no/such/file`
// / `rev-parse __nope__` **三种形态退出码都是 128**，于是 `shaOf` 的 try/catch 一律接住回 null ——
// 真正兜住这件事的是**捕获退出码**，不是 `--verify -q`。
// 一条打不响的金丝雀就是装饰品，比没有更坏（它让人以为这里被守着），故删掉并留此说明。
// `--verify -q` 仍然留着当纵深防御（换 git 版本 / 换调用形态时它是对的），但**不声称有金丝雀守它**。
if (canaryProblems.length) {
  console.error("⛔ 门自己坏了（金丝雀不中）—— 这不是「工作目录干净」，是本脚本没读到东西：");
  for (const p of canaryProblems) console.error(`   · ${p}`);
  process.exit(2);
}
console.log(`金丝雀：解析到 ${worktrees.length} 个 worktree · 当前分支 = ${branch ?? "(detached)"} · 祖先判定器双向有效 ⇒ 解析器有效`);

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

// ③ 主工作目录不许**落后** canonical —— 分支名对，不代表树是新的
//
// ## 为什么加这条（2026-08-10 · 照 CLAUDE.md 铁律 0.6，本条是①②的盲区）
//
// 形态：**「我用『分支名 === canonical』当作『这棵树是新的』的证据，而名字并不度量新鲜度。」**
// 与①②同源，但①②都抓不到：本地 ref 叫 `claude/inspiring-gates-aqczjg`、`git worktree list`
// 也这么显示，而它可以停在 112 个提交之前 —— 两条判据全绿，树是旧的。
//
// 实测代价（2026-08-10）：主工作目录停在 `5208fd9b`，落后 canonical **112 个提交**。
// 于是在它里面跑的每一次 grep 读的都是旧树，一天里连报两个**错误的否定结论**：
//   · 「`GATE_UNAVAILABLE` 全仓 grep 不到」—— 实际有 5 处（`skill-publish-gate.ts` 那时根本还没进这棵树），
//     由 dev 顶回来才发现；
//   · 「S3 枚举器要从零建」—— 实际脚手架早在，差点让 dev 造第二套。
// 更毒的是**当时我跑了金丝雀**：换个词能 grep 到东西，于是我判「工具是好的」——
// 但那个金丝雀命中的是**新旧两棵树都有**的字符串，它压根不度量「树新不新」。
// **金丝雀选错了对象，等于没有金丝雀。**
//
// 判据：`HEAD` 是 `origin/<canonical>` 的**严格**祖先（是祖先且不等于它）⇒ 落后。
// 取不到 `origin/<canonical>`（没 fetch 过 / 离线 CI）⇒ 报「**未判定**」，**不许**报「干净」。
// ⚠️ 判据③ 量的必须是**主工作目录**的 HEAD（与①同一个主语），不是「本脚本碰巧在哪跑」的 HEAD。
// 从别的 worktree 里跑 `pnpm gates` 时两者不同 —— 用 cwd 的 HEAD 会去判一棵不相干的树。
const mainHeadSha = main?.path ? shaOf(`${main.path}/HEAD`) ?? gitAt(main.path, ["rev-parse", "HEAD"]) : headSha;
const remoteRef = `refs/remotes/origin/${CANONICAL}`;
const remoteSha = shaOf(remoteRef);
if (remoteSha === null) {
  console.log(`⚠️ 判据③ 未判定：本地没有 \`origin/${CANONICAL}\` 引用（没 fetch 过？）—— 这不等于「不落后」。`);
} else if (mainHeadSha && mainHeadSha !== remoteSha && isAncestor(mainHeadSha, remoteSha)) {
  const behind = git(["rev-list", "--count", `${mainHeadSha}..${remoteSha}`]).trim();

  problems.push(
    `主工作目录停在 \`${mainHeadSha.slice(0, 8)}\`，落后 \`origin/${CANONICAL}\` **${behind} 个提交**（HEAD 是它的严格祖先）。\n` +
      `      ⚠️ 分支名对不代表树是新的。在旧树上 grep，会把「这棵树里还没有」读成「全仓没有」——\n` +
      `         本仓 2026-08-10 因此一天连报两个错误的否定结论（详见本文件判据③注释）。\n` +
      `      修法：git fetch origin && git merge --ff-only origin/${CANONICAL}`,
  );
}

if (problems.length) {
  console.error(`\n🔴 worktree-canonical:check 失败（${problems.length} 项）\n`);
  for (const p of problems) console.error(`   · ${p}\n`);
  process.exit(1);
}

console.log(`✅ 主工作目录在 canonical \`${CANONICAL}\` 上 · 无其他 worktree 占用 · 不落后于 origin（分支名 == 推送目标，且树是新的）。`);
