#!/usr/bin/env node
/**
 * 门 `object-interface:check`（WO-69 P3 · 对象接口/多态抽象 · S7/S8/S9 · R6/R9/R13）。
 *
 * 为什么要有这道门：接口最容易退化成**注释**——声明一堆"所有 X 都得有 Y"，然后谁也不校验。
 * 本仓已有多具"清单不被机器比对就漂"的尸体，故本门做四件事：
 *
 *  ① **接缝实跑（头号）**：委派 `apps/datacore/test/object-interface.seam.test.ts` —— 真起 app、
 *     真发布本体、真被拦。本 .mjs 只负责**真实捕获它的退出码**（禁止 `cmd | tail; echo $?` 的假绿）。
 *  ② **R9 四方同步**：新表 `object_interfaces` 必须在 repo 接口 + memory + pg + migrations 四处齐全。
 *  ③ **发布门真挂在发布路径上**：`publishVersion` 必须调用 `assertInterfaceConformance`
 *     （门若没挂在链路上，测试再绿也是"绿测试≠能用"）。
 *  ④ **种子接口的行为声明落到真注册表**（跑 dist，不是读注释）：`functions[].solverKey` ⊆ SOLVER_KEYS
 *     且必须有 WO-69 P2 本体签名；`actions[].actionTypeKey` ⊆ 已注册 ActionType；
 *     且**每个实现者类型真声明了接口要求的每条属性**（S7 的静态影子：漏一个即红）。
 *  ⑤ **平台是扁平的**：本体层不得引入类型继承（`extendsTypeKey|parentTypeKey|inheritsFrom`）——
 *     组合优于继承，不把深继承的问题引进来。
 *
 * 校验经已 build 的 dist：先 pnpm -r build（至少 contracts + datacore）。
 * 用法：node scripts/check-object-interface.mjs
 */
/* ── 退出码纪律 · 顶层兜底（WO-GATE-RC2-DISCIPLINE）─────────────────────────────
 * 本仓门的退出码是**三分**约定（docs/SOP-reviewer-claim-discipline.md §3）：
 *   0 = 干净 · 1 = **真有问题**（先修代码）· 2 = **工具自己坏了**（只许说「我没查出来」）。
 * 而 node 对**未捕获异常一律退 1** —— 恰好撞上「真有问题」这个码。于是「门根本没跑起来」
 * （缺依赖 / 只读 FS / 权限 / OOM / node 版本差异 / dist 没构建）会被 gate.sh 和人一起
 * 读成「你的代码有问题」，方向**正好相反**。
 * 形态（铁律 0.6 句式）：「我用『进程非 0 退出』当作『代码有问题』的证据，而前者并不度量后者。」
 *
 * 这段只**加**默认失败方向，**不动**任何既有 exit(0)/exit(1)：兜底若把真违规也吞成 2，
 * 那是拿一个更糟的假绿换掉一个假红。RC=1 仍然只由主判据明确判负产生。
 * 守门的门：scripts/check-gate-exit-discipline.mjs。 */
process.on("uncaughtException", (e) => gateToolBroken(e));
process.on("unhandledRejection", (e) => gateToolBroken(e));
function gateToolBroken(e) {
  console.error(`⛔ check-object-interface.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertDistFresh } from "./dist-freshness.mjs";

const root = new URL("../", import.meta.url);
const abs = (rel) => new URL(rel, root);
const read = (rel) => (existsSync(abs(rel)) ? readFileSync(fileURLToPath(abs(rel)), "utf8") : null);
const fail = (msg) => {
  console.error(`✗ object-interface:check ${msg}`);
  process.exit(1);
};

const need = [
  ["contracts", "packages/contracts/dist/object-interface.js"],
  ["datacore/battery", "apps/datacore/dist/synthetic/battery.js"],
  ["datacore/ontology-signature", "apps/datacore/dist/solvers/ontology-signature.js"],
  ["datacore/battery-extended", "apps/datacore/dist/synthetic/battery-extended.js"],
];
for (const [label, rel] of need) {
  if (!existsSync(abs(rel))) fail(`：${label} dist 未构建（${rel}）——先 pnpm -r build`);
}

const problems = [];

// --- ② R9 四方同步 ---------------------------------------------------------
const FOUR = [
  ["repo 接口", "apps/datacore/src/repo/repo.ts", /objectInterfaces\s*:\s*Store<ObjectInterfaceRecord>/],
  ["memory 仓储", "apps/datacore/src/repo/memory.ts", /objectInterfaces\s*:\s*new MemStore\(\)/],
  ["pg 仓储", "apps/datacore/src/repo/pg.ts", /objectInterfaces\s*:\s*new PgStore\(pool,\s*"object_interfaces"\)/],
  // ⚠ 编号 032 而非原分支上的 028：canonical 已有 `028_perturbations.sql`，撞号被
  // `check-migration-numbering.mjs` 当场判红（迁移号是执行顺序的唯一表达）。并线时按该门的
  // 「给后到的那个改成尚未占用的编号」改到 032（当时 datacore 最大号 031）。
  ["migration", "apps/datacore/migrations/032_object_interfaces.sql", /CREATE TABLE IF NOT EXISTS object_interfaces/],
];
for (const [label, rel, re] of FOUR) {
  const src = read(rel);
  if (!src) problems.push(`R9 四方同步缺 ${label}：${rel} 不存在`);
  else if (!re.test(src)) problems.push(`R9 四方同步缺 ${label}：${rel} 未见 object_interfaces 落点`);
}

// --- ③ 发布门真挂在发布路径上 ---------------------------------------------
const ontoSrc = read("apps/datacore/src/ontology.ts") ?? "";
const publishBlock = ontoSrc.slice(ontoSrc.indexOf("async publishVersion("), ontoSrc.indexOf("async currentVersion("));
if (!/assertInterfaceConformance\(/.test(publishBlock)) {
  problems.push("发布门未挂在 publishVersion 上（ontology.ts publishVersion 内未见 assertInterfaceConformance）——门不在链路上 = 绿测试≠能用");
}
if (!/checkInterfaceConformance/.test(ontoSrc)) {
  problems.push("ontology.ts 未使用 contracts 的 checkInterfaceConformance（一致性判定必须单一出处，不许各处再实现一套）");
}

// --- ⑤ 平台是扁平的：不得引入类型继承 --------------------------------------
const INHERIT_RE = /\b(extendsTypeKey|parentTypeKey|inheritsFrom|superTypeKey)\b/;
for (const rel of [
  "packages/contracts/src/object-interface.ts",
  "apps/datacore/src/domain.ts",
  "apps/datacore/src/ontology.ts",
  "apps/datacore/src/ontology-governance.ts",
]) {
  const src = read(rel);
  if (src && INHERIT_RE.test(src)) problems.push(`${rel} 出现类型继承字段（组合优于继承：平台是扁平的，不引入深继承）`);
}

// --- ④ 种子接口的行为/字段声明落到真注册表（跑 dist）-----------------------
// ⛔ 守卫必须在 import dist **之前**（dist-freshness:check 的判据②）：
//    本门读 dist 里的种子接口声明与求解器注册表；dist 过期 ⇒ 拿旧产物断言新源码，
//    「接口漏声明」这类结论会凭空出现或凭空消失。
assertDistFresh(["apps/datacore/dist", "packages/contracts/dist"], { gate: "object-interface:check" });

const { BATTERY_OBJECT_INTERFACES, BATTERY_TYPE_INTERFACE_BINDINGS, BATTERY_ACTION_TYPES, batteryObjectTypes } =
  await import(abs("apps/datacore/dist/synthetic/battery.js").href);
const { extendedObjectTypes } = await import(abs("apps/datacore/dist/synthetic/battery-extended.js").href);
const { SOLVER_ONTOLOGY_SIGNATURES } = await import(abs("apps/datacore/dist/solvers/ontology-signature.js").href);
const { checkInterfaceConformance } = await import(abs("packages/contracts/dist/object-interface.js").href);

// SOLVER_KEYS 单一来源（solvers/service.js 有重运行时依赖 → 从源码取字面量块，与 check-system-ontology 同法）
const slvSrc = read("apps/datacore/src/solvers/service.ts") ?? "";
const block = slvSrc.match(/SOLVER_KEYS\s*=\s*\[([\s\S]*?)\]/);
const solverKeys = new Set(block ? [...block[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]) : []);
const actionKeys = new Set(BATTERY_ACTION_TYPES.map((a) => a.key));

const allTypes = [...batteryObjectTypes(), ...extendedObjectTypes()];
for (const iface of BATTERY_OBJECT_INTERFACES) {
  for (const f of iface.functions ?? []) {
    if (!solverKeys.has(f.solverKey)) problems.push(`接口 ${iface.key} 的 functions '${f.solverKey}' 不在 SOLVER_KEYS 真求解器注册表`);
    if (!SOLVER_ONTOLOGY_SIGNATURES[f.solverKey]) {
      problems.push(`接口 ${iface.key} 的 functions '${f.solverKey}' 无 WO-69 P2 本体签名（读取面未知 → 行为无法兑现）`);
    }
  }
  for (const a of iface.actions ?? []) {
    if (!actionKeys.has(a.actionTypeKey)) problems.push(`接口 ${iface.key} 的 actions '${a.actionTypeKey}' 不在已注册 ActionType`);
  }
}

// S7 的静态影子：每个实现者都得真长出接口要求的每条属性（漏一个即红）。
const implementerKeys = Object.keys(BATTERY_TYPE_INTERFACE_BINDINGS);
if (implementerKeys.length < 2) problems.push(`验收样例要求"至少两个既有类型实现接口"，当前只有 ${implementerKeys.length} 个`);
const ifaceRecords = BATTERY_OBJECT_INTERFACES.map((i, idx) => ({
  ...i,
  id: `oif_gate_${idx}`,
  tenantId: "__gate__",
  version: 1,
  status: "PUBLISHED",
}));
const typeViews = implementerKeys.map((key) => {
  const def = allTypes.find((t) => t.key === key);
  if (!def) problems.push(`实现者类型 ${key} 在 battery/extended 种子里不存在`);
  const binding = BATTERY_TYPE_INTERFACE_BINDINGS[key];
  return {
    key,
    properties: (def?.properties ?? []).map((p) => ({ propKey: p.propKey, dataType: p.dataType })),
    derivedPropKeys: (def?.derivedProperties ?? []).map((d) => d.propKey),
    actions: binding.actions,
    // 种子里 implements 用 "latest"；本门用 v1 记录做等价校验（种子只有一个版本）
    implements: binding.implements.map((r) => ({ interfaceKey: r.interfaceKey, version: 1 })),
  };
});
const violations = checkInterfaceConformance({
  types: typeViews,
  interfaces: ifaceRecords,
  actionTypeKeys: [...actionKeys],
  solverSignatures: SOLVER_ONTOLOGY_SIGNATURES,
});
for (const v of violations) problems.push(`种子实现者不合规：[${v.code}] ${v.message}`);

console.log(
  `· 接口：${BATTERY_OBJECT_INTERFACES.length} 个（${BATTERY_OBJECT_INTERFACES.map((i) => i.key).join(",")}）· 实现者 ${implementerKeys.length} 个（${implementerKeys.join(",")}）· 种子一致性违规 ${violations.length}`,
);

// --- ① 接缝实跑（真实捕获退出码，禁止假绿）--------------------------------
const res = spawnSync(
  "npx",
  ["vitest", "run", "test/object-interface.seam.test.ts", "--reporter=default"],
  { cwd: fileURLToPath(abs("apps/datacore")), encoding: "utf8", stdio: "pipe", env: process.env },
);
const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
if (res.status !== 0) {
  // 失败时打印错误原文（不许只 tail 几行把 error TS|FAIL|AssertionError 挤掉）
  console.error(out);
  fail(`：接缝测试 object-interface.seam.test.ts 未通过（exit=${res.status}）`);
}
const passed = out.match(/Tests\s+(\d+) passed/);
console.log(`· 接缝实跑：object-interface.seam.test.ts ${passed ? `${passed[1]} 条` : ""}通过（真起 app · 真发布本体 · 真被拦）`);

if (problems.length > 0) {
  console.error("✗ object-interface:check 未通过：");
  for (const p of problems) console.error(`  · ${p}`);
  process.exit(1);
}
console.log("✓ object-interface:check 通过（R9 四方同步 · 发布门在链路上 · 行为落真注册表 · 扁平无继承 · 接缝实跑）");
