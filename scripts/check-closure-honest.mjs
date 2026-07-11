#!/usr/bin/env node
/**
 * 门 `closure-honest:check`（WO-DB-CLOSURE-HARDEN · KILL-MOCK-RED 核心形态 · 堵 §8 G-BUILD-SHELL/G-BUILD-VERIFY）：
 * 守数据构建发动机「闭包/verify 据实·不空壳判绿」两洞：
 *  洞C（G-BUILD-SHELL）：closure 旧仅读 `domain` 存在 → domain 已分配但切片真跑解析 0 节点仍 gatePassed=true（空壳）。
 *  洞D（G-BUILD-VERIFY）：ValidationTrace NUMERIC_PROVENANCE 写死 PASS·从不看 answer/evidence → BUILD_STATIC 也盖"已溯源"章。
 *
 * 静态哨兵（有牙·源码守卫）：
 *  1) closure.ts validateClosure 带 `resolvedCounts` 形参 + "解析 0 节点"→FAILED 分支（洞C 据实非空判在位）。
 *  2) service.ts buildStoryValidationTrace 带 evidence 形参 + BUILD_STATIC→NUMERIC FAIL 据实分支（洞D 在位）。
 *
 * 动态测谎（经已构 dist·green→red 自证有牙）：
 *  3) 真跑 validateClosure：domain 有值 + counts{type:0} → gatePassed=false + OBJECT/FAILED（空壳翻红）；
 *     counts{type:5} → gatePassed=true；counts 缺省 → gatePassed=true（向后兼容·未知不误红）。
 *     ——若 closure.ts 漏据实非空判（洞C 回潮）→ count:0 仍 true → 本断言塌（门红）。
 *
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §8 G-BUILD-SHELL/G-BUILD-VERIFY。用法：node scripts/check-closure-honest.mjs
 */
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const abs = (rel) => new URL(rel, root);
const read = (rel) => (existsSync(abs(rel)) ? readFileSync(abs(rel), "utf8") : null);
const stripComments = (s) => s.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const fail = [];

// ── 1) 洞C 源码守卫（closure.ts 据实非空判）───────────────────────────────────
const closureSrc = read("apps/datacore/src/databuilder/closure.ts");
if (closureSrc == null) {
  fail.push("缺 apps/datacore/src/databuilder/closure.ts");
} else {
  const code = stripComments(closureSrc);
  if (!/resolvedCounts\??\s*:\s*ReadonlyMap/.test(code)) fail.push("closure.ts validateClosure 缺 resolvedCounts 形参（洞C 据实非空判未在位）");
  if (!/status:\s*"FAILED"/.test(code) || !/0\s*节点|resolvesNonEmpty/.test(code)) fail.push("closure.ts 缺'解析 0 节点→FAILED'空壳翻红分支（洞C）");
}

// ── 2) 洞D 源码守卫（service.ts ValidationTrace 据实）──────────────────────────
const svcSrc = read("apps/datacore/src/databuilder/service.ts");
if (svcSrc == null) {
  fail.push("缺 apps/datacore/src/databuilder/service.ts");
} else {
  const code = stripComments(svcSrc);
  if (!/buildStoryValidationTrace[\s\S]{0,600}evidence/.test(code)) fail.push("service.ts buildStoryValidationTrace 缺 evidence 形参（洞D 据实判未接线）");
  if (!/BUILD_STATIC[\s\S]{0,200}FAIL|status:\s*"FAIL"[\s\S]{0,200}BUILD_STATIC|numericHonest/.test(code)) fail.push("service.ts 缺 BUILD_STATIC→NUMERIC FAIL 据实分支（洞D·仍写死 PASS 假绿）");
  // 终态 verifyBuild 须带 evidence 重算（不复用乐观预备 trace）。
  if (!/buildStoryValidationTrace\(ctx,\s*plan,\s*\{\s*evidence/.test(code)) fail.push("service.ts verifyBuild 未带 evidence 重算 trace（仍复用假绿预备 trace·洞D 未闭）");
}

// ── 3) 动态测谎（validateClosure·green→red）───────────────────────────────────
async function dynamic() {
  const dist = abs("apps/datacore/dist/databuilder/closure.js");
  const cdist = abs("packages/contracts/dist/index.js");
  if (!existsSync(dist) || !existsSync(cdist)) {
    fail.push("dist 未构建——跳过动态测谎（gates 内已含 build）");
    return;
  }
  const { validateClosure } = await import(dist.href);
  const { ClosurePolicySchema } = await import(cdist.href);
  const policy = ClosurePolicySchema.parse({ object: {}, data: {}, forward: {} });
  const plan = {
    id: "bpl_gate", tenantId: "demo", builderKey: "g", scriptHash: "h", seed: 1, script: "",
    dataSources: [], rules: [], kbDocs: [], createdAt: "2026-01-01", solverNeeds: [],
    objectTypes: [{ typeKey: "Order", displayName: "订单", domain: "commercial", sourceDataset: "order",
      properties: [{ propKey: "order_id", dataType: "String", isPrimaryKey: true, sourceField: "order_id" }] }],
  };
  // 空壳（domain 有值·解析 0 节点）→ 必翻红。
  const empty = validateClosure(plan, policy, "STRICT", new Map([["Order", 0]]));
  if (empty.gatePassed !== false) fail.push("测谎失效：domain 有值但解析 0 节点仍 gatePassed=true（洞C 空壳判绿回潮·门无牙）");
  if (!empty.findings.some((f) => f.kind === "OBJECT" && f.ref === "Order" && f.status === "FAILED")) fail.push("空壳未产 OBJECT/FAILED finding（洞C 未据实标记）");
  // 真派生（解析 ≥1 节点）→ 绿。
  const filled = validateClosure(plan, policy, "STRICT", new Map([["Order", 5]]));
  if (filled.gatePassed !== true) fail.push("误报：domain 有值 + 解析 5 节点应 gatePassed=true（过度判红）");
  // 向后兼容（counts 缺省）→ 绿。
  const legacy = validateClosure(plan, policy);
  if (legacy.gatePassed !== true) fail.push("向后兼容破：counts 缺省应 gatePassed=true（物化前/纯单测不误红）");
}

await dynamic();

if (fail.length) {
  console.error("✗ closure-honest:check 失败：");
  for (const f of fail) console.error("  - " + f);
  process.exit(1);
}
console.log("✓ closure-honest:check 通过（洞C 闭包据实非空判 + 洞D ValidationTrace 据实判·空壳/BUILD_STATIC 翻红·门自测有牙）");
