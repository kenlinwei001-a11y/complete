# 施工单 · E 环（自进化/学习 + 沙盘活体）—— 把决策做到 Palantir 同级的"越用越准"闭环

> 用户决策"补完决策深化（D+E）"。D 的施工单已在 `WO-T5-steal-proper-fix-and-batch-review.md`（短租约+心跳·多实例韧性）。本单开 **E 环**。
> **关键认知**：E 不是从零建——M11 校准引擎 + 沙盘 what-if **基建已在**（读源坐实），缺的是**「活体常态化」**：让"越用越准"和"what-if 推演"从**手动/独立页**变成**决策流里的日常闭环**。
> 通用红线见 `DISPATCH-remaining-fused-worklist.md`（全绿+真跑自验+只推 vigilant-knuth+回写本体+禁外部产品名+模型标识不入提交物）。

## 现状（读源坐实·E 基建已在）

| 件 | 已有（文件:行） | 缺"活体常态化" |
|---|---|---|
| 校准配对 | `calibration/service.ts:443-476` observed 来自**真 A8 时序聚合**(ts_agg_runs)·非手动 | 回采→配对**持续自动跑**（非手动 `POST /calibration/run`） |
| 自动触发 | `:221` C12 RULE_SCAN 命中钩子→配对+提案 | 与定时/事件常态联动·覆盖率可见 |
| 提案治理 | 路由 `/a/v1/calibration/{report,proposals,history}` + `proposals/:id/{approve,rollback}`·approve→**param 版本+1** | MAPE **收敛趋势可见**（越用越准的证据看板） |
| 沙盘 what-if | `/a/v1/sim/sessions` 全套(tick/act/checkpoint/rollback·`app.ts:1197-1285`)·propagateTick 真传导 | **进决策日常**——从决策入口一键"就此问题开 what-if"（非独立页） |
| 回采对账 | `/a/v1/writeback-echoes`(+reconcile·`app.ts:962`)·D7 primitive | 回声**喂进校准配对**（闭"预测→执行→回采→校准"全环） |

## ▌ WO-E1（P1·校准活体常态化——"越用越准"成日常）

- **目标**：把"越用越准"从手动 run 升为**事件/定时驱动的活体闭环**，且**收敛可见**（用户能看到 MAPE 随轮下降的证据）。
- **改哪些**：
  1. **常态触发**：`scheduler.ts` 新增 `ScheduledJobKind "CALIBRATION_SWEEP"`（或复用 RuleScanService C12 钩子定时化）→ 周期跑 `calibration.run`（A8 observed 回采→配对→生成提案），无须手动。
  2. **回采喂入闭环**：`writeback-echoes/reconcile`(app.ts:968) 的真执行结果（reconcile 后的 observed）**写入 `calibrationPairs`**（现 observed 仅来自 A8 ts_agg·补"真 Action 写回结果"这一路）→ 闭"预测→执行→回采→校准"。
  3. **MAPE 收敛趋势**：`CalibrationService` 新增 `convergenceHistory(tenantId)`：逐轮 MAPE/提案数/已批准数序列（确定性·从 history 派生）；路由 `GET /a/v1/calibration/convergence`。前端校准看板加"MAPE 趋势线"（越用越准可视）。
  4. **治理流**：提案 approve/rollback 已在——补 outbox 事件 `calibration.applied`（§4 DL5 已登·确认真发）+ param 版本可溯。
- **FDE 真值判据**：① 真起 datacore·喂两批真 observed（A8 ts_agg + writeback reconcile）·跑 CALIBRATION_SWEEP →提案自动生成（非手动 run）；② approve 提案→`paramsVersion` +1→下次求解器用新参（求解器确定性·同输入新参新输出）；③ `GET /calibration/convergence` 现 MAPE 随轮**下降**序列（越用越准可证）；④ rollback→param 退回·MAPE 趋势可溯。
- **边界**：校准是**确定性提案 + 人工审批**（R6·不自动改参·保 R4 治理）——"自进化"是**辅助决策的越用越准**·非无人值守自改；observed 真实性依赖 A8 时序/writeback 真接入（demo 合成·诚实标）。
- **本体回写**：§10.2 D10 校准闭环活体化；§4 确认 `calibration.applied` 真发；不变量 R4（参数变更经审批）不破。

## ▌ WO-E2（P1·沙盘 what-if 进决策日常）

- **目标**：what-if 推演从**独立沙盘页**变成**决策入口内嵌**——用户在风险/规划/订单看到一个问题，能一键"就此开 what-if 推演"，对比基线、checkpoint/rollback，决策完即弃或采纳。
- **改哪些**：
  1. **决策入口接沙盘**：前端 `RiskBoardView`/`PlanAuditView`/`OrderChainView` 等加"开 what-if"动作 → `POST /a/v1/sim/sessions`（baseSnapshot=当前决策上下文·scope=该问题相关对象）→ 进交互沙盘（`tick`/`act` 真传导·`propagateTick`）。
  2. **基线对比**：沙盘 `world` vs 基线快照 diff（现 SimComparePanel 在·接决策入口上下文）。
  3. **采纳/弃**：what-if 结论可"采纳为 Action 提案"（接 R4 审批）或 checkpoint 留存/rollback 弃——决策完不污染主世界（R2/R3）。
- **FDE 真值判据**：① 真浏览器从风险红点"开 what-if"→真起 sim session（baseSnapshot=该红点上下文）→ `tick` 真传导（propagateTick·非空）→ 对比基线 diff 可见；② checkpoint→rollback 主世界不变（R3 隔离）；③ 采纳→落 Action 提案经 R4 审批。
- **边界**：沙盘传导基建已在（`propagateTick`/SimSession）——本单是**接决策入口 + 内嵌体验**·非重建推演引擎；what-if 是**确定性派生**（R6）·非真实执行。
- **本体回写**：§8 G-11/G-12 沙盘活体接决策入口；不变量 R3（沙盘隔离不污染主世界）守。

## 建议施工顺序（D+E 深化）

1. **WO-T5-LEASE-HEARTBEAT**（D·已有施工单·先发·解多实例韧性）。
2. **WO-E1 校准活体常态化**（越用越准成日常·先于 E2·因 E2 的"采纳"可喂 E1 回采）。
3. **WO-E2 沙盘进决策日常**（what-if 内嵌·闭"推演→采纳→回采→校准"大环）。

> 三者合起来 = Maven 命门环 **D（多实例韧性）+ E（自进化/活体）** 补完——决策系统从"算得准·接得地·扛得住"再进到"**越用越准·活体推演**"。

## 粘贴即用提示词

**WO-E1**
```
你是开发 agent。实现 WO-E1（校准活体常态化）。M11 基建已在（calibration/service.ts observed 来自 A8 ts_agg·C12 钩子·approve→param+1·路由 /a/v1/calibration/*）。加：①scheduler.ts 新增 ScheduledJobKind CALIBRATION_SWEEP 周期跑 calibration.run(回采→配对→提案·非手动)；②writeback-echoes/reconcile(app.ts:968) 真执行结果 observed 写入 calibrationPairs(补真 Action 回采这一路)；③CalibrationService.convergenceHistory 逐轮 MAPE/提案/批准序列 + GET /a/v1/calibration/convergence + 前端看板 MAPE 趋势线；④approve 发 outbox calibration.applied(§4 DL5)。完成判据：喂两批真 observed 跑 sweep→提案自动生成；approve→paramsVersion+1→求解器用新参；GET convergence 现 MAPE 随轮下降；rollback→param 退。边界：确定性提案+人工审批(R4 不自动改参)。回写 SYSTEM-ONTOLOGY.md §10.2 D10 + §4 calibration.applied。通用红线：pnpm -r build+test 全绿+真跑自验贴证；只推 claude/vigilant-knuth-b1nmxn；禁外部产品名；模型标识不入提交物。
```

**WO-E2**
```
你是开发 agent。实现 WO-E2（沙盘 what-if 进决策日常）。沙盘基建已在(/a/v1/sim/sessions tick/act/checkpoint/rollback·propagateTick·app.ts:1197-1285·SimComparePanel)。加：①前端 RiskBoardView/PlanAuditView/OrderChainView 加"开 what-if"动作→POST /a/v1/sim/sessions(baseSnapshot=当前决策上下文·scope=相关对象)→进交互沙盘；②world vs 基线 diff(接 SimComparePanel)；③what-if 结论"采纳为 Action 提案"(接 R4 审批)或 checkpoint/rollback 弃。完成判据：真浏览器从风险红点开 what-if→真起 session→tick 真传导非空→对比基线 diff 可见；checkpoint→rollback 主世界不变(R3)；采纳→落 Action 经 R4。边界：接入口+内嵌·非重建引擎·确定性派生 R6。回写 SYSTEM-ONTOLOGY.md §8 G-11/G-12 + 不变量 R3。通用红线：pnpm -r build+test 全绿+真浏览器自验贴证；只推 claude/vigilant-knuth-b1nmxn；禁外部产品名；模型标识不入提交物。
```

## 本体引用与影响

- **不变量**：R4（校准/采纳经审批·不自动改参）· R3（沙盘隔离不污染主世界）· R6（确定性派生/提案）· R13（observed 溯源真实性诚实标）。
- **链路/事件**：`calibration.applied`(DL5) 确认真发；what-if 接决策入口（数据→推演→决策→回采→校准**大环闭合**）。
- **断点**：§10.2 D10（校准活体）· §8 G-11/G-12（沙盘活体进日常）——E 环补完即闭。
- **Maven 命门环 E**：从"基建在·未常态"升为"越用越准·活体推演成日常"。

---
*审核方设计施工单（design+review·读源坐实 E 基建已在·闭环非重建）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
