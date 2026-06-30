# 审核核发 · WO-ALERT（主动决策推送 D6 §3.7）闭合

> dev `9c291f6`·盯守命中即验。核发 = 独立真跑核实（非信 commit 自述）：①门全绿 ②代码评审清 ③链路真跑 ④本体回写对 ⑤诚实位/不变量守。

## §1 验证账（审核方独立复核·非信 commit）

| 维度 | 独立核实 | 结论 |
|---|---|---|
| 门·datacore 全绿 | 亲跑 `vitest run`：**793 passed / 11 skipped**（150 文件·含 WO-ALERT 3）。push 钩子在 `buildApp` 激活=**每个 `scan()` 测试都走推送路径** → 零回归（关键：钩子全局生效却不破坏既有 outbox 计数断言） | ✅ |
| 门·agentcore | **353 passed / 1 skipped**（env-gated real-kimi）·`event-subscriptions.ts` 加 decision.alert 订阅安全 | ✅ |
| 门·frontend | **293 passed**（119 文件）·`eventInvalidation.ts` 加 decision.alert 失效安全 | ✅ |
| 链路真跑 | WO-ALERT 测 3/3：seedBattery 越线 → 真 `scan` → 真 `mitigation_select` → `decision.alert` 落 outbox → `GET /a/v1/outbox` + `GET /a/v1/notifications`(planner) 待办带"建议处置"可拉取（3.1s 真活·非 mock） | ✅ |
| mitigation "LIVE 真案" | `solvers/extended.ts:540` 注入 canonical 方案库 `params.risk.mitigations` → 非空壳·`recommended/recommendedName/draftPayload` 真出（测断言三者 truthy） | ✅ |
| R4 不直写真值 | 仅 `outbox.emit` + `notifyRole`·无仓储写·采纳经**既有** `adopt_mitigation` Action 审批 | ✅ |
| R6 确定性 | `(ruleKey,baseName)` 去重 + sorted alerts + `mitigation_select` 同入同出·测2 两跑指纹集合一致 | ✅ |
| R2 租户隔离 | `tenantId` 全程透传·测3 他租户零 decision.alert/通知 | ✅ |
| 诚实边界 | 非决策规则（信用/现金）仍发 base `rule.alert`（`scheduler.ts:297`）·`if(!factor)continue` 只跳**额外** decision.alert → **不编造不相干处置方案**（诚实位） | ✅ |
| 本体回写（铁律0） | §3 链路（`Rule(决策阈值)→RULE_SCAN→RuleAlert→mitigation_select→处置建议→decision.alert+notifyRole→待办`）+ §4 L18 + agentcore 订阅 + 前端失效（D-29 下游订阅齐） | ✅ |

## §2 评审发现（两点已查实·均正向）
1. **`mitigation_select` 签名匹配**：app.ts mitigate 钩子传 `{factor,baseName}`，求解器 `service.ts:149` 输出字段含 `recommended/plans/draftPayload/urgency` → 钩子读取无 undefined。✅ 非接缝错。
2. **"仍发告警事件"措辞准确**：`scheduler.ts:297` scan 对**每条**越线先发 `rule.alert`（C12→calibration.required），decision push 是**叠加层**。非决策规则不进 push 但不被静默丢。✅ commit 措辞与代码一致。

## §3 一句话
**WO-ALERT 核发。** D6 §3.7「PULL→PUSH」主动决策推送真闭环：决策阈值越线 → 自动出处置建议 → push planner 待办；复用既有 RULE_SCAN/outbox/notify（不造并行引擎），门全绿（datacore 793 / agentcore 353 / frontend 293）·R4/R6/R2 守·诚实位不编造·本体回写齐。这是 **MU16「主动性 / 我不知道我不知道」接缝缺口的第一步实体化**（D6 RuleScan primitive → 真 push 待办）——Maven「主动盯+提」从设计走向活体。

## 本体引用与影响
- **链路**：`Rule(PUBLISHED 决策阈值)→RULE_SCAN→RuleAlert→mitigation_select→处置建议→decision.alert(NOTIFY)+notifyRole(planner)→待办(PUSH)`（本体§3 已回写）。
- **事件**：新增 L18 `decision.alert`（NOTIFY·失效 notifications/approval-inbox/risk/dashboard）。
- **不变量**：R4（采纳走审批·不直写）·R6（去重确定）·R2（租户隔离）·R13（诚实位·非决策规则不编造方案）·R14（`DECISION_RULE_FACTORS` 配置驱动）。
- **断点**：呼应 D6 主动推送（MU16 接缝）·无新断点·G 系列不回退。
- **微备注（非阻断）**：agentcore 订阅列 `invalidates` 含 risk/dashboard，前端 `EVENT_INVALIDATES` 仅 notifications/approval-inbox——decision.alert 不改 risk/dashboard 底层数据，前端少失效两页属合理（少抖动），非缺陷·记此供后续口径对齐。

---
*审核方核发（design+review·独立真跑核实门全绿+链路+本体·非信 commit 自述）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
