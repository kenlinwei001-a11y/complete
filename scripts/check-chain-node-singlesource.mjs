#!/usr/bin/env node
/**
 * 门：全链节点 ID 单源（`CHAIN_NODE_REGISTRY`）。
 *
 * ⛔ 存在理由 = 一次真实事故（不是预防性洁癖）：
 *   S0 首版把 `ChainStepSchema.nodeId` / `ChainNodeSchema.nodeId` 冻成 `z.string().min(1)` 自由串，
 *   **没有注册表**。于是 D1（数据半·节拍）与 E1（引擎半·损失归因）两个 dev 各自发明了一套词表——
 *     · D1：`sop_consensus` / `order_review` / `master_schedule` / `mrp_run` / `settlement` …
 *     · E1：`demand.consensus` / `order.cash` / `material.replenish` / `capacity.aging` …
 *   **交集为 0**。两边单测各自全绿，链路却整条断开：D1 推出来的节拍，没有任何消费方能按 id 找到。
 *   这是「绿测试 ≠ 能用 · 断在接缝」的教科书形态。本门就是防它复发。
 *
 * 判据：`synthetic/cadence.ts` 与 `solvers/chain-loss.ts` 里出现的 `nodeId: "字面量"`，
 *      必须要么**在册**，要么属工序动态命名空间 `capacity.op.`。
 *
 * ⚠ 本门自己防「解析被截断」（假绿第 10 形态 G-GATE-PARSER-TRUNCATED-VIEW 的教训：
 *   曾有门的正则被数据内容里的 `]` 截断，于是它在一个残缺视野里正确地报了「一致」）：
 *   故 ① 正则锚到 `] as const satisfies`；② 断言解析出的条目数 ≥ MIN_NODES；
 *   ③ 断言几个必现 id 都在解析结果里。任一不满足 ⇒ 判定为「门自己瞎了」并红。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT = join(ROOT, "packages/contracts/src/chain-sim.ts");
const SCANNED = [
  join(ROOT, "apps/datacore/src/synthetic/cadence.ts"),
  join(ROOT, "apps/datacore/src/solvers/chain-loss.ts"),
];

/** 注册表条目数下限。改册时同步上调 —— 「解析出 0 条也算过」正是被截断的门的样子。 */
const MIN_NODES = 12;
/** 必现哨兵：解析结果里少了任何一个 ⇒ 视野被截断，不是「真的没有」。 */
const SENTINELS = ["demand.consensus", "order.settlement", "material.replenish", "capacity.aging"];

const errs = [];

const src = readFileSync(CONTRACT, "utf8");
// 锚到结尾的 `] as const satisfies`，不用惰性 `]`：数组内部注释/字符串里一旦出现 `]` 就会被截断。
const m = src.match(/export const CHAIN_NODE_REGISTRY = \[([\s\S]*?)\n\] as const satisfies/);
if (!m) {
  console.error("❌ chain-node-singlesource: 解析不到 CHAIN_NODE_REGISTRY（契约被改名/改形状？门先红，不静默放过）");
  process.exit(1);
}
const registry = [...m[1].matchAll(/nodeId:\s*"([^"]+)"/g)].map((x) => x[1]);

if (registry.length < MIN_NODES) {
  errs.push(`注册表只解析出 ${registry.length} 条（下限 ${MIN_NODES}）——极可能是正则被截断，门在残缺视野里做判断`);
}
for (const s of SENTINELS) {
  if (!registry.includes(s)) errs.push(`哨兵 ${s} 不在解析结果里 —— 视野被截断（不是「真的没有」）`);
}

const known = new Set(registry);
const OP_PREFIX = "capacity.op.";
for (const file of SCANNED) {
  const text = readFileSync(file, "utf8");
  const rel = file.slice(ROOT.length + 1);
  for (const mm of text.matchAll(/nodeId:\s*"([^"]+)"/g)) {
    const id = mm[1];
    if (known.has(id) || id.startsWith(OP_PREFIX)) continue;
    const line = text.slice(0, mm.index).split("\n").length;
    errs.push(
      `${rel}:${line} 用了不在册的 nodeId "${id}" —— ` +
        `全链节点 ID 必须出自 CHAIN_NODE_REGISTRY（契约 §2.5），或属动态工序命名空间 ${OP_PREFIX}*。` +
        `自由串正是 D1/E1 各造一套词表、节拍链整条断开的直接原因。`,
    );
  }
}

if (errs.length > 0) {
  console.error("❌ chain-node-singlesource:check 失败：");
  for (const e of errs) console.error("  · " + e);
  process.exit(1);
}
console.log(`✅ chain-node-singlesource:check 通过（注册表 ${registry.length} 个节点 · 扫描 ${SCANNED.length} 个文件，无自由串 nodeId）`);
