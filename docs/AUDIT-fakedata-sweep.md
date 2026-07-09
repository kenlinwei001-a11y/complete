# AUDIT · 决策路径假数据残口系统性扫描（FAKEDATA-SWEEP）

> 用户亲定（铁律 0.6·第一性）：**推演必基于真实数据**。决策级数值绝不用 hash(名)/写死系数/兜底值
> 冒充真实——无真源 → 诚实空态 / 诚实标注合成（dataMode），不哈希造伪。
> 本文是全仓系统性（**非抽样**）扫描清单 + 逐条处置 + 子 WO 勾稽。

## 1. 扫描口径与范围（非抽样声明）

- **扫描面**：`apps/datacore/src/solvers/**`（SOLVER_REGISTRY 全量求解器）+ `apps/frontend-shell/src/views/**`（前端全量决策视图）。测试/spec 文件排除。
- **残口信号**：`hashString(...)` 参与**派生业务数值**（`% N` 造数 / 入算式）——决策路径"hash 现编数值"的最强冒充信号。
- **判定三态**（`scripts/check-no-fake-data.mjs` 确定性纯静态·R6·可重跑）：
  - **合法**：hash 结果进 `id`/`version`/`bucket`（A/B 确定性分流）等**非业务量** → 放行（不算残口）。
  - **LABELED**（诚实标注合成）：函数体内带诚实位（`dataMode`/`诚实`/`无实测`/`合成`/`MOCK`/`PARTIAL`）→ 计入基线追踪，**处置=补真源子 WO 在办**，非红。
  - **SUSPECT**（裸冒充）：既非合法用途、又无诚实标记 → **红**（hash 数值冒充真实决策值·本体谎言）。
- **门**：`scripts/check-no-fake-data.mjs` + 棘轮基线 `scripts/no-fake-data.baseline.json`；只在**基线外新 SUSPECT / 新 LABELED**时红（防新增假数据回潮）。green→red 自证：植入无诚实标记的 `hashString(x)%N` 决策值 → SUSPECT 红（已实测）。

## 2. 扫描结论（全仓·截至 2026-07-09）

**决策路径 post-KILL-MOCK-RED 大体诚实**：绝大多数历史 `mockTightness` 哈希造红残口已被 WO-FORECAST-SIM / KILL-MOCK-RED 删除（无真源 → `null`，前端灰/诚实空态，不再哈希染红——见 `risk.ts:167/201/218/328` 注释链）。裸 `hashString` 决策值 **SUSPECT = 0**。

**残余 = 诚实标注的合成估算（LABELED·非冒充·违第一性但已诚实标）**：

| # | 位置 file:line | 假在哪 | 真源应是什么 | 处置（默认补真源） | 子 WO |
|---|---|---|---|---|---|
| F1 | `apps/datacore/src/solvers/risk.ts:642,649` | `auditTimeline` 逐日传导曲线/峰值/越线日由 `hashString(kind)` 确定性派生（`h%40` 峰日·`h%12` 峰值·`%7-3` 微抖），**无实测时序** | 各审计项（产销/毛利/齐套/现金/份额/爬坡/外协/capex）的**真实逐日指标时序**（真订单/毛利/库存/现金流按日聚合），同 CAPACITY-BASECARDS 为 risk_timeline 补真设备时序之范式 | **补真源**：`auditTimeline` 有真源时取真日序、无真源退诚实空态（不哈希造曲线）；`dataMode` 由真源在否派生 | `FILL-AUDIT-TIMELINE-REAL`（P2·新建） |
| F2 | `apps/frontend-shell/src/views/plan/OrderChainView.tsx:34` | 成品/在制/原料库存价值 = 营收 × **写死占比系数** `{fg:0.22,wip:0.3,rm:0.18}`（无实测库存），第二位 `hash幅度` 注释残留（hash 现编已删·见 :157） | 真实库存对象（成品/在制/原料按 SKU 数量×单价）经建模链落库后聚合 | **补真源** 或保留透明估算：①有真库存对象→取真值；②无→保留占比估算但已诚实标"透明估算·非实测"（现状）+ 清理 `hash幅度` 死注释 | `FILL-ORDERCHAIN-INVENTORY-REAL`（P3·新建·低优·已诚实标估算） |
| F3 | `apps/datacore/src/solvers/risk.ts:54` `mockTightness` | 纯设备/物流因素（设备 OEE 已真接·物流时长/换型损失）无真源时的启发估算函数仍在册 | 真设备时序 / 物流真时长 / 换型真损失（部分已由 CAPACITY-BASECARDS 接真） | **补真源**：其余无真源因素接真时序，或调用方仅 `lt.live` 时才调用（现已如此·见 :328）；函数体仅在诚实 MOCK 分档下用 | 并入 `RISKBOARD-RULES-AGENTS` C1（已在办·部分已接真规则） |

**合法放行（非残口·登记备查）**：`service.ts:1583` ruleSetVersion（版本 hash）、`service.ts:1931` A/B 分流 bucket、`service.ts:1959` experiment id、`forceLayout.ts:120` 布局抖动（`Math.random` 非决策值·纯视觉）、`SandboxView/SimInit` 的 `绝不 hash(oid) 造伪初态` 守卫注释。

## 3. 处置勾稽（每残口 → 一处置或一子 WO）

- **F1 → 子 WO `FILL-AUDIT-TIMELINE-REAL`（P2）**：入队列·acceptance 有牙（有真日序时逐值对真源·无真源退诚实空态·teeth revert→假曲线回潮红）。
- **F2 → 子 WO `FILL-ORDERCHAIN-INVENTORY-REAL`（P3）**：入队列·低优（已诚实标估算·非冒充）·含清理 `hash幅度` 死注释。
- **F3 → 并入在办 `RISKBOARD-RULES-AGENTS`**：其 C1 已接部分真风险规则；余无真源因素随该单补齐。
- **防回潮**：`check-no-fake-data.mjs` 纳入 gates（建议）——新增裸 hash 决策值即红。

## 4. 本体引用与影响

- **不变量**：R-KILL-MOCK-RED（决策级无真源 → null/诚实空态·不合成冒充）、R6（扫描器确定性纯静态可重跑）。
- **断点**：G-DM-1（MOCK 值上线为决策级红·已由 KILL-MOCK-RED 闭·本扫描确认无新回潮）。
- **门**：新增 `no-fake-data:check`（决策路径 hash 数值残口·棘轮基线）。
- 本扫描确认 KILL-MOCK-RED 成果未被侵蚀（SUSPECT=0）；残余 3 处均诚实标注合成，逐条 WO 化补真源。
