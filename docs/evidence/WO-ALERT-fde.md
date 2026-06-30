# WO-ALERT FDE 证据 · 主动决策推送（RuleScan → 告警 → mitigation 处置建议 → push 待办）

> D6（PRD-decision-support-maturity §3.7）：把"等用户来查(PULL)"变成"系统主动盯 + 提(PUSH)"。
> 复用既有 RULE_SCAN 调度路径 + outbox + S2 Action/通知，不新造并行引擎。
> 模型标识不入提交物。

## 1. 链路（沿本体 §3）

```
Rule(PUBLISHED 决策阈值 C01/C02/C03/C05/C06/C08/C11/C16/C29/C30/C31)
  --RULE_SCAN 命中越线（scheduler.ts RuleScanService.scan）-->
    RuleAlert{ruleKey,entityId,severity,props}
  --DECISION_RULE_FACTORS[ruleKey] → factor + resolveBaseName(props)-->
    mitigation_select 求解器（注入 canonical 方案库 params.risk.mitigations，LIVE 真案，R6 确定性）
  --emit decision.alert(NOTIFY 层，载 ruleKey/factor/baseName/recommended/recommendedName/urgency/draftPayload)-->
    OutboxEvent（GET /a/v1/outbox 可见）
  --NotificationService.notifyRole("planner")-->
    待办（GET /a/v1/notifications 可拉取；前端通知中心/审批收件箱消费）
  --用户"一键采纳"（既有 adopt_mitigation ActionType）-->
    ActionDraft → S2 审批（R4 真值经审批，不直改）
```

去重 R6：单次扫描内按 (ruleKey, baseName) 去重（一基地一规则一条待办，不随对象遍历数量抖动）。
租户隔离 R2：tenantId 全程透传，他租户无 decision.alert / 待办。
确定性 R6：扫描路径无 Math.random/Date.now/new Date 于新增结论逻辑；mitigation_select 同输入同输出；
notifyRole 扇出与 outbox.emit 的 id/时间戳属既有基础设施（与既有 rule.alert 同款），不进入扫描结论指纹。

## 2. 新增事件（已回写本体 §4）

| 事件 | 生产者 | 层级 | 失效下游 |
|---|---|---|---|
| `decision.alert` | RuleScan·决策阈值越线 → mitigation_select 处置建议 → notifyRole 待办（WO-ALERT D6） | NOTIFY | notifications, approval-inbox, risk, dashboard |

- 回写 `docs/SYSTEM-ONTOLOGY.md` §4 事件失效图（L18 行）+ §3 关系图谱（Rule→RULE_SCAN→mitigation→decision.alert→待办 链）。
- 登记 `apps/agentcore/src/event-subscriptions.ts`（订阅 + 失效语义）。
- 前端 `apps/frontend-shell/src/store/eventInvalidation.ts`：`decision.alert` → 失效 notifications + approval-inbox（被动页主动点亮）。

## 3. 真跑（内存模式 SEED_DEMO=1，端口 4011）

启动：
```
PORT=4011 JWT_SECRET=dev BLOB_DIR=/tmp/wo-alert-blobs SEED_DEMO=1 \
  CREDENTIAL_KEY=<64hex> node apps/datacore/dist/server.js
```

### 3.1 触发 RULE_SCAN（复用既有 simclock tick 调度路径，内部调 ruleScan.scan）
```
$ curl -s -X POST http://127.0.0.1:4011/a/v1/synthetic/clock/tick \
    -H 'x-debug-user:demo:admin:admin' -H 'content-type: application/json' -d '{"advance":"1d"}'
{"tickJobId":"tickjob_v9q7feyftkjdhfkc","status":"SUCCEEDED","report":{...newPoints:180...}}
```

### 3.2 GET /a/v1/outbox —— decision.alert 真发可见
```
$ curl -s http://127.0.0.1:4011/a/v1/outbox -H 'x-debug-user:demo:admin:admin' | <jq 统计>
total: 67 | decision.alert: 7
events: ['decision.alert', 'ontology.published', 'rule.alert', 'rules.updated', 'synthetic.tick_completed']
```

### 3.3 GET /a/v1/notifications（planner）—— 待办可拉取（PUSH 命门）+ 带 mitigation 处置建议
```
$ curl -s http://127.0.0.1:4011/a/v1/notifications -H 'x-debug-user:demo:planner:planner'
unread: 7 | decision_alert todos: 7
  - 决策告警 C16 :: C16 齐套缺口预警: 违反约束（MaterialBalance.gapTon > 0）。建议处置：空运补料（因素：物料齐套）。可一键采纳生成审批工单。 | refType=decision_alert refId=C16:mbal-1
  - 决策告警 C08 :: C08 外协比例红线: 违反约束（Order.outsourceRatio > 0.3）。建议处置：工艺路线调整（因素：瓶颈工序 · chengdu）。可一键采纳生成审批工单。 | refType=decision_alert refId=C08:chengdu
  - 决策告警 C08 :: ...（changzhou）
  - 决策告警 C06 :: C06 物料齐套缺口口径(MRP): 违反约束（MaterialBalance.gapTon > 0）。建议处置：空运补料（因素：物料齐套）。可一键采纳生成审批工单。 | refType=decision_alert refId=C06:mbal-1
  - 决策告警 C03 :: C03 产能上限约束: 违反约束（Order.demandDelta > 0.5）。建议处置：工艺路线调整（因素：瓶颈工序 · jiangmen）。可一键采纳生成审批工单。 | refType=decision_alert refId=C03:jiangmen
```

越线命中（C03/C06/C08/C16 等，demo Orders/MaterialBalance 含确定性植入越线行）→ 每条告警带
mitigation_select 推荐处置案（空运补料 / 工艺路线调整 …）→ push 给 planner，refId 可定位规则+基地。

## 4. 自动化门（绿测试）

- `apps/datacore/test/wo-alert-decision-push.test.ts`（3 用例）：
  - 越线 → decision.alert（带 mitigation 建议）真落 outbox + GET /a/v1/outbox 可见 + planner 待办可拉取；
  - R6 确定性：两次扫描 decision.alert 因素/推荐/去重键内容指纹一致；
  - R2 租户隔离：demo 扫描不向他租户 push 待办。
- `pnpm -r build`（全 4 包）✅；`pnpm --filter datacore test` ✅；`pnpm --filter frontend-shell test` ✅；`pnpm gates` ✅。

## 5. 前端消费（notifications / approval-inbox）

- 通知中心 `NotificationsPage`（`/admin/notifications`，query `["a","notifications"]`）列 kind=decision_alert 待办
  + 标记已读 + 按 refType/refId 跳转。
- 审批/处置收件箱 `ActionsPage`（query `["a","action-drafts"]`）：用户"采纳"待办 → 经既有 adopt_mitigation
  Action 进审批链。
- 实时点亮：`eventInvalidation.ts` 把 `decision.alert` 映射到 notifications + approval-inbox 标签，
  全局事件流（useDomainEventStream 轮询 /a/v1/outbox）拉到该事件即失效缓存 → 被动页自动刷新（不必重登/手动刷新）。
- 浏览器截图：本环境无可用真浏览器渲染管线，前端经 `pnpm -r build` + `pnpm --filter frontend-shell test`
  绿验证；真浏览器实拍留审核方（诚实注明）。

## 6. 距北极星

北极星（§1）：用户在任一业务页问任意决策问句 → 基于本页真实多源数据、带置信度与溯源、可一键转审批的答复。
本工单交付 D6 主动 PUSH 闭环（监控→告警→处置建议→待办），补齐"决策支撑 vs 问答看板"的命门之一。
仍差（非本工单）：D7 出站执行（actuation 到 ERP/MES，WO-ACTUATE）· D8 企业级（协同决策台/SLA/Decision 记录）·
告警→处置建议当前以 demo battery 域 mitigation 方案库为案源，跨行业方案库泛化随 R14 配置驱动后续扩展。
```
