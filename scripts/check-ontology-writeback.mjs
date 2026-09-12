#!/usr/bin/env node
/**
 * 门 `ontology-writeback:check`（治理 · 反向回写完整性）：
 * 守"代码改了接线（新增门禁）却漏回写本体"——`check-prd-ontology` 只查正向（PRD 引用的 R/G 必须存在），
 * 本门查**反向**：**每个并入 `pnpm gates` 的 `scripts/check-*.mjs` 门，都必须在本体 §7 检测/门禁章节登记**
 * （脚本名出现在 §7）。由来：规则 P2 新增 `no-hardcoded-rules:check` 却漏登 §7，无门可抓 → 立此门。
 *
 * 诚实边界（部分覆盖，非全量）：本门只机械守"门禁(§7)"这一类回写。事件(§4)/契约对象(§2)/链路(§3)
 * 的回写仍需 fde-delivery/铁律0 纪律——机械全量校验它们需更强的代码↔本体双向索引（列为后续）。
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
  console.error(`⛔ check-ontology-writeback.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), "utf8");

// 1) 从 package.json 的 gates 脚本提取所有 check-*.mjs 门 + 它们的 pnpm 别名（§7 多按别名登记）。
const pkg = JSON.parse(read("package.json"));
const scripts = pkg.scripts ?? {};
const gatesCmd = scripts.gates ?? "";
const gateScripts = [...new Set([...gatesCmd.matchAll(/scripts\/(check-[a-z0-9-]+)\.mjs/g)].map((m) => m[1]))];
// script → 所有指向它的 pnpm 别名（如 check-prd-ontology → prd:check）。
const aliasOf = (script) =>
  Object.entries(scripts)
    .filter(([k, v]) => k !== "gates" && typeof v === "string" && v.includes(`scripts/${script}.mjs`))
    .map(([k]) => k);
const uniqueGates = gateScripts;

// 2) 取本体 §7 检测/门禁章节正文（## 7. … 到下一个 ## ）。
const onto = read("docs/SYSTEM-ONTOLOGY.md");
const s7 = onto.match(/\n## 7\.[^\n]*\n([\s\S]*?)\n## 8\./);
const s7Body = s7 ? s7[1] : "";
if (!s7Body) { console.error("✗ ontology-writeback:check：未能定位本体 §7 检测/门禁章节"); process.exit(1); }

// 3) 每个 gates 门脚本必须在 §7 出现（脚本名 或 其任一 pnpm 别名）。
const missing = uniqueGates.filter((g) => {
  if (s7Body.includes(`${g}.mjs`) || s7Body.includes(g)) return false;
  return !aliasOf(g).some((a) => s7Body.includes(a));
});
console.log(`· ontology-writeback：pnpm gates 含 ${uniqueGates.length} 个 check 门 · §7 漏登 ${missing.length}`);

if (missing.length > 0) {
  console.error(`✗ ontology-writeback:check：下列门在 pnpm gates 但本体 §7 未登记（改接线漏回写本体）：${missing.join(", ")}`);
  console.error(`  → 在 docs/SYSTEM-ONTOLOGY.md §7 检测/门禁章节补登该门（名/脚本 + 守什么不变量/断点）。`);
  process.exit(1);
}
console.log("✓ ontology-writeback:check：pnpm gates 所有门均在本体 §7 登记（门禁维回写无遗漏）。");

/* ========================================================================
 * G3 · 反向断言（WO-GATE-LEDGER 追加，不改上方正向逻辑）
 *
 * 病根：上方正向只断言「进 gates 链的门 → §7 有登记」。**反向不查**——§7 登记了、
 * 甚至白纸黑字写着「已并入 `pnpm gates`」，实际却没接进任何执行路径的门，一个都抓不到。
 * #76 的 boundary-singlesource 正是从这个方向漏出去，红着零接线活了 24 个 commit。
 * 首次普查坐实：12 个零调用方门**全部**在 §7 宣称「已并入 pnpm gates」。
 *
 * 三条判据，刻意分开——因为修法完全不同（CLAUDE.md 铁律 0.5）：
 *   G3-a 未登账      §7 提到的门不在门账里 → 红（新门必须同批登账）
 *   G3-b 本体撒谎    §7 宣称「已并入 pnpm gates」而现算不在链上 → 红
 *                    （这不是"漏接线"，是本体自述与现实相反；补一下接线了事会掩盖真问题）
 *   G3-c 待接线棘轮  账里 binding=NONE 且 disposition=WIRE 的门计数，**只降不升**
 *                    （承认存量、封死增量；burn-down 由后续 WO 做，见 PRD §2.2 非目标）
 * ====================================================================== */
{
  const { census } = await import("./gate-census.mjs");
  const { existsSync } = await import("node:fs");
  const ledgerPath = new URL("scripts/gate-ledger.json", root);
  if (!existsSync(ledgerPath)) {
    console.error("✗ ontology-writeback:check G3：找不到 scripts/gate-ledger.json —— 反向断言以门账为准，缺账即红");
    process.exit(1);
  }
  const ledger = JSON.parse(read("scripts/gate-ledger.json")).gates || {};
  const live = census();
  const WIRED = new Set(["GATES_CHAIN", "GATE_SH", "CI_ONLY"]);
  const SIGNED = new Set(["MANUAL", "FOLD", "DELETE"]);
  const bad = [];

  // §7 正文里出现的所有门脚本名（本体宣称受治理的全集）
  const inS7 = [...new Set([...s7Body.matchAll(/check-[a-z0-9-]+\.mjs/g)].map((m) => m[0]))];

  for (const f of inS7) {
    const e = ledger[f];
    if (!e) { bad.push(`G3-a 未登账：本体 §7 提到 ${f}，门账里却没有该条——§7 宣称受治理的门必须在账上`); continue; }
    const actual = live.scripts[f]?.binding ?? "NONE";
    const claim = live.claims[f];
    if (claim?.verdict === "LIE_DEAD") {
      bad.push(
        `G3-b 本体撒谎：${f} 在 §7 行${claim.ontologyLine} 宣称「已并入 pnpm gates」，现算 binding=${actual}（零调用方）。` +
          `\n      ⚠ 这不是漏接线——是本体自述与现实相反。修法：要么真接进 gates 链，要么把 §7 那句改成真话（如「已建·当前未接线，门账 disposition=WIRE」）。` +
          `\n        只补接线不改文案，下一个人仍会读到一句无从核实的断言。`,
      );
      continue;
    }
    if (WIRED.has(actual)) continue;                       // 真接了线
    if (SIGNED.has(e.disposition)) continue;               // 未接线但已签终态处置
    if (e.disposition !== "WIRE") {
      bad.push(`G3-a 未签处置：${f} 未接线（binding=${actual}）且 disposition="${e.disposition ?? ""}" 非法——被制度指定的死门`);
    }
  }

  // G3-c 棘轮：已建未接线（disposition=WIRE 且零调用）只降不升
  const pending = Object.entries(ledger).filter(
    ([f, e]) => e.disposition === "WIRE" && (live.scripts[f]?.binding ?? "NONE") === "NONE",
  );
  let base = null;
  const basePath = new URL("scripts/gate-ledger-baseline.json", root);
  if (existsSync(basePath)) base = JSON.parse(read("scripts/gate-ledger-baseline.json")).pendingWireCount ?? null;
  if (typeof base === "number" && pending.length > base) {
    bad.push(`G3-c 待接线棘轮：已建未接线的门 ${pending.length} 条 > 基线 ${base} 条——只许降不许升`);
  }
  console.log(`· G3 反向：§7 提及 ${inS7.length} 门 · 已建未接线 ${pending.length}${base != null ? `（基线 ${base}）` : ""}`);

  if (bad.length) {
    console.error(`\n✗ ontology-writeback:check G3 反向断言未通过（${bad.length} 条）：`);
    for (const m of bad) console.error(`  - ${m}`);
    process.exit(1);
  }
  console.log("✓ ontology-writeback:check G3：§7 宣称受治理的门均已登账，且无「宣称已接线实则零调用」。");
}
