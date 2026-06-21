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


MODELS = {"selection": solve_selection, "assignment": solve_assignment}


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
