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

## 距北极星还差什么（诚实）

- ✅ 真做到：达成率真派生 + 逐日分量持久化 + 可查 + UI 悬浮显分解。
- 📏 **未做（本次范围外）**：① 驾驶舱暂无"点开 KPI → 逐日拆因瀑布图/堆叠条"的专屏下钻（现为悬浮文案 + API 可查，未建独立可视化页，避免硬造壳）；② OEE/良率分量为镜像分布、非与该线具体设备/工序逐台 join（同源同分布、确定性，但非逐设备勾稽）——若要"点达成率→点到具体停机设备"需再接 oee:equip×line 拓扑聚合，属后续增量。
