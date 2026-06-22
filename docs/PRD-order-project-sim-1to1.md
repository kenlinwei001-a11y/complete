# PRD · 项目推演 / 订单全链推演（order）参考原型 1:1 复刻（含 model 型号产能推演融入）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-22 · 前端+求解器+生成器 |
| 取代/扩展 | 子 PRD（隶属 `PRD-reference-views-1to1-roadmap.md`，1:1=100%、色调/字体可调）· 复用 cockpit PRD 提案求解器 `order_fullchain` · model(型号产能推演)按 roadmap §0 作横切增强**融入本视图**（不占独立导航） |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§2/§3/§5 R6/R13/R14）· `docs/reference-prototype-decision-platform.html`（`buildOrderView` L3341 · `orderJudge` L3230-3260 · `odNodes` 11节点 L3263-3302 · 三判明细表 L3365-3388 · `renderProjModel` 6步 L3728 · `ORDERS`/`MODEL_DEF`/`ORDER_OVR`/`BOM_T`/`SEG_FLOOR` L1542-1586）· `apps/frontend-shell/src/views/plan/OrderChainView.tsx`（318 行，稀疏）· `apps/frontend-shell/src/views/sim/ProjectSimView.tsx`（1049 行，型号产能近 1:1）· `apps/frontend-shell/src/views/sim/PmDag.tsx` · `apps/datacore/src/solvers/risk.ts`（`affectedOrders` :270 · `buildOrderProblems` 4 类 :439-542） |

> 一句话：本视图分两面——**型号产能推演（model）系统已 ~70% 到位**（`ProjectSimView` 六步法 + 可产网络收敛 + what-if + 批量 + DAG，`capacity_forecast` 活算）；**订单全链推演（order）系统是最大缺口**（`OrderChainView` 现为"问题归并 4 类"，缺 HTML 的**订单选择器 + 6 KPI 卡 + 统一结论(可接/提价接/不接) + 11 节点业务建模链 DAG + 三判明细表(交期/齐套/财务) + C18 现金闸 + 采纳→Action**）。做法：把 cockpit PRD 提案的 `order_fullchain` 求解器落地（产逐单三判 + 11 节点 DAG），`OrderChainView` 增订单中心交互；ORDER_OVR/BOM_T 等精确值入生成器种子（R14/R6）。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2.E）：`Solver(order_fullchain)`（新，cockpit PRD 提案 → 此处落地：逐单交期/齐套/财务三判 + 统一结论 + 11 节点 DAG）·`Solver(capacity_forecast)`（型号产能，已在）·`Order/Model/Base/Line/Material/Customer/ARInvoice/Shipment/PurchaseOrder`（11 节点业务建模链对象，已在本体）·`Rule(C02/C03 交期·C06/C16 齐套·C13 信用/C15 毛利线/C18 现金 财务·C08 外协·C10 采纳留痕)`·`ActionType(采纳订单结论→生成工单/合同)`·`Principal`（owner，接骨架 PRD）。
- **触及链路**（§3）：`订单 Order → {可产网络(Model→认证产线→Base) · BOM展开(正极净需求) · 单价与细分(价格表→毛利) · 信用档案(应收→额度→舆情)} → 三关联判{①交期(聚合周供给 vs 周需求 P50/P90) · ②齐套(MRP净算 BOM−库存−在途) · ③财务(C15毛利→C13信用→C18现金 三闸)} → 统一结论(可接/提价接/不接) + 对冲条件 → 采纳 Action(C10留痕→工单/合同)`。**型号面**：`型号 → 收敛可产网络 → 装载因子(爬坡×检修×认证) → 聚合求解(P50/P90) → 瓶颈定位 → 结论与对策(夜班/扩通道/外协≤20% C08)`。
- **触及事件/数据流**（§4）：`affected_orders`/`order_fullchain` 即时算；采纳走 `action.executed`（R4 写真相）。
- **触及不变量**（§5）：R14（订单/型号/BOM/价格/信用文案与阈值配置化，ORDERS/ORDER_OVR/BOM_T/SEG_FLOOR 仅作生成器种子，前端零写死）· R6（三判同输入字节一致）· R13（11 节点每节点 formula+输入表+来源系统+新鲜度+本体链路+规则可溯，与 HTML `odDet` 同深）· R-一致（周供给口径与产能推演/S&OP/季度同源 C02；齐套口径同 S&OP ③ MRP C06）· R4（采纳走 Action）。
- **关闭/影响断点**（§8）：G-5（应用层电池锁死，去 OrderChainView 硬编码）；与 cockpit PRD `order_fullchain`/`order-ledger` 归一。
- **门禁**（§7）：`debattery:check`·`chain:check`（order_fullchain 注册 + 11 节点链路登记）·`ontology:check`·前端回归（order-chain + project-sim testid）·FDE 亲手跑（逐单三判 + 型号六步）。
- **回写承诺**：`order_fullchain` + 11 节点链路 + C18 现金闸接入 → 回写本体 §2.E/§3/§7。

## 1. 目标 / 非目标（1:1=100%，色调/字体可调）
### 目标 — 订单全链推演（order，主缺口）
1. **订单选择器**：下拉选 SO（ORDERS 24 单，含 cust/model/qty/due/pri），系统现无（`OrderChainView` 仅问题卡）。
2. **6 KPI 卡**：数量×细分/型号 · 交期(可达/紧张) · 齐套(正极缺口) · 订单收入 · 毛利率 vs 线 · **统一结论框**（可接/提价接 X%/不接，色 #62BE77/#E8B54A/#DD7E9E）。
3. **三关联判逻辑 `orderJudge` 1:1**：①交期判（P50 周供给≥周需求 / P90 折扣，C02/C03）· ②齐套判（gapT=正极需求×(1−覆盖) MRP 净算，C06/C16）· ③财务判**三闸**（C15 毛利线 → C13 信用 → **C18 现金**，系统现缺 C18）→ 结论 + 对冲条件 conds[]。
4. **11 节点业务建模链 DAG**：`so → {net 可产网络 · bom BOM展开 · eco 单价与细分 · cred 信用档案} → {jcap ①交期判 · jkit ②齐套判 · jfin ③财务判} → vrd 结论`（9 条边），点击节点看 logic/formula/输入表/来源/本体链路/规则（同 HTML `odDet` 深度）。系统现为 4 层简化链（CHAIN_TITLES L28-30），**补足为 11 节点**。
5. **三判明细表**：① 交期·产能关联判表 · ② 齐套·MRP 关联判表 · ③ 财务·经营关联判表（HTML L3365-3388）。
6. **采纳 → Action**：结论携对冲条件 → `POST /a/v1/action-drafts`（C10 留痕→工单/合同），系统 `useActionDraft` 已在但 OrderChainView 无按钮。
7. **页面级 AI 对话**：order 预设 QA（这单能不能接/为何提价/卡在哪一判）。

### 目标 — 型号产能推演（model，融入·已近 1:1）
8. **保持六步法**（解析需求→收敛可产网络→装载因子→聚合求解→瓶颈定位→结论对策）+ what-if（夜班/通道/外协≤20% C08）+ 批量编辑器 + CSV 模版 + `PmDag` 步进点亮——系统已有（`ProjectSimView`）。
9. **补"型号→已认证产线→基地 收敛"显式标注**（HTML"只点亮相关网络"；系统 perBaseRows 已按型号过滤但 UI 无注解）。

### 非目标
- 不重写 capacity_forecast 数学（型号面已对齐）；订单面补 order_fullchain，不改 affected_orders 既有 4 类（作为问题归并保留为超集）。
- 不前端写死订单/型号/BOM/价格（取求解器+种子）。

## 2. 现状与缺口（HTML vs 系统，带 file:line）
| HTML 元素 | 系统 | 缺口 |
|---|---|---|
| 订单选择器（ORDERS 下拉） | ❌ `OrderChainView` 无 | 补订单中心选择 |
| 6 KPI 卡 + 统一结论框 | ❌ 仅 summary bar（orderCount/qty/cust/rev L104-136） | 补 6 卡 + verdict |
| `orderJudge` 三判→统一结论 | ◐ `buildOrderProblems` 4 类级联（risk.ts:439-542） | **改为逐单三判 + 统一结论（order_fullchain）** |
| ① 交期判 C02/C03 | ✅（affected_orders dueDay/capacity） | 并入三判表 |
| ② 齐套判 C06/C16 | ✅（kitGapDays） | 并入三判表 |
| ③ 财务判 C15/C13/**C18** | ◐ 有 C15/C13，**缺 C18 现金闸** | **补 C18 现金判** |
| 11 节点 DAG（9 边） | ❌ 4 层问题链（CHAIN_TITLES:28-30） | **补 11 节点业务建模链** |
| 节点详情深度（formula+输入表+新鲜度+链路+规则） | ◐ Provenance 稀疏（L110-135） | **加深到 HTML odDet** |
| 三判明细表 ×3 | ❌ | 补 3 表 |
| 采纳→Action 留痕 | ◐ useActionDraft 在、按钮缺 | 补采纳按钮 |
| 型号六步法 + what-if + 批量 + DAG | ✅ `ProjectSimView` | 保留（近 1:1） |
| 型号"可产网络收敛"显式标注 | ◐ 隐式（perBaseRows 过滤） | 补 UI 注解 |

## 3. 设计
### 3.1 `order_fullchain` 求解器（订单面核心，落 cockpit 提案）
- 输入：SO（model/qty/due/cust/pri）+ ORDER_OVR（信用/议价偏移种子）+ BOM_T/SEG_FLOOR/SEG_PRICE/MODEL_DEF.bases（生成器派生）。
- 处理：① 交期（Σ可产基地周供给×认证 vs qty/周，P50/P90）② 齐套（正极需求=qty×BOM_T − 覆盖 → gapT + 最早齐套日，MRP）③ 财务三闸（m0 vs SEG_FLOOR=C15 → 信用额度=C13 → 现金垫 13 周≥50=**C18**）→ 统一结论（信用阻断>毛利提价>交期/齐套对冲）+ conds[] + 11 节点 DAG（nodes/edges/每节点 det）。
- 输出形状声明（service.ts SOLVER_OUTPUT_SHAPES）：`["verdict","vc","kpis","judges(cap/kit/fin)","conds","dag(nodes,edges)"]`；注册 SOLVER_KEYS + chain + graphmeta ruleRefs。
- R6 确定性（hash 偏移固定种子）；R13 每节点携 inputs[源系统,新鲜度]+chain[本体对象]+rule。
### 3.2 `OrderChainView` 前端（订单中心）
- 顶部订单选择器 → 6 KPI 卡 + 统一结论框 → `order_fullchain` 即时算（useLiveSolver）→ 11 节点 `<ProvenanceDag>`（点击节点抽屉：logic/formula/输入表/来源/链路/规则）→ 三判明细表 ×3 → 采纳按钮（Action）。
- 保留现"问题归并 4 类"作为下方超集面板（affected_orders，跨单视角）。
### 3.3 型号产能推演（ProjectSimView 微调）
- 六步②"收敛可产网络"补标注"型号 X 仅在 N 基地/产线可产，只点亮相关网络"（取 MODEL_DEF.bases 派生）；其余保持。
### 3.4 数据管线（R14）
- ORDERS（24 单）/ORDER_OVR/BOM_T/SEG_FLOOR/SEG_PRICE/MODEL_DEF 入电池域生成器种子，三判全由求解器实算，前端零写死。

## 4. 契约 / 端点
- `contracts/solvers.ts`：新 `OrderFullchainOutput{verdict,vc,kpis,judges,conds,dag}`；`order-ledger` widget（cockpit）复用。
- 端点：`POST /a/v1/solvers/order_fullchain/invoke`（逐单）· 复用 `affected_orders`（跨单问题）· `POST /a/v1/action-drafts`（采纳）。

## 5. 关键流程
选 SO → order_fullchain 三判 → 6 KPI+结论+11节点DAG+三判表 → 点节点看溯源 → 采纳→Action(C10→工单)。型号面：选型号→六步收敛→P50/P90+瓶颈+对策。

## 6. 非功能（§5）
R14/R6/R13/R-一致/R4；三判确定、口径与产能推演/S&OP 同源。

## 7. 验收（DoD = 100% 1:1，色字可调）
- 订单选择器 + 6 KPI + 统一结论（三色）到位；**三判含 C18 现金闸**。
- **11 节点 DAG（9 边）+ 节点溯源深度=HTML odDet**；三判明细表 ×3 到位。
- 采纳→Action(C10) 通；问题归并 4 类作超集保留；型号六步法保留 + 可产网络收敛标注。
- 数据走管线、前端零写死（`debattery:check`）；同 (industry,seed) 字节一致（R6）。
- `pnpm -r build && pnpm -r test` 全绿（order_fullchain + order-chain/project-sim 回归）；`chain:check`/`ontology:check` 过。FDE 亲手跑逐单三判 + 型号六步。
- 回写本体 §2.E/§3/§7。

## 8. 分期
- **ORD.1** `order_fullchain` 求解器（三判 + 统一结论 + C18 + 11 节点 DAG）+ 契约 + 种子。
- **ORD.2** `OrderChainView` 订单中心（选择器 + 6 KPI + 结论 + DAG + 三判表 + 采纳 Action）。
- **ORD.3** 节点溯源深度 + AI 对话 + 型号"可产网络收敛"标注 + 全链回归。

> 依赖：`order_fullchain` 与 cockpit PRD `order-ledger`/`PlanKpi` 归一；owner 接骨架 PRD `Principal`。model 面已近 1:1，工作量集中在 order 面。基线分支：前端(OrderChainView)+求解器+生成器，冲突中等。
