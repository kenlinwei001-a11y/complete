#!/usr/bin/env node
/**
 * 门 `gate-ledger:check` · 门账与现实一致门（WO-GATE-LEDGER）
 *
 * 治什么：本仓 39 个 `scripts/check-*.mjs` 里只有 21 个真跑，其余在**制度上宣称存在、实际不执行**
 * （假绿第 5 形态 G-DEAD-GATE-BY-POLICY）。病根是 `check-ontology-writeback.mjs` 只查单向
 * 「进 gates 链的门 → 本体 §7 有登记」，**不查反向**——§7 登记了（甚至白纸黑字写「已并入 pnpm gates」）
 * 但根本没接进任何执行路径的门，一个都抓不到。
 *
 * 四条判据（同时成立才算过，PRD-gate-ledger §4.2）：
 *   ① 无遗漏      scripts/check-*.mjs 的文件集合 ⊆ 账的键集合         新加门不登账 → 红
 *   ② 无幽灵      账的键集合 ⊆ 实际存在的文件集合                     删了脚本不删账 → 红
 *   ③ 绑定属实    账里 binding == **现算**普查结果（gate-census 现场跑）  摘门不改账 → 红
 *   ④ 责任边界属实 guardedPaths 非空且每条真实存在（glob ≥1 文件）；
 *                 escalation ∈ {审核方,仓主}；非 GATES_CHAIN 另需 disposition   写不存在的路径 → 红
 *
 * ③ 是这道门的牙：①②④ 只防"忘了写"，③ 防的是"写了但和现实脱节"——本仓所有假绿的共同形状。
 * ③ 必须现算，**不许把普查结果固化进账里自证**（自证循环）。
 *
 * 另：provenRed 棘轮（PRD §4.3/A9）——`NEVER`（从未红过的门）条数记基线，**只降不升**。
 * 一个从未红过的门不算门，但把它藏起来比留着更糟，故不红只暴露 + 棘轮防新增。
 *
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7（门）· §8 G-WRITEBACK-ONE-WAY（本门所闭断点）。
 * 用法：node scripts/check-gate-ledger.mjs   ·   pnpm gate-ledger:check
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
  console.error(`⛔ check-gate-ledger.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { census, listGateScripts } from "./gate-census.mjs";
import { isUnbuiltArtifactPath, exitToolNotReady } from "./dist-freshness.mjs";

const ROOT = process.cwd();
const LEDGER = join(ROOT, "scripts/gate-ledger.json");
const BASELINE = join(ROOT, "scripts/gate-ledger-baseline.json");
const ESCALATIONS = new Set(["审核方", "仓主"]);
const DISPOSITIONS = new Set(["WIRE", "MANUAL", "FOLD", "DELETE"]);

const fail = [];
const warn = [];
/* ⚠️ 2026-08-13 · WO-R9-DISTFRESH-RC2 —— 「没核成」与「核了，不合格」必须分两个桶。
 *
 * 实测（同一个提交，两个 worktree）：
 *   · 已 build 的 worktree → 本门 **RC=0**
 *   · 干净未 build 的 worktree → 本门 **RC=1 / 28 条**，全是 ④「guardedPaths 指向空气」，
 *     指的却是 `apps/datacore/dist/**` 这类**构建产物**路径。
 * **同一份门账，两个结论 ⇒ 这 28 条度量的不是门账，是「跑之前建没建」。**
 * 形态（CLAUDE.md 铁律 0.6 句式）：「我用『门红了』当作『门账写错了』的证据，而前者并不度量后者。」
 *
 * 本桶只改**退出码归属**，一个字都不改 ④ 的判据本身：
 * 「路径解析不到 ⇒ 有问题」照旧成立，只是当它是**整包未构建的产物路径**时，
 * 这条结论读作「我这次没核成」（RC=2），不读作「你门账写错了」（RC=1）。
 * 判据见 `isUnbuiltArtifactPath`：包根必须是真包、且整包 dist 一个文件都没有，才算环境。
 * 包已 build 而单个文件缺 ⇒ 门账写的是过期路径，**仍归 fail（RC=1）**。 */
const envNotReady = [];

/* ---------- 极简 glob：支持 `a/b/**` 与段内 `*`，不引三方依赖 ---------- */
function globMatches(pattern) {
  if (!pattern.includes("*")) return existsSync(join(ROOT, pattern)) ? 1 : 0;
  if (pattern.endsWith("/**")) {
    const dir = join(ROOT, pattern.slice(0, -3));
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return 0;
    return countFiles(dir);
  }
  // 段内通配：只在其父目录里匹配一层
  const dir = join(ROOT, dirname(pattern));
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return 0;
  const re = new RegExp("^" + pattern.split("/").pop().replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
  return readdirSync(dir).filter((f) => re.test(f)).length;
}
function countFiles(dir, depth = 0) {
  if (depth > 6) return 0;
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue;
    if (e.isDirectory()) n += countFiles(join(dir, e.name), depth + 1);
    else n++;
    if (n > 0 && depth > 0) return n; // 早停：只需证明"至少 1 个"
  }
  return n;
}

/* ---------- 读账 ---------- */
if (!existsSync(LEDGER)) {
  console.error("✗ gate-ledger:check：找不到 scripts/gate-ledger.json —— 门账是本门的输入，缺账即红");
  process.exit(1);
}
const ledger = JSON.parse(readFileSync(LEDGER, "utf8"));
const entries = ledger.gates || {};
const ledgerKeys = new Set(Object.keys(entries));
const realFiles = new Set(listGateScripts());

/* ---------- ① 无遗漏 ---------- */
for (const f of realFiles) {
  if (!ledgerKeys.has(f)) fail.push(`① 无遗漏：门脚本 scripts/${f} 未登账（新加门必须同批登账，否则它天然免疫本门治理）`);
}

/* ---------- ② 无幽灵 ---------- */
for (const k of ledgerKeys) {
  if (!realFiles.has(k)) fail.push(`② 无幽灵：账里有 ${k} 但 scripts/ 下不存在该文件（删脚本须同批删账）`);
}

/* ---------- ③ 绑定属实（现算，不读缓存） ---------- */
const live = census();
for (const [f, e] of Object.entries(entries)) {
  if (!realFiles.has(f)) continue;               // ② 已报，避免重复噪声
  const actual = live.scripts[f]?.binding;
  if (e.binding !== actual) {
    fail.push(
      `③ 绑定属实：${f} 账里写 binding="${e.binding}"，现算是 "${actual}"` +
        `（调用方：${(live.scripts[f]?.callers || []).join(" / ") || "无"}）——账与现实脱节`,
    );
  }
}

/* ---------- ④ 责任边界属实 ---------- */
for (const [f, e] of Object.entries(entries)) {
  if (!realFiles.has(f)) continue;
  const paths = e.guardedPaths;
  if (!Array.isArray(paths) || paths.length === 0) {
    fail.push(`④ 责任边界：${f} 的 guardedPaths 为空——门红了没有任何线索能定位到谁该修`);
  } else {
    for (const p of paths) {
      if (globMatches(p) === 0) {
        // 判据不变；只按「这条路径落空是不是因为整包没 build」分桶（见上 envNotReady 注释）。
        if (isUnbuiltArtifactPath(p, { root: ROOT })) {
          envNotReady.push(`${f} 的 guardedPaths「${p}」—— 该包的 dist 整个没构建，本次**无法核**这一条`);
        } else {
          fail.push(`④ 责任边界：${f} 的 guardedPaths 含不存在的路径「${p}」——责任边界指向空气，等于没填`);
        }
      }
    }
  }
  if (!ESCALATIONS.has(e.escalation)) {
    fail.push(`④ 责任边界：${f} 的 escalation="${e.escalation ?? ""}" 非法，只许 审核方 | 仓主`);
  }
  if (live.scripts[f]?.binding !== "GATES_CHAIN") {
    if (!DISPOSITIONS.has(e.disposition)) {
      fail.push(`④ 责任边界：${f} 非 GATES_CHAIN 却无合法 disposition（WIRE|MANUAL|FOLD|DELETE），当前="${e.disposition ?? ""}"`);
    }
  }
}

/* ---------- provenRed 棘轮（只降不升） ---------- */
const neverNow = Object.entries(entries).filter(([f, e]) => realFiles.has(f) && e.provenRed?.kind === "NEVER").length;
let neverBase = null;
if (existsSync(BASELINE)) {
  neverBase = JSON.parse(readFileSync(BASELINE, "utf8")).neverCount;
  if (typeof neverBase === "number" && neverNow > neverBase) {
    fail.push(`provenRed 棘轮：从未红过的门 ${neverNow} 条 > 基线 ${neverBase} 条——只许降不许升（新门必须带反证）`);
  }
} else {
  warn.push("未找到 scripts/gate-ledger-baseline.json —— provenRed 棘轮未生效");
}

/* ---------- 报告 ---------- */
const counts = live.counts;
console.log("· 门脚本普查（现算）：" +
  ["GATES_CHAIN", "GATE_SH", "CI_ONLY", "MANUAL", "NONE"].map((k) => `${k} ${counts[k]}`).join(" · ") +
  ` · 合计 ${counts.total}`);
console.log(`· 门账条目：${ledgerKeys.size} · provenRed 从未红过：${neverNow}${neverBase != null ? `（基线 ${neverBase}）` : ""}`);

const lies = Object.entries(live.claims).filter(([, v]) => v.verdict !== "OK");
if (lies.length) {
  console.log(`· ⚠ 本体 §7 宣称与现实不符 ${lies.length} 条（由 ontology-writeback:check 的反向断言阻断，此处仅提示）：`);
  for (const [f, v] of lies) console.log(`    [${v.verdict}] ${f} §7:${v.ontologyLine} 宣称=${v.claimed} 实际=${v.actual}`);
}
for (const w of warn) console.log(`· ⚠ ${w}`);

// 环境桶最多列 6 条 + 同因汇总：28 条同一个原因逐条重复只会把真信息挤出屏幕（run() 只 tail 几行）。
const envLines = envNotReady.length > 6
  ? [...envNotReady.slice(0, 6), `…另 ${envNotReady.length - 6} 条同因（同为「所属包 dist 未构建」）`]
  : envNotReady;

if (fail.length) {
  // 真违规存在 ⇒ RC 仍是 1（确有该修的东西），但必须同时说清「另有 N 条没核成」，
  // 否则「28 条里只有 2 条是真的」会被读成「28 条都是真的」。
  console.error(`\n✗ gate-ledger:check 未通过（${fail.length} 条）：`);
  for (const m of fail) console.error(`  - ${m}`);
  if (envNotReady.length) {
    console.error(`\n  ⚠ 另有 ${envNotReady.length} 条因所属包 dist 未构建**未能核验**——不计入上面这 ${fail.length} 条，也不代表它们合格：`);
    for (const m of envLines) console.error(`    · ${m}`);
  }
  process.exit(1);
}
// 真判据全过，但有条目没核成 ⇒ **不许**报「通过」。RC=2：门自己没准备好。
if (envNotReady.length) {
  exitToolNotReady({
    gate: "gate-ledger:check",
    headline: `原因：${envNotReady.length} 条 guardedPaths 指向**尚未构建**的 dist 产物（环境状态，与门账内容无关）。`,
    lines: envLines,
    hint: `\n  其余判据（账无遗漏/无幽灵 · binding 与现算一致 · escalation/disposition 合法）本次均已核过且相符；\n` +
      `  唯独上面这 ${envNotReady.length} 条无从判断。请先构建再重跑：  pnpm -r build\n`,
  });
}
console.log("\n✓ gate-ledger:check 通过（账无遗漏/无幽灵 · binding 与现算一致 · 责任边界均可解析）。");
