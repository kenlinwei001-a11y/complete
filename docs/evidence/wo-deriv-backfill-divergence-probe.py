# WO-DERIV-BACKFILL · 「9 格 max:null 会不会发散」的**带扰动**复测（订正一条件空头证据）
#
# ── 为什么要重测（本脚本存在的唯一理由）────────────────────────────────────────────
# 我先前的证据 `wo-deriv-backfill-9cells-verify.txt` ③ 写的是：
#     「改声明的 6 格：跑 10 拍不发散（max:null 必须靠 λ 收住）… 上界比 1.000 ✓ 未发散」
# 实测值是 **t0 与 t10 逐位相同**（6/6 格）。那不是"收住了"，那是**世界根本没动**：
# 那个实例是本分支的构建，而本分支基座里的 `77a35c815`（RESTPOINT-SOURCE-B）把传导核
# 驱动量改成「源读数 − 源侧静息点」⇒ **零扰动世界里驱动量恒 0，一拍都不传导**。
#
#   形态（铁律 0.6 句式）：
#   **「我用『t10 与 t0 相同』当作『这几格被 λ 收住了』的证据，而前者并不度量后者
#     —— 一个根本不动的世界也给出同一个读数。」**
#
# ── 本脚本的判据（三条，缺一条结论就不成立）────────────────────────────────────────
#   ① **金丝雀先行**：扰动后世界**必须真的动了**（变化的格子数 > 0，且本表 9 格里至少 1 格动）。
#      它不动 ⇒ 报「量法坏了（世界仍死）」，⛔ 不许读成「没发散」。
#   ② 9 格在 t10 的上界比（max|t10| / max|t0|）有限，且 t10 相对 t5 **不再增长**（收住 ≠ 一直涨）。
#   ③ 扰动用 `durationTicks: 1` 的**一次性脉冲**，不是永久项 —— 永久项每拍重加会掩盖衰减。
#
# 用法：python3 docs/evidence/wo-deriv-backfill-divergence-probe.py [BASE_URL]
#   rc=0 ⇒ 三条判据全部成立；rc=1 ⇒ 有格发散/未收住；rc=2 ⇒ 环境不满足或金丝雀不响（结论作废）

import sys, json, urllib.request, collections

B = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4106"


def hit(p, method="GET", body=None):
    req = urllib.request.Request(
        B + p, method=method,
        data=(json.dumps(body).encode() if body is not None else None),
        headers={"x-debug-user": "demo:admin:admin", "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read().decode())


# 本单把 max 从 100 改成 null 的那 9 格（第 1 批 3 格 + 第 2 批 6 格）
CELLS = [("ChangeoverMatrix", "changeoverPressure"), ("MaterialBatch", "turnoverPressure"),
         ("OrderLine", "splitPressure"),
         ("Base", "loadIndex"), ("Model", "demandLoad"), ("Order", "costPressure"),
         ("Customer", "receivablePressure"), ("WIPLot", "feedPressure"), ("Line", "blockedPressure")]
CELLSET = set(CELLS)

# ── 规则图：找出这 9 格的入边源 ──────────────────────────────────────────────
rules = hit("/a/v1/sim/propagation-rules")["items"]
pub = [r for r in rules if r.get("status") == "PUBLISHED"]
print("规则总数 %d（PUBLISHED %d）" % (len(rules), len(pub)))
if not pub:
    print("FATAL: 一条 PUBLISHED 规则都没有 —— 环境不对，⛔ 别拿这个读数下结论")
    sys.exit(2)

sources = collections.defaultdict(set)          # (type,var) -> {targetCell}
for r in pub:
    tgt = (r["targetTypeKey"], r["targetStateVar"])
    if tgt in CELLSET:
        sources[(r["sourceTypeKey"], r["sourceStateVar"])].add(tgt)
print("9 格的入边源共 %d 个 (类型,变量)" % len(sources))
if not sources:
    print("FATAL: 这 9 格一条入边都没有 —— 量法坏了（图没读到）")
    sys.exit(2)

# ── 建会话 ────────────────────────────────────────────────────────────────
sess = hit("/a/v1/sim/sessions", "POST", {})
sid = sess["id"]
w0 = hit("/a/v1/sim/sessions/%s/world" % sid)
st0 = w0["state"]
print("会话 %s · tick=%s · 世界对象 %d" % (sid, w0["tick"], len(st0)))
if len(st0) < 1000:
    print("FATAL: 世界只有 %d 个对象 —— 没连上已播种实例" % len(st0))
    sys.exit(2)


def objs(t):
    out, pg = [], 1
    while True:
        d = hit("/a/v1/objects?type=%s&page=%d&pageSize=500" % (t, pg))
        out += d.get("items") or []
        if not d.get("hasMore"):
            return out
        pg += 1


# ── 施加脉冲：每个入边源挑最多 3 个读数最大的对象，delta = 该源的实测跨度 ──────────
made, skipped = 0, []
for (stype, svar), tgts in sorted(sources.items()):
    pool = []
    for o in objs(stype):
        v = (st0.get(o["id"]) or {}).get(svar)
        if isinstance(v, (int, float)):
            pool.append((abs(v), o["id"], v))
    if not pool:
        skipped.append("%s.%s(读不到真值)" % (stype, svar))
        continue
    pool.sort(reverse=True)
    span = max(1.0, max(p[2] for p in pool) - min(p[2] for p in pool))
    for _, oid, _v in pool[:3]:
        hit("/a/v1/sim/sessions/%s/perturbations" % sid, "POST", {
            "kind": "supply_disruption", "targetObjectId": oid, "targetStateVar": svar,
            "mode": "delta", "magnitude": round(span, 6), "durationTicks": 1,
            "label": "WO-DERIV-BACKFILL 发散复测脉冲 %s.%s" % (stype, svar)})
        made += 1
print("脉冲扰动：施加 %d 条（跳过 %d 个源：%s）" % (made, len(skipped), ", ".join(skipped) or "无"))
if made == 0:
    print("FATAL: 一条脉冲都没施加 —— 金丝雀不可能响，结论作废")
    sys.exit(2)

def tick(n):
    hit("/a/v1/sim/sessions/%s/tick" % sid, "POST", {"n": n})


SNAP, prev = {}, 0
for at, step in ((5, 5), (10, 5), (20, 10), (30, 10)):
    tick(step)
    prev = at
    SNAP[at] = hit("/a/v1/sim/sessions/%s/world" % sid)["state"]
w5, w10, w20, w30 = SNAP[5], SNAP[10], SNAP[20], SNAP[30]


def cellvals(state, t, v):
    """按对象 id 前缀取该型的实例 —— id 形如 obj_<type小写>_<n>，做前缀匹配即可。"""
    pre = "obj_%s_" % t.lower()
    return [state[o][v] for o in state if o.startswith(pre) and isinstance((state[o] or {}).get(v), (int, float))]


# ── 金丝雀①：世界真的动了吗 ────────────────────────────────────────────────
changed = 0
for o in st0:
    a, b = st0.get(o) or {}, w10.get(o) or {}
    if a != b:
        changed += 1
moved_cells = [c for c in CELLS if cellvals(st0, *c) != cellvals(w10, *c)]
print("\n── 金丝雀① 世界是否真的动了 ─────────────────────────────")
print("   变化的对象数：%d / %d" % (changed, len(st0)))
print("   本表 9 格中读数发生变化的：%d / 9 %s" % (len(moved_cells), moved_cells))
if changed == 0:
    print("   ⛔ 世界仍然不动 ⇒ 量法坏了（或该构建仍带「零扰动恒定」），本脚本结论一律作废")
    sys.exit(2)
if not moved_cells:
    print("   ⚠ 世界动了，但这 9 格一个都没动 ⇒ 脉冲没打中它们的上游，本表结论**未取到样本**")
    sys.exit(2)

# ── 判据②：9 格的上界轨迹 —— 判「**收敛**」而不是「一点都不许涨」 ──────────────
#
# ⚠ 我第一版用了「t5→t10 不许涨」当判据，**它是错的**：走向一个**更高的不动点**时
#   u 单调上升但**增量在收缩**，那正是收敛的样子（实测 changeoverPressure
#   179.0000 → 179.0092 → 179.0174，两次增量 0.0092 / 0.0082）。
#   拿"不许涨"去卡它，会把收敛误报成发散 —— 与「t10==t0 ⇒ 收住了」是同一个病的两面。
# 正确判据（缺一不可）：
#   (a) 有界    ：u30 / u0 < 2（发散是指数级，跑 30 拍会远超 2 倍）；
#   (b) 增量收缩：|u30−u20| ≤ 0.2 × |u5−u0|（真收敛 ⇒ 后期增量比前期小一个量级）；
#   (c) 弛回静息：t30 与 t0 **逐字节相同的对象数**应 ≥ t10 时刻的（λ 的语义就是拉回静息）。
print("\n── 判据② 9 格上界轨迹（脉冲后 30 拍）─────────────────────")
print("   %-26s %11s %11s %11s %11s %8s %10s" % ("格", "t0", "t5", "t20", "t30", "t30/t0", "增量比"))
bad = []
for t, v in CELLS:
    a, m, p, b = cellvals(st0, t, v), cellvals(w5, t, v), cellvals(w20, t, v), cellvals(w30, t, v)
    if not a or not m or not b:
        print("   %-26s %s" % ("%s.%s" % (t, v), "无实例"))
        continue
    ua, um, up, ub = max(abs(x) for x in a), max(abs(x) for x in m), max(abs(x) for x in p), max(abs(x) for x in b)
    ratio = (ub / ua) if ua else float("inf")
    d1, d2 = abs(um - ua), abs(ub - up)
    shrink = (d2 / d1) if d1 > 1e-12 else 0.0
    flag = ""
    if not (ratio < 2.0):
        flag = " ⛔ 有界判据不过（t30/t0 ≥ 2）"
    elif d1 > 1e-12 and shrink > 0.2:
        flag = " ⛔ 增量未收缩"
    if flag:
        bad.append("%s.%s" % (t, v))
    print("   %-26s %11.4f %11.4f %11.4f %11.4f %8.3f %10s%s"
          % ("%s.%s" % (t, v), ua, um, up, ub, ratio, ("%.3f" % shrink) if d1 > 1e-12 else "Δ1=0", flag))

# ── 观察项（⛔ 不是判据）：世界会不会整体弛回 t0 ─────────────────────────────
#
# 我第一版把这一条写成了判据③并要求它成立，**那是错的** —— 它度量的是**别的东西**：
#   「世界整体弛回静息」的前提是**每个状态量都有 λ**，而域表里**未声明的状态量不夹、不衰减**
#   （纯积分器：一次性脉冲会被它积分成一个**永久偏移**）。本仓有大量未声明格 ⇒ 这条天生不成立。
#   ⇒ 它既不构成本单的前提，也不度量本单的问题（这 9 格会不会发散），故**降级为观察项**。
#   ⚠ 与判据② 的关系：② 已经证明这 **9 格**在 t20→t30 增量≈0（各自到了不动点）；
#     「别的 1995 个对象还偏着」是它们自己那套动力学的事，不是这 9 格发散的证据。
same10 = sum(1 for o in st0 if (st0.get(o) or {}) == (w10.get(o) or {}))
same30 = sum(1 for o in st0 if (st0.get(o) or {}) == (w30.get(o) or {}))
print("\n── 观察项（不计入判据）世界与 t0 逐字节相同的对象数 ────────")
print("   t10 %d / %d · t30 %d / %d" % (same10, len(st0), same30, len(st0)))
print("   （未弛回 = 未声明域的状态量当天生是纯积分器；与本单 9 格的有界性无关）")

print("\n结论：%s" % ("✓ 判据全部成立：世界确实动了（金丝雀①）· 9 格有界且增量收缩（判据②）"
                    if not bad else "⛔ 有问题：%s" % ", ".join(bad)))
sys.exit(0 if not bad else 1)
