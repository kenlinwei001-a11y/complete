# WO-BIZVIEW-DOWNSTREAM · FDE 真实交付证据（业务视图下游导航 + 权威值接线 · G-VIS-1）

**WO**：业务视图下游导航去死路 + 权威值接线（后端权威值前端旁路自算 / 导航死路 → 治）。
- ① LedgerView 台账对象展开区加下游导航（就此订单开 what-if / 看订单全链 / 起 Action 草案·复用现成通道）。
- ② OrderChainView 综合毛利率/毛利合计接权威 `out.marginLedger`（与驾驶舱同一 affected_orders·reconciled✓·非前端旁路自算）。
- ③ GeoMapView「在图谱查看」focus 用真后端节点键 `n-Base`（此前 `n-base` 小写与 `{id:"n-Base"}` 不匹配→图谱空跳死路）+ 图谱定位大小写不敏感 + mock 对齐真后端键。

**断点**：G-VIS-1（后端权威产物前端旁路自算/导航死路）· R13（结论可导航溯源）。
**红线守法**：复用现成通道（useOpenWhatIf/useActionDraft/MarginLedgerTable）·不新建；econ 表估算口径诚实标（KILL-MOCK-RED 精神·不冒充权威值）。

---

## 1. 改了什么（前端·additive·零回归）

- `views/LedgerView.tsx`（①）：Order 展开区加 `ledger-actions-*`——「就此订单开 what-if 推演」(useOpenWhatIf)、「看订单全链」(navigate `/v/order-chain?focus=<so>` + 写 selectedObjects)、「起 Action 草案」(useActionDraft)。
- `views/plan/OrderChainView.tsx`（②）：渲染 `<MarginLedgerTable testId="oc-margin-ledger" />`（权威综合毛利率·reconciled✓·与驾驶舱同源 affected_orders）；econ 表 total gmRate 加「估算」上标（`oc-econ-gmrate`·营收×行业占比口径·不冒充权威）。
- `views/plan/GeoMapView.tsx`（③）：`geo-goto-graph` focus `n-base`→`n-Base`（真后端键）+ 写 selectedObjects。
- `views/OntologyGraphView.tsx`（③）：focus 匹配大小写不敏感（`n.id/key.toLowerCase()===focus.toLowerCase()`·防大小写不齐空跳）。
- `mocks/fixtures.ts`（③）：GRAPH 节点 id `n-base`→`n-Base`（**mock 对齐真后端键**·真后端 `GET /a/v1/ontology/graph` 亦为 n-Base）；4 处引用测试同步 `n-base`→`n-Base`。
- `mocks/planFixtures.ts`（②）：`affectedOrdersOutput` 补 `marginLedger`（细分毛利率逐贡献勾稽·**mock 对齐真后端字段**·此前 mock 缺 marginLedger）。
- 牙齿 `test/bizview-downstream.test.tsx`（2 用例）：① 展开出三下游按钮 + 点订单全链 location 变；② marginLedger 权威面板 reconciled✓ + econ gmRate 标估算。

## 2. 真三层浏览器 FDE（datacore4101+agentcore4102+前端真构建4105·planner 登录·逐值对照）

| # | 断言 | 真浏览器所见 |
|---|---|---|
| ① | 台账订单展开→下游导航去死路 | 24 行·展开首行→`ledger-actions` 出·what-if/订单全链/Action 三按钮齐·点「看订单全链」→ url `/v/order-chain?focus=SO-3391`（location 变·**非死路**）✓ |
| ② | 综合毛利率接权威 marginLedger（==后端·reconciled✓） | `oc-margin-ledger` 面板出「项目级聚合毛利勾稽·与驾驶舱同源」·乘用车/储能/商用车逐细分·**reconciled 徽章「已闭合 ✓」**·后端 oracle `marginLedger.gmRatePct=16.13 reconciled=true`（前端所见==后端）✓ |
| ②b | econ 表 gmRate 诚实标估算口径（不混淆权威） | econ total gmRate「16.1% 估算」（营收×行业占比·非权威综合毛利率·并列不冒充）✓ |
| ③ | geo「在图谱查看」→图谱聚焦选中 Base（非空跳） | 12 基地·点基地→base card→「在图谱查看」→ url `/v/graph?focus=n-Base`（真后端键·正确大小写）→ graph inspector「生产基地」（**聚焦 Base 节点·非空跳**·此前 n-base 小写空跳）✓ |

后端 oracle：`GET /a/v1/ontology/graph` 首节点 `{id:"n-Base",key:"Base"}`（前端 focus=n-Base 命中）；`affected_orders.marginLedger.gmRatePct=16.13·reconciled=true`。
证据 `docs/evidence/screens/BIZVIEW-order-chain-margin.png`、`BIZVIEW-geo-graph-focus.png`。

## 3. 边界 / 距北极星（诚实）
- ✅ 三处下游导航死路/旁路自算治：台账去死路（三下游通道）·订单全链综合毛利率接权威 marginLedger（reconciled✓·econ 估算口径诚实标不混淆）·geo→图谱聚焦（真后端键·大小写不敏感·mock 对齐）。
- ⚠ mock/真后端两处键对齐（GRAPH `n-Base`·affectedOrders `marginLedger`）——此前 mock 与真后端不齐（`n-base`/缺 marginLedger），本轮对齐（mock 说真话）。
- 🔭 图谱聚焦目前定位到 Base **类型节点**（本体图谱为类型级·无逐实例基地节点）；选中基地 objectId 已写 selectedObjects，后续若图谱增实例层可据此高亮具体基地。

## 4. 门（本轮）
`pnpm -r build` 4 包绿 · `pnpm -r test` 全绿（frontend 366·含 bizview 2 用例 + n-Base 对齐 4 测同步）· `pnpm gates` 绿。
