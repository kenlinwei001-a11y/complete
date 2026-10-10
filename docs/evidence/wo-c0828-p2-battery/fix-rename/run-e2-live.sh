#!/bin/bash
# WO-C0828-P2 #43 · E2 live 重跑（改名后）
# 目的：证明改名后的**活服务**在真实 HTTP 路径上发出的是 deltaMagnitudeP50/P90。
# 环境：临时 datacore :4017（seed 42），非部署实例；4001/4002/5173 一根汗毛不碰。
#
# ⚠️ 就绪判据必须是**不改世界**的探针。上一版用 `grep PASS|FAIL|✅|❌|张` 去判
#    `p2-exp-new.mjs` 的输出 —— 那个谓词**永不命中**（探针只打纯 JSON），
#    于是循环会**每轮跑一整遍探针**，而探针会插扰动 + tick×3 ⇒ 世界被堆叠污染。
#    现改为：login + 读一次 session，两次采样 curTick 相同才算稳住。
set -u
cd /Users/apple/deploy/complete
EV=docs/evidence/wo-c0828-p2-battery/fix-rename
OUT="${EV}/e2-live-rename.txt"
BASE=http://127.0.0.1:4017
SID=sims_demo_seed_world

{
  echo "== E2 live 重跑（改名后）START=$(date '+%m-%d %H:%M:%S') =="
  echo "HEAD=$(git rev-parse --short HEAD)  dirty=$(git status --porcelain | wc -l | tr -d ' ')"
  echo "BASE=${BASE}（临时实例，pid 见 /tmp/p2-probe-dc.pid）"
  echo "探针=/tmp/p2-exp-new.mjs（已 sed 到 4017，读 displacement.deltaMagnitudeP90）"
  echo "就绪判据：login 成功 + session 两次采样 curTick 相同（**不改世界**）"
  echo
} > "${OUT}"

# ── 就绪：login + 两次采样 curTick 相同 ──
READY=0
for i in $(seq 1 120); do
  R=$(node -e '
    const B="'"${BASE}"'", S="'"${SID}"'";
    (async()=>{
      try{
        const l=await fetch(B+"/a/v1/auth/login",{method:"POST",headers:{"content-type":"application/json"},
          body:JSON.stringify({tenantId:"demo",username:"admin",password:"demo1234"})});
        const lj=await l.json(); const tok=lj.accessToken; if(!tok) return console.log("NOTOKEN");
        const g=await fetch(B+"/a/v1/sim/sessions/"+S,{headers:{authorization:"Bearer "+tok}});
        if(g.status!==200) return console.log("S"+g.status);
        const j=await g.json(); console.log("OK tick="+j.curTick+" status="+j.status);
      }catch(e){ console.log("ERR"); }
    })();' 2>&1 | tail -1)
  S1=$(echo "${R}" | grep -oE "tick=[0-9]+" | head -1)
  if [ -n "${S1}" ]; then
    sleep 8
    R2=$(node -e '
    const B="'"${BASE}"'", S="'"${SID}"'";
    (async()=>{
      try{
        const l=await fetch(B+"/a/v1/auth/login",{method:"POST",headers:{"content-type":"application/json"},
          body:JSON.stringify({tenantId:"demo",username:"admin",password:"demo1234"})});
        const lj=await l.json(); const tok=lj.accessToken; if(!tok) return console.log("NOTOKEN");
        const g=await fetch(B+"/a/v1/sim/sessions/"+S,{headers:{authorization:"Bearer "+tok}});
        const j=await g.json(); console.log("OK tick="+j.curTick);
      }catch(e){ console.log("ERR"); }
    })();' 2>&1 | tail -1)
    S2=$(echo "${R2}" | grep -oE "tick=[0-9]+" | head -1)
    echo "  采样 ${i}: ${S1} / ${S2}" >> "${OUT}"
    if [ -n "${S2}" ] && [ "${S1}" = "${S2}" ]; then READY=1; break; fi
  fi
  sleep 5
done
echo "READY=${READY} at $(date '+%H:%M:%S')  （两次采样终态一致）" >> "${OUT}"
echo >> "${OUT}"

if [ "${READY}" != "1" ]; then
  echo "E2_ABORT 世界未达稳态 —— 探针未运行，无结论（不报绿也不报红）" >> "${OUT}"
  echo "CAPTURED_RC=9" > "${OUT}.rc"
  echo "CAPTURED_RC=9" >> "${OUT}"
  exit 9
fi

node /tmp/p2-exp-new.mjs >> "${OUT}" 2>&1
RC=$?
echo "CAPTURED_RC=${RC}" >> "${OUT}"
echo "CAPTURED_RC=${RC}" > "${OUT}.rc"
echo "E2_DONE RC=${RC} END=$(date '+%H:%M:%S')" >> "${OUT}"
