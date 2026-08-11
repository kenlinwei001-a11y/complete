#!/usr/bin/env node
/**
 * WO-INTEGRATION-LOOP · handoff 并线台账门（治「并线状态只存在于审核方脑子里」）。
 *
 * ⛔ 存在理由 = 一次真实误判：审核方（我）凭记忆向仓主报告「四条 handoff 分支全未并线」，
 *    实测其中三条**早已并进 canonical**，只是 cherry-pick 换了 commit hash ——
 *    分支的 ahead/behind 因此永远非零，**从分支状态根本判断不出它并没并**。
 *    于是「并了没有」这个事实没有任何机器可读的载体，只能靠人肉记忆与口头中转，
 *    错报、漏并、重复并线都不会触发任何告警。
 *
 * 本门把并线状态变成**可校验属性**：
 *   对每条 `claude/handoff-*` 远端分支，取它相对 canonical 的**自身引入改动**
 *   （merge-base..branch），逐文件与 canonical 现状比对，判三态：
 *     INTEGRATED  分支引入的文件在 canonical 全部存在且内容等价 → 已并线
 *     PENDING     分支新增的文件在 canonical **缺失** → 强信号：真有未并内容
 *     REVIEW      文件都在但内容有差异 → 弱信号：可能是 canonical 又往前改了，需判定
 *   PENDING / REVIEW 必须在 `docs/HANDOFF-LEDGER.md` 显式登记（并线提交号 / 驳回理由 / 挂起原因），
 *   未登记即红——「漏了一条」从此是可见的红，而不是静默积压。
 *
 * 时效窗：只对最近 `--days N`（默认 21）有活动的分支强制登记；更早的历史分支列为 STALE 仅提示，
 * 避免几十条陈年分支把门变成长期红灯（那会让门被无视，等于没有门）。
 *
 * 用法：node scripts/check-handoff-integration.mjs [--days 21] [--canonical <ref>] [--json]
 * CI 前置：actions/checkout 需 `fetch-depth: 0`（否则取不到其它分支，本门诚实跳过并说明）。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const DAYS = Number(argOf("--days", "21"));
const CANONICAL = argOf("--canonical", "origin/claude/inspiring-gates-aqczjg");
const AS_JSON = argv.includes("--json");
const LEDGER = "docs/HANDOFF-LEDGER.md";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
/** 探测式调用：不存在的 ref/path 是**正常分支**（正是本门要检出的信号），故吞掉 stderr 噪音。 */
const gitOk = (...args) => {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};

if (gitOk("rev-parse", "--verify", CANONICAL) === null) {
  console.error(`✗ 并线台账门：取不到 canonical 引用 ${CANONICAL}`);
  console.error("  CI 请为 actions/checkout 设置 fetch-depth: 0 并 fetch 全部分支；本地请先 git fetch origin。");
  process.exit(2);
}

const branches = git("for-each-ref", "--format=%(refname:short)%09%(committerdate:unix)", "refs/remotes/origin")
  .split("\n")
  .map((l) => l.split("\t"))
  .filter(([name]) => /^origin\/claude\/handoff-/.test(name))
  .map(([name, ts]) => ({ ref: name, name: name.replace(/^origin\//, ""), ts: Number(ts) }));

const nowTs = Number(git("log", "-1", "--format=%ct", CANONICAL));
const cutoff = nowTs - DAYS * 86400;

/** 分支自身引入的改动（merge-base..branch），与 canonical 现状逐文件比对。 */
function classify(b) {
  const mb = gitOk("merge-base", CANONICAL, b.ref);
  if (!mb) return { state: "REVIEW", reason: "无共同祖先（历史分裂），需人工判定", missing: [], differing: [] };
  const changed = (gitOk("diff", "--name-only", `${mb}`, b.ref) ?? "").split("\n").filter(Boolean);
  if (changed.length === 0) return { state: "INTEGRATED", reason: "分支相对合并基无改动", missing: [], differing: [] };

  const missing = [];
  const differing = [];
  for (const f of changed) {
    const onBranch = gitOk("rev-parse", `${b.ref}:${f}`);
    const onCanon = gitOk("rev-parse", `${CANONICAL}:${f}`);
    if (onBranch === null) continue; // 分支删除的文件：不作为未并信号
    if (onCanon === null) {
      missing.push(f);
      continue;
    }
    if (onBranch !== onCanon) differing.push(f);
  }
  if (missing.length > 0) {
    return { state: "PENDING", reason: `canonical 缺 ${missing.length} 个本分支新增文件`, missing, differing };
  }
  if (differing.length > 0) {
    return { state: "REVIEW", reason: `${differing.length} 个文件内容与 canonical 不一致（可能已并线后 canonical 又演进）`, missing, differing };
  }
  return { state: "INTEGRATED", reason: "分支引入的文件在 canonical 全部存在且逐字节一致", missing, differing };
}

/** 台账：`| branch | 状态 | 说明 |` 行；状态取 已并线 / 已驳回 / 挂起。 */
function readLedger() {
  const m = new Map();
  if (!existsSync(LEDGER)) return m;
  for (const line of readFileSync(LEDGER, "utf8").split("\n")) {
    const cells = line.split("|").map((s) => s.trim());
    if (cells.length < 4) continue;
    const branch = cells[1]?.replace(/^`|`$/g, "");
    if (!branch || !/^claude\/handoff-/.test(branch)) continue;
    m.set(branch, { status: cells[2] ?? "", note: cells[3] ?? "" });
  }
  return m;
}

const ledger = readLedger();
const rows = branches.map((b) => {
  const c = classify(b);
  const led = ledger.get(b.name);
  return { ...b, ...c, ledger: led ?? null, stale: b.ts < cutoff };
});

const byState = (s) => rows.filter((r) => r.state === s);
const fresh = rows.filter((r) => !r.stale);
const isTest = (f) => /\.test\.(ts|tsx)$/.test(f);
/** 最高优先级信号：实现并了线、**咬住它的测试没并线** —— CI 从此跑的是缺牙的测试集。 */
for (const r of rows) r.testGap = r.missing.filter(isTest);
const fail = [];

// 强制：时效窗内的 PENDING 必须在台账里有明确处置。
//
// REVIEW **不强制**：分支引入的文件都在 canonical、只是内容有差异——canonical 一直在往前走，
// 任何老分支都会这样，这个信号没有判别力，强制它只会把门变成长期红灯（然后被无视 = 等于没门）。
// 真正有判别力的是 PENDING：canonical **缺**该分支新增的文件。
for (const r of fresh) {
  if (r.state !== "PENDING") continue;
  if (!r.ledger) {
    fail.push(
      `${r.name} 处于 PENDING（${r.reason}）但 ${LEDGER} 无登记 —— ` +
        "并线状态必须落在台账上，不许只存在于某个人的记忆里" +
        (r.testGap.length ? `；且缺失含 ${r.testGap.length} 个**测试**文件（实现并线但接缝测试没并 = CI 跑缺牙测试集）` : ""),
    );
    continue;
  }
  // 台账写「已并线」但 canonical 仍缺该分支的测试文件 → 直接红：这正是本门要抓的头号缺陷。
  if (/已并线/.test(r.ledger.status) && r.testGap.length > 0) {
    fail.push(
      `${r.name} 台账标「已并线」，但 canonical 仍缺 ${r.testGap.length} 个测试文件：` +
        `${r.testGap.slice(0, 3).join(", ")}${r.testGap.length > 3 ? " …" : ""} —— ` +
        "实现并了、咬住它的测试没并，CI 从此跑的是缺牙的测试集。要么补并测试，要么改登记为「挂起」并写明为什么不要这些测试。",
    );
    continue;
  }
  if (!/已并线|已驳回|挂起/.test(r.ledger.status)) {
    fail.push(`${r.name} 台账状态「${r.ledger.status}」不是 已并线/已驳回/挂起 之一`);
  }
  if (/挂起|已驳回/.test(r.ledger.status) && !r.ledger.note) {
    fail.push(`${r.name} 台账标为「${r.ledger.status}」但未写理由（挂起/驳回必须写为什么）`);
  }
}

if (AS_JSON) {
  console.log(JSON.stringify({ canonical: CANONICAL, days: DAYS, rows: rows.map(({ ts, ...r }) => r) }, null, 2));
  process.exit(fail.length ? 1 : 0);
}

const short = (r) => `${r.name}${r.stale ? " (历史)" : ""}`;
console.log(`· handoff 并线台账（canonical=${CANONICAL} · 时效窗 ${DAYS} 天）`);
console.log(
  `  分支 ${rows.length}（时效窗内 ${fresh.length}）· 已并线 ${byState("INTEGRATED").length} · ` +
    `待并 ${byState("PENDING").length} · 内容漂移 ${byState("REVIEW").length}（不阻断·canonical 演进即会如此）`,
);
const allTestGaps = [...new Set(rows.flatMap((r) => r.testGap))];
if (allTestGaps.length) {
  console.log(`  ⚠ 测试并线缺口 ${allTestGaps.length} 个文件 —— 实现已在正线、咬住它的测试不在，CI 跑的是缺牙测试集：`);
  for (const f of allTestGaps) console.log(`      ${f}`);
}
for (const r of fresh.filter((x) => x.state === "PENDING")) {
  console.log(`  · PENDING  ${short(r)} —— ${r.reason}${r.ledger ? `（台账：${r.ledger.status}）` : "（台账未登记）"}`);
  for (const f of r.missing.slice(0, 5)) console.log(`      缺: ${f}${isTest(f) ? "   ← 测试" : ""}`);
  if (r.missing.length > 5) console.log(`      … 共 ${r.missing.length} 个新增文件缺失`);
}
const staleOpen = rows.filter((r) => r.stale && r.state !== "INTEGRATED");
if (staleOpen.length) {
  console.log(`  · 历史分支中仍有 ${staleOpen.length} 条非 INTEGRATED（超出 ${DAYS} 天时效窗，仅提示不阻断）：`);
  console.log(`      ${staleOpen.slice(0, 12).map((r) => r.name).join(", ")}${staleOpen.length > 12 ? " …" : ""}`);
}

if (fail.length) {
  console.error("✗ handoff 并线台账门未通过：");
  for (const f of fail) console.error("  - " + f);
  console.error(`  → 在 ${LEDGER} 为上述分支登记「已并线 / 已驳回 / 挂起」并写明并线提交号或理由。`);
  process.exit(1);
}
console.log("✓ 并线台账门通过（时效窗内每条 handoff 的处置都有明确登记，无静默积压）。");
