# WO-DERIV-BACKFILL · 四臂**差分**对照（铁律 1.5 判据一 · 第二版）
#
# ⛔ 第一版（wo-deriv-backfill-arms.py）的判据写错了，错在两处，都会骗人：
#   ① 判据写成「这一列动了没」—— 而**世界天生在漂**：每个会话在 `startTick=1` 都带一条
#      **种子扰动**（`obj_material_elyte.shortageRisk delta+212.42`，见 SEED_DEMO 启动日志）。
#      ⇒ 「动了」在零扰动臂里也成立 ⇒ **它不度量「扰动引起了变化」**。
#   ② 修前构建的 Z 臂动得**更多**（1387 格 / 最大差 22601 vs 修后 361 格 / 42.84）——
#      但那个「动」是**哈希占位数被真实传导值覆盖**的落差，不是扰动信号。
#
# 正确的判据 = **差分**：同拍之下 `臂A(格) ≠ 臂Z(格)` ⇒ 扰动 A 对那一格**有影响**。
#   Z 臂吸收了「世界自己的漂移」，差分把它减掉 ⇒ 剩下的只有扰动造成的部分。
#   ⚠ 这也正是 `console-four-numbers-saturation-rootcause` 那条纪律：判「随不随输入变」**必加零扰动对照**。
#
# 用法：python3 docs/evidence/wo-deriv-backfill-arms2.py [BASE_URL] [TICKS]
import sys, json, urllib.request

B = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4103"
N = int(sys.argv[2]) if len(sys.argv) > 2 else 5
MAG = 20.0

# 预言：A 臂扰 Model.demandLoad、B 臂扰 Base.loadIndex，各自应当**差值非零**的列。
A_VARS = ["qualificationQueue", "changeoverPressure", "drawdownPressure"]
B_VARS = ["windowSqueeze", "inboundExpeditePressure", "transferPressure"]
ALL17 = ["overduePressure", "qualificationQueue", "changeoverPressure", "clearanceQueueDays",
         "drawdownPressure", "queueDays", "transferPressure", "windowSqueeze", "switchPressure",
         "turnoverPressure", "backlogQtyTop", "backlogPriceTop", "collectionPressure",
         "inspectBacklog", "inboundExpeditePressure", "reviewPressure", "splitPressure"]


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


def arm(with_a, with_b):
    s = hit("/a/v1/sim/sessions", "POST", {})
    sid = s["id"]
    for obj, var, on in ((A_OBJ, "demandLoad", with_a), (B_OBJ, "loadIndex", with_b)):
        if on:
            hit("/a/v1/sim/sessions/%s/perturbations" % sid, "POST",
                {"targetObjectId": obj, "targetStateVar": var, "kind": "demand_shift",
                 "magnitude": MAG, "mode": "delta", "startTick": 1, "label": "四臂探针"})
    hit("/a/v1/sim/sessions/%s/tick" % sid, "POST", {"n": N})
    return hit("/a/v1/sim/sessions/%s/world" % sid)["state"]


print("扰动落点：A = %s.demandLoad(+%g)  B = %s.loadIndex(+%g)  推 %d 拍" % (A_OBJ, MAG, B_OBJ, MAG, N))
st = {}
for name, (a, b) in (("Z", (False, False)), ("A", (True, False)), ("B", (False, True)), ("AB", (True, True))):
    st[name] = arm(a, b)
    print("  臂 %-2s 建好" % name)


def diff(armname, var, zstate):
    """与 Z 臂逐格比：返回 (差值非零的格数, 最大差)。"""
    n, mx = 0, 0.0
    for oid, row in st[armname].items():
        if var not in row:
            continue
        z = (zstate.get(oid) or {}).get(var)
        if z is None:
            continue
        d = abs(float(row[var]) - float(z))
        if d > 1e-9:
            n += 1
            mx = max(mx, d)
    return n, mx


HDR = "%-26s %14s %14s %14s" % ("变量", "A−Z", "B−Z", "AB−Z")
print("\n" + HDR)
print("-" * len(HDR))
fail = []
for v in ALL17:
    cells = []
    for nm in ("A", "B", "AB"):
        n, m = diff(nm, v, st["Z"])
        cells.append("%d格/%.4g" % (n, m))
    print("%-26s %14s %14s %14s" % (v, *cells))
    if v in A_VARS and diff("A", v, st["Z"])[0] == 0:
        fail.append("预言失败：%s 在 A 臂应当与 Z 臂不同（= 扰动 A 没传到它）" % v)
    if v in B_VARS and diff("B", v, st["Z"])[0] == 0:
        fail.append("预言失败：%s 在 B 臂应当与 Z 臂不同（= 扰动 B 没传到它）" % v)

print("\n=== 判据 ===")
print("  · 差分判据 = 同拍下「臂X 与臂Z 逐格不同」的格数；Z 臂吸收了世界自身的漂移，故它才是对照。")
print("  ⚠ 选扰动落点前必须先看**源有没有饱和**——源顶在声明域的上界时，再大的幅度都被夹回去，")
print("     下游一格不动。实测（2026-10-05）：宿主的 B 臂用 obj_base_changzhou（loadIndex=301.82，")
print("     压力族声明 [0,100] ⇒ 早被夹在 100）⇒ windowSqueeze/inboundExpeditePressure 差 0 格，")
print("     **看起来像"扰动传不过去"**；换成未饱和的 obj_base_jiangmen（98.47）后同样三列全部动")
print("     （6.09 / 5.33 / 4.57）。判据：13 个 Base 里 **10 个 loadIndex > 100** ⇒ 多数落点天生是哑的。")
if fail:
    print("  ✗ 预言未全成立：")
    for f in fail:
        print("     " + f)
else:
    print("  ✓ 预言全部成立：A 臂三条在 A 臂与 Z 不同，B 臂三条在 B 臂与 Z 不同")
sys.exit(0 if not fail else 1)
