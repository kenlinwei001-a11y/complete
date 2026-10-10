#!/bin/bash
# WO-MULTIHOP-TRACE · 03 采集 agent-runs / decision-trace / events(SSE) 原始读数
set -u
BASE="${BASE:-http://127.0.0.1:4002}"
TASKID="$1"
OUTDIR="$2"
mkdir -p "$OUTDIR"
H="X-Debug-User: demo:admin:admin"

RC1=$(curl -s --max-time 60 -H "$H" "$BASE/api/v1/queries/$TASKID/agent-runs" \
      -o "$OUTDIR/03-agent-runs.json" -w "%{http_code}")
echo "$RC1" > "$OUTDIR/03-agent-runs.rc"
echo "agent-runs HTTP:$RC1"

RC2=$(curl -s --max-time 60 -H "$H" "$BASE/api/v1/queries/$TASKID/decision-trace" \
      -o "$OUTDIR/03-decision-trace.json" -w "%{http_code}")
echo "$RC2" > "$OUTDIR/03-decision-trace.rc"
echo "decision-trace HTTP:$RC2"

RC3=$(curl -s --max-time 180 -H "$H" -H "Accept: text/event-stream" \
      "$BASE/api/v1/queries/$TASKID/events" \
      -o "$OUTDIR/03-events.sse" -w "%{http_code}")
echo "$RC3" > "$OUTDIR/03-events.rc"
echo "events HTTP:$RC3 bytes:$(wc -c < "$OUTDIR/03-events.sse" | tr -d ' ')"
