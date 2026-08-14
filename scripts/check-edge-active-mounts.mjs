#!/usr/bin/env node
/**
 * WO-ACTIVE-EDGE-UX · 挂载点门：**每个推演页都挂了 `EdgeActivePanel`，且挂在主组件里**。
 *
 * ── 为什么要这道门（它拦的是一个真发生过的错，不是假想）─────────────────────────────
 * 本单初稿把三处 `<EdgeActivePanel>` 挂进了**子组件**（`SchemeCard` / `VersionDetail` /
 * `DecisionPlay`）——它们只在"已经跑出结果 / 已选中版本"时才渲染。净效果是：
 *   **没跑过推演就看不见开关**，而"先关掉一条边、再看结果"恰恰是最常见的用法。
 * 这是本仓反复吃亏的那个形态的又一例：**实现有、测试可能还是绿的、但那条链路走不到**
 * （`G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 同族）。人眼逐个 `sed` 去数是能查出来的 ——
 * 我这次就是这么查出来的 —— 但**人眼不是机制**（铁律 0.6：下次同样的错必须机器先说话）。
 *
 * ── 判据（两条，都不许降级成"grep 到就算数"）───────────────────────────────────────
 *  ① 覆盖：`PAGES` 里每一页的源码文件都出现 `<EdgeActivePanel`。
 *  ② 位置：该 JSX 的行号必须落在**默认导出组件**的行段内，即
 *     `export default function X` 那一行 ≤ 挂载行 < 其后第一个顶层 `function`/`export default` 行。
 *     （本仓这几页的顶层声明都在第 0 列，故"第 0 列的 `function `"就是顶层边界的可靠判据。）
 *
 * ── 金丝雀（铁律 0.6：报否定结论前先自证工具，且金丝雀与主判据**共用同一份实现**）──────
 * 用同一个 `analyze()` 去跑两个**已知答案**的合成样例：一个必中（挂在主组件里）、
 * 一个必不中（挂在子组件里）。任一金丝雀不符预期 ⇒ 报「工具坏了」并 exit 2，
 * **不许**报「页面都挂对了」。抄一份正则给金丝雀 = 装饰品（改主正则时金丝雀拿旧的去测、照样绿）。
 *
 * 用法：`node scripts/check-edge-active-mounts.mjs`   RC: 0 通过 · 1 有页不合格 · 2 工具坏了
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * 推演页清单（renderer id → 源码文件）。改这张表 = 改本单的覆盖面，要有理由。
 *
 * 前 8 条来自工单 §1；**第 9 条 `risk-board` 是复核时补的**：工单按 registry 里"带推演语义的
 * renderer"取表，把它读成了「风险看板」，而**真实 workspace 下发的标题是「产能推演」**
 * （`apps/frontend-shell/src/mocks/fixtures.ts` 的 `{ key: "risk", title: "产能推演" }`）。
 * 判据落在**用户看到的那个名字**上，不落在文件名/renderer key 上 ——
 * 仓主说的「所有推演的功能」是按用户认知说的，不是按我们的目录说的。
 */
const PAGES = [
  ["sandbox", "apps/frontend-shell/src/views/sim/SandboxView.tsx"],
  ["project-sim", "apps/frontend-shell/src/views/sim/ProjectSimView.tsx"],
  ["global-sim", "apps/frontend-shell/src/views/sim/GlobalSimView.tsx"],
  ["plan-generate", "apps/frontend-shell/src/views/sim/PlanGenerateView.tsx"],
  ["what-if", "apps/frontend-shell/src/views/WhatIfView.tsx"],
  ["optimize-whatif", "apps/frontend-shell/src/views/OptimizeWhatifView.tsx"],
  ["decision-play", "apps/frontend-shell/src/views/DecisionPlayView.tsx"],
  ["sop-balance", "apps/frontend-shell/src/views/sim/SopBalanceView.tsx"],
  ["risk-board", "apps/frontend-shell/src/views/RiskBoardView.tsx"], // ← 第 9 页（工单表漏的，见上）
];

/**
 * **唯一实现**：给一份源码文本，回「挂载行号们」+「默认导出组件的行段」+ 判定。
 * 主判据与金丝雀都调它 —— 这就是"金丝雀必须与主逻辑共用同一份实现"那条纪律的落点。
 */
export function analyze(src) {
  const lines = src.split("\n");
  const mounts = [];
  const topLevel = [];
  let defaultAt = -1;
  lines.forEach((ln, i) => {
    if (ln.includes("<EdgeActivePanel")) mounts.push(i);
    // 顶层声明：第 0 列的 `function ` 或 `export default function `（本仓这几页都如此）
    if (/^export default function /.test(ln)) { defaultAt = i; topLevel.push(i); }
    else if (/^function /.test(ln)) topLevel.push(i);
  });
  if (defaultAt < 0) return { ok: false, reason: "NO_DEFAULT_EXPORT", mounts, range: null };
  const next = topLevel.find((i) => i > defaultAt);
  const end = next === undefined ? lines.length : next;
  const range = [defaultAt, end];
  if (mounts.length === 0) return { ok: false, reason: "NO_MOUNT", mounts, range };
  const outside = mounts.filter((i) => i < defaultAt || i >= end);
  if (outside.length > 0) return { ok: false, reason: "MOUNTED_IN_SUBCOMPONENT", mounts, outside, range };
  return { ok: true, reason: "OK", mounts, range };
}

// ⚠ 以下是**命令行入口**，只在被直接执行时跑（`node scripts/check-edge-active-mounts.mjs`）。
// 加这道守卫的理由很具体：前端接缝门 `test/edge-active.seam.test.tsx` **import 本文件的 `analyze`**
// —— 这正是"金丝雀必须与主逻辑共用同一份实现"那条纪律的落点。若不守卫，一次 import 就会
// 跑完整个门并可能 `process.exit(1)`，**把跑测试的那个进程一起带走**（表现为一条与本用例
// 无关的诡异失败）。守卫之后：命令行跑门、测试只借判据，互不干扰。
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();

function main() {
// ── 金丝雀：两个已知答案的合成样例，跑的是上面那个 analyze，不是另抄的正则 ────────────
const CANARY_HIT = `export default function P() {\n  return <div><EdgeActivePanel pageKey="x" /></div>;\n}\nfunction Sub() { return null; }\n`;
const CANARY_MISS = `export default function P() {\n  return <Sub />;\n}\nfunction Sub() {\n  return <EdgeActivePanel pageKey="x" />;\n}\n`;
const hit = analyze(CANARY_HIT);
const miss = analyze(CANARY_MISS);
if (!hit.ok || miss.ok || miss.reason !== "MOUNTED_IN_SUBCOMPONENT") {
  console.error("🛠️  **工具坏了**：金丝雀不符预期 ——");
  console.error(`   必中样例 → ok=${hit.ok} reason=${hit.reason}（应为 ok=true）`);
  console.error(`   必不中样例 → ok=${miss.ok} reason=${miss.reason}（应为 ok=false / MOUNTED_IN_SUBCOMPONENT）`);
  console.error("   ⛔ 不许把本次结果读作「页面都挂对了」。");
  process.exit(2);
}
console.log(`✅ 金丝雀 2/2：必中样例命中（行 ${hit.mounts.join(",")}）· 必不中样例被正确判为子组件挂载`);

let bad = 0;
for (const [key, rel] of PAGES) {
  const path = resolve(process.cwd(), rel);
  let src;
  try { src = readFileSync(path, "utf8"); } catch {
    console.error(`❌ ${key.padEnd(16)} 源码读不到：${rel}`);
    bad++; continue;
  }
  const r = analyze(src);
  if (r.ok) {
    console.log(`✅ ${key.padEnd(16)} 挂载于主组件（行 ${r.mounts.map((i) => i + 1).join(",")} ∈ [${r.range[0] + 1}, ${r.range[1]}]）`);
  } else {
    bad++;
    if (r.reason === "NO_MOUNT") {
      console.error(`❌ ${key.padEnd(16)} **未挂载** EdgeActivePanel —— 「所有推演的功能」是横向要求，漏一页就是漏一页`);
    } else if (r.reason === "MOUNTED_IN_SUBCOMPONENT") {
      console.error(
        `❌ ${key.padEnd(16)} 挂在**子组件**里（行 ${r.outside.map((i) => i + 1).join(",")}，主组件行段 [${r.range[0] + 1}, ${r.range[1]}]）` +
          ` ⇒ 没跑出结果 / 没选中条目时看不见开关`,
      );
    } else {
      console.error(`❌ ${key.padEnd(16)} ${r.reason}`);
    }
  }
}
if (bad > 0) {
  console.error(`\n🔴 ${bad}/${PAGES.length} 页不合格。`);
  process.exit(1);
}
console.log(`\n🟢 ${PAGES.length}/${PAGES.length} 个推演页均已挂载且挂在主组件里。`);
}
