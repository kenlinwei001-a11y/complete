# WO-SIM-ORDER-ISLANDS · 实现规格（仓主裁定 2026-09-30：三条都落，按仓里既有档位暂定）

分支 `claude/handoff-sim-order-islands`（tip = 空提交 `35f1e7943`，基线 `8a96b842f`）

## 已完成
- 根因定案（见同目录 FINDING.md），实测坐实：`landing-before.txt` —— Order 三格逐个 `false`，
  12 件事里 4 件订单层事件**全部落不了点**（含用户原场景 due-change）。

## 三条新边（目标形态，全部照平台既有机制，零自造）

| # | key | 源 | 靶 | 意图增益（暂定） | 语义 |
|---|---|---|---|---|---|
| ① | `demo_order_leaddays_to_model_demand_load` | `Order.leadDays` | `Model.demandLoad` | −0.5 | 在手订单交期跨度越长 ⇒ 交付裕度越大 ⇒ 型号即时需求负载越低 |
| ② | `demo_order_qty_to_model_demand_load` | `Order.qty` | `Model.demandLoad` | +0.5 | 在手订单量越大 ⇒ 型号需求负载越高（`demandLoad` 是**广延量**，`contracts/sim.ts:178` 明文） |
| ③ | `demo_order_unitprice_to_model_demand_load` | `Order.unitPrice` | `Model.demandLoad` | +0.5 | 在手订单单价越高 ⇒ 该型号价值敞口越大 ⇒ 资源争夺越紧 ⇒ 负载越高 |

- **链路**：`order_for_model`（Order→Model，**已物化** `lnk_ofm_*`，且被方向可达门当金丝雀）⇒ **零新造链路**
- **边形状模板**：现行边 `demo_order_churn_to_model_demand_load`（同链路、同靶格）
- **权重口径**：`weightRef: { basis: "source_qty_relative" }` —— **同格同口径是硬约束**
  （seed.ts:1664-1668：同链路同靶格只给一条加分摊 = 两种量纲加在同一个数上，比都不加权更糟）
- **为什么不需要自造「大数量纲归一化参考系」**：`contracts/sim.ts:178-181` 明文
  「**由每格增益预算去压系数，而不是改归一口径**」—— 平台既定的做法就是把量纲差异压进系数，
  由 `f_g = 0.75/S_g` 闭式分配吸收。**本规格照此，不自造新机制。**
- **系数单源**：`battery.ts` `PROPAGATION_COEF_PARAMS`（`ruleParamOf` 缺 key 在模块装载期抛错）
- **世界格数不变式**：源格 `Order.{qty,leadDays,unitPrice}` 与靶格 `Model.demandLoad` **都已在世界** ⇒
  `totalCells/measuredCells` 应逐字节不变（实测必须验）

## 整格重跑（必做，且有已知副作用）
`S_g = Σ|意图增益_e| × W_e`，`f_g = min(1, 0.75/S_g)`，`稳态增益 = |意图增益| × f_g`，`系数 = 稳态增益 × λ(0.37)`

⚠️ **既有 4 条入边（`demo_order_demand_pressure` / `demo_order_churn_to_model_demand_load` /
`demo_fg_cover_days_to_model_demand` / +1）的系数全部会变小**（S_g 变大 ⇒ f_g 变小），
⇒ **需求侧链路读数整体变小**（受影响的已交付场景：预测偏差链）。
⚠️ **`S_g` 现值 19.85 是注释里的数，必须实测确认**（`W` 的算法：`source_qty_relative` 走 `IN_EDGES_MEAN`，
W = 该组源条数；实测手段 = 从 `apps/datacore/dist/sim/propagation-inputs.js` import `buildPairWeights` 现算）。

## 连带必改
| 文件 | 改什么 |
|---|---|
| `apps/datacore/src/seed.ts` | 加三条边字面量（无 `coefficient:` 行，按单源纪律）+ 段头注释（语义/为什么这条靶格/为什么这个档） |
| `apps/datacore/src/synthetic/battery.ts` | `PROPAGATION_COEF_PARAMS` 加三个 key + **重跑既有四条的值** |
| `apps/datacore/test/seed-demo-propagation.test.ts` | `propagationCount` 55→58（4 处字面量）+ §6 判据⓪ 逐格断言 + trace「逐条真触发」列表 |
| `apps/datacore/test/edge-money-weight.seam.test.ts` | §3 描述里的系数（`description` 与真值对账） |
| `docs/SYSTEM-ONTOLOGY.md` §3 | 回写：传导规则 55→58、三条边的语义与暂定档、整格重跑后的新 `f_g` |

## 对照实验判据（铁律 1.5 判据一）
1. **加边前**：`landing-before.txt` —— `Order.{qty,leadDays,unitPrice}` 全 `false`，due-change ⏭ 落不了点
2. **加边后**：三格转 `true`；12 件事里能落点的从 4 件增到 8 件（4 件订单层全部恢复）
3. **真跑**：`due-change` 真发请求 ⇒ `Model.demandLoad` 动 ⇒ **波及订单 > 1 张**（否证「1 张 = 被扰动那张单本身」的退化结论）
4. **零扰动对照**必须仍为 0 张（背景 churn 已相消）
5. **金丝雀**：`Material.priceShock` 那条链的读数/可达性**一字不动**（证明只动了 Order 层）

## 已知未决（如实登记）
- `Order.unitPrice` 的业务后果在平台里**没有「价格 → 金额」的传导口径**（本体 :2710 登记为诚实缺席）。
  本条走的是「价值敞口 ⇒ 需求负载」这一绕行语义，**不是**价格→收入。仓主定档时可改。
- 三条边的意图增益 **±0.5 是暂定档**（照 `FGI.coverDays` 与需求侧同落点邻居的档），**不拿系数凑大屏数**。
