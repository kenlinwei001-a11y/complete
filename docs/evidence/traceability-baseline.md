# 轨N 增量0 · 全域可信溯源审计基线（零代码 · 实拍取证）

> 合同：`docs/HANDOFF-trust-traceability-build-and-review-contract.md` §2 增量0。
> 基线 commit：`e218ad5`（轨R 三板块 + QOS packageId 收尾之后）。日期 2026-06-27。
> 方法：全仓 grep 裸渲染规则号 / 裸数字 / 下钻死路 → 真浏览器实拍坐实 → 只看不改。
> 本体：触 **R13 结论可溯源**（§5）/ **G-10 规则一等引用**（§8）。

---

## 1. 裸规则号渲染点（未包 `<RuleRef>` → 悬浮无信息）

| # | 锚点 | 现状 | 真值判据（修后） |
|---|---|---|---|
| **N-R1（铁证·C02）** | `views/plan/OrderChainView.tsx:464-466` | 三关联判规则列 `data.judges.{cap,kit,fin}.ruleRefs.join("/")` **裸文本**——实拍 规则列渲染 `C02/C03`·`C06/C16`·`C15/C13/C18`，**悬浮无任何反应**（见 `N0-orderchain-bare-rules.png`） | 每个 C0x 悬浮出 RuleRef 弹窗（定义/阈值/作用域/严重级/版本） |
| **N-R2** | `components/ProvenanceDag.tsx:133` | 轨R#3 驱动事件层 `{ev.ruleRefs}` **裸 chip**（信用 C13、成本 C15/C24…直接当文本 badge） | event 规则号接 RuleRef |
| **N-R3** | `views/sim/PlanAuditView.tsx:287,294` | 体检卡 `{item.ruleRef}` 渲染成可点 badge，但点开只显"表达式见规则库（/admin/rules）"**纯指针文本**，非 RuleRef 真定义弹窗 | 升级为 RuleRef（就地出定义，不再让用户跳去 /admin/rules） |

**已接（参照·勿动）**：`Provenance.tsx`（内嵌 RuleRef·两跳）、`ProjectSimView.tsx` DagNodeDrawer 关联规则、`AnnualScenarioView.tsx`、`WorkflowsPage.tsx`、`EvaluatedRules.tsx`、`DashboardView.tsx:384`（经 Provenance.rule 内嵌 RuleRef）。

---

## 2. 裸数字渲染点（关键判定数未挂 `<Provenance>`）

| # | 锚点 | 现状 | 真值判据 |
|---|---|---|---|
| **N-N1** | `OrderChainView.tsx:464-466` 关键值列 | 三判关键值 `P90 1890 vs 需求 8`·`三元正极 缺 654 吨`·`毛利 18% vs 底线 12%` 裸渲染（值真来自 `order_fullchain` 求解器，但无悬浮溯源） | 关键值挂 Provenance（公式/输入/来源系统=order_fullchain/规则号），对得到后端真值 |

> 驾驶舱八卡（轨R#2 六要素）/规划聚合勾稽表（轨R#4 Provenance）/LedgerView 逐格已挂——本增量只补 order-chain 三判这一处高价值缺口（不为补而补全仓每个数字，红线是"每一类展示数据"，三判数已是一类典型）。

---

## 3. 下钻死路（navigate 跳走无回退）

| # | 锚点 | 现状 | 真值判据（修后） |
|---|---|---|---|
| **N-D1（铁证）** | `DashboardView.tsx:240` | 订单台账行 `onClick={() => navigate("/v/order-chain")}` 整页跳转，目标 OrderChainView **无面包屑/返回** = 死路 | 逐单下钻进得去**也回得来** |
| **N-D2** | `DashboardView.tsx:164` | 问题面板卡 `navigate("/v/order-chain?problem=...")` 同样整页跳无回退 | 同上 |
| **N-D3** | `components/ProvenanceDag.tsx:123` | 轨R#3 event 卡 `navigate("/v/order-chain?problem=...")` 同 | 同上 |

> 三个入口全部落在 `/v/order-chain`（OrderChainView，renderer 视图）。处置取 SPEC §3.1 **选项 B**（目标页加面包屑/返回）——一处加返回即同时解三个入口死路，低风险覆盖全。

---

## 4. DAG 节点未接 DagNodeDrawer

| # | 锚点 | 现状 | 真值判据（修后） |
|---|---|---|---|
| **N-G1** | `components/ProvenanceDag.tsx`（驾驶舱 PlanDrillWidget + 规划 DAG 共用） | DAG 节点（kpi/event/ksf/factor/evidence）**不可点穿**，无溯源抽屉；DagNodeDrawer 只在 `ProjectSimView.tsx` 自家 PmDag 用 | ProvenanceDag 节点可点 → 复用 DagNodeDrawer 出溯源抽屉（逻辑/输入/本体链/规则） |

---

## 5. 实拍证据

- `N0-orderchain-bare-rules.png`：order-chain 三判表 规则列裸 `C02/C03`·`C06/C16`·`C15/C13/C18`（悬浮无信息）——N-R1 铁证。
- `N0-orderchain-full.png`：order-chain 全页（无面包屑/返回，N-D1 死路坐实）。

> 实拍命令：真起 datacore(4001·SEED_DEMO)+agentcore(4002)+vite(5173) → demo/admin/demo1234 登录 → /v/order-chain 选 SO-3391 → 三判表 规则列实拍。

---

## 6. 增量映射（后续 1/2/3 照此修）

- **增量1（接全·零后端改）**：N-R1/N-R2/N-R3 接 RuleRef · N-N1 接 Provenance · N-D1/N-D2/N-D3 加面包屑去死路 · N-G1 复用 DagNodeDrawer。
- **增量2（扩后端）**：Rule += definedBy/definedAt/effectiveFrom/effectiveTo/basis（RuleRef 弹窗增"谁定/何时/边界/依据"）。
- **增量3（风险详情+门）**：RiskPopover 加"详情"弹窗接 bottleneck_matrix 逐工序 · 新增 `traceability:check` 静态门防回潮。
