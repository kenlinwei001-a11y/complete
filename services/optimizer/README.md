# 最优化引擎 sidecar（CP-SAT，平台自有 API）

为什么存在：图遍历/聚合类推演平台用净室 TS 就能确定性解（见 27 个内置求解器）；但**组合最优化**
（排产/分配/选址/措施组合——0/1 背包、装箱、排序冲突等 NP 难问题）贪心/启发式**不保证最优**。
本 sidecar 引入 **OR-Tools CP-SAT** 给可证最优解，datacore 经内部 REST 代理调用，对外只暴露
平台术语的求解器键（如 `selection_optimize`）。

## 开源采用合规（4 闸）

- **许可证**：OR-Tools = Apache-2.0。依赖以 pip 引入（`requirements.txt`），版权/许可证随包保留，
  **不复制其源码、不剥离版权**；平台 UI / 标识符 / 求解器键**不出现外部产品名**（CLAUDE.md 命名铁律）。
- **R6 确定性**：固定 `random_seed` + `num_search_workers=1` + **确定性停止条件（绝不用挂钟时限）**；
  同 seed 同构建同输入 → 同结果（见 `test_optimizer.py::test_determinism_r6_same_seed_byte_identical`）。
- **R11 输出形状**：响应形状固定（status/optimal/selected/totalValue/totalWeight），datacore 侧声明。
- **R13 审计 + 供应链**：无状态、无业务数据落盘；仅内部网络可达，非公网。镜像 `python:3.11-slim` + 单一 pip 依赖。

## 协议

`GET /healthz` → `{"status":"ok","engine":"cp-sat"}`

`POST /solve`
```json
{ "model": "selection", "seed": 42, "scale": 1000,
  "items": [{"id": "A", "value": 60, "weight": 6}],
  "budget": 10, "maxCount": null, "minValue": null }
```
→
```json
{ "status": "OPTIMAL", "optimal": true, "selected": ["B","C"],
  "totalValue": 100, "totalWeight": 10 }
```

`model: "selection"` = 通用 0/1 选择最优化（背包族）：Σweight≤budget（及可选 maxCount/minValue）下最大化 Σvalue。
后续模型（assignment / sequencing / packing）按需加入 `MODELS` 注册表。

## 本地运行 / 测试

```bash
pip install -r requirements.txt
PORT=4003 python3 server.py          # 起服务
python3 -m pytest test_optimizer.py -q   # 真求解测试（需 ortools）
```

datacore 经环境变量 `OPTIMIZER_BASE_URL`（如 `http://optimizer:4003`）发现本服务；未配置时
`selection_optimize` 求解器报「引擎未接入」错误（不静默兜底）。

## optimize_whatif 前端消费面（WO-OPTIMIZE-WHATIF-FE）

优化推演页 `/v/optimize-whatif`（frontend-shell·入口：驾驶舱「优化推演（Δ目标）」按钮）调
`POST /a/v1/solvers/optimize_whatif/invoke {args:{family,args|binding,perturbations,seed}}`：选 family（5 CP-SAT
核心之一）+ 编辑扰动（改目标/约束）→ 经本 sidecar 对基线与扰动各求一次最优 → 渲 **baseline→perturbed 的 Δ目标** +
`feasible` 徽标 + `conflictConstraints` 列表 + `explanation`。

- **本地 dev**：`OPTIMIZER_BASE_URL` 未配 → 后端返「未接入最优化引擎」→ 前端**诚实提示**（不假渲 Δ）。本地起 sidecar
  见 `DEPLOY.md` §6.x。
- **SEAM（KILL-MOCK）**：改扰动（如 `perturbations[0].delta` 50→600）→ 真 CP-SAT 重解 → `deltaObjective` /
  `feasible` / `conflictConstraints` 随之真变（前端 MSW mock 仅测渲染逻辑·真解须打到本 `server.py`）。
