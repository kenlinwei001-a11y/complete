#!/usr/bin/env node
/**
 * run-gates.mjs · **门链执行器**（WO-GATES-NO-SHORTCIRCUIT）
 *
 * ══ 治什么 ═════════════════════════════════════════════════════════════════════
 * `pnpm gates` 原本是一条 `&&` 链：**任意一道门红，后面全部不执行**。
 * 2026-09-07 实测（canonical `75d9b222`）：链停在第 **3** 条 `check-system-ontology.mjs`
 * （`packages/contracts/dist/index.js` 未构建）⇒ 第 **4–71 条共 68 道门一次都没跑过**。
 *
 * 形态（CLAUDE.md 铁律 0.6 句式）：
 *   > **「我用『`pnpm gates` RC=1』当作『门链已经把 71 道门都问过了』的证据，
 *   >    而前者并不度量后者 —— 它只度量到**第一道红门为止**，后面全是「没测」。」**
 *
 * 「没测」被读成「红」或「绿」都是事故，本仓已为此付过账：曾据此把一个 agentcore
 * 编译失败的 commit 判为 BUILD 通过并入正线（CLAUDE.md「门必须显式捕获退出码」）。
 *
 * ══ 守的命题 ═══════════════════════════════════════════════════════════════════
 * **名册里的每一道门都必须被执行、各自捕获退出码，且三态在屏上一眼可辨。**
 *
 *   | 态             | 判据                    | 屏上绝不许显示成 |
 *   |----------------|-------------------------|------------------|
 *   | **PASS**       | 真跑了，RC=0            | —                |
 *   | **FAIL**       | 真跑了，RC=1（真违规）  | PASS             |
 *   | **NOT-MEASURED** | **没跑成**：RC=2「工具没准备好」/ 脚本不存在 / 超时 / 被信号杀 / 起不来 | PASS **或** FAIL |
 *
 * RC 三分是本仓既有约定（`docs/SOP-reviewer-claim-discipline.md` §3 ·
 * `scripts/check-gate-exit-discipline.mjs` 守之），本执行器**只做投影，不改任何门的判据**。
 * 尤其：RC=1 一律记 FAIL —— 「某道门崩了也退 1」是那道门自己的纪律问题，
 * 由 `gate-exit-discipline:check` 治；执行器替它改判 = 偷偷放宽判据。
 *
 * ══ 退出码（本执行器自身）══════════════════════════════════════════════════════
 *   0 —— 全部 PASS（且是**全量**运行）
 *   1 —— 有任一 FAIL（⛔ 绝不把红吞成绿）
 *   2 —— 无 FAIL 但有 NOT-MEASURED，或执行器自身坏了（名册取不到 / 金丝雀不中）
 *        —— 「没测出来」不许冒充「干净」，所以它也不是 0。
 *
 * ══ 名册的单一出处 ═════════════════════════════════════════════════════════════
 * 名册**仍然写在 `package.json` 的 `gates` 脚本里**（argv 由它展开），刻意如此：
 * 本仓有三个消费方按**文本**从该字段现算门册，改成外部清单会让它们同时瞎掉 ——
 *   · `scripts/gate-census.mjs`            `refsIn(pkg.scripts.gates)` → GATES_CHAIN 归类
 *   · `scripts/check-ontology-writeback.mjs` `/scripts\/(check-[a-z0-9-]+)\.mjs/g` → §7 登记反查
 *   · `scripts/check-harness-ux-splitaccount.mjs` `gatesChain.includes(SELF)` → 自指接线证明
 * 故本次改动只换**分隔符与执行方式**（`&&` → 执行器 argv），**一个门名都没动**。
 *
 * ══ 金丝雀（铁律 0.6 · 每次运行都先跑）════════════════════════════════════════
 * 报「某某门没执行 / 一道门都没跑」这类**否定结论**之前，先自证量法是对的：
 * 拿 `package.json` 的 `gates` 用**同一个** `extractRoster()`（不另抄正则）解一遍，
 * 必须解出 ≥ `MIN_ROSTER` 道且含必中样例 `CANARY_GATE`。不中 ⇒ 报「**执行器坏了**」RC=2，
 * **不许**报「门册是空的 / 没有门要跑」。
 *
 * ══ 诚实边界（不许把本次结果读过头）══════════════════════════════════════════
 *  · 本执行器只保证「**名册里的门都被启动过、退出码被如实转述**」。
 *    某道门自己射程选错 / 判据写松 / 恒绿，它一个字都不说（那是 `gate-reach:check`
 *    与各门自己的 `--selftest` 的事）。
 *  · **PASS 不等于那道门有牙**；NOT-MEASURED 也**不等于**被扫的代码有问题 —— 它等于「没查」。
 *  · 只跑了名册子集时（`--only`），屏上打「部分运行」横幅，且**不许**读作全量扫描。
 *  · **执行器只报环境、不改环境**：跑门前打一份 dist 体检（`distInventory()`），
 *    但**绝不替你 build** —— 理由写在该函数头注（一 build，dist-freshness 那 15 道门就恒真）。
 *
 * 用法：
 *   node scripts/run-gates.mjs <门脚本…>      # 由 package.json 的 gates 展开 argv
 *   node scripts/run-gates.mjs                # 不给 argv 时自行从 package.json 现算全量名册
 *   node scripts/run-gates.mjs --list         # 只打名册
 *   node scripts/run-gates.mjs --selftest     # 只跑金丝雀
 *   node scripts/run-gates.mjs --verbose      # 连 PASS 的输出一起打
 *   node scripts/run-gates.mjs --only <子串>  # 只跑名字含该子串的门（标记为部分运行）
 *   node scripts/run-gates.mjs --json <路径>  # 另存机读结果
 *   node scripts/run-gates.mjs --timeout-ms N # 单门超时（默认 900000 = 15 分钟）
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG = join(ROOT, "package.json");
const WORKSPACE = join(ROOT, "pnpm-workspace.yaml");

/** 门册下界：低于它一律判「执行器坏了」，不许判「门册空」。今天 71 道，留足删门余量。 */
const MIN_ROSTER = 40;
/** 必中样例：链首那道门。它若解不出来，是量法坏了，不是它没进链。 */
const CANARY_GATE = "scripts/check-merge-conflict-markers.mjs";
const DEFAULT_TIMEOUT_MS = 900_000;

const PASS = "PASS";
const FAIL = "FAIL";
const NOT_MEASURED = "NOT-MEASURED";

/**
 * 门册抽取器 —— **金丝雀与主路径共用的唯一实现**（铁律 0.6：不许各抄一份正则）。
 * 只认 `scripts/check-<小写连字符>.mjs` 这一形态，与 `check-ontology-writeback.mjs`
 * 的抽取口径一字不差，保证两边现算出的门册永远是同一个集合。
 * @param {string} text 任意文本（这里是 package.json 的 gates 脚本原文）
 * @returns {string[]} 去重且保序的门脚本相对路径
 */
export function extractRoster(text) {
  const hits = [...String(text ?? "").matchAll(/scripts\/check-[a-z0-9-]+\.mjs/g)].map((m) => m[0]);
  return [...new Set(hits)];
}

/** 报「执行器坏了」并 RC=2。⛔ 任何情况下都不许改成打印「没有门要跑」然后退 0。 */
function toolBroken(msg, detail) {
  console.error(`\n🛠️  **执行器坏了**（${msg}）`);
  if (detail) console.error(detail);
  console.error(
    "⛔ 不许把本次结果读作「门链干净 / 没有门要跑 / 全绿」——\n" +
      "   「我没查出来」和「它没问题」是两个不同的命题。",
  );
  process.exit(2);
}

/** 金丝雀：拿 package.json 现算一遍，自证 extractRoster 没瞎。 */
export function rosterCanary(pkgText) {
  let gatesSrc;
  try {
    gatesSrc = JSON.parse(pkgText).scripts?.gates ?? "";
  } catch (e) {
    return { ok: false, got: `package.json 解析不出：${e?.message || e}` };
  }
  const roster = extractRoster(gatesSrc);
  if (!roster.length) return { ok: false, got: "从 scripts.gates 解出 0 道门" };
  if (roster.length < MIN_ROSTER) {
    return { ok: false, got: `只解出 ${roster.length} 道门 < 下界 ${MIN_ROSTER}` };
  }
  if (!roster.includes(CANARY_GATE)) {
    return { ok: false, got: `必中样例 ${CANARY_GATE} 没解出来（量法坏了，不是它没进链）` };
  }
  // 反向：确知不该中的形态不许被咬进来（防正则放太松，把散文里的门名也算成接线）。
  const negative = extractRoster("这句话提到 check-不存在的门.mjs 与 scripts/gate.sh，都不该被算成门");
  if (negative.length) return { ok: false, got: `必不中样例被误咬：${negative.join(",")}` };
  return {
    ok: true,
    roster,
    got: `从 package.json:scripts.gates 解出 ${roster.length} 道门 · 必中样例 ${basename(CANARY_GATE)} 在册 · 必不中样例 0 误咬`,
  };
}

/**
 * **环境前置体检**（dist 清单）—— 在跑门**之前**先把「哪些 dist 没构建」摆到屏上。
 *
 * ══ 为什么是「体检」而不是「顺手 build 一下」══════════════════════════════════
 * WO 原话是「能在跑门前统一 build 一次就 build」。**实测后判定：不能，且不该。**
 * `scripts/check-dist-freshness.mjs` 守的正是「dist 不许落后于 src」，它背后有 **15 道门**
 * `import(".../dist/x.js")` 之后讲的是**源码**的话。执行器若在跑门前替它们把 dist 重建一遍，
 * 这 15 道门的新鲜度判据就**恒真** —— 门还在，牙没了。
 * 形态（铁律 0.6 句式）：
 *   > **「我用『跑门前我刚 build 过』当作『被验的那个 commit 的 dist 是新鲜的』的证据，
 *   >    而前者并不度量后者 —— 它度量的是**执行器自己刚干的事**。」**
 * 这与本仓「派 dev 必须 worktree 隔离」那次假绿同族：**信号是真的，只是不指向要断言的对象。**
 * 故执行器**只报不建**：dist 缺就让相关门诚实落到 NOT-MEASURED，并在这里说明原因与修法。
 *
 * ══ 清单从哪来（不许手抄）════════════════════════════════════════════════════
 * 真值 = `pnpm-workspace.yaml` 的 globs → 各包 `package.json` 有没有 `build` 脚本。
 * **不写死包名** —— 手抄的名册迟早与仓库分叉，那正是 `check-gate-roster-handcopied.mjs`
 * 这道门存在的理由。globs 解不出来即报「执行器坏了」，不许静默当成「没有包要建」。
 */
export function distInventory(root = ROOT) {
  let globs = [];
  try {
    // pnpm-workspace.yaml 的 packages 段是 `- "apps/*"` 这种行，取引号里的值即可。
    globs = [...readFileSync(join(root, "pnpm-workspace.yaml"), "utf8").matchAll(/^\s*-\s*["']?([^"'\s]+)["']?\s*$/gm)]
      .map((m) => m[1])
      .filter((g) => g.endsWith("/*"));
  } catch {
    return { ok: false, why: `读不到 ${WORKSPACE}` };
  }
  if (!globs.length) return { ok: false, why: "pnpm-workspace.yaml 里解不出任何 `<目录>/*` glob" };

  const rows = [];
  for (const g of globs) {
    const base = g.slice(0, -2);
    let entries = [];
    try {
      entries = readdirSync(join(root, base));
    } catch {
      continue; // glob 指向的目录不存在 —— 不是错，跳过
    }
    for (const name of entries.sort()) {
      const dir = `${base}/${name}`;
      const pj = join(root, dir, "package.json");
      if (!existsSync(pj)) continue;
      let hasBuild = false;
      try {
        hasBuild = Boolean(JSON.parse(readFileSync(pj, "utf8")).scripts?.build);
      } catch {
        continue;
      }
      if (!hasBuild) continue; // 没有 build 脚本 = 本来就不产 dist，不该报缺
      rows.push({ dir, built: existsSync(join(root, dir, "dist")) });
    }
  }
  if (!rows.length) return { ok: false, why: `${globs.join(" / ")} 下一个带 build 脚本的包都没找到` };
  return { ok: true, globs, rows, missing: rows.filter((r) => !r.built).map((r) => r.dir) };
}

/**
 * 跑一道门，如实转述退出码。
 * ⚠ 这里**必须**读 `spawnSync().status`，不许用管道 + `$?`
 *   （CLAUDE.md「门必须显式捕获退出码」：`cmd | tail` 的 `$?` 取的是 tail 的码，恒 0）。
 */
function runOne(script, timeoutMs) {
  const abs = join(ROOT, script);
  if (!existsSync(abs)) {
    return { state: NOT_MEASURED, rc: null, ms: 0, why: "门脚本在磁盘上不存在（名册与文件系统不同步）", out: "" };
  }
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [abs], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    env: process.env,
  });
  const ms = Date.now() - t0;
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;

  // 起不来（ENOENT / EACCES / 缓冲区爆）＝ 没测出来，不是门红。
  if (r.error) {
    const why =
      r.error.code === "ETIMEDOUT"
        ? `超时（>${timeoutMs} ms）—— 没跑完，结论不成立`
        : `进程起不来：${r.error.code || r.error.message}`;
    return { state: NOT_MEASURED, rc: null, ms, why, out };
  }
  // 被信号杀（含 OOM / 容器重启）＝ 没测出来。
  if (r.signal) {
    return { state: NOT_MEASURED, rc: null, ms, why: `被信号 ${r.signal} 杀掉 —— 没跑完`, out };
  }
  const rc = r.status;
  if (rc === 0) return { state: PASS, rc, ms, why: "", out };
  if (rc === 1) return { state: FAIL, rc, ms, why: "门判负（RC=1）", out };
  // RC=2 是本仓约定的「工具没准备好」；其余非常规码同样只能说「没测出来」。
  const why = rc === 2 ? "门自报「工具没准备好」（RC=2）—— 没查，不是没问题" : `非常规退出码 RC=${rc} —— 没法当成判负`;
  return { state: NOT_MEASURED, rc, ms, why, out };
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (n) => argv.includes(n);
  const valOf = (n, d) => {
    const i = argv.indexOf(n);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
  };

  let pkgText;
  try {
    pkgText = readFileSync(PKG, "utf8");
  } catch (e) {
    toolBroken(`读不到 ${PKG}`, e?.message);
  }

  // ── 金丝雀先行（铁律 0.6：扫描类结论一律先自证工具）────────────────────────
  const canary = rosterCanary(pkgText);
  if (!canary.ok) toolBroken(`门册金丝雀不中：${canary.got}`, `必中样例：${CANARY_GATE} · 下界：${MIN_ROSTER} 道`);
  console.log(`✅ 门册金丝雀：${canary.got}`);
  if (flag("--selftest")) process.exit(0);

  const fullRoster = canary.roster;
  // argv 里的门 = 实际要跑的；package.json 现算的 = 全量真值。两者比对以判「是不是全量」。
  const fromArgv = extractRoster(argv.filter((a) => !a.startsWith("--")).join(" "));
  let roster = fromArgv.length ? fromArgv : fullRoster;
  const only = valOf("--only", null);
  if (only) roster = roster.filter((g) => g.includes(only));
  if (!roster.length) toolBroken("本次要跑的门册为空", "给了 --only 却一个都没匹配到？那是筛错了，不是「没有门」。");

  const missingFromRun = fullRoster.filter((g) => !roster.includes(g));
  const partial = missingFromRun.length > 0;

  if (flag("--list")) {
    for (const [i, g] of roster.entries()) console.log(`${String(i + 1).padStart(2)} ${g}`);
    console.log(`\n合计 ${roster.length} 道（package.json 全量 ${fullRoster.length} 道）`);
    process.exit(0);
  }

  const timeoutMs = Number(valOf("--timeout-ms", DEFAULT_TIMEOUT_MS));
  const verbose = flag("--verbose");

  console.log(
    `\n══ 门链执行器 · 全跑不短路 ══  名册 ${roster.length} 道` +
      (partial ? `（⚠ **部分运行**：全量 ${fullRoster.length} 道，本次跳过 ${missingFromRun.length} 道）` : "（全量）") +
      `\n   单门超时 ${timeoutMs} ms · 三态：PASS 真跑绿 / FAIL 真跑红 / NOT-MEASURED **没跑成**\n`,
  );

  // ── 环境前置体检：先说「哪些 dist 没建」，再跑门 ──────────────────────────────
  // 放在**跑门之前**是刻意的：事后才解释「为什么 16 道没测出来」，读的人已经先把
  // 那 16 道当成绿的了。⚠ 只报不建（理由见 distInventory 的头注）。
  const dist = distInventory();
  if (!dist.ok) {
    toolBroken(`环境前置体检做不了：${dist.why}`, "体检做不了 ⇒ 说不清「没测出来」是环境还是代码 ⇒ 不许开跑。");
  }
  const builtN = dist.rows.length - dist.missing.length;
  console.log(`环境前置体检 · 带 build 脚本的包 ${dist.rows.length} 个（真值：${dist.globs.join(" / ")}）· 已构建 ${builtN} 个`);
  if (dist.missing.length) {
    console.log(`  ⚠ **未构建 ${dist.missing.length} 个**：${dist.missing.join("  ")}`);
    console.log(
      `  ⇒ 读这些 dist 的门会自报 RC=2 落进 **NOT-MEASURED**。那**不是**「这些包没问题」，是「没查」。\n` +
        `  ⇒ 想把它们测出来：先 \`pnpm -r build\`（或按包 \`pnpm --filter <包> build\`）再重跑本执行器。\n` +
        `  ⇒ 执行器**故意不替你 build**：它一 build，dist-freshness 那 15 道门的新鲜度判据就恒真（门还在，牙没了）。`,
    );
  } else {
    console.log(`  ✓ 全部已构建 —— 因缺 dist 而 NOT-MEASURED 的门，本次一道都不该出现。`);
  }
  console.log("");

  const results = [];
  const t0 = Date.now();
  for (const [i, g] of roster.entries()) {
    const r = runOne(g, timeoutMs);
    results.push({ gate: g, ...r });
    const mark = r.state === PASS ? "✓" : r.state === FAIL ? "✗" : "◌";
    const tag = r.state.padEnd(12);
    console.log(
      `[${String(i + 1).padStart(2)}/${roster.length}] ${mark} ${tag} ${basename(g).padEnd(42)} ` +
        `rc=${r.rc === null ? "—" : r.rc}  ${(r.ms / 1000).toFixed(1)}s${r.why ? "  · " + r.why : ""}`,
    );
  }
  const totalMs = Date.now() - t0;

  const by = (s) => results.filter((r) => r.state === s);
  const fails = by(FAIL);
  const notMeasured = by(NOT_MEASURED);
  const passes = by(PASS);

  // ── 非 PASS 的门：打**完整原文**，不许只 tail 几行把错误挤掉（CLAUDE.md 门纪律）──
  for (const r of [...fails, ...notMeasured]) {
    console.log(`\n${"─".repeat(78)}\n${r.state === FAIL ? "✗ FAIL" : "◌ NOT-MEASURED"}  ${r.gate}  (rc=${r.rc === null ? "—" : r.rc})`);
    if (r.why) console.log(`  判据：${r.why}`);
    console.log(r.out.trimEnd() || "（该门无任何输出）");
  }
  if (verbose) {
    for (const r of passes) {
      console.log(`\n${"─".repeat(78)}\n✓ PASS  ${r.gate}`);
      console.log(r.out.trimEnd() || "（该门无任何输出）");
    }
  }

  // ── 汇总 ──────────────────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(78)}\n门链汇总 · 执行 ${results.length} 道 · 用时 ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`  ✓ PASS          ${String(passes.length).padStart(3)} 道  真跑了，绿`);
  console.log(`  ✗ FAIL          ${String(fails.length).padStart(3)} 道  真跑了，红`);
  console.log(`  ◌ NOT-MEASURED  ${String(notMeasured.length).padStart(3)} 道  **没跑成 —— 这一态既不是绿也不是红，是「没查」**`);
  if (fails.length) {
    console.log(`\n  ✗ FAIL 名单：`);
    for (const r of fails) console.log(`     · ${basename(r.gate)}`);
  }
  if (notMeasured.length) {
    console.log(`\n  ◌ NOT-MEASURED 名单（⛔ 不许记成绿，也不许记成红）：`);
    for (const r of notMeasured) console.log(`     · ${basename(r.gate).padEnd(42)} ${r.why}`);
  }
  if (partial) {
    console.log(`\n  ⚠ **部分运行** —— 本次未跑的 ${missingFromRun.length} 道（它们既不是绿也不是红，是没查）：`);
    for (const g of missingFromRun) console.log(`     · ${basename(g)}`);
  }
  // 否定结论必附金丝雀证据（铁律 0.6）。
  console.log(`\n  金丝雀（本汇总的量法自证）：${canary.got}`);

  const jsonPath = valOf("--json", null);
  if (jsonPath) {
    writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          partial,
          skipped: missingFromRun,
          canary: canary.got,
          // 环境前置：解释 NOT-MEASURED 的那一半原因，机读侧也要能看见（否则只剩人读日志）
          distMissing: dist.missing,
          distBuilt: builtN,
          totalMs,
          counts: { PASS: passes.length, FAIL: fails.length, "NOT-MEASURED": notMeasured.length },
          results: results.map(({ gate, state, rc, ms, why }) => ({ gate, state, rc, ms, why })),
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`  机读结果已写：${jsonPath}`);
  }

  if (fails.length) {
    console.error(`\n🔴 门链未通过：${fails.length} 道门判负（RC=1）。⛔ 红不许被吞成绿。`);
    process.exit(1);
  }
  if (notMeasured.length) {
    console.error(
      `\n🟠 门链**没测完**：${notMeasured.length} 道门没跑成（RC=2 / 缺 dist / 超时 / 起不来）。\n` +
        `   ⛔ 这不是「全绿」—— 只许说「我没查出来」。` +
        (dist.missing.length
          ? `\n   本次未构建的包：${dist.missing.join("  ")} ⇒ 先 \`pnpm -r build\` 再重跑，多半能把大部分测出来。`
          : `\n   ⚠ 注意：本次所有带 build 脚本的包**都已构建**，所以这些「没测出来」**不是缺 dist** —— 另有原因，逐条看上面的判据。`),
    );
    process.exit(2);
  }
  if (partial) {
    console.error(`\n🟠 **部分运行**通过，但全量 ${fullRoster.length} 道里有 ${missingFromRun.length} 道没查 —— 不许读作「四包全绿」。`);
    process.exit(2);
  }
  console.log(`\n🟢 门链全绿：${passes.length} 道门全部真跑且判正。`);
  process.exit(0);
}

// 只有直接跑本文件时才执行 —— 被 import 当判据库时不许把宿主进程带走。
// ⚠ `try` 必须是 Program 的直接子语句（与本仓门的兜底形态一致）。
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
try {
  if (isMain) main();
} catch (e) {
  toolBroken("未预期异常", e?.stack ?? String(e));
}
