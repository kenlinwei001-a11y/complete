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
 * ## ⚠️ 两种环境两套判据（2026-09-09 · WO-CI-WORKTREE-GATE）—— 不是「CI 就跳过」
 *
 * **实测**（GitHub Actions run 34211897255，`pull_request` 事件，PR #4）：
 * 本门在 CI 上**结构性必红**，原文即
 * `主工作目录 /home/runner/work/complete/complete 当前在分支 \`(detached)\`，不是 canonical`。
 * 原因不在代码质量：`actions/checkout@v4` **恒留 detached HEAD**，
 * 于是判据①（分支名 === canonical）在 CI 上**永远不可能成立**。
 * 它是这条 `pnpm gates` 链上的第 **31/71** 道门 —— 当时链还是 `&&` 串联，
 * **它一红就把后面 40 道门全短路掉**，那 40 道在 CI 上是绿是红，至今无人知道。
 *
 * ⛔ **修法禁止写成「`if (CI) return 0`」** —— 那是把门做成装饰品，本仓明令禁止。
 * 这道门防的错是真的（gate 跑在一棵不是你以为的那棵树上），CI 上照样能犯，
 * 只是**犯法不同**：CI 不会「待在别名分支上」，但会「checkout 漂了 / 工作树脏了 /
 * 验的对象跟本次事件对不上号」。
 *
 * **真正的洞察：detached HEAD 在 CI 上不是缺陷，是比分支名更强的保证。**
 * 分支名度量的是「某个名字**当前**指向哪」——它会漂；
 * 而 detached HEAD 精确钉在**被测的那个 SHA** 上，钉死了就不漂。
 * ⇒ 该换的是判据，不是强度：**不问分支名，问「当前 HEAD 是不是就是 CI 声称在验的那个对象，
 * 且它确实绑在本次事件上、在 canonical 那一族历史里」。**
 *
 * CI 态四条判据（见 `judgeCi()`，任一不成立即 RC=1，与本机同样地红）：
 *   · **C1 对象可指认** —— `git rev-parse HEAD` === `GITHUB_SHA`。
 *     咬的是「checkout 漂了 / 门跑在另一个目录 / 有人中途换了 commit」。
 *   · **C2 工作树干净** —— `git status --porcelain` 为空。
 *     咬的是「被扫的文件 ≠ 那个 commit」（本机版判据①②③一条都不查这个）。
 *   · **C3 对象绑在本次事件上** —— 按事件分流，两种事件**必须分开处理**：
 *       - `push`：`GITHUB_SHA` 就是被测对象，且必须在 `origin/<GITHUB_REF_NAME>` 那条线上。
 *       - `pull_request`：⚠️ `GITHUB_SHA` **不是** PR head，是 GitHub 现造的**合并预演提交**。
 *         实测（PR #4，2026-09-09）：`refs/pull/4/head` = `962dd3be`（= canonical tip），
 *         而 `refs/pull/4/merge` = `0a8aece4`，其双亲为
 *         `778cc589`（base=main）× `962dd3be`（head）。
 *         这个预演提交**不在 canonical 线上**（它压根不在任何分支上）——
 *         照搬 push 的判据会把每个 PR 都判红，这正是本门必须分流的理由。
 *         判法：HEAD === `GITHUB_SHA` 且 **`HEAD^2` === 事件载荷里的 `pull_request.head.sha`**、
 *         `HEAD^1` === `base.sha`。被测对象 = `HEAD^2`（PR head），不是 HEAD。
 *         ⚠️ 这里**必须拿事件载荷去对**，不许直接把 `HEAD^2` 当答案 ——
 *         那样两边同源，等于自己证明自己，变异反证一咬就穿。
 *   · **C4 与 canonical 同源** —— 被测对象与 `origin/<canonical>` 有 merge-base。
 *     咬的是本仓真出过的那件事：**两条无共同祖先的平行历史**（PR #4 正文原话）。
 *     取不到 `origin/<canonical>` ⇒ 报「**未判定**」，不许报「干净」。
 *
 * **本机行为一个字节没动**：CI 态只在 `GITHUB_ACTIONS === "true"` **且 HEAD 处于 detached** 时进入。
 * 本机跑 gate 时 HEAD 在分支上 ⇒ 恒走原判据①②③ ⇒ 不在 canonical 上仍然红、仍然点名分支。
 * 光设 `GITHUB_ACTIONS=1` 骗不进 CI 态（本机在分支上），这就是要求 detached 的用意。
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


import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

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

/**
 * 在指定 worktree 里跑 git，**失败就抛**（由顶层兜底转成 RC=2）。
 *
 * ⚠️ 为什么不能复用上面的 `gitAt`：它把「命令失败」和「输出为空」**都**折成 `null`。
 * 拿它读 `git status --porcelain` 会把「git 挂了」读成「工作树干净」——
 * 正是本仓那个老形态：**「我用『探针没报告问题』当作『没有问题』的证据，而探针根本没跑成。」**
 * 干净与挂掉必须可分辨，所以这里如实返回字符串（含空串），出错则抛。
 */
function gitAtStrict(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/**
 * `a` 与 `b` 有没有共同祖先。**必须按退出码分辨三态**，不许看输出空不空：
 * RC=0 有 · RC=1 无（真的是两条平行历史）· 其他 RC = git 自己坏了 ⇒ 抛，转 RC=2。
 * （`--is-ancestor` 答不了这个问题：无共同祖先与「不是祖先」都返回假。）
 */
function hasMergeBase(cwd, a, b) {
  const r = spawnGit(cwd, ["merge-base", a, b]);
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  throw new Error(`git merge-base ${a} ${b} 退出码 ${r.status}（既非 0 也非 1）⇒ 不是「无共同祖先」，是命令本身失败`);
}

/**
 * 起一条 git 并**如实交出退出码**。
 * ⚠️ 不许用 `execFileSync` 实现：它对任何非 0 退出**一律抛**，于是 RC=1（无共同祖先，
 * 一个有意义的答案）与 RC=128（git 坏了）被折成同一种情况，`hasMergeBase` 的三态判别当场失效。
 */
function spawnGit(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout ?? "" };
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

// ---------------- CI 态：判据与它的纯函数实现 ----------------

/**
 * 单一来源④：CI 态四条判据（C1–C4）的**唯一实现**。
 *
 * 刻意写成**纯函数**：所有 git / 环境事实都由调用方注入。理由只有一个 ——
 * **这样金丝雀才能喂合成事实做双向反证**（已知必绿的一组必须 0 问题、已知必红的一组必须 ≥1 问题）。
 * 若把 git 调用写在函数体里，金丝雀就只能另抄一份判据 ⇒ 抄了就是装饰品
 * （改主判据时金丝雀拿旧的去测、照样绿 —— 本仓 2026-08-08 实测过这个形态）。
 *
 * ⚠️ **单向金丝雀不够**（铁律 1.6 同源教训：「空闲时正确」不度量「忙时正确」）：
 * 只验「好样例过」会漏掉「判据被写成恒真」这一整类做坏法，故两组都必须咬。
 *
 * @param {object} f 注入的事实
 * @param {string}  f.declaredSha   CI 声称在验的对象（`GITHUB_SHA`）
 * @param {string}  f.headSha       主工作目录 HEAD 的真实 sha
 * @param {boolean} f.dirty         主工作目录有未提交改动
 * @param {string}  f.event         `GITHUB_EVENT_NAME`
 * @param {string}  f.refName       `GITHUB_REF_NAME`
 * @param {string[]} f.parents      HEAD 的父提交 sha 列表（push 事件用不到）
 * @param {?string} f.prHeadSha     事件载荷 `pull_request.head.sha`（非 PR 事件为 null）
 * @param {?string} f.prBaseSha     事件载荷 `pull_request.base.sha`
 * @param {?boolean} f.onRefLine    被测对象是否在 `origin/<refName>` 那条线上（取不到 ref 为 null）
 * @param {?boolean} f.relatedToCanonical 被测对象与 `origin/<canonical>` 有无 merge-base（取不到为 null）
 * @returns {{problems:string[], notes:string[], undetermined:string[], subject:?string}}
 *
 * ⚠️ `undetermined` 不是装饰：判据取不到料时（ref 没 fetch / C3 没指认出对象）**不许**在通过语里
 * 声称它成立 —— 那就是本仓最贵的那个老病「『我没查出来』被读成『它没问题』」。
 * 调用方必须按它裁剪通过语。
 */
export function judgeCi(f) {
  const problems = [];
  const notes = [];
  const undetermined = [];
  const short = (s) => (typeof s === "string" && s.length >= 8 ? s.slice(0, 8) : String(s));
  const isPr = f.event === "pull_request" || f.event === "pull_request_target";

  // ── C1 对象可指认：HEAD 必须就是 CI 声称在验的那个 sha ──────────────────────
  // 本门在本机守的那件事（「gate 验的不是你以为的那个 commit」）在 CI 上的对应形态。
  if (f.headSha !== f.declaredSha) {
    problems.push(
      `C1 对象对不上号：CI 声称在验 \`${short(f.declaredSha)}\`（GITHUB_SHA），` +
        `而主工作目录 HEAD 是 \`${short(f.headSha)}\`。\n` +
        `      ⇒ 这道 gate 验的**不是** CI 报告上那个 commit。结论不可采信。`,
    );
  }

  // ── C2 工作树干净：被扫的文件必须就是那个 commit 的内容 ─────────────────────
  if (f.dirty) {
    problems.push(
      `C2 工作树不干净：有未提交改动 ⇒ 被扫的文件 ≠ \`${short(f.declaredSha)}\` 的内容。\n` +
        `      ⇒ 门即便全绿，绿的也是一棵没人能复现的树。`,
    );
  }

  // ── C3 对象绑在本次事件上（两种事件分开处理，不许合并）─────────────────────
  let subject = f.headSha;
  if (isPr) {
    // `GITHUB_SHA` 是**合并预演提交**（GitHub 现造，不在任何分支上），不是 PR head。
    // 被测对象 = PR head = 预演提交的第二个父。必须拿**事件载荷**去对，不许自证。
    if (!f.prHeadSha) {
      problems.push(`C3 事件载荷里取不到 \`pull_request.head.sha\` ⇒ 无法证明 HEAD 是本 PR 的合并预演。`);
      subject = null;
    } else if (f.parents.length !== 2) {
      problems.push(
        `C3 \`${f.event}\` 事件下 HEAD \`${short(f.headSha)}\` 有 ${f.parents.length} 个父提交，应为 2` +
          `（合并预演 = base × head）⇒ 它不是合并预演提交。`,
      );
      subject = null;
    } else if (f.parents[1] !== f.prHeadSha) {
      problems.push(
        `C3 合并预演对不上本 PR：HEAD^2 = \`${short(f.parents[1])}\`，` +
          `而事件载荷说 PR head 是 \`${short(f.prHeadSha)}\`。\n` +
          `      ⇒ 正在验的是**另一个** PR / 另一棵树的预演。`,
      );
      subject = null;
    } else {
      subject = f.parents[1];
      if (f.prBaseSha && f.parents[0] !== f.prBaseSha) {
        problems.push(
          `C3 合并预演的 base 对不上：HEAD^1 = \`${short(f.parents[0])}\`，` +
            `事件载荷说 base 是 \`${short(f.prBaseSha)}\`。`,
        );
      }
      notes.push(`C3 ✓ HEAD 是本 PR 的合并预演（base \`${short(f.parents[0])}\` × head \`${short(subject)}\`）；被测对象取 PR head。`);
    }
  } else {
    // push / workflow_dispatch / schedule：`GITHUB_SHA` 就是被测对象本身。
    if (f.onRefLine === null) {
      undetermined.push("C3");
      notes.push(`⚠️ C3 未判定：本地没有 \`origin/${f.refName}\` 引用 —— 这不等于「在线上」。`);
    } else if (f.onRefLine === false) {
      problems.push(
        `C3 被测对象 \`${short(subject)}\` **不在** \`origin/${f.refName}\` 那条线上` +
          `（\`${f.event}\` 事件声称它是该 ref 的推送对象）。\n` +
          `      ⇒ ref 与 sha 对不上号，指认失败。`,
      );
    } else {
      notes.push(`C3 ✓ 被测对象在 \`origin/${f.refName}\` 线上。`);
    }
  }

  // ── C4 与 canonical 同源 ────────────────────────────────────────────────────
  // 咬本仓真出过的那件事：`main` 与 canonical 曾是**两条无共同祖先的历史**（PR #4 正文）。
  if (subject === null) {
    undetermined.push("C4");
    notes.push("⚠️ C4 未判定：C3 没能指认出被测对象。");
  } else if (f.relatedToCanonical === null) {
    undetermined.push("C4");
    notes.push(`⚠️ C4 未判定：本地没有 \`origin/${CANONICAL}\` 引用 —— 这不等于「同源」。`);
  } else if (f.relatedToCanonical === false) {
    problems.push(
      `C4 被测对象 \`${short(subject)}\` 与 \`origin/${CANONICAL}\` **没有共同祖先**（merge-base 为空）。\n` +
        `      ⚠️ 本仓真出过这件事：\`main\` 与 canonical 曾是两条无共同祖先的平行历史。\n` +
        `      ⇒ 在这样一棵树上跑门，结论与 canonical 无关。`,
    );
  } else {
    notes.push(`C4 ✓ 被测对象与 \`origin/${CANONICAL}\` 同源。`);
  }

  return { problems, notes, undetermined, subject };
}

/** 金丝雀样例 · **已知必绿**：照 PR #4 的真实形状造（合并预演 base × head 都对得上）。 */
const CI_CANARY_GOOD = {
  declaredSha: "0a8aece43da0970ca361a4b255f55d4fe92641a6",
  headSha: "0a8aece43da0970ca361a4b255f55d4fe92641a6",
  dirty: false,
  event: "pull_request",
  refName: "4/merge",
  parents: ["778cc589c6c06089304ddbc666cf7d0721ad492d", "962dd3beaebdaab8fc4e615679e7f942c673a09d"],
  prHeadSha: "962dd3beaebdaab8fc4e615679e7f942c673a09d",
  prBaseSha: "778cc589c6c06089304ddbc666cf7d0721ad492d",
  onRefLine: null,
  relatedToCanonical: true,
};
/** 金丝雀样例 · **已知必红**：同一组事实，只把 HEAD 换成别的 sha（C1 必须咬住）。 */
const CI_CANARY_BAD_SHA = { ...CI_CANARY_GOOD, headSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" };
/** 金丝雀样例 · **已知必红**：合并预演的 head 父与事件载荷说的 PR head 不符（C3 必须咬住）。 */
const CI_CANARY_BAD_PR = { ...CI_CANARY_GOOD, prHeadSha: "0123456789012345678901234567890123456789" };

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
// CI 态判据的**双向**金丝雀（与主路径共用 `judgeCi`，不另抄一份判据）。
// 已知必绿的一组若报问题 ⇒ 判据被写死成恒假；已知必红的两组若放行 ⇒ 判据被写成恒真（装饰品）。
// 两个方向都要咬 —— 只验一个方向的金丝雀，正是本仓「空闲报 0 就以为量法对」那个老病。
const ciCanaryGood = judgeCi(CI_CANARY_GOOD).problems;
const ciCanaryBadSha = judgeCi(CI_CANARY_BAD_SHA).problems;
const ciCanaryBadPr = judgeCi(CI_CANARY_BAD_PR).problems;
if (ciCanaryGood.length) canaryProblems.push(`judgeCi 把「已知必绿」的合成 CI 事实判成 ${ciCanaryGood.length} 个问题 —— CI 判据恒假`);
if (!ciCanaryBadSha.length) canaryProblems.push("judgeCi 放行了「HEAD ≠ GITHUB_SHA」的合成事实 —— C1 是装饰品");
if (!ciCanaryBadPr.length) canaryProblems.push("judgeCi 放行了「合并预演对不上本 PR」的合成事实 —— C3 是装饰品");

if (canaryProblems.length) {
  console.error("⛔ 门自己坏了（金丝雀不中）—— 这不是「工作目录干净」，是本脚本没读到东西：");
  for (const p of canaryProblems) console.error(`   · ${p}`);
  process.exit(2);
}
console.log(
  `金丝雀：解析到 ${worktrees.length} 个 worktree · 当前分支 = ${branch ?? "(detached)"} · ` +
    `祖先判定器双向有效 · CI 判据双向有效（好样例 0 问题 / 坏样例各 ${ciCanaryBadSha.length}、${ciCanaryBadPr.length} 问题）⇒ 解析器有效`,
);

// ---------------- 主判据 ----------------
const problems = [];

// ① 主工作目录（= 列表第一项，git 保证主 worktree 排第一）必须在 canonical 上
const main = worktrees[0];
const mainBranch = main?.branch ?? null;

// ---------------- 分流：CI 态走 C1–C4，本机态走原判据①②③ ----------------
//
// **进入 CI 态要两个条件同时成立**，缺一不可：
//   (a) `GITHUB_ACTIONS === "true"`；(b) HEAD **确实 detached**。
// (b) 不是冗余：`actions/checkout@v4` 恒留 detached HEAD，所以真 CI 必然满足；
// 而本机跑 gate 时 HEAD 在分支上 ⇒ 光设一个环境变量**进不来**，本机判据一个字节不变。
// 若 (a) 成立而 (b) 不成立 ⇒ 环境自相矛盾，**回落到本机判据**（偏保守，宁可多红）。
const CI_EVENT = (process.env.GITHUB_EVENT_NAME || "").trim();
const CI_SHA = (process.env.GITHUB_SHA || "").trim();
const inCi =
  process.env.GITHUB_ACTIONS === "true" && branch === null && /^[0-9a-f]{40}$/.test(CI_SHA) && CI_EVENT !== "";

if (process.env.GITHUB_ACTIONS === "true" && !inCi) {
  console.log(
    `⚠️ 声称 CI（GITHUB_ACTIONS=true）但环境不自洽` +
      `（HEAD ${branch === null ? "detached" : `在分支 \`${branch}\``} · GITHUB_SHA=${CI_SHA ? "有" : "缺"} · GITHUB_EVENT_NAME=${CI_EVENT || "缺"}）` +
      ` ⇒ **回落到本机判据**，不走 CI 判据。`,
  );
}

if (inCi) {
  const mainPath = main?.path || process.cwd();
  // 这三个都走**必须成功**的读法：读不出来是「我没查出来」(RC=2)，不许静默折成「干净」。
  const headSha = gitAtStrict(mainPath, ["rev-parse", "HEAD"]);
  const status = gitAtStrict(mainPath, ["status", "--porcelain"]);
  const revLine = gitAtStrict(mainPath, ["rev-list", "--parents", "-n", "1", "HEAD"]);
  const parents = revLine.split(/\s+/).filter(Boolean).slice(1);

  // 事件载荷 = PR head/base 的**独立出处**。取不到就不许硬判，按三分约定退 2（「我没查出来」）。
  let prHeadSha = null;
  let prBaseSha = null;
  const isPrEvent = CI_EVENT === "pull_request" || CI_EVENT === "pull_request_target";
  if (isPrEvent) {
    const evPath = process.env.GITHUB_EVENT_PATH;
    if (!evPath) {
      console.error(`⛔ \`${CI_EVENT}\` 事件下没有 GITHUB_EVENT_PATH ⇒ 拿不到 PR head/base 的独立出处。`);
      console.error("   本次结论作废：**不许**读作「通过」——本门这次没能指认被测对象。");
      process.exit(2); // 2 = 我没查出来，不是「你的代码有问题」
    }
    try {
      const ev = JSON.parse(readFileSync(evPath, "utf8"));
      prHeadSha = ev?.pull_request?.head?.sha ?? null;
      prBaseSha = ev?.pull_request?.base?.sha ?? null;
    } catch (e) {
      console.error(`⛔ 读不出事件载荷 ${evPath}（${e?.message || e}）⇒ 拿不到 PR head/base。`);
      console.error("   本次结论作废：**不许**读作「通过」。");
      process.exit(2);
    }
  }

  // C3(push 支) 与 C4 要的两个祖先关系 —— 与本机判据③**共用同一个 `isAncestor`**，不另抄。
  const refName = (process.env.GITHUB_REF_NAME || "").trim();
  const refTip = refName ? shaOf(`refs/remotes/origin/${refName}`) : null;
  const onRefLine = !isPrEvent && headSha ? (refTip === null ? null : isAncestor(headSha, refTip)) : null;

  const canonicalTip = shaOf(`refs/remotes/origin/${CANONICAL}`);
  const subjectGuess = isPrEvent ? (parents[1] ?? null) : headSha;
  let relatedToCanonical = null;
  if (canonicalTip && subjectGuess) {
    // merge-base 为空 ⇒ 两条无共同祖先的历史。`--is-ancestor` 答不了这个，必须真求 merge-base，
    // 且按退出码分辨「无共同祖先(1)」与「git 坏了(其他)」—— 后者抛出去转 RC=2。
    relatedToCanonical = hasMergeBase(mainPath, subjectGuess, canonicalTip);
  }

  const verdict = judgeCi({
    declaredSha: CI_SHA,
    headSha,
    dirty: status !== "",
    event: CI_EVENT,
    refName,
    parents,
    prHeadSha,
    prBaseSha,
    onRefLine,
    relatedToCanonical,
  });

  for (const n of verdict.notes) console.log(`   ${n}`);
  if (verdict.problems.length) {
    console.error(`\n🔴 worktree-canonical:check 失败（CI 态 · ${verdict.problems.length} 项）\n`);
    for (const p of verdict.problems) console.error(`   · ${p}\n`);
    process.exit(1);
  }
  // ⚠️ 通过语只许声称**真判过**的那几条。C3/C4 未判定时若照样写「绑定本次事件 · 与 canonical 同源」，
  // 就是把「我没查出来」写成了「它没问题」—— 本仓最贵的那个老病，绝不许在通过语里复发。
  const decided = ["C1 对象可指认", "C2 工作树干净"];
  if (!verdict.undetermined.includes("C3")) decided.push("C3 绑定本次事件");
  if (!verdict.undetermined.includes("C4")) decided.push(`C4 与 canonical 同源`);
  const caveat = verdict.undetermined.length
    ? `\n   ⚠️ 但 ${verdict.undetermined.join("/")} **未判定**（见上）——本门这次没证明这一条，不许读作它成立。`
    : "";
  console.log(
    `✅ CI 态（事件 \`${CI_EVENT}\`）：被测对象 \`${(verdict.subject || "?").slice(0, 8)}\` · ` +
      `已判过 ${decided.join(" · ")}。${caveat}\n` +
      `   （CI 上 detached HEAD 不是缺陷：它比分支名更强 —— 分支名会漂，钉死的 SHA 不会。）`,
  );
  process.exit(0);
}

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
