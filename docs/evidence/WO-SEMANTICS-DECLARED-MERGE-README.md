=== WO-SEMANTICS-DECLARED · 收编说明（2026-10-09）===

## 分支
  claude/semantics-declared @ b6d9d65a6（已推送 git@github.com:kenlinwei001-a11y/complete.git）
  ⚠ 正线是 inspiring-gates-aqczjg（冻结期）。main 严禁当基线（仓规）。
  ⚠ 合并到正线这一步**不由我单方面做** —— 共享分支，且仓规有「落线期间我不 push」一条。

## 收编前置（已做完）
  ✅ ① diff 半径内 **8 个测试文件全绿**，逐个 rc 落盘：
      apps/datacore：deviation-read(4) · finance-worldstate(12) · sim-real-cells(21)
                     · sim-restpoint-shadow-baseline(3) · sim-restpoint-source(7) · worldstate-surface(8)
      packages/contracts：finance-world-charge-basis(4)   RADIUS_CONTRACTS_RC=0
      apps/frontend-shell：exposure-responds-to-perturbation(9)  RADIUS_FE_RC=0
  ✅ ② 五包 build rc=0：llm-adapters · contracts · agentcore · datacore · frontend-shell
  ✅ ③ 本会话核心成果有独立判据（见各 WO-AB-*.txt）

## ⛔ 未验（如实标 NOT-MEASURED，不声称全绿）
  · **全量门**：本机跑不动（896 测试文件 / 负载 442 ≈ 75h）—— 见记忆 four-package-gate-infeasible-on-this-box
  · 未跑到的测试文件一律 NOT-MEASURED，本次不声称「全部测试通过」

## 本分支包含的改动（源码 11 文件）
  apps/datacore/src/sim/propagation.ts(+136) · seed-world.ts(+46+9) · spec-base-synthesis.ts(+9)
  · world-read.ts(+46) · solvers/finance-world.ts(+287) · ontology-signature.ts(+8) · service.ts(+3)
  · synthetic/battery.ts(+255) · app.ts(+87/−17) · sim/drill-orchestrator.ts
  · sim/order-amount.ts(新建) · seed.ts(+8 条描述) · packages/contracts/src/finance-world.ts(+146) · sim.ts(+25)
  ⚠ frontend-shell 的 console0828Model.ts(+207) 属**已删除的「统一推演控制台」**——收编时按仓主裁决取舍

## 收编方审这一支时的四个要点
  1. **语义归位是本支的核心裁定**：15 个量 = DEVIATION（battery.ts STATE_VAR_SEMANTICS）。
     判据：三臂精确线性 · 静息带 1113→0 · 演习世界可核验（priceShock 4.4 = 2+2.4）
  2. **接线：DOMAIN/记账两套账不要混**：seed-world.ts 的 DEVIATION 支必须 cells += 1（本轮修）
  3. **drill 路由：演习 = 普通会话**：用 tickSimSessionWorld（不是裸 simAdvanceTicks）
     且 simAdvanceTicks 的 persist:true 分支现在自身保证推进会话行（源头修）
  4. **未决**：WO-1（传导系数的业务增益独立出处）仍缺外部依据——本支只做到「实现符合描述」

---

## 追加（2026-10-09 第二轮）：WO-DRILL-FINANCE 落地后重跑

### 新增的三处改动（本分支含）
```
① packages/contracts/src/sim-drill.ts   DrillReportSchema 加 finance 字段 + 各事件 routes 加 finance_world_projection
② apps/datacore/src/sim/drill-orchestrator.ts  入参声明 + 原样透传（编排器不自己算）
③ apps/datacore/src/app.ts   drill 路由在【演习世界】上调一次求解器并填进报告
```

### 重跑结果（全部 rc 落盘）
```
✅ diff 半径 8 文件全绿：
   datacore 6 文件 55 测试  RADIUS2_RC=0
   contracts 1 文件  4 测试  R2_CONTRACTS_RC=0
   frontend-shell 1 文件 9 测试  R2_FE_RC=0
✅ 五包 build rc=0（llm-adapters/contracts/agentcore/datacore/frontend-shell）
⛔ 全量门仍 NOT-MEASURED（本机跑不动，896 文件/负载 442 ≈75h）
```

### 收编方需额外注意这一处
`finance` 是**新增报告字段** ⇒ 读它的屏/前端若按老 schema 解析不会报错（`.optional()`），
但要**显示**它得同步加渲染。而**时序是语义**：`finance` 必须在 `tickSimSessionWorld` **之后**取，
`worldId` 必须用 **`drillWorldId`**（用 `s.id` 会拿到没推演过的世界 —— 那正是 WO-DRILL-WORLD 修过的坑）。

---

## 追加（2026-10-10 第三轮）：屏上验收通过（取代此前「⛔ 屏上未验」）

```
✅ 全流真机跑通（真前端 5294 + 真 datacore 4052），同一事件三幅度：
   物料价格变动·电芯壳体 pctChange=3/30/300
     ⇒ 屏上 dc-finance-COST = 98.75 / 987.51 / 9875.05（万元），比值 10.0001 · 9.99995
     ⇒ 与后端直调回包逐位一致（0.009875 / 0.987505 亿），口径浮层（<details>）随行
   证据：docs/evidence/FLOW-MAT-{3,30,300}.txt + .rc + 截图；BACKEND-CROSSCHECK.txt
✅ canAdd 无需改动：上轮「物料价格变动没有主体选择器」是探针假阴性（LIST 档 <select>
   对旧探针不可见）——实据 FORM-DUMP.txt（sel-MATERIAL_REPRICE，8 种料全在）
⛔ 全量门仍 NOT-MEASURED（不变）
```

复跑方法与两个假象的排查（vite 旧 transform 档 / 探针选择器盲区）见 `WO-AB-DRILL-FINANCE-SCREEN.txt`。
本轮**零源码改动**（探针金丝雀已移除，工作树与 58aede7ab 的源码逐字节同）。
