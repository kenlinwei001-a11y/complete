#!/usr/bin/env python3
"""WO-DIMENSION-ERRORS 私有测量脚本 —— 对真起的 datacore（SEED_DEMO=1）取读数。
用法：python3 .wo-tmp/measure.py <port>  ；输出确定性 JSON，供 base 树 / HEAD 树逐集合对拍。"""
import json, sys, urllib.request, hashlib

PORT = sys.argv[1] if len(sys.argv) > 1 else "4401"
BASE = f"http://127.0.0.1:{PORT}/a/v1"
H = {"x-debug-user": "demo:admin:admin|planner|catalog_admin", "content-type": "application/json"}


def get(path):
    req = urllib.request.Request(BASE + path, headers=H)
    return json.load(urllib.request.urlopen(req))


def post(path, body):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), headers=H, method="POST")
    return json.load(urllib.request.urlopen(req))


def all_objects(t):
    out, page = [], 1
    while True:
        d = get(f"/objects?type={t}&page={page}&pageSize=200")
        items = d.get("items", [])
        out += [i.get("props", i) for i in items]
        if not d.get("hasMore"):
            break
        page += 1
    return out


res = {}

# ── 真实条数（aggregate，不是 page 长度）──
for t in ("Material", "Line", "Order", "DemandSegment", "BOMDetail"):
    try:
        res[f"count.{t}"] = post("/objects/aggregate", {"objectType": t, "agg": "count"})
    except Exception as e:  # noqa
        res[f"count.{t}"] = f"ERR {e}"

mats = sorted(all_objects("Material"), key=lambda m: m.get("matId", ""))
res["Material"] = [
    {k: m.get(k) for k in ("matId", "unit", "unitPrice", "onHand", "dailyUse", "inTransit", "leadTime", "idleDays")}
    for m in mats
]

lines = sorted(all_objects("Line"), key=lambda l: l.get("lineId", ""))
res["Line.totals"] = {
    "n": len(lines),
    "sum_max_capacity_day": round(sum(l.get("max_capacity_day") or 0 for l in lines), 4),
    "sum_capacityDaily": round(sum(l.get("capacityDaily") or 0 for l in lines), 4),
    "sum_actual_output_daily": round(sum(l.get("actual_output_daily") or 0 for l in lines), 4),
}
res["Line.sample"] = [
    {k: l.get(k) for k in ("lineId", "max_capacity_day", "capacityDaily", "actual_output_daily", "utilization")}
    for l in lines[:3]
]

segs = sorted(all_objects("DemandSegment"), key=lambda s: s.get("segId", ""))
res["DemandSegment"] = [
    {k: s.get(k) for k in ("segId", "segment", "demandWanPerYearP50", "priceWan", "marginPct", "revenueWan", "marginWan")}
    for s in segs
]
res["DemandSegment.sums"] = {
    "revenueWan": round(sum(s.get("revenueWan") or 0 for s in segs), 4),
    "marginWan": round(sum(s.get("marginWan") or 0 for s in segs), 4),
}

orders = all_objects("Order")
res["Order.totals"] = {
    "n": len(orders),
    "sum_qty": round(sum(o.get("qty") or 0 for o in orders), 4),
    "sum_value": round(sum(o.get("value") or 0 for o in orders), 4),
}
res["Order.sample"] = sorted(
    [{k: o.get(k) for k in ("so", "qty", "unitPrice", "value")} for o in orders], key=lambda o: str(o["so"])
)[:3]

# ── 求解器读数 ──
for key, args in (
    ("inventory_optimize", {}),
    ("margin_waterfall", {}),
):
    try:
        out = post(f"/solvers/{key}/invoke", {"args": args}).get("data", {})
        if key == "inventory_optimize":
            res["inventory_optimize"] = {
                "over": out.get("over"),
                "releasableCash": out.get("releasableCash"),
                "under_n": len(out.get("under") or []),
                "under_maxQty": round(max([u.get("underQty", 0) for u in out.get("under") or []] or [0]), 4),
            }
        else:
            res[key] = {k: out.get(k) for k in ("bomCost", "gm", "gmPct", "dataMode") if k in out}
    except Exception as e:  # noqa
        res[key] = f"ERR {e}"

# ── 超储分支的对照实验：造一份必然触发 over 的 materials 实参 ──
probe_mats = [
    {"matId": m["matId"], "dailyUse": m.get("dailyUse", 0), "leadTime": m.get("leadTime", 0),
     "onHand": (m.get("dailyUse", 0) * (m.get("leadTime", 0) + 5)) * 3, "unitPrice": m.get("unitPrice", 0),
     "idleDays": 0}
    for m in mats
]
try:
    out = post("/solvers/inventory_optimize/invoke", {"args": {"materials": probe_mats}}).get("data", {})
    res["inventory_optimize.overProbe"] = {
        "over": out.get("over"),
        "releasableCash": out.get("releasableCash"),
    }
except Exception as e:  # noqa
    res["inventory_optimize.overProbe"] = f"ERR {e}"

blob = json.dumps(res, ensure_ascii=False, sort_keys=True, indent=1)
print(blob)
print("\nSHA256=" + hashlib.sha256(blob.encode()).hexdigest(), file=sys.stderr)
for k in sorted(res):
    print("SET " + k + " " + hashlib.sha256(json.dumps(res[k], ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:16], file=sys.stderr)
