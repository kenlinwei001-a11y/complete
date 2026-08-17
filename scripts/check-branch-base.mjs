#!/usr/bin/env node
/**
 * `branch-base:check` · **交单分支的基线对不对**（复验入口的第一道，不是门链的一道）
 *
 * ══ 守的命题 ═══════════════════════════════════════════════════════════════════
 * **一条 handoff 分支的分叉点，必须落在「当前集成线」上足够近的位置。**
 * 分叉点太老 ⇒ 它相对的一切「diff / 基线 / 既存红 / 未改动」结论**全部失效**，
 * 因为它们度量的是另一棵树。
 *
 * ══ 来历（2026-08-17 实测，真事故）═════════════════════════════════════════════
 * 一条交单分支（6 个提交）报了六项证据、且经过一轮「独立复验 PASS」，其中：
 *   · 「`useTaskStream` 零 diff」· 「reducer 仅 +8 行」· 「`KNOWN_EVENTS` 未增」
 *   · 「f15 红是 pre-existing（另立基线 worktree 对照同签名同红）」
 * **方法全对，树选错了**：它的分叉点是 `origin/main`，而集成线在该点之后有 **2417** 个提交。
 * 最硬的对证：`KNOWN_EVENTS` 在 `origin/main` 上 **9** 名、在集成线上 **10** 名
 * （多 `coordinator.planned`，提交 `386e40ee` 加的）。而该分支的复验者还「更正」派单者说
 * 「实物基线 9 名非 10 名」—— **相对 main 对，相对要并进去的线错**。
 * 这条不是无害的数字差：不在 `KNOWN_EVENTS` 里的具名事件 EventSource 不订阅 ⇒ **整条被丢**，
 * 而它的 18/18、4/4 全绿。
 *
 * 形态（铁律 0.6）：
 *   **「我用『相对 origin/main 的 diff 与基线』当作『相对要并入的那条线的 diff 与基线』的证据，
 *     而前者并不度量后者。」**
 * 附带一条同样要记住的：**派单者与复验者读的是同一棵旧树，所以两人一致。
 * 同一棵错树上的两个读者达成一致，不构成互证** —— 「独立复验」独立的是人，不是树。
 *
 * ══ 为什么要有这个脚本（而不是继续写在派单模板里）═══════════════════════════════
 * 这条判据（`merge-base --is-ancestor`）本来就写在审核方**每一张**派单里。
 * 它这次没起作用，原因不是它错，是**它只保护「我写的那些单」** ——
 * 这一单不是我派的（仓主直接安排的 dev），模板一个字都没到场。
 * 而拓扑我确实写过：`docs/PRD-agentcore-dsh-upgrade.md` §0.0（2026-08-16，我自己写的）
 * 里就记着 `canonical..dsh`=197 / `集成..dsh`=6。**写在 PRD 段落里的拓扑不是机制。**
 * 本仓已有原话：**「写在注释里的纪律不是机制，写在文档里的也不是。」**
 * ⇒ 故落成脚本，由**复验方在收单第一步跑**，与谁写的单无关。
 *
 * ══ 诚实边界（本脚本做不到什么）═══════════════════════════════════════════════
 *  · **只量拓扑距离，不判内容对不对。** 分叉点很近也可能改错东西。
 *  · **阈值是启发式**：分叉点落后多少算「太老」没有客观真值。默认 200，可 `--max=N` 调。
 *    真正的硬判据只有一条：**分叉点必须在集成线的历史里**（`--is-ancestor`）；
 *    落后多少是提醒，不是定理。两者在输出里分开报，不许混。
 *  · **不判 rebase 后会不会冲突** —— 那要真 rebase 一次才知道。
 *
 * ══ 退出码 ════════════════════════════════════════════════════════════════════
 *   0 = 基线够新 · 1 = 基线太老/不在集成线历史里 · 2 = **工具自己坏了**（git 不可用 / 引用解不开）
 *   任何"我没能测量"一律 RC=2 —— 默认失败方向必须是「我没查出来」，不是「你的基线没问题」。
 *
 * 用法：
 *   node scripts/check-branch-base.mjs <分支或提交> [--onto=<集成线>] [--max=N]
 *   node scripts/check-branch-base.mjs --selftest
 */
import { execFileSync } from "node:child_process";

const DEFAULT_ONTO = "origin/claude/verify-reclaim-6";
const DEFAULT_MAX = 200;

function toolBroken(what, hint) {
  console.error(`⛔ ${what} ⇒ **工具坏了，不是分支坏了**。`);
  console.error("   本次结论作废：**不许**读作「基线没问题」—— 本次根本没有测量成功。");
  if (hint) console.error(`   ${hint}`);
  process.exit(2);
}

const git = (args) => execFileSync("git", args, { encoding: "utf8" }).trim();

/**
 * **判据本体** —— 主逻辑与金丝雀共用这一份。
 * @returns {{forkPoint:string, aheadOfFork:number, ontoAheadOfFork:number, forkOnOnto:boolean}}
 */
export function measure(branch, onto) {
  const fork = git(["merge-base", branch, onto]);
  return {
    forkPoint: fork,
    aheadOfFork: Number(git(["rev-list", "--count", `${fork}..${branch}`])),
    ontoAheadOfFork: Number(git(["rev-list", "--count", `${fork}..${onto}`])),
    // 分叉点必然在两者历史里；这里真正想问的是「onto 有没有把 branch 整个包住」
    forkOnOnto: (() => {
      try {
        execFileSync("git", ["merge-base", "--is-ancestor", branch, onto], { stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    })(),
  };
}

/* ── 金丝雀：拿仓库里的真引用跑，与主逻辑共用 measure() ─────────────────────── */
function runCanaries() {
  const fails = [];
  const has = (r) => {
    try { git(["rev-parse", "--verify", "-q", r]); return true; } catch { return false; }
  };
  // 必中-1：HEAD 对自己 —— 两边都必须是 0，否则 measure 的方向反了
  try {
    const m = measure("HEAD", "HEAD");
    if (m.aheadOfFork !== 0 || m.ontoAheadOfFork !== 0) fails.push(`必中-1 HEAD..HEAD 应为 0/0，实测 ${m.aheadOfFork}/${m.ontoAheadOfFork}`);
  } catch (e) { fails.push(`必中-1 抛异常：${e.message}`); }
  // 必中-2/3：方向不变量。**刻意不断言具体条数** ——
  // 第一版写的是「HEAD~5 vs HEAD 应为 0/5」，金丝雀当场把它否了：实测 0/23。
  // 坏的不是 measure()，是我的期望：`HEAD~5` 走**首父**回退 5 步，而
  // `rev-list --count HEAD~5..HEAD` 数的是**全部可达**提交 —— 含 merge 带进来的整条支线。
  // 形态（铁律 0.6）：**「我用『首父回退 5 步』当作『两点间只有 5 个提交』的证据。」**
  // ⇒ 金丝雀只钉**方向**（谁领先谁、包含关系），那才是真会被写反的东西；
  //   条数依赖 merge 拓扑，钉了它就是把一个会漂的数写成定理。
  try {
    if (has("HEAD~1")) {
      const fwd = measure("HEAD~1", "HEAD");
      if (fwd.aheadOfFork !== 0) fails.push(`必中-2 祖先侧 aheadOfFork 应为 0，实测 ${fwd.aheadOfFork}`);
      if (fwd.ontoAheadOfFork < 1) fails.push(`必中-2 后代侧 ontoAheadOfFork 应 ≥1，实测 ${fwd.ontoAheadOfFork}`);
      if (!fwd.forkOnOnto) fails.push("必中-2 祖先应被判为「已在 onto 历史里」");

      const rev = measure("HEAD", "HEAD~1");
      if (rev.aheadOfFork < 1) fails.push(`必中-3 反向 aheadOfFork 应 ≥1，实测 ${rev.aheadOfFork}`);
      if (rev.ontoAheadOfFork !== 0) fails.push(`必中-3 反向 ontoAheadOfFork 应为 0，实测 ${rev.ontoAheadOfFork}`);
      if (rev.forkOnOnto) fails.push("必中-3 后代不该被判为「已在祖先历史里」—— 包含关系写反了");
    }
  } catch (e) { fails.push(`必中-2/3 抛异常：${e.message}`); }
  return fails;
}

/* ── 主流程 ────────────────────────────────────────────────────────────────── */
function main() {
  const argv = process.argv.slice(2);
  const fails = runCanaries();
  if (fails.length) {
    console.error("⛔ 金丝雀不中 ⇒ **测量逻辑瞎了**，本次不产出任何结论：");
    for (const f of fails) console.error(`   · ${f}`);
    process.exit(2);
  }
  if (argv.includes("--selftest")) {
    console.log("✅ 金丝雀全中（HEAD..HEAD 双 0 · 祖先/后代方向不反 · 包含关系不反）⇒ 测量逻辑活着。");
    process.exit(0);
  }

  const branch = argv.find((a) => !a.startsWith("--"));
  if (!branch) toolBroken("没给分支", "用法：node scripts/check-branch-base.mjs <分支> [--onto=<集成线>] [--max=N]");
  const onto = (argv.find((a) => a.startsWith("--onto=")) || `--onto=${DEFAULT_ONTO}`).slice(7);
  const max = Number((argv.find((a) => a.startsWith("--max=")) || `--max=${DEFAULT_MAX}`).slice(6));

  for (const r of [branch, onto]) {
    try { git(["rev-parse", "--verify", "-q", `${r}^{commit}`]); }
    catch { toolBroken(`解不开引用 ${r}`, "先 `git fetch origin`；远端分支要写成 origin/<名>。"); }
  }

  let m;
  try { m = measure(branch, onto); } catch (e) { toolBroken(`measure() 抛异常：${e.message}`); }

  console.log(`分支 ${branch}`);
  console.log(`集成线 ${onto}`);
  console.log(`分叉点 ${m.forkPoint.slice(0, 8)}`);
  console.log(`  它自分叉点起的提交数：${m.aheadOfFork}`);
  console.log(`  集成线自分叉点起的提交数：${m.ontoAheadOfFork}   ← **这个数就是它的一切基线结论的失效半径**`);

  if (m.forkOnOnto) {
    console.log("\n✅ 该分支已整个在集成线历史里（无需 rebase）。");
    process.exit(0);
  }
  if (m.ontoAheadOfFork > max) {
    console.error(`\n❌ branch-base:check 判负 —— 分叉点落后集成线 ${m.ontoAheadOfFork} 个提交（阈值 ${max}）。`);
    console.error("   ⚠ **这不是「稍旧」的问题，是「量错了对象」的问题**：");
    console.error("     凡是相对基线得出的结论 —— 「某文件零 diff」「某常量未增」「某红是 pre-existing」");
    console.error("     「只改了 N 行」—— **全部失效**，因为它们度量的是另一棵树。");
    console.error("   ⚠ 自足的结论不受影响，别一起推倒重来：mutation 反证 · 夹具哈希 ·");
    console.error("     与外部源码逐行对位 —— 这些不依赖基线，重做是浪费。");
    console.error("   ⚠ **两个读同一棵旧树的人达成一致，不构成互证**：");
    console.error("     「独立复验」独立的是人，不是树。");
    console.error(`   处置：git rebase --onto ${onto} ${m.forkPoint.slice(0, 8)} <分支>，然后把**相对基线的那几项**原样重量一遍。`);
    process.exit(1);
  }
  console.log(`\n✅ 分叉点落后集成线 ${m.ontoAheadOfFork} 个提交，未超阈值 ${max}。`);
  console.log("   ⚠ 诚实边界：本脚本**只量拓扑距离，不判内容对不对**；阈值是启发式，");
  console.log("     唯一硬判据是「分叉点在不在集成线历史里」。也不判 rebase 会不会冲突。");
  process.exit(0);
}

try {
  main();
} catch (e) {
  toolBroken(`本脚本自身抛异常：${e && e.stack ? e.stack.split("\n")[0] : e}`);
}
