# WO-DERIV-BACKFILL · 四臂对照实验（铁律 1.5 判据一）
#
# 判据一原文：「不是『跑得起来吗』，而是**当我把 X 改成 X'，Y 必须按某个可预言的方式变化**。」
#
# 四臂（缺一个就不算交付 —— 零扰动臂是**对照**，没有它就分不清「动了」是扰动引起的还是噪声）：
#   Z  = 零扰动（对照）
#   A  = 只扰 Model.demandLoad      ⇒ 预言：qualificationQueue / changeoverPressure / drawdownPressure 必动
#   B  = 只扰 Base.loadIndex        ⇒ 预言：windowSqueeze / inboundExpeditePressure / transferPressure 必动
#   AB = 两个一起
#
# ⛔ 本脚本的**预言是写死在 PREDICT 里的**，不是跑完再解释 —— 跑完再挑一条说"看，符合预期"就不是对照实验。
# 用法：python3 docs/evidence/wo-deriv-backfill-arms.py [BASE_URL] [TICKS]
import sys, json, urllib.request

B = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4103"
N = int(sys.argv[2]) if len(sys.argv) > 2 else 5
MAG = 20.0

A_VARS = ["qualificationQueue", "changeoverPressure", "drawdownPressure"]
B_VARS = ["windowSqueeze", "inboundExpeditePressure", "transferPressure"]
ALL17 = ["overduePressure", "qualificationQueue", "changeoverPressure", "clearanceQueueDays",
         "drawdownPressure", "queueDays", "transferPressure", "windowSqueeze", "switchPressure",
         "turnoverPressure", "backlogQtyTop", "backlogPriceTop", "collectionPressure",
         "inspectBacklog", "inboundExpeditePressure", "reviewPressure", "splitPressure"]
B6 = ["deliveryHoldRisk", "forecastBacklog_unused", "handlingBacklog", "orderChurn", "promiseRisk", "repairBacklog"]


def hit(p, method="GET", body=None):
    req = urllib.request.Request(
        B + p, method=method,
        data=(json.dumps(body).encode() if body is not None else None),
        headers={"x-debug-user": "demo:admin:admin", "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read().decode())


def allobjs(t, ps=500):
    out, pg = [], 1
    while True:
        d = hit("/a/v1/objects?type=%s&page=%d&pageSize=%d" % (t, pg, ps))
        out += d.get("items") or []
        if not d.get("hasMore"):
            break
        pg += 1
    return out


A_OBJ = allobjs("Model")[0]["id"]
B_OBJ = allobjs("Base")[0]["id"]
print("扰动落点：A = %s.demandLoad  B = %s.loadIndex   幅度 delta+%g  推 %d 拍" % (A_OBJ, B_OBJ, MAG, N))


def arm(with_a, with_b):
    s = hit("/a/v1/sim/sessions", "POST", {})
    sid = s["id"]
    base = s["baseSnapshot"]
    for obj, var, on in ((A_OBJ, "demandLoad", with_a), (B_OBJ, "loadIndex", with_b)):
        if not on:
            continue
        hit("/a/v1/sim/sessions/%s/perturbations" % sid, "POST",
            {"targetObjectId": obj, "targetStateVar": var, "kind": "demand_shift",
             "magnitude": MAG, "mode": "delta", "startTick": 1, "label": "四臂探针"})
    hit("/a/v1/sim/sessions/%s/tick" % sid, "POST", {"n": N})
    w = hit("/a/v1/sim/sessions/%s/world" % sid)
    return base, w["state"], w.get("baseProvenance")


def moves(base, now, var):
    """返回 (动了几个对象, 最大绝对差)。只比 tick0 基线里存在的那批对象。"""
    n, mx = 0, 0.0
    for oid, row in base.items():
        if var not in row:
            continue
        b = float(row[var])
        g = (now.get(oid) or {}).get(var)
        if g is None:
            continue
        d = abs(float(g) - b)
        if d > 1e-9:
            n += 1
            mx = max(mx, d)
    return n, mx


arms = {}
for name, (a, b) in (("Z", (False, False)), ("A", (True, False)), ("B", (False, True)), ("AB", (True, True))):
    arms[name] = arm(a, b)
    print("  臂 %-2s 建好" % name)

baseZ, nowZ, provZ = arms["Z"]
print("\n=== 零扰动臂 Z：对照（预言 = **23 列全部逐位不动**）===")
zn, zmx = 0, 0.0
for v in ALL17:
    n, m = moves(baseZ, nowZ, v)
    zn += n
    zmx = max(zmx, m)
print("  Z 臂 17 列合计移动格数 = %d，最大差 = %.6g  %s" % (zn, zmx, "✓ 静息" if zn == 0 else "✗ 有残余位移"))

HDR = "%-26s %12s %12s %12s %12s" % ("变量", "Z 零扰动", "A 只扰A", "B 只扰B", "AB 两扰")
print("\n" + HDR)
print("-" * len(HDR))
ok = True
for v in ALL17:
    cells = []
    for name in ("Z", "A", "B", "AB"):
        bs, now, _ = arms[name]
        n, m = moves(bs, now, v)
        cells.append("%d格/%.4g" % (n, m))
    print("%-26s %12s %12s %12s %12s" % (v, *cells))
    # 预言核验
    bsA, nowA, _ = arms["A"]
    bsB, nowB, _ = arms["B"]
    nA = moves(bsA, nowA, v)[0]
    nB = moves(bsB, nowB, v)[0]
    if v in A_VARS:
        good = nA > 0
        if not good:
            ok = False
            print("   ✗ 预言失败：只扰 A 时 %s 应当动，实际 0 格" % v)
    elif v in B_VARS:
        good = nB > 0
        if not good:
            ok = False
            print("   ✗ 预言失败：只扰 B 时 %s 应当动，实际 0 格" % v)

print("\n=== 尾注 ===")
print("  · Z 臂 17 列合计移动 = %d 格（判据：0）" % zn)
print("  · 预言核验：%s" % ("A_VARS 三条在臂 A 动、B_VARS 三条在臂 B 动 —— 全部成立" if ok else "有失败项，见上"))
sys.exit(0 if (ok and zn == 0) else 1)
