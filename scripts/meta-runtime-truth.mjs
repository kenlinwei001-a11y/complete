#!/usr/bin/env node
/**
 * META-RUNTIME-TRUTH（PRD-trustworthy-self-accounting §3.5·根治 P2 meta 镜像谎言）
 * ───────────────────────────────────────────────────────────────────────────
 * 「用平台查平台自己」此前返回的是 §8 markdown 的 ✅/◐ 声称（parse.ts 读 emoji 投影 FIXED），
 * 非运行时真相。本脚本把每个**声称 FIXED**的断点交叉核对其关联的**现成 reality-judge**（§8 行内
 * 引用的门 check-*.mjs / xxx:check），真跑一遍：
 *   - 判据真跑且通过 → FIXED（真相印证声称）
 *   - 判据真跑但不通 → DRIFT（本体谎言曝光：声称已修，运行时判据不通）
 *   - 无可运行判据（纯文档态/需活服务的门未纳白名单）→ UNCHECKED（诚实边界·不默认信 emoji）
 *
 * 复用现成门（不新建判据）。只把「无需活服务、纯静态可跑」的门纳入判据白名单——需活双服务的
 * 运行时门（ontogenesis-runtime 等）诚实归 UNCHECKED，绝不因判据跑不起来误报 DRIFT。
 *
 * 用法：node scripts/meta-runtime-truth.mjs [--strict] [--json]
 *   默认 report-only（EXIT=0，不破 gates）。--strict：查出 DRIFT 即 EXIT=1（自证/未来入门用）。
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { parseMetaOntology, deriveRuntimeStatus } = await import(
  join(ROOT, "apps/datacore/dist/meta/parse.js")
);

const argv = process.argv.slice(2);
const STRICT = argv.includes("--strict");
const JSON_OUT = argv.includes("--json");

/**
 * 判据白名单：门引用名 → 脚本文件。只列「无需起服务、纯静态文件扫描、快速确定」的门（真可当判据跑）。
 * 需活双服务的运行时门（ontogenesis-runtime/ontogenesis/scene-agent-config/sim/propagation/tracing/
 * clarify-humanized/solver-label-coverage/opt-*）不纳入——对应断点诚实归 UNCHECKED，不假 FIXED、不误 DRIFT。
 */
const STATIC_JUDGES = {
  "debattery:check": "check-debattery.mjs",
  "boundary-singlesource:check": "check-boundary-singlesource.mjs",
  "no-orphan-source:check": "check-no-orphan-source.mjs",
  "no-fake-done:check": "check-no-fake-done.mjs",
  "no-hardcoded-rules:check": "check-no-hardcoded-rules.mjs",
  "rule-closure:check": "check-rule-closure.mjs",
  "method-determinism:check": "check-method-determinism.mjs",
  "solver-license:check": "check-solver-license.mjs",
  "datadep-manifest:check": "check-datadep-manifest.mjs",
  "chain:check": "check-chain-closure.mjs",
};

const md = readFileSync(join(ROOT, "docs/SYSTEM-ONTOLOGY.md"), "utf8");
const idx = JSON.parse(readFileSync(join(ROOT, "docs/prd-ontology-index.json"), "utf8"));

// ① 先无判据解析拿每个断点的 claimedStatus + judgeRefs（parse.js 单一来源，脚本不重造正则）。
const base = parseMetaOntology(md, idx);
const breakpoints = base.nodes.filter((n) => n.kind === "SystemBreakpoint");

// ② 跑判据（同一门去重只跑一次，缓存结果）。
const gateCache = new Map();
function runGate(script) {
  if (gateCache.has(script)) return gateCache.get(script);
  const r = spawnSync("node", [join(ROOT, "scripts", script)], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120_000,
  });
  const ok = r.status === 0;
  gateCache.set(script, ok);
  return ok;
}

// ③ 逐断点交叉核对 → JudgeResults。
const judgeResults = {};
for (const bp of breakpoints) {
  const g = bp.key;
  if (bp.props.claimedStatus !== "FIXED") continue; // 只核对声称 FIXED（未自称已修无谎可揭）
  const runnable = (bp.props.judgeRefs ?? []).filter((ref) => STATIC_JUDGES[ref]);
  if (runnable.length === 0) continue; // 无可运行判据 → 留空 → deriveRuntimeStatus 归 UNCHECKED
  const gateOks = runnable.map((ref) => ({ ref, ok: runGate(STATIC_JUDGES[ref]) }));
  const passed = gateOks.every((x) => x.ok);
  judgeResults[g] = { ran: true, passed, via: gateOks.map((x) => `${x.ref}=${x.ok ? "PASS" : "FAIL"}`).join(",") };
}

// ④ 派生最终运行时真相状态。
const rows = breakpoints.map((bp) => {
  const g = bp.key;
  const claimed = bp.props.claimedStatus;
  const judge = judgeResults[g];
  const status = deriveRuntimeStatus(claimed, judge);
  return { g, claimed, status, judge: judge?.via ?? (judge ? "" : "—"), refs: (bp.props.judgeRefs ?? []).join(",") || "—" };
});

const drift = rows.filter((r) => r.status === "DRIFT");
const tally = rows.reduce((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {});

if (JSON_OUT) {
  console.log(JSON.stringify({ rows, tally, drift: drift.map((r) => r.g) }, null, 2));
} else {
  console.log("META-RUNTIME-TRUTH · 断点声称 ↔ 运行时判据交叉核对\n");
  for (const r of rows.sort((a, b) => a.g.localeCompare(b.g, undefined, { numeric: true }))) {
    const mark = r.status === "DRIFT" ? "✗DRIFT" : r.status === "FIXED" ? "✓FIXED" : r.status === "UNCHECKED" ? "?UNCHK" : `·${r.status}`;
    console.log(`  ${r.g.padEnd(5)} 声称=${r.claimed.padEnd(8)} → ${mark.padEnd(8)} | 判据: ${r.judge}`);
  }
  console.log(
    `\n计: ${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(" · ")}`,
  );
  if (drift.length) {
    console.error(`\n✗ 发现 ${drift.length} 处本体谎言（声称 FIXED 但运行时判据不通）：${drift.map((r) => r.g).join(", ")}`);
  } else {
    console.log("\n✓ 无 DRIFT：所有已交叉核对的 FIXED 断点，运行时判据均通过（或诚实 UNCHECKED）。");
  }
}

if (STRICT && drift.length) process.exit(1);
