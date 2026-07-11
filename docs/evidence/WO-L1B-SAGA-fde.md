# WO-L1B-SAGA · 跨系统 Saga 一致性 — FDE 真跑证据

**WO**：跨系统 Saga 一致性（MES/ERP/WMS 出站步·外部幂等键 + 对账补偿 + 部分失败重放·真 sandbox·暗发·可回退）
**分支**：`claude/vigilant-knuth-b1nmxn` · 基线 HEAD `1d1f808`（L1B-3 durable checkpoint + L1B-5 serve 翻闸已落）
**纪律**：铁律 0.4 / KILL-MOCK-RED（真外部有状态沙盘·非 mock 冒充）· R4（出站反转经 S2·不静默反转）· R6（幂等键纯派生）· NG2/NG6（暗发·可回退）

## 本体引用与影响

- **对象类型**：新增 `ExternalSystem` / `OutboundSagaStep` / `IdempotencyRecord` / `ReconciliationOutcome` / `SagaStepOutcome` / `SagaCompensationOutcome` / `SagaRunState`（`@platform/contracts` saga.ts·§2.H 回写）。
- **链路**：中枢链 `Plan→Step*` 出站段之外的**跨系统事务一致性层**（承 WO-L1B-3 补偿反向序）。
- **不变量**：R2（tenant everywhere）· R4（真值写入 / 反转经 S2 审批·EXECUTED 才落·绝不静默反转）· R6（幂等键 canonical 哈希·无时钟/随机·双跑字节一致）· R13（externalRef 溯源）。
- **门禁**：`workflow-dag:check` EXIT=0 · `ontology-writeback:check` EXIT=0 · `ontology-slices:check` EXIT=0。
- **暗发双闸**：env `QOS_WORKFLOW_SAGA`（agentcore config.ts）+ entitlement `qos.workflow_saga`（**datacore features.ts + agentcore features/registry.ts 双注册**·defaultOn:false）。关闸 = saga path 不启用 = 现行行为字节一致（NG6·additive 新模块不接热路径）。

## 真外部沙盘设计（为何是真去重/真对账·非 mock）

`ExternalSystemSandbox`（`apps/agentcore/src/workflow/saga.ts`）是**真有状态在进程外部系统账本**：

- **真去重**：`ledger: Map<idempotencyKey, LedgerEntry>` 真持有落地记录。第二次同键 `submit` 返**首次回执**且 `applyCount` **不自增**（`deduped=true`）——不是回显 canned 值，是查真账本命中既有条目。
- **真部分失败**：`injectSubmitFault(key)` 令该键 `submit` **真失败且不写账本**（外部态真的不含该键·可安全重放）。
- **真对账**：`reconcile(key)` 查真账本按键返真实落地态（存在→APPLIED / 缺→NOT_FOUND / 已反转→REVERSED / 对账查询注入不可达→UNCERTAIN）。
- **真反转**：`applyReversal(key)` 仅当键确证落地且未反转才置 `reversed`（幂等·**仅经 S2 审批确认后调**）。
- 断言取真值：`appliedCount()`（真落地累计·去重不计）/ `activeKeys()` / `reversedKeys()` / `isApplied(key)` —— 测试对**外部账本一致性**取真值断言，无双落地、无伪补偿。

承 WO-ACTUATE「真 ERP stub·诚实 NOT_CONFIGURED」范式：环境无真 MES/ERP/WMS，故建**真跑的确定性沙盘**驱真 saga，而非 mock 返 canned。

## 真跑 ①：真部分失败 → 幂等重放 → 零双落地（node 驱动 dist）

驱动器 `runOutboundSaga`/`reconcileAndCompensate` 直跑 `apps/agentcore/dist/workflow/saga.js`（三步 saga：MES 建工单 → ERP 记成本 → WMS 出库）：

```
[1] first run  status=PARTIAL_FAILURE failedAt=erp appliedCount=1 steps=mes:SUBMITTED,erp:FAILED
[2] replay     status=COMPLETED resumed=1 appliedCount=3(=3 无双落地) steps=mes:SKIPPED_ALREADY_APPLIED,erp:SUBMITTED,wms:SUBMITTED
[3] compensate status=COMPENSATED S2order=erp→mes activeKeys=0 reversedKeys=2
```

- **[1]** ERP 步真失败（沙盘注入故障）→ saga 停于 `failedAtNode=erp`；外部账本仅 MES 落地（`appliedCount=1`），WMS 未触及。
- **[2]** 修复外部系统后**从落态重放**：MES 对账证已落地 → `SKIPPED_ALREADY_APPLIED`（**不二次出站**）；ERP 补出、WMS 续跑。外部账本 `appliedCount=3`（**非 4·MES 未因重放双落地**）——跨系统零双落地铁证。
- **[3]** 另一 saga（WMS 失败·MES/ERP 落地）对账补偿：**反向拓扑序** `erp→mes` 经 S2 钩子提交反向草案（EXECUTED 才落）→ `applyReversal` 标外部账本 REVERSED；`activeKeys=0`（无有效落地残留）、`reversedKeys=2`。WMS 未落地 → 不在补偿集（never blind-reverse）。

## 真跑 ②：齿检 `apps/agentcore/test/workflow-saga.test.ts`（7 例全绿）

```
✓ R6 · 外部幂等键确定性派生（同输入双跑同键·净荷/节点变则键变）
✓ C1 · 真部分失败→幂等重放·已落地跳过·账本每键恰一次落地（appliedCount=3）
✓ C1 · 真幂等去重：二次 submit deduped 命中·外部态不二次落地（appliedCount=1）
✓ C2 · MES/ERP 落地后 WMS 失败→对账补偿反向序（erp→mes 经 S2 REVERSED）·run→COMPENSATED·activeKeys=[]
✓ C2 · 不可逆步诚实 compensated=false（无 S2 钩子）·run→RECONCILIATION_PENDING·账本未被反转（不伪装）
✓ C2 · 对账不可达（UNCERTAIN）→诚实挂起 RECONCILIATION_PENDING·未盲反转
✓ C3 · 契约对账：SagaRunState / IdempotencyRecord 经 zod 解析
Tests 7 passed (7)
```

## 牙齿自证（green→red·测谎）

中和沙盘去重（`submit` 命中既有键的早返分支运行期短路 → 强制二次落地）：

```
× C1 · 真幂等去重：二次 submit → deduped 命中·外部态不二次落地
  → expected false to be true   （appliedCount 变 2·双落地被逮）
Tests 1 failed | 6 passed (7)
```

revert 去中和 → 7/7 复绿。证账本一致性断言**有牙齿**（不是恒真占位）。

## 诚实边界（钉死）

- 出站反转**必经 S2 Action 审批**（复用 `CompensateHook`·EXECUTED 才落）——绝不静默反转真实世界效果（R4）。
- **不可逆**（无 S2 钩子）/ **对账不确定**（UNCERTAIN·对账查询不可达）步 → 诚实 `compensated=false` + `SagaRunState.status=RECONCILIATION_PENDING`，**绝不伪装"已补偿"**；外部账本保持落地态（不制造幽灵反转）。
- 环境无真 MES/ERP/WMS → 用**真跑确定性沙盘**（真去重真对账真部分失败），非 mock 回显 canned 值。

## 门 / 构建

- `pnpm --filter @platform/contracts build` ✓ · `pnpm --filter agentcore build` ✓ · `pnpm --filter datacore build` ✓
- `workflow-dag:check` EXIT=0 · `ontology-writeback:check` EXIT=0 · `ontology-slices:check` EXIT=0（切片 hash 347bcbb367a66eac）
- `pnpm --filter agentcore test` 全绿（含新增 workflow-saga.test.ts 7 例）
- 双注册：`qos.workflow_saga` 在 agentcore `features/registry.ts` 与 datacore `features.ts` 各恰一次。
