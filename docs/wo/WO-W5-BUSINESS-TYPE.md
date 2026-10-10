# WO-W5 · 全局推演按业务类型（乘/商/储）差异化 + 勾选筛选推演

> 一句话：全局推演现在不分业务类型。本 WO 让乘用车/商用车/储能三类**种子差异化 + 可勾选筛选后推演**，各体现不同的真实经营场景。**跨数据+引擎+前端三半·一个 dev 整单做（别拆·拆半 = metric-aware 反复炸的根）。**

## 背景（产品负责人详细 spec）
现在全局推演所有订单一锅烩，看不出业务差异。三类业务的真实场景截然不同：
- **乘用车**：**产能不足** + **销售预测远大于实际订单**（预测虚高）+ 部分**客户需提前交付**（复杂推演场景：预测 vs 订单 vs 交期三重张力）。
- **商用车**：**产能空闲** + **订单波动大**。
- **储能**：**产能 ~95% 稳定**。

## 🚦 文件边界（跨三半·一个 dev 整单·别拆）
- `apps/datacore/src/synthetic/battery.ts`（订单/客户/需求种子按 businessType 差异化）
- `apps/datacore/src/solvers/portfolio.ts`（按业务类型分口径求解/聚合）
- `packages/contracts/src/*`（Order/DemandSegment 加 `businessType` 字段·zod）
- `apps/frontend-shell/src/views/sim/GlobalSimView.tsx`（业务类型勾选筛选 UI + 差异化展示）
- `apps/frontend-shell/src/mocks/*`（mock 同步 businessType）
- 对应 test（含 SEAM 组合测）
- **禁碰**：`dril/*`、`agent/loop.ts`、`databuilder/*`（别的 dev 在改）。**⚠ 与 W9 都碰 GlobalSimView → W9 先落地再做本单，或同 dev 顺序整两单。**

## 产出
1. **契约**：Order（及 DemandSegment）加 `businessType: "passenger"|"commercial"|"storage"`（zod·向后兼容 optional 或默认）。
2. **种子差异化**（battery.ts·确定性 seed·R6 同 seed 字节一致）：
   - 乘用车：需求预测 >> 实际订单量（预测虚高）；产能占用高/不足；部分订单 dueDay 提前（提前交付）。
   - 商用车：产能占用低（空闲）；订单量方差大（波动）。
   - 储能：产能占用 ~95%；订单平稳。
3. **引擎分型**（portfolio.ts）：求解/聚合可按 businessType 分组出口径（各类占用率/缺口/交付率分别可算）。
4. **勾选筛选 UI**（GlobalSimView）：顶部按业务类型（乘/商/储）勾选 → 只对勾选集推演 → 矩阵/KPI/客户级影响**真变**（改勾选→输出真变·非前端假过滤）。乘用车场景要能看出"预测 >> 订单"与"提前交付"张力。

## 硬约束
- **KILL-MOCK-RED**：差异化是真种子数据 + 真求解器分型口径，**不是前端写死三套假数**。改勾选→后端真重算→输出真变。
- **确定性种子**：同 (industry, scale, seed) 三类差异化重跑字节级一致（R6）。
- **R14**：业务类型是数据维度·不写死电池魔数；tenant_id everywhere。
- **契约新增**：contracts + repo/pg + repo/memory + migration 同改（若落库）。

## SEAM 门（头号判据 = 勾选真驱动分型·非各半绿）
- `global-sim-business-type-seam.test`：
  - 勾选**储能** → 占用率 ≈95% 稳；
  - 勾选**乘用车** → 体现产能不足 + 预测虚高缺口（预测量 > 订单量）+ 提前交付订单；
  - 勾选**商用车** → 产能空闲 + 订单波动；
  - **改勾选 → portfolio 真重算 → 矩阵/KPI 真变**（前端假过滤会被此门抓）。
- 四包全绿；handoff `claude/handoff-wo-w5-business-type`。

## 依赖 / 顺序
- **与 W9 都碰 GlobalSimView** → W9 先落地再做，或同 dev 顺序整两单。
- 后续 W6（分批交付）/W7（方法旋钮+客户卡+订单列）也碰 GlobalSimView → **W5→W6→W7 串行**（同域·别硬并行）。

## 参考
`docs/WORK-ORDERS-dispatch.md` §5 · 产品负责人原始 spec（乘用车产能不足+预测虚高+提前交付 / 商用车空闲+波动 / 储能95%稳）。
