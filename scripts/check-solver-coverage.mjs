#!/usr/bin/env node
/**
 * 门 `solver-coverage:check`（WO UPG-L0-SOLVER-COVERAGE · PRD-upstream-classify-precision §5.1）。
 *
 * 治「没有对的求解器」：`SOLVER_COVERAGE`（`@platform/contracts` solver-coverage.ts）声明
 * 「问题类目 → path-A 求解器」覆盖矩阵。本门断言：
 *   ① 矩阵引用的**每个 solverKey 必 ∈ datacore `SOLVER_REGISTRY`**（对齐 `no-fake-done` 精神·防幽灵 key）；
 *   ② 已覆盖类目与**未覆盖类目**（`UNCOVERED_PROBLEM_CLASSES`·诚实缺口）不相交（不得既覆盖又列缺口）；
 *   ③ 未覆盖类目**显式列出**（非静默落 Path B）——打印缺口清单供 A3 覆盖补齐排优先级。
 *
 * contracts 不可 import datacore（contracts-only-shared），故 key∈registry 的对账在**门**层
 * （读两侧编译产物·green→red 自证）。依赖 contracts + datacore 已构建（gates 链 pnpm -r build 在前）。
 */
const impContracts = async () =>
  import("../packages/contracts/dist/index.js").catch((e) => {
    console.error(`✗ solver-coverage:check 导入 contracts dist 失败（先 pnpm --filter contracts build）：${e.message}`);
    process.exit(1);
  });
const impDatacore = async (p) =>
  import(`../apps/datacore/dist/${p}`).catch((e) => {
    console.error(`✗ solver-coverage:check 导入 datacore dist 失败（先 pnpm --filter datacore build）：${e.message}`);
    process.exit(1);
  });

const { SOLVER_COVERAGE, UNCOVERED_PROBLEM_CLASSES, coveredSolverKeys, ghostSolverKeys } = await impContracts();
const { REGISTRY_SOLVER_KEYS } = await impDatacore("solvers/solver-registry.js");

let red = false;
const fail = (m) => {
  console.error("✗ " + m);
  red = true;
};

if (!SOLVER_COVERAGE || Object.keys(SOLVER_COVERAGE).length === 0) {
  fail("SOLVER_COVERAGE 为空——覆盖矩阵无效（导入路径漂移？）。");
}
if (!Array.isArray(REGISTRY_SOLVER_KEYS) || REGISTRY_SOLVER_KEYS.length === 0) {
  fail("REGISTRY_SOLVER_KEYS 为空——无法对账（导入路径漂移？）。");
}

// ① 幽灵 key 检测：矩阵引用的每个 solverKey 必 ∈ SOLVER_REGISTRY。
const ghosts = ghostSolverKeys(REGISTRY_SOLVER_KEYS);
if (ghosts.length > 0) {
  for (const g of ghosts) {
    const classes = Object.entries(SOLVER_COVERAGE)
      .filter(([, keys]) => keys.includes(g))
      .map(([c]) => c);
    fail(
      `覆盖矩阵引用幽灵 solver「${g}」（类目 ${JSON.stringify(classes)}）—— 该 key ∉ SOLVER_REGISTRY。` +
        `删除引用，或先在 datacore SOLVER_REGISTRY 注册真实求解器（对齐 no-fake-done·防幽灵）。`,
    );
  }
}

// ② 覆盖 ∩ 缺口 = ∅。
const covered = new Set(Object.keys(SOLVER_COVERAGE));
const uncovered = new Set(UNCOVERED_PROBLEM_CLASSES);
for (const c of uncovered) {
  if (covered.has(c)) {
    fail(`问题类目「${c}」既在 SOLVER_COVERAGE（已覆盖）又在 UNCOVERED_PROBLEM_CLASSES（缺口）——自相矛盾，二择一。`);
  }
}

const refCount = coveredSolverKeys().length;

if (red) {
  console.error("\n✗ solver-coverage:check 未过：覆盖矩阵引用了未注册的求解器 key 或缺口声明自相矛盾。");
  process.exit(1);
}

// ③ 诚实缺口显式列出（非静默）。
console.log(
  `✓ solver-coverage:check 通过（${covered.size} 个已覆盖问题类目 · 引用 ${refCount} 个求解器 key 全 ∈ SOLVER_REGISTRY（${REGISTRY_SOLVER_KEYS.length} 注册）·零幽灵）。`,
);
console.log(
  `  诚实缺口（${uncovered.size} 个未覆盖类目·显式列出·非静默 Path B·驱动 A3 补齐优先级）：${[...uncovered].join(", ")}`,
);
