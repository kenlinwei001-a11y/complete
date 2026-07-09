#!/usr/bin/env node
/**
 * 门 `hidden-req-keys:check`（WO UPG-L0-HIDDENREQ · PRD-gap-analysis-engine §8 · 守 R6/R14 · 闭「隐藏需求造假 key」）。
 *
 * 立「**隐藏需求发现绝不造假 key**」的结构不变量：`expandHiddenRequirements`（`@platform/contracts`
 * databuilder.ts）**能产出的每个 key 必 ∈ 三张真实白名单**（本体图真类型 / 真链路 / SOLVER_DATADEP 真求解器）——
 * by-construction（filter(has) 外进不来），本门在**门层坐实**并**自证有牙齿**（green→red）。
 *
 * 三道断言：
 *  ① 存在性对账（真跑）——用真实 SOLVER_DATADEP + 合成本体图 + **对抗性显式需求（塞幽灵 key）**跑
 *     expandHiddenRequirements，断言输出（objectTypes/solvers/links + trace.added）逐个 ∈ 对应真实注册表。
 *  ② 测谎自证（green→red 有牙齿）——把一个幽灵 key 人为注入到「一份输出副本」里，用**同一**校验器
 *     `keysOutsideRegistries` 复核：必须抓出该幽灵（否则校验器无牙 → 门红）。证「若函数漏 filter 让幽灵
 *     漏出，本门必红」。
 *  ③ 源码无硬编码 key 数组——`expandHiddenRequirements` 函数体三张白名单守卫在位（typeKeys.has /
 *     solverKeys.has / linkKeys.has），且无被 PRD 明令弃用的旧幽灵字面量（capacity_loss / production_line）。
 *
 * 依赖 contracts 已构建（gates 链 pnpm -r build 在前）。
 */
import { readFileSync } from "node:fs";

const impContracts = async () =>
  import("../packages/contracts/dist/index.js").catch((e) => {
    console.error(`✗ hidden-req-keys:check 导入 contracts dist 失败（先 pnpm --filter contracts build）：${e.message}`);
    process.exit(1);
  });

const { expandHiddenRequirements, SOLVER_DATADEP, DATADEP_ROLE_CANONICAL } = await impContracts();

let red = false;
const fail = (m) => {
  console.error("✗ " + m);
  red = true;
};

// —— 合成本体图（节点=canonical 真类型键；边=真链路）——纯测试夹具，不代表某租户实况；
//    关键是三白名单来自真实结构（graph.nodes/edges + SOLVER_DATADEP），非门内手写 key 数组。
const TYPES = [...new Set(Object.values(DATADEP_ROLE_CANONICAL))];
const GRAPH = {
  nodes: TYPES.map((key) => ({ key })),
  edges: [
    { from: "n-Order", to: "n-Model", label: "order_uses_model" },
    { from: "n-Order", to: "n-Shipment", label: "order_ships_via" },
    { from: "n-Model", to: "n-Base", label: "model_at_base" },
    { from: "n-Line", to: "n-Process", label: "line_has_process" },
  ],
};
const bindings = { resolve: (rt) => DATADEP_ROLE_CANONICAL[rt] };

const typeKeys = new Set(GRAPH.nodes.map((n) => n.key));
const linkKeys = new Set(GRAPH.edges.map((e) => e.label));
const solverKeys = new Set(Object.keys(SOLVER_DATADEP));

/** 同一校验器（①③②共用·防「宽松校验器假绿」）：返回不在真实注册表内的 key 明细（空=全部合法）。 */
function keysOutsideRegistries(exp) {
  const bad = [];
  for (const t of exp.requiredObjectTypes ?? []) if (!typeKeys.has(t)) bad.push(`objectType:${t}`);
  for (const s of exp.requiredSolvers ?? []) if (!solverKeys.has(s)) bad.push(`solver:${s}`);
  for (const lk of exp.requiredLinks ?? []) if (!linkKeys.has(lk)) bad.push(`link:${lk}`);
  for (const tr of exp.trace ?? []) {
    const reg = tr.kind === "objectType" ? typeKeys : tr.kind === "solver" ? solverKeys : linkKeys;
    if (!reg.has(tr.added)) bad.push(`trace.${tr.kind}:${tr.added}`);
  }
  return bad;
}

// —— ① 存在性对账：对抗性显式需求（含幽灵 key）跑真函数 → 输出必全 ∈ 真实注册表 ——
const GHOSTS = ["capacity_loss", "production_line", "GHOST_TYPE_ø"];
const adversarial = {
  objectTypes: ["Order", "Model", ...GHOSTS],
  solvers: ["affected_orders", "order_fullchain", "ghost_solver_ø"],
};
const out = expandHiddenRequirements(adversarial, GRAPH, SOLVER_DATADEP, bindings);
const leaked = keysOutsideRegistries(out);
if (leaked.length > 0) {
  fail(`①存在性：expandHiddenRequirements 产出注册表外幽灵 key（造假）：${leaked.join(", ")}`);
} else {
  console.log(
    `· ①存在性：对抗性输入（塞 ${GHOSTS.length} 幽灵）→ 输出 ${out.requiredObjectTypes.length} 类型/` +
      `${out.requiredSolvers.length} 求解器/${out.requiredLinks.length} 链路 全 ∈ 真实注册表（零幽灵）。`,
  );
}
// 幽灵未混入（正向坐实 by-construction）。
for (const g of GHOSTS) {
  if (out.requiredObjectTypes.includes(g)) fail(`①存在性：幽灵类型 ${g} 混入输出（filter(has) 失效）`);
}
if (out.requiredSolvers.includes("ghost_solver_ø")) fail("①存在性：幽灵求解器 ghost_solver_ø 混入输出");

// —— ② 测谎自证（green→red 有牙齿）：往输出副本注入幽灵 → 同一校验器必须抓出 ——
const poisoned = {
  ...out,
  requiredObjectTypes: [...out.requiredObjectTypes, "capacity_loss"],
  trace: [...out.trace, { added: "capacity_loss", kind: "objectType", via: "INJECTED_GHOST" }],
};
const caught = keysOutsideRegistries(poisoned);
if (!caught.some((b) => b.includes("capacity_loss"))) {
  fail("②测谎：注入幽灵 capacity_loss 后校验器未抓出 → 校验器无牙齿（本门形同虚设）");
} else {
  console.log(`· ②测谎：注入幽灵 capacity_loss → 校验器抓出 ${caught.length} 项越界 key（green→red 有牙齿·自证）。`);
}

// —— ③ 源码守卫：三白名单 filter 在位 + 无旧弃用幽灵字面量 ——
const src = readFileSync(new URL("../packages/contracts/src/databuilder.ts", import.meta.url), "utf8");
const fnStart = src.indexOf("export function expandHiddenRequirements");
if (fnStart < 0) {
  fail("③源码：未找到 expandHiddenRequirements 定义");
} else {
  const body = src.slice(fnStart);
  for (const guard of ["typeKeys.has", "solverKeys.has", "linkKeys.has"]) {
    if (!body.includes(guard)) fail(`③源码：expandHiddenRequirements 缺白名单守卫 ${guard}（疑似漏 filter）`);
  }
  // PRD §8 明令弃用的旧硬编码幽灵 key 不得作为字面量出现在函数体（防「Order→BOM 硬编码 + capacity_loss」回潮）。
  for (const ghost of ['"capacity_loss"', '"production_line"']) {
    if (body.includes(ghost)) fail(`③源码：函数体含被弃用的硬编码幽灵字面量 ${ghost}（PRD §8 明令删除）`);
  }
  if (!red) console.log("· ③源码：三白名单守卫（typeKeys/solverKeys/linkKeys .has）在位·无旧弃用幽灵字面量。");
}

if (red) {
  console.error("\n✗ hidden-req-keys:check 未过：隐藏需求发现存在造假/漏 filter 风险（违 R6/R14·§8 三白名单）。");
  process.exit(1);
}
console.log("✓ hidden-req-keys:check 通过（隐藏需求 by-construction 三白名单·零幽灵 key·green→red 自证有牙齿）。");
