#!/usr/bin/env node
/**
 * PRD 库结构化门禁（治理 · TODO #2）：把 PRD 语料的《本体引用与影响》解析成机器可读索引，
 * 并对本体校验，使「需求↔制品↔缺口」可查。
 *
 * 产出（三合一，对应 #2 的三目标）：
 *   1) PRD 入图：扫描 docs/PRD-*.md，抽每篇引用的不变量(Rxx)/断点(Gxx)/对象类型/事件 → 写
 *      docs/prd-ontology-index.json（机器可读，CI 与工具/Claude 可查）。
 *   2)《本体引用》机器可解析：解析每篇 §0《本体引用与影响》段（缺段=未读本体，告警）。
 *   3) 需求↔制品↔缺口可查：交叉校验——PRD 引用的 R/G 必须在本体真实存在（悬空引用=红）；
 *      并报告本体断点(G)被哪些 PRD 覆盖、哪些是缺口(无 PRD 提及)。
 *
 * 退出码非 0 = 有悬空引用（PRD 引用了本体不存在的 R/G）——"PRD 与本体漂移"被挡。
 * 用法：node scripts/check-prd-ontology.mjs   （package.json: "prd:check"）
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";

const ONTO = "docs/SYSTEM-ONTOLOGY.md";
const INDEX_OUT = "docs/prd-ontology-index.json";
const DOCS_DIR = "docs";
const fail = [];
const warn = [];

const onto = existsSync(ONTO) ? readFileSync(ONTO, "utf8") : null;
if (!onto) {
  console.error(`✗ 缺少 ${ONTO}`);
  process.exit(1);
}

// --- 本体权威集合：R 不变量（§5）、G 断点（§8）、对象类型（§2）-------------------
const ontoInvariants = new Set([...onto.matchAll(/^\|\s*\*{0,2}(R\d+)\*{0,2}\s*\|/gm)].map((m) => m[1]));
const ontoBreakpoints = new Set([...onto.matchAll(/^\|\s*\*{0,2}(G-\d+)\*{0,2}\s*\|/gm)].map((m) => m[1]));
if (ontoInvariants.size === 0 || ontoBreakpoints.size === 0) {
  console.error("✗ 无法从本体解析 R 不变量 / G 断点表（§5/§8 表格式可能变了）");
  process.exit(1);
}

// --- 扫描 PRD 语料 ----------------------------------------------------------
const prdFiles = readdirSync(DOCS_DIR)
  .filter((f) => f.startsWith("PRD-") && f.endsWith(".md"))
  .sort();

/** 抽取 §0《本体引用与影响》段落：从含"本体引用"的标题到下一个 "## " 标题。 */
function extractOntologySection(text) {
  const lines = text.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^#{1,4}\s.*本体引用/.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

const index = {};
const breakpointCoverage = {}; // Gxx -> [prd...]

for (const file of prdFiles) {
  const text = readFileSync(`${DOCS_DIR}/${file}`, "utf8");
  const section = extractOntologySection(text);
  const hasOntologyRef = section != null;
  // 仅在 §0《本体引用》段内解析 R/G 引用——遗留 PRD 各有自己的 R 需求编号（如 R15–R28、R01），
  // 全文扫描会误判为悬空引用；§0 段才是"对本体的引用"语境。缺 §0 = 告警，不扫正文。
  const invariants = section
    ? [...new Set([...section.matchAll(/\bR\d+\b/g)].map((m) => m[0]))].filter((r) => /^R\d+$/.test(r)).sort()
    : [];
  const breakpoints = section
    ? [...new Set([...section.matchAll(/\bG-\d+\b/g)].map((m) => m[0]))].sort()
    : [];

  // 悬空引用校验（仅 §0 内）：引用的 R/G 必须在本体存在
  for (const r of invariants.filter((r) => !ontoInvariants.has(r))) fail.push(`${file} §0 引用不变量 ${r}，但本体 §5 无此项（悬空引用）`);
  for (const g of breakpoints.filter((g) => !ontoBreakpoints.has(g))) fail.push(`${file} §0 引用断点 ${g}，但本体 §8 无此项（悬空引用）`);
  if (!hasOntologyRef) warn.push(`${file} 缺《本体引用与影响》§0 段（疑未读本体；遗留 PRD 可补）`);

  // 制品锚点（需求↔制品）：PRD 全文引用的实现文件路径 `apps|packages|scripts/....ext`（去重）。
  // 存在性仅告警（遗留 PRD 可能引旧路径），但入索引使"PRD→实现文件"可查。
  const artifacts = [...new Set([...text.matchAll(/`((?:apps|packages|scripts|deploy)\/[A-Za-z0-9_./-]+\.[a-z]{2,4})(?::\d+)?`/g)].map((m) => m[1]))].sort();
  const brokenArtifacts = artifacts.filter((a) => !existsSync(a));
  if (brokenArtifacts.length) warn.push(`${file} 引用的实现文件已删/改名：${brokenArtifacts.slice(0, 4).join(", ")}${brokenArtifacts.length > 4 ? " …" : ""}`);

  index[file] = { hasOntologyRef, invariants, breakpoints, artifacts, brokenArtifacts };
  for (const g of breakpoints) {
    if (!ontoBreakpoints.has(g)) continue;
    (breakpointCoverage[g] ??= []).push(file);
  }
}

// --- 缺口：本体断点中无任何 PRD 提及的 ------------------------------------------
const orphanBreakpoints = [...ontoBreakpoints].filter((g) => !breakpointCoverage[g]).sort();

// --- 写机器可读索引（PRD 入图）-------------------------------------------------
const artifact = {
  generatedAt: new Date().toISOString().slice(0, 10),
  ontology: { invariants: [...ontoInvariants].sort(), breakpoints: [...ontoBreakpoints].sort() },
  prds: index,
  breakpointCoverage,
  orphanBreakpoints,
};
writeFileSync(INDEX_OUT, JSON.stringify(artifact, null, 2) + "\n");

// --- 报告 ------------------------------------------------------------------
const withSection = Object.values(index).filter((p) => p.hasOntologyRef).length;
const totalArtifacts = new Set(Object.values(index).flatMap((p) => p.artifacts)).size;
const totalBroken = Object.values(index).reduce((n, p) => n + p.brokenArtifacts.length, 0);
console.log(`· PRD 语料：${prdFiles.length} 篇；含《本体引用》§0：${withSection} 篇`);
console.log(`· 制品锚点（PRD→实现文件）：${totalArtifacts} 个唯一文件${totalBroken ? `；其中 ${totalBroken} 处已失效（告警）` : "（全部存在）"}`);
console.log(`· 本体集合：不变量 ${ontoInvariants.size}（R）· 断点 ${ontoBreakpoints.size}（G）`);
console.log(`· 断点 PRD 覆盖：${Object.keys(breakpointCoverage).length}/${ontoBreakpoints.size}${orphanBreakpoints.length ? `；无 PRD 缺口：${orphanBreakpoints.join(", ")}` : "（全覆盖）"}`);
console.log(`· 索引已写：${INDEX_OUT}`);
if (warn.length) {
  console.log(`\n⚠ 遗留 PRD 缺《本体引用》§0（${warn.length} 篇，非致命）：`);
  for (const w of warn.slice(0, 12)) console.log(`  - ${w}`);
  if (warn.length > 12) console.log(`  … 余 ${warn.length - 12} 篇`);
}

if (fail.length) {
  console.error("\n✗ PRD 库门禁未通过（PRD 引用了本体不存在的 R/G —— PRD↔本体漂移）：");
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\n✓ PRD 库结构化：无悬空引用；《本体引用》已入图（docs/prd-ontology-index.json）。");
