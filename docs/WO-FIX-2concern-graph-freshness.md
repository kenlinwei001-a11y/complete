# WO-FIX · 2 CONCERN 门红修复（GRAPH-3/4 Object360 死交互 + FRESHNESS 缓存失效）

> 批次核发抓出 2 个"绿测试≠能用"门红（REQ-LEDGER §3·workflow 代码评审 agent 实证）。两处都有精确 file:line 根因 + 修法。dev 直接修，审核方复验。

## FIX-1 · `cc3b152` GRAPH-3/4 · Object360 血缘下钻死交互
- **根因**：`apps/frontend-shell/src/pages/Object360Page.tsx` 引入 `DagNodeDrawer`(L7)+声明 `drawer/setDrawer`(L18)+血缘图 `onSelect` 里 `setDrawer({...})`(L110，含"打开对象360→"导航 action)，但 **JSX 中从未渲染 `<DagNodeDrawer>`**（Slices/Meta/Boundary 三页都有 `{drawer && <DagNodeDrawer.../>}`，唯独 Object360 漏）→ 点血缘节点只 setState、抽屉**永不出现**=死交互。
- **修**：Object360Page JSX 补 `{drawer && <DagNodeDrawer detail={drawer} onClose={() => setDrawer(null)} />}`（对照同 commit 其他 3 页写法）。
- **测**：`wo-graph-3-4-fusion.test.tsx` Object360 那条补 `click(血缘node)→expect(findByTestId("dag-node-drawer"))`（其他 3 页已有此断言·此处漏 → 测试盲点放过死交互）。
- **验**：真浏览器点 Object360 血缘节点 → 抽屉出现 + 导航 action 可用。

## FIX-2 · `6cc1f97` FRESHNESS · invalidateConfidenceCache 零生产调用
- **根因**：`apps/datacore/src/solvers/service.ts:1737 invalidateConfidenceCache` **全代码库零生产调用方**（仅定义+注释）·`syntheticByTenant` 进程内缓存**永不失效** → 纯合成租户首算 `synthetic=true` 缓存后，后续接真实数据（connector sync→materialize）**不失效** → 长跑进程里决策持续误标 SYNTHETIC（"基于合成数据·非真实接入"）=诚实位失真，**正是本 WO 要消灭的**。测试靠手动调 `invalidateConfidenceCache` 掩盖。
- **修**：在改对象 provenance 的写路径调 `solvers.invalidateConfidenceCache(tenantId)`——`synthetic.runJob` / `materialize` / `publish` / 归域后 origin 变处。**或** 去缓存每次实算（数据量小时更稳）。
- **测**：去掉测试里手动 invalidate → 改"接真实数据后**自动**失效"端到端断言（防回潮）。
- **门**：`pipeline-freshness:check` 扩查缓存失效接线（现仅 presence 哨兵·不查失效）。

## 本体引用与影响
- **不变量**：R13（诚实位不失真·FIX-2）·R6（失效确定）。
- **断点**：闭 2 个"绿测试≠能用"接缝（皆 dev 自验绿、审核方代码评审才抓出）。
- **回写**：无新链路·修既有；FIX-2 闭后回写 §4 FRESHNESS 缓存失效门。

---
*审核方门红修复单（design+review·workflow 代码评审实证·钉 file:line）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
