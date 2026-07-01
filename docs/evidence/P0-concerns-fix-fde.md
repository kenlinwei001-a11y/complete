# P0 两门红 CONCERN 修复 · FDE（测试目标+流程+green→red→green 自证）

> 用户令：解决 REQ-LEDGER §3 两个 CONCERN，但**先有测试目标+流程，确保真正解决**（反代理：测试必须修前红、修后绿、断言真实结果非 proxy）。

## P0-1 · Object360 血缘图死下钻（CONCERN cc3b152·R24）
- **根因**：`Object360Page.tsx` import 了 DagNodeDrawer、`setDrawer` 在 onSelect 有调用，但 **JSX 从未渲染 `<DagNodeDrawer>`**（另 3 图页 Slices/Meta/Boundary 都有）→ 点血缘节点死交互。
- **修**：补 `{drawer && <DagNodeDrawer detail={drawer} onClose={() => setDrawer(null)} />}`（与 3 页一致·R13 统一抽屉）。
- **测试目标（用户视角）**：打开对象360页 → 点血缘节点 → **抽屉真弹出**。
- **测试流程（proxy 造不了假）**：`wo-graph-3-4-fusion.test.tsx` GRAPH-3 血缘用例——旧测试只断言图渲染、**漏点击+抽屉断言**（正是 CONCERN）。补：`user.click(血缘节点)` → 断言渲染出的抽屉 DOM `dag-node-drawer` + 内部 `dag-node-src`（**不查 drawer state 变量**）。
- **green→red→green 自证**：删 `<DagNodeDrawer>` 渲染 → 测试红「Unable to find [data-testid=dag-node-drawer]」；补回 → 4/4 绿。

## P0-2 · FRESHNESS 缓存永不失效（CONCERN 6cc1f97·R8）
- **根因**：`syntheticByTenant` 缓存首调填充后永不清；`invalidateConfidenceCache` **零生产调用方** → 接真实数据后求解器 dataMode 仍误标 SYNTHETIC（诚实位失真·长跑越久越假）。
- **修**：`ontology.ts runDerivations`（所有对象写路径 materialize/objectify/合成/publish/连接器 sync 的收口点）末尾调 `this.solvers?.invalidateConfidenceCache(ctx.tenantId)`——真实对象一落库即翻转。保留缓存（applyConfidenceDimensions 每次 invoke 都跑·去缓存会 6× repo 放大），只补失效钩子。
- **测试目标**：租户先全合成→`synthetic=true`；**真实对象走真实写路径落库后（绝不手动失效）**→ 再调→`synthetic=false`。
- **测试流程（proxy 造不了假）**：`solvers.test.ts WO-FRESHNESS①b`——① seedBattery→invoke risk_timeline→synthetic=true（填缓存）；② upload ORDERS_CSV→objectify（→materializeFromReconcile→runDerivations，**测试内绝无手动 invalidate**）；③ 再 invoke→`synthetic=false`。旧 ①②③ 从不测"同租户内 synthetic→real 翻转"（缓存 bug 的盲区）。
- **green→red→green 自证**：去掉 runDerivations 的 invalidate 调用 → ①b 红「expected true to be false」（缓存陈旧仍 SYNTHETIC）；补回 → 51/51 绿。

## 结论
两 P0 均**根因修 + 反代理测试 green→red→green 自证**（测试真咬 bug·非测绿冒充）。datacore 全套 + 前端 graph 测全绿。真浏览器（Chromium 在位）可另拍抽屉截图（组件级真 DOM 点击已证交互真通）。
