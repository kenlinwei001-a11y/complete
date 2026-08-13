#!/usr/bin/env node
/**
 * dist-freshness.mjs · **dist 新鲜度守卫**（共享库，供所有「读 dist 却报源码结论」的门 import）
 *
 * ⛔ 存在理由 = 2026-08-10 一天之内真实发生 **4 次**的同一种误判（欠账 #161）：
 *
 *     「我用 dist 里有没有 X 当作源码里有没有 X 的证据，而 dist 可能是旧的。」
 *
 *    本仓十余道门 `await import(".../dist/xxx.js")` 之后，讲的却是**源码**的话
 *    （「某符号没有消费方」「某池子少一条」「某枚举没注册」）。dist 一旦落后于 src，
 *    这些门会说出**与源码恰好相反**的结论，而且**是绿的**——因为它们只查了 `existsSync`
 *    （「dist 在不在」），从不查「dist 新不新」。其中一次直接让审核方把一个**根本不存在的
 *    源码缺陷**定性成真缺陷（记为欠账 #155：「不是源码缺陷，是 dist 过期，我的诊断错了」）。
 *
 *    形态与 CLAUDE.md 铁律 0.6 完全同族：**拿一个看起来相关的信号当判据，
 *    而这个信号并不度量我要度量的东西。** `existsSync(dist)` 度量的是"构建过没有"，
 *    不是"构建得够不够新"——两者在 dist 过期时给出相反的答案。
 *
 * 判据（fail-closed·宁可多报不可漏报）：
 *    buildTime(pkg) = max(mtime) over  <pkg>/dist/**
 *    srcTime(pkg)   = max(mtime) over  <pkg>/src/**
 *    过期 ⟺ srcTime > buildTime           （dist 缺失 ⟺ 未构建，同样拦）
 *
 *    取 **max over dist/** 而不是「那一个被 import 的 dist 文件」的 mtime：tsc 增量构建
 *    可能不重写内容未变的产物，用单个文件会把「没变所以没重写」误判成「没构建」。
 *    max over dist/ 回答的正是要问的那句话：**这个包最后一次构建，是不是发生在最后一次改源码之后。**
 *
 * ⛔ 守卫失败时**只许报「dist 没准备好，请先 build」，不许给出任何内容结论**——
 *    这正是本守卫的全部意义：过期时门必须**闭嘴**，而不是拿旧产物讲源码的话。
 *    故 assertDistFresh() 在 import dist 之前就退出。
 *
 * ⛔⛔ 退出码 = **2**，不是 1（WO-R9-DISTFRESH-RC2 · 2026-08-13 · 闭 §8 G-ENVFAIL-AS-CODEFAIL）
 *
 *    本仓门的退出码是**三分**约定（docs/SOP-reviewer-claim-discipline.md §3）：
 *      0 = 干净 · 1 = **被扫的代码真有问题**（先修代码）· 2 = **门自己没准备好**（本次什么都没度量）。
 *
 *    本守卫首版写的是 `process.exit(1)`。于是 **20 道读 dist 的门**在「没 build」这一种
 *    纯环境状态下一律吐 RC=1 —— 而 1 在本仓读作「代码违规、先修代码」。实测佐证（同一个提交）：
 *      · 已 build 的 worktree 里 `check-gate-ledger` **RC=0**
 *      · 未 build 的干净 worktree 里 **RC=1 / 27 条**（报各 app 的 dist 类 guardedPaths「指向空气」）
 *    **同一份代码两个结论 ⇒ 它度量的不是代码。**
 *
 *    形态（CLAUDE.md 铁律 0.6 句式）：
 *      **「我用『门红了』当作『代码有问题』的证据，而前者并不度量后者。」**
 *    与 `check-gate-exit-discipline.mjs` 治的是**同一个病**（那里治的是「未捕获异常 ⇒ node 恒退 1」，
 *    这里治的是「共享守卫**主动**退 1」）。**同族第三例，故落到共享实现里一次改完，
 *    不许再由每道门各自在调用点上翻译**（那正是本单要删掉的 check-chain-scan-honesty.mjs 局部翻译器）。
 *
 *    ⚠️ 反向判据同样是硬的：**只有守卫自己这条路径退 2**，各门主判据明确判负的那个 exit(1)
 *    一个都不许被吞成 2 —— 否则是拿一个更糟的假绿换掉一个假红。故本守卫**只在自己失败时**
 *    调 `process.exit(2)` 并立即终止进程，不注册任何长期存活的退出码翻译钩子。
 *
 * ⛔ 文案纪律：失败输出里**不许**出现「不得并线 / 违规 / 未通过」这类**判决词** ——
 *    判决词是给 RC=1 用的。RC=2 只许说一句话：**本次未度量任何代码，结论作废。**
 *
 * ✅ 自证（成功路径也必须说话）：守卫通过时打印**被检查的包 + 两侧时间戳**，
 *    数据直接取自 `checkDistFreshness` 的 `checked`（与主判据**共用同一份实现**，不另抄比较逻辑）。
 *    没有这一行，「守卫接了但从没真跑」与「守卫真跑了且新鲜」在屏上长得一模一样 ——
 *    那正是本仓「只有 test 引用 = 已排练不是已实现」的同族坑。
 *
 * 用法（门里，务必在 **任何** `import(".../dist/...")` 之前调用）：
 *    import { assertDistFresh } from "./dist-freshness.mjs";
 *    assertDistFresh(["packages/contracts/dist/index.js"], { gate: "xxx:check" });
 *    const m = await import(...);   // ← 只有活着走到这里，dist 才是可信的
 *
 * 自检（金丝雀，与主逻辑**共用同一份实现** checkDistFreshness，不许另抄一份）：
 *    node scripts/dist-freshness.mjs --self-test
 * 覆盖审计（哪些门读 dist 却没接守卫）：
 *    node scripts/dist-freshness.mjs --audit
 *
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7 门 dist-freshness:check · §8 G-DIST-STALE-READ ·
 *          §8 G-ENVFAIL-AS-CODEFAIL（本次新增：环境问题冒充代码违规）。
 */
import { readdirSync, statSync, existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

/** 参与「源码有没有变过」计时的扩展名。src 下的 .md/.snap 之类不影响构建产物，剔掉减少噪声。 */
const SRC_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|json)$/;
const SKIP_DIRS = new Set(["node_modules", ".git", "__snapshots__", "coverage", ".turbo"]);

/**
 * 把任意形态的 dist 引用归一成「仓库相对的包根」。
 * 接受：'packages/contracts/dist/index.js' · 'apps/datacore/dist' · 绝对路径 · file:// URL · URL 对象。
 * 返回 null 表示这不是一个 dist 路径（调用方应视为用法错误）。
 */
export function packageOf(entry, root = process.cwd()) {
  let p = entry instanceof URL ? entry.pathname : String(entry);
  if (p.startsWith("file://")) p = new URL(p).pathname;
  p = p.split(sep).join("/");
  const abs = resolve(root, p).split(sep).join("/");
  const rootAbs = resolve(root).split(sep).join("/");
  const rel = abs.startsWith(rootAbs + "/") ? abs.slice(rootAbs.length + 1) : abs;
  const i = rel.split("/").indexOf("dist");
  if (i < 0) return null;
  return rel.split("/").slice(0, i).join("/");
}

/** 目录树里最新的一个文件（mtime 最大）。不存在 → { ms: -1, file: null, count: 0 }。 */
export function newestMtime(dir, { filter = null, depth = 0 } = {}) {
  let best = { ms: -1, file: null, count: 0 };
  if (depth > 12 || !existsSync(dir)) return best;
  let ents;
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return best; }
  for (const e of ents) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const sub = newestMtime(p, { filter, depth: depth + 1 });
      best.count += sub.count;
      if (sub.ms > best.ms) { best.ms = sub.ms; best.file = sub.file; }
    } else {
      if (filter && !filter.test(e.name)) continue;
      let st;
      try { st = statSync(p); } catch { continue; }
      best.count++;
      if (st.mtimeMs > best.ms) { best.ms = st.mtimeMs; best.file = p; }
    }
  }
  return best;
}

/**
 * 主逻辑（金丝雀与门共用**这一个**函数）。
 * @param entries dist 路径数组（文件或目录皆可，同包会自动去重）
 * @returns { ok, problems:[{kind,pkg,...}], checked:[{pkg,buildMs,srcMs,...}] }
 */
export function checkDistFreshness(entries, { root = process.cwd() } = {}) {
  const problems = [];
  const checked = [];

  // 先按包归组：整包没构建时只报一次，不要每个被点名的文件各报一行（噪声掩盖真问题）。
  const byPkg = new Map();
  for (const entry of entries) {
    const pkg = packageOf(entry, root);
    if (pkg === null) { problems.push({ kind: "BAD_ENTRY", entry: String(entry), pkg: null }); continue; }
    if (!byPkg.has(pkg)) byPkg.set(pkg, []);
    byPkg.get(pkg).push(entry);
  }

  for (const [pkg, pkgEntries] of byPkg) {
    const distDir = join(root, pkg, "dist");
    const build = newestMtime(distDir);
    // 整包未构建 → 一条即可，且不必再逐文件报缺。
    if (build.count === 0) {
      problems.push({ kind: "MISSING", pkg, entry: String(pkgEntries[0]), detail: distDir });
      continue;
    }
    // 包构建过，但某个被点名的产物文件不在 → 逐个报（门 import 的就是它）。
    let anyMissing = false;
    for (const entry of pkgEntries) {
      const entryAbs = resolve(root, entry instanceof URL ? entry.pathname : String(entry));
      if (SRC_EXT.test(entryAbs) && !existsSync(entryAbs)) {
        problems.push({ kind: "MISSING", pkg, entry: String(entry), detail: entryAbs });
        anyMissing = true;
      }
    }
    if (anyMissing) continue;
    const srcDir = join(root, pkg, "src");
    const src = newestMtime(srcDir, { filter: SRC_EXT });

    if (src.count === 0) {
      // 没有 src/ 的包（纯产物包）无从比较，放行但记录。
      checked.push({ pkg, buildMs: build.ms, srcMs: -1, note: "无 src/，跳过新鲜度比较" });
      continue;
    }
    if (src.ms > build.ms) {
      problems.push({
        kind: "STALE",
        pkg,
        entry: String(pkgEntries[0]),
        buildMs: build.ms,
        srcMs: src.ms,
        newestSrc: src.file,
        newestDist: build.file,
        lagSec: (src.ms - build.ms) / 1000,
      });
      continue;
    }
    checked.push({ pkg, buildMs: build.ms, srcMs: src.ms, newestSrc: src.file, newestDist: build.file });
  }
  return { ok: problems.length === 0, problems, checked };
}

/**
 * 成功路径的**自证**一行：被检查的包 + 两侧时间戳 + 领先量。
 *
 * ⛔ 为什么成功也必须打印：没有这一行时，「守卫 import 了但那次根本没被调用」与
 *    「守卫真跑了且 dist 新鲜」在屏上**一模一样**（都是安静的）。本仓已知的同族坑是
 *    「只有 test 引用 = 已排练，不是已实现」——接了线看不出来在不在跑，等于没接。
 *    数据全部取自 checkDistFreshness 的 checked，**不另算一遍**（不许出现装饰品）。
 */
function attest(c) {
  const t = (ms) => (ms >= 0 ? new Date(ms).toISOString().replace("T", " ").slice(0, 19) : "—");
  if (c.srcMs < 0) return `· dist 新鲜度已核：${c.pkg}  产物 ${t(c.buildMs)}（${c.note || "无 src/"}）`;
  const lead = (c.buildMs - c.srcMs) / 1000;
  const leadTxt = lead >= 60 ? `${(lead / 60).toFixed(1)} 分钟` : `${lead.toFixed(1)} 秒`;
  return `· dist 新鲜度已核：${c.pkg}  产物 ${t(c.buildMs)} ≥ 源码 ${t(c.srcMs)}（领先 ${leadTxt}）`;
}

/** 人读的一行说明。 */
function describe(p) {
  if (p.kind === "BAD_ENTRY") return `用法错误：「${p.entry}」不含 dist/ 路径段，守卫无法定位包根`;
  if (p.kind === "MISSING") return `${p.pkg} 的 dist 未构建（缺 ${p.detail}）`;
  const ago = p.lagSec >= 60 ? `${(p.lagSec / 60).toFixed(1)} 分钟` : `${p.lagSec.toFixed(1)} 秒`;
  return (
    `${p.pkg} 的 dist **过期** ${ago}\n` +
    `        最新源码：${p.newestSrc}\n` +
    `        最新产物：${p.newestDist}`
  );
}

/**
 * 「**这条路径不存在，是没 build 造成的吗？**」——给那些不 import dist、却对 dist 路径做
 * 存在性断言的门用（本仓实例：`check-gate-ledger.mjs` 的 ④ 责任边界判据核 guardedPaths）。
 *
 * ⛔ 为什么必须有这一支：`assertDistFresh` 只治「**读** dist 的门」。而 WO-R9-DISTFRESH-RC2
 *    的头号佐证恰恰不是这一族 —— `check-gate-ledger.mjs` 一次 dist 都不读，它只是核门账里
 *    `guardedPaths` 的每条路径「是不是真的存在」。没 build 时那些 dist 产物条目全部落空，
 *    于是它报 **28 条「责任边界指向空气」+ RC=1**，读起来是门账写错了，实际门账一个字都没错。
 *    **同一个形态、两套机制**：光改 assertDistFresh 的退出码，这一半一条都修不到
 *    （本单实跑复核：改完 assertDistFresh 之后 check-gate-ledger 仍然 RC=1 / 28 条）。
 *
 * 判据（刻意收紧，宁可漏判成 1 也不许把真错账放过）：
 *    ① 路径含 `dist/` 段，能定位到包根；
 *    ② 该包根**真的是一个包**（有 package.json）——否则是门账把包名拼错了，那是真错，仍归 1；
 *    ③ 该包的 `dist/` 目录里**一个文件都没有**（整包未构建）。
 * 只有三条同时成立才判「环境」。包已构建、单个文件却缺 ⇒ 门账写的是过期路径，**仍归 1**。
 *
 * 计数用的是 `newestMtime`（与 `checkDistFreshness` 判「整包未构建」时**同一个函数、同一个
 * `count === 0` 判据**），不另抄一份目录遍历 —— 抄了就是装饰品。
 */
export function isUnbuiltArtifactPath(p, { root = process.cwd() } = {}) {
  const pkg = packageOf(p, root);
  if (pkg === null || pkg === "") return false;            // ① 不含 dist/ 段
  if (!existsSync(join(root, pkg, "package.json"))) return false; // ② 包根不是包 ⇒ 真写错了
  return newestMtime(join(root, pkg, "dist")).count === 0;  // ③ 整包未构建
}

/**
 * 三分退出码里「**门自己没准备好**」那一个（docs/SOP-reviewer-claim-discipline.md §3）。
 * 单独导出成常量而不是散在各处写字面量 2：`check-gate-exit-discipline.mjs` 的
 * 「共享守卫不许退 1」判据要认这个符号，写死数字就没有可机械核的锚点。
 */
export const RC_TOOL_NOT_READY = 2;

/**
 * 共享的「门自己没准备好」出口。**任何**共享守卫（今天只有 dist 新鲜度这一族，
 * 明天再加别的环境前置——node 版本 / 只读 FS / 缺基线——都往这里接）失败时都走这一个函数。
 *
 * 为什么必须是**共享的一个函数**而不是各门在调用点上自己翻译：
 * 上一版 `check-chain-scan-honesty.mjs` 用 `process.once("exit", …)` 把守卫的 1 就地改写成 2，
 * 只有那**一道门**享受到；另外 19 道门照旧报 1。而且两层翻译一旦叠加，行为无法推理。
 * 本函数直接 `process.exit(2)` 并立即终止进程 —— **不留任何长期存活的钩子**，
 * 故绝无可能把某道门主判据自己的 `exit(1)` 顺手吞掉（本单反证 ② 就是钉这一条的）。
 *
 * ⛔ 文案纪律：headline / lines / hint 里**不许**出现「不得并线 / 违规 / 未通过」这类判决词。
 */
export function exitToolNotReady({ gate = "（未具名门）", headline, lines = [], hint = "" }) {
  console.error(`\n⚠ ${gate}：**门自己没准备好，本次未度量任何代码，结论作废**（RC=${RC_TOOL_NOT_READY}）。`);
  if (headline) console.error(`  ${headline}`);
  for (const l of lines) console.error(`  - ${l}`);
  if (hint) console.error(hint);
  console.error(
    `  这一条读作「**我没查**」，不读作「我查了，你有问题」——两者处置相反：\n` +
      `  前者去把环境补齐再重跑，后者去改代码。把前者当后者，就会去修一个根本不存在的缺陷\n` +
      `  （欠账 #155 即此：dist 过期被错报成源码缺陷）。\n`,
  );
  process.exit(RC_TOOL_NOT_READY);
}

/**
 * 门的入口：不新鲜就**立刻退出**，绝不让调用方走到 import dist 那一步。
 * 失败信息里**只讲 dist 没准备好，不讲任何内容结论**（本守卫的全部意义），退出码 **2**。
 *
 * 成功路径也说话：打印被检查的包与两侧时间戳（自证「我这次真的检查了 dist 新鲜度」）。
 * `quiet: true` 只给自检/单测用；门里**不要**开，开了就回到「守卫在不在跑看不出来」的老态。
 */
export function assertDistFresh(entries, { gate = "（未具名门）", root = process.cwd(), quiet = false } = {}) {
  const r = checkDistFreshness(entries, { root });
  if (r.ok) {
    if (!quiet) {
      // 「0 个包被检查」也必须说出来：调用方传了空清单时守卫**什么都没核**，
      // 而这一态与「核过且全新鲜」在屏上原本长得一样 —— 又一次「我没找到 ≠ 它不存在」。
      if (!r.checked.length) console.log(`  · dist 新鲜度守卫：**本次 0 个包被检查**（调用方传入空清单）   [${gate}]`);
      for (const c of r.checked) console.log(`  ${attest(c)}   [${gate}]`);
    }
    return r;
  }

  // 构建命令里必须用 **package.json 的 name**，不是目录名：`packages/contracts` 的包名是
  // `@platform/contracts`，照目录名拼出的 `pnpm --filter contracts build` 是跑不通的
  // —— 一条跑不通的修复建议，会让人以为守卫在乱报。
  const pkgs = [...new Set(r.problems.map((p) => p.pkg).filter(Boolean))];
  const nameOf = (p) => {
    try { return JSON.parse(readFileSync(join(root, p, "package.json"), "utf8")).name || p.split("/").pop(); }
    catch { return p.split("/").pop(); }
  };
  const buildCmd = pkgs.length
    ? pkgs.map((p) => `pnpm --filter ${nameOf(p)} build`).join(" && ")
    : "pnpm -r build";

  exitToolNotReady({
    gate,
    headline: "原因：dist 未构建或落后于 src（**环境**状态，与被扫代码无关）。",
    lines: r.problems.map(describe),
    hint:
      `\n  为什么直接退出而不是照跑：本门读的是 dist、下的却是**源码**结论。dist 落后于 src 时，\n` +
      `  它会说出与源码恰好相反的话，而且是绿的（欠账 #161）。\n` +
      `  「dist 在不在」度量的是构建过没有，不是构建得够不够新——没准备好时本门必须闭嘴。\n\n` +
      `  请先构建再重跑：  ${buildCmd}\n` +
      `  （或直接 pnpm -r build）\n`,
  });
}

/* ══════════════════════ 金丝雀 · 与主逻辑共用 checkDistFreshness ══════════════════════
 *
 * ⛔ CLAUDE.md 铁律 0.6 已落地的机制：门里的金丝雀**必须与主逻辑共用同一份实现**，
 *    不许各抄一份——抄了就是装饰品（改主逻辑时金丝雀拿旧的去测、照样绿，本仓实测过）。
 *    故下面三例全部调用**上面那个** checkDistFreshness，不含任何重复的比较逻辑：
 *      ① 已知必中 STALE：src 比 dist 新 → 必须报过期（这是本守卫存在的理由，不中即工具坏了）
 *      ② 已知必中 MISSING：没有 dist → 必须报未构建
 *      ③ 已知必不中：dist 比 src 新 → 必须放行（防「恒红」这种反向装饰品）
 */
export function selfTest({ verbose = true } = {}) {
  const base = join(tmpdir(), `dist-freshness-canary-${process.pid}`);
  const pkg = join(base, "packages", "canary");
  const cases = [];
  const log = (...a) => verbose && console.log(...a);

  try {
    rmSync(base, { recursive: true, force: true });
    mkdirSync(join(pkg, "src"), { recursive: true });
    mkdirSync(join(pkg, "dist"), { recursive: true });
    const srcFile = join(pkg, "src", "a.ts");
    const distFile = join(pkg, "dist", "a.js");
    writeFileSync(srcFile, "export const a = 1;\n");
    writeFileSync(distFile, "export const a = 1;\n");
    const entry = "packages/canary/dist/a.js";
    const now = Date.now() / 1000;
    const setT = (f, t) => utimesSync(f, t, t);

    // ③ 先测「已知必不中」：dist 比 src 新 100 秒 → 必须放行
    setT(srcFile, now - 200);
    setT(distFile, now - 100);
    let r = checkDistFreshness([entry], { root: base });
    cases.push({ name: "③ dist 新于 src → 放行", want: "OK", got: r.ok ? "OK" : r.problems[0].kind, pass: r.ok });

    // ① 已知必中 STALE：把源码 touch 到比 dist 新 → 必须报过期
    setT(srcFile, now);
    r = checkDistFreshness([entry], { root: base });
    const stale = !r.ok && r.problems[0]?.kind === "STALE";
    cases.push({
      name: "① src 新于 dist → 报 STALE",
      want: "STALE",
      got: r.ok ? "OK" : r.problems[0].kind,
      pass: stale,
      evidence: stale ? `滞后 ${r.problems[0].lagSec.toFixed(1)}s · 最新源码 ${r.problems[0].newestSrc}` : null,
    });

    // ② 已知必中 MISSING：删掉 dist → 必须报未构建
    rmSync(join(pkg, "dist"), { recursive: true, force: true });
    r = checkDistFreshness([entry], { root: base });
    const missing = !r.ok && r.problems[0]?.kind === "MISSING";
    cases.push({ name: "② 无 dist → 报 MISSING", want: "MISSING", got: r.ok ? "OK" : r.problems[0].kind, pass: missing });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }

  /* ── 检测器（auditCoverage 用的 distReadSites）自己的金丝雀 ──
   * 扫描器同样受铁律 0.6 约束：报「这些门读 dist」之前，先证明它分得清「读」与「提及」。
   * ④⑤⑥ 全部走**同一个** distReadSites，用的是本仓真实原句（含首版误判的那一行）。 */
  const probes = [
    // ④ 已知必中：本仓四种真实的读 dist 写法，一条都不许漏
    { want: true, name: "④a 静态 import（check-chain-closure.mjs:16）", code: `import { planSlice } from "../apps/datacore/dist/ontology/slice-planner.js";` },
    { want: true, name: "④b abs() 包装（check-resource-descriptor.mjs:24）", code: `const distContracts = abs("packages/contracts/dist/index.js");` },
    { want: true, name: "④c join(ROOT,\"dist\")（check-validation.mjs:26）", code: `const DIST_DIR = join(DC, "dist");` },
    { want: true, name: "④d resolve()（check-dark-launch-integrity.mjs:59）", code: `const DIST = resolve(ROOT, "apps/datacore/dist/features.js");` },
    // ⑤ 已知必不中：首版正是在这一行上误判（.includes 是**排除** dist，不是读）
    { want: false, name: "⑤ 排除式 .includes（check-crossbranch-reinvent.mjs:80）", code: `.filter((f) => !f.includes("/dist/") && (f.includes("/src/") || f.includes("/test/")));` },
    // ⑥ 已知必不中：遍历时跳过 dist 目录 / 注释里提一嘴
    { want: false, name: "⑥a 遍历跳过（check-gate-ledger.mjs:57）", code: `if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue;` },
    { want: false, name: "⑥b SKIP_DIRS 集合（check-chain-node-singlesource.mjs:527）", code: `const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git"]);` },
    { want: false, name: "⑥c 注释（check-action-wiring.mjs:16）", code: ` * 读源码而非 dist：本门守的是"声明与接线一致"，源码即声明。` },
  ];
  for (const p of probes) {
    const got = distReadSites(p.code).length > 0;
    cases.push({ name: p.name, want: p.want ? "读" : "非读", got: got ? "读" : "非读", pass: got === p.want });
  }

  const ok = cases.every((c) => c.pass);
  for (const c of cases) {
    log(`  ${c.pass ? "✓" : "✗"} ${c.name}（期望 ${c.want}，实得 ${c.got}）${c.evidence ? "\n      证据：" + c.evidence : ""}`);
  }
  if (!ok) {
    log("\n  ⛔ 金丝雀不中 ⇒ 报「**守卫坏了**」，不许报「dist 都是新的」。");
  }
  return { ok, cases };
}

/* ══════════════════════ 覆盖审计 · 读 dist 的门必须接守卫 ══════════════════════
 *
 * 「接线才算做完」（假绿第 9 形态：实现有、测试有、零生产调用方）。但一次性接完还不够——
 * 明天新加一道读 dist 的门，它天然不带守卫，病就复发。故把「读 dist ⇒ 必须 import 本守卫」
 * 做成可机械核的断言，由 check-dist-freshness.mjs 在 gates 链上每次现算。
 *
 * ⚠️ 判据是「**读** dist」不是「**提** dist」——本仓 28 个门脚本提到 dist，其中 9 个只是
 *    把 dist 当作遍历时要跳过的目录名（`if (e.name === "dist") continue`）或注释里写
 *    「读源码而非 dist」。把这 9 个算成读 dist，就是又一次「提及 ≠ 读取」。
 */
/** 行内出现了含 dist 的字符串字面量（`".../dist/x.js"` 或 `"dist"`）。 */
const RE_DIST_LITERAL = /["'`][^"'`\n]*(?:\bdist\/|^dist$|\/dist$|\bdist)[^"'`\n]*["'`]/;
/**
 * 读取动词：只有这些才叫「**读** dist」。
 * （`abs`/`rd` 是本仓门里常见的路径包装器，见 check-resource-descriptor.mjs / gate-census.mjs。）
 */
const RE_READ_VERB = /\b(?:from|import|readFileSync|readdirSync|existsSync|statSync|lstatSync|resolve|join|abs|rd|pathToFileURL)\s*[（(]|^\s*import\s|\bfrom\s+["'`]/;
/**
 * 排除上下文：dist 只是被**判等/排除**的目录名，不是被读的路径。
 * ⛔ 这条是本检测器自己踩过的坑（写下即实测命中）：`check-crossbranch-reinvent.mjs:80`
 *    的 `.filter((f) => !f.includes("/dist/") && …)` 是在**排除** dist，却被首版正则算成读 dist ——
 *    「提及 ≠ 读取」的同一个病，检测器自己犯了一次。故此排除项由 selfTest 的 ⑤ 用**真实原句**钉死。
 */
const RE_EXCLUDE_CTX = /\.(?:includes|startsWith|endsWith|indexOf|lastIndexOf|has|add|delete)\s*\(|new\s+Set\s*\(|[!=]==?\s*["'`][^"'`\n]*\bdist\b/;

/**
 * 第四道判据：**这条 dist 路径在本仓真的存在吗**。
 *
 * ⛔ 由 `check-redline-wired.mjs:242` 逼出来（2026-08-13 实测）。那一行是它自己的
 *    金丝雀样例，`code:` 属性里放着一段**当作数据的源码**：
 *
 *      { name: "**门脚本经 dist 动态 import**", want: true, path: "scripts/check-canary.mjs",
 *        code: `const m = await import("../apps/x/dist/def.js");\nm["${SYM}"]({});` },
 *
 *    它是**模板字符串里的假源码**，不是这个门自己的 import —— `check-redline-wired.mjs`
 *    运行时一次 dist 都不读（它只 `await import("typescript")`）。剥注释救不了：
 *    这段在**代码里**，不在注释里，和上面 `AUDIT_SELF_EXCLUDE` 那条记的是同一个病
 *    （检测器把别人的**示例文本**当成了真代码）。
 *
 * 形态（CLAUDE.md 铁律 0.6 句式）：
 *   **「我用『这行里有个长得像 dist 路径的字符串』当作『这个门读了 dist』的证据，而前者并不度量后者。」**
 *
 * 判据取「包根存不存在」而不是文件级 existsSync：dist 是构建产物，**没 build 时整个
 * dist 目录都不在**，拿它当判据会在干净 checkout 上把所有真读取点判成不存在（假绿方向，更坏）。
 * 而**包根**（`apps/datacore` / `packages/contracts`）是源码目录，任何时候都在。
 * 样例里的 `apps/x` 本仓不存在 ⇒ 判为示例文本；真读取点如 `apps/datacore/dist/...` 照旧命中。
 */
function distPathIsReal(line, root) {
  const m = line.match(/["'`]([^"'`\n]*?\/?dist(?:\/[^"'`\n]*)?)["'`]/);
  if (!m) return true; // 取不出路径 ⇒ 不敢排除，按命中处理（宁可假红，不可假绿）
  const p = m[1].replace(/^(?:\.\.?\/)+/, "");
  const i = p.indexOf("dist");
  if (i <= 0) return true; // 形如 "dist" 的裸目录名，无包根可核 ⇒ 保守按命中
  const pkgRoot = p.slice(0, i).replace(/\/+$/, "");
  if (!pkgRoot) return true;
  return existsSync(join(root, pkgRoot));
}

/** 一个门脚本是否**读** dist（而非只是提到 dist）。逐行判定，返回命中的行。 */
export function distReadSites(text, { root = process.cwd() } = {}) {
  const hits = [];
  const lines = text.split("\n");
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    // 去掉注释：块注释（/** ... */）与行注释，避免「读源码而非 dist」这类句子被算成读 dist。
    if (inBlockComment) {
      const end = line.indexOf("*/");
      if (end < 0) continue;
      line = line.slice(end + 2);
      inBlockComment = false;
    }
    const bs = line.indexOf("/*");
    if (bs >= 0) {
      const be = line.indexOf("*/", bs + 2);
      if (be < 0) { inBlockComment = true; line = line.slice(0, bs); }
      else line = line.slice(0, bs) + line.slice(be + 2);
    }
    const ls = line.indexOf("//");
    if (ls >= 0) line = line.slice(0, ls);
    if (!line.trim()) continue;
    if (!/\bdist\b/.test(line)) continue;
    if (!RE_DIST_LITERAL.test(line)) continue;   // dist 必须出现在字符串字面量里（才可能是路径）
    if (RE_EXCLUDE_CTX.test(line)) continue;     // 判等/成员测试/排除 ⇒ 提及，不是读取
    if (!RE_READ_VERB.test(line)) continue;      // 必须有读取动词 ⇒ 真的在加载/探测这条路径
    if (!distPathIsReal(line, root)) continue;   // 路径的包根本仓不存在 ⇒ 是示例文本，不是真读取点
    hits.push({ line: i + 1, text: line.trim().slice(0, 160) });
  }
  return hits;
}

/**
 * 审计自身要排除的文件：`check-dist-freshness.mjs` 是**审计者**，它的修法提示里带着
 * `import(".../dist/…")`、`assertDistFresh([…])` 这类**示例字符串**（在代码里，不在注释里，
 * 故剥注释也去不掉）。若不排除，它会把自己算成「读 dist 且已接守卫」——两边都是假的：
 * 它既不读 dist，也没调用守卫。**又一次「提及 ≠ 读取」，这次是检测器把自己的帮助文本当成了代码。**
 */
const AUDIT_SELF_EXCLUDE = new Set(["check-dist-freshness.mjs"]);

export function auditCoverage({ root = process.cwd() } = {}) {
  const dir = join(root, "scripts");
  const rows = [];
  for (const f of readdirSync(dir).filter((f) => /^check-[a-z0-9-]+\.mjs$/.test(f) && !AUDIT_SELF_EXCLUDE.has(f)).sort()) {
    const text = readFileSync(join(dir, f), "utf8");
    const sites = distReadSites(text);
    if (!sites.length) continue;
    const guarded = /from\s+["'`]\.\/dist-freshness\.mjs["'`]/.test(text) && /assertDistFresh\s*\(/.test(text);
    rows.push({ file: f, sites, guarded });
  }
  return rows;
}

/* ══════════════════════ CLI ══════════════════════ */
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) {
    console.log("dist-freshness 金丝雀（与主逻辑共用 checkDistFreshness）：");
    const r = selfTest();
    // 金丝雀不中 = **守卫自己坏了**，同样属「门没准备好」⇒ RC=2，不是 1。
    // （1 会被读成「被扫代码有问题」，而这里根本还没开始扫任何代码。）
    process.exit(r.ok ? 0 : RC_TOOL_NOT_READY);
  } else if (argv.includes("--audit")) {
    const rows = auditCoverage();
    for (const r of rows) console.log(`${r.guarded ? "✓ 已接守卫" : "✗ 未接守卫"}  ${r.file}  （读 dist ${r.sites.length} 处，首处 L${r.sites[0].line}）`);
    console.log(`\n合计读 dist 的门 ${rows.length} 条 · 已接 ${rows.filter((r) => r.guarded).length} · 未接 ${rows.filter((r) => !r.guarded).length}`);
    process.exit(0);
  } else {
    // 直接当 CLI 用：node scripts/dist-freshness.mjs <distPath...>
    if (!argv.length) {
      console.error("用法：node scripts/dist-freshness.mjs [--self-test|--audit|<dist 路径…>]");
      process.exit(2);
    }
    assertDistFresh(argv, { gate: "dist-freshness (CLI)" });
    console.log("✓ dist 新鲜（" + argv.join(" · ") + "）");
  }
}
