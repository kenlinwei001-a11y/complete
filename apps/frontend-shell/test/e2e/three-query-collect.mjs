/* eslint-disable */
/**
 * WO-THREE-QUERY-LIVE-UI · API 侧原始档收集（读，不写；⛔ 不碰产品码）。
 *
 * 输入：TQ_OUT/taskids.json（由 three-query-ui.mjs 产出，含每条 query 的 taskId）
 * 输出（每条 query 一套，全部原始读数落盘）：
 *   <id>-task.json            任务全量（classification / path / matchedIntent / answer …）
 *   <id>-decision-trace.json  决策痕迹（toolCalls：工具名 + outcome + 耗时，逐条）
 *   <id>-agent-runs.json      运行记录（kernel / agentKey / attribution / iterations）
 *   <id>-events.txt           SSE 全量回放原文（/api/v1/queries/:id/events）
 *   <id>-think.json           从 events 解析：agent_think 帧数 / 不同 stepId 段数 / 逐段全文 + agent_narration 段
 *
 * 跑法：TQ_OUT=/tmp/tq-evidence node apps/frontend-shell/test/e2e/three-query-collect.mjs
 * 认证明细：POST /a/v1/auth/login（demo/admin/demo1234），与 UI 同租户同用户。
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = process.env.TQ_OUT ?? "/tmp/tq-evidence";
const DC = process.env.TQ_DC ?? "http://127.0.0.1:4001";
const AC = process.env.TQ_AC ?? "http://127.0.0.1:4002";

const login = await fetch(`${DC}/a/v1/auth/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ tenantId: "demo", username: "admin", password: "demo1234" }),
});
if (!login.ok) { console.log("FATAL: 登录失败 HTTP " + login.status); process.exit(2); }
const { accessToken } = await login.json();
const H = { authorization: `Bearer ${accessToken}` };

const ids = JSON.parse(readFileSync(path.join(OUT, "taskids.json"), "utf8"));
const write = (name, text) => { writeFileSync(path.join(OUT, name), text); return name; };

const summary = [];
for (const q of ids) {
  if (!q.taskId) { summary.push({ id: q.id, note: "无 taskId（提交未成功）" }); continue; }
  const T = q.taskId;
  const rec = { id: q.id, kind: q.kind, text: q.text, taskId: T };

  // ① 任务全量
  const task = await (await fetch(`${AC}/api/v1/queries/${T}`, { headers: H })).json();
  write(`${q.id}-task.json`, JSON.stringify(task, null, 2));
  rec.classification = task.classification ?? null;
  rec.path = task.path ?? null;
  rec.matchedIntent = task.matchedIntent ?? null;
  rec.status = task.status ?? null;
  rec.taskError = task.error ?? null;

  // ② 决策痕迹（工具账）
  const dtRes = await fetch(`${AC}/api/v1/queries/${T}/decision-trace`, { headers: H });
  const dt = dtRes.ok ? await dtRes.json() : { httpStatus: dtRes.status, body: await dtRes.text() };
  write(`${q.id}-decision-trace.json`, JSON.stringify(dt, null, 2));
  rec.toolCalls = (dt.toolCalls ?? []).map((t) => `${t.tool} · ${t.outcome} · ${t.durationMs}ms`);
  rec.trustLevel = dt.trustLevel ?? null;
  rec.ontologyValidation = dt.ontologyValidation ?? null;
  rec.humanReviewRequired = dt.humanReviewRequired ?? null;

  // ③ 运行记录（kernel/agentKey/attribution/iterations）
  const arRes = await fetch(`${AC}/api/v1/queries/${T}/agent-runs`, { headers: H });
  const ar = arRes.ok ? await arRes.json() : { httpStatus: arRes.status, body: await arRes.text() };
  write(`${q.id}-agent-runs.json`, JSON.stringify(ar, null, 2));
  rec.runs = (ar.runs ?? []).map((r) => ({
    agentKey: r.agentKey ?? null, agentId: r.agentId ?? null, kernel: r.kernel ?? null,
    attribution: r.attribution ?? null, model: r.model ?? null, status: r.status ?? null,
    iterations: Array.isArray(r.iterations) ? r.iterations.length : (r.iterations ?? null),
    innerToolCalls: Array.isArray(r.iterations)
      ? r.iterations.flatMap((it, i) => (it.toolCalls ?? []).map((tc) => `it${i}: ${tc.toolName} · ${tc.outcome} · ${tc.durationMs ?? "?"}ms`)) : null,
    placement: r.placement ?? null, budget: r.budget ?? null, budgetExhausted: r.budgetExhausted ?? null,
  }));

  // ④ SSE 全量回放（历史 + 终态即关流；成功路径因已终态秒回）
  const evRes = await fetch(`${AC}/api/v1/queries/${T}/events?access_token=${accessToken}`, { headers: { accept: "text/event-stream" } });
  const evText = await evRes.text();
  write(`${q.id}-events.txt`, evText);

  // 解析：agent_think 帧（逐 token delta）+ 逐段全文；agent_narration 段
  const frames = [];
  for (const blk of evText.split("\n\n")) {
    const em = /^event: (.+)$/m.exec(blk);
    if (!em) continue;
    const dm = /^data: (.+)$/m.exec(blk);
    let payload = null;
    try { payload = dm ? JSON.parse(dm[1]) : null; } catch { payload = dm ? dm[1] : null; }
    frames.push({ event: em[1], payload });
  }
  const thinkFrames = frames.filter((f) => f.event === "step.completed" && f.payload?.type === "agent_think");
  const narrationFrames = frames.filter((f) => f.event === "step.completed" && f.payload?.type === "agent_narration");
  const seg = (list) => {
    const m = new Map();
    for (const f of list) {
      const k = String(f.payload?.stepId ?? "?");
      m.set(k, (m.get(k) ?? "") + String(f.payload?.text ?? ""));
    }
    return [...m.entries()].map(([stepId, text]) => ({ stepId, len: text.length, text }));
  };
  const thinkSegs = seg(thinkFrames);
  const narrSegs = seg(narrationFrames);
  const counts = {};
  for (const f of frames) counts[f.event] = (counts[f.event] ?? 0) + 1;
  const think = {
    eventCounts: counts,
    thinkFrames: thinkFrames.length,
    thinkSegments: thinkSegs.length,
    narrationFrames: narrationFrames.length,
    narrationSegments: narrSegs.length,
    thinkSegmentsDetail: thinkSegs,
    narrationSegmentsDetail: narrSegs,
    terminalFrames: frames.filter((f) => ["task.failed", "task.cancelled"].includes(f.event)).map((f) => f.payload),
    answerFinalCount: (counts["answer.final"] ?? 0),
  };
  write(`${q.id}-think.json`, JSON.stringify(think, null, 2));
  rec.eventCounts = counts;
  rec.thinkFrames = thinkFrames.length;
  rec.thinkSegments = thinkSegs.length;
  rec.narrationFrames = narrationFrames.length;
  rec.narrationSegments = narrSegs.length;
  rec.terminalFrames = think.terminalFrames;

  console.log(`${q.id}: path=${rec.path} status=${rec.status} runs=${rec.runs.length} toolCalls=${rec.toolCalls.length} thinkFrames=${thinkFrames.length} thinkSegs=${thinkSegs.length} narrationSegs=${narrSegs.length}`);
  summary.push(rec);
}
write("collect-summary.json", JSON.stringify(summary, null, 2));
console.log("产物目录:", OUT);
