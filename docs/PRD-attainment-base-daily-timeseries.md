# PRD · 基地级日达成率时序（attainment:base · 日粒度 · 接 Metric 口径）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-22 · 后端（时序剧本/TsAgg/契约）|
| 取代/扩展 | 新建 · 补"时间维度归因"缺的基地级日达成率序列 · 接 `PRD-goal-metric-owner-spine`（Metric 达成率口径）+ `PRD-empty-tenant-bootstrap`（seed 时一并产）|
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§5 R6/R13 · §10 D10 运营时序域）· `apps/datacore/src/synthetic/battery.ts:777-781`（序列剧本）`:799-804`（`BATTERY_TS_AGG_SPECS`，现 `attainment:line` 日序 + `schedule_attainment` 周聚合）· `apps/datacore/src/timeseries.ts`（A8 时序引擎，`bucketOf` day/week）· `packages/contracts/src/timeseries.ts`（IndustryTemplate 时序增量）|

> 一句话：要回答"本月**逐日**为何未达成"（时间维度归因），需要**基地级日粒度达成率序列**；但系统现状是 `attainment:line`（产线级、日原始）→ 聚合成 `Line.schedule_attainment`（**周**）——**没有 `attainment:base`（基地级日序）**。本 PRD 加一条**基地级日达成率时序**（两选一：新剧本 `attainment:base` 或 `attainment:line→Base` 日上卷 TsAgg），走 A8 时序管线、确定性（R6）、可溯源（R13），并与 `Metric`（达成率=实际/目标）口径对齐——使"6 月逐日达成率 + 时间维度归因"成立。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2 / §10 D10）：`TsSeries(attainment:base)`·`TsAggSpec/Run`·`Base(attainment_daily)`·`PlanTarget`（达成率分母=目标）·`Metric`（达成率收口，接 spine）。
- **触及链路**（§3 / 切片 `sys.ops.tick`）：`时序剧本/上卷 → attainment:base 日点 → (可选)TsAgg 物化 Base.attainment_daily → 达成率=实际/目标(PlanTarget) → Metric.actual → 时间维度归因(plan_audit/逐日)`。
- **触及事件/数据流**（§4）：复用 `syntheticJob`/`ts.late_arrival`；无新增持久事件。
- **触及不变量**（§5）：R6（同 (industry,seed) 日序字节一致）· R13（每日点可溯：来源 lived-in/合成 + 计算口径）· R-一致（达成率口径与 Metric/驾驶舱同源）· R14（剧本参数入 IndustryTemplate 种子配置，非写死）。
- **关闭/影响断点**（§8）：补"时间维度归因"数据缺口（截图"缺乏真实达成时序→无法时间归因"的直接修复）。
- **门禁**（§7）：`pnpm -r build && test`（时序生成 + 聚合回归）· `ontology:check`（新 series/TsAgg 登记）· `debattery:check`（剧本配置化）· FDE 亲手跑（查 6 月 base 日达成率序）。
- **数据闭环合规**（`data-closure-spec §6`）：T3（剧本参数=种子配置）· I1（经合成管线/单一来源）· M2（TsAgg 派生登记）· V2（溯源）· R6 确定。
- **回写承诺**：`attainment:base` 序列 + TsAgg + Base.attainment_daily → 回写本体 §10 D10（时序域）+ §2（Base 属性）。

## 1. 目标 / 非目标
### 目标
1. **基地级日达成率序列**（二选一，建议 (b) 复用现有）：
   - **(a) 新剧本** `{ seriesKey:"attainment:base", entityType:"Base", grain:"day", base:{mean,noise}, effects:["maint_window_dip","weekend_dip","ramp_curve"], measureField:"attainment" }`（battery.ts:777-781 加一行）。
   - **(b) 日上卷 TsAgg**：复用现成 `attainment:line`（日）+ `{ key:"attainment_base_daily", seriesKey:"attainment:line", window:{grain:"day"}, agg:"weighted_avg", weightField:"output", output:{objectType:"Base", property:"attainment_daily"} }`（按产出加权,产线→基地）。
2. **达成率口径接 Metric**：日达成率 = 实际产出 / 当日目标（PlanTarget 分解到日，或 line 加权）；与 `Metric.actual`（spine）同源,跨视图同值（R-一致）。
3. **可查日序**：`POST /a/v1/timeseries/agg-query` 取 `attainment:base` 6 月逐日点（120-bucket 上限内）。
4. **seed 时一并产**：bootstrap 合成（`run_synthetic` livedIn）即产基地级日序,空租户引导后直接可用。

### 非目标
- 不改 A8 时序引擎（复用 `TimeseriesService`/`bucketOf`）。
- 不动现有 `attainment:line`/`schedule_attainment`（周聚合保留,新增不替换）。
- 不在前端写死序列（取查询）。

## 2. 现状与缺口（带 file:line）
| 元素 | 现状 | 缺口 |
|---|---|---|
| 达成率原始序列 | ✅ `attainment:line`（battery.ts:780，日，base 0.914）| 仅**产线级** |
| 达成率物化 | ✅ `schedule_attainment`（battery.ts:802，**周** agg）→ Line.schedule_attainment | **非日、非基地** |
| 基地级日序 | ❌ | **新增 attainment:base / Base.attainment_daily** |
| 与 Metric 对齐 | ◐ spine 定义 Metric | 日达成率作 Metric.actual 来源 |
| seed 产出 | ✅ lived-in 产 line 时序 | 加产 base 日序 |

## 3. 设计
### 3.1 序列/聚合（择 (b) 为主，最小改动）
- IndustryTemplate.timeseries（或 BATTERY_TS_AGG_SPECS）加日上卷 TsAgg：`attainment:line`(日) ×output 加权 → `Base.attainment_daily`（日）。同时保留原始日点可查（series `attainment:line` 已是日）。
- 若需"基地独立波形"（非纯上卷），用 (a) 新剧本 `attainment:base`（day）。
### 3.2 达成率口径（R-一致 / 接 Metric）
- 日达成率 = Σ产线实际产出 / Σ产线当日目标（目标来自 PlanTarget 日分解或月目标 ÷ 工作日）；与 `Metric{key:"achievement", level:"day", actual, target}`（spine）同源。
### 3.3 查询
- `attainment:base` 经 `query_timeseries_agg`/`POST /a/v1/timeseries/agg-query` 取 6 月逐日（grain=day, window=月）；agent 工具 `query_timeseries_agg` 可读回（接 `PRD-agent-data-generation-tools`）。
### 3.4 seed
- `generatePlanDomain`/lived-in 产出基地级日序（确定性 seed），bootstrap 步1 即含。

## 4. 契约 / 端点
- `battery.ts`/IndustryTemplate.timeseries：加 1 条剧本或 TsAgg。`Base` 加属性 `attainment_daily`。
- 端点：复用 `POST /a/v1/timeseries/agg-query`（120-bucket 上限）· `query_timeseries_agg` 工具。
- 接 spine：`Metric(achievement, day)` actual ← attainment:base。

## 5. 关键流程
seed/lived-in → attainment:base 日点(或 line→base 日上卷) → 达成率=实际/目标 → Metric.actual(day) → 查询 6 月日序 → plan_audit/逐日时间维度归因。

## 6. 非功能（§5）
R6（日序确定）· R13（日点溯源）· R-一致（达成率口径同 Metric）· R14（剧本配置化）。

## 7. 验收（DoD）
- 查得 `attainment:base` **6 月逐日**达成率序（base 级，day grain），同 seed 字节一致（R6）。
- 日达成率 = 实际/目标，与 Metric/驾驶舱口径一致（R-一致）；可溯源（R13）。
- bootstrap 合成后空租户即有该序列；`query_timeseries_agg` 工具可读回。
- 原 `attainment:line`/`schedule_attainment`（周）不破。
- `pnpm -r build && test` 全绿（时序回归）· `ontology:check` 过。FDE 亲手查 6 月 base 日序。
- 回写本体 §10 D10 / §2。

## 8. 分期
- **TS.1** 日上卷 TsAgg `attainment:line→Base.attainment_daily`（最小改动）+ seed 产出 + 查询。
- **TS.2** 接 Metric（achievement day）+（可选）独立剧本 attainment:base + 与 plan_audit 逐日归因对接。

> 依赖：`PRD-goal-metric-owner-spine`（Metric 口径）· `PRD-empty-tenant-bootstrap`（seed 时产出）· `PRD-attribution-routing-plan-audit`（逐日归因用此日序）。基线分支：生成器 + 时序，冲突小。
