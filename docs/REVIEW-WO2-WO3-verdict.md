# 评审核发 — WO-2（A6 求解器读出过滤）+ WO-3（信封契约对齐）

> **角色**（铁律0.5）：审核方独立真跑复验（curl 真 socket + 真浏览器实拍 + 独立审计），非信 dev 单测/截图。
> **核发**：**WO-2 = 闭合 ✅ · WO-3 = 闭合 ✅**（含审核方追加的「防同根复发」端点全审计，结果干净）。

## WO-2 · A6 行级过滤补到求解器读出层（9500750）= 闭合 ✅

- **真值判据复验（curl·真 socket·非 app.inject 单测）**：`POST /a/v1/solvers/{solver}/invoke`
  | 求解器 | base_manager:常州 | admin |
  |---|---|---|
  | `capacity_rollup` | **bases=1 → [changzhou]** ✓ | bases=12 ✓ |
  | `bottleneck_matrix` | **rows=1 → [常州]** ✓ | rows=12 ✓ |
- **对码**：`solvers/service.ts` 读出型求解器（`A6_READOUT_SOLVERS={capacity_rollup,bottleneck_matrix}`）经**同一策略引擎**（`authz.decide`+`rowAllowed`）过滤 Base/Line/Order，**复用 query_objects 同一套**（杜绝平行漏过滤·根因解）。
- **单测**：`solver-rowlevel.test.ts` 4/4 绿（含 2 新 WO-2 例 + 2 回归锁）。
- **本体回写**：§2.B Policy(A6) 标「WO-2 真闭 solver 读出」——属实（此前声明覆盖、实测全量不过滤 → 现真闭）。
- 诚实边界（dev 自承·合理）：`affected_orders` 等跨基地推演求解器 A6 仍作用于订单结果（visibleOrders），不过滤拓扑入参以保计算语义。

## WO-3 · 前端↔DataCore 响应信封契约对齐（6ab1575）= 闭合 ✅

- **真值判据复验（真浏览器实拍·我此前实测此二页 live 崩）**：
  | 页面 | 结果 |
  |---|---|
  | `/admin/quarantine` 隔离区 | **✓未崩**·渲染表头 + 空态「隔离区为空 ✓」·**0 pageerror**（实拍 `wo3v-quarantine.png`） |
  | `/admin/validation` 验证引擎 | **✓未崩**·空态·0 pageerror（实拍 `wo3v-validation.png`） |
  导航回对象浏览器正常（不卡错误屏）。
- **对码**：`endpoints.ts` `fetchValidationRuns`/`fetchQuarantine` 由谎报裸数组改为 `api.a<{items:T[]}>().then(r => Array.isArray(r?.items) ? r.items : [])`（取 `.items` + Array 守·缺失→空态非崩·R1 不重声明契约形状）。
- **审核方追加·防同根复发全审计**（curl 真 socket 核 20 个前端「裸数组」端点的后端真实返回形）：**仅 `validation/runs` + `quarantine` 是 `{items}` 信封**（已修）；其余 18 个后端真返裸数组（`tenants` 的 `{` 实为 FORBIDDEN 错误信封·platform_admin only·前端 `(tenants ?? [])` 已优雅守，且 platform_admin 成功响应实测为裸数组）。**无其它同根漏网**。
- **本体**：纯契约对齐·无链路/对象/门禁变更 → 不回写（符合 WO-3 单要求）。

## 核发结论
- **WO-2 闭合**：base_manager 三求解器只见本基地、admin 全见，真 socket 实证；根因解（共享 filter 复用 query 同套）。
- **WO-3 闭合**：两崩页真渲染不崩（实拍）+ 端点全审计无同根漏网。
- 连同已核发：lastmile / WO-1(1A·1B) / A6 尾巴① / 四链路走查 / 结构化接入臂补验。**剩余待 dev**：WO-Q1(Path B 流式) · 1C(抽取解析率) · A6-T2(真 socket e2e 固化)，见 `DEV-TODO-reviewer-open-items.md`。
