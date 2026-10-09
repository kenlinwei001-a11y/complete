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
