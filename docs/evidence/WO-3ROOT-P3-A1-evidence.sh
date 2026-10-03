#!/bin/bash
# A1 单入口存在性证据生成（三条写路收敛到唯一投影入口）
WT=/Users/apple/deploy/complete/.claude/worktrees/wf_57a1536c-d93-26
EV=$WT/docs/evidence
out=$EV/WO-3ROOT-P3-A1-single-entry.txt
cd "$WT" || exit 9
{
echo "## WO-3ROOT-P3 · A1 单入口存在性（三条写路收敛到唯一投影入口）"
echo "> 取数 $(date '+%Y-%m-%d %H:%M:%S') · 树 $WT（分支 claude/handoff-3root-P3-negative-seed-base）"
echo "> 判据：① 三个写点全部经 world-projection；② saturateToDomain 的函数调用点收敛到 1 处；③ 金丝雀（已知必中）先行。"
echo
echo "-- 金丝雀（已知必中，先证 grep 工具活着）--"
printf '$ grep -rn stateVarValueRef apps/datacore/src | wc -l  =>  '; grep -rn "stateVarValueRef" apps/datacore/src | wc -l
printf '$ grep -rn propagateTick( apps/datacore/src | wc -l      =>  '; grep -rn "propagateTick(" apps/datacore/src | wc -l
printf '$ grep -rn putTickState apps/datacore/src | wc -l        =>  '; grep -rn "putTickState" apps/datacore/src | wc -l
echo
echo "-- ① 三条写路的写点（播种 / 核 / 合成）--"
echo '$ grep -rn projectWorldCells( apps/datacore/src'
grep -rn "projectWorldCells(" apps/datacore/src
echo
echo "-- ② 唯一函数调用点（要求：只有 world-projection.ts 一处是真调用）--"
echo '$ grep -rn saturateToDomain( apps/datacore/src | grep -v "export function"'
grep -rn "saturateToDomain(" apps/datacore/src | grep -v "export function"
echo
echo "上面这组里真正是函数调用的行（排掉注释/定义）："
grep -rn "saturateToDomain(" apps/datacore/src | grep -v "export function" | grep "round12"
echo
echo "-- ③ 传导核内已不再夹值（原第 4 步调用点已移出，只剩注释与定义）--"
echo '$ grep -n saturateToDomain apps/datacore/src/sim/propagation.ts'
grep -n "saturateToDomain" apps/datacore/src/sim/propagation.ts
echo "出现总行数: $(grep -c 'saturateToDomain' apps/datacore/src/sim/propagation.ts)（其中定义 1 行，其余为注释）"
echo
echo "-- ④ 五处调用点各自落点（PRD A9：全部接同一入口；本单实测 6 处 = app.ts 4 + metric-series 1 + seed-world 1）--"
grep -rn "projectWorldCells(" apps/datacore/src/app.ts apps/datacore/src/sim/metric-series.ts apps/datacore/src/sim/seed-world.ts
} > "$out" 2>&1

N1=$(grep -rn "projectWorldCells(" "$WT/apps/datacore/src" | grep -v "export function" | wc -l | tr -d ' ')
N2=$(grep -rn "saturateToDomain(" "$WT/apps/datacore/src" | grep -v "export function" | grep -c "round12")
N3=$(grep -rn "stateVarValueRef" "$WT/apps/datacore/src" | wc -l | tr -d ' ')
echo "自检：projectWorldCells 调用点=${N1} (expect 6, 定义行已排除); saturateToDomain 真调用=${N2} (expect 1); 金丝雀 stateVarValueRef=${N3} (expect >0)"
if [ "$N1" = "6" ] && [ "$N2" = "1" ] && [ "$N3" -gt 0 ]; then
  echo "A1_SELFCHECK=OK"; echo "0" > "$EV/WO-3ROOT-P3-A1-single-entry.rc"; exit 0
else
  echo "A1_SELFCHECK=FAIL"; echo "1" > "$EV/WO-3ROOT-P3-A1-single-entry.rc"; exit 1
fi
