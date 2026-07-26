#!/usr/bin/env node
/**
 * loop-control:check — Agent 执行治理层（Loop Control）静态守门（WO-LOOP-CONTROL-P1·PRD §3.0/§7）。
 *
 * 宪法不变量：**唯一诚实降级出口 `degrade()`——没有第二条 return 路径能绕过诚实降级**（防回潮）。
 * 静态坐实：① 降级信号 `degraded:{reason}` 全 loop.ts 仅 degrade() 一处产出（唯一出口）· ② 所有 degrade() 的
 * reason ∈ 白名单 · ③ P1 环检测触顶 → degrade(STALL_LOOP) · ④ S01 停滞早停 → degrade · ⑤ R6 确定性（环检测
 * 哈希/序列化无 Date.now/随机·阈值为常量字面量）· ⑥ STALL_LOOP reason + qos_agent_loop_repeat_total metric 已接线。
 * 纯静态扫描（无网络/时钟·可复现）。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOOP = join(ROOT, "apps/agentcore/src/agent/loop.ts");
const METRICS = join(ROOT, "apps/agentcore/src/metrics.ts");

const errors = [];
const loopSrc = readFileSync(LOOP, "utf8");
const metricsSrc = readFileSync(METRICS, "utf8");
const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;

// ① 唯一诚实出口：降级信号 `degraded: { reason }` 只能在一处产出（= degrade() 内）。多于一处 = 有旁路自造降级。
{
  const producers = [...loopSrc.matchAll(/degraded:\s*\{\s*reason\s*\}/g)];
  if (producers.length !== 1) {
    errors.push(
      `loop.ts · degraded 降级信号产出点应恰为 1（唯一出口 degrade），实为 ${producers.length}` +
        producers.map((m) => `\n      · loop.ts:${lineOf(loopSrc, m.index)}`).join(""),
    );
  }
}

// ② degrade() 的 reason 实参（第二个字符串参）只能是允许枚举。
{
  const allowed = new Set(["TIMEOUT", "BUDGET_EXHAUSTED", "STALL_LOOP"]);
  for (const m of loopSrc.matchAll(/degrade\(\s*"[^"]+"\s*,\s*"([^"]+)"/g)) {
    if (!allowed.has(m[1])) {
      errors.push(`loop.ts:${lineOf(loopSrc, m.index)} · degrade() reason "${m[1]}" 不在允许集 {TIMEOUT,BUDGET_EXHAUSTED,STALL_LOOP}`);
    }
  }
}

// ③ P1 环检测触顶必经 degrade(STALL_LOOP)（防"检测到环却不诚实降级"）。
if (!/>=\s*repeatCap\)\s*return await degrade\("BUDGET_EXHAUSTED",\s*"STALL_LOOP"\)/.test(loopSrc)) {
  errors.push("loop.ts · 环检测触顶（n>=repeatCap）未直接 return await degrade(\"BUDGET_EXHAUSTED\",\"STALL_LOOP\")");
}

// ④ S01 停滞早停必经 degrade（连续失败阈值判定后须走唯一出口）。
if (!/STALL_CONSECUTIVE_FAILURES[\s\S]{0,160}degrade\(/.test(loopSrc)) {
  errors.push("loop.ts · S01 停滞早停（STALL_CONSECUTIVE_FAILURES）判定后未经 degrade()");
}

// ⑤ R6 确定性：环检测哈希/序列化区无 Date.now/Math.random；阈值为编译期常量字面量。
{
  const detStart = loopSrc.indexOf("function stableStringify");
  const anchor = loopSrc.indexOf("return (h >>> 0).toString(16);");
  const detEnd = anchor >= 0 ? loopSrc.indexOf("\n", anchor) : -1;
  const region = detStart >= 0 && detEnd > detStart ? loopSrc.slice(detStart, detEnd) : "";
  if (detStart < 0 || anchor < 0) errors.push("loop.ts · 未找到 stableStringify/callSignature（环检测哈希缺失）");
  for (const banned of ["Date.now(", "Math.random("]) {
    if (region.includes(banned)) errors.push(`loop.ts · 环检测哈希/序列化区含非确定性调用 ${banned}（违 R6）`);
  }
  if (!/const LOOP_REPEAT_CAP_DEFAULT\s*=\s*\d+\s*;/.test(loopSrc)) {
    errors.push("loop.ts · LOOP_REPEAT_CAP_DEFAULT 非数字字面量常量（违 R6：阈值须编译期常量）");
  }
}

// ⑥ STALL_LOOP reason + metric 接线。
if (!loopSrc.includes('"STALL_LOOP"')) errors.push('loop.ts · 未见 "STALL_LOOP" reason（环检测降级归因缺失）');
if (!metricsSrc.includes("qos_agent_loop_repeat_total")) errors.push("metrics.ts · 未注册 qos_agent_loop_repeat_total");
if (!metricsSrc.includes("this.agentLoopRepeat,")) errors.push("metrics.ts · agentLoopRepeat 未进 render() 列表（metric 不外透）");

if (errors.length > 0) {
  console.error("✗ loop-control:check 失败：");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("✓ loop-control:check 通过（唯一诚实出口 degrade · reason 白名单 · 环检测/S01→degrade · R6 确定性哈希 · STALL_LOOP+metric 接线）");
