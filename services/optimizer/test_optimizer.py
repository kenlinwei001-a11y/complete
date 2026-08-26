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


# ── WO-CROSS-OBJECT-MULTIOBJ 多目标（三 method）+ 跨对象占用（三元互斥）· 可证最优对拍 ──────

import itertools


def _brute_multi_weighted(var_specs, constraints, objectives):
    """小规模枚举全解 → 找 weighted 合成目标全局最优（对拍验证 CP-SAT 非启发式/非贪心）。"""
    domains = []
    ids = [v["id"] for v in var_specs]
    for v in var_specs:
        if v.get("kind", "bool") == "bool":
            domains.append([0, 1])
        else:
            domains.append(list(range(int(v.get("lo", 0)), int(v.get("hi", 1)) + 1)))
    best = None
    best_val = None
    for combo in itertools.product(*domains):
        asg = dict(zip(ids, combo))
        ok = True
        for c in constraints:
            lhs = sum(t.get("coef", 0) * asg[t["var"]] for t in c["terms"])
            op, rhs = c.get("op", "<="), c["rhs"]
            if op == "<=" and not lhs <= rhs: ok = False
            if op == ">=" and not lhs >= rhs: ok = False
            if op == "==" and not lhs == rhs: ok = False
            if not ok:
                break
        if not ok:
            continue
        val = 0.0
        for o in objectives:
            sign = 1 if o.get("sense", "max") == "max" else -1
            oval = sum(t.get("coef", 0) * asg[t["var"]] for t in o["terms"])
            val += sign * o.get("weight", 1.0) * oval
        if best_val is None or val > best_val:
            best_val, best = val, asg
    return best_val, best


def test_multi_objective_weighted_provably_optimal_vs_enumeration():
    """加权多目标：CP-SAT 合成目标值 = 枚举全解全局最优（可证最优，非贪心）。"""
    var_specs = [{"id": "a", "kind": "bool"}, {"id": "b", "kind": "bool"}, {"id": "c", "kind": "bool"}]
    constraints = [{"terms": [{"var": "a", "coef": 1}, {"var": "b", "coef": 1}, {"var": "c", "coef": 1}], "op": "<=", "rhs": 2}]
    objectives = [
        {"key": "profit", "sense": "max", "terms": [{"var": "a", "coef": 5}, {"var": "b", "coef": 3}, {"var": "c", "coef": 4}], "weight": 0.7},
        {"key": "risk", "sense": "min", "terms": [{"var": "a", "coef": 4}, {"var": "b", "coef": 1}, {"var": "c", "coef": 1}], "weight": 0.3},
    ]
    payload = {"model": "multi_objective", "seed": 42, "scale": 1, "vars": var_specs, "constraints": constraints, "objectives": objectives, "method": "weighted"}
    out = server.solve_multi_objective(payload)
    assert out["status"] == "OPTIMAL" and out["optimal"] is True
    # CP-SAT 合成目标值（用返回的 objectiveValues 重算 weighted 组合）= 枚举最优。
    got = 0.7 * out["objectiveValues"]["profit"] - 0.3 * out["objectiveValues"]["risk"]
    best_val, _ = _brute_multi_weighted(var_specs, constraints, objectives)
    assert abs(got - best_val) < 1e-6
    # 分目标值分别回报（前端 Δ 分解用）。
    assert set(out["objectiveValues"]) == {"profit", "risk"}


def test_multi_objective_weight_drift_changes_optimum():
    """权重漂移：营收优先 vs 风险优先 → 最优真漂移（不同 values），非同一解贴标签。"""
    var_specs = [{"id": "a", "kind": "bool"}, {"id": "b", "kind": "bool"}]
    # a：高营收高风险；b：低营收低风险。恰选一个（否则"不选"目标 0 会占优，掩盖漂移）。
    constraints = [{"terms": [{"var": "a", "coef": 1}, {"var": "b", "coef": 1}], "op": "==", "rhs": 1}]
    base_obj = lambda: [
        {"key": "rev", "sense": "max", "terms": [{"var": "a", "coef": 10}, {"var": "b", "coef": 6}]},
        {"key": "risk", "sense": "min", "terms": [{"var": "a", "coef": 9}, {"var": "b", "coef": 1}]},
    ]
    wa = base_obj(); wa[0]["weight"] = 0.9; wa[1]["weight"] = 0.1  # 营收优先
    wb = base_obj(); wb[0]["weight"] = 0.1; wb[1]["weight"] = 0.9  # 风险优先
    common = {"model": "multi_objective", "seed": 42, "scale": 1, "vars": var_specs, "constraints": constraints, "method": "weighted"}
    out_a = server.solve_multi_objective({**common, "objectives": wa})
    out_b = server.solve_multi_objective({**common, "objectives": wb})
    assert out_a["values"] != out_b["values"]  # 权重变 → 最优指派真变
    assert out_a["values"]["a"] == 1  # 营收优先选高营收 a
    assert out_b["values"]["b"] == 1  # 风险优先选低风险 b


def test_multi_objective_epsilon_constraint():
    """ε-约束：主目标最大化营收，风险作 ε-约束（≤ 上界）→ 高风险解被界外剔除。"""
    var_specs = [{"id": "a", "kind": "bool"}, {"id": "b", "kind": "bool"}]
    constraints = [{"terms": [{"var": "a", "coef": 1}, {"var": "b", "coef": 1}], "op": "<=", "rhs": 1}]
    objectives = [
        {"key": "rev", "sense": "max", "terms": [{"var": "a", "coef": 10}, {"var": "b", "coef": 6}]},
        {"key": "risk", "sense": "min", "terms": [{"var": "a", "coef": 9}, {"var": "b", "coef": 1}]},
    ]
    # risk ≤ 5 → a(risk9) 被排除，只能选 b（rev6, risk1）。
    out = server.solve_multi_objective({"model": "multi_objective", "seed": 42, "scale": 1, "vars": var_specs, "constraints": constraints, "objectives": objectives, "method": "epsilon", "epsilon": [{"key": "risk", "bound": 5}]})
    assert out["status"] == "OPTIMAL"
    assert out["values"]["b"] == 1 and out["values"]["a"] == 0
    assert out["objectiveValues"]["risk"] <= 5


def test_multi_objective_lexicographic_priority_order():
    """字典序：先最大化营收（选 a），再在营收最优约束下最小化风险 → 营收锁死不被风险牺牲。"""
    var_specs = [{"id": "a", "kind": "bool"}, {"id": "b", "kind": "bool"}]
    constraints = [{"terms": [{"var": "a", "coef": 1}, {"var": "b", "coef": 1}], "op": "<=", "rhs": 1}]
    objectives = [
        {"key": "rev", "sense": "max", "terms": [{"var": "a", "coef": 10}, {"var": "b", "coef": 6}]},
        {"key": "risk", "sense": "min", "terms": [{"var": "a", "coef": 9}, {"var": "b", "coef": 1}]},
    ]
    out = server.solve_multi_objective({"model": "multi_objective", "seed": 42, "scale": 1, "vars": var_specs, "constraints": constraints, "objectives": objectives, "method": "lexicographic", "priority": ["rev", "risk"]})
    assert out["status"] == "OPTIMAL"
    # 营收第一优先 → 选 a（rev10>rev6），即便 a 风险更高也不让步。
    assert out["values"]["a"] == 1 and out["values"]["b"] == 0
    assert out["objectiveValues"]["rev"] == 10


def test_multi_objective_determinism_r6():
    var_specs = [{"id": f"v{i}", "kind": "bool"} for i in range(6)]
    constraints = [{"terms": [{"var": f"v{i}", "coef": 1} for i in range(6)], "op": "<=", "rhs": 3}]
    objectives = [{"key": "k", "sense": "max", "terms": [{"var": f"v{i}", "coef": (i * 3) % 7 + 1} for i in range(6)]}]
    p = {"model": "multi_objective", "seed": 42, "scale": 1, "vars": var_specs, "constraints": constraints, "objectives": objectives, "method": "weighted"}
    assert server.solve_multi_objective(p) == server.solve_multi_objective(p)


def _brute_cross_object(orders, lines, contracts, elig, weights):
    """枚举 x[o,l] 全组合 → weighted 目标全局最优（对拍 CP-SAT）。规模需小。"""
    cap = {l["id"]: l["capacity"] for l in lines}
    ccap = {c["id"]: c["cap"] for c in contracts}
    cost = {(e["order"], e["line"]): e["cost"] for e in elig}
    pairs = list(cost.keys())
    oids = [o["id"] for o in orders]
    rev = {o["id"]: o["revenue"] for o in orders}
    pen = {o["id"]: o["penalty"] for o in orders}
    qty = {o["id"]: o["qty"] for o in orders}
    cof = {o["id"]: o.get("contractId") for o in orders}
    best_val, best = None, None
    for bits in itertools.product([0, 1], repeat=len(pairs)):
        asg = dict(zip(pairs, bits))
        served = {}
        ok = True
        for o in oids:
            s = sum(asg[(o, l)] for l in [ll["id"] for ll in lines] if (o, l) in asg)
            if s > 1:
                ok = False; break
            served[o] = s
        if not ok:
            continue
        for l in [ll["id"] for ll in lines]:
            if sum(qty[o] * asg[(o, l)] for o in oids if (o, l) in asg) > cap[l]:
                ok = False; break
        if not ok:
            continue
        for c, cc in ccap.items():
            if sum(qty[o] * served[o] for o in oids if cof[o] == c) > cc:
                ok = False; break
        if not ok:
            continue
        revenue = sum(served[o] * rev[o] for o in oids)
        penalty = sum((1 - served[o]) * pen[o] for o in oids)
        c_cost = sum(cost[p] * asg[p] for p in pairs)
        val = weights["revenue"] * revenue - weights["penalty"] * penalty - weights["cost"] * c_cost
        if best_val is None or val > best_val:
            best_val, best = val, (dict(served), dict(asg))
    return best_val, best


def _cross_fixture():
    """固定三元：产线容量只容部分订单 → 逼出权衡（SEAM-1/2 共用）。"""
    orders = [
        {"id": "O_hi", "revenue": 100, "penalty": 5, "qty": 6, "contractId": "K1"},   # 高营收低违约
        {"id": "O_pen", "revenue": 60, "penalty": 80, "qty": 6, "contractId": "K1"},  # 低营收高违约
    ]
    lines = [{"id": "L1", "capacity": 6}]  # 只容一单（qty6）
    contracts = [{"id": "K1", "cap": 100}]
    elig = [{"order": "O_hi", "line": "L1", "cost": 1}, {"order": "O_pen", "line": "L1", "cost": 1}]
    return orders, lines, contracts, elig


def test_cross_object_seam1_weight_drift_optimal_reassignment():
    """SEAM-1 可证最优真漂移：产线只容一单 → 营收优先排 O_hi / 违约优先排 O_pen，两组不同最优。"""
    orders, lines, contracts, elig = _cross_fixture()
    common = {"model": "cross_object_occupancy", "seed": 42, "scale": 1, "orders": orders, "lines": lines, "contracts": contracts, "eligibility": elig, "method": "weighted"}
    # w_A 营收优先。
    a = server.solve_cross_object_occupancy({**common, "objectives": [{"key": "revenue", "weight": 1.0}, {"key": "penalty", "weight": 0.1}, {"key": "cost", "weight": 0.01}]})
    # w_B 违约金优先。
    b = server.solve_cross_object_occupancy({**common, "objectives": [{"key": "revenue", "weight": 0.1}, {"key": "penalty", "weight": 1.0}, {"key": "cost", "weight": 0.01}]})
    assert a["optimal"] and b["optimal"]
    assert a["occupancy"] == [{"order": "O_hi", "line": "L1"}]    # 营收优先保 O_hi
    assert b["occupancy"] == [{"order": "O_pen", "line": "L1"}]   # 违约优先保 O_pen
    assert a["displaced"] == ["O_pen"] and b["displaced"] == ["O_hi"]  # displaced 变
    # 对拍枚举 = 全局最优（非贪心）。
    va, _ = _brute_cross_object(orders, lines, contracts, elig, {"revenue": 1.0, "penalty": 0.1, "cost": 0.01})
    got_a = 1.0 * a["objectiveValues"]["revenue"] - 0.1 * a["objectiveValues"]["penalty"] - 0.01 * a["objectiveValues"]["cost"]
    assert abs(got_a - va) < 1e-6


def test_cross_object_seam1_revenue_threshold_flips_winner():
    """SEAM-1 续：改一订单 revenue 跨阈 → 最优真换人（displaced 变），非贴标签。"""
    orders, lines, contracts, elig = _cross_fixture()
    common = {"model": "cross_object_occupancy", "seed": 42, "scale": 1, "lines": lines, "contracts": contracts, "eligibility": elig, "method": "weighted",
              "objectives": [{"key": "revenue", "weight": 1.0}, {"key": "penalty", "weight": 1.0}, {"key": "cost", "weight": 0.01}]}
    # 现状：O_hi rev100/pen5，O_pen rev60/pen80 → 合成 O_hi=105 vs O_pen=140 → 排 O_pen。
    before = server.solve_cross_object_occupancy({**common, "orders": orders})
    assert before["occupancy"] == [{"order": "O_pen", "line": "L1"}]
    # 把 O_hi 营收拉到 200 跨阈 → 合成 O_hi=205 > O_pen=140 → 翻转排 O_hi。
    orders2 = [dict(o) for o in orders]
    orders2[0]["revenue"] = 200
    after = server.solve_cross_object_occupancy({**common, "orders": orders2})
    assert after["occupancy"] == [{"order": "O_hi", "line": "L1"}]
    assert before["displaced"] != after["displaced"]  # displaced 真变


def test_cross_object_seam2_capacity_mutex_displaces():
    """SEAM-2 占用互斥真挤占：产线 capacity 调小 → Σqty·x<=cap 生效 → 低价订单被挤（displaced 非空）。"""
    orders = [
        {"id": "O1", "revenue": 100, "penalty": 5, "qty": 5, "contractId": "K1"},
        {"id": "O2", "revenue": 90, "penalty": 5, "qty": 5, "contractId": "K1"},
    ]
    lines = [{"id": "L1", "capacity": 10}]  # 容量足 → 两单都排
    contracts = [{"id": "K1", "cap": 100}]
    elig = [{"order": "O1", "line": "L1", "cost": 1}, {"order": "O2", "line": "L1", "cost": 1}]
    common = {"model": "cross_object_occupancy", "seed": 42, "scale": 1, "orders": orders, "contracts": contracts, "eligibility": elig, "method": "weighted",
              "objectives": [{"key": "revenue", "weight": 1.0}, {"key": "penalty", "weight": 1.0}, {"key": "cost", "weight": 0.01}]}
    full = server.solve_cross_object_occupancy({**common, "lines": lines})
    assert full["displaced"] == []  # 容量足，无挤占
    # 产线 capacity 调小到 5 → 只容一单 → 低营收 O2 被挤。
    tight = server.solve_cross_object_occupancy({**common, "lines": [{"id": "L1", "capacity": 5}]})
    assert tight["displaced"] == ["O2"]  # 低价被挤
    assert tight["objectiveValues"]["penalty"] == 5  # 被挤单违约金入目标


def test_cross_object_contract_cap_binds():
    """三元耦合：合同额度 cap 收紧 → 即便产线容量足，合同额度也限制获排单数（证三元非各自独立）。"""
    orders = [
        {"id": "O1", "revenue": 100, "penalty": 5, "qty": 5, "contractId": "K1"},
        {"id": "O2", "revenue": 90, "penalty": 5, "qty": 5, "contractId": "K1"},
    ]
    lines = [{"id": "L1", "capacity": 100}]  # 产线容量充足
    contracts = [{"id": "K1", "cap": 5}]     # 但合同 K1 额度只够一单（qty5）
    elig = [{"order": "O1", "line": "L1", "cost": 1}, {"order": "O2", "line": "L1", "cost": 1}]
    out = server.solve_cross_object_occupancy({"model": "cross_object_occupancy", "seed": 42, "scale": 1, "orders": orders, "lines": lines, "contracts": contracts, "eligibility": elig, "method": "weighted",
                                               "objectives": [{"key": "revenue", "weight": 1.0}, {"key": "penalty", "weight": 1.0}, {"key": "cost", "weight": 0.01}]})
    assert len(out["occupancy"]) == 1     # 合同额度限制 → 只排一单
    assert out["occupancy"] == [{"order": "O1", "line": "L1"}]  # 保高营收 O1
    assert out["displaced"] == ["O2"]


def test_cross_object_determinism_r6():
    orders, lines, contracts, elig = _cross_fixture()
    p = {"model": "cross_object_occupancy", "seed": 42, "scale": 1, "orders": orders, "lines": lines, "contracts": contracts, "eligibility": elig, "method": "weighted"}
    assert server.solve_cross_object_occupancy(p) == server.solve_cross_object_occupancy(p)
