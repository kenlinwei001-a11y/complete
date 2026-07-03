# FDE — WO-FRONTEND-VALUE-AUTHORITY（簇E · 前端消费后端权威值·缺失诚实标估算）

审计簇 E（`docs/AUDIT-fake-value-remnants.md §2 簇E`）：前端在后端权威值存在/缺失时**客户端重算绕单一真相源**，`debattery-allow` 白名单常数漏网。治本 6 site + E7 诚实边界。

## 治本落点

| # | 造假 | 治本 |
|---|---|---|
| E1 `DashboardView:217` | marginLedger 缺→内联 `{price:0.6,margin:13}` 重算 gmRate·无「估算」标 | marginLedger 缺→前端 Σ 自算标「估算」上标（`ledger-gmrate-est`），不冒充权威 |
| E2 `SopBalanceView:296` | `revAttain=revSum/内联 revBudget240` 自算·后端已有权威 | 后端 `sop.ts s4` 发 `revAttainPct`（用 `params.sop.revBudget`）→ 前端优先消费·缺则 workspace 预算·再缺 null（去内联240） |
| E3 `QuarterlyRollingView:128` | `breach=\|dev\|>5` 前端自算·驱动红+提报 | 后端 `planviews.ts ltaDeviation` 发 `breach`（C27 阈5%·契约 `QuarterlyResponse.ltaDeviation.breach`）→ 前端消费 `r.breach` |
| E4 `OrderChainView:360` | 瓶颈阈 `?? 85` 内联伪造 | 消费后端 `k.threshold`（`params.risk.threshold`）·缺→灰。coef 已 `view.layout.econ` 权威+「估算」标（本单确认非新债） |
| E5 `SopBalanceView:343` | 毛利红内联 `0.5pp` 自算 | 消费后端权威 `s4.gmOk`（后端用 `params.sop.gmTolerance` 判） |
| E6 `DashboardView:800` | 三线偏差柱 `col0−col1` 自算·绕后端 gap | 消费后端权威 `r.gap`（`bundle.deviation.gap`）·仅缺失时才自算 |
| E7 `GeoMapView:22` | 12 基地坐标静态表(debattery-allow) | 确认非决策（Base.props.lon/lat 优先·表仅地理兜底）·诚实披露·P3 保留 |

## FDE 真起 datacore·curl 后端真值（内存模式·SEED_DEMO=1·dist 经 gates 重建）

```
# E3 —— 后端权威 breach 位（GET /a/v1/plan/quarterly）逐行对照 |dev|>5：
  三元正极 dev=-8 breach=true   （|dev|>5=true  ✓）
  隔膜     dev=1  breach=false  （|dev|>5=false ✓）
  电解液   dev=-2 breach=false  （|dev|>5=false ✓）
# → 越线判定在后端产出·前端消费此位·不再客户端自算。
```

E6 `gap`：后端 `livedin/bundle.ts:209/230` 早已发 `deviation[].gap`/`sopVersion.gap`（本单仅改前端**消费**它·非新后端字段）；由 datacore livedin bundle 测试覆盖。
E2 `revAttainPct` / E5 `gmOk`：sop `s4` 后端字段·由 datacore C3 S&OP 测试（毛利率_roll 口径）+ F22 quarterly 测试覆盖（879 全绿）。

## 前端牙齿 `test/frontend-value-authority.test.tsx`（3 用例·摘条件即红）

- **E1** marginLedger 缺失 → `ledger-gmrate-est`「估算」上标 present；**E1 牙齿** marginLedger 存在（权威）→ 无「估算」标（对照）。
- **E3** 矛盾注入：`deviationPct=2`（自算不越线）但 `breach=true` → 出「升级供应风险」徽章；`deviationPct=-12`（自算越线）但 `breach=false` → 无徽章 → **证消费后端 breach 非前端自算**。
- 既有 `f22.quarterly-rolling.test.tsx` 续绿（breach/escalate/data-breach 渲染）。

## 四包全绿 + gates

- datacore 879 passed · frontend 391 passed（含新 3 用例·388→391）· agentcore 363 passed。
- `pnpm gates` exit 0（含 ontology-slices 母体一致 hash 1b84639b418c8ec8）。

## 本体回写

`docs/SYSTEM-ONTOLOGY.md §8 G-DM-1` 追加 WO-FRONTEND-VALUE-AUTHORITY 治本记录（6 site + 契约 breach + FDE + 牙齿）；`docs/AUDIT-fake-value-remnants.md §2 簇E` 标 ✅ 已闭 + 逐 site 落实列。

## 诚实边界（距北极星）

- E2/E5/E6 后端权威字段（revAttainPct/gmOk/gap）本已存在或本单新增·前端改为**消费**它——单一真相源守住。
- 真浏览器：本单为「消费既有后端字段」性质（非新 UI），E3 已 curl 后端逐值对照 + jsdom `renderApp` 真组件渲染牙齿（矛盾注入证消费非自算）。E1/E3 UI 渲染由 renderApp 真组件树断言（非纯 mock）。较之新 UI 单，视觉回归风险低。
- E4 coef 与 E7 坐标表属**已披露的 view.layout / Base.props 兜底**（诚实标·非静默重算），本单确认其边界，不改为纯空态（会退化演示可用性）。
