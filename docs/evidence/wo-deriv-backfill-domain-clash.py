# WO-DERIV-BACKFILL · 双所有者格里「规格输出 vs 声明域」的对撞普查
#
# 仓主 2026-10-05 问：双所有者（传导边 / 派生规格）是否造成传导混乱。
#
# 已查明**有**一处规定谁赢：`sim/spec-base-synthesis.ts` ——
#   `x' = base + (1−λ)(x − base) + c`，即**规格值是基值、传导在基值上叠加偏离**、衰减拉回基值。
#   判据唯一出处 = `stateVarValueRef()`。（不是「没有任何一处规定」。）
#
# ⇒ 那么真正的缺口是**另一件事**：规格算出的数**落不落在声明的取值域里**。
#   落在域外 ⇒ 引擎按域夹 ⇒ 被夹掉的那一截**没有任何人记账** ⇒
#   源再加多大扰动，下游一格不动（饱和）⇒ 表现出来就是「传导混乱 / 输出与输入无关」。
#
# 本脚本逐格比：**规格输出实测范围** vs **STATE_VAR_DOMAINS 声明范围**。
#   数据来源两边都是落盘真相源：范围取自活实例 tick0 世界态（= 规格物化值），
#   声明域取自 git 里的 STATE_VAR_DOMAINS（正则抽 + 金丝雀）。
#
# 用法：python3 docs/evidence/wo-deriv-backfill-domain-clash.py [BASE_URL] [REV]
import sys, os, re, json, subprocess, urllib.request

B = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4103"
REV = sys.argv[2] if len(sys.argv) > 2 else "495d25002"
REPO = os.environ.get("REPO", ".")


def hit(p, method="GET", body=None):
    r = urllib.request.Request(B + p, method=method,
                               data=(json.dumps(body).encode() if body is not None else None),
                               headers={"x-debug-user": "demo:admin:admin", "content-type": "application/json"})
    with urllib.request.urlopen(r, timeout=300) as x:
        return json.loads(x.read().decode())


src = subprocess.run(["git", "show", "%s:apps/datacore/src/synthetic/battery.ts" % REV],
                     cwd=REPO, capture_output=True, text=True).stdout
refs_seg = re.search(r"export const STATE_VAR_VALUE_REFS[^{]*\{(.*?)\n\};", src, re.S).group(1)
refs = set(re.findall(r'"([A-Za-z]+\|[A-Za-z]+)":\s*\{\s*specKey', refs_seg))
# 声明域：压力族那一段是数组字面量 + .map；另加 forecastBias / queueDays / inspectBacklog /
# repairBacklog / handlingBacklog / qualificationQueue / blockedPressure 的单列赋值。
dom = {}
m = re.search(r"\[([^\]]*?)\]\.map\(\(v\): \[string, StateVarDomain\]", src, re.S)
if m is None:
    print("FATAL: 抽不到压力族声明段 —— 抽取器坏了，⛔ 别读成「没有声明」"); sys.exit(2)
for v in re.findall(r'"([A-Za-z]+)"', m.group(1)):
    dom[v] = (0.0, 100.0)
for mm in re.finditer(r"STATE_VAR_DOMAINS\.(\w+)\s*=\s*\{([^}]*)\}", src):
    var, body = mm.group(1), mm.group(2)
    lower = "min: 0" in body
    unbounded = "max: null" in body
    fb = re.search(r"min:\s*(-?[\d.]+),\s*max:\s*(-?[\d.]+)", body)
    if fb:
        dom[var] = (float(fb.group(1)), float(fb.group(2)))
    elif unbounded:
        dom[var] = (0.0, None)
if len(dom) < 20:
    print("FATAL: 只抽到 %d 条声明域 —— 抽取器坏了" % len(dom)); sys.exit(2)
print("金丝雀：登记 valueRef %d 格 / 抽到声明域 %d 条（都非空 ⇒ 工具活着）" % (len(refs), len(dom)))

sess = hit("/a/v1/sim/sessions", "POST", {})
base = sess["baseSnapshot"]
cfg = hit("/a/v1/sim/view-config")
oid2type = {i: t for t, ids in cfg["nodeObjectIds"].items() for i in ids}

# 逐 (类型|变量) 实测范围
rng = {}
for oid, row in base.items():
    t = oid2type.get(oid)
    if t is None:
        continue
    for v, val in row.items():
        k = "%s|%s" % (t, v)
        if k not in refs:
            continue
        lo, hi = rng.get(k, (float("inf"), float("-inf")))
        rng[k] = (min(lo, float(val)), max(hi, float(val)))

HDR = "%-42s %18s %14s  %s" % ("双所有者格（登记 valueRef ∧ 有入边）", "规格输出实测", "声明域", "判定")
print("\n" + HDR)
print("-" * 108)
clash, okc, undecl = [], 0, []
for k in sorted(rng):
    lo, hi = rng[k]
    d = dom.get(k.split("|")[1])
    if d is None:
        undecl.append(k); verdict = "未声明域（不夹，如实）"
    elif d[1] is not None and hi > d[1] + 1e-9:
        clash.append((k, lo, hi, d)); verdict = "★ 规格输出**越上界** ⇒ 被夹，夹掉的部分无人记账"
    elif lo < d[0] - 1e-9:
        clash.append((k, lo, hi, d)); verdict = "★ 规格输出**越下界** ⇒ 被夹"
    else:
        okc += 1; verdict = "在域内 ✓"
    print("%-42s %18s %14s  %s" % (k, "[%.4g, %.4g]" % (lo, hi),
                                   "[%g, %s]" % (d[0], d[1]) if d else "—", verdict))

print("\n=== 合计 ===")
print("  双所有者格（实测在世界里的）: %d" % len(rng))
print("    · 规格输出在声明域内       : %d" % okc)
print("    · ★ 越界（被引擎夹）        : %d" % len(clash))
print("    · 未声明域（不夹）          : %d  %s" % (len(undecl), undecl))
print("\n  ⇒ 越界的那些格，源上加多大扰动都会被夹回边界 ⇒ **下游一格不动**。")
print("     这正是「传导混乱 / 输出与输入无关」的可复现形态（本轮已实测一例：Base.loadIndex 10/13 顶界）。")
sys.exit(1 if clash else 0)
