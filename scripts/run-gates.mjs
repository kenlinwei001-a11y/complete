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
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG = join(ROOT, "package.json");

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
        `   ⛔ 这不是「全绿」—— 只许说「我没查出来」。先补齐前置（多半是 \`pnpm -r build\` 出 dist）再重跑。`,
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
