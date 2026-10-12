# WO-DERIV-BACKFILL · 剩 9 格越界逐格定性 —— 判据 = 把**源字段**一起拉出来看
#
# 前三格（changeoverPressure / turnoverPressure / splitPressure）已判「声明错」（名字被扫进压力族）。
# 剩 9 格要逐格回答一个问题：**是式子错，还是声明错？**
#
# 判据（铁律 1.5 判据三：每个数都要能独立再算一遍）：
#   · 从对象**自己的真属性**（源字段）重算一遍规格式 ⇒ 与目标字段实测值比。
#     逐位相符 ⇒ 式子在按它自己写的口径跑（那问题在「声明 vs 真量纲」，不在式子）；
#     不相符    ⇒ 式子或数据有病，先查这个。
#   · 同时把**源字段的量纲**打出来（是元？是件？是日历日？）——
#     式子对不代表量纲对：拿日历日当工期除，式子照样"跑得通"。
#
# ⛔ 金丝雀：脚本必须至少认出 1 个已知目标字段（否则是工具坏了，不是"没有越界"）。
#
# 用法：python3 docs/evidence/wo-deriv-backfill-9cells-probe.py [BASE_URL]
import sys, json, urllib.request

B = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4105"
H = {"x-debug-user": "demo:admin:admin", "content-type": "application/json"}


def hit(p, method="GET", body=None):
    r = urllib.request.Request(B + p, method=method,
                               data=(json.dumps(body).encode() if body is not None else None),
                               headers=H)
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


def num(o, k):
    v = (o.get("props") or {}).get(k)
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def fmt(v, w=10):
    return ("%*.4g" % (w, v)) if isinstance(v, (int, float)) else ("%*s" % (w, "—"))


print("实例 %s" % B)
print("=" * 100)

# ── ① WIPLot.feedPressure：实测范围只有 0.1 宽 / 260 格全越界 —— 先查是不是式子退化了 ──────────
print("\n① WIPLot.feedPressure  式：SUM(in(work_order_yields_wip_lot).qtyPlanned)*100/this.qty")
wl = allobjs("WIPLot")
wo = allobjs("WorkOrder")
wo_by_id = {o["id"]: o for o in wo}
print("   WIPLot n=%d  WorkOrder n=%d" % (len(wl), len(wo)))
print("   %-24s %10s %12s %12s %10s" % ("wipLot.id", "feedPress", "this.qty", "入边qtyPlanned", "重算"))
worse = 0
for o in sorted(wl, key=lambda z: z["id"])[:6]:
    q = num(o, "qty")
    ins = [wo_by_id[r["id"]] for r in (o.get("rels") or {}).get("work_order_yields_wip_lot", [])
           if r.get("id") in wo_by_id]
    s = sum(num(w, "qtyPlanned") or 0 for w in ins)
    rec = (s * 100 / q) if q else None
    got = num(o, "feedPressure")
    print("   %-24s %10s %12s %12s %10s   %s" % (
        o["id"], fmt(got), fmt(q), fmt(s), fmt(rec),
        "✓" if (rec is not None and got is not None and abs(rec - got) < 1e-6) else "✗ 差 %.4g" % (
            abs((rec or 0) - (got or 0)))))
    if rec is not None and got is not None and abs(rec - got) >= 1e-6:
        worse += 1
# 全量统计：入边条数分布 + qty 分布
nedge, qs, ss = {}, [], []
for o in wl:
    q = num(o, "qty")
    ins = [wo_by_id[r["id"]] for r in (o.get("rels") or {}).get("work_order_yields_wip_lot", [])
           if r.get("id") in wo_by_id]
    s = sum(num(w, "qtyPlanned") or 0 for w in ins)
    nedge[len(ins)] = nedge.get(len(ins), 0) + 1
    if q:
        qs.append(q)
    ss.append(s)
print("   入边条数分布 %s" % sorted(nedge.items()))
print("   this.qty 范围      %s" % (["%.4g" % min(qs), "%.4g" % max(qs)] if qs else "空"))
print("   入边 qtyPlanned 和 范围 [%.4g, %.4g]  不同值 %d 个" % (
    min(ss), max(ss), len(set(round(x, 6) for x in ss))))

# ── ② PurchaseOrder.expeditePressure：式 shipDay*100/(etaDay-orderDay) —— 先看这三个字段是什么─
print("\n② PurchaseOrder.expeditePressure  式：this.shipDay*100/(this.etaDay-this.orderDay)")
po = allobjs("PurchaseOrder")
print("   n=%d" % len(po))
print("   %-8s %8s %8s %8s %8s %9s %26s" % ("id", "orderDay", "etaDay", "shipDay", "arriveDay", "expedite", "窗口/发货用时"))
bad = 0
for o in sorted(po, key=lambda z: -(num(z, "expeditePressure") or 0))[:10]:
    od, ed, sd, ad = (num(o, "orderDay"), num(o, "etaDay"), num(o, "shipDay"), num(o, "arriveDay"))
    win = (ed - od) if (ed is not None and od is not None) else None
    el = (sd - od) if (sd is not None and od is not None) else None
    print("   %-8s %8s %8s %8s %8s %9.3f %26s" % (
        o["id"][-6:], od, ed, sd, ad, num(o, "expeditePressure") or 0,
        ("窗口 %.4g / 发货用时 %.4g" % (win, el)) if (win is not None and el is not None) else "—"))
# 负值那批单独点出来
neg = [o for o in po if (num(o, "expeditePressure") or 0) < 0]
print("   负值 %d 个：%s" % (len(neg), [(o["id"][-6:], num(o, "orderDay"), num(o, "etaDay"),
                                     num(o, "shipDay"), round(num(o, "expeditePressure"), 3)) for o in neg[:5]]))
ods = [num(o, "orderDay") for o in po if num(o, "orderDay") is not None]
sds = [num(o, "shipDay") for o in po if num(o, "shipDay") is not None]
eds = [num(o, "etaDay") for o in po if num(o, "etaDay") is not None]
print("   字段范围：orderDay [%g,%g] etaDay [%g,%g] shipDay [%g,%g]" % (
    min(ods), max(ods), min(eds), max(eds), min(sds), max(sds)))
# 重算：原式 & 候选式
def rec2(o, cand):
    od, ed, sd = num(o, "orderDay"), num(o, "etaDay"), num(o, "shipDay")
    if None in (od, ed, sd):
        return None
    d = ed - od
    if not d:
        return None
    return ((sd * 100 / d) if cand == "orig" else ((sd - od) * 100 / d))
ok_o = sum(1 for o in po if (lambda g, r: g is not None and r is not None and abs(g - r) < 1e-6)(
    num(o, "expeditePressure"), rec2(o, "orig")))
ok_c = sum(1 for o in po if (lambda g, r: g is not None and r is not None and abs(g - r) < 1e-6)(
    num(o, "expeditePressure"), rec2(o, "cand")))
print("   原式逐位相符 %d/%d ；候选式 (shipDay−orderDay)*100/窗口 逐位相符 %d/%d" % (
    ok_o, len(po), ok_c, len(po)))

# ── ③ 余下 7 格：拉源字段 + 重算，判「式子对不对」与「源字段是什么量纲」─────────────────────
CASES = [
    ("Base", "loadIndex", ["committedQty", "formationCapDaily", "agingCapDaily"],
     lambda o: (num(o, "committedQty") * 100 / (num(o, "formationCapDaily") + num(o, "agingCapDaily"))
                if (num(o, "formationCapDaily") or 0) + (num(o, "agingCapDaily") or 0) else None)),
    ("Customer", "receivablePressure", ["receivables", "creditLimit"],
     lambda o: (num(o, "receivables") * 100 / num(o, "creditLimit") if num(o, "creditLimit") else None)),
    ("Line", "blockedPressure", ["max_capacity_day"],
     None),  # 入边求和，单独处理
    ("Material", "shortageRisk", ["dailyUse", "leadTime", "onHand", "inTransit"],
     lambda o: ((num(o, "dailyUse") * num(o, "leadTime") - num(o, "onHand") - num(o, "inTransit")) * 100
                / (num(o, "dailyUse") * num(o, "leadTime"))
                if num(o, "dailyUse") and num(o, "leadTime") else None)),
    ("Model", "demandLoad", ["orderCount", "capacity"],
     lambda o: (num(o, "orderCount") * 100 / num(o, "capacity") if num(o, "capacity") else None)),
    ("Order", "costPressure", ["creditUsedRatio"],
     lambda o: ((num(o, "creditUsedRatio") or 0) * 100)),
]
for t, v, srcs, fn in CASES:
    objs = allobjs(t)
    print("\n③ %s.%s   源字段 %s" % (t, v, srcs))
    ok = bad = nod = 0
    rows = []
    for o in objs:
        got = num(o, v)
        rec = fn(o) if fn else None
        if got is None:
            continue
        if rec is None:
            nod += 1
            continue
        if abs(rec - got) < 1e-6:
            ok += 1
        else:
            bad += 1
            rows.append((o["id"], got, rec))
        if len(rows) < 4:
            pass
    print("   重算逐位相符 %d / 不符 %d / 源缺字段算不出 %d（n=%d）" % (ok, bad, nod, len(objs)))
    for r in rows[:4]:
        print("     ✗ %-24s 目标 %10.4g  重算 %10.4g" % r)
    # 源字段各自的分布 —— 判量纲用
    for s in srcs:
        vals = [num(o, s) for o in objs if num(o, s) is not None]
        if vals:
            print("     源 %-18s [%10.4g, %10.4g]  n=%d 不同值 %d" % (
                s, min(vals), max(vals), len(vals), len(set(vals))))
        else:
            print("     源 %-18s ⛔ 零命中（n=0）" % s)

# Line.blockedPressure 的入边求和
print("\n③ Line.blockedPressure  式：SUM(out(line_runs_work_order).qtyPlanned)*100/this.max_capacity_day")
wo_by_wo_id = {o["id"]: o for o in wo}
li = allobjs("Line")
print("   n=%d" % len(li))
ok = bad = 0
for o in sorted(li, key=lambda z: -(num(z, "blockedPressure") or 0))[:5]:
    cap = num(o, "max_capacity_day")
    ins = [wo_by_wo_id[r["id"]] for r in (o.get("rels") or {}).get("line_runs_work_order", [])
           if r.get("id") in wo_by_wo_id]
    s = sum(num(w, "qtyPlanned") or 0 for w in ins)
    rec = (s * 100 / cap) if cap else None
    got = num(o, "blockedPressure")
    print("   %-22s 目标 %9.4g  重算 %9.4g  (入边%d条 和%.4g ÷ cap %.4g)  %s" % (
        o["id"], got or 0, rec or 0, len(ins), s, cap or 0,
        "✓" if (rec is not None and got is not None and abs(rec - got) < 1e-6) else "✗"))
