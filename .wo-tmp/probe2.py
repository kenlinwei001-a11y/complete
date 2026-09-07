#!/usr/bin/env python3
"""WO-DIMENSION-ERRORS 私有探针 2：BOMDetail.unit vs Material.unit 跨族核对 + Order/Line 口径。"""
import json, sys, urllib.request

PORT = sys.argv[1] if len(sys.argv) > 1 else "4401"
BASE = f"http://127.0.0.1:{PORT}/a/v1"
H = {"x-debug-user": "demo:admin:admin|planner|catalog_admin", "content-type": "application/json"}


def get(p):
    return json.load(urllib.request.urlopen(urllib.request.Request(BASE + p, headers=H)))


def all_objects(t):
    out, page = [], 1
    while True:
        d = get(f"/objects?type={t}&page={page}&pageSize=200")
        out += [i.get("props", i) for i in d.get("items", [])]
        if not d.get("hasMore"):
            break
        page += 1
    return out


mats = {m["matId"]: m for m in all_objects("Material")}
bd = all_objects("BOMDetail")
print(f"BOMDetail n={len(bd)}  Material n={len(mats)}")

# 金丝雀：先证明我真的读到了 unit 这一格（否则「零跨族」与「字段读空」在屏上一样）
have_unit = sum(1 for r in bd if r.get("unit"))
print(f"金丝雀 BOMDetail 带 unit 的行数 = {have_unit} / {len(bd)}")

mismatch, pairs = 0, {}
for r in bd:
    mu = (mats.get(r.get("materialId"), {}) or {}).get("unit")
    bu = r.get("unit")
    pairs[(bu, mu)] = pairs.get((bu, mu), 0) + 1
    if bu != mu:
        mismatch += 1
print(f"BOMDetail.unit ≠ Material.unit 的行数 = {mismatch}")
print("配对分布 (BOMDetail.unit, Material.unit) -> 行数:")
for k, v in sorted(pairs.items(), key=lambda x: str(x[0])):
    print("   ", k, v)

# 非「个」的行数（rate-dimension WO 说「8 行 BOM 里 7 行不是个」）
non_ge = sum(1 for r in bd if r.get("unit") != "个")
print(f"BOMDetail.unit != '个' 的行数 = {non_ge} / {len(bd)}")

# Order.unitPrice vs Model.unitPrice
models = {m["modelId"]: m for m in all_objects("Model")}
orders = all_objects("Order")
eq = sum(1 for o in orders if models.get(o.get("model"), {}).get("unitPrice") == o.get("unitPrice"))
print(f"\nOrder.unitPrice == Model.unitPrice 的单数 = {eq} / {len(orders)}")
print("Model 样本:", [{k: m.get(k) for k in ("modelId", "unitPrice", "capacityKwh")} for m in list(models.values())[:3]])

# Line 三个产能字段
lines = all_objects("Line")
import statistics
print(f"\nLine n={len(lines)}")
for f in ("max_capacity_day", "capacityDaily", "actual_output_daily"):
    vals = [l.get(f) for l in lines if l.get(f) is not None]
    print(f"  {f}: n={len(vals)} sum={round(sum(vals),2)} min={round(min(vals),2)} max={round(max(vals),2)} median={round(statistics.median(vals),2)}")
r = [l["actual_output_daily"] / l["max_capacity_day"] for l in lines if l.get("max_capacity_day")]
print(f"  actual/max 比值: min={round(min(r),3)} max={round(max(r),3)} median={round(statistics.median(r),3)}")
r2 = [l["actual_output_daily"] / l["capacityDaily"] for l in lines if l.get("capacityDaily")]
print(f"  actual/capacityDaily 比值: median={round(statistics.median(r2),3)}")
u = [l.get("utilization") for l in lines if l.get("utilization") is not None]
print(f"  utilization: median={round(statistics.median(u),3)}")
