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


MODELS = {"selection": solve_selection}


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
