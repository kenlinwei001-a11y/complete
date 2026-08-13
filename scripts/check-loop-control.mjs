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
  console.error(`⛔ check-loop-control.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


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

// ③ P1 环检测触顶 → 最终必经 degrade(STALL_LOOP)（防"检测到环却不诚实降级"）。
// P2 升级阶梯（暗发）在 hash 触顶后可先 rung① 换策略再试一轮（早于 degrade·至多延后一轮），
// 但 hashStalled 分支仍必落唯一诚实出口 degrade(STALL_LOOP)——不引入第二条 STALL 降级出口。
if (!/n\s*>=\s*repeatCap\)\s*hashStalled\s*=\s*true/.test(loopSrc)) {
  errors.push("loop.ts · P1 环检测（n>=repeatCap）未标记 hashStalled");
}
if (!/hashStalled\)[\s\S]{0,420}return await degrade\("BUDGET_EXHAUSTED",\s*"STALL_LOOP"\)/.test(loopSrc)) {
  errors.push("loop.ts · hash 停滞分支未经唯一诚实出口 degrade(\"BUDGET_EXHAUSTED\",\"STALL_LOOP\")");
}

// ④ S01 停滞早停必经 degrade（连续失败阈值判定后须走唯一出口·P2 升级阶梯至多在其前插一级换策略轮）。
if (!/STALL_CONSECUTIVE_FAILURES[\s\S]{0,420}degrade\(/.test(loopSrc)) {
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

// -----------------------------------------------------------------------
// WO-LOOP-CONTROL-P2 静态守门（升级阶梯不绕过诚实降级 + retry/per-tool/escalation 接线）。
// -----------------------------------------------------------------------
const EXECUTOR = join(ROOT, "apps/agentcore/src/tools/executor.ts");
const executorSrc = readFileSync(EXECUTOR, "utf8");

// ⑦ Escalation Ladder 升级早于降级 + 一次性（防无限升级绕过诚实降级）：
//    a) agent_escalated 是 step.completed 伪 step（非新增 §8.2 事件名）·b) 一次性状态位 escalated·
//    c) 每处停滞点都 `if (await maybeEscalate(i)) continue;` 早于 degrade（升级先于降级·rung① 早于 rung③）。
if (!/type:\s*"agent_escalated"/.test(loopSrc)) {
  errors.push('loop.ts · 未见 agent_escalated 伪 step（Escalation Ladder rung① 升级信号缺失）');
}
if (!/if\s*\(!opts\.escalation\s*\|\|\s*escalated\)\s*return false/.test(loopSrc)) {
  errors.push("loop.ts · maybeEscalate 缺一次性/暗发守卫（!opts.escalation || escalated → return false·防无限升级/字节兼容）");
}
{
  // 窗口 0..300：容纳 P2.5 在 rung① 与 rung③ degrade 之间插入的可判别 stalled 标记（stalledForReroute = {...}）+ 注释，
  // 但仍强制 `if (await maybeEscalate(i)) continue;`（rung① 早于） … `return await degrade(`（rung③ 唯一诚实出口）—— 不变量不松。
  const escalateGuards = [...loopSrc.matchAll(/if\s*\(await maybeEscalate\(i\)\)\s*continue;\s*[\s\S]{0,300}?return await degrade\(/g)];
  if (escalateGuards.length < 2) {
    errors.push(
      `loop.ts · 停滞点升级早于降级的守卫（if (await maybeEscalate(i)) continue; … return await degrade）应 ≥2（P1 hash + S01），实为 ${escalateGuards.length}`,
    );
  }
}

// -----------------------------------------------------------------------
// WO-LOOP-CONTROL-P2.5 静态守门（rung② orchestrator 层反应式重路由·收口 P2 诚实延后的 rung②）。
// 不变量：rung② 至多一次（一次性）+ 防双 Coordinator（usedCoordinator 短路）+ rung② 失败/未开仍落既有 degrade（唯一诚实出口·
// reason 白名单不放松·升级耗尽不加新 reason）。
// -----------------------------------------------------------------------
{
  const ORCH = join(ROOT, "apps/agentcore/src/router/orchestrator.ts");
  const orchSrc = readFileSync(ORCH, "utf8");
  const oLineOf = (idx) => orchSrc.slice(0, idx).split("\n").length;

  // ⑩ loop.ts 上抛可判别 stalled（rung② 触发信号）——仅编排层可判别标记，不改 degrade 唯一出口。
  if (!/stalled\?:\s*\{\s*reason:\s*"STALL_LOOP"\s*\|\s*"STALL_CONSECUTIVE"\s*\}/.test(loopSrc)) {
    errors.push("loop.ts · AgentLoopResult 缺 stalled?:{reason} 上抛标记（rung② 反应式重路由触发信号缺失）");
  }
  if (!/opts\.escalation\s*&&\s*stalledForReroute\s*\?\s*\{\s*stalled:\s*stalledForReroute\s*\}/.test(loopSrc)) {
    errors.push("loop.ts · stalled 标记未门控在 opts.escalation（escalation 关须逐字节同 P2·byte-compat）");
  }

  // ⑪ rung② 反应式重路由分支存在（result.stalled × escalationEnabled × !usedCoordinator 三守卫齐备）。
  if (!/result\.stalled\s*&&\s*escalationEnabled\(enabledFeatures\)\s*&&\s*!usedCoordinator/.test(orchSrc)) {
    errors.push("orchestrator.ts · rung② 分支缺三守卫（result.stalled && escalationEnabled && !usedCoordinator）");
  }
  // ⑫ 防双 Coordinator：usedCoordinator = proactive Coordinator 会接手本题（coordinatorEnabled && planCoordination!==undefined）→ 短路。
  if (!/const usedCoordinator\s*=[\s\S]{0,240}coordinatorEnabled\(enabledFeatures\)[\s\S]{0,240}planCoordination\([\s\S]{0,120}!==\s*undefined/.test(orchSrc)) {
    errors.push("orchestrator.ts · usedCoordinator 防双 Coordinator 守卫缺失（proactive 会接手则短路·不反应式重入）");
  }
  // ⑬ 一次性：rung② 成功即 return（runCoordinator 完成收尾·非递归·防无限重路由 G2）。
  if (!/maybeRerouteToCoordinator\(taskId, auth, task, result\)\)\s*return;/.test(orchSrc)) {
    errors.push("orchestrator.ts · rung② 非一次性（maybeReroute 成功须即 return·防无限重路由）");
  }
  // ⑭ rung② 失败/未开仍落既有唯一诚实出口 degrade（result.degraded → agent_degraded·不新增 reason·白名单不松）：
  //    rung② 分支之后仍有既有 result.degraded → agent_degraded 收尾（rung② no-op/关 → 落既有 degrade·byte-compat）。
  const rerouteIdx = orchSrc.indexOf("maybeRerouteToCoordinator(taskId, auth, task, result)");
  const degradedEmitIdx = orchSrc.indexOf('type: "agent_degraded"', rerouteIdx >= 0 ? rerouteIdx : 0);
  if (rerouteIdx < 0 || degradedEmitIdx < 0 || degradedEmitIdx <= rerouteIdx) {
    errors.push("orchestrator.ts · rung② 之后缺既有 degrade 兜底（result.degraded → agent_degraded·rung② 失败/未开须落唯一诚实出口）");
  }
  // ⑮ rung② 升级信号复用 agent_escalated 伪 step（不新增 §8.2 事件名·前端零改）。
  if (!/type:\s*"agent_escalated"[\s\S]{0,120}outcome:\s*"REROUTE_COORDINATOR"/.test(orchSrc)) {
    errors.push(`orchestrator.ts:${rerouteIdx >= 0 ? oLineOf(rerouteIdx) : "?"} · rung② 未复用 agent_escalated 伪 step（REROUTE_COORDINATOR·不新增事件名）`);
  }
  // ⑯ rung② 扇出前诚实门：只 fan out 到真实存在角色 agent（repos.agents.get）·存活 <2 → return false（落 degrade）。
  if (!/repos\.agents\.get\(d\.agentId\)[\s\S]{0,200}live\.length\s*<\s*2[\s\S]{0,80}return false/.test(orchSrc)) {
    errors.push("orchestrator.ts · rung② 缺角色 agent 存在性诚实门（缺失不空调·存活<2 → return false → 落既有 degrade）");
  }
}

// ⑧ P2 新 metric 接线（注册 + 进 render 列表）。
for (const name of ["qos_agent_retry_total", "qos_agent_escalation_total"]) {
  if (!metricsSrc.includes(name)) errors.push(`metrics.ts · 未注册 ${name}`);
}
if (!metricsSrc.includes("this.agentRetry,")) errors.push("metrics.ts · agentRetry 未进 render() 列表（metric 不外透）");
if (!metricsSrc.includes("this.agentEscalation,")) errors.push("metrics.ts · agentEscalation 未进 render() 列表（metric 不外透）");
if (!/agentRetry\.inc\(\)/.test(loopSrc)) errors.push("loop.ts · Retry Manager 未接 agentRetry.inc()（重试归因缺失）");
if (!/agentEscalation\.inc\(\)/.test(loopSrc)) errors.push("loop.ts · Escalation Ladder 未接 agentEscalation.inc()（升级归因缺失）");

// ⑨ Retry Manager 分类 R6 确定性（classifyRetryable 纯函数·无 Date.now/随机）。
{
  const s = executorSrc.indexOf("export function classifyRetryable");
  const e = s >= 0 ? executorSrc.indexOf("\n}", s) : -1;
  const region = s >= 0 && e > s ? executorSrc.slice(s, e) : "";
  if (s < 0) errors.push("executor.ts · 未找到 classifyRetryable（Retry Manager 分类缺失）");
  for (const banned of ["Date.now(", "Math.random("]) {
    if (region.includes(banned)) errors.push(`executor.ts · classifyRetryable 含非确定性调用 ${banned}（违 R6）`);
  }
}

if (errors.length > 0) {
  console.error("✗ loop-control:check 失败：");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("✓ loop-control:check 通过（唯一诚实出口 degrade · reason 白名单 · 环检测/S01→degrade · R6 确定性哈希 · STALL_LOOP+metric 接线 · P2 升级早于降级/一次性 + retry/escalation metric + classifyRetryable R6）");
