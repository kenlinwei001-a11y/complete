"""平台自有「最优化引擎」sidecar（内部 REST，零业务名）。

依赖 OR-Tools CP-SAT（Apache-2.0）做**可证最优**的组合决策——TS 贪心/启发式给不出的那部分
「复杂推演」。平台把它封装成自有 API（本服务），datacore 经内部 REST 代理调用，对外只暴露
平台术语的求解器键（如 selection_optimize），不出现外部产品名（CLAUDE.md 命名铁律）。

R6 确定性：固定 random_seed + num_search_workers=1 + **确定性停止条件（不可用挂钟时限）**，
同输入同 seed 同构建 → 同结果。浮点经固定 scale 取整喂给 CP-SAT（整数求解器），回报原尺度合计。

协议（POST /solve）请求：
  { "model": "selection", "seed": 42, "scale": 1000,
    "items": [{"id": str, "value": num, "weight": num}],
    "budget": num, "maxCount": int|null, "minValue": num|null }
响应：
  { "status": "OPTIMAL|FEASIBLE|INFEASIBLE", "optimal": bool,
    "selected": [id...], "totalValue": num, "totalWeight": num }
"""
from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from ortools.sat.python import cp_model


def solve_selection(payload: dict) -> dict:
    """通用 0/1 选择最优化（背包族）：在 Σweight≤budget（及可选 maxCount/minValue）约束下最大化 Σvalue。

    贪心按性价比排序对 0/1 背包**不保证最优**；CP-SAT 给可证最优解——这正是引入它的理由。
    """
    items = payload.get("items") or []
    if not items:
        return {"status": "INFEASIBLE", "optimal": False, "selected": [], "totalValue": 0, "totalWeight": 0}
    seed = int(payload.get("seed", 42))
    scale = int(payload.get("scale", 1000))
    budget = payload.get("budget", 0)
    max_count = payload.get("maxCount")
    min_value = payload.get("minValue")

    def to_int(x: float) -> int:
        return int(round(float(x) * scale))

    ids = [str(it["id"]) for it in items]
    values = [to_int(it.get("value", 0)) for it in items]
    weights = [to_int(it.get("weight", 0)) for it in items]
    cap = to_int(budget)

    model = cp_model.CpModel()
    x = [model.NewBoolVar(f"x{i}") for i in range(len(items))]
    model.Add(sum(weights[i] * x[i] for i in range(len(items))) <= cap)
    if max_count is not None:
        model.Add(sum(x) <= int(max_count))
    if min_value is not None:
        model.Add(sum(values[i] * x[i] for i in range(len(items))) >= to_int(min_value))
    # 主目标：最大化总价值；确定性二级目标：等价值下偏好更轻、更靠前（避免同最优多解抖动）。
    n = len(items)
    big = sum(weights) + 1
    model.Maximize(sum(values[i] * x[i] for i in range(n)) * (big * n) - sum(weights[i] * x[i] for i in range(n)) * n - sum((n - i) * x[i] for i in range(n)))

    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = seed
    # 不设 max_time_in_seconds（挂钟时限会破坏可复现性）；小规模背包确定性求到 OPTIMAL。
    status = solver.Solve(model)

    status_name = {cp_model.OPTIMAL: "OPTIMAL", cp_model.FEASIBLE: "FEASIBLE"}.get(status, "INFEASIBLE")
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {"status": "INFEASIBLE", "optimal": False, "selected": [], "totalValue": 0, "totalWeight": 0}
    chosen = [i for i in range(n) if solver.Value(x[i]) == 1]
    return {
        "status": status_name,
        "optimal": status == cp_model.OPTIMAL,
        "selected": [ids[i] for i in chosen],
        "totalValue": round(sum(float(items[i].get("value", 0)) for i in chosen), 6),
        "totalWeight": round(sum(float(items[i].get("weight", 0)) for i in chosen), 6),
    }


def solve_assignment(payload: dict) -> dict:
    """A8.1 指派最优化：item i 指派到 bin j（x[i,j]∈{0,1}），每 item 恰一指派、Σweight≤cap_j、
    资格 mask（仅给出 cost 的 (i,j) 对可指派）；min Σ cost·x。CP-SAT 可证最优。

    确定性：固定 seed + 单线程 + 二级目标（同成本下偏靠前 item/bin）消除多解抖动。
    """
    items = payload.get("items") or []
    bins = payload.get("bins") or []
    costs = payload.get("costs") or []
    if not items or not bins:
        return {"status": "INFEASIBLE", "optimal": False, "assignments": [], "objective": 0}
    seed = int(payload.get("seed", 42))
    scale = int(payload.get("scale", 1000))

    def to_int(x: float) -> int:
        return int(round(float(x) * scale))

    item_ids = [str(it["id"]) for it in items]
    bin_ids = [str(b["id"]) for b in bins]
    weight = {str(it["id"]): to_int(it.get("weight", 0)) for it in items}
    cap = {str(b["id"]): to_int(b.get("capacity", 0)) for b in bins}
    cost = {(str(c["item"]), str(c["bin"])): to_int(c.get("cost", 0)) for c in costs}

    model = cp_model.CpModel()
    x = {(i, j): model.NewBoolVar(f"x_{i}_{j}") for i in item_ids for j in bin_ids if (i, j) in cost}
    if not x:
        return {"status": "INFEASIBLE", "optimal": False, "assignments": [], "objective": 0}
    # 每 item 恰一指派（仅在有资格对时）。
    for i in item_ids:
        vars_i = [x[(i, j)] for j in bin_ids if (i, j) in x]
        if not vars_i:
            return {"status": "INFEASIBLE", "optimal": False, "assignments": [], "objective": 0}
        model.Add(sum(vars_i) == 1)
    # bin 容量：Σ weight·x ≤ capacity。
    for j in bin_ids:
        model.Add(sum(weight[i] * x[(i, j)] for i in item_ids if (i, j) in x) <= cap[j])
    # 主目标 min Σ cost·x；二级确定性目标：同成本下偏靠前 item/bin（消抖）。
    ni, nj = len(item_ids), len(bin_ids)
    big = ni * nj + 1
    model.Minimize(
        sum(cost[(i, j)] * x[(i, j)] for (i, j) in x) * big
        + sum((item_ids.index(i) * nj + bin_ids.index(j)) * x[(i, j)] for (i, j) in x)
    )

    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = seed
    status = solver.Solve(model)
    status_name = {cp_model.OPTIMAL: "OPTIMAL", cp_model.FEASIBLE: "FEASIBLE"}.get(status, "INFEASIBLE")
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {"status": "INFEASIBLE", "optimal": False, "assignments": [], "objective": 0}
    assignments = [
        {"item": i, "bin": j, "cost": round(cost[(i, j)] / scale, 6)}
        for (i, j) in x
        if solver.Value(x[(i, j)]) == 1
    ]
    assignments.sort(key=lambda a: a["item"])
    return {
        "status": status_name,
        "optimal": status == cp_model.OPTIMAL,
        "assignments": assignments,
        "objective": round(sum(a["cost"] for a in assignments), 6),
    }


def solve_sequencing(payload: dict) -> dict:
    """A8.2 排序最优化：jobs 按 group 排序，最小化相邻 group 切换换型损失。开放路径（用 0 成本虚拟 depot 闭环）。

    确定性：固定 seed + 单线程 + 二级目标（同换型成本下偏字典序）。换型矩阵缺省 = 不同 group 计 1。
    """
    jobs = payload.get("jobs") or []
    if not jobs:
        return {"status": "INFEASIBLE", "optimal": False, "sequence": [], "changeovers": 0, "objective": 0}
    if len(jobs) == 1:
        return {"status": "OPTIMAL", "optimal": True, "sequence": [str(jobs[0]["id"])], "changeovers": 0, "objective": 0}
    seed = int(payload.get("seed", 42))
    scale = int(payload.get("scale", 1000))
    ids = [str(j["id"]) for j in jobs]
    groups = [str(j.get("group", "")) for j in jobs]
    co = {(str(c["from"]), str(c["to"])): int(round(float(c.get("cost", 0)) * scale)) for c in (payload.get("changeover") or [])}

    def cost(a: int, b: int) -> int:
        ga, gb = groups[a], groups[b]
        if (ga, gb) in co:
            return co[(ga, gb)]
        return 0 if ga == gb else scale  # 缺省：不同 group 计 1（×scale）

    n = len(jobs)
    depot = n  # 虚拟节点：到/从任一 job 成本 0 → 开放路径
    model = cp_model.CpModel()
    arcs = []
    lit = {}
    for i in range(n + 1):
        for j in range(n + 1):
            if i == j:
                continue
            v = model.NewBoolVar(f"a_{i}_{j}")
            lit[(i, j)] = v
            arcs.append((i, j, v))
    model.AddCircuit(arcs)
    # 目标：min Σ cost·arc（depot 弧成本 0）+ 二级 tie-break（弧索引消多解抖动）。
    big = (n + 1) * (n + 1) + 1
    obj = []
    for (i, j), v in lit.items():
        c = 0 if (i == depot or j == depot) else cost(i, j)
        obj.append(c * big * v + (i * (n + 1) + j) * v)
    model.Minimize(sum(obj))

    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = seed
    status = solver.Solve(model)
    status_name = {cp_model.OPTIMAL: "OPTIMAL", cp_model.FEASIBLE: "FEASIBLE"}.get(status, "INFEASIBLE")
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {"status": "INFEASIBLE", "optimal": False, "sequence": [], "changeovers": 0, "objective": 0}
    # 从 depot 后继重建开放路径。
    nxt = {i: j for (i, j), v in lit.items() if solver.Value(v) == 1}
    order = []
    cur = nxt[depot]
    while cur != depot:
        order.append(cur)
        cur = nxt[cur]
    changeovers = sum(1 for k in range(len(order) - 1) if groups[order[k]] != groups[order[k + 1]])
    total = sum(cost(order[k], order[k + 1]) for k in range(len(order) - 1)) / scale
    return {
        "status": status_name,
        "optimal": status == cp_model.OPTIMAL,
        "sequence": [ids[i] for i in order],
        "changeovers": changeovers,
        "objective": round(total, 6),
    }


def solve_packing(payload: dict) -> dict:
    """A8.3 装箱最优化：items(size) 装入容量 binCapacity 的 bin，最小化 bin 数（bin-packing）。

    确定性：固定 seed + 单线程 + 二级目标（同 bin 数下偏靠前装箱）。
    """
    items = payload.get("items") or []
    cap_raw = payload.get("binCapacity", 0)
    if not items or float(cap_raw) <= 0:
        return {"status": "INFEASIBLE", "optimal": False, "bins": [], "binCount": 0, "objective": 0}
    seed = int(payload.get("seed", 42))
    scale = int(payload.get("scale", 1000))

    def to_int(x: float) -> int:
        return int(round(float(x) * scale))

    ids = [str(it["id"]) for it in items]
    sizes = [to_int(it.get("size", 0)) for it in items]
    cap = to_int(cap_raw)
    n = len(items)
    max_bins = int(payload.get("maxBins", n))  # 最多 n 个 bin（每 item 独占）
    if any(s > cap for s in sizes):
        return {"status": "INFEASIBLE", "optimal": False, "bins": [], "binCount": 0, "objective": 0}

    model = cp_model.CpModel()
    x = {(i, b): model.NewBoolVar(f"x_{i}_{b}") for i in range(n) for b in range(max_bins)}
    y = [model.NewBoolVar(f"y_{b}") for b in range(max_bins)]
    for i in range(n):
        model.Add(sum(x[(i, b)] for b in range(max_bins)) == 1)  # 每 item 恰一 bin
    for b in range(max_bins):
        model.Add(sum(sizes[i] * x[(i, b)] for i in range(n)) <= cap * y[b])  # 容量 + bin 启用
    # 对称性破除：bin 按序启用（确定性，去等价解）。
    for b in range(max_bins - 1):
        model.Add(y[b] >= y[b + 1])
    big = n * max_bins + 1
    model.Minimize(sum(y) * big + sum((i * max_bins + b) * x[(i, b)] for i in range(n) for b in range(max_bins)))

    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = seed
    status = solver.Solve(model)
    status_name = {cp_model.OPTIMAL: "OPTIMAL", cp_model.FEASIBLE: "FEASIBLE"}.get(status, "INFEASIBLE")
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {"status": "INFEASIBLE", "optimal": False, "bins": [], "binCount": 0, "objective": 0}
    bins = []
    for b in range(max_bins):
        if solver.Value(y[b]) != 1:
            continue
        members = [i for i in range(n) if solver.Value(x[(i, b)]) == 1]
        if not members:
            continue
        bins.append({"items": [ids[i] for i in members], "load": round(sum(float(items[i].get("size", 0)) for i in members), 6)})
    return {
        "status": status_name,
        "optimal": status == cp_model.OPTIMAL,
        "bins": bins,
        "binCount": len(bins),
        "objective": len(bins),
    }


def solve_facility_location(payload: dict) -> dict:
    """轨B·增量1 选址最优化（uncapacitated/capacitated facility location）：在候选设施集中选开哪些
    （开设成本 openCost），把每个需求点指派到一个开着的设施（指派成本 assignCost），min Σ开设 + Σ指派。
    可选 capacity（设施容量）+ demand（需求量）→ capacitated。CP-SAT 可证最优（贪心给不出）。

    抽象/零业务常数（R14）：facilities/clients/costs 全由绑定层从本体类型化字段填，引擎只认数值。
    确定性 R6：固定 seed + 单线程 + 二级目标（同成本下偏靠前设施/需求点）消多解抖动。
    协议：{facilities:[{id,openCost,capacity?}], clients:[{id,demand?}],
           assignCosts:[{client,facility,cost}], seed?, scale?}。
    """
    facilities = payload.get("facilities") or []
    clients = payload.get("clients") or []
    assign_costs = payload.get("assignCosts") or []
    if not facilities or not clients:
        return {"status": "INFEASIBLE", "optimal": False, "openFacilities": [], "assignments": [], "objective": 0}
    seed = int(payload.get("seed", 42))
    scale = int(payload.get("scale", 1000))

    def to_int(x: float) -> int:
        return int(round(float(x) * scale))

    fac_ids = [str(f["id"]) for f in facilities]
    cli_ids = [str(c["id"]) for c in clients]
    open_cost = {str(f["id"]): to_int(f.get("openCost", 0)) for f in facilities}
    cap = {str(f["id"]): (to_int(f["capacity"]) if f.get("capacity") is not None else None) for f in facilities}
    demand = {str(c["id"]): to_int(c.get("demand", 0)) for c in clients}
    a_cost = {(str(c["client"]), str(c["facility"])): to_int(c.get("cost", 0)) for c in assign_costs}

    model = cp_model.CpModel()
    y = {j: model.NewBoolVar(f"y_{j}") for j in fac_ids}  # 设施开/关
    x = {(i, j): model.NewBoolVar(f"x_{i}_{j}") for i in cli_ids for j in fac_ids if (i, j) in a_cost}
    if not x:
        return {"status": "INFEASIBLE", "optimal": False, "openFacilities": [], "assignments": [], "objective": 0}
    for i in cli_ids:
        vars_i = [x[(i, j)] for j in fac_ids if (i, j) in x]
        if not vars_i:
            return {"status": "INFEASIBLE", "optimal": False, "openFacilities": [], "assignments": [], "objective": 0}
        model.Add(sum(vars_i) == 1)  # 每需求点恰一指派
    for (i, j), v in x.items():
        model.Add(v <= y[j])  # 只能指派到开着的设施
    for j in fac_ids:
        if cap[j] is not None:
            model.Add(sum(demand[i] * x[(i, j)] for i in cli_ids if (i, j) in x) <= cap[j] * y[j])  # 容量
    ni, nj = len(cli_ids), len(fac_ids)
    big = (ni * nj + nj) + 1
    model.Minimize(
        (sum(open_cost[j] * y[j] for j in fac_ids) + sum(a_cost[(i, j)] * x[(i, j)] for (i, j) in x)) * big
        + sum(fac_ids.index(j) * y[j] for j in fac_ids)
        + sum((cli_ids.index(i) * nj + fac_ids.index(j)) * x[(i, j)] for (i, j) in x)
    )
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = seed
    status = solver.Solve(model)
    status_name = {cp_model.OPTIMAL: "OPTIMAL", cp_model.FEASIBLE: "FEASIBLE"}.get(status, "INFEASIBLE")
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {"status": "INFEASIBLE", "optimal": False, "openFacilities": [], "assignments": [], "objective": 0}
    open_fac = sorted(j for j in fac_ids if solver.Value(y[j]) == 1)
    assigns = sorted(
        ({"client": i, "facility": j} for (i, j) in x if solver.Value(x[(i, j)]) == 1),
        key=lambda a: a["client"],
    )
    obj = (sum(open_cost[j] for j in open_fac) + sum(a_cost[(a["client"], a["facility"])] for a in assigns)) / scale
    return {
        "status": status_name,
        "optimal": status == cp_model.OPTIMAL,
        "openFacilities": open_fac,
        "assignments": assigns,
        "objective": round(obj, 6),
    }


def solve_min_cost_flow(payload: dict) -> dict:
    """轨B·增量1 最小成本流（single-commodity min-cost flow）：节点有 supply（>0 源 / <0 汇），
    弧有单位成本 cost 与容量 cap，求满足供需平衡、不超容、总成本最小的流。CP-SAT（整数流）可证最优。

    抽象/零业务常数（R14）：nodes/arcs 全由绑定层从本体填。确定性 R6：固定 seed + 单线程 + 二级目标。
    协议：{nodes:[{id,supply}], arcs:[{from,to,cost,cap?}], seed?, scale?}。供需须平衡（Σsupply=0）。
    """
    nodes = payload.get("nodes") or []
    arcs = payload.get("arcs") or []
    if not nodes or not arcs:
        return {"status": "INFEASIBLE", "optimal": False, "flows": [], "objective": 0}
    seed = int(payload.get("seed", 42))
    scale = int(payload.get("scale", 1000))

    def to_int(x: float) -> int:
        return int(round(float(x) * scale))

    node_ids = [str(n["id"]) for n in nodes]
    supply = {str(n["id"]): to_int(n.get("supply", 0)) for n in nodes}
    if sum(supply.values()) != 0:
        return {"status": "INFEASIBLE", "optimal": False, "flows": [], "objective": 0, "reason": "supply/demand imbalance"}
    total_supply = sum(s for s in supply.values() if s > 0)

    model = cp_model.CpModel()
    f = {}
    for k, a in enumerate(arcs):
        hi = to_int(a["cap"]) if a.get("cap") is not None else total_supply
        f[k] = model.NewIntVar(0, max(hi, 0), f"f_{k}")
    # 流守恒：每节点 出 - 入 = supply。
    for nid in node_ids:
        out_flow = sum(f[k] for k, a in enumerate(arcs) if str(a["from"]) == nid)
        in_flow = sum(f[k] for k, a in enumerate(arcs) if str(a["to"]) == nid)
        model.Add(out_flow - in_flow == supply[nid])
    big = len(arcs) + 1
    cost_term = sum(to_int(arcs[k].get("cost", 0)) * f[k] for k in range(len(arcs)))
    model.Minimize(cost_term * big + sum(k * f[k] for k in range(len(arcs))))
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = seed
    status = solver.Solve(model)
    status_name = {cp_model.OPTIMAL: "OPTIMAL", cp_model.FEASIBLE: "FEASIBLE"}.get(status, "INFEASIBLE")
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {"status": "INFEASIBLE", "optimal": False, "flows": [], "objective": 0}
    flows = [
        {"from": str(arcs[k]["from"]), "to": str(arcs[k]["to"]), "flow": round(solver.Value(f[k]) / scale, 6)}
        for k in range(len(arcs))
        if solver.Value(f[k]) > 0
    ]
    flows.sort(key=lambda x: (x["from"], x["to"]))
    obj = sum(float(arcs[k].get("cost", 0)) * (solver.Value(f[k]) / scale) for k in range(len(arcs)))
    return {"status": status_name, "optimal": status == cp_model.OPTIMAL, "flows": flows, "objective": round(obj, 6)}


def solve_set_cover(payload: dict) -> dict:
    """轨B·增量1 集合覆盖（weighted set cover）：选最少（或最小总成本）的集合，使所有元素被覆盖。
    CP-SAT 可证最优（贪心 ln n 近似给不出最优）。

    抽象/零业务常数（R14）：sets/elements 全由绑定层填。确定性 R6：固定 seed + 单线程 + 二级目标。
    协议：{sets:[{id,cost?,covers:[elemId...]}], universe:[elemId...]?, seed?, scale?}。
    universe 缺省 = 所有 set 覆盖元素之并。
    """
    sets = payload.get("sets") or []
    if not sets:
        return {"status": "INFEASIBLE", "optimal": False, "chosen": [], "objective": 0}
    seed = int(payload.get("seed", 42))
    scale = int(payload.get("scale", 1000))

    def to_int(x: float) -> int:
        return int(round(float(x) * scale))

    set_ids = [str(s["id"]) for s in sets]
    covers = {str(s["id"]): set(str(e) for e in (s.get("covers") or [])) for s in sets}
    cost = {str(s["id"]): (to_int(s["cost"]) if s.get("cost") is not None else scale) for s in sets}  # 缺省每集合成本=1
    universe = set(str(e) for e in (payload.get("universe") or []))
    if not universe:
        for c in covers.values():
            universe |= c
    if not universe:
        return {"status": "OPTIMAL", "optimal": True, "chosen": [], "objective": 0}

    model = cp_model.CpModel()
    z = {sid: model.NewBoolVar(f"z_{sid}") for sid in set_ids}
    for e in universe:
        covering = [z[sid] for sid in set_ids if e in covers[sid]]
        if not covering:
            return {"status": "INFEASIBLE", "optimal": False, "chosen": [], "objective": 0, "reason": f"element {e} uncoverable"}
        model.Add(sum(covering) >= 1)
    big = len(set_ids) + 1
    model.Minimize(sum(cost[sid] * z[sid] for sid in set_ids) * big + sum(set_ids.index(sid) * z[sid] for sid in set_ids))
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = seed
    status = solver.Solve(model)
    status_name = {cp_model.OPTIMAL: "OPTIMAL", cp_model.FEASIBLE: "FEASIBLE"}.get(status, "INFEASIBLE")
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {"status": "INFEASIBLE", "optimal": False, "chosen": [], "objective": 0}
    chosen = sorted(sid for sid in set_ids if solver.Value(z[sid]) == 1)
    obj = sum(cost[sid] for sid in chosen) / scale
    return {"status": status_name, "optimal": status == cp_model.OPTIMAL, "chosen": chosen, "objective": round(obj, 6)}


def solve_independent_set(payload: dict) -> dict:
    """轨B·增量1 最大权独立集（maximum weight independent set）：在图中选一组两两不相邻的节点，
    使总权重最大（冲突约束：相邻不可同选）。CP-SAT 可证最优（NP-hard，贪心给不出）。

    抽象/零业务常数（R14）：nodes/edges 全由绑定层填（如不可同时执行的项目/不相容的排班）。
    确定性 R6：固定 seed + 单线程 + 二级目标。协议：{nodes:[{id,weight?}], edges:[{a,b}], seed?, scale?}。
    """
    nodes = payload.get("nodes") or []
    edges = payload.get("edges") or []
    if not nodes:
        return {"status": "INFEASIBLE", "optimal": False, "chosen": [], "objective": 0}
    seed = int(payload.get("seed", 42))
    scale = int(payload.get("scale", 1000))

    def to_int(x: float) -> int:
        return int(round(float(x) * scale))

    node_ids = [str(n["id"]) for n in nodes]
    weight = {str(n["id"]): (to_int(n["weight"]) if n.get("weight") is not None else scale) for n in nodes}
    model = cp_model.CpModel()
    s = {nid: model.NewBoolVar(f"s_{nid}") for nid in node_ids}
    for e in edges:
        a, b = str(e["a"]), str(e["b"])
        if a in s and b in s and a != b:
            model.Add(s[a] + s[b] <= 1)  # 相邻不可同选
    big = len(node_ids) + 1
    model.Maximize(sum(weight[nid] * s[nid] for nid in node_ids) * big - sum(node_ids.index(nid) * s[nid] for nid in node_ids))
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = seed
    status = solver.Solve(model)
    status_name = {cp_model.OPTIMAL: "OPTIMAL", cp_model.FEASIBLE: "FEASIBLE"}.get(status, "INFEASIBLE")
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {"status": "INFEASIBLE", "optimal": False, "chosen": [], "objective": 0}
    chosen = sorted(nid for nid in node_ids if solver.Value(s[nid]) == 1)
    obj = sum(weight[nid] for nid in chosen) / scale
    return {"status": status_name, "optimal": status == cp_model.OPTIMAL, "chosen": chosen, "objective": round(obj, 6)}


def solve_combinatorial_auction(payload: dict) -> dict:
    """轨B·增量1 组合拍卖赢者裁定（winner determination, WDP）：投标者对物品「打包」出价（bundle bid），
    选一组互不冲突（不共享任何物品）的中标包，使总收益最大。CP-SAT 可证最优（NP-hard）。

    抽象/零业务常数（R14）：bids/items 全由绑定层填。确定性 R6：固定 seed + 单线程 + 二级目标。
    协议：{bids:[{id,value,items:[itemId...]}], seed?, scale?}。每物品至多被一个中标包占用。
    """
    bids = payload.get("bids") or []
    if not bids:
        return {"status": "OPTIMAL", "optimal": True, "winners": [], "objective": 0}
    seed = int(payload.get("seed", 42))
    scale = int(payload.get("scale", 1000))

    def to_int(x: float) -> int:
        return int(round(float(x) * scale))

    bid_ids = [str(b["id"]) for b in bids]
    value = {str(b["id"]): to_int(b.get("value", 0)) for b in bids}
    items_of = {str(b["id"]): set(str(it) for it in (b.get("items") or [])) for b in bids}
    all_items = set()
    for s in items_of.values():
        all_items |= s

    model = cp_model.CpModel()
    w = {bid: model.NewBoolVar(f"w_{bid}") for bid in bid_ids}
    for it in all_items:
        conflicting = [w[bid] for bid in bid_ids if it in items_of[bid]]
        if len(conflicting) > 1:
            model.Add(sum(conflicting) <= 1)  # 每物品至多一个中标包
    big = len(bid_ids) + 1
    model.Maximize(sum(value[bid] * w[bid] for bid in bid_ids) * big - sum(bid_ids.index(bid) * w[bid] for bid in bid_ids))
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = seed
    status = solver.Solve(model)
    status_name = {cp_model.OPTIMAL: "OPTIMAL", cp_model.FEASIBLE: "FEASIBLE"}.get(status, "INFEASIBLE")
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {"status": "INFEASIBLE", "optimal": False, "winners": [], "objective": 0}
    winners = sorted(bid for bid in bid_ids if solver.Value(w[bid]) == 1)
    obj = sum(value[bid] for bid in winners) / scale
    return {"status": status_name, "optimal": status == cp_model.OPTIMAL, "winners": winners, "objective": round(obj, 6)}


# ── WO-CROSS-OBJECT-MULTIOBJ 多目标 + 跨对象占用（加权/ε-约束/字典序） ──────────────
# 病根修：既有 9 模型每个单一 Maximize/Minimize（`*big`+tie-break 只是消抖非多目标），
# 表达不了「营收↑且违约金↓且换型↓」的冲突权衡。这里加通用多目标合成引擎 + 跨对象三元占用模型。
# 照抄确定性红线：num_search_workers=1 + random_seed + 不设挂钟时限 + to_int(scale) + 二级 tie-break。

_WEIGHT_SCALE = 1000  # 权重定点化（支持小数权重，如 0.7/0.3）。


def _new_solver(seed: int) -> "cp_model.CpSolver":
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = seed
    # 不设 max_time_in_seconds（挂钟时限破坏可复现性 R6）。
    return solver


def _expr(terms, const=0):
    """把 [(coef_int, var)] + 常量 → CP-SAT 线性表达式。"""
    e = const
    for c, v in terms:
        e = e + c * v
    return e


def _eval(terms, solver, const=0) -> int:
    """在已解模型上求某目标表达式的整数值（用于分目标回报/字典序钉值）。"""
    return const + sum(c * solver.Value(v) for c, v in terms)


def _optimize_multi(model, objectives, method, *, seed, big, tiebreak, epsilon=None, priority=None):
    """通用多目标求解引擎（三 method）。

    objectives: [{key, sense:'max'|'min', terms:[(coef_int,var)], const:int}]（terms/const 均已 scale 定点化）。
    method:
      - weighted:  各目标按 weight 归一线性合成单 Maximize（min 取负），tie-break 消抖。
      - epsilon:   主目标(objectives[0])为目标，其余转 ε-约束（epsilon[{key,bound}] 给界）。
      - lexicographic: 按 priority(或声明序)逐目标多轮 Solve——先求目标1最优、钉为等式约束，再求目标2…（seed 固定 R6）。
    返回 (status, solver)。tie-break：`总目标*big - Σ(k+1)*var`（big 大于 tie-break 上界，不影响真最优）。
    """
    by_key = {o["key"]: o for o in objectives}

    def sense_sign(o):
        return 1 if o["sense"] == "max" else -1

    if method == "lexicographic":
        order = priority or [o["key"] for o in objectives]
        solver = None
        for key in order:
            o = by_key[key]
            model.Maximize(sense_sign(o) * _expr(o["terms"], o.get("const", 0)) * big - tiebreak)
            solver = _new_solver(seed)
            status = solver.Solve(model)
            if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                return status, solver
            # 钉住本目标最优值为等式约束（后续目标在此约束下再求），确定性逐级收敛。
            v = _eval(o["terms"], solver, o.get("const", 0))
            model.Add(_expr(o["terms"], o.get("const", 0)) == v)
        return cp_model.OPTIMAL, solver

    if method == "epsilon":
        primary = objectives[0]
        bounds = {e["key"]: e["bound"] for e in (epsilon or [])}
        for o in objectives[1:]:
            if o["key"] not in bounds:
                continue
            b = int(bounds[o["key"]])  # bound 已按 scale 传入定点值
            e = _expr(o["terms"], o.get("const", 0))
            if o["sense"] == "max":
                model.Add(e >= b)   # 次目标须不低于 ε 下界
            else:
                model.Add(e <= b)   # 次目标须不高于 ε 上界
        model.Maximize(sense_sign(primary) * _expr(primary["terms"], primary.get("const", 0)) * big - tiebreak)
        solver = _new_solver(seed)
        status = solver.Solve(model)
        return status, solver

    # weighted（默认）：Σ sign·weight·目标 → 单 Maximize。
    combined = 0
    for o in objectives:
        w = int(round(float(o.get("weight", 1.0)) * _WEIGHT_SCALE))
        combined = combined + sense_sign(o) * w * _expr(o["terms"], o.get("const", 0))
    model.Maximize(combined * big - tiebreak)
    solver = _new_solver(seed)
    status = solver.Solve(model)
    return status, solver


def solve_multi_objective(payload: dict) -> dict:
    """多目标最优化（加权/ε-约束/字典序）·零业务名 R14。

    协议：{model:"multi_objective", seed, scale,
           vars:[{id, kind:"bool"|"int", lo?, hi?}],
           constraints:[{terms:[{var,coef}], op:"<="|">="|"==", rhs}],
           objectives:[{key, sense:"max"|"min", terms:[{var,coef}], weight?}],
           method:"weighted"|"epsilon"|"lexicographic",
           epsilon?:[{key,bound}], priority?:[key...]}
    返回：{status, optimal, values:{varId:val}, objectiveValues:{key:val}, method}
    （每目标值分别回报 → 前端 Δ 分解用）。可对小规模枚举全解对拍验证 = 全局最优。
    """
    var_specs = payload.get("vars") or []
    if not var_specs:
        return {"status": "INFEASIBLE", "optimal": False, "values": {}, "objectiveValues": {}, "method": payload.get("method", "weighted")}
    seed = int(payload.get("seed", 42))
    scale = int(payload.get("scale", 1000))
    method = payload.get("method", "weighted")

    def to_int(x) -> int:
        return int(round(float(x) * scale))

    model = cp_model.CpModel()
    varmap = {}
    order = []  # 稳定 tie-break 顺序
    for spec in var_specs:
        vid = str(spec["id"])
        kind = spec.get("kind", "bool")
        if kind == "bool":
            varmap[vid] = model.NewBoolVar(f"v_{vid}")
        else:
            lo = int(spec.get("lo", 0))
            hi = int(spec.get("hi", 1))
            varmap[vid] = model.NewIntVar(lo, hi, f"v_{vid}")
        order.append(vid)

    for c in payload.get("constraints") or []:
        terms = [(to_int(t.get("coef", 0)), varmap[str(t["var"])]) for t in (c.get("terms") or []) if str(t["var"]) in varmap]
        rhs = to_int(c.get("rhs", 0))
        op = c.get("op", "<=")
        expr = _expr(terms)
        if op == "<=":
            model.Add(expr <= rhs)
        elif op == ">=":
            model.Add(expr >= rhs)
        else:
            model.Add(expr == rhs)

    objectives = []
    for o in payload.get("objectives") or []:
        terms = [(to_int(t.get("coef", 0)), varmap[str(t["var"])]) for t in (o.get("terms") or []) if str(t["var"]) in varmap]
        objectives.append({"key": str(o["key"]), "sense": o.get("sense", "max"), "terms": terms, "const": 0, "weight": o.get("weight", 1.0)})
    if not objectives:
        return {"status": "INFEASIBLE", "optimal": False, "values": {}, "objectiveValues": {}, "method": method}

    # tie-break：Σ(k+1)·var（稳定序），big 大于其上界 → 不影响真最优，仅消多解抖动（R6）。
    tb_terms = []
    tb_max = 0
    for k, vid in enumerate(order):
        v = varmap[vid]
        hi = 1 if var_specs[k].get("kind", "bool") == "bool" else int(var_specs[k].get("hi", 1))
        tb_terms.append(((k + 1), v))
        tb_max += (k + 1) * max(hi, 0)
    tiebreak = _expr(tb_terms)
    big = tb_max + 1

    epsilon = payload.get("epsilon")
    if epsilon:
        epsilon = [{"key": e["key"], "bound": to_int(e["bound"])} for e in epsilon]
    status, solver = _optimize_multi(model, objectives, method, seed=seed, big=big, tiebreak=tiebreak, epsilon=epsilon, priority=payload.get("priority"))

    status_name = {cp_model.OPTIMAL: "OPTIMAL", cp_model.FEASIBLE: "FEASIBLE"}.get(status, "INFEASIBLE")
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {"status": "INFEASIBLE", "optimal": False, "values": {}, "objectiveValues": {}, "method": method}
    values = {vid: int(solver.Value(varmap[vid])) for vid in order}
    objective_values = {o["key"]: round(_eval(o["terms"], solver, o.get("const", 0)) / scale, 6) for o in objectives}
    return {
        "status": status_name,
        "optimal": status == cp_model.OPTIMAL,
        "values": values,
        "objectiveValues": objective_values,
        "method": method,
    }


def solve_cross_object_occupancy(payload: dict) -> dict:
    """跨对象占用最优化（订单×产线×合同 三元互斥）·零业务名 R14。

    协议：{model:"cross_object_occupancy", seed, scale,
           orders:[{id, revenue, penalty, contractId, qty}],
           lines:[{id, capacity}], contracts:[{id, cap}],
           eligibility:[{order, line, cost}],
           objectives?:[{key:"revenue"|"penalty"|"cost", weight?}], method?, epsilon?, priority?}
    变量 x[o,l]∈{0,1} + served[o]∈{0,1}。约束：
      · 每订单至多一线      Σ_l x[o,l] == served[o]
      · 产线占用互斥        Σ_o qty·x[o,l] <= capacity[l]
      · 合同额度            Σ_{o∈c} qty·served[o] <= cap[c]
    目标 max Σserved·revenue − Σ(1−served)·penalty − Σx·cost（拆 3 目标走 weighted/epsilon/lexicographic）。
    返回含 occupancy/displaced(被挤订单)/objectiveValues/summary。
    """
    orders = payload.get("orders") or []
    lines = payload.get("lines") or []
    contracts = payload.get("contracts") or []
    eligibility = payload.get("eligibility") or []
    if not orders or not lines:
        return {"status": "INFEASIBLE", "optimal": False, "values": {}, "objectiveValues": {}, "occupancy": [], "displaced": [], "summary": "missing orders or lines"}
    seed = int(payload.get("seed", 42))
    scale = int(payload.get("scale", 1000))
    method = payload.get("method", "weighted")

    def to_int(x) -> int:
        return int(round(float(x) * scale))

    order_ids = [str(o["id"]) for o in orders]
    revenue = {str(o["id"]): to_int(o.get("revenue", 0)) for o in orders}
    penalty = {str(o["id"]): to_int(o.get("penalty", 0)) for o in orders}
    qty = {str(o["id"]): to_int(o.get("qty", 0)) for o in orders}
    contract_of = {str(o["id"]): (str(o["contractId"]) if o.get("contractId") is not None else None) for o in orders}
    line_ids = [str(l["id"]) for l in lines]
    capacity = {str(l["id"]): to_int(l.get("capacity", 0)) for l in lines}
    cap_of = {str(c["id"]): to_int(c.get("cap", 0)) for c in contracts}
    elig_cost = {(str(e["order"]), str(e["line"])): to_int(e.get("cost", 0)) for e in eligibility}

    model = cp_model.CpModel()
    x = {(o, l): model.NewBoolVar(f"x_{o}_{l}") for (o, l) in elig_cost}
    served = {o: model.NewBoolVar(f"s_{o}") for o in order_ids}

    # 每订单至多一线：Σ_l x[o,l] == served[o]（无资格线的订单 served 强制 0）。
    for o in order_ids:
        xs = [x[(o, l)] for l in line_ids if (o, l) in x]
        if xs:
            model.Add(sum(xs) == served[o])
        else:
            model.Add(served[o] == 0)
    # 产线占用互斥：Σ_o qty·x[o,l] <= capacity[l]。
    for l in line_ids:
        model.Add(sum(qty[o] * x[(o, l)] for o in order_ids if (o, l) in x) <= capacity[l])
    # 合同额度：Σ_{o∈c} qty·served[o] <= cap[c]。
    for c, cap in cap_of.items():
        members = [o for o in order_ids if contract_of[o] == c]
        if members:
            model.Add(sum(qty[o] * served[o] for o in members) <= cap)

    # 三目标（terms 已 scale 定点化；const 供违约金常量项）。
    rev_terms = [(revenue[o], served[o]) for o in order_ids]
    # 违约金 = Σ penalty[o]·(1−served) = Σpenalty − Σ penalty·served。
    pen_terms = [(-penalty[o], served[o]) for o in order_ids]
    pen_const = sum(penalty[o] for o in order_ids)
    cost_terms = [(elig_cost[(o, l)], x[(o, l)]) for (o, l) in x]

    weights = {"revenue": 1.0, "penalty": 1.0, "cost": 1.0}
    for ob in payload.get("objectives") or []:
        weights[str(ob["key"])] = ob.get("weight", 1.0)
    objectives = [
        {"key": "revenue", "sense": "max", "terms": rev_terms, "const": 0, "weight": weights["revenue"]},
        {"key": "penalty", "sense": "min", "terms": pen_terms, "const": pen_const, "weight": weights["penalty"]},
        {"key": "cost", "sense": "min", "terms": cost_terms, "const": 0, "weight": weights["cost"]},
    ]

    # tie-break：稳定序 served 后接 x（消多解抖动 R6）。
    tb_terms = []
    idx = 1
    for o in order_ids:
        tb_terms.append((idx, served[o]))
        idx += 1
    for (o, l) in sorted(x.keys()):
        tb_terms.append((idx, x[(o, l)]))
        idx += 1
    tiebreak = _expr(tb_terms)
    big = idx + 1

    epsilon = payload.get("epsilon")
    if epsilon:
        epsilon = [{"key": e["key"], "bound": to_int(e["bound"])} for e in epsilon]
    status, solver = _optimize_multi(model, objectives, method, seed=seed, big=big, tiebreak=tiebreak, epsilon=epsilon, priority=payload.get("priority"))

    status_name = {cp_model.OPTIMAL: "OPTIMAL", cp_model.FEASIBLE: "FEASIBLE"}.get(status, "INFEASIBLE")
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {"status": "INFEASIBLE", "optimal": False, "values": {}, "objectiveValues": {}, "occupancy": [], "displaced": [], "summary": "不可行"}

    occupancy = sorted(
        ({"order": o, "line": l} for (o, l) in x if solver.Value(x[(o, l)]) == 1),
        key=lambda a: (a["order"], a["line"]),
    )
    displaced = sorted(o for o in order_ids if solver.Value(served[o]) == 0)
    values = {o: int(solver.Value(served[o])) for o in order_ids}
    for (o, l) in x:
        values[f"x_{o}_{l}"] = int(solver.Value(x[(o, l)]))
    objective_values = {ob["key"]: round(_eval(ob["terms"], solver, ob.get("const", 0)) / scale, 6) for ob in objectives}
    served_count = len(order_ids) - len(displaced)
    return {
        "status": status_name,
        "optimal": status == cp_model.OPTIMAL,
        "values": values,
        "objectiveValues": objective_values,
        "occupancy": occupancy,
        "displaced": displaced,
        "method": method,
        "summary": (
            f"占用：{served_count}/{len(order_ids)} 单获排（占 {len(line_ids)} 线），"
            f"被挤 {len(displaced)} 单；营收 {objective_values['revenue']}、违约金 {objective_values['penalty']}、换型成本 {objective_values['cost']}"
            f"（{'可证最优' if status == cp_model.OPTIMAL else '可行解'}）"
        ),
    }


MODELS = {
    "selection": solve_selection,
    "assignment": solve_assignment,
    "sequencing": solve_sequencing,
    "packing": solve_packing,
    # 轨B·增量1 5 CP-SAT 核心（抽象优化模板池 OptModelTemplate 的引擎侧实现，零业务常数 R14）。
    "facility_location": solve_facility_location,
    "min_cost_flow": solve_min_cost_flow,
    "set_cover": solve_set_cover,
    "independent_set": solve_independent_set,
    "combinatorial_auction": solve_combinatorial_auction,
    # WO-CROSS-OBJECT-MULTIOBJ 多目标（加权/ε-约束/字典序）+ 跨对象占用（订单×产线×合同三元互斥）。
    "multi_objective": solve_multi_objective,
    "cross_object_occupancy": solve_cross_object_occupancy,
}


def dispatch(payload: dict) -> dict:
    model = payload.get("model", "selection")
    fn = MODELS.get(model)
    if fn is None:
        raise ValueError(f"unknown model: {model}")
    return fn(payload)


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: dict) -> None:
        raw = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/healthz":
            self._send(200, {"status": "ok", "engine": "cp-sat"})
        else:
            self._send(404, {"error": {"code": "NOT_FOUND", "message": self.path}})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/solve":
            self._send(404, {"error": {"code": "NOT_FOUND", "message": self.path}})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length) or b"{}")
            self._send(200, dispatch(payload))
        except ValueError as exc:
            self._send(400, {"error": {"code": "VALIDATION", "message": str(exc)}})
        except Exception as exc:  # noqa: BLE001
            self._send(500, {"error": {"code": "SOLVE_ERROR", "message": str(exc)}})

    def log_message(self, *args) -> None:  # 静默默认 stderr 噪声
        return


def main() -> None:
    import os

    port = int(os.environ.get("PORT", "4003"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"[optimizer] CP-SAT sidecar listening on :{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
