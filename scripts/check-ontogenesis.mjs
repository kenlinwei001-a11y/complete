#!/usr/bin/env node
/**
 * R16「发育闭环」门禁（system-ontogenesis 总纲）：声明性校验——系统本体必须立 R16 不变量，
 * 且 R16 表述覆盖发育闭环的四要素（三环自动闭合 / 二分处置 / 透明可视 / 分相位成熟）。
 * 与 cli-parity:check/debattery:check 同款治理范式：把"系统该长成什么"钉进本体，漂移即红。
 *
 * 设计取向（保守）：本门只校验本体把 R16 机制说清楚了（防回写漂移/遗漏），不强测运行时——
 * 三环的运行时落地由各被统摄 PRD（A10 build-to-verify / dogfooding 活体本体 / A15 目录派生）
 * 各自的门与测试保证。绿测试≠能用：本门是"记录该长成什么"的护栏，非功能完备证明。
 */
import { readFileSync } from "node:fs";

const ONTOLOGY = "docs/SYSTEM-ONTOLOGY.md";
const text = readFileSync(ONTOLOGY, "utf8");
const fail = [];

// 1) R16 必须在 §5 不变量表声明
if (!/\|\s*\*\*R16\*\*\s*\|/.test(text) && !/\bR16\b/.test(text)) {
  fail.push("本体 §5 未声明不变量 R16（发育闭环）——system-ontogenesis 总纲要求立 R16");
}

// 2) R16 表述须覆盖发育闭环四要素（关键词声明性校验，防回写遗漏其一）
const r16Line = (text.split("\n").find((l) => /\*\*R16\*\*/.test(l)) ?? "") + text;
const requirements = [
  { key: "三环（数据/本体/能力）", re: /三环|数据.*本体.*能力|build-to-verify/ },
  { key: "二分处置（AUTO-DERIVE / NEEDS-HUMAN）", re: /AUTO-DERIVE|NEEDS-HUMAN|二分处置|GrowthTicket/ },
  { key: "透明可视", re: /透明可视|节点图|模块同步矩阵|覆盖度/ },
  { key: "分相位成熟（PROVISIONAL→GOVERNED）", re: /PROVISIONAL.*GOVERNED|分相位|成熟/ },
  { key: "倒序发育 ⊕ 正序运作", re: /倒序发育|正序运作|个体发生|越用越大/ },
];
for (const r of requirements) {
  if (!r.re.test(r16Line)) fail.push(`R16 表述缺要素「${r.key}」（发育闭环总纲四要素 + 两相须齐备）`);
}

if (fail.length > 0) {
  console.error("✗ ontogenesis:check 失败：");
  for (const f of fail) console.error("  - " + f);
  process.exit(1);
}
console.log("· R16 发育闭环：本体已立（三环自动闭合 + 二分处置 + 透明可视 + 分相位成熟 + 倒序⊕正序两相）");
console.log("✓ ontogenesis:check：发育闭环不变量在本体钉牢（运行时落地由 A10/dogfooding/A15 各门保证）。");
