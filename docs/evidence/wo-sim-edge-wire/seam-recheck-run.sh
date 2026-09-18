#!/bin/bash
# WO-SIM-EDGE-WIRE · seam-recheck 编排（仓主令：那 8 次测试需要重跑）
# 4 文件 × 各 2 次 = 8 次跑，逐文件串行；每次起跑前等清洁窗口（vitest 树根探针连续 2 次报 0）。
# 探针量法：数「父进程不是 vitest 的 vitest 进程」= 每棵进程树只算根。
#   双向金丝雀已在案：忙碌时实测报 2（隔壁 enterprise-state 尾段 + 全量各一根，与进程表逐行核对一致）；
#   空闲方向由本脚本首次起跑前的双零等待实际走完才算数（watch 日志即证据）。
# 纪律：⛔ 禁并发（4 核机，上一次 18 条 × 就是并发污染产物）；⛔ RC 不走管道（npx 直写文件，紧跟 echo RC=$?）；
#       ⛔ 零代码改动，只量不修。旁证 watcher 每 60s 记 roots，供事后污染取证。
set -u
DC=/Users/apple/deploy/wo-edge-wire/apps/datacore
EV=/tmp/wo-edge-wire-evidence
FILES="seed-demo-propagation.test.ts object-constraint-refs.seam.test.ts sim-order-real-fields.seam.test.ts sim-seed-world.seam.test.ts"
roots() { ps -axo pid,ppid,args | awk '/[v]itest/ {pid[$1]=1; pp[$1]=$2} END {n=0; for (p in pp) if (!(pp[p] in pid)) n++; print n+0}'; }

mkdir -p "$EV"
( while true; do echo "$(date +%F_%H:%M:%S) roots=$(roots)"; sleep 60; done ) > "$EV/recheck-watch.log" 2>&1 &
WATCH=$!
trap 'kill $WATCH 2>/dev/null' EXIT

wait_window() {
  local z=0 n
  while [ "$z" -lt 2 ]; do
    n=$(roots)
    echo "$(date +%F_%H:%M:%S) probe roots=$n (need 2 consecutive zeros)"
    if [ "$n" -eq 0 ]; then z=$((z+1)); else z=0; fi
    [ "$z" -lt 2 ] && sleep 90
  done
}

cd "$DC" || exit 1
for f in $FILES; do
  base=${f%.test.ts}
  for p in 1 2; do
    wait_window
    echo "=== START $f pass$p $(date +%F_%H:%M:%S) roots=$(roots) ==="
    npx vitest run "test/$f" --pool=forks --maxWorkers=1 > "$EV/recheck-$base-p$p.txt" 2>&1
    echo "RC=$?" > "$EV/recheck-$base-p$p.rc"
    echo "=== DONE $f pass$p $(date +%F_%H:%M:%S) $(cat "$EV/recheck-$base-p$p.rc") ==="
  done
done
echo "ALL_DONE"
