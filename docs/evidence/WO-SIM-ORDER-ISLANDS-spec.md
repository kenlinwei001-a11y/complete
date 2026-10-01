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

---

## 附录 · 整格重跑实测标定（2026-10-01）

**反解验证现口径**（实测 `in-edges.txt`，`Model.demandLoad` 共 4 条入边）：
`S_g = 0.5×1 + 0.6×1 + 0.25×25 + 0.5×25 = 19.85` ⇒ `f_g = 0.75/19.85 = 0.0377833753`
—— 与 `battery.ts:874` 注释里的数**逐字节吻合**，`W` 口径确认：
两条 Order 边 `source_qty_relative`（IN_EDGES_MEAN ⇒ **W=25**），两条 FGI 边 `source_field_share`（Σ=1 ⇒ **W=1**）。

**意图增益按「各量实测中位数量级为参考系」定**（仓主裁定）：`意图增益 = 0.5 ÷ 参考量级`
| 量 | 实测区间 | 参考量级 |
|---|---|---|
| `Order.leadDays` | −14–178 天 | 110 |
| `Order.qty` | 708–21777 套 | 16 000 |
| `Order.unitPrice` | 13594–22660 元 | 18 000 |

**新 `S_g = 19.9651120581` ⇒ `f_g 新 = 0.0375655292`**（旧 0.0377833753，**既有四条边只小 0.58%**）

| key | 意图增益 | 稳态增益(12位) | **系数字面量(12位)** |
|---|---|---|---|
| `demo_order_demand_pressure` | 0.5 | 0.0187827646 | **0.006949622902** |
| `demo_order_churn_to_model_demand_load` | −0.25 | 0.0093913823 | **−0.003474811451** |
| `demo_fg_cover_days_to_model_demand` | −0.5 | 0.0187827646 | **−0.006949622902** |
| `demo_fg_drawdown_relieves_model_demand` | −0.6 | 0.02253931752 | **−0.008339547482** |
| **新** `demo_order_leaddays_to_model_demand_load` | −4.545455e-3 | 0.000170752405 | **−0.000063178389** |
| **新** `demo_order_qty_to_model_demand_load` | +3.125e-5 | 0.000001173922 | **+0.000000434351** |
| **新** `demo_order_unitprice_to_model_demand_load` | +2.777778e-5 | 0.000001043486 | **+0.000000386089** |

`Σ|稳态|×W = 0.750000 ≤ 0.75` ✓ 顶格（与 `battery.ts:933` 的 0.749961 同一风格）

### ⚠️ 连带必改（本单新发现的机制约束）
`seed.ts:329` 的取整口径是**「稳态增益向下取整到 6 位小数」**。实测：
- 6 位取整下，`qty`/`unitPrice` 两条的稳态被打成 `0.000001` ⇒ 入流 0.00592/拍 ⇒ 稳态 **0.0160**
  —— 贴着 `NOISE_FLOOR`(0.01)，会被控制台读成「没动」；
- **12 位**取整下入流 0.006950/拍 ⇒ 稳态 **0.01878** ✓ 与同格的 `coverDays` 同量级。

⇒ **须把该取整口径由 6 位放宽到 12 位**。既有四条的旧值本身都 ≤6 位有效，**放宽不改变它们**，
只让新值可表达。这是**标定规则的改动**，须在本体与 `battery.ts` 段头如实登记。

## 下一步（未做，接手照做）
1. 改 `seed.ts`：三条边字面量 + 段头注释；改取整口径 6→12 位
2. 改 `battery.ts`：`PROPAGATION_COEF_PARAMS` 七个 key（四改三增）+ 段头登记
3. 金值：`seed-demo-propagation.test.ts` `propagationCount` 55→58（4 处）+ trace 逐条真触发 + §6 判据⓪
4. `edge-money-weight.seam.test.ts` §3 描述里的系数
5. `sim-root-triad.seam.test.ts` 写死的四跳读数（0.0121/0.0427/0.0667/0.0793）
6. 跑 datacore 测试；跑对照实验（`landing-after.txt` 必须 8 件能落 + due-change 真跑出 >1 张）
7. 回写本体 §3；建分支 push 后收编
