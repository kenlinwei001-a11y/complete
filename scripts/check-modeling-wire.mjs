#!/usr/bin/env node
/**
 * 门 `modeling-wire:check`（WO-DB-MODELING-WIRE·数据先行·KILL-MOCK-RED·堵"故事路零引用 A3"）：
 * 守故事发动机 `run()` 在给 `fromDatasetIds` 时从**真实列/FK** 经 A3 `deriveModelingSuggestion`（+ `detectFkCandidates`）
 * 派生 objectTypes/链路（非 LLM 凭空造）——contract 有 `fromDatasetIds`·service 真引用 A3·端点透传。
 * green→red 齿见 `datacore/test/modeling-wire.test.ts`（真上传→objectTypes/refToTypeKey 从真列/FK）。
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §8 G-6（数据模版/FK 驱动）。用法：node scripts/check-modeling-wire.mjs
 */
import { readFileSync, existsSync } from "node:fs";
const root = new URL("../", import.meta.url);
const read = (rel) => (existsSync(new URL(rel, root)) ? readFileSync(new URL(rel, root), "utf8") : null);
const strip = (s) => s.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const fail = [];

const svc = strip(read("apps/datacore/src/databuilder/service.ts") ?? "");
if (!/import \{ detectFkCandidates, deriveModelingSuggestion \} from "\.\.\/modeling\.js"/.test(read("apps/datacore/src/databuilder/service.ts") ?? "")) fail.push("service.ts 未 import A3 detectFkCandidates/deriveModelingSuggestion（故事路仍零引用）");
if (!/deriveObjectTypesFromDatasets/.test(svc)) fail.push("service.ts 缺 deriveObjectTypesFromDatasets（数据先行派生器未在位）");
if (!/body\.fromDatasetIds[\s\S]{0,400}deriveObjectTypesFromDatasets/.test(svc)) fail.push("run() 未在 fromDatasetIds 时走数据先行派生（接线未生效）");
if (!/deriveModelingSuggestion\(/.test(svc)) fail.push("service.ts 未真调 deriveModelingSuggestion（A3 复用缺）");

for (const [f, sym] of [["packages/contracts/src/databuilder.ts", "fromDatasetIds"], ["packages/contracts/src/storybuildrun.ts", "fromDatasetIds"]])
  if (!(read(f) ?? "").includes(sym)) fail.push(`${f} 缺 ${sym}（契约未透传数据先行入参）`);
if (!/fromDatasetIds: body\.fromDatasetIds/.test(read("apps/datacore/src/app.ts") ?? "")) fail.push("app.ts runs 端点未透传 fromDatasetIds");

if (fail.length) { console.error("✗ modeling-wire:check 失败："); for (const f of fail) console.error("  - " + f); process.exit(1); }
console.log("✓ modeling-wire:check 通过（故事发动机接 A3·数据先行从真列/FK 派生 objectTypes/链路·契约+端点透传）");
