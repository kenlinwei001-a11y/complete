# 轨A 沙盘 P0 修复 · UI tick→传导哑（快照键 ≠ 真物化对象 id）

> 复审打回（P0 必修）："deriveBaseSnapshot 把快照键建成 `${typeKey}#0`（如 Order#0），但引擎 propagation.ts:153 认真物化对象 id（如 obj_order_SO-3391）→ sourceVal = state[sourceId] ?? 0 恒为 0 → tick 不传导、PmDag 节点不变色。引擎本身真活（直接喂真 id 有传导），是 UI 快照键映射错。"

## 1. 根因（已核）
- 引擎 `apps/datacore/src/sim/propagation.ts:124-157`：`idsByType` 来自真物化对象（`repos.objects.listByType` → `o.id`），`sourceVal = state[sourceId]?.[var]`。
- UI `SandboxView.tsx`/`SimInitWizard.tsx` 的 `deriveBaseSnapshot` 把 state 键建成 `${typeKey}#0` → 与引擎真 id 不匹配 → 恒 0 → 不传导。

## 2. 修法（让快照键 = 真物化对象 id · 评审建议一）
- **契约** `SandboxViewConfigSchema += nodeObjectIds?: Record<typeKey, string[]>`（每类型真物化对象 id，= 引擎 idsByType 同源）。
- **后端** `GET /a/v1/sim/view-config`：从 `repos.objects.listByType`（非 mergedInto，稳定排序）填 `nodeObjectIds`——与 tick 建图同源同序。
- **前端** `deriveBaseSnapshot`（SandboxView + SimInitWizard 两处同改）：快照键 = `cfg.nodeObjectIds[t]` 各真对象 id（空世界退 `${t}#0` 占位仍可跑）；`buildNodes` 节点着色 = 该类型所有真对象当前态均值。

## 3. 真跑验证（API + 真浏览器，非测试绿）

**① API（state 真随 tick 变）**：起真 datacore(SEED_DEMO·种 3 PUBLISHED PropagationRule)。
- view-config `nodeObjectIds` 真填：Base:12(`obj_base_changzhou`…)/Model:6(`obj_model_2170-NCM`)/Order:24(`obj_order_SO-3391`)/Line:12。
- 用真 id 快照建会话(READY) → **tick1：trace 40 条真传导贡献**（如 `obj_model_2170-NCM → obj_base_wuhan amount=12 via model_producible_at`）；
- **`obj_model_2170-NCM.demandLoad: 20 → 149.6`**（真随 tick 变；修前键不匹配恒 0 不变）。

**② 真浏览器（PmDag 节点真变色）**：chromium-1194 + vite dev + 真后端。admin 登录 → /v/sim-sandbox → init → 点「推进 tick」：
- 节点 Σ 值 before `[54,51,50,44,47,48]` → after `[54,51,**56**,44,47,48]`（节点态/颜色真变化——传导真活）。
- 截图：`shot-sandbox-tick-before.png` / `shot-sandbox-tick-after.png`。

## 4. 门/测试
`sim:check` 绿 · `ontology:check` 绿 · datacore sim-session/sim-propagation 17/17 · frontend sandbox-p0/sandbox-view/sim-init-wizard 10/10 · 契约 nodeObjectIds 加性 optional（不破存量 config 字面量）。

## 5. 诚实边界（P1 待办，不标"全闭"）
本修仅闭 P0（tick→传导→节点变色真活）。P1 五项仍未做：双雷达(6+4维)/AI 指挥台(NL 驱动沙盘)/逐对象就绪%/数据管道 DAG/R13 溯源悬浮——逐项做完逐项附证据。
