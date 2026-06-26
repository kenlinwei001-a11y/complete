# 轨M 增量3 · 反事实排除层可见（种子扩充·加性冻结超集）验证证据

> 母版 §1.B：点 miss KPI 出含「反事实排除」节点的 DAG（单价/BOM 反算达标→排除）。
> 审核方 refine 红线：加性冻结（旧 467 逐字节不变、一个不少）/超集门/新数据走 chainMode/R6 防涟漪。

## 1. 根因方案（机制 + 种子，非补丁）
- **机制**（增量3a·commit 2c9fe62）：`plan_rootcause` 不再静默丢弃零贡献候选因子，改记 `excludedFactors` + DAG `factor_excluded` 灰节点；前端 `ProvenanceDag` 渲染「已排除」+ 理由。
- **种子扩充使其可见**（本增量）：物料保障率（demo 唯一越线 KPI·material 类）原仅 1 候选（现货缺口）→ 无可排除。补 material 类另两候选根因——**物流时效 / 安全库存**（demo 态此两维到货在窗口内、安全库存充足 → 缺口恒 0 → 反算达标→排除）。
  - `battery.ts`：MaterialBalance += `logisticsGapTon`/`safetyStockGapTon`（demo=0）；RootCauseChain += `rc-material-logistics`/`rc-material-safety`（material 类，指向上述 0 字段）。

## 2. 加性冻结超集红线（审核方 refine·全过）
- **超集门**（`docs/evidence/demo-provenance-superset-gate.mjs`，旧基线 ⊆ 新集 且旧逐字节相等）：
  ```
  冻结旧基线=467 · live=469 · 旧丢失=0 · 新增=2
  旧基线子集 SHA=8277a5a7f67c（冻结 8277a5a7f67c）✓ 字节相等
  新增 delta（合法·只增不改）：obj_rootcausechain_rc-material-logistics / rc-material-safety
  ```
  → 旧 467 一个不少、逐字节不变；新集严格超集；delta 仅新增 2。冻结旧基线另存 `demo-provenance-baseline-objids-frozen467.json`。
- **R6 防涟漪**：两独立服务（:4001 / :4012）同 seed 重跑，objids SHA 均 `b74711843e82`、typekeys SHA 均 `cc787b32`（34 类不变）→ 确定性，无生成顺序/计数漂移（matBalId 仍 `mbal-{i+1}`，仅加字段不加料、未移位；chainId 显式非 index）。
- **chainMode**：新 RootCauseChain 经真建模链产出（demo 走 chainMode），RootCauseChain 类型 sourceBindings 真（dataset=RootCauseChain），provenance 因果真实（不破轨L 北极星）。
- **少动**：只加「已有类型的新实例」（RootCauseChain）+ 已有类型新字段（MaterialBalance），未加新类型、未动沙盘传导/求解器核心。

## 3. FDE（真浏览器·`m2-rootcause-excluded.png`）
真登录 → `/v/dash` 根因归因 DAG：物料保障率 → 现货缺口（真因子·贡献 876）+ **2 个「已排除」灰节点**：
- 「已排除 物流时效不足 · 反事实：反算达标」
- 「已排除 安全库存不足 · 反事实：反算达标」
→ 母版 §1.B「点 miss KPI 出含反事实排除节点的 DAG」**达成**。

## 4. 未纳入（诚实交底·待审核方拍板）
- **八根源面板 4→8**：dashboard ProblemPanel 的「根源-问题」来自 `buildOrderProblems` 的 **4 个硬编码类别**（DELIVERY/MARGIN/KIT/CREDIT），非 RootCauseChain 种子。扩到 8 须改**求解器**（类别联合 + 4 判定逻辑）——与 refine 红线4「避免动求解器/优先加实例」冲突，留待审核方定（改求解器 vs 维持）。
- **3案 / X01-X05**：核查为**已实现**——plan_generate 三案（稳健/均衡/进取）+ 五维雷达/取舍矩阵/外部敏感性基线即在；plan_audit X01-X05 全实现，按 plan 输入条件触发（非种子门控）。无需种子扩充。
