# 数据构建发动机 · 自完善 LOOP 日志

> 自驱循环：目标→需求→真跑创建→数据验收→差异分析→**改引擎代码**→四包 gate→继续。
> 每轮记录：query · gapCode 前进 · advanced 变化 · 改了哪处引擎代码 · gate 绿否。
> 红线：R6 确定性 · R14 零业务常数 · KILL-MOCK（真实业务实体走 HARD 真人正门·绝不静默伪造）。

## 查询集（起点·补不齐的题）
| # | query | 当前卡在 | 状态 |
|---|---|---|---|
| Q1 | 常州基地设备OEE与物流时长未来30天逐日时序推演 | NO_INTENT | 迭代中 |
| Q2 | 储能基地未来60天产能缺口时序 | 待测 | — |
| Q3 | 乘用车订单交付风险时序 | 待测 | — |

---

## 迭代 0 · 基线真跑（2026-07-25·铁证）
**Q1 真跑结果**（起 datacore+agentcore 内存态·POST /api/v1/growth/{probe,run}）：
```
probe: gapCode = NO_INTENT（非 EMPTY_DATA）
  evidence: "分类 outOfCatalog，无意图覆盖；路径B agent 兜底作答（本体外，未验证）"
run:   fillApplied.advanced = false（只开骨架工单·不自建）
  terminalState = BOUNDARY · openTickets = [NO_INTENT]
```
**差异分析（定位到引擎代码）**：
- `growth/scenario-grow.ts:32` `SCAFFOLDABLE = {NO_PLAN, SOLVER_NOT_FOUND}` —— **NO_INTENT 不在内**。
- `growth/scenario-grow.ts:93-95` else 分支：非 EMPTY_DATA 且非 SCAFFOLDABLE → `advanced:false` 只开工单。
- 即：引擎对 NO_INTENT **不自动 scaffold 意图**，卡在意图路由层，根本走不到数据层（EMPTY_DATA）。

**结论**：数据构建发动机的第一层弱点 = **诊断得出 NO_INTENT 却不自补**。病灶在**路由/意图层**（上游），不在数据合成层。修好它，query 才能前进到下一层（NO_PLAN/EMPTY_DATA），届时才轮到"补时序"。

**下一步（迭代 1·下次唤醒实现）**：
- 新增 `growth/scaffold.ts scaffoldDraftIntent(deps, tenantId, query)`：scaffold DRAFT 意图（绑 scaffoldDraftPlan 产的计划·query 作触发例·status DRAFT 待审批 R4）。
- `scenario-grow.ts fill`：NO_INTENT → scaffoldDraftIntent → `advanced:true`（同 NO_PLAN 口径：DRAFT 产物已就绪即算前进）。
- SEAM 测：probe NO_INTENT query → run → 断言 advanced:true + 意图草稿产出。
- 四包 gate 绿 → commit。再真跑 Q1 验 gapCode 是否前进离开 NO_INTENT。
- 待解：`CreateIntentBodySchema` 必填字段（planRef 必填·已知；其余需读契约定义处）。
