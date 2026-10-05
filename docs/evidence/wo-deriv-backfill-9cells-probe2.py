# WO-DERIV-BACKFILL · 剩 9 格越界逐格定性 —— **第二版**（v1 有两个量法缺陷，见下）
#
# ⛔ v1 的两处**量法错误**（照铁律 0.5 判据 5，先自证工具，不许把工具的病读成系统的病）：
#   ① **v1 读 `o["rels"]`，而对象上根本没有 `rels` 这个字段** ⇒ 每个对象都报「入边 0 条」，
#      于是「式子算不出目标值」这排 ✗ 全是假的。真法：`/a/v1/objects/:id/neighbors?linkKey=&direction=in`
#      （实测该路由返回 `total:1`，端点 id 与 WIPLot.props.woId 同值）。本版用 props 侧做 join，
#      并**用一个 neighbors 调用做金丝雀**证明两侧同源 —— 不许自己另立一套真相源。
#   ② **v1 的相等判据用 1e-6，而 DSL 是 decimal 定点 4 位**（实测 `feedPressure: 111.1178`）
#      ⇒ 逐位差 4e-5 的**正确**计算被读成「不符」。v1 报的「0/13 相符」是**量法造的**，
#      不是系统的病。（对照：v1 里不带除法的 `Order.costPressure` 报 500/500 相符 —— 那是同一批数据。）
#      本版取 5e-4 容差，并把**原始差**打出来，免得再把舍入读成错。
#
# 判据（铁律 1.5 判据三）：从对象**自己的真属性**重算一遍，与目标字段实测值比。
#   相符 ⇒ 式子按它写的口径在跑（那问题在「声明 vs 真量纲」）；不符 ⇒ 先查式子。
#   另外**必须打出源字段的量纲**：拿日历日当工期除，式子照样"跑得通"。
#
# 用法：python3 docs/evidence/wo-deriv-backfill-9cells-probe2.py [BASE_URL]
import sys, json, urllib.request

B = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4105"
H = {"x-debug-user": "demo:admin:admin", "content-type": "application/json"}
TOL = 5e-4  # DSL decimal 定点 4 位 ⇒ 舍入上界 5e-5；留 10 倍余量


def hit(p):
    r = urllib.request.Request(B + p, headers=H)
    with urllib.request.urlopen(r, timeout=300) as x:
        return json.loads(x.read().decode())


def allobjs(t, ps=500):
    out, pg = [], 1
    while True:
        d = hit("/a/v1/objects?type=%s&page=%d&pageSize=%d" % (t, pg, ps))
        out += d.get("items") or []
        if not d.get("hasMore"):
            break
        pg += 1
    return out


def N(o, k):
    v = (o.get("props") or {}).get(k)
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def cmp1(got, rec):
    """→ (相符?, 差)。"""
    if got is None or rec is None:
        return None, None
    return abs(rec - got) <= TOL, abs(rec - got)


print("实例 %s   容差 %.0e（DSL decimal 4 位）" % (B, TOL))
print("=" * 104)

WO = allobjs("WorkOrder")
wo_by_id = {o["id"]: o for o in WO}
wo_by_key = {N(o, "workOrderId") or (o.get("props") or {}).get("woId") or o["id"]: o for o in WO}
print("WorkOrder n=%d" % len(WO))

# ── 金丝雀：props 侧 join 与 neighbors 路由必须同源（否则 v1 的教训重演）────────────────────
_c = None
for o in allobjs("WIPLot", ps=5):
    nb = hit("/a/v1/objects/%s/neighbors?linkKey=work_order_yields_wip_lot&direction=in" % o["id"])
    g = [i["id"] for gr in nb.get("groups", []) for i in gr.get("items", [])]
    via_prop = [wo_by_id[x]["id"] for x in [o["id"]] if N(o, "woId") in wo_by_key] if False else None
    cand = [w["id"] for w in WO if N(w, "woId") == N(o, "woId") or w["id"].endswith(str(N(o, "woId")))]
    _c = (o["id"], g, [(w["id"], N(w, "woId")) for w in WO if N(w, "lineId") is not None][:1], cand[:2])
    break
print("金丝雀 neighbors = %s ; 我按 props 找到的候选 = %s" % (_c[1], _c[3]))
if not _c[1]:
    print("FATAL: neighbors 路由返回空 —— 工具坏了，⛔ 不许读成「没有边」"); sys.exit(2)
if _c[1][0] not in [w["id"] for w in WO]:
    print("FATAL: neighbors 的端点 id 在 WorkOrder 列表里找不到 —— 两侧不同源"); sys.exit(2)
print("  ✓ 两侧同源（neighbors 端点 %s 在 WO 列表内）" % _c[1][0])

# WorkOrder 侧建两张表：按 id、按 lineId
wo_of_line = {}
for w in WO:
    ln = N(w, "lineId") or (w.get("props") or {}).get("lineId")
    if ln is not None:
        wo_of_line.setdefault(ln, []).append(w)
print("  WorkOrder.lineId 覆盖 %d/%d 条，落到 %d 条产线" % (
    sum(1 for w in WO if N(w, "lineId") is not None), len(WO), len(wo_of_line)))

REPORT = []


def row(tag, got, rec, extra=""):
    ok, d = cmp1(got, rec)
    REPORT.append((tag, ok))
    mark = "—" if ok is None else ("✓" if ok else "✗ 差 %.3g" % d)
    print("   %-40s 目标 %12s  重算 %12s   %-12s %s" % (
        tag, ("%.6g" % got) if got is not None else "—",
        ("%.6g" % rec) if rec is not None else "—", mark, extra))


# ── ① WIPLot.feedPressure ────────────────────────────────────────────────────────────────
print("\n① WIPLot.feedPressure  式：COALESCE(SUM(in(work_order_yields_wip_lot).qtyPlanned)*100/this.qty, 0)")
wl = allobjs("WIPLot")
print("   WIPLot n=%d" % len(wl))
seen = []
for o in wl:
    q = N(o, "qty")
    ins = [w for w in WO if w["id"] == "obj_workorder_" + str(N(o, "woId"))]
    s = sum(N(w, "qtyPlanned") or 0 for w in ins)
    row(o["id"][-34:], N(o, "feedPressure"), (s * 100 / q) if q else None,
        "(入边%d条 和%.6g ÷ qty %.6g)" % (len(ins), s, q or 0))
    seen.append((len(ins), s, q, N(o, "feedPressure")))
    if len(seen) >= 4:
        break
import collections
ne = collections.Counter(x[0] for x in seen)
print("   入边条数分布（本版真读到的）%s" % dict(ne))
# 全量
S = []
for o in wl:
    q = N(o, "qty")
    ins = [w for w in WO if w["id"] == "obj_workorder_" + str(N(o, "woId"))]
    s = sum(N(w, "qtyPlanned") or 0 for w in ins)
    got = N(o, "feedPressure")
    S.append((s, q, got, (s * 100 / q) if q else None, len(ins)))
okc = sum(1 for s, q, g, r, n in S if r is not None and g is not None and abs(r - g) <= TOL)
print("   全量：重算逐位相符 %d/%d ; 入边条数分布 %s" % (
    okc, len(S), dict(collections.Counter(x[4] for x in S))))
print("   入边 qtyPlanned 和 范围 [%.6g, %.6g] 不同值 %d ; qty 范围 [%.6g, %.6g]" % (
    min(x[0] for x in S), max(x[0] for x in S), len(set(round(x[0], 6) for x in S)),
    min(x[1] for x in S), max(x[1] for x in S)))
print("   feedPressure 范围 [%.4g, %.4g] 不同值 %d" % (
    min(x[2] for x in S), max(x[2] for x in S), len(set(round(x[2], 4) for x in S))))

# ── ② Line.blockedPressure ───────────────────────────────────────────────────────────────
print("\n② Line.blockedPressure  式：COALESCE(SUM(out(line_runs_work_order).qtyPlanned)*100/this.max_capacity_day, 0)")
li = allobjs("Line")
print("   Line n=%d" % len(li))
L = []
for o in li:
    cap = N(o, "max_capacity_day")
    key = (o.get("props") or {}).get("lineId") or o["id"].replace("obj_line_", "")
    ins = wo_of_line.get(key, [])
    s = sum(N(w, "qtyPlanned") or 0 for w in ins)
    got = N(o, "blockedPressure")
    rec = (s * 100 / cap) if cap else None
    L.append((key, s, cap, got, rec, len(ins)))
okc = sum(1 for k, s, c, g, r, n in L if r is not None and g is not None and abs(r - g) <= TOL)
print("   全量：重算逐位相符 %d/%d ; 入边条数分布 %s" % (
    okc, len(L), dict(collections.Counter(x[5] for x in L))))
for k, s, c, g, r, n in sorted(L, key=lambda z: -(z[3] or 0))[:5]:
    row(k[-34:], g, r, "(入边%d条 和%.6g ÷ cap %.6g)" % (n, s, c or 0))
print("   blockedPressure 范围 [%.4g, %.4g] ; 源 max_capacity_day 不同值 %d 个 [%g,%g]" % (
    min(x[3] for x in L), max(x[3] for x in L), len(set(x[2] for x in L)),
    min(x[2] for x in L), max(x[2] for x in L)))

# ── ③ PurchaseOrder.expeditePressure（量纲重点：shipDay 是日历日还是工期？）─────────────────
print("\n③ PurchaseOrder.expeditePressure  式：COALESCE(this.shipDay*100/(this.etaDay-this.orderDay), 0)")
po = allobjs("PurchaseOrder")
O, C, S_, A = [], [], [], []
for o in po:
    for k, arr in (("orderDay", O), ("etaDay", C), ("shipDay", S_), ("arriveDay", A)):
        v = N(o, k)
        if v is not None:
            arr.append(v)
print("   n=%d  字段范围：orderDay [%g,%g]  etaDay [%g,%g]  shipDay [%g,%g]  arriveDay [%g,%g]" % (
    len(po), min(O), max(O), min(C), max(C), min(S_), max(S_), min(A), max(A)))
print("   ⚠ 四个字段**全是日历日号**（有负值 ⇒ 相对某个基准日的偏移），**没有一个是工期**")
oc = cc = 0
for o in po:
    od, ed, sd = N(o, "orderDay"), N(o, "etaDay"), N(o, "shipDay")
    g = N(o, "expeditePressure")
    w = (ed - od) if None not in (od, ed) else None
    if g is None or not w:
        continue
    r1 = sd * 100 / w
    r2 = (sd - od) * 100 / w
    if abs(r1 - g) <= TOL:
        oc += 1
    if abs(r2 - g) <= TOL:
        cc += 1
print("   原式逐位相符 %d/%d ；候选式 (shipDay−orderDay)*100/窗口 逐位相符 %d/%d" % (oc, len(po), cc, len(po)))
print("   值域 [%.4g, %.4g]；负值 %d 个" % (
    min(N(o, "expeditePressure") for o in po), max(N(o, "expeditePressure") for o in po),
    sum(1 for o in po if (N(o, "expeditePressure") or 0) < 0)))
# 对照实验：同一笔业务（同窗口、同发货用时）只因下单日历日不同 ⇒ 读数不同
print("\n   对照实验：窗口 8 天、提前 5 天发货（发货用时 5）的三笔，只有「下单日历日」不同：")
for od in (4, 8, 12):
    print("     orderDay=%2d etaDay=%2d shipDay=%2d  ⇒ 原式 %8.3f   业务上的用时占比恒为 %5.1f%%" % (
        od, od + 8, od + 5, (od + 5) * 100 / 8, (5 / 8) * 100))

# ── ④ 余下 5 格：拉源字段 + 重算 ─────────────────────────────────────────────────────────
CASES = [
    ("Base", "loadIndex", ["committedQty", "formationCapDaily", "agingCapDaily"],
     lambda o: (N(o, "committedQty") * 100 / (N(o, "formationCapDaily") + N(o, "agingCapDaily"))
                if (N(o, "formationCapDaily") or 0) + (N(o, "agingCapDaily") or 0) else None)),
    ("Customer", "receivablePressure", ["receivables", "creditLimit"],
     lambda o: (N(o, "receivables") * 100 / N(o, "creditLimit") if N(o, "creditLimit") else None)),
    ("Material", "shortageRisk", ["dailyUse", "leadTime", "onHand", "inTransit"],
     lambda o: ((N(o, "dailyUse") * N(o, "leadTime") - N(o, "onHand") - N(o, "inTransit")) * 100
                / (N(o, "dailyUse") * N(o, "leadTime"))
                if N(o, "dailyUse") and N(o, "leadTime") else None)),
    ("Model", "demandLoad", ["orderCount", "capacity"],
     lambda o: (N(o, "orderCount") * 100 / N(o, "capacity") if N(o, "capacity") else None)),
    ("Order", "costPressure", ["creditUsedRatio"], lambda o: (N(o, "creditUsedRatio") or 0) * 100),
]
for t, v, srcs, fn in CASES:
    objs = allobjs(t)
    print("\n④ %s.%s   源字段 %s" % (t, v, srcs))
    ok = bad = nod = 0
    worst = []
    vals = []
    for o in objs:
        got = N(o, v)
        rec = fn(o)
        if got is not None:
            vals.append(got)
        if rec is None:
            nod += 1
            continue
        okc_, d = cmp1(got, rec)
        if okc_:
            ok += 1
        elif okc_ is False:
            bad += 1
            worst.append((d, o["id"], got, rec))
    print("   重算逐位相符 %d / 不符 %d / 源缺字段算不出 %d（n=%d）" % (ok, bad, nod, len(objs)))
    for d, i, g, r in sorted(worst, reverse=True)[:3]:
        print("     ✗ %-30s 目标 %14.8g 重算 %14.8g 差 %.3g" % (i[-30:], g, r, d))
    for s in srcs:
        vv = [N(o, s) for o in objs if N(o, s) is not None]
        print("     源 %-18s %s" % (s, ("[%10.6g, %10.6g] n=%d 不同值 %d" % (
            min(vv), max(vv), len(vv), len(set(vv)))) if vv else "⛔ 零命中 n=0"))
    if vals:
        print("     目标 %-16s [%10.6g, %10.6g] 越声明域 %d/%d" % (
            v, min(vals), max(vals),
            sum(1 for x in vals if x < 0 or x > 100), len(vals)))

print("\n=== 汇总（重算相符性）===")
bad = [t for t, ok in REPORT if ok is False]
print("   已逐条比对 %d 条，其中不符 %d 条" % (len(REPORT), len(bad)))
for t in bad:
    print("     ✗ %s" % t)
