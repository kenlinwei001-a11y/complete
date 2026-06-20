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
