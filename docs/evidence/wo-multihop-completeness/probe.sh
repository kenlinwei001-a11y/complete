#!/usr/bin/env bash
# WO-MULTIHOP-COMPLETENESS · 探针（只读；⛔ 不含产品代码改动）
#
# 用法: bash probe.sh <tag> <query-file>
#   tag        = q1 / q2 / q3
#   query-file = 存问句原文的文本文件
#
# 产出（全部落在本目录 <tag>/ 下）:
#   submit.json         POST /api/v1/queries 的 202 回执（taskId）
#   poll.log            轮询终态的每次采样
#   task.json           GET /api/v1/queries/:id —— classification / path / answer / provenance
#   events.sse          GET /api/v1/queries/:id/events —— 全量 SSE（含 agent_think 帧）
#   agent-runs.json     GET /api/v1/queries/:id/agent-runs —— ⚠ 工具调用账的权威出处
#   decision-trace.json GET /api/v1/queries/:id/decision-trace —— 交叉对照(invokedAs/input/output)
#   lineage.json        GET /api/v1/queries/:id/lineage
#
# 退出码即证据（rc 落 <tag>/probe.rc）：
#   0 = 走到终态并取齐四份面
#   2 = 提交失败   3 = 轮询超时仍非终态   4 = 某个取证端点取失败
set -u

TAG="${1:?用法: probe.sh <tag> <query-file>}"
QF="${2:?用法: probe.sh <tag> <query-file>}"
BASE="http://127.0.0.1:4002"
PKG="pkg_battery_manufacturing"
USER_HDR="X-Debug-User: demo:admin:admin"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${HERE}/${TAG}"
mkdir -p "$OUT"

QUERY="$(cat "$QF")"
RC=0

# --- 1. 提交 ---------------------------------------------------------------
BODY="$(node -e '
const fs=require("fs");
const q=fs.readFileSync(process.argv[1],"utf8");
process.stdout.write(JSON.stringify({
  packageId: process.argv[2],
  query: q,
  context: { view: "orders", selectedObjects: [], filters: {} }
}));
' "$QF" "$PKG")"

curl -sS -m 60 -X POST "${BASE}/api/v1/queries" \
  -H 'Content-Type: application/json' -H "$USER_HDR" \
  -d "$BODY" -o "${OUT}/submit.json" -w '%{http_code}' > "${OUT}/submit.rc" 2>"${OUT}/submit.err"
SUBMIT_HTTP="$(cat "${OUT}/submit.rc")"
if [ "$SUBMIT_HTTP" != "202" ]; then
  echo "SUBMIT_FAILED http=${SUBMIT_HTTP}" | tee -a "${OUT}/poll.log"
  echo 2 > "${OUT}/probe.rc"; exit 2
fi

TASK_ID="$(node -e 'process.stdout.write(require(process.argv[1]).taskId||"")' "${OUT}/submit.json")"
echo "taskId=${TASK_ID}" | tee -a "${OUT}/poll.log"
echo "$TASK_ID" > "${OUT}/taskid.txt"

# --- 2. 轮询到终态（二次采样式；单帧不定性） --------------------------------
TERMINAL_RE='^(COMPLETED|FAILED|CANCELLED)$'
status=""
for i in $(seq 1 240); do
  curl -sS -m 30 "${BASE}/api/v1/queries/${TASK_ID}" -H "$USER_HDR" -o "${OUT}/task.json" 2>/dev/null
  status="$(node -e 'try{process.stdout.write(require(process.argv[1]).status||"")}catch(e){process.stdout.write("")}' "${OUT}/task.json" 2>/dev/null)"
  echo "$(date +%H:%M:%S) i=${i} status=${status}" >> "${OUT}/poll.log"
  if printf '%s' "$status" | grep -qE "$TERMINAL_RE"; then break; fi
  sleep 5
done
if ! printf '%s' "$status" | grep -qE "$TERMINAL_RE"; then
  echo "POLL_TIMEOUT last=${status}" | tee -a "${OUT}/poll.log"
  RC=3
fi

# 终态后再取一次 task（终态快照，与中间态分开）
curl -sS -m 30 "${BASE}/api/v1/queries/${TASK_ID}" -H "$USER_HDR" -o "${OUT}/task.json" 2>/dev/null

# --- 3. 四份面 --------------------------------------------------------------
# SSE：历史重放 + 终态事件后服务端主动关流；-m 兜底防悬挂
curl -sS -N -m 120 "${BASE}/api/v1/queries/${TASK_ID}/events" \
  -H "$USER_HDR" -H 'Accept: text/event-stream' \
  -o "${OUT}/events.sse" 2>"${OUT}/events.err" || RC=4

for ep in agent-runs decision-trace lineage; do
  f="${OUT}/${ep}.json"
  curl -sS -m 60 "${BASE}/api/v1/queries/${TASK_ID}/${ep}" -H "$USER_HDR" -o "$f" 2>"${OUT}/${ep}.err" || RC=4
done

# --- 4. 读数小结（不解释，只报数） -----------------------------------------
node -e '
const fs=require("fs"),p=process.argv[1];
const rd=(f)=>{try{return JSON.parse(fs.readFileSync(p+"/"+f,"utf8"))}catch(e){return null}};
const task=rd("task.json"), runs=rd("agent-runs.json"), dt=rd("decision-trace.json");
const sse=fs.existsSync(p+"/events.sse")?fs.readFileSync(p+"/events.sse","utf8"):"";
const frames=(sse.match(/^event: /gm)||[]).length;
// ⚠ agent_think 不是事件名，是 step.completed 载荷里的 type 字段（帧=delta，按 stepId 拼段才成块）
// 金丝雀：同一次解析必须能数出 step.completed 与 answer.final，否则是量法坏了不是「没有思考」
const think=(sse.match(/"type":"agent_think"/g)||[]).length;
const stepCompleted=(sse.match(/^event: step\.completed$/gm)||[]).length;
const answerFinal=(sse.match(/^event: answer\.final$/gm)||[]).length;
const thinkSteps=new Set();
for(const m of sse.matchAll(/data: (\{"stepId":"[^"]+","type":"agent_think"[^\n]*\})/g)){
  try{thinkSteps.add(JSON.parse(m[1]).stepId)}catch(e){}
}
const rl=runs&&runs.runs?runs.runs:[];
const its=rl.reduce((s,r)=>s+((r.iterations||[]).length),0);
const tcs=rl.reduce((s,r)=>s+((r.iterations||[]).flatMap(i=>i.toolCalls||[])).length,0);
const uniq=new Set(rl.flatMap(r=>(r.iterations||[]).flatMap(i=>(i.toolCalls||[]).map(c=>c.toolName))));
const blocks=(task&&task.answer&&task.answer.blocks)?task.answer.blocks:[];
const txt=blocks.filter(b=>b.type==="text").map(b=>b.markdown).join("\n");
const refs=[...txt.matchAll(/⟦ref:(\d+)⟧/g)].map(m=>Number(m[1]));
console.log(JSON.stringify({
  status: task&&task.status, path: task&&task.path,
  matchedIntent: task&&task.matchedIntent?task.matchedIntent.intentKey||task.matchedIntent:null,
  classification: task&&task.classification ? {
    outOfCatalog: task.classification.outOfCatalog,
    candidates: (task.classification.candidates||[]).map(c=>c.intentKey||c.key||c),
    domainRole: task.classification.domainRole,
    domainReason: (task.classification.domainReason||"").slice(0,160),
    model: task.classification.model
  } : null,
  sse_frames: frames, step_completed_frames: stepCompleted, answer_final_frames: answerFinal,
  agent_think_frames: think, agent_think_steps: thinkSteps.size,
  runs: rl.length, run_kernels: rl.map(r=>r.kernel||null), run_agentKeys: rl.map(r=>r.agentKey||r.agentId||null),
  iterations_total: its, toolCalls_total: tcs, tool_names_uniq: [...uniq],
  toolCalls_audit: dt&&dt.toolCalls?dt.toolCalls.length:0,
  provenance_count: task&&task.answer?((task.answer.provenance||[]).length):null,
  ref_range: refs.length?[Math.min(...refs),Math.max(...refs)]:null,
  answer_chars: txt.length
}, null, 2));
' "$OUT" 2>&1 | tee "${OUT}/summary.json"

echo "$RC" > "${OUT}/probe.rc"
exit $RC
