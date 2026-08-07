#!/usr/bin/env node
/**
 * 门 `output-units:check`（WO-OUTPUT-UNITS · 欠账 #63「裸数字无单位」剩下的半条 · 闭本体 §8 G-UNIT-NORMALIZE）：
 *
 * ── 治的病 ──
 * 用户原话：「系统所有类似的数字，需要配套它的意义，让用户看得懂，不是只是显示一个数字」。
 * 上一轮 WO-UNIT-MEANING 逐视图补过一批，但**判据一直是人眼核对**——谁也说不出「今天还剩几处裸的」。
 * 2026-08-07 机械枚举 17 个求解器真实输出树：**184 处** 带值数字字段同级无任何量纲元数据。
 * 最刺眼的一条：`capacity_forecast` 顶层 `p50/p90/gap/baselineDemand/effectiveDemand` **全裸**，
 * 而配了单位的是它下面的下钻小表 `byProcessModel[].unit="套/天"` —— 首屏大数反而没有量纲。
 *
 * ── 本门做什么（**跑真求解器·不读源码字符串**）──
 * 内存态起 DataCore + 合成种子（seed 42）→ 逐个 invoke 已覆盖求解器 → **走输出对象树**：
 *   断言① 覆盖：每个「带值数字字段」要么在 contracts `SOLVER_FIELD_UNITS` 登记，
 *          要么命中 `STRUCTURAL`（结构性数字·不是"量"）或 `EXEMPT`（**逐条带理由**的显式豁免）。
 *          —— 新加一个裸数字字段 = 三张表都不命中 = 门红。这就是它的牙。
 *   断言② 真下发：输出根真的挂着 `units` 键，且键集 === 该求解器登记表（登记了却没发 = 假绿）。
 *   断言③ 不空转：登记表里的每个字段路径**在真实输出里真存在**（字段改名/删除 → 登记表过期即红）。
 *   断言④ 诚实边界：未覆盖求解器逐个列出（残口台账·不假装已治）。
 *
 * ── green→red 有牙（变异反证·须真跑）──
 *   · 把 `SOLVER_FIELD_UNITS.capacity_forecast` 删掉 `p50` 一行 → 断言① 红（p50 变回裸数字）。
 *   · 把 `service.ts invoke` 的 `out.units = units` 注释掉 → 断言② 红（登记了没发）。
 *   · 把登记表里 `p50` 改名成 `p50x` → 断言③ 红（表过期）。
 *
 * 用法：node scripts/check-output-units.mjs（先 pnpm --filter @platform/contracts build && pnpm --filter datacore build）。
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7 门 output-units:check · §8 G-UNIT-NORMALIZE。
 */
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("../", import.meta.url);
const abs = (rel) => new URL(rel, root);
const fails = [];
const notes = [];

const D = abs("apps/datacore/dist/");
if (!existsSync(new URL("app.js", D))) {
  console.error("✗ output-units:check 失败（前置）：datacore dist 未构建 —— 先 pnpm --filter datacore build");
  process.exit(1);
}

const { loadConfig } = await import(new URL("config.js", D).href);
const { createMemoryRepos } = await import(new URL("repo/memory.js", D).href);
const { LocalFsBlobStore } = await import(new URL("blob.js", D).href);
const { ScriptedLlmClient } = await import(new URL("llm.js", D).href);
const { buildApp } = await import(new URL("app.js", D).href);
const { seedDemo } = await import(new URL("seed.js", D).href);
// 走 dist 绝对路径（同 check-arg-drop-seam.mjs·不依赖仓根有无 @platform/contracts 依赖声明）。
const { SOLVER_FIELD_UNITS, UNITS_COVERED_SOLVERS } = await import(abs("packages/contracts/dist/index.js").href);

/**
 * 结构性数字（**不是"量"**·配单位反而是噪音）：主键/序号/开关/坐标/版本/比例系数…
 * 判据是「它回答的是『哪一个/第几个/是不是』而不是『多少』」。
 */
const STRUCTURAL = /(^|[._])(id|ids|idx|index|rank|seq|no|version|len|length|size|step|level|lon|lat|ts|at|seed|top|k|code)$/i;

/**
 * 显式豁免（**逐条带理由**·防悄悄豁免真断裂）。理由必须说清「为什么这个数字不需要量纲」，
 * 或「为什么今天给不出**经确证的**量纲」——后者是残口，不是已治，须同时在 notes 里报出来。
 */
const EXEMPT = {
  capacity_forecast: {
    "whatIf.nightShifts": "入参回显·夜班班次数（整数计数·前端与旋钮同处显示，量纲在旋钮标签上）",
    "whatIf.extraChannels": "入参回显·扩通道数（同上）",
    "whatIf.outsourceRatio": "入参回显·外协比例（0–1 比率·红线文案由 outsourceRedlineRejectReason 单源格式化）",
    "whatIf.adjustedP50": "与顶层 p50 同尺度（万套/窗口）·前端复用 units.p50 格式化（同族不重复登记）",
    "whatIf.adjustedP90": "与顶层 p90 同尺度·同上",
    "whatIf.physicalCap": "与顶层 p50 同尺度·同上",
    "whatIf.gap": "与顶层 gap 同尺度·同上",
    "batchRows[].cumDemand": "与顶层 effectiveDemand 同尺度·同上",
    "batchRows[].cumP90": "与顶层 p90 同尺度·同上",
    "batchRows[].qty": "批次请求量·与顶层 qty 同尺度·同上",
    "batchRows[].wkEff": "第几周槽位（序号非时长）",
  },
  base_capacity_outlook: {
    "horizons[].dayPlan[].leadTime.days": "字段名自带量纲（`days`）+ 同级 source.value 由 leadTime 结构自释义",
    "horizons[].dayPlan[].leadTime.source.value": "provenance 结构里的原值回显·量纲由其 leadTime.days 同级给出",
    "dayPlan[].leadTime.days": "同上（顶层便捷字段·与 horizons[] 内同一结构）",
    "dayPlan[].leadTime.source.value": "同上",
  },
  affected_orders: {},
  atp_check: {},
};

// ── 起服务 + 种子 ──
const blobDir = await mkdtemp(join(tmpdir(), "dc-units-"));
const config = loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", BLOB_DIR: blobDir, JWT_SECRET: "test-secret" });
const repos = createMemoryRepos();
const built = await buildApp({ config, repos, blob: new LocalFsBlobStore(blobDir), llm: new ScriptedLlmClient() });
await seedDemo(repos);
const seedRes = await built.app.inject({
  method: "POST", url: "/a/v1/synthetic/jobs",
  headers: { "x-debug-user": "demo:admin:admin" },
  payload: { industry: "battery-manufacturing", scale: "S", seed: 42 },
});
if (seedRes.statusCode !== 202) {
  console.error(`✗ output-units:check 失败（前置）：合成种子 ${seedRes.statusCode} ${seedRes.body.slice(0, 200)}`);
  process.exit(1);
}
const CTX = { tenantId: "demo", userId: "gate", roles: ["admin"], attributes: {} };
const bases = await repos.objects.listByType("demo", "Base");
const orders = await repos.objects.listByType("demo", "Order");
const someBase = String(bases[0].props.baseId);
const someOrder = String(orders[0].props.so ?? orders[0].props.orderId);

/** 每个已覆盖求解器的**驱动实参**（要能真跑出有数据的输出·空输出证明不了任何事）。 */
const PROBES = {
  // 三条分支各跑一次：前向 forecast / base 作用域收窄 / 反向 threshold（thresholdQty 只在第三条出现——
  // 少跑一条，断言③ 就会把 `thresholdQty` 误报成"登记表过期"，本门第一次跑就真踩到了）。
  capacity_forecast: [{ modelId: "4680-NCM" }, { modelId: "4680-NCM", base: someBase }, { modelId: "4680-NCM", mode: "threshold" }],
  base_capacity_outlook: [{ baseId: someBase }],
  affected_orders: [{}],
  atp_check: [{ so: someOrder }],
};

/**
 * 走输出树 → 收集「带值数字字段」的规范路径（数组下标归一为 []）。
 *
 * ⚠ 已有的**行内量纲**算覆盖，不重复要求登记：某个对象节点自带非空 `unit`（上一轮 WO-UNIT-MEANING
 * 给 `byProcessModel[]` / `byModel[]` 加的那种「每行发自己的 unit」），说明这行的数字**已有后端下发的量纲**，
 * 该节点内的数字字段整体跳过。本门要抓的是**没有任何量纲元数据**的那些，不是逼所有机制收敛成一种。
 */
const ROW_UNIT_KEYS = ["unit", "valueKind", "uom"];
function collectNumericPaths(node, path, acc, depth = 0) {
  if (node === null || typeof node !== "object" || depth > 7) return;
  if (Array.isArray(node)) {
    node.slice(0, 3).forEach((v) => collectNumericPaths(v, `${path}[]`, acc, depth + 1));
    return;
  }
  const rowHasUnit = ROW_UNIT_KEYS.some((u) => typeof node[u] === "string" && node[u] !== "");
  for (const [k, v] of Object.entries(node)) {
    if (k === "units" || k === "provenance" || k === "evaluatedRules") continue; // 元数据自身不参与
    const p = path ? `${path}.${k}` : k;
    if (typeof v === "number" && Number.isFinite(v)) {
      if (!rowHasUnit) acc.add(p);
    } else if (v && typeof v === "object") collectNumericPaths(v, p, acc, depth + 1);
  }
}

for (const solverKey of UNITS_COVERED_SOLVERS) {
  const table = SOLVER_FIELD_UNITS[solverKey] ?? {};
  const exempt = EXEMPT[solverKey] ?? {};
  const seen = new Set();
  let sawUnits = false;
  let ran = 0;
  for (const args of PROBES[solverKey] ?? []) {
    let out;
    try {
      out = await built.services.solvers.invoke(CTX, solverKey, args);
    } catch (e) {
      fails.push(`【${solverKey}】驱动实参 ${JSON.stringify(args)} 跑不出结果：${e?.message?.slice(0, 160)}（门必须跑真输出·跑不动即无法断言）`);
      continue;
    }
    ran++;
    // ── 断言② 真下发 ──
    if (out.units && typeof out.units === "object") {
      sawUnits = true;
      const emitted = Object.keys(out.units).sort().join(",");
      const declared = Object.keys(table).sort().join(",");
      if (emitted !== declared)
        fails.push(`断言②【${solverKey}】输出 units 键集与登记表不一致（下发=${emitted.slice(0, 120)}… vs 登记=${declared.slice(0, 120)}…）`);
    }
    collectNumericPaths(out, "", seen);
  }
  if (ran === 0) continue;
  if (!sawUnits)
    fails.push(
      `断言②【${solverKey}】输出根**没有** units 键 —— 登记表有、真下发没有 = 假绿（登记了不等于发出去了）。` +
        `修：service.ts invoke 包装层 out.units = solverUnitsFor(solverKey)。`,
    );

  // ── 断言① 覆盖 ──
  const bare = [...seen].filter((p) => !(p in table) && !(p in exempt) && !STRUCTURAL.test(p.split(".").pop() ?? p));
  for (const p of bare.sort())
    fails.push(
      `断言①【${solverKey}】裸数字字段「${p}」—— 既不在 contracts SOLVER_FIELD_UNITS 登记、也不在本门 EXEMPT（带理由）、` +
        `也不是结构性数字。用户看见一个数字却不知道它是什么量纲（#63）。` +
        `修：① 能确证量纲 → 在 packages/contracts/src/solver-units.ts 登记；② 确证不了 → 写进 EXEMPT 并说明理由（残口，不臆造单位）。`,
    );

  // ── 断言③ 不空转（登记表不许过期）──
  for (const p of Object.keys(table))
    if (!seen.has(p))
      fails.push(
        `断言③【${solverKey}】登记表里的「${p}」在真实输出里**不存在** —— 字段改名/删除后登记表没跟着改，` +
          `这份"单位真值"已经过期（登记表说了不算，真实输出说了才算）。`,
      );

  // 逐项按**真实出现过的字段**归类（拿表长度做减法会算出负数——第一版就是这么写的，
  // 因为豁免/登记里有些路径本次探针没跑到。台账数字自己都对不上，就没资格要求别人对账）。
  const hitTable = [...seen].filter((p) => p in table).length;
  const hitExempt = [...seen].filter((p) => !(p in table) && p in exempt).length;
  notes.push(
    `  · ${solverKey}：真实数字字段 ${seen.size} → 登记量纲 ${hitTable} / 带理由豁免 ${hitExempt} / 结构性 ${seen.size - hitTable - hitExempt - bare.length} / 裸 ${bare.length}`,
  );
}

// ── 断言④ 诚实边界：未覆盖求解器逐个列出（残口台账·不假装已治）──
const allKeys = (await import(new URL("solvers/service.js", D).href)).SOLVER_KEYS ?? [];
const uncovered = [...allKeys].filter((k) => !UNITS_COVERED_SOLVERS.includes(k));

if (notes.length) {
  console.log("output-units:check · 已覆盖求解器逐个对账：");
  for (const n of notes) console.log(n);
}
if (fails.length) {
  console.error(`\n✗ output-units:check 失败（${fails.length}）：`);
  for (const f of fails) console.error("  - " + f);
  process.exit(1);
}
console.log(
  `\n✓ output-units:check 通过：${UNITS_COVERED_SOLVERS.length} 个已覆盖求解器 · 每个带值数字字段均有量纲元数据` +
    `（登记 ⊕ 带理由豁免 ⊕ 结构性），且 units 真经 invoke 下发、登记表与真实输出对得上。` +
    `\n  ⚠ 诚实边界（残口·不假装已治）：另有 ${uncovered.length} 个求解器尚未纳入量纲登记 —— ` +
    `${uncovered.slice(0, 12).join("、")}${uncovered.length > 12 ? "…" : ""}。` +
    `\n     纳入方式：在 packages/contracts/src/solver-units.ts 补该 solver 的字段表 + 本门 PROBES 补驱动实参（门随即对它要求全覆盖）。`,
);
