# RISKBOARD-RULES-AGENTS · C2/C3 活栈真浏览器 FDE（dev·2026-07-09 autonomous tick）

铁律0.4：真起活栈（真 datacore SEED_DEMO + 真 agentcore）+ 真 vite 前端指向真后端（`VITE_DATACORE_URL=http://localhost:4001` / `VITE_AGENTCORE_URL=http://localhost:4102`·非 mock）+ 真 Chromium 登录 admin/demo1234 → `/v/risk`，前端所见**逐值对照后端真值**。

## 后端真值（`POST /a/v1/solvers/risk_timeline/invoke`）
- `dataMode = SYNTHETIC`
- `confidence = { synthetic:true, stale:false, measurement:"LIVE", note:"此决策基于合成数据（非真实接入）" }`
- `cards = 8`（合肥/常州/信阳/厦门/成都/…真基地）
- 各卡 `exposureWan/threatenedRevenueWan = 0` —— **诚实零**（合成 demo 无真受威胁营收敞口，非编造；KILL-MOCK-RED）

## 前端所见（真浏览器·逐值对照）
### C3 · 置信度徽章
- `[data-testid=risk-confidence-datamode]` **在场**，文案 = **「合成数据」** ⟵ 逐值对照后端 `dataMode=SYNTHETIC`（不冒充真实·honest）。
- 营收敞口列显 `—`（对照后端敞口 0·诚实空·非硬编）。

### C2 · 基地卡 + 下钻
- 8 张真基地卡渲染（`risk-card-合肥/常州/信阳/厦门/成都/…`），卡面「受威胁客户 / 营收敞口」标签在场。
- 点击基地卡 → 详情 Modal 打开（标题「合肥 · 瓶颈工序」）：
  - `bottleneck-detail-panel` 在场 ✓
  - `bottleneck-detail-datamode` 在场 ✓（下钻内 dataMode 徽章）
  - `bottleneck-detail-table` 在场 ✓
  - **逐日张力**下钻在场：`D+14 · 到货间隙 · 合肥 …关键物料到货周期节点…`，带**诚实数据边界注**「安全库存覆盖天数与齐套率需接入 WMS/ERP」（无真源→诚实标·非兜底假值）。

## 结论
C2（真浏览器点卡下钻逐日/瓶颈明细·真出数）+ C3（置信度徽章逐值对照后端 SYNTHETIC=「合成数据」）**活栈真浏览器 FDE 通过**。合成 demo 下敞口/受威胁营收诚实归零、下钻带 WMS/ERP 数据边界注——皆诚实边界（有真源即 LIVE·无真源不编造）。

连同：C1（风险推演链派生/传导规则真值驱动·datacore1013+agentcore617+frontend500 三包绿）+ C2 NL-agent-live（真 Kimi 证实·见 `RISKBOARD-C2-nl-agent-live-fde.md`），本 WO 全 FDE 闭环。
