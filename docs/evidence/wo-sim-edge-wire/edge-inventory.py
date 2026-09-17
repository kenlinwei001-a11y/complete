#!/usr/bin/env python3
"""WO-SIM-EDGE-WIRE 量②③固化：50 条已发布边全表（seed.ts 静态抽取 join fanin-N.json 实测扇入）。
金丝雀：必须恰抽出 50 条且 null 恰 34 条（与两个独立粗口径互验），不中即判抽法坏。"""
import json, re, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[3]
src = (ROOT / "apps/datacore/src/seed.ts").read_text()
rules = []
for b in re.split(r"\n\s+\{\n", src):
    if not re.search(r'id: "(simpr_demo_[a-z_0-9]+)"', b):
        continue
    g = lambda p: (re.search(p, b) or [None, None])[1]
    key = g(r'key: "(demo_[a-z_0-9]+)"')
    wr = "null" if re.search(r"^\s+weightRef: null,", b, re.M) else (g(r'weightRef: \{ basis: "([a-z_]+)"') or "?")
    rules.append(dict(key=key, source=f'{g(r"sourceTypeKey: .([A-Za-z]+).")}.{g(r"sourceStateVar: .([a-zA-Z]+).")}',
                      target=f'{g(r"targetTypeKey: .([A-Za-z]+).")}.{g(r"targetStateVar: .([a-zA-Z]+).")}', weightRef=wr))
n_null = sum(1 for r in rules if r["weightRef"] == "null")
assert len(rules) == 50 and n_null == 34, f"🐤 金丝雀 ✗：{len(rules)} 条 / null {n_null}（应 50/34）"
fanin = json.loads((ROOT / "docs/evidence/wo-sim-edge-wire/fanin-N.json").read_text())
for r in rules:
    r["faninN"] = fanin.get(r["key"], "未触发")
print(json.dumps(rules, ensure_ascii=False, indent=1))
