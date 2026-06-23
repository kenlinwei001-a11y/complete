#!/usr/bin/env node
/**
 * DF.1 门禁 `boundary-singlesource:check`：基地集单一来源不回潮守门。
 * 断言三消费端（datacore battery.ts BASES · 前端 fixtures.ts BASES · simSolvers.ts MOCK_BASES）
 * 均从 @platform/contracts BASE_REGISTRY **派生**（含 `BASE_REGISTRY.map`），
 * 且不再内联 12 条基地字面量（防"改一处崩前后端不同步"漂移复发，G-5/R14）。
 */
import { readFileSync } from "node:fs";

const CONSUMERS = [
  { file: "apps/datacore/src/synthetic/battery.ts", binding: "BASES" },
  { file: "apps/frontend-shell/src/mocks/fixtures.ts", binding: "BASES" },
  { file: "apps/frontend-shell/src/mocks/simSolvers.ts", binding: "MOCK_BASES" },
];
// DF.3 SEG 单一来源消费端：均须引用 SEG_REGISTRY（防 SEG 价/利/色内联回潮）。
const SEG_CONSUMERS = [
  "apps/datacore/src/synthetic/battery.ts",
  "apps/datacore/src/solvers/risk.ts",
  "apps/frontend-shell/src/views/plan/OrderChainView.tsx",
  "apps/frontend-shell/src/mocks/simSolvers.ts",
];

let red = false;
for (const { file, binding } of CONSUMERS) {
  let src;
  try {
    src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  } catch {
    console.error(`✗ 读不到 ${file}`);
    red = true;
    continue;
  }
  const importsRegistry = /BASE_REGISTRY/.test(src) && /from "@platform\/contracts"/.test(src);
  const derives = /BASE_REGISTRY\.map\(/.test(src);
  // 内联回潮启发：基地拼音 id 字面量出现 ≥6 次（registry 里只 1 处定义，消费端 0）。
  const inlineBaseIds = (src.match(/baseId:\s*"[a-z]+"/g) || []).length;
  if (!importsRegistry || !derives) {
    console.error(`✗ ${file}：${binding} 未从 BASE_REGISTRY 派生（缺 import 或 .map）`);
    red = true;
  } else if (inlineBaseIds >= 6) {
    console.error(`✗ ${file}：检出 ${inlineBaseIds} 处内联 baseId 字面量（疑回潮内联基地集，应只用 BASE_REGISTRY.map）`);
    red = true;
  }
}

for (const file of SEG_CONSUMERS) {
  let src;
  try {
    src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  } catch {
    console.error(`✗ 读不到 ${file}`);
    red = true;
    continue;
  }
  if (!/SEG_REGISTRY/.test(src)) {
    console.error(`✗ ${file}：SEG 价/利/色未从 SEG_REGISTRY 派生（疑内联回潮）`);
    red = true;
  }
}

if (red) {
  console.error("\n✗ boundary-singlesource:check 未通过：基地集/应用细分须单一来源（@platform/contracts BASE_REGISTRY/SEG_REGISTRY），不得内联。");
  process.exit(1);
}
console.log("✓ boundary-singlesource:check：BASE_REGISTRY + SEG_REGISTRY 单一来源，消费端均派生、无内联回潮。");
