"""最优化引擎 sidecar 的**真求解**测试（pytest，需 ortools）。

核心论证：贪心按性价比对 0/1 背包不保证最优，CP-SAT 给可证最优——这是引入引擎的全部理由。
覆盖：① 经典反例上 CP-SAT 严格优于贪心；② R6 确定性（同 seed 重跑字节级一致）；
③ maxCount / minValue 约束；④ 不可行。
"""
import server


def greedy_by_ratio(items, budget):
    """性价比贪心（value/weight 降序装包）——0/1 背包的常见次优启发式,作对照。"""
    order = sorted(items, key=lambda it: (-(it["value"] / it["weight"]), it["id"]))
    cap, chosen, val = budget, [], 0.0
    for it in order:
        if it["weight"] <= cap:
            cap -= it["weight"]
            chosen.append(it["id"])
            val += it["value"]
    return val, sorted(chosen)


def test_cpsat_beats_greedy_on_classic_counterexample():
    # 预算 10。贪心先拿性价比最高的 A(6/6=1.0) → 剩 4 → 只能再拿 C(4)，总价值 6+4=10。
    # 最优是 B+C = 5+? ... 构造让贪心严格次优：
    items = [
        {"id": "A", "value": 60, "weight": 6},   # ratio 10.0,贪心先拿
        {"id": "B", "value": 50, "weight": 5},   # ratio 10.0
        {"id": "C", "value": 50, "weight": 5},   # ratio 10.0
    ]
    budget = 10
    g_val, _ = greedy_by_ratio(items, budget)
    out = server.solve_selection({"items": items, "budget": budget, "seed": 42})
    assert out["status"] == "OPTIMAL"
    # 最优：B+C 装满 10 → 100;贪心先拿 A(6) 后只剩 4 装不下任何 5 → 仅 60。CP-SAT 严格更优。
    assert out["totalValue"] == 100
    assert out["selected"] == ["B", "C"]
    assert g_val == 60
    assert out["totalValue"] > g_val


def test_determinism_r6_same_seed_byte_identical():
    items = [{"id": f"i{i}", "value": (i * 7) % 13 + 1, "weight": (i * 5) % 11 + 1} for i in range(20)]
    a = server.solve_selection({"items": items, "budget": 30, "seed": 42})
    b = server.solve_selection({"items": items, "budget": 30, "seed": 42})
    assert a == b  # 同 seed 同构建 → 完全一致


def test_max_count_constraint():
    items = [{"id": "A", "value": 10, "weight": 1}, {"id": "B", "value": 9, "weight": 1}, {"id": "C", "value": 8, "weight": 1}]
    out = server.solve_selection({"items": items, "budget": 99, "maxCount": 2, "seed": 42})
    assert len(out["selected"]) == 2
    assert out["selected"] == ["A", "B"]  # 取价值最高的两个


def test_min_value_floor_and_float_scaling():
    items = [{"id": "A", "value": 1.5, "weight": 2.0}, {"id": "B", "value": 2.5, "weight": 3.0}]
    out = server.solve_selection({"items": items, "budget": 5.0, "minValue": 4.0, "seed": 42})
    assert out["status"] == "OPTIMAL"
    assert out["totalValue"] == 4.0  # 两个都选才达 minValue 4.0,且 weight 5.0≤budget


def test_infeasible_when_min_value_unreachable():
    items = [{"id": "A", "value": 1, "weight": 1}]
    out = server.solve_selection({"items": items, "budget": 10, "minValue": 999, "seed": 42})
    assert out["status"] == "INFEASIBLE"
    assert out["selected"] == []


def test_dispatch_unknown_model_raises():
    import pytest

    with pytest.raises(ValueError):
        server.dispatch({"model": "nope"})


def test_assignment_optimize_min_cost_and_capacity():
    """A8.1 指派：2 订单→2 基地，容量约束 + 成本最小化，CP-SAT 可证最优。"""
    payload = {
        "model": "assignment", "seed": 42,
        "items": [{"id": "O1", "weight": 6}, {"id": "O2", "weight": 5}],
        "bins": [{"id": "B_cheap", "capacity": 6}, {"id": "B_exp", "capacity": 10}],
        # O1 在 cheap 更便宜但 cheap 容量只够一个；O2 也偏好 cheap → 求解器需权衡。
        "costs": [
            {"item": "O1", "bin": "B_cheap", "cost": 1}, {"item": "O1", "bin": "B_exp", "cost": 5},
            {"item": "O2", "bin": "B_cheap", "cost": 2}, {"item": "O2", "bin": "B_exp", "cost": 3},
        ],
    }
    out = server.solve_assignment(payload)
    assert out["status"] == "OPTIMAL"
    assert out["optimal"] is True
    # 每订单恰一指派
    assert len(out["assignments"]) == 2
    assigned = {a["item"]: a["bin"] for a in out["assignments"]}
    assert set(assigned) == {"O1", "O2"}
    # cheap 容量 6 只够 O1(6)；O2 必须去 exp → 最优 = O1@cheap(1) + O2@exp(3) = 4
    assert assigned["O1"] == "B_cheap"
    assert assigned["O2"] == "B_exp"
    assert out["objective"] == 4


def test_assignment_determinism_r6():
    payload = {
        "model": "assignment", "seed": 42,
        "items": [{"id": "O1", "weight": 1}, {"id": "O2", "weight": 1}],
        "bins": [{"id": "A", "capacity": 5}, {"id": "B", "capacity": 5}],
        "costs": [{"item": i, "bin": b, "cost": 1} for i in ["O1", "O2"] for b in ["A", "B"]],
    }
    a = server.solve_assignment(payload)
    b = server.solve_assignment(payload)
    assert a == b  # 同输入同 seed 字节一致（二级目标消多解抖动）


def test_assignment_infeasible_no_eligible_bin():
    payload = {
        "model": "assignment", "seed": 42,
        "items": [{"id": "O1", "weight": 1}],
        "bins": [{"id": "A", "capacity": 5}],
        "costs": [],  # 无资格对 → 不可行
    }
    out = server.solve_assignment(payload)
    assert out["status"] == "INFEASIBLE"
    assert out["assignments"] == []


def test_sequencing_minimize_changeovers():
    """A8.2 排序：6 个 job 三种 group → 最优排序应把同 group 聚拢，换型 = group 数 - 1 = 2。"""
    jobs = [
        {"id": "j1", "group": "A"}, {"id": "j2", "group": "B"}, {"id": "j3", "group": "A"},
        {"id": "j4", "group": "C"}, {"id": "j5", "group": "B"}, {"id": "j6", "group": "A"},
    ]
    out = server.solve_sequencing({"model": "sequencing", "seed": 42, "jobs": jobs})
    assert out["status"] == "OPTIMAL"
    assert out["changeovers"] == 2  # 3 组聚拢 → 2 次换型（最优）
    # 同 group 相邻（聚拢）
    seq_groups = [next(j["group"] for j in jobs if j["id"] == sid) for sid in out["sequence"]]
    runs = sum(1 for k in range(len(seq_groups) - 1) if seq_groups[k] != seq_groups[k + 1])
    assert runs == 2


def test_sequencing_determinism_r6():
    jobs = [{"id": f"j{i}", "group": g} for i, g in enumerate(["A", "B", "A", "B"])]
    a = server.solve_sequencing({"model": "sequencing", "seed": 42, "jobs": jobs})
    b = server.solve_sequencing({"model": "sequencing", "seed": 42, "jobs": jobs})
    assert a == b


def test_packing_min_bins():
    """A8.3 装箱：items [6,5,4,3] 容量 10 → 最优 2 箱（6+4, 5+3 或 6+3, 5+4）。"""
    items = [{"id": "a", "size": 6}, {"id": "b", "size": 5}, {"id": "c", "size": 4}, {"id": "d", "size": 3}]
    out = server.solve_packing({"model": "packing", "seed": 42, "items": items, "binCapacity": 10})
    assert out["status"] == "OPTIMAL"
    assert out["binCount"] == 2  # 18/10 → 至少 2 箱，且可行
    # 每箱 load ≤ 容量，全 item 装入
    assert all(b["load"] <= 10 for b in out["bins"])
    assert sorted(i for b in out["bins"] for i in b["items"]) == ["a", "b", "c", "d"]


def test_packing_determinism_r6():
    items = [{"id": chr(97 + i), "size": s} for i, s in enumerate([4, 4, 4, 4])]
    a = server.solve_packing({"model": "packing", "seed": 42, "items": items, "binCapacity": 8})
    b = server.solve_packing({"model": "packing", "seed": 42, "items": items, "binCapacity": 8})
    assert a == b
    assert a["binCount"] == 2  # 4 个 size4 → 每箱装 2 → 2 箱


def test_packing_infeasible_oversize():
    out = server.solve_packing({"model": "packing", "seed": 42, "items": [{"id": "x", "size": 99}], "binCapacity": 10})
    assert out["status"] == "INFEASIBLE"


# ── 轨B·增量1 抽象优化模板池 5 CP-SAT 核心：可证最优 + R6 确定性真求解 ─────────────

def test_facility_location_optimal_opens_cheapest():
    """选址：F1 开设便宜(10)，F2 贵(100)，全需求可去任一 → 最优只开 F1。"""
    out = server.solve_facility_location({
        "facilities": [{"id": "F1", "openCost": 10}, {"id": "F2", "openCost": 100}],
        "clients": [{"id": "C1"}, {"id": "C2"}],
        "assignCosts": [
            {"client": "C1", "facility": "F1", "cost": 1}, {"client": "C2", "facility": "F1", "cost": 2},
            {"client": "C1", "facility": "F2", "cost": 1}, {"client": "C2", "facility": "F2", "cost": 1},
        ], "seed": 42,
    })
    assert out["status"] == "OPTIMAL" and out["optimal"] is True
    assert out["openFacilities"] == ["F1"]          # 只开便宜的
    assert out["objective"] == 13                    # 10 + 1 + 2
    # R6 确定性
    a = server.solve_facility_location({"facilities": [{"id": "F1", "openCost": 10}, {"id": "F2", "openCost": 12}], "clients": [{"id": "C1"}], "assignCosts": [{"client": "C1", "facility": "F1", "cost": 1}, {"client": "C1", "facility": "F2", "cost": 1}], "seed": 42})
    b = server.solve_facility_location({"facilities": [{"id": "F1", "openCost": 10}, {"id": "F2", "openCost": 12}], "clients": [{"id": "C1"}], "assignCosts": [{"client": "C1", "facility": "F1", "cost": 1}, {"client": "C1", "facility": "F2", "cost": 1}], "seed": 42})
    assert a == b


def test_facility_location_capacity_forces_second():
    """capacitated：每设施容量只够 1 个需求(cap=1)，2 个需求 → 必须开两个设施（容量逼开）。"""
    out = server.solve_facility_location({
        "facilities": [{"id": "F1", "openCost": 1, "capacity": 1}, {"id": "F2", "openCost": 1, "capacity": 1}],
        "clients": [{"id": "C1", "demand": 1}, {"id": "C2", "demand": 1}],
        "assignCosts": [{"client": c, "facility": f, "cost": 1} for c in ["C1", "C2"] for f in ["F1", "F2"]], "seed": 42,
    })
    assert out["status"] == "OPTIMAL"
    assert set(out["openFacilities"]) == {"F1", "F2"}  # 各 cap=1，2 需求 → 容量逼开两个


def test_min_cost_flow_optimal_route_and_balance():
    """最小成本流：直达 cap6 cost5 vs 经 M cost1+1；10 单位 → 全走 M 最省(20)。"""
    out = server.solve_min_cost_flow({
        "nodes": [{"id": "S", "supply": 10}, {"id": "M", "supply": 0}, {"id": "T", "supply": -10}],
        "arcs": [{"from": "S", "to": "T", "cost": 5, "cap": 6}, {"from": "S", "to": "M", "cost": 1}, {"from": "M", "to": "T", "cost": 1}], "seed": 42,
    })
    assert out["status"] == "OPTIMAL"
    assert out["objective"] == 20
    a = server.solve_min_cost_flow({"nodes": [{"id": "S", "supply": 5}, {"id": "T", "supply": -5}], "arcs": [{"from": "S", "to": "T", "cost": 2}], "seed": 42})
    b = server.solve_min_cost_flow({"nodes": [{"id": "S", "supply": 5}, {"id": "T", "supply": -5}], "arcs": [{"from": "S", "to": "T", "cost": 2}], "seed": 42})
    assert a == b


def test_min_cost_flow_imbalance_infeasible():
    out = server.solve_min_cost_flow({"nodes": [{"id": "S", "supply": 10}, {"id": "T", "supply": -5}], "arcs": [{"from": "S", "to": "T", "cost": 1}], "seed": 42})
    assert out["status"] == "INFEASIBLE"


def test_set_cover_min_cost():
    """集合覆盖：A{1,2,3} B{3,4} C{4}，universe{1,2,3,4} → 最优 A+B（2 个，成本 2）。"""
    out = server.solve_set_cover({"sets": [{"id": "A", "covers": ["1", "2", "3"]}, {"id": "B", "covers": ["3", "4"]}, {"id": "C", "covers": ["4"]}], "universe": ["1", "2", "3", "4"], "seed": 42})
    assert out["status"] == "OPTIMAL"
    assert out["chosen"] == ["A", "B"]
    assert out["objective"] == 2


def test_set_cover_uncoverable_infeasible():
    out = server.solve_set_cover({"sets": [{"id": "A", "covers": ["1"]}], "universe": ["1", "9"], "seed": 42})
    assert out["status"] == "INFEASIBLE"


def test_independent_set_max_weight():
    """最大权独立集：路径 a(1)-b(3)-c(1)，相邻不可同选 → 选 a+c(2) 还是 b(3)？b 更大 → {b}。"""
    out = server.solve_independent_set({"nodes": [{"id": "a", "weight": 1}, {"id": "b", "weight": 3}, {"id": "c", "weight": 1}], "edges": [{"a": "a", "b": "b"}, {"a": "b", "b": "c"}], "seed": 42})
    assert out["status"] == "OPTIMAL"
    assert out["chosen"] == ["b"] and out["objective"] == 3
    # 无权重默认 1：a-b 一条边 → 选 1 个
    out2 = server.solve_independent_set({"nodes": [{"id": "a"}, {"id": "b"}], "edges": [{"a": "a", "b": "b"}], "seed": 42})
    assert out2["objective"] == 1


def test_combinatorial_auction_wdp():
    """组合拍卖：b1{x,y}=10 vs b2{x}=6 + b3{y}=6 → 互斥包 b2+b3=12 > b1=10。"""
    out = server.solve_combinatorial_auction({"bids": [{"id": "b1", "value": 10, "items": ["x", "y"]}, {"id": "b2", "value": 6, "items": ["x"]}, {"id": "b3", "value": 6, "items": ["y"]}], "seed": 42})
    assert out["status"] == "OPTIMAL"
    assert out["winners"] == ["b2", "b3"]
    assert out["objective"] == 12


def test_new_cores_determinism_r6():
    """5 核心同 seed 重跑字节一致（R6）。"""
    sc = lambda: server.solve_set_cover({"sets": [{"id": "A", "covers": ["1", "2"]}, {"id": "B", "covers": ["2", "3"]}], "seed": 42})
    iset = lambda: server.solve_independent_set({"nodes": [{"id": "a", "weight": 2}, {"id": "b", "weight": 2}], "edges": [{"a": "a", "b": "b"}], "seed": 42})
    ca = lambda: server.solve_combinatorial_auction({"bids": [{"id": "b1", "value": 5, "items": ["x"]}, {"id": "b2", "value": 5, "items": ["x"]}], "seed": 42})
    assert sc() == sc()
    assert iset() == iset()
    assert ca() == ca()
