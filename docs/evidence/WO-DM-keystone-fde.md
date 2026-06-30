# WO-DM（keystone·dataMode 推广全求解器 + no-silent-mock 门）— FDE 真值证据

> 源单 DISPATCH §WO-DM。A0 已交付 hollow-data 实质（audit_timeline+13 extended emit dataMode + genuine-sim 门⑦ + audit UI）；本单收尾**全求解器契约层 dataMode + 专门 no-silent-mock 门**，根除"求解器静默哈希/魔数冒充真算"整类。

## 实现

| WO-DM 项 | 落地 |
|---|---|
| ① plan_audit/plan_generate schema dataMode | `contracts/solvers.ts` PlanAuditOutputSchema/PlanGenerateOutputSchema += `dataMode: SolverDataModeSchema.optional()` |
| ② SOLVER_OUTPUT_SHAPES 全带 dataMode | `service.ts` 运行期为每个 SOLVER_KEY 追加 dataMode（46 全覆盖·单一来源·不手改 46 行） |
| ③ 求解器 LIVE/MOCK/PARTIAL | hollow（audit/extended）A0 已自置；PROVISIONAL 沙箱 `invokeArtifact`=PARTIAL；其余读真对象/config 默认 LIVE |
| ④ 运行期保证 emit | `SolverService.invoke` 拆 `invokeRaw`+wrapper：输出缺 dataMode 则补 LIVE（覆盖 ~25 个 early-return 旁路 compute 的求解器） |
| ④ UI 徽章 | `DataModeBadge` 铺到 audit_timeline(A0) + plan_generate(本单·gen-result 头) |
| ⑤ no-silent-mock 门 | `scripts/check-no-silent-mock.mjs`（导入编译产物·断言每 SOLVER_KEY 输出形状含 dataMode）并入 `pnpm gates` |

## 真值证据

- **门 green→red→green**：46 求解器形状全带 dataMode（green）；抽掉 append loop → capacity_rollup/affected_orders/capex_scenario… 缺 dataMode 报红（exit 1）；恢复绿。
- **真起 datacore 逐 invoke**（此前**无** dataMode 的求解器现全 emit）：
  ```
  capacity_rollup=LIVE · plan_generate=LIVE · mrp_netting=LIVE ·
  finance_pnl=LIVE · metric_rollup=LIVE · order_fullchain=LIVE
  ```
  （读真对象/config 派生→LIVE；hollow 仍 MOCK/PARTIAL 见 A0 证据；PROVISIONAL 沙箱→PARTIAL）

## 门

`pnpm -r build` 全绿；`pnpm -r test` contracts/llm-adapters/agentcore354/frontend289/datacore786 全绿（invoke wrapper 加 dataMode 为 additive·不破既有 solver 测）；`no-silent-mock:check` + `css-vars:check` + `genuine-sim:check` + `ontology:check` 绿。本体 §7 回写。

## 距北极星
- WO-DM keystone 闭：契约层诚实位单一来源 + 全 46 求解器输出带 dataMode + 运行期保证 + 专门门 + UI 徽章。
- **WO-DM-tail（#8·P2）**：A1-A4 底层值接真源（yield 真 MES/credit 真财务/loadByWeek 真排程）+ 逐 extended 视图徽章 + SopBalance 兜底簇——dataMode 是诚实披露层，"换真源"是上游真接入（另单）。
