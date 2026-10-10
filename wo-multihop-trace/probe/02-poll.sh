#!/bin/bash
# WO-MULTIHOP-TRACE · 02 轮询到终态；每轮记一行状态日志
set -u
BASE="${BASE:-http://127.0.0.1:4002}"
TASKID="$1"
OUTDIR="$2"
MAX="${3:-200}"          # 轮数上限（200 轮 × 4s ≈ 13 分钟）
mkdir -p "$OUTDIR"
LOG="$OUTDIR/02-poll-log.txt"
: > "$LOG"
STUCK_CLAR=0
for i in $(seq 1 "$MAX"); do
  RC=$(curl -s --max-time 15 -H "X-Debug-User: demo:admin:admin" \
       "$BASE/api/v1/queries/$TASKID" -o "$OUTDIR/02-last.json" -w "%{http_code}")
  LINE=$(node -e '
    const fs=require("fs");
    try{
      const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
      process.stdout.write((j.status||"?")+"|path="+(j.path||"-")+"|clar="+(j.clarificationRounds==null?"-":j.clarificationRounds));
    }catch(e){process.stdout.write("PARSE_ERR")}
  ' "$OUTDIR/02-last.json" 2>/dev/null)
  ST="${LINE%%|*}"
  echo "[$i] $(date '+%H:%M:%S') http=$RC $LINE" | tee -a "$LOG"
  case "$ST" in
    COMPLETED|FAILED|ERROR|CANCELLED|CANCELED|TIMEOUT)
      cp "$OUTDIR/02-last.json" "$OUTDIR/02-final.json"
      echo "TERMINAL:$ST"
      exit 0;;
  esac
  if [ "$ST" = "AWAITING_CLARIFICATION" ]; then
    STUCK_CLAR=$((STUCK_CLAR+1))
    if [ "$STUCK_CLAR" -ge 10 ]; then
      cp "$OUTDIR/02-last.json" "$OUTDIR/02-final.json"
      echo "TERMINAL:AWAITING_CLARIFICATION(连续10轮未动)"
      exit 0
    fi
  fi
  sleep 4
done
cp "$OUTDIR/02-last.json" "$OUTDIR/02-final.json"
echo "POLL_EXHAUSTED(未到终态)"
exit 1
