# WO-CAPSIM-IA-UNIFY · M1（可见 surface 收敛）· 真浏览器证据（2026-07-12·dev3）

唯一推演 surface 收敛（§5）第一里程碑：沙盘退役为「产能推演看板下钻态」。纯前端·非破坏（推演能力经下钻保留）。

## 真浏览器（6/6 全绿·截图附）
```
✅ 真登录成功（demo/admin）
✅ 左导航无「推演沙盘/推演初始化向导」（sim.sandbox 开也无·验收①）— 截图 CAPSIM-IA-UNIFY-M1-nav.png
✅ 推演组仍含「产能推演」（唯一 surface 入口在：项目沙盘推演/产能推演/订单聚合）
✅ 裸访问 /v/sim-sandbox → 302 落回产能推演 /v/risk（验收②·先于 entitlement）— 截图 CAPSIM-IA-UNIFY-M1-redirect.png
```

## 改动（纯前端·无死码）
- `ShellLayout.tsx`：删 `extra:"sim-sandbox"` nav 槽 + `simSandboxLinks`/`simSandboxOn`（推演沙盘/初始化向导出左导航）。
- `App.tsx SimSandboxGuard`：裸访问（无 scope/drill 参）→ `Navigate /v/risk`（先于 entitlement·同 geo-map tombstone 口径）；下钻访问（`?whatif=`/`?from=dialogue`/`?from=init` 携参）→ 渲染沙盘下钻态（**推演不丢**·S1-S6 机制不废）。
- `AnswerBlocks.tsx`/`SimInitWizard.tsx`：对话/向导导航携 `?from=` 参 → 命中下钻态（非裸访问）。

## 验证
- 前端 583 测零回归（含新 `sandbox-ia-unify.test.tsx`：裸→302·下钻携参停留；`wo-nav-data-sandbox.test.tsx`：sim.sandbox 开也无沙盘 nav 项）。
- 母体 §2.I 回写（沙盘=产能推演看板下钻态·非独立导航/路由）+ 切片重生成。

## 后续（未落）
- M2：④看板对话态提问框（两态同源 R6）+ ⑤就绪认证→信任条+抽屉（并 WO-SANDBOX-READINESS-UX）。
- 引擎迁入看板 = WO-CAPSIM-REPLICA（P2）。③基地卡『开推演决策』深化 scope-filter 随 REPLICA。
