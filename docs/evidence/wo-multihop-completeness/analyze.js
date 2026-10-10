#!/usr/bin/env node
// WO-MULTIHOP-COMPLETENESS · 读数器（只读证据档，不碰服务）
// 用法: node analyze.js <tag>   —— 读 <tag>/ 下的四份面，打三块读数
//   ① 过程账（path / kernel / iterations / 工具调用真名+入参）
//   ② 思考段（agent_think 帧按 stepId 拼段 —— 帧是 delta、段才是块）
//   ③ 结论（answer 原文 + provenance + ⟦ref:N⟧ 范围）
// ⚠ 金丝雀：解析器若数不出 step.completed / answer.final，必须报「量法坏了」而不是「没有」
const fs = require("fs");
const path = require("path");

const tag = process.argv[2];
if (!tag) { console.error("用法: node analyze.js <tag>"); process.exit(2); }
const dir = path.join(__dirname, tag);
const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch (e) { return null; } };
const txt = (f) => { try { return fs.readFileSync(path.join(dir, f), "utf8"); } catch (e) { return ""; } };

const task = rd("task.json");
const runs = rd("agent-runs.json");
const dt = rd("decision-trace.json");
const sse = txt("events.sse");

const out = { tag };

// ---------- 金丝雀：解析器自证 ----------
const canary = {
  step_completed: (sse.match(/^event: step\.completed$/gm) || []).length,
  answer_final: (sse.match(/^event: answer\.final$/gm) || []).length,
  routing_completed: (sse.match(/^event: routing\.completed$/gm) || []).length,
};
out.parser_canary = canary;
out.parser_alive = canary.step_completed > 0 && canary.answer_final > 0;

if (!task) { out.error = "task.json 读不到"; console.log(JSON.stringify(out, null, 2)); process.exit(4); }

// ---------- ① 过程账 ----------
const rl = (runs && runs.runs) || [];
out.task = {
  id: task.id,
  status: task.status,
  path: task.path,
  matchedIntent: task.matchedIntent ? (task.matchedIntent.intentKey || task.matchedIntent) : null,
  classification_candidates: ((task.classification || {}).candidates || []).map((c) => c.intentKey || c.key || c),
  classification_outOfCatalog: (task.classification || {}).outOfCatalog,
  classification_domainRole: (task.classification || {}).domainRole,
  classification_domainReason: ((task.classification || {}).domainReason || "").slice(0, 200),
  classifier_model: (task.classification || {}).model,
};
out.runs = rl.map((r) => ({
  id: r.id, kernel: r.kernel || null, agentKey: r.agentKey || r.agentId || null,
  origin: r.origin || null, stepId: r.stepId || null,
  iterations: (r.iterations || []).length,
  budgetExhausted: r.budgetExhausted === undefined ? null : r.budgetExhausted,
  toolCalls: (r.iterations || []).flatMap((it, ii) =>
    (it.toolCalls || []).map((c) => ({
      iter: ii, toolCallId: c.toolCallId, toolName: c.toolName,
      input: c.input === undefined ? null : c.input,
      outcome: c.outcome === undefined ? null : c.outcome,
    }))),
}));

// 工具账：权威出处 agent-runs；交叉对照 decision-trace
const authCalls = out.runs.flatMap((r) => r.toolCalls);
out.tool_ledger = {
  authoritative_total: authCalls.length,
  distinct_tools: [...new Set(authCalls.map((c) => c.toolName))],
  trace_total: dt && dt.toolCalls ? dt.toolCalls.length : null,
  trace_invokedAs: dt && dt.toolCalls ? dt.toolCalls.map((c) => c.invokedAs || null) : null,
  cross_check: dt && dt.toolCalls ? (dt.toolCalls.length === authCalls.length ? "COUNT_MATCH" : "COUNT_MISMATCH") : "NO_TRACE",
};
// decision-trace 的回执正文（追数用）
out.trace_calls = (dt && dt.toolCalls ? dt.toolCalls : []).map((c) => ({
  tool: c.tool, invokedAs: c.invokedAs || null, outcome: c.outcome,
  input: c.input === undefined ? null : c.input,
  output: c.output === undefined ? null : c.output,
  outputDigest: c.outputDigest,
}));

// ---------- ② 思考段 ----------
const thinkFrames = [];
for (const m of sse.matchAll(/^data: (\{"stepId":"[^"]+","type":"agent_think"[^\n]*\})$/gm)) {
  try { thinkFrames.push(JSON.parse(m[1])); } catch (e) { /* 帧不完整，跳过 */ }
}
const byStep = new Map();
for (const f of thinkFrames) {
  if (!byStep.has(f.stepId)) byStep.set(f.stepId, []);
  byStep.get(f.stepId).push(f.text || "");
}
out.think = {
  frames: thinkFrames.length,
  steps: byStep.size,
  segments: [...byStep.entries()].map(([stepId, parts]) => ({
    stepId, frames: parts.length, chars: parts.join("").length, text: parts.join(""),
  })),
};

// ---------- ③ 结论 ----------
const blocks = ((task.answer || {}).blocks) || [];
const md = blocks.filter((b) => b.type === "text").map((b) => b.markdown).join("\n");
const refs = [...md.matchAll(/⟦ref:(\d+)⟧/g)].map((m) => Number(m[1]));
const prov = ((task.answer || {}).provenance) || [];
out.answer = {
  trustLevel: (task.answer || {}).trustLevel || null,
  unverifiedNumerics: (task.answer || {}).unverifiedNumerics === undefined ? null : task.answer.unverifiedNumerics,
  block_types: blocks.map((b) => b.type),
  chars: md.length,
  text: md,
  ref_tokens: refs.length,
  ref_range: refs.length ? [Math.min(...refs), Math.max(...refs)] : null,
  ref_distinct: [...new Set(refs)].sort((a, b) => a - b),
  provenance_count: prov.length,
  // ⚠ 契约形状实测 = {id, source, toolCallId, toolName, outputPath}（不带 ref 字段）
  // ⟦ref:N⟧ 的下标 N 直接索引本数组（0-based）—— 这是「正文数字 → 调用 + 回执字段」的追数钩子
  provenance: prov.map((p, i) => ({
    refIndex: i,
    id: p.id,
    source: p.source || null,
    toolCallId: p.toolCallId || null,
    toolName: p.toolName || null,
    outputPath: p.outputPath || null,
  })),
};

// ---------- ④ 追数钩子：⟦ref:N⟧ → provenance[N] → toolCallId → 回执 outputPath 取值 ----------
// 口径：回执正文取 decision-trace.toolCalls[].output（与 agent-runs 同一批落盘值的读投影）
const dtCalls = (dt && dt.toolCalls) ? dt.toolCalls : [];
const callById = new Map(dtCalls.map((c) => [c.toolCallId, c]));
const getPath = (obj, p) => {
  const parts = String(p).replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cur = obj;
  for (const k of parts) { if (cur === null || cur === undefined) return undefined; cur = cur[k]; }
  return cur;
};
out.ref_trace = out.answer.provenance.map((p) => {
  const call = p.toolCallId ? callById.get(p.toolCallId) : null;
  let outObj = call ? call.output : null;
  if (typeof outObj === "string") { try { outObj = JSON.parse(outObj); } catch (e) { /* 保持字符串 */ } }
  let resolved;
  try { resolved = call ? getPath(outObj, p.outputPath) : undefined; } catch (e) { resolved = undefined; }
  return {
    refIndex: p.refIndex, toolCallId: p.toolCallId, toolName: p.toolName,
    outputPath: p.outputPath,
    invokedAs: call ? (call.invokedAs || null) : null,
    resolved_value: resolved === undefined ? null : resolved,
    resolvable: resolved !== undefined,
  };
});

console.log(JSON.stringify(out, null, 2));
