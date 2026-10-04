# WO-COSTPRESSURE-IDENTITY · 预言（**取数之前**写下，⛔ 不许事后回填）

base commit：`c390a0a4de3d29999645d5afc6a25cc8b48825d3`
预言时刻：2026-10-04T16:23:55Z

## 判据 1（铁律 1.5 判据一 · 对照实验）

**预言 P1**：tick0、零扰动、不推任何一拍 ⇒ `finance_world_projection` 的
`lines[role=MARGIN].projected` **必须 ==** `lines[role=MARGIN].rolling`（**118.9**），误差 0。

**预言 P2**：同理 `lines[role=COST].projected == lines[role=COST].rolling`（**720.72**）。

**今天实测（修前）**：`COST 720.72`（+139.62）、`MARGIN −20.72`（−139.62）。
即 **P1/P2 今天为假**，且偏差 139.62 亿的 **100% 来自 `costAgg.value ÷ 100` 这一项**。

**预言的机制**：`costAgg.value`（按 `qty×unitPrice` 加权的 `Order.costPressure`）
在零扰动下必须 == `Order.costPressure` 的声明域静息点 = **0**（压力族 `restPoint = 0`）。
今天它 == 24.03（= 信用占用率 ×100 的加权平均），故 `costFactor = 1.2403`，
`720.72 × 0.2403 = 173.19`… 精确到账的偏差应为 `720.72 × (costAgg/100)`。

**证明口径声明**：零扰动 = 不 `POST /tick`、不施任何扰动写入。
读 tick0 世界态用 `repos.sim.getSession(...).baseSnapshot`（`worldStateSource === "BASE_SNAPSHOT"`），
⛔ 不发 `POST /tick {n:0}`（会 400）。

## 判据 3（金额精度）

**预言 P3**：修前 `money(27.5万元 = 0.00275 亿)` 输出 **0**（屏上 `0.00`）。
修后必须能显示该量级（见提交信息里的位数选择理由）。
