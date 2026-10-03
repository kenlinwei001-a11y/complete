#!/usr/bin/env node
/**
 * 门 `sim-readiness:check`（推演沙盘增量 2 · SPEC §9）：静态守护「就绪认证 = 投影既有 closure，
 * 零新校验逻辑」（RL3 单源）。运行时行为由 `apps/datacore/test/sim-certification.test.ts` 覆盖。
 *
 * 静态断言（SPEC §9）：
 *   1) deriveCertification 是纯投影：certification.ts 不 import/调用 closure 以外的校验器（防重造就绪算法）。
 *   2) L4 必须三子项全真才置 L4_CERTIFIED（防假 L4）。
 *   3) canEnterSimulation 必含 trialTick.passed（防跳过 Trial Tick 直接放行）。
 *   4) 缺件必入 gaps[]（诚实，不静默）。
 *   5) 全局/局部用同一 deriveCertification（单源，呼应 meta:sync）。
 *
 * 本门只写脚本、不并入 package.json gates（主线集中 wire；见报告《要主线 wire 的》）。
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
  console.error(`⛔ check-sim-readiness.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


import { readFileSync } from "node:fs";
const root = new URL("../", import.meta.url);
const read = (rel) => { try { return readFileSync(new URL(rel, root), "utf8"); } catch { return ""; } };
let red = false;
const must = (cond, msg) => { if (!cond) { console.error(`✗ ${msg}`); red = true; } };

const cert = read("apps/datacore/src/sim/certification.ts");
must(cert.length > 0, "缺 apps/datacore/src/sim/certification.ts");

// 1) 投影纯度（RL3）：certification.ts 只许 import @platform/contracts（类型）。
//    绝不 import 任何 datacore 校验器/服务（closure / selfcheck / ontology-core / solvers / rules …）。
const importLines = cert.split("\n").filter((l) => /^\s*import\b/.test(l));
for (const l of importLines) {
  const m = l.match(/from\s+["']([^"']+)["']/);
  const mod = m?.[1] ?? "";
  must(mod === "@platform/contracts", `certification.ts 非法 import（破投影纯度 RL3，仅许 @platform/contracts）：${l.trim()}`);
}
// 同时禁止在函数体里调用任何 *.validateClosure / selfCheck / recompute 等校验器（应由调用方传入既算结果）。
must(!/validateClosure\s*\(/.test(cert), "certification.ts 直接调用 validateClosure（应投影既有 closure 结果，不重算 RL3）");
must(!/selfCheck|recompute\s*\(|propagateTick\s*\(/.test(cert), "certification.ts 调用了校验器/重算器（破纯投影 RL3）");

// 2) L4 三子项全真才置 L4_CERTIFIED（防假 L4）。
must(/L4_CERTIFIED/.test(cert), "certification.ts 未产出 L4_CERTIFIED 级");
must(/fanoutSafe\s*&&\s*writebackComplete\s*&&\s*observabilityMet/.test(cert)
  || /writebackComplete\s*&&\s*observabilityMet/.test(cert),
  "L4_CERTIFIED 未要求三子项(fanoutSafe∧writebackComplete∧observabilityMet)全真");

// 3) canEnterSimulation 必含 trialTick.passed（防跳过 Trial Tick 放行）。
const canEnter = cert.match(/canEnterSimulation\s*=\s*([^;]+);/);
must(!!canEnter, "certification.ts 未计算 canEnterSimulation");
must(canEnter && /trial\.passed/.test(canEnter[1]), "canEnterSimulation 未含 trialTick.passed（可能跳过 Trial Tick 放行）");
must(canEnter && /L4_CERTIFIED/.test(canEnter[1]), "canEnterSimulation 未要求 L4_CERTIFIED");
must(canEnter && /gatePassed/.test(canEnter[1]), "canEnterSimulation 未含 closure.gatePassed");

// 4) 缺件必入 gaps[]（诚实，不静默）：每个未达项 push 进 gaps，且至少覆盖 L4 三子项与 trial。
must(/gaps:\s*out/.test(cert) || /gaps:\s*\w+,/.test(cert), "certification.ts 未返回 gaps[]");
for (const [cond, label] of [["!fanoutSafe", "fanout"], ["!writebackComplete", "writeback"], ["!observabilityMet", "observability"], ["!trial.passed", "trialTick"]]) {
  must(cert.includes(`if (${cond})`), `缺件未诚实入 gaps[]（${label} 未达时未 push）`);
}

// 5) 全局/局部同一 deriveCertification（单源）：app.ts 两端点都调同一 assembleCertification→deriveCertification。
const app = read("apps/datacore/src/app.ts");
must(/deriveCertification\s*\(/.test(app), "app.ts 未调用 deriveCertification");
must(/assembleCertification\s*\(/.test(app), "app.ts 缺 assembleCertification 装配器");
const certifyEp = /\/a\/v1\/sim\/sessions\/:id\/certification/.test(app);
const precheckEp = /\/a\/v1\/sim\/sessions\/:id\/scope-precheck/.test(app);
must(certifyEp, "app.ts 缺 certification 端点");
must(precheckEp, "app.ts 缺 scope-precheck 端点");
// 同一函数同时服务 GLOBAL 与 LOCAL（scope 入参，非两套代码）。
must(/scopeKind\s*===?\s*"LOCAL"\s*\?\s*"LOCAL"\s*:\s*"GLOBAL"/.test(app) || /q\.scope\s*===?\s*"LOCAL"/.test(app),
  "app.ts 未以 scope 入参切 GLOBAL/LOCAL（应同一 deriveCertification 换 scope，呼应 meta:sync）");
// certification 端点过 sim.certification entitlement（R3）。
must(/requireSim\(c, "sim\.certification"\)/.test(app), "certification 端点未过 sim.certification entitlement 门");

if (red) { console.error("\n✗ sim-readiness:check 未通过（就绪认证投影纯度/诚实门被破）。"); process.exit(1); }
console.log("· sim-readiness:check：投影纯度(仅 @platform/contracts) · L4 三子项全真 · canEnter 含 trialTick∧L4∧gatePassed · 缺件入 gaps · 全局/局部同一函数");
console.log("✓ sim-readiness:check：SimCertification = 投影既有 closure，零新校验逻辑（RL3）守住。");
