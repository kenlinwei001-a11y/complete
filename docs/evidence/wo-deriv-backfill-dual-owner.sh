#!/usr/bin/env bash
# WO-DERIV-BACKFILL · 双所有者格（传导边 ∧ 派生规格）计数 —— 修前 vs 修后
#
# 仓主 2026-10-05 问：「是否是这个造成传导混乱：世界态格子有两个所有者（传导边 / 派生规格），
#   而全仓没有任何一处规定谁赢、也没规定两者该叠加还是该互斥。」
#
# 本脚本量的是**这个交集有多大、我这一单把它改成多少**。
#   · 「有传导边」= 规则集里以该 (类型,变量) 为 **targetTypeKey/targetStateVar** 的边数 > 0（入度>0）
#   · 「有派生规格」= `STATE_VAR_VALUE_REFS` 里登记了该 (类型|变量)
#   交集 = 两方都要写这一格 ⇒ 就是「双所有者」。
#
# ⛔ 判据取自**落盘真相源**（git 里的登记表 + 活实例的已发布规则集），不取注释。
#   ⛔ 报数前先跑金丝雀：规则集必须非空、登记表必须非空，否则是**工具坏了**不是「没有交集」。
#
# 用法：bash docs/evidence/wo-deriv-backfill-dual-owner.sh <BASE_URL> <git-rev> [git-rev2]
set -uo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
B="${1:-http://127.0.0.1:4103}"
shift || true
REVS=("$@")

python3 - "$B" "${REVS[@]}" <<'PY'
import sys, json, subprocess, urllib.request, re
B = sys.argv[1]
revs = sys.argv[2:]
repo = __import__("os").environ.get("REPO") or "."

def hit(p):
    r = urllib.request.Request(B + p, headers={"x-debug-user": "demo:admin:admin"})
    with urllib.request.urlopen(r, timeout=180) as x:
        return json.loads(x.read().decode())

rules = hit("/a/v1/sim/propagation-rules")["items"]
indeg = {}
for r in rules:
    k = "%s|%s" % (r["targetTypeKey"], r["targetStateVar"])
    indeg[k] = indeg.get(k, 0) + 1
print("规则集 %d 条，其中的落点格 %d 个" % (len(rules), len(indeg)))
if len(rules) == 0:
    print("FATAL: 规则集为空 —— 工具坏了，⛔ 不许读成「没有交集」"); sys.exit(2)

for rev in revs:
    src = subprocess.run(["git", "show", "%s:apps/datacore/src/synthetic/battery.ts" % rev],
                         cwd=repo, capture_output=True, text=True).stdout
    seg = re.search(r"export const STATE_VAR_VALUE_REFS[^{]*\{(.*?)\n\};", src, re.S)
    if seg is None:
        print("FATAL: %s 里找不到 STATE_VAR_VALUE_REFS —— 路径/正则坏了" % rev); sys.exit(2)
    keys = set(re.findall(r'"([A-Za-z]+\|[A-Za-z]+)":\s*\{\s*specKey', seg.group(1)))
    if not keys:
        print("FATAL: %s 登记表抽出 0 条 —— 抽取器坏了" % rev); sys.exit(2)
    both = sorted(keys & set(indeg))
    print("\n── %s ──" % rev)
    print("   登记了 valueRef 的格        : %d" % len(keys))
    print("   其中**也有传导入边**（双所有者）: %d" % len(both))
    for k in both:
        print("      · %-42s 入边 %d 条" % (k, indeg[k]))
PY
