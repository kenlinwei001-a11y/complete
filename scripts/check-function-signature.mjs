#!/usr/bin/env node
/**
 * 门 `function-signature:check`（WO-69 P2 · Function 本体签名 · S5/S6 · R6 · R13）。
 *
 * 为什么要有这道门：本仓已有多份「手写清单 vs 实现漂移」的尸体——清单一旦不被机器比对，
 * 漂了没人知道，直到线上出错数字。Function 本体签名如果只是注释，它就是下一具。故本门做三件事：
 *
 *  ① **S5 实跑比对（头号）**：委派 `apps/datacore/test/ontology-signature.seam.test.ts` —— 真跑 19 组
 *     求解器样本，用记录器（拦 listByType + props Proxy）观测**真被读到的类型/属性**，与签名声明比对；
 *     漏声明即红。本 .mjs 只负责**真实捕获它的退出码**（不许 `cmd | tail; echo $?` 的假绿）。
 *  ② **单一出处**：DataCore 目录项的 ontologySignature 必须逐字节等于注册表
 *     `SOLVER_ONTOLOGY_SIGNATURES`（无第二份手填清单）。
 *  ③ **DRIL 派生而非重复**：AgentCore `projectSolvers` 产出的 inputSpec 必须逐字节等于
 *     `projectOntologySignature(签名)`；**无签名的求解器必须没有 inputSpec**（若还有 → 说明 DRIL
 *     侧另存了一份手填读取面清单，正是本门要杀的东西）。
 *
 * 校验经已 build 的 dist（构建期检查，非源码跨 app import）：
 *   先 pnpm -r build（至少 contracts + datacore + agentcore）。
 * 用法：node scripts/check-function-signature.mjs
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
  console.error(`⛔ check-function-signature.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertDistFresh } from "./dist-freshness.mjs";

const root = new URL("../", import.meta.url);
const abs = (rel) => new URL(rel, root);
const fail = (msg) => {
  console.error(`✗ function-signature:check ${msg}`);
  process.exit(1);
};

const need = [
  ["contracts", "packages/contracts/dist/index.js"],
  ["datacore/ontology-signature", "apps/datacore/dist/solvers/ontology-signature.js"],
  ["datacore/catalog", "apps/datacore/dist/catalog.js"],
  ["agentcore/dril-projector", "apps/agentcore/dist/dril/resource-projector.js"],
];
// ⛔ 守卫必须在 import dist **之前**（dist-freshness:check 的判据②）：
//    本门比对 dist 里的 SOLVER_ONTOLOGY_SIGNATURES 与 DRIL 投影；dist 过期 ⇒ 刚改的签名不在产物里，
//    门会报「签名漂移」而源码其实是一致的——方向恰好相反。
//
// ⚠️ 2026-08-13 · WO-R9-DISTFRESH-RC2：这里原先在守卫**之前**还手写了一个
//    `for (…need…) if (!existsSync) fail(…)` 前置存在性循环，而 `fail()` 是 `exit(1)`。
//    于是「没 build」这一纯环境状态**永远走不到共享守卫**，本门恒报 RC=1（= 被扫代码有问题）。
//    **grep 到 `assertDistFresh(` 并不等于那行会被执行**——本单普查时正是靠实跑 RC 才抖出这两处
//    （另一处见 check-object-interface.mjs），一次 grep 看不见（CLAUDE.md 铁律 0.5：再追一层）。
//    现删掉手写循环，改把 need 的**逐个产物路径**交给共享守卫：它本就逐条查存在性（kind=MISSING），
//    额外还查新鲜度，判据是原来的**超集**，且退 2。
assertDistFresh(need.map(([, rel]) => rel), { gate: "function-signature:check" });

const { SOLVER_ONTOLOGY_SIGNATURES, serializableSignature, mergeReadSurfaces } = await import(
  abs("apps/datacore/dist/solvers/ontology-signature.js").href
);
const { ALL_SOLVER_CATALOG, attachOntologySignature } = await import(abs("apps/datacore/dist/catalog.js").href);
const { projectSolvers, projectOntologySignature } = await import(
  abs("apps/agentcore/dist/dril/resource-projector.js").href
);

const problems = [];
const signedKeys = Object.keys(SOLVER_ONTOLOGY_SIGNATURES).sort();

// ── ① 注册表自身形状（S6 的静态半：命名非空 / 结构合法；「在本体里存在」由 seam 测真跑校验）────
if (signedKeys.length < 8) problems.push(`已签名求解器仅 ${signedKeys.length} 个（WO 要求 ≥8 高频求解器）`);
for (const key of signedKeys) {
  const sig = SOLVER_ONTOLOGY_SIGNATURES[key];
  const surfaces = [...(sig.reads ?? []), ...(sig.writes ?? [])];
  if (surfaces.length === 0 && !sig.resolveReads) {
    problems.push(`${key}: 签名既无 reads/writes 也无 resolveReads —— 空签名会被守卫读成"什么都不读"（放水）`);
  }
  for (const s of surfaces) {
    if (typeof s.typeKey !== "string" || s.typeKey.trim() === "") problems.push(`${key}: 存在空 typeKey`);
    for (const p of s.propKeys ?? []) {
      if (typeof p !== "string" || p.trim() === "") problems.push(`${key}: ${s.typeKey} 存在空 propKey`);
    }
  }
  // mergeReadSurfaces 幂等（R6 确定性：同输入同序同输出）。
  const once = JSON.stringify(mergeReadSurfaces(sig.reads ?? []));
  const twice = JSON.stringify(mergeReadSurfaces(mergeReadSurfaces(sig.reads ?? [])));
  if (once !== twice) problems.push(`${key}: mergeReadSurfaces 非幂等（R6 破）`);
}

// ── ② 单一出处：目录项签名 === 注册表 ────────────────────────────────────────────
const attached = attachOntologySignature(ALL_SOLVER_CATALOG);
for (const item of attached) {
  const expected = serializableSignature(item.key);
  const got = item.ontologySignature;
  if (JSON.stringify(got ?? null) !== JSON.stringify(expected ?? null)) {
    problems.push(`目录项 ${item.key} 的 ontologySignature 与注册表不一致（出现了第二份清单）`);
  }
}
const attachedSigned = attached.filter((i) => i.ontologySignature).map((i) => i.key).sort();
const inCatalog = signedKeys.filter((k) => ALL_SOLVER_CATALOG.some((i) => i.key === k)).sort();
if (JSON.stringify(attachedSigned) !== JSON.stringify(inCatalog)) {
  problems.push(`目录附签集合 ≠ 注册表∩目录（附 ${attachedSigned.join(",")} / 期望 ${inCatalog.join(",")}）`);
}

// ── ③ DRIL 派生而非重复 ─────────────────────────────────────────────────────────
const projected = projectSolvers(attached);
for (const r of projected) {
  const item = attached.find((i) => i.key === r.key);
  const expect = projectOntologySignature(item?.ontologySignature);
  if (JSON.stringify(r.inputSpec ?? null) !== JSON.stringify(expect.inputSpec ?? null)) {
    problems.push(`DRIL ${r.key}: inputSpec 未派生自 ontologySignature（存在第二份手填清单？）`);
  }
  if (!item?.ontologySignature && r.inputSpec) {
    problems.push(`DRIL ${r.key}: 无签名却有 inputSpec —— 只可能来自另一份手填读取面清单`);
  }
}
// requiredProps 语义反接自检（WO 点名的历史坑）：key 必须是**对象类型**、value 才是属性列表。
const qm = projected.find((r) => r.key === "quote_margin");
if (!qm?.inputSpec?.objectTypes?.includes("Material")) {
  problems.push("DRIL quote_margin: inputSpec.objectTypes 未含 Material（派生断了）");
}
if (!/unitPrice/.test(qm?.inputSpec?.requiredProps?.Material ?? "")) {
  problems.push("DRIL quote_margin: requiredProps 语义接反（期望 requiredProps.Material 含 unitPrice）");
}

if (problems.length > 0) {
  console.error("✗ function-signature:check 失败：");
  for (const p of problems) console.error(`  · ${p}`);
  process.exit(1);
}
console.log(`✓ function-signature:check 静态段通过（已签名 ${signedKeys.length} 个求解器·目录/DRIL 均为派生）`);

// ── ④ S5 实跑比对（头号）：委派 seam 测，**显式捕获真实退出码** ─────────────────
if (process.env.SKIP_S5 === "1") {
  console.log("… S5 实跑段被 SKIP_S5=1 跳过（仅限静态调试；交付门不许跳）");
  process.exit(0);
}
const cwd = fileURLToPath(abs("apps/datacore/"));
const r = spawnSync("npx", ["vitest", "run", "test/ontology-signature.seam.test.ts"], {
  cwd,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (r.error) fail(`：S5 实跑段无法启动（${r.error.message}）`);
if (r.status !== 0) fail(`：S5 实跑比对段失败（vitest exit=${r.status}）——签名与实际读写不一致`);
console.log("✓ function-signature:check 全段通过（含 S5 实跑比对）");
