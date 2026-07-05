#!/usr/bin/env node
/**
 * 门 `solver-label-coverage:check`（WO-ANSWER-PROJECTION-HUMANIZE·治 G-3 答案投影人话化·验收 C2）。
 *
 * 用户亲报（审计簇③⑤）：`summarizeSolverOutput` 把裸英文字段 key 直当 KPI label（S/G/s0）。
 * 本门遍历 datacore 求解器派发单一来源 `SOLVER_REGISTRY` 的**全部 outputShape 顶层字段**，断言：
 *   每个字段要么在 agentcore 投影登记 `FIELD_LABELS`（人话 label·可含 solverKey 消歧键）里，
 *   要么在**元字段** `META_FIELDS`（脚注·非 KPI）或**结构性容器** `STRUCTURAL_FIELDS`（投表/展开·非标量）里。
 * 缺失即红（基线 ratchet：新增求解器字段必须补人话 label，防裸 key 回潮）。
 *
 * 依赖 datacore + agentcore 已构建（gates 链 pnpm -r build 在前）。导入编译产物静态校验（green→red 自证）。
 */
const impDatacore = async (p) =>
  import(`../apps/datacore/dist/${p}`).catch((e) => {
    console.error(`✗ solver-label-coverage:check 导入 datacore dist 失败（先 pnpm --filter datacore build）：${e.message}`);
    process.exit(1);
  });
const impAgentcore = async (p) =>
  import(`../apps/agentcore/dist/${p}`).catch((e) => {
    console.error(`✗ solver-label-coverage:check 导入 agentcore dist 失败（先 pnpm --filter agentcore build）：${e.message}`);
    process.exit(1);
  });

const { registryOutputShapes } = await impDatacore("solvers/solver-registry.js");
const { FIELD_LABELS, META_FIELDS, STRUCTURAL_FIELDS } = await impAgentcore("workflow/solver-field-labels.js");

let red = false;
const fail = (m) => { console.error("✗ " + m); red = true; };

const flatKeys = new Set(Object.keys(FIELD_LABELS).map((k) => (k.includes(":") ? k.split(":")[1] : k)));
const scopedKeys = new Set(Object.keys(FIELD_LABELS).filter((k) => k.includes(":")));

const shapes = registryOutputShapes();
let checked = 0;
let covered = 0;
for (const [solverKey, fields] of Object.entries(shapes)) {
  for (const field of fields) {
    checked++;
    const scoped = scopedKeys.has(`${solverKey}:${field}`);
    const flat = flatKeys.has(field);
    const meta = META_FIELDS.has(field);
    const structural = STRUCTURAL_FIELDS.has(field);
    if (scoped || flat || meta || structural) { covered++; continue; }
    fail(
      `求解器「${solverKey}」输出字段「${field}」无人话登记 —— ` +
        `补 FIELD_LABELS['${field}']（或消歧键 '${solverKey}:${field}'）人话 label(+单位)，` +
        `或若是元字段/结构性容器则加入 META_FIELDS / STRUCTURAL_FIELDS。`,
    );
  }
}

if (checked === 0) fail("未遍历到任何 registry 输出字段——门无效（导入路径/派生漂移？）。");

if (red) {
  console.error("\n✗ solver-label-coverage:check 未过：存在裸英文 key 会被直当 KPI label 面向用户展示（治 G-3）。为上列字段补人话 label+单位。");
  process.exit(1);
}
console.log(`✓ solver-label-coverage:check 通过（${Object.keys(shapes).length} 个求解器 · ${checked} 个输出字段均有人话 label / 元字段脚注 / 结构性容器归类·零裸 key·${covered}=${checked}）。`);
