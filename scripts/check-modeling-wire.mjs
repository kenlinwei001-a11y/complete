#!/usr/bin/env node
/**
 * 门 `modeling-wire:check`（WO-DB-MODELING-WIRE·数据先行·KILL-MOCK-RED·堵"故事路零引用 A3"）：
 * 守故事发动机 `run()` 在给 `fromDatasetIds` 时从**真实列/FK** 经 A3 `deriveModelingSuggestion`（+ `detectFkCandidates`）
 * 派生 objectTypes/链路（非 LLM 凭空造）——contract 有 `fromDatasetIds`·service 真引用 A3·端点透传。
 * green→red 齿见 `datacore/test/modeling-wire.test.ts`（真上传→objectTypes/refToTypeKey 从真列/FK）。
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §8 G-6（数据模版/FK 驱动）。用法：node scripts/check-modeling-wire.mjs
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
  console.error(`⛔ check-modeling-wire.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


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
