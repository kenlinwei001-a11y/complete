# REVIEW · BIZVIEW-DOWNSTREAM → ✅ DONE（业务视图去死路 + 权威值接线·真跑闭合）

> 审核方真 curl + 真浏览器（chromium + 真 datacore4001/vite5200）逐条闭合。3 处 IPO 断口(台账下游死路/订单全链旁路自算/geo focus 空跳)全治。判决 DONE。

| # | 断言 | 证据 | 判 |
|---|---|---|---|
| C1 | 台账下游导航去死路 | `/v/order`(viewKey=order·renderer=ledger)24 行·展开出 3 深链(`ledger-whatif`/`ledger-orderchain`/`ledger-action`)·点「看订单全链」→**真跳 `/v/order-chain?focus=SO-3391`**(非仅 toggleSelectedObject 死路) | ✅ |
| C2 | 订单全链权威值(非旁路自算) | curl `affected_orders.marginLedger.gmRatePct=16.13`·`reconciled=true`；OrderChainView 接 `MarginLedgerTable`(读 out.marginLedger·与驾驶舱同源)·旧前端 Σgp/Σsales 自算值降级诚实标「估算」(营收×行业占比·并列不混淆) | ✅ |
| C3 | geo→graph focus 不空跳 | `/v/geo-map` 选基地→`geo-goto-graph`→跳 `/v/graph?focus=n-Base`·图谱**真渲 150 节点**(非空跳)·OntologyGraphView 大小写不敏感匹配(`n.id.toLowerCase()===f`)治「n-base≠n-Base 空跳」 | ✅ |
| C4 | mock/test 对齐真后端键 n-${key} | 牙齿 `bizview-downstream.test`(2)+`f7.graph`(2)+`f25.graph-viewpoints`(5)=**9/9**·fixtures/测试节点 id 归一 n-Base(不再小写 n-base 掩盖不匹配) | ✅ |
| C5 | 四包全绿 | build 退0·9 牙齿绿·其余不回退 | ✅ |

## 治法
①台账 LedgerView 展开区加 3 下游深链(what-if/看订单全链/起 Action 草案·复用现成 openWhatIf/navigate/useActionDraft)——选中不再是无出口死路。②OrderChainView 综合毛利率改接权威 `out.marginLedger`(reconciled✓·与驾驶舱同一 affected_orders 求解器)·旧旁路自算值诚实降级「估算」标(治「前端旁路自算黑箱·与驾驶舱口径不一致」)。③GeoMapView 焦点键用真后端 `n-Base` + OntologyGraphView 大小写不敏感匹配(治「n-base 小写与 {id:n-Base} 不匹配→图谱空跳软死路」)。

## 本体引用与影响
- 断点：G-VIS-1(后端权威值前端旁路/导航死路·本单闭 3 处)·R17(下钻不跳死路·就地下游)。
- 不变量：R-一致(订单全链毛利率与驾驶舱同源 marginLedger·治双口径)·R13(旧自算值诚实标估算不冒充权威)。
