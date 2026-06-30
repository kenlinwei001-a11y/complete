# 空洞数据冰山 · H（份额 -17 错算）+ A★（洛阳红色死路）— FDE 真值证据

> 源单：`docs/REVIEW-hollow-data-iceberg-and-requeue.md` §F P1。本文记 H + A★ 两项根因解 + 真跑证据。A0（dataMode 推广）另见后续提交。

## H · 方案「份额 +Npct」与 ✓/✗ 闸门自相矛盾（B-HIGH）

**根因**：前端 `PlanGenerateView.tsx` 用魔数自算达成增量——`meetShare=(o.share-17)`（基线魔数 17）、`收入增=(o.rev-100)`（魔数 100），而求解器闸门用 `outcome.share - base.share`（base.share=**18**）。前端 -17 比闸门多 1pct → 用户看「+23pct」、闸门按「22pct」判 ✓/✗，假数 + 自相矛盾。

**根因解**：求解器 `plan.ts` 在 outcome 直接下发 `shareDelta`（=share−base.share）/`revGrowth`（=(rev/base.rev−1)×100），与 meets 闸门**同一变量**；契约 `solvers.ts` GenScheme.outcome 补两字段；前端渲染该字段、**删 -17/-100 魔数**；mock `simSolvers.ts` 同源镜像。

**真跑证据**（真起 datacore · `POST /a/v1/solvers/plan_generate/invoke`）：

| 方案 | path | share(绝对) | shareDelta(下发) | 旧 -17 显示 | revGrowth | meetShare 闸门 |
|---|---|---|---|---|---|---|
| 壹 稳健 | A | 24 | **6** | +7pct | 12 | false（6<12） |
| 贰 均衡 | D | 30 | **12** | +13pct | 16 | true |
| 叁 进取·冲规模 | C | 40 | **22** | +23pct | 20 | true |

→ 每方案 shareDelta == share−18（闸门所用值）；旧 -17 魔数恒比真值多 1pct。**显示值现逐位=闸门值**，改 base.share 前端自动跟随。

## A★ · 洛阳红色点开「暂无数据」死路（旗舰投诉）

**根因**：`RiskBoardView` 点风险格→`AffectedOrdersModal` 调 `searchObjects("Order","",{base:"洛阳",day})`——「洛阳」是 risk.ts 注入的 mock 标签、非真 Order 字段，day 也非 Order 过滤维度 → 恒命中 0 → 裸渲染 `zh.common.none`「暂无数据」。**红来自 kind 名哈希、不来自真订单，点进去当然空**。

**根因解**：风险卡**本就带** `card.affectedOrders`（契约 `RiskCardSchema:98` 已有字段）——由**产能传导引擎** `affectedOrders(c,{baseId,day:crossDay,peak})` 真算（订单 `props.bases` 含该基地且交期落传导窗口）。改 modal 渲染这份真列表（删 broken searchObjects），并：
- **MOCK 卡诚实横幅**：声明张力曲线为 mock 基线启发（非实测·基线 N），受影响订单由传导引擎按越线日真算、非由 mock 红色直接产生。
- **空列表禁裸 none**：给诚实解释「该越线日传导窗口内无在产订单关联」。

**真跑证据**（真 risk_timeline·`POST /a/v1/solvers/risk_timeline/invoke`）：

```
洛阳 · 物料齐套  dataMode=MOCK crossDay=14 affectedOrders=1
   → SO-3470 · 电网公司F · 圆柱-LFP · qty6 · due 2026-07-08 · 延误+1天 · 营收敞口 8.4万
洛阳 · 瓶颈工序  dataMode=LIVE crossDay=21 affectedOrders=1
常州 · 良率波动  dataMode=LIVE crossDay=18 affectedOrders=5
成都 · 人力工时  dataMode=MOCK crossDay=21 affectedOrders=3
```

→ 用户旗舰投诉的「洛阳·物料齐套 D+13/14 红色」点开：**现显真受影响订单 SO-3470（真营收敞口 8.4万）+ MOCK 诚实横幅**，不再裸「暂无数据」。**绝不再死路**（空列表也给诚实解释）。

## 门

`pnpm -r build` 4 包全绿；`pnpm -r test` contracts3/llm-adapters15/agentcore354/frontend289/datacore786 全绿（H 改 meets 闸门同源·不破既有方案测；A★ 改 modal 渲染源·frontend 289 不破）。

## 距北极星

- H/A★ 闭。**A0（dataMode 诚实位推广到 audit_timeline + 13 extended）**为同冰山结构性根因，另行提交。
- A★ 的「按任意日点击」目前统一展示越线日真算订单（real，按 crossDay 窗口）——逐日粒度订单（每点一天重算窗口）属增强，非死路修复范围。
