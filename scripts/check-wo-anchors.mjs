#!/usr/bin/env node
/**
 * WO 派单锚点校验门 —— **派单前**把工单里引用的每个 `path:line (symbol)` / 裸 `path` 现场验一遍。
 *
 * ── 来历：2026-08-13 一天之内，我（审核方）写的工单里连出三处事实错误，全部由 dev 顶回来 ────
 *
 * | # | 我在工单里写的 | 实测 | 若 dev 信了 |
 * |---|---|---|---|
 * | 1 | 「源分支 @9a54d5da，最后提交是『wip 被中途叫停·未完成未验证』」 | tip 是 `dfd42b06`；wip 那句属于两个**共享祖先**提交，且该分支**早已全并入 canonical** | 在一张空单上花一整轮 |
 * | 2 | 「`apps/agentcore/src/workflow/workflow-engine.ts:194` 有 PAUSED」 | agentcore **没有这个文件**（全树 PAUSED 零命中）；真身是 `apps/datacore/src/databuilder/workflow-engine.ts:194` —— **行号恰好对、路径错**，比全错更能骗人 | 去 agentcore 里找一个不存在的东西 |
 * | 3 | 「canonical 缺的整文件：`BuildPipelinesPage.tsx`」 | 文件确实缺，但**能力早已存在**（`PipelineConfigPage.tsx` + `/admin/pipelines` 三处注册齐全） | 重复造一整个页，同一能力两套 DOM 契约 |
 *
 * **三次同一个形态**（CLAUDE.md 铁律 0.6 句式）：
 *   **「我用『我记忆/审计快照里的 file:line』当作『今天的接线』的证据，而前者并不度量后者。」**
 *
 * 已达第 3 次 ⇒ 必须建机制、且机制的判据是「**下次同样的错发生时，是机器先说话，不是人先想起来**」。
 * 检查清单不算机制（本仓自己的第 11 条错账原话：写在文档里的纪律不是机制）。
 *
 * ── 用法 ────────────────────────────────────────────────────────────────────
 *   node scripts/check-wo-anchors.mjs <工单文件>          # 校验一个 md
 *   cat prompt.txt | node scripts/check-wo-anchors.mjs -  # 校验 stdin（派 agent 前的提示词）
 *
 * ── 退出码三分（与本仓其它门同口径）────────────────────────────────────────
 *   0 = 全部锚点现场可验证
 *   1 = 有锚点对不上（**别派这张单**，先改）
 *   2 = **门自己坏了**（金丝雀不中 / 读不到仓库）⇒ 本次结论作废，不许读成「锚点都对」
 *
 * ⚠️ 本门**不**声称能查出第 3 类错（「文件缺 ≠ 能力缺」）—— 那要语义判断，机器给不出。
 *    它只关死第 1、2 类（路径不存在 / 符号不在该行附近 / 分支已并入）。
 *    第 3 类的对策写在工单模板里：**凡以「canonical 缺某文件」立单，必须先复核该能力是否已有别的承载物**。
 *    这条边界必须诚实说出来，否则本门自己就变成「我用『锚点门绿了』当作『工单没错』的证据」。
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

/** 容差：代码会漂，锚点指到 ±N 行内认对；超出即报漂移（与 ontology-anchors 门同精神）。 */
const LINE_TOLERANCE = 40;

function die2(msg) {
  console.error(`⛔ 门自己坏了：${msg}`);
  console.error("   本次结论作废 —— **不许**读成「锚点都对」。RC=2");
  process.exit(2);
}

/** 抽取形如 `apps/x/src/y.ts:123 (symbol)` 或 `apps/x/src/y.ts:123` 或裸 `apps/x/src/y.ts` 的引用。 */
function extractAnchors(text) {
  const out = [];
  // ⚠ 扩展名的交替顺序**是判据不是风格**：正则交替是**最左优先**，写成 `ts|tsx` 会把
  //   `BuildPipelinesPage.tsx` 截成 `BuildPipelinesPage.ts` ⇒ 门去查一个不存在的路径、
  //   报出**假的** FILE_MISSING。本门第一次跑就犯了（2026-08-13 实测），形态正是它自己要防的那句：
  //   「我用『我截出来的那个路径』当作『工单写的那个路径』的证据。」长的必须排前面。
  //   ⚠️ 第一版只把 `tsx` 挪到 `ts` 前面 —— **只修了看见的那一半**：`js|json` 同病，
  //   `scripts/gate-ledger.json` 照样被截成 `.js`（2026-08-13 第二次实测，门自己咬出来的）。
  //   光靠排序是「撞见一个补一个」，故补 `(?![A-Za-z0-9])`：**任何**扩展名都不许只匹前缀。
  //   两层都留着 —— 断言是判据，排序是冗余。金丝雀三条分别钉住 tsx / json / 未列出的 mdx。
  const re = /`?((?:apps|packages|scripts|docs)\/[A-Za-z0-9_./@-]+\.(?:tsx|ts|mjs|json|jsonc|js|sql|md|css|sh)(?![A-Za-z0-9]))(?::(\d+))?`?(?:\s*\(([A-Za-z0-9_$.]+)\))?/g;
  for (const m of text.matchAll(re)) {
    out.push({ file: m[1], line: m[2] ? Number(m[2]) : null, symbol: m[3] ?? null, raw: m[0] });
  }
  return out;
}

/** 抽取形如 `origin/claude/xxx` 或 `claude/handoff-wo-xxx` 的分支引用。 */
function extractBranches(text) {
  const out = new Set();
  for (const m of text.matchAll(/`?((?:origin\/)?claude\/[a-z0-9][a-z0-9/-]*)`?/g)) out.add(m[1]);
  return [...out];
}

function git(args) {
  try {
    return { ok: true, out: execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim() };
  } catch (e) {
    return { ok: false, out: String(e.stdout ?? "") + String(e.stderr ?? ""), rc: e.status };
  }
}

// ── 金丝雀：抽取器与 git 都必须先自证，否则「零命中」读成「工单干净」就是本仓的老病 ──────
function canary() {
  let passed = 0, total = 0;
  const check = (label, ok, why) => { total++; if (ok) passed++; else die2(`${label} 失败：${why}`); };

  const positives = extractAnchors("见 `apps/datacore/src/app.ts:100 (foo)` 与 scripts/gate.sh 两处");
  check("正金丝雀·锚点", positives.length === 2, `必中样例应抽出 2 个锚点，实得 ${positives.length}`);
  const negatives = extractAnchors("这段话里没有任何文件路径，只有 foo.bar 和 100:200");
  check("负金丝雀·锚点", negatives.length === 0, `不可能样例抽出了 ${negatives.length} 个 ⇒ 正则过宽`);
  // .tsx 专项金丝雀：钉死「交替最左优先」那个 bug（本门第一次跑就犯过，见 extractAnchors 注释）。
  const tsx = extractAnchors("`apps/frontend-shell/src/pages/admin/BuildPipelinesPage.tsx`");
  check("正金丝雀·tsx 不被截断", tsx.length === 1 && tsx[0].file.endsWith(".tsx"), `抽出 ${JSON.stringify(tsx.map((a) => a.file))} ⇒ 扩展名被截`);
  const js = extractAnchors("`scripts/gate-ledger.json` 与 `scripts/x.js`");
  check("正金丝雀·json 不被截断", js.length === 2 && js[0].file.endsWith(".json") && js[1].file.endsWith(".js"),
        `抽出 ${JSON.stringify(js.map((a) => a.file))} ⇒ 扩展名被截`);
  // 第三条专钉**边界断言**本身。上面两条其实是「长优先排序」在挡，把断言删掉它们照样绿 ——
  // 那样金丝雀只是在给排序背书，断言这一层等于没测（2026-08-13 实测：删断言后 RC 仍 0）。
  // `docs/x.mdx` 是排序挡不住的形态：清单里没有 mdx，`md` 会匹上前缀，只有断言拦得住。
  const mdx = extractAnchors("见 `docs/x.mdx`");
  check("负金丝雀·未列出的扩展名不许匹前缀", mdx.length === 0,
        `抽出 ${JSON.stringify(mdx.map((a) => a.file))} ⇒ 边界断言失效，会报出假的 FILE_MISSING`);
  const br = extractBranches("基线 `origin/claude/inspiring-gates-aqczjg`，交回 claude/handoff-wo-x");
  check("金丝雀·分支抽取", br.length === 2, `应抽出 2 条，实得 ${br.length}`);
  // git 自证：判据必须落在 **RC** 上，不是输出非空 —— `git rev-parse` 不带 `--verify -q` 时
  // 路径不存在会把输入串**原样打到 stdout**（git 2.43 实测 RC=128），只看输出的调用会被骗。
  check("git 正金丝雀", git(["rev-parse", "--verify", "-q", "HEAD:package.json"]).ok, "读不到 HEAD:package.json");
  check("git 负金丝雀", !git(["rev-parse", "--verify", "-q", "HEAD:__no_such_file_zzz__"]).ok, "不存在的路径也报成功 ⇒ 判据恒真");

  return { passed, total, detail: "锚点正/负 · tsx/json 不截断 · mdx 前缀不匹 · 分支抽取 · git 正/负" };
}

function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("用法：node scripts/check-wo-anchors.mjs <工单.md>  |  cat prompt.txt | node scripts/check-wo-anchors.mjs -");
    process.exit(2);
  }
  const c = canary();
  const text = arg === "-" ? readFileSync(0, "utf8") : readFileSync(path.resolve(arg), "utf8");
  if (!text.trim()) die2("输入为空 —— 空输入必然零命中，那不是「工单干净」");

  const problems = [];
  const anchors = extractAnchors(text);
  const seen = new Set();
  let checkedFiles = 0, checkedLines = 0;

  for (const a of anchors) {
    const key = `${a.file}:${a.line ?? ""}:${a.symbol ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const abs = path.join(ROOT, a.file);
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      problems.push({
        kind: "FILE_MISSING",
        raw: a.raw,
        msg: `路径不存在：${a.file}`,
        hint: `别急着说「这个能力没有」—— 先找同名/近名文件：git ls-files | grep -i ${path.basename(a.file, path.extname(a.file))}`,
      });
      continue;
    }
    checkedFiles++;
    if (a.symbol) {
      const lines = readFileSync(abs, "utf8").split("\n");
      const hits = [];
      lines.forEach((l, i) => { if (l.includes(a.symbol)) hits.push(i + 1); });
      if (hits.length === 0) {
        problems.push({ kind: "SYMBOL_MISSING", raw: a.raw, msg: `符号 \`${a.symbol}\` 在 ${a.file} 里零命中`, hint: `git grep -n "${a.symbol}" -- 'apps/*/src/*' 'packages/*/src/*' 看它真在哪个包` });
      } else if (a.line != null) {
        checkedLines++;
        const nearest = hits.reduce((b, h) => (Math.abs(h - a.line) < Math.abs(b - a.line) ? h : b), hits[0]);
        if (Math.abs(nearest - a.line) > LINE_TOLERANCE) {
          problems.push({ kind: "LINE_DRIFT", raw: a.raw, msg: `锚点漂了 ${Math.abs(nearest - a.line)} 行：声称 :${a.line}，\`${a.symbol}\` 实际最近在 :${nearest}`, hint: "改成实际行号；漂 >40 行说明工单是照旧快照写的" });
        }
      }
    } else if (a.line != null) {
      const total = readFileSync(abs, "utf8").split("\n").length;
      checkedLines++;
      if (a.line > total) {
        problems.push({ kind: "LINE_OOB", raw: a.raw, msg: `${a.file} 只有 ${total} 行，锚点却指 :${a.line}`, hint: "裸行号锚点无法自动重算 —— 补上 (symbol) 再验" });
      }
    }
  }

  // 分支：既验存在，也验**是否已全并入 canonical**（判据是祖先关系，不是文件存在性）。
  const CANON = "origin/claude/inspiring-gates-aqczjg";
  const canonOk = git(["rev-parse", "--verify", "-q", `${CANON}^{commit}`]).ok;
  let checkedBranches = 0;
  if (!canonOk) {
    problems.push({ kind: "CANON_UNREACHABLE", raw: CANON, msg: `读不到 canonical ${CANON}（先 git fetch origin）`, hint: "本项判据本次未评估" });
  } else {
    for (const b of extractBranches(text)) {
      const ref = b.startsWith("origin/") ? b : `origin/${b}`;
      // canonical 平凡地是自己的祖先 —— 不排除它，每张单都会被误报「已并入 ⇒ 空单」。
      // 这是本门第一次跑就自曝的第二个 bug（2026-08-13 实测：拿一份真工单跑，唯一那条
      // 「问题」就是它把基线分支本身当成了空单来源）。
      if (ref === CANON) continue;
      if (!git(["rev-parse", "--verify", "-q", `${ref}^{commit}`]).ok) continue; // 待建分支，不算错
      checkedBranches++;
      if (git(["merge-base", "--is-ancestor", ref, CANON]).ok) {
        problems.push({
          kind: "BRANCH_ALREADY_MERGED",
          raw: b,
          msg: `${ref} **已全并入 canonical**（祖先关系成立）⇒ 以它立单多半是空单`,
          hint: `git rev-list --count ${CANON}..${ref}  # 应为 0`,
        });
      }
    }
  }

  // ⚠ 这行数字**现算**，不写死分母。原写「N/5」而 N 只加了 2+2=4 —— 屏上永远显示「4/5」，
  //   看的人会以为有一条金丝雀没过。分母写死是本仓点过名的病（gate.sh 那句「13 条治理门」）。
  console.log(`· 金丝雀 ${c.passed}/${c.total} 通过（${c.detail}）`);
  console.log(`· 现场核过：文件 ${checkedFiles} · 行号 ${checkedLines} · 分支 ${checkedBranches}`);
  console.log("· ⚠️ 本门查不出「文件缺 ≠ 能力缺」那一类（需语义判断）——");
  console.log("     凡以「canonical 缺某文件」立单，仍须人工复核该能力有没有别的承载物。");

  if (problems.length === 0) {
    console.log("✅ check-wo-anchors：工单引用的路径/符号/分支现场全部可验证。RC=0");
    process.exit(0);
  }
  console.log(`\n✗ check-wo-anchors 未通过（${problems.length} 条）—— **别派这张单，先改**：`);
  for (const p of problems) {
    console.log(`  - [${p.kind}] ${p.msg}`);
    console.log(`        原文：${p.raw}`);
    console.log(`        查法：${p.hint}`);
  }
  process.exit(1);
}

main();
