#!/usr/bin/env node
/**
 * meta:sync 漂移门（Dogfooding PRD §7 / R6）：保证系统本体 markdown 始终可被 meta/parse.ts
 * 确定性投影——即 prd-ontology-index.json 的权威 R/G 集，在 SYSTEM-ONTOLOGY.md 里都能解析到
 * （断点带 §8 状态行、不变量出现）。markdown 改动若破坏了元投影的可解析结构 → 红，提示修复。
 *
 * 注：投影的"重解析字节级一致"由 datacore 单测 meta-ontology 覆盖；本门守"markdown 结构未漂移"。
 * 用法：node scripts/check-meta-sync.mjs   （package.json: "meta:sync"）
 */
import { readFileSync } from "node:fs";

const md = readFileSync("docs/SYSTEM-ONTOLOGY.md", "utf8");
const idx = JSON.parse(readFileSync("docs/prd-ontology-index.json", "utf8"));
const fail = [];

// ① 每个断点 G-N：§8 必有 `| G-N |` 行且带状态标记（✅/◐/⬜），否则 parse 取不到 status → 漂移
for (const g of idx.ontology.breakpoints ?? []) {
  const row = md.split("\n").find((l) => new RegExp(`^\\|\\s*${g}\\s*\\|`).test(l));
  if (!row) { fail.push(`断点 ${g} 在 §8 无表行（meta 投影取不到状态）`); continue; }
  if (!/[✅◐⬜]|未修/.test(row)) fail.push(`断点 ${g} §8 行缺状态标记（✅/◐/⬜）→ parse status 不可判`);
}

// ② 每个不变量 Rn：doc 必出现（meta 投影 SystemInvariant 节点据 index 建,markdown 须仍提及）
for (const r of idx.ontology.invariants ?? []) {
  if (!new RegExp(`\\b${r}\\b`).test(md)) fail.push(`不变量 ${r} 未在本体 markdown 出现（投影/引用漂移）`);
}

// ③ L14 meta.ontology_synced 必须登记 §4（dogfooding 自身事件,与代码同步）
if (!/`meta\.ontology_synced`/.test(md)) fail.push("meta.ontology_synced 未登记 §4（dogfooding 事件漂移）");

console.log(`· 断点 ${idx.ontology.breakpoints?.length ?? 0} · 不变量 ${idx.ontology.invariants?.length ?? 0} · 元投影可解析校验`);
if (fail.length) {
  console.error("✗ meta:sync 漂移门未通过（系统本体 markdown 结构漂移,元投影会失真）：");
  for (const f of fail) console.error("  - " + f);
  process.exit(1);
}
console.log("✓ meta:sync：系统本体 markdown 结构稳定,可确定性投影为元对象。");
