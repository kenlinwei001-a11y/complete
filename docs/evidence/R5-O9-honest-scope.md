# F·O9 诚实缩范围 · 缺件卡 grow 活体实测停 PROVISIONAL（招牌"自动补→GOVERNED"不达，R4 所限）

> 评审打回（REVIEW-VERDICT §1 轨F）："O9 ◐——'缺件卡→自动补→GOVERNED'活体里从不发生……停 PROVISIONAL+开票"。
> 评审给两条出路：① 真让缺件卡长成 GOVERNED；② **诚实缩范围**。本项取 ②（因 ① 违 RL4，见 §2）。

## 1. 主线独立复验（非relay）
起真 datacore:4001 + agentcore:4002 内存态，建一张缺意图的卡 `R5_GAP_TEST`（intentKey=nonexistent_intent_xyz）→ grow：
```
maturity: PROVISIONAL
lastRun.verification: {status:"NOT_RUN", path:"NONE", gapCode:"MISSING_INTENT"}
gaps: ["MISSING_INTENT"]
```
**实测停 PROVISIONAL，未达 GOVERNED**——与评审结论一致，坐实招牌能力活体不发生。

## 2. 为何"自动补→GOVERNED"不该强做（取诚实缩范围的根因）
- 缺件（如 MISSING_INTENT / 缺计划）的"自动补"需**创建并发布**意图/计划，而**发布是 R4 门控动作**（走正门审批）。
- `growScenario` 自动补出的 scaffold 制品是 **DRAFT**；自动发布 = 绕 R4 = 违 **RL4（走正门，不放水）**。
- `classifyGap` 对场景 QOS 缺口不产 `EMPTY_DATA`（那是数据缺口码），故 SOFT 数据合成路径对场景缺口不触发。
- 结论：在不违 RL4 的前提下，缺件卡只能收敛到 **BOUNDARY + 诚实 PROVISIONAL + 开 GrowthTicket**，等真人/code-agent 经正门补齐并发布后，下次 grow 才可能 GOVERNED。**强行 auto-GOVERNED 是放水，不做。**

## 3. O9 的诚实（已缩窄）范围
- **真做且达成**：`growScenario` 缺件首验未过 → 自动触发 `runGrowthLoop`（探针→补齐→重跑→收敛）→ 收敛后重验；补不上 → 诚实 PROVISIONAL + 开 GrowthTicket + 留痕账本 + 发 `scenario.growth_triggered`。单源 `buildGrowthLoopWiring`（RL3 不分叉）。
- **不号称**：~~"缺件卡自动补成 GOVERNED"~~（招牌能力，活体不发生，已从本体 §8 G-9 删除"全闭"、改 ◐ 并标 O9 ❌招牌未达）。
- 本体 §8 G-9 已据此校正（见该行 O9 ◐ + 诚实边界）。
