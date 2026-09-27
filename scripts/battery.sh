#!/usr/bin/env bash
# battery.sh · 四包电池推进法的机器形态（2026-09-27 用户令「反思后设计新方法」）
#
# 五条判据全部烧进本脚本的结构里（写文档不是机制，argv 结构才是）：
#   ① 已知红先 solo 后全包：run 的 argv 尾部接已知红文件 → 逐个 maxWorkers=1 solo，再全包。
#   ② A/B 直跳：solo 与全包之间没有缩减集步骤——要缩减集就传缩减集文件列表当全包跑。
#   ③ 不等安静窗口：--maxWorkers=2 --testTimeout=1500000 写死，立即跑。
#   ④ .rc 由捕获的退出码写（RC_SOLO/RC_PACK 变量），绝不 tail echo $?。
#   ⑤ probe 单次 stat+ps，跨拍字节差由状态文件机器判（/tmp/battery-probe.state）。
#
# 用法：
#   bash scripts/battery.sh run   <pkg> <evidence-dir> [已知红文件...]
#   bash scripts/battery.sh probe <evidence-file>
set -u

cmd_run() {
  local pkg="$1" evid="$2"; shift 2
  local head rev rc_solo=0 rc_pack=0
  rev=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
  head="HEAD=$rev START=$(date '+%m-%d %H:%M:%S')"
  mkdir -p "$evid"
  for f in "$@"; do
    printf '%s\ncmd: solo %s (maxWorkers=1)\n' "$head" "$f" > "$evid/battery-solo.txt"
    nice -n 10 pnpm --filter "$pkg" exec vitest run "$f" --maxWorkers=1 --testTimeout=1500000 >> "$evid/battery-solo.txt" 2>&1
    rc_solo=$?
    printf 'SOLO_RC=%s END=%s\n' "$rc_solo" "$(date '+%m-%d %H:%M:%S')" >> "$evid/battery-solo.txt"
    [ "$rc_solo" -ne 0 ] && break   # solo 红就不该上全包——先修先判
  done
  if [ "$rc_solo" -eq 0 ]; then
    printf '%s\ncmd: full pack (无参 include · maxWorkers=2 · testTimeout=1500000)\n' "$head" > "$evid/battery-full.txt"
    nice -n 10 pnpm --filter "$pkg" exec vitest run --maxWorkers=2 --testTimeout=1500000 >> "$evid/battery-full.txt" 2>&1
    rc_pack=$?
    printf 'PACK_RC=%s END=%s\n' "$rc_pack" "$(date '+%m-%d %H:%M:%S')" >> "$evid/battery-full.txt"
  fi
  printf 'SOLO_RC=%s\nPACK_RC=%s\n' "$rc_solo" "$rc_pack" > "$evid/battery.rc"
  echo "battery done: SOLO_RC=$rc_solo PACK_RC=$rc_pack"
}

cmd_probe() {
  local f="$1" st="$2" stline prev curm curs dt delta_lines delta_bytes
  curm=$(stat -f %m "$f" 2>/dev/null || echo 0)
  curs=$(stat -f %z "$f" 2>/dev/null || echo 0)
  stline=$(awk -v p="$f" '$1==p {print}' "$st" 2>/dev/null)
  prev=$(echo "$stline" | awk '{print $2}')
  if [ -z "$stline" ]; then
    echo "首拍无基线（跨拍判定自下一次起）"
  elif [ "$curm" -gt "$prev" ] 2>/dev/null; then
    delta_bytes=$((curs - $(echo "$stline" | awk '{print $3}')))
    delta_lines=$(( $(wc -l < "$f" 2>/dev/null || echo 0) - $(echo "$stline" | awk '{print $4}') ))
    echo "在动：+${delta_bytes}B / +${delta_lines}行（跨拍）"
  else
    dt=$(($(date +%s) - curm))
    echo "静止 ${dt}s（mtime $(date -r "$curm" '+%H:%M:%S' 2>/dev/null || echo '?')）—— 结合下面 worker CPU 判卡死：CPU 在积累=计算中"
  fi
  printf '%s %s %s %s\n' "$f" "$curm" "$curs" "$(wc -l < "$f" 2>/dev/null || echo 0)" > "$st.tmp"
  mv "$st.tmp" "$st"
  ps -eo pid,etime,time,pcpu,args | grep -E "vitest (1|2)\)" | grep -v grep || echo "无 vitest worker 进程"
  tail -c 200 "$f" 2>/dev/null
}

ST=/tmp/battery-probe.state
case "${1:-}" in
  run) shift; cmd_run "$@" ;;
  probe) shift; cmd_probe "${1:?用法: battery.sh probe <证据文件>}" "$ST" ;;
  *) echo "用法: battery.sh run <pkg> <evidence-dir> [已知红文件...] | battery.sh probe <证据文件>"; exit 2 ;;
esac
