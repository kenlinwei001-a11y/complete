#!/usr/bin/env node
/**
 * 门 `dist-freshness:check`（WO-DIST-FRESHNESS-GUARD · 欠账 #161 · 闭本体 §8 G-DIST-STALE-READ）
 *
 * 治什么：本仓 15 道门 `import(".../dist/x.js")` 之后讲的是**源码**的话，却只查 `existsSync`
 * （构建过没有），从不查新鲜度（构建得够不够新）。dist 一旦落后于 src，它们会说出与源码
 * **恰好相反**的结论，而且是绿的。2026-08-10 一天之内真实误判 4 次，其中一次把「dist 过期」
 * 错报成源码缺陷（欠账 #155）。共享守卫见 `scripts/dist-freshness.mjs`。
 *
 * 为什么还要**这道门**（守卫本身已经接进那 15 道了）：接线是一次性的，**保持接线**不是。
 * 明天新加一道读 dist 的门，它天然不带守卫，病就复发——而且复发时没有任何机器会说话。
 * 故把「读 dist ⇒ 必须接守卫」做成每次 gate 现算的断言（铁律 0.6 二级处置：建机制，
 * 判据是「下次同样的错发生时，是机器先说话，不是人先想起来」）。
 *
 * 三条判据（同时成立才算过）：
 *   ① 守卫自身可信   dist-freshness 的金丝雀全绿（STALE/MISSING 真能报出、新鲜态真放行，
 *                    且检测器分得清「读 dist」与「提 dist」）。**先自证工具，再报结论。**
 *   ② 覆盖无缺口     每个**读** dist 的 `check-*.mjs` 都 import 了守卫并真调用。
 *   ③ 金丝雀非装饰   ①用的实现与 15 道门在生产中用的是**同一个** checkDistFreshness——
 *                    本门只 import，不另抄一份比较逻辑（抄了就是装饰品：改主逻辑时
 *                    金丝雀拿旧的去测、照样绿，本仓实测过）。
 *
 * ⚠️ 本门自己**不**判断任何一个包的 dist 新不新（那是被守门的 15 道门各自在运行时做的事）。
 *    本门只断言「守卫可信 + 处处接上」，故它在 dist 未构建时也应能跑——不给构建加前置。
 *
 * 用法：node scripts/check-dist-freshness.mjs   ·   pnpm dist-freshness:check
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7 门 dist-freshness:check · §8 G-DIST-STALE-READ。
 */
import { selfTest, auditCoverage } from "./dist-freshness.mjs";

const fail = [];

/* ---------- ① 守卫自身可信（金丝雀先行） ---------- */
console.log("· ① 守卫金丝雀（与 15 道门共用同一份 checkDistFreshness / distReadSites）：");
const canary = selfTest({ verbose: true });
if (!canary.ok) {
  const bad = canary.cases.filter((c) => !c.pass).map((c) => `${c.name}（期望 ${c.want}，实得 ${c.got}）`);
  fail.push(
    `① 守卫金丝雀不中 ${bad.length} 例：${bad.join("；")}\n` +
      `     ⇒ 报「**守卫坏了**」，**不许**报「dist 都是新的 / 覆盖没问题」——` +
      `「我没找到」和「它不存在」是两个不同的命题。`,
  );
}

/* ---------- ② 覆盖无缺口 ---------- */
const rows = auditCoverage();
const unguarded = rows.filter((r) => !r.guarded);

// 金丝雀的另一半：普查器若一条都没抽到，那是抽取器坏了，不是"本仓没有门读 dist"。
// （2026-08-08 的 BUILTIN_VIEWS 抽取器抽出 0 条、却被读成"后端全不下发"，同一个形态。）
if (rows.length === 0) {
  fail.push(
    "② 覆盖普查抽到 **0 道**读 dist 的门 —— 这不是「本仓没有门读 dist」，而是 distReadSites 抽取器坏了。" +
      "本仓已知至少 15 道门读 dist（check-chain-closure / check-resource-descriptor / check-dril-* …）。",
  );
} else {
  for (const r of unguarded) {
    fail.push(
      `② 覆盖缺口：scripts/${r.file} 读 dist（L${r.sites.map((s) => s.line).join("/")}）却未接新鲜度守卫。\n` +
        `     修法：import { assertDistFresh } from "./dist-freshness.mjs";\n` +
        `           并在**任何** import(".../dist/…") 之前调用 assertDistFresh([…dist 路径…], { gate: "<别名>" })。\n` +
        `     ⚠ 若该门用的是**静态** import dist，必须先改成 await import —— 静态 import 会提升到\n` +
        `       模块体最前，写在下面的守卫晚于它执行，形同虚设（check-chain-closure.mjs 即此例）。`,
    );
  }
}

/* ---------- 报告 ---------- */
console.log(
  `· ② 覆盖：读 dist 的门 ${rows.length} 条 · 已接守卫 ${rows.length - unguarded.length} · 未接 ${unguarded.length}`,
);
for (const r of rows) console.log(`    ${r.guarded ? "✓" : "✗"} ${r.file}（读 dist ${r.sites.length} 处）`);

if (fail.length) {
  console.error(`\n✗ dist-freshness:check 未通过（${fail.length} 条）：`);
  for (const m of fail) console.error(`  - ${m}`);
  process.exit(1);
}
console.log(`\n✓ dist-freshness:check 通过（守卫金丝雀 ${canary.cases.length}/${canary.cases.length} 中 · 读 dist 的 ${rows.length} 道门全部接线）。`);
