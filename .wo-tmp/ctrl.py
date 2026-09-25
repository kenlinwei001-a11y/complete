#!/usr/bin/env python3
"""WO-DIMENSION-ERRORS · 铁律 1.5 对照实验（真起后端 SEED_DEMO=1·真路由）。

三格对照，判据是「同一脚本跑两棵树」：
  A 生产路（不传 materials ⇒ 上下文装配，`unit` 取自真 Material.unit）· safetyDays=-12 逼出 over
  B 直传 materials **带 unit**（= 生产路的等价物）
  C 直传 materials **unit 写成词表外的 '卷'**（反向对照：许可必须当场撤销）
"""
import json, sys, urllib.request, hashlib

PORT = sys.argv[1] if len(sys.argv) > 1 else "4401"
BASE = f"http://127.0.0.1:{PORT}/a/v1"
H = {"x-debug-user": "demo:admin:admin|planner|catalog_admin", "content-type": "application/json"}


def call(path, body=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body else None, headers=H,
                                 method="POST" if body else "GET")
    return json.load(urllib.request.urlopen(req))


mats = [i["props"] for i in call("/objects?type=Material&pageSize=200")["items"]]
mats.sort(key=lambda m: m["matId"])


def rows(unit_override=None, with_unit=True):
    out = []
    for m in mats:
        r = {"matId": m["matId"], "dailyUse": m["dailyUse"], "leadTime": m["leadTime"],
             "onHand": m["onHand"], "unitPrice": m["unitPrice"], "idleDays": 0}
        if with_unit:
            r["unit"] = unit_override or m["unit"]
        out.append(r)
    return out


res = {}
res["A_production"] = call("/solvers/inventory_optimize/invoke", {"args": {"safetyDays": -12}})["data"]
res["B_passthru_with_unit"] = call("/solvers/inventory_optimize/invoke",
                                   {"args": {"safetyDays": -12, "materials": rows()}})["data"]
res["C_passthru_bad_unit"] = call("/solvers/inventory_optimize/invoke",
                                  {"args": {"safetyDays": -12, "materials": rows(unit_override="卷")}})["data"]

# 报价毛利：走真 BOM（CUSTOMER 分支）—— #3 的生产路读数
try:
    custs = [i["props"] for i in call("/objects?type=Customer&pageSize=5")["items"]]
    res["quote_margin"] = call("/solvers/quote_margin/invoke",
                               {"args": {"custName": custs[0].get("custId") or custs[0].get("name")}})["data"]
except Exception as e:  # noqa
    res["quote_margin"] = f"ERR {e}"

for k in ("A_production", "B_passthru_with_unit", "C_passthru_bad_unit"):
    d = res[k]
    over = d.get("over") or []
    print(f"\n=== {k} ===")
    print(f"  over 行数 = {len(over)}   releasableCash = {d.get('releasableCash')}")
    for o in over[:3]:
        print("   ", {kk: o.get(kk) for kk in ("matId", "overQty", "value", "valueUnit")})
    omitted = [o for o in over if o.get("value") is None]
    print(f"  未给 value 的行数 = {len(omitted)}")
    if omitted:
        print("  首条原因:", omitted[0].get("valueOmittedReason"))

q = res["quote_margin"]
if isinstance(q, dict):
    print("\n=== quote_margin (真 BOM) ===")
    print("  breakdown =", json.dumps(q.get("breakdown"), ensure_ascii=False))
    print("  margin =", q.get("margin"), " verdict =", q.get("verdict"))

blob = json.dumps(res, ensure_ascii=False, sort_keys=True)
print("\nCTRL_SHA256=" + hashlib.sha256(blob.encode()).hexdigest(), file=sys.stderr)
for k in sorted(res):
    print("SET " + k + " " + hashlib.sha256(json.dumps(res[k], ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:16], file=sys.stderr)
