# WO-ORDERCHAIN-DAG-DRILL · 逐单根因链 / 全链推演 DAG 节点下钻接线（死交互治本）

> 用户亲报（截图）：「排产推动/瓶颈紧张 · 逐单根因链（订单 → 判定 → 根因 → 对策）」弹窗里点击每个 block **无法下钻**。
> 审核方定位：不是坏了，是**从未接线**——`ProblemDag`（`OrderChainView.tsx:556`）与 `OrderFullchainPanel` 的 `ofc-dag`（`:498`）都调用 `LayeredDag` **却未传 `onNodeClick`**；`LayeredDag` 仅在收到该回调时才给节点 `role="button"`/`tabIndex`/`onClick`（`LayeredDag.tsx:104-107`），否则渲染为纯静态 SVG `<g>`（空操作、不可聚焦）。同组件在 `PmDag`（沙盘/项目推演）已接下钻——所以是**「接了一半」的遗漏**，非设计上只读。

## 1. 根因与判据

- `LayeredDag` 节点交互是**条件式**的：`role={onNodeClick?"button":undefined}`、`onClick={()=>onNodeClick?.(n)}`。未传回调 → 点击=`undefined?.()`=无反应。
- 两处订单链 DAG 均未传 `onNodeClick`：`problem-dag`（逐单根因链，用户截图处）、`ofc-dag`（全链推演 11 节点）。
- 交互完整性普查 Phase-1 漏抓：SVG `<g>` 节点非 `<button>`，「死按钮」枚举扫不到——需补判据「本应可下钻的 DAG 节点却无 handler」。

## 2. 目标下钻语义（用户定：每层各自专属目标·治本·不靠文案解析）

**逐单根因链 `problem-dag`（4 层，per-order）**——后端每节点补 typed `ref`，前端分层路由：

| 层 kind | 目标 | 路由 |
|---|---|---|
| `order` | 订单 360 | `/o/order/{orderId}`（R17 统一 DrillBack 可回） |
| `judgement` | 该订单「全链推演」三判明细（cap/kit/fin） | 关弹窗 → 设 `OrderFullchainPanel` so={orderId} → 滚动定位 + 高亮对应判（由 ref.extra.judge 指定） |
| `rootCause` | 风险看板对应瓶颈类 | `/v/risk?category={riskCategory}`（根因即风险类目） |
| `remedy` | 行动/审批（采纳 plan_change） | 触发 `adopt.mutate({actionTypeKey:"plan_change", payload:{so, ...}})` 或跳行动视图（由 ref.key 指定 actionTypeKey/planId） |

**全链推演 `ofc-dag`（节点 kind=object|solver|agent）**——按既有 kind 路由（节点已带 kind）：object→`/o/{type}/{key}`；solver→求解器目录 `/v/graph-solver` 或求解器详情；agent→Agent 详情。若节点缺可路由的 key → 后端补 `ref`/`objectKey`（同 problem-dag 口径）。

## 3. 契约 / 后端 / 前端改动

- **契约** `packages/contracts/src/planviews.ts`：`OrderRootChainSchema.layers[]` 加 `ref: z.object({ kind: z.enum(["object","judge","risk","action"]), key: z.string(), extra: z.record(z.unknown()).optional() }).optional()`。`ofc` 的 `dag.nodes[]` 若缺 key 则加 `ref`（同枚举）。**optional 向后兼容**（旧响应无 ref → 前端回退：仅 order 层可点 360，其余保持只读——不新增死点）。
- **后端** `apps/datacore/src/solvers/risk.ts`（`buildRootChains` ~`:900-950`）：逐层派 `ref`，**完全确定性**（从订单属性 + 规则口径推导·`:854` 已声明零随机·R6）：
  - order → `{kind:"object", key: orderId}`
  - judgement → `{kind:"judge", key: orderId, extra:{judge: root→cap|kit|fin 映射}}`
  - rootCause → `{kind:"risk", key: bottleneck/category}`
  - remedy → `{kind:"action", key: planId ?? actionTypeKey}`
  - `order_fullchain` 求解器 dag.nodes 同理补 ref（object/solver/agent）。
- **前端** `apps/frontend-shell/src/views/plan/OrderChainView.tsx`：
  - `DagNodeDef` 增 optional `ref`（透传，不改渲染契约）；`ProblemDag` 节点 push 带 `ref: layer.ref`。
  - `ProblemDag` 传 `onNodeClick={(n)=>routeByRef(n.ref, chainOrderId)}`；`OrderFullchainPanel` 的 `<LayeredDag>` 同样传 `onNodeClick`。
  - `routeByRef`：object→`navigate(/o/...)`；judge→`setOpenProblem(null)`+设 fullchain so+scroll；risk→`navigate(/v/risk?...)`；action→`adopt.mutate(...)`。缺 ref → 静默（不报错·回退只读）。

## 4. 验收（真浏览器 + 齿检 + 门）

- **真浏览器逐值**：真登录 demo→OrderChainView→点「待解决问题」卡开弹窗→**逐块点击**：order 块→URL 变 `/o/order/SO-xxxx` 且订单 360 加载真值；judgement 块→定位到该订单全链推演三判；rootCause 块→风险看板过滤到该瓶颈类；remedy 块→行动/审批触发。ofc-dag 同验。**每块 `getComputedStyle` 有 `cursor:pointer` + `role=button` + 键盘 Enter 可达**。
- **齿检** `test/orderchain-dag-drill.test.tsx`：渲染 ProblemDag→断言各层节点 `role="button"`+`tabIndex=0`+点击调用 navigate/adopt（mock）+ ref 路由分派正确。**牙齿**：还原去掉 `onNodeClick` → 节点失去 role=button（测试转红）。
- **门（可选加固）**：交互完整性门补 SVG DAG 节点判据——「渲染 LayeredDag/ProcessDag 的节点若语义应可下钻却无 onNodeClick」列基线，ratchet 收窄。防再退回死交互。
- 四包 `pnpm -r build && pnpm -r test` 绿；R6：同订单同参数重跑 ref 字节一致。

## 5. 《本体引用与影响》

- **对象类型**：Order（§2）、RiskItem/瓶颈、Action/Mitigation（plan_change）、Judge（cap/kit/fin 三判）。
- **链路**：订单 → 判定 → 根因 → 对策（逐单根因链，§3 / §7.16 order_fullchain 推演链）——本 WO 让链路节点**可导航到各自一等对象**，闭合「看得到→点得动→下钻到真对象」。
- **断点**：G-death-interaction 家族（同 GRAPH-3/4 Object360 死交互 CONCERN）——DAG 节点死交互补齐；回写 §8 该断点状态（◐→部分闭合：订单链 DAG 下钻接线）。
- **事件**：无新增域事件（UI 导航；不落库）。若 remedy→adopt 触发 plan_change，走既有 Action 审批链（§6）。
- **不变量**：R6（ref 确定性派生·零随机）；R17（统一 DrillBack 可回）。
- **回写**：`docs/SYSTEM-ONTOLOGY.md` §8 G-death-interaction 状态 + §3 根因链节点可导航；`pnpm ontology:slices` 重生成。
