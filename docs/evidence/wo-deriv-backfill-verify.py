# WO-DERIV-BACKFILL · 17 条规格的**独立复算**对照（铁律 1.5 判据三）
#
# 判据：每一条断言必须能指出「它校验的那个数，我独立地从哪儿再算一遍」，并真的算一遍对上。
#   本脚本的「独立复算」= **从源字段重算**，⛔ 不读目标字段本身（规格已把值物化进 o.props[targetProp]，
#   读那个字段 = 拿结果验结果，是循环论证）。
#
# 用法：python3 docs/evidence/wo-deriv-backfill-verify.py [BASE_URL]
#   rc=0 ⇒ 17/17 逐位相符；rc=1 ⇒ 有对不上（逐条打印反例）；rc=2 ⇒ 环境/基线不满足（不许当通过）
import sys, json, collections, urllib.request

B = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4103"


def hit(p, method="GET", body=None):
    req = urllib.request.Request(
        B + p, method=method,
        data=(json.dumps(body).encode() if body is not None else None),
        headers={"x-debug-user": "demo:admin:admin", "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
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


sess = hit("/a/v1/sim/sessions", "POST", {})
base = sess.get("baseSnapshot") or {}
if len(base) < 1000:
    print("FATAL: baseSnapshot 只有 %d 个对象 —— 没连上已播种的实例（⛔ 别拿这个读数下结论）" % len(base))
    sys.exit(2)

TYPES = ["ARInvoice", "Certification", "ChangeoverMatrix", "CustomsClearance",
         "FinishedGoodsInventory", "IncomingInspection", "InterBaseTransfer", "MaintPlan",
         "MaterialAlternative", "MaterialBatch", "OverdueRecord", "QualityLot", "Shipment",
         "Supplier", "OrderLine", "Order", "Model"]
P = {t: {o["id"]: o["props"] for o in allobjs(t)} for t in TYPES}

# 金丝雀：确认源字段真的读到了（否则「17/17 相符」可能是两边都空）
CANARY = [("Order.leadDays", P["Order"], "leadDays"), ("Supplier.onTimeRate", P["Supplier"], "onTimeRate"),
          ("QualityLot.batchSize", P["QualityLot"], "batchSize")]
for nm, props, k in CANARY:
    n = sum(1 for p in props.values() if isinstance(p.get(k), (int, float)))
    if n == 0:
        print("FATAL: 金丝雀 %s 读到 0 个 —— 量法坏了，不是代码干净" % nm)
        sys.exit(2)
    print("金丝雀 %-22s 真读到 %d 个值" % (nm, n))

bym = collections.defaultdict(list)
for p in P["Order"].values():
    bym[p["model"]].append(p)
mid2pkid = {p.get("modelId"): oid for oid, p in P["Model"].items()}


def r4(x):
    return round(float(x) + 0.0, 4)


def nz(f):
    return lambda p: (f(p) if (p is not None) else None)


CASES = [
    ("ARInvoice.overdueDays", "overduePressure",
     {o: r4(p["overdueDays"]) for o, p in P["ARInvoice"].items() if p.get("overdueDays") is not None}),
    ("Certification.certHours", "qualificationQueue",
     {o: r4(p["certHours"]) for o, p in P["Certification"].items() if p.get("certHours") is not None}),
    ("ChangeoverMatrix.minutes", "changeoverPressure",
     {o: r4(p["minutes"]) for o, p in P["ChangeoverMatrix"].items() if p.get("minutes") is not None}),
    ("CustomsClearance.clearedDay-declaredDay", "clearanceQueueDays",
     {o: r4(p["clearedDay"] - p["declaredDay"]) for o, p in P["CustomsClearance"].items()}),
    ("FGI.qtyOnHand/dailyDemand", "drawdownPressure",
     {o: r4(p["qtyOnHand"] / p["dailyDemand"] if p.get("dailyDemand") else 0.0)
      for o, p in P["FinishedGoodsInventory"].items()}),
    ("IncomingInspection.releasedDay-arrivedDay", "queueDays",
     {o: r4(p["releasedDay"] - p["arrivedDay"]) for o, p in P["IncomingInspection"].items()}),
    ("IBT.transitDays*100/etaDay", "transferPressure",
     {o: r4(p["transitDays"] * 100.0 / p["etaDay"] if p.get("etaDay") else 0.0)
      for o, p in P["InterBaseTransfer"].items()}),
    ("MaintPlan.week", "windowSqueeze",
     {o: r4(p["week"]) for o, p in P["MaintPlan"].items() if p.get("week") is not None}),
    ("MaterialAlternative.priority", "switchPressure",
     {o: r4(p["priority"]) for o, p in P["MaterialAlternative"].items() if p.get("priority") is not None}),
    ("MaterialBatch.idleDays", "turnoverPressure",
     {o: r4(p["idleDays"]) for o, p in P["MaterialBatch"].items() if p.get("idleDays") is not None}),
    ("OverdueRecord.overdueDays", "collectionPressure",
     {o: r4(p["overdueDays"]) for o, p in P["OverdueRecord"].items() if p.get("overdueDays") is not None}),
    ("QualityLot.batchSize", "inspectBacklog",
     {o: r4(p["batchSize"]) for o, p in P["QualityLot"].items() if p.get("batchSize") is not None}),
    ("Shipment.etaDay", "inboundExpeditePressure",
     {o: r4(p["etaDay"]) for o, p in P["Shipment"].items() if p.get("etaDay") is not None}),
    ("Supplier.(contracted-actual)*100/contracted", "reviewPressure",
     {o: r4((p["contractedSupplyTon"] - p["actualSupplyTon"]) * 100.0 / p["contractedSupplyTon"]
            if p.get("contractedSupplyTon") else 0.0) for o, p in P["Supplier"].items()}),
    ("OrderLine.breachPenalty*100/(qty*unitPrice)", "splitPressure",
     {o: r4(p["breachPenalty"] * 100.0 / (p["qty"] * p["unitPrice"]))
      for o, p in P["OrderLine"].items() if p.get("qty") and p.get("unitPrice")}),
    ("Model.MAX(in(order_for_model).qty)", "backlogQtyTop",
     {mid2pkid[k]: r4(max(x["qty"] for x in v)) for k, v in bym.items() if k in mid2pkid}),
    ("Model.MAX(in(order_for_model).unitPrice)", "backlogPriceTop",
     {mid2pkid[k]: r4(max(x["unitPrice"] for x in v)) for k, v in bym.items() if k in mid2pkid}),
]

HDR = "%-44s %-24s %5s %9s  %s" % ("口径（独立复算）", "变量", "对数", "逐位相符", "最大绝对差")
print("\n" + HDR)
print("-" * len(HDR))
allok = True
for label, var, exp in CASES:
    tot = ok = 0
    worst, worstoid, worstgot = 0.0, None, None
    for oid, v in exp.items():
        got = (base.get(oid) or {}).get(var)
        if got is None:
            continue
        tot += 1
        d = abs(float(got) - v)
        if d < 1e-9:
            ok += 1
        elif d > worst:
            worst, worstoid, worstgot = d, oid, got
    good = (ok == tot and tot > 0)
    allok = allok and good
    tail = "" if good else "  ✗ 例 %s 期望 %s 实得 %s" % (worstoid, exp.get(worstoid), worstgot)
    print("%-44s %-24s %5d %5d/%-3d  %.6g%s" % (label, var, tot, ok, tot, worst, tail))

print("\n⇒ " + ("17/17 逐位相符（独立复算 == 世界态）" if allok else "✗ 有对不上，见上"))
sys.exit(0 if allok else 1)
