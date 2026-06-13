# 修复报告 · G2 第一阶段（13 缺失求解器中无需新增对象类型的 4 个）

| 项 | 值 |
|---|---|
| 缺陷 | 核对报告 G2：`scenarios-catalog.ts` 声明 20 场景，但 13 个新求解器仅有声明、无实现 → 场景 S06–S20 触发即 `SOLVER_NOT_FOUND` |
| 本阶段范围 | 13 个里**不需要新增对象类型**的 4 个：`mitigation_select`(S06)、`outsourcing_split`(S14)、`maintenance_stagger`(S13)、`quarterly_gap`(S19) |
| 修法 | 按 PRD-catalog §2 公式级规格实现，全部确定性；数值常量一律取自 solver_params（场景包种子默认值），求解器代码内只留与种子一致的兜底 |
| 验证 | datacore typecheck 全绿；datacore 全量 **217 测试通过**（原 212 + 新增 5 个 VLE 双算用例）；agentcore 161 测试不回归；`pnpm -r typecheck` 全绿 |
| 交付 | `G2-phase1-solvers.tar.gz`（7 文件）+ `G2.phase1.diff.txt`（统一 diff，可对 v1.1 直接 apply） |

## 改动清单（7 文件 · 新增 2 / 改 5）

**新增**
1. `apps/datacore/src/solvers/scenarios-p1.ts`（承重，约 380 行）—— 4 个求解器算法 + 季度供给/标签辅助。
2. `apps/datacore/test/scenarios-p1.test.ts`（约 160 行）—— 每个求解器一条参照实现双算用例（VLE ⑤段口径）+ 目录可见性断言。

**修改**（共 74 行变更）
3. `apps/datacore/src/solvers/types.ts` —— `SolverContext` 增 `planTargets` 字段；`SolverParamsShape` 增 4 个可选参数块（`mitigationSelect`/`outsourcing`/`maintenanceStagger`/`quarterlyGap`）。
4. `apps/datacore/src/solvers/service.ts` —— `SOLVER_KEYS` 追加 4 键；`loadContext` 加载 `PlanTarget`；`compute()` switch 加 4 个 case。
5. `apps/datacore/src/synthetic/battery.ts` —— `BATTERY_SOLVER_PARAMS` 追加 4 个参数块默认值。
6. `apps/datacore/src/synthetic/service.ts` —— 计划域种子里构造的临时 `SolverContext` 补 `planTargets: []`（编译对齐）。
7. `apps/datacore/test/capex.test.ts` —— 最小 ctx 字面量补 `planTargets: []`（编译对齐）。

## 各求解器算法（忠实 PRD-catalog §2）

**S06 `mitigation_select` `{baseName, factor}`** —— 取该因素方案库（`risk.mitigations` 七因素×3 案），`score = eff × urgency / (costRank × tn)`，`urgency = max(0,(紧张度−70)/30)`，成本档 低/中/高/极高 = 1/2/3/4。按 score 降序（urgency=0 时退化为效费比 `eff/(rank×tn)` 作稳定排序键），输出选项表 + 推荐首位 + 采纳草稿 payload。紧张度复用 `risk.ts` 的 MOCK 口径 `mockTightness`，与风险看板同源。

**S14 `outsourcing_split` `{gap, weeks, totalDemand?}`** —— 三渠道单位成本升序贪心：自产加班 `c1=1.0` 上限 `gap×0.4`；外协 `c2=1.4` 上限 `总需求×20%`（C08，`totalDemand` 缺省回落 gap）；延期罚 `c3=2.5` 吸收余量。输出分配表（外协行带 C08/C31 注解）+ 总成本 + vs 全延期节省。

**S13 `maintenance_stagger` `{}`** —— 冲突 = 检修周 ∈ 交付高峰周（订单交期按周聚合 qty 的 top3）。对每冲突基地在 ±4 周窗内选新周 = `argmin(当周交付负荷)`，约束：与上次检修间隔 ≥ `minIntervalWeeks`、同集团（`group`→回落 `kind`）同周检修 ≤ 3，且新周不得为另一高峰周。输出调整表 {基地, 原周, 建议周, 负荷降幅} + 不可解冲突清单。
> 注：PRD 名义间隔 26 周为半年检修周期；合成 S 档日历仅覆盖约 10 周预测窗，故 `minIntervalWeeks` 默认参数化为 8（写在 solver_params，可改），约束逻辑忠实实现，仅阈值按合成时域标定。

**S19 `quarterly_gap` `{quarter}`** —— 缺口 = 季度滚动 gap：供给 = 周产能(万套)×最优认证系数×周曲线(检修折减) 13 周聚合（与计划域 `quarterly` 同口径）；需求 = `PlanTarget` 季度目标 ×(1+滚动修正)，2027+ 按同季 ×(1+growthYoY)ⁿ 外推。候选对策（提前爬坡/换型优化/错峰检修/外协/顺延）按成本秩升序贪心覆盖，每项映射落地场景跳转（S07/S11/S13/S14）。输出组合 + 各释放量 + 残余缺口。季度入参兼容 `2026Q2`/`2026-Q2`，早于预测起点季拒绝。

## 设计一致性说明

- **单一参数源**：4 个求解器的全部数值（成本系数、成本秩、上限比、错峰窗口、对策释放比）均落在 `BATTERY_SOLVER_PARAMS`，遵循"求解器代码内绝不硬编码业务常量"既有约定（与 capacity/risk/plan/capex 同模式）。
- **PlanTarget 非新对象类型**：`quarterly_gap` 需求口径复用既有 `PlanTarget` 对象（计划域种子已生成），只是把它纳入 `SolverContext`——不属于本阶段排除的"新增对象类型"。
- **确定性 + 双算**：4 个求解器纯函数化（`compute()` 无副作用），同输入同参数版本同输出；测试侧独立重算（不复用求解器代码）逐字段比对，符合 VLE ⑤段断言矩阵要求。

## 未触及 / 后续（G2 第二阶段）

剩余 9 个求解器（cert_schedule / kit_readiness / lta_gap / inventory_optimize / changeover_sequence / yield_diagnosis / quote_margin / credit_exposure / carbon_footprint）需新增对象类型（Material/MaterialBatch/Customer/ARInvoice/CarbonFactor/ChangeoverMatrix/Certification）+ GenSpec 种子 + 上下文加载器 + 算法 + 参照实现，按 PRD §7 分批建设，作为 G2 第二阶段独立交付。

## 注

本修复在 v1.1（已应用 G1）代码副本上完成并验证。`G2.phase1.diff.txt` 可对 v1.1 直接 `git apply`/`patch -p1`。
