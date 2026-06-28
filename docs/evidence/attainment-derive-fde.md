# FDE 实拍：计划达成率 = 可溯源真派生（选项2·R13）

**日期**：2026-06-28 · **分支**：`claude/vigilant-knuth-b1nmxn`
**脚本**：`scripts/fde-attainment-derive.mjs`（真后端 datacore SEED_DEMO + 真浏览器 Playwright）
**截图**：`docs/evidence/attainment-derive-fde.png`

## 解决的根本问题（铁律0）

此前 `计划达成率 91.3%` 是 `attainment:line` 的 **flat seed**（`base.mean 0.914`），8.7pp 缺口是
**不可拆的假设常数**——问"为何没达成 100%"答不出。一次"调种子均值+套事件"的省事尝试反而冲到 99.2%
（更不真），坐实了**种子微调治不了根**：真缺口是结构性的（OEE 78% / 良率 95%），非事件驱动。

根因解（非省事解）：把达成率改成**从生产链命名损因相乘算出**的真派生，缺口因此可逐日拆解。

## 真派生口径

```
达成率 = 设备效率达成(实际OEE/计划OEE) × 良率达成(实际良率/计划良率) × 排程事件损(检修/周末/爬坡)
```

- 计划基准 `oeePlan 0.85 / yieldPlan 0.97` 走治理 `planBaseline`（R14 应用层无业务常数）。
- 实际 OEE/良率分布镜像 `oee:equip`(0.78) / `yield:process`(0.952) 生成器。
- 逐日额外持久化分量 `oeeAttain / yieldAttain / eventDip`（series measureFields）。
- `agg-query` 新增 `measureField` 选择器 → 逐日拆因可查；周聚合回写 `Line.schedule_attainment`。

## 亲手用一遍（真后端真浏览器，非测试绿）

真 datacore（SEED_DEMO）+ 前端真后端模式 → admin/demo1234 登录 → 经营驾驶舱：

| 检查 | 结果 |
|---|---|
| 计划达成率 KPI 出处控件在页 | ✅ `widget-prov-attain` |
| KPI 值实拍（真派生 avg×100） | ✅ **89.4%** |
| 悬浮溯源显分解公式 | ✅ 达成率 = 设备效率达成 × 良率达成 × 排程事件损 |
| 悬浮备注显缺口拆因 | ✅ 缺口逐日拆为 设备效率损 + 良率损 + 检修·周末·爬坡损（R13） |
| 输入因子 | ✅ attainment:line.oeeAttain / yieldAttain / eventDip |

逐日拆因 API 实证（`LINE-changzhou`，arithmetic 精确）：
```
日       attainment  =  oeeAttain × yieldAttain × eventDip
6-05     0.815       =  0.943    × 0.982      × 0.88   (周末)
6-02     0.954       =  0.959    × 0.995      × 1.0
```
逐线 85.7%–97.2% 随各周 OEE/良率/事件构成而异（非整齐 flat）。

## 验证矩阵

- `pnpm -r build` 全绿（5 包）
- datacore 751 测 + 新 `attainment-derive.test.ts` 4 测（分解算术 / measureField 选择器 / 未知→400 / R6 字节一致）
- frontend 279 测 · agentcore build · gates：cockpit-widgets / traceability 全绿

## 逐日拆因下钻（继续增量·已落）

点驾驶舱「计划达成率」KPI → 复用 `DagNodeDrawer`（扩 `breakdown` 表）弹「逐日拆因」抽屉：
近 14 日逐日 `达成率 = 设备效率达成 × 良率达成 × 排程事件损`，标掉日（低于期均·灰底）+ 主因（缺口最大因子）。
drill 配置驱动（widget def `drill:{kind,seriesKey}`，R14），数据走 `agg-query measureField` 真派生分量（非写死）。
实拍 `docs/evidence/attainment-decomp-drill-fde.png`：14 日表，05-30/05-31 周末 主因「排程事件」(eventDip 86%)，
余日 主因「设备效率」；算术自洽（05-27: 90.5%×98.2%×98% ≈ 86.8%）。FDE 7/7 全绿。

## 逐设备勾稽（再下一层·已落）

把 attainment:line 从**镜像分布**改为沿 **Line→Process→Equipment 拓扑用该线真实序列 rollup**：
`generateHistory.writeAttainmentRollup` 算 `产线OEE = Σ(oee:equip×产量)/Σ产量`、`产线良率 = avg(yield:process)`，
`达成率 = 产线OEE/计划OEE × 产线良率/计划良率`；周末/检修经 oee:equip 的 weekend/maint_dip 自然传导（不重复相乘）。
逐日持久化 `lineOee/lineYield/eventFlag`。后端测试新增「勾稽真实」断言：`lineOee == 该线设备 oee:equip 产量加权均值`（容差 2‰）。

UI 拆因下钻加 **level-3**：逐日表 → 点「下钻最差日·最差产线逐设备」→ 该日达成率最低产线的**逐台 oee:equip / 逐工序 yield:process**（OEE 升序，最低=拖累点）。
实拍 `docs/evidence/attainment-equip-drill-fde.png`：最差线 LINE-jiangmen，**assembly-E2 OEE 45.6%**（灰底=拖累点），定位到具体停机/低效设备。

验证：datacore 757（含 6 项 attainment-derive：分解/勾稽 join/周末传导/选择器/400/R6）· frontend 279 · FDE **9/9**（KPI 90.2% → 逐日 → 逐设备三级点穿）。

## 距北极星还差什么（诚实）

- ✅ 真做到：达成率沿真拓扑逐台勾稽 rollup（非镜像）+ 逐日分量持久化/可查 + 三级点穿（KPI → 逐日 → 逐设备/工序，定位拖累设备）。
- 📏 **口径取舍**：OEE 含周末/检修 dip（来自 oee:equip），故 2 因子分解（设备效率达成 × 良率达成）中排程事件已并入设备效率达成（主因列以 eventFlag 标「排程·周末/检修」区分），不再单列「排程事件损」乘子——避免与 OEE 内的 dip 双重计数。
- 📏 **simclock/livedin 前向 tick** 仍走 genPoint 镜像近似（无跨序列 rollup），不参与 demo 历史；如需前向沙盘也逐台勾稽，是后续增量。
