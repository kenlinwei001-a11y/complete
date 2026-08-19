#!/usr/bin/env node
/**
 * 门 `graph-runtime:check`（WO-GRAPH-FANOUT-W2 · PRD-skill-runtime-orchestrator §9 W2 · 闭 §8
 * G-SERIAL-GRAPH-EXECUTION 半 + G-SKILL-GRAPH-NO-RENDER-CLOSURE）：
 *
 * 守四件事——
 *  G1（动态·contracts dist）R11 收口有牙 + 扇出序真拓扑：
 *     a. 手写图无 render 节点 ⇒ compileGraph 拒发 `RENDER_CLOSURE_MISSING` 且**点名**入口与悬空终点；
 *     b. 线性来源（execution.steps）无 render 收尾 ⇒ 合成 `__auto_render` 且 `renderClosure:"synthesized"`
 *        **披露**（被拒/被披露二选一，无第三条静默路）；
 *     c. 菱形依赖图分层真拓扑（[[entry],[b1,b2],[out]]）且重复编译逐字节一致（R6）。
 *     金丝雀（与主判据共用同一 dist 实现，不许复制）：带 render 的合法图**必须**放行、
 *     菱形图**必须** ok —— 金丝雀红 = 门这次什么都没量到，退 2 不退 1。
 *  G2（静态）executor.ts 的线性步骤执行序走**全仓唯一拓扑实现** `topoLayers`（contracts），
 *     兜底文案用共享常量 `GRAPH_FALLBACK_ANSWER_MARKDOWN`（不许出现第二份字面量）。
 *  G3（静态）三处扇出点位登记制：FANOUT-REG 标记集合恰为登记表三键；territory 文件里每个
 *     Promise.all/allSettled 点前 12 行内必须有 FANOUT-REG 标记（新增扇出不登记即红）。
 *  G4（静态）render 节点执行侧锚点：skill-orchestrator.ts 有 runRenderNode 且 dispatch 到
 *     kind === "render"。
 *
 * green→red 齿：WO-GRAPH-FANOUT-W2 变异实录（摘 R11 门 ⇒ G1a 红；波前串行化 ⇒ SEAM 屏障用例红）
 * 见 docs/HANDOFF-WO-GRAPH-FANOUT-W2.md。用法：node scripts/check-graph-runtime.mjs
 */
/* ── 退出码纪律 · 顶层兜底（WO-GATE-RC2-DISCIPLINE）─────────────────────────────
 * 本仓门的退出码是**三分**约定（docs/SOP-reviewer-claim-discipline.md §3）：
 *   0 = 干净 · 1 = **真有问题**（先修代码）· 2 = **工具自己坏了**（只许说「我没查出来」）。
 * 而 node 对**未捕获异常一律退 1** —— 恰好撞上「真有问题」这个码。于是「门根本没跑起来」
 * （缺依赖 / 只读 FS / 权限 / OOM / node 版本差异 / dist 没构建）会被 gate.sh 和人一起
 * 读成「你的代码有问题」，方向**正好相反**。2026-08-11 一天之内两道门各撞一次，故建此机制。
 *
 * 这段只**加**默认失败方向，**不动**任何既有 exit(0)/exit(1)：兜底若把真违规也吞成 2，
 * 那是拿一个更糟的假绿换掉一个假红。RC=1 仍然只由主判据明确判负产生。
 * 守门的门：scripts/check-gate-exit-discipline.mjs（新加的门不带兜底会被它当场判红）。 */
process.on("uncaughtException", (e) => gateToolBroken(e));
process.on("unhandledRejection", (e) => gateToolBroken(e));
function gateToolBroken(e) {
  console.error(`⛔ check-graph-runtime.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}

import { readFileSync, existsSync } from "node:fs";
import { assertDistFresh } from "./dist-freshness.mjs";

const root = new URL("../", import.meta.url);
const read = (rel) => (existsSync(new URL(rel, root)) ? readFileSync(new URL(rel, root), "utf8") : null);
const fail = [];
const canaryFail = [];

/**
 * 扇出 territory（判据本体）：PRD §3.4 点名的三处 + GraphScheduler 自身。
 * 不随仓库演进自动变大——**新增**扇出点位的人必须把文件加进来并登记，这正是门要逼的动作。
 */
const TERRITORY_FILES = [
  "apps/agentcore/src/workflow/executor.ts",
  "apps/agentcore/src/router/multi-route.ts",
  "apps/agentcore/src/router/orchestrator.ts",
  "apps/agentcore/src/skill-orchestrator.ts",
];

/**
 * 扇出登记表（判据本体）：三处点位的定性结论（收编 or 分工登记 + why 的落点）。
 * 键 = FANOUT-REG 标记 id；值 = 定性（register=分工登记 / wave=已收编进 GraphScheduler 波前）。
 * 改动定性必须过评审——它不是名单缓存，是 PRD §3.4「三处扇出」的裁决结果本身。
 */
const FANOUT_REGISTRY = {
  "graph-scheduler-wave": "wave（拓扑波前同层并发，GraphScheduler 本体）",
  "multi-route-parallel-solvers": "register（分工登记：provenance 需 GuardedToolExecutor 真 toolCallId + coupled-pair 诚实标耦合）",
  "coordinator-role-fanout": "register（分工登记：角色旁白归因靠串行步指针，真并行等 W3 role-by-node）",
};

// ── G2：executor 接唯一拓扑层（静态锚点）────────────────────────────────────
{
  const src = read("apps/agentcore/src/workflow/executor.ts") ?? "";
  if (!/topoLayers\(/.test(src)) fail.push("G2：executor.ts 未调用 topoLayers（线性步骤未接全仓唯一拓扑层）");
  if (!/from "@platform\/contracts"[^;]*topoLayers|topoLayers[^;]*from "@platform\/contracts"/s.test(src) && !/import \{[^}]*topoLayers[^}]*\} from "@platform\/contracts"/.test(src))
    fail.push("G2：executor.ts 的 topoLayers 不是从 @platform/contracts 引入（第二份拓扑实现嫌疑）");
  if (!/GRAPH_FALLBACK_ANSWER_MARKDOWN/.test(src)) fail.push("G2：executor.ts 兜底文案未用共享常量 GRAPH_FALLBACK_ANSWER_MARKDOWN");
  // 第二份字面量兜底 = 两套口径漂移（剥注释后查，注释里的提及不算）
  const stripped = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  if (/工作流执行完成/.test(stripped)) fail.push("G2：executor.ts 出现第二份「工作流执行完成。」字面量（兜底文案只许 contracts 一个家）");
}

// ── G3：扇出登记制（静态）──────────────────────────────────────────────────
{
  const found = new Map(); // id -> file
  for (const rel of TERRITORY_FILES) {
    const src = read(rel) ?? "";
    for (const m of src.matchAll(/FANOUT-REG:\s*([a-z0-9-]+)/g)) {
      if (found.has(m[1])) fail.push(`G3：FANOUT-REG id「${m[1]}」重复登记（${found.get(m[1])} 与 ${rel}）`);
      found.set(m[1], rel);
    }
    // 每个并发原语点前 12 行内必须有 FANOUT-REG 标记
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!/Promise\.(all|allSettled)\(/.test(lines[i])) continue;
      const windowText = lines.slice(Math.max(0, i - 12), i + 1).join("\n");
      if (!/FANOUT-REG:/.test(windowText))
        fail.push(`G3：${rel}:${i + 1} 的 Promise.all/allSettled 前 12 行内无 FANOUT-REG 登记（新扇出点位未过定性裁决）`);
    }
  }
  for (const id of Object.keys(FANOUT_REGISTRY)) {
    if (!found.has(id)) fail.push(`G3：登记表点位「${id}」（${FANOUT_REGISTRY[id]}）在 territory 文件里找不到 FANOUT-REG 标记——登记与实现脱节`);
  }
  for (const id of found.keys()) {
    if (!(id in FANOUT_REGISTRY)) fail.push(`G3：出现未登记的 FANOUT-REG id「${id}」（${found.get(id)}）——先补登记表定性再过评审`);
  }
}

// ── G4：render 节点执行侧锚点（静态）───────────────────────────────────────
{
  const src = read("apps/agentcore/src/skill-orchestrator.ts") ?? "";
  if (!/runRenderNode/.test(src)) fail.push("G4：skill-orchestrator.ts 缺 runRenderNode（render 节点执行侧未落）");
  if (!/kind === "render"/.test(src)) fail.push("G4：skill-orchestrator.ts dispatch 未接 kind === \"render\" 分支");
}

// ── G1：R11 收口 + 拓扑分层（动态·contracts dist）───────────────────────────
async function dynamic() {
  // ⛔ 守卫必须在 import dist **之前**（欠账 #161）：dist 落后就是拿旧产物印证新源码。
  assertDistFresh(["packages/contracts/dist/skill-graph.js"], { gate: "graph-runtime:check" });
  const sg = await import(new URL("packages/contracts/dist/skill-graph.js", root).href);
  const { compileGraph, compileExecution, AUTO_RENDER_NODE_ID, GRAPH_FALLBACK_ANSWER_MARKDOWN } = sg;

  // 金丝雀先行（与主判据共用同一 dist 函数，不复制实现）：合法图必须放行——它红说明
  // 下面的负向断言是空转（什么都能拒 = 什么都没量到），退 2 不退 1。
  const good = compileGraph({
    nodes: [
      { id: "s", kind: "solver", params: { solverKey: "capacity_forecast" } },
      { id: "out", kind: "render", params: { blocks: [{ type: "text", markdown: "x" }] } },
    ],
    edges: [{ from: "s", to: "out", kind: "seq" }],
    maxParallelNodes: 4,
  });
  if (!good.ok) canaryFail.push(`金丝雀：带 render 的合法图被误拒（${good.code}: ${good.message}）——门这次什么都没量到`);
  if (typeof AUTO_RENDER_NODE_ID !== "string" || typeof GRAPH_FALLBACK_ANSWER_MARKDOWN !== "string")
    canaryFail.push("金丝雀：dist 缺 AUTO_RENDER_NODE_ID / GRAPH_FALLBACK_ANSWER_MARKDOWN 导出（dist 落后或契约未落）");

  // G1a：手写图无 render ⇒ 拒发并点名（变异反证的靶子：摘掉 R11 门这条必红）
  const noRender = compileGraph({
    nodes: [
      { id: "load", kind: "skill", params: { skillKey: "capacity_analysis" } },
      { id: "solve", kind: "solver", params: { solverKey: "capacity_forecast" } },
    ],
    edges: [{ from: "load", to: "solve", kind: "seq" }],
    maxParallelNodes: 4,
  });
  if (noRender.ok) fail.push("G1a：无 render 节点的手写图被放行——R11 收口门不在位（G-SKILL-GRAPH-NO-RENDER-CLOSURE 回潮）");
  else {
    if (noRender.code !== "RENDER_CLOSURE_MISSING") fail.push(`G1a：无 render 图的拒绝码是 ${noRender.code}，不是 RENDER_CLOSURE_MISSING（拒发不点名 = 让人猜）`);
    if (!noRender.message.includes("load") || !noRender.message.includes("solve"))
      fail.push("G1a：RENDER_CLOSURE_MISSING 报错未点名入口/悬空终点（拒发不点名 = 让人猜）");
  }

  // G1b：线性来源无 render 收尾 ⇒ 合成收口且披露（不装成作者声明）
  const linear = compileExecution({
    execution: { steps: [{ id: "s1", type: "invoke_solver", params: { solverKey: "capacity_forecast", args: {} } }] },
  });
  if (!linear.ok) fail.push(`G1b：线性 execution.steps 编译被拒（${linear.code}）——合成收口未落`);
  else {
    if (linear.renderClosure !== "synthesized") fail.push("G1b：线性来源未披露 renderClosure=synthesized（合成收口装成作者声明 = 静默）");
    const tail = linear.graph.nodes.find((n) => n.id === AUTO_RENDER_NODE_ID);
    if (!tail || tail.kind !== "render") fail.push("G1b：链尾没有合成 render 节点 __auto_render");
    else if (JSON.stringify(tail.params) !== JSON.stringify({ blocks: [{ type: "text", markdown: GRAPH_FALLBACK_ANSWER_MARKDOWN }] }))
      fail.push("G1b：合成 render 的兜底文案与 GRAPH_FALLBACK_ANSWER_MARKDOWN 不一致（两处置底口径漂移）");
    if (linear.layers[linear.layers.length - 1]?.nodeIds?.[0] !== AUTO_RENDER_NODE_ID)
      fail.push("G1b：合成 render 不在最后一层（收口位置错）");
  }

  // G1c：菱形依赖图分层真拓扑 + R6 重复编译逐字节一致
  const diamond = {
    nodes: [
      { id: "entry", kind: "solver", params: { solverKey: "a" } },
      { id: "b1", kind: "solver", params: { solverKey: "b" } },
      { id: "b2", kind: "solver", params: { solverKey: "c" } },
      { id: "out", kind: "render", params: { blocks: [{ type: "text", markdown: "done" }] } },
    ],
    edges: [
      { from: "entry", to: "b1", kind: "parallel" },
      { from: "entry", to: "b2", kind: "parallel" },
      { from: "b1", to: "out", kind: "seq" },
      { from: "b2", to: "out", kind: "seq" },
    ],
    maxParallelNodes: 4,
  };
  const d1 = compileGraph(diamond);
  if (!d1.ok) canaryFail.push(`金丝雀：菱形合法图被误拒（${d1.code}）——门这次什么都没量到`);
  else {
    const layers = d1.layers.map((l) => l.nodeIds);
    if (JSON.stringify(layers) !== JSON.stringify([["entry"], ["b1", "b2"], ["out"]]))
      fail.push(`G1c：菱形图分层非拓扑真值 [[entry],[b1,b2],[out]]，实为 ${JSON.stringify(layers)}（扇出序不是真拓扑）`);
    const d2 = compileGraph(diamond);
    if (JSON.stringify(d1) !== JSON.stringify(d2)) fail.push("G1c：同一张菱形图两次编译结果逐字节不同（R6 确定性破）");
  }
  // 金丝雀（结构齿）：抽掉 entry→b2 扇出边，b2 失去前驱升为入口层，分层必须变——
  // 不变说明上面比的是死夹具
  const broken = compileGraph({ ...diamond, edges: diamond.edges.filter((e) => !(e.from === "entry" && e.to === "b2")) });
  if (broken.ok && JSON.stringify(broken.layers.map((l) => l.nodeIds)) === JSON.stringify(d1.ok ? d1.layers.map((l) => l.nodeIds) : null))
    canaryFail.push("金丝雀：抽边后分层不变——G1c 的拓扑断言是空转");
}
await dynamic();

if (canaryFail.length) {
  console.error("⛔ graph-runtime:check 金丝雀红（门这次什么都没量到，**不是代码违规结论**）：");
  for (const f of canaryFail) console.error("  - " + f);
  process.exit(2);
}
if (fail.length) {
  console.error("✗ graph-runtime:check 失败：");
  for (const f of fail) console.error("  - " + f);
  process.exit(1);
}
console.log("✓ graph-runtime:check 通过（R11 拒发点名/合成披露 · 菱形真拓扑+R6 · executor 唯一拓扑层 · 三处扇出登记制 · render 执行侧锚点）");
