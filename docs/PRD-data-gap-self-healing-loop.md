# PRD · 数据缺口自愈闭环（R16 发育闭环通用化 · 发现→分析→生成→验证→发布）

> 状态：草案 v0.1 · 2026-07-28
> 缘起：用户诉求——「一旦发现缺数据，就形成一个 workflow，触发建立**有逻辑**的种子数据，然后建立一个 loop，完成 **发现-分析-生成-验证-发布**」。
> 本 PRD 遵铁律0：已读 `docs/SYSTEM-ONTOLOGY.md`（R16 / O9 runGrowthLoop / DF.9 data-boundary / G-9 / A7）。

## 0. 关键结论（先破后立）

**你要的闭环 80% 已经存在**——不是从零建，是**通用化**既有的「自成长发动机」：

| 你的相位 | 已有实现（apps/agentcore/src/growth/） | 现状 |
|---|---|---|
| 发现 | `probe.ts` `classifyGap`（ANSWERABLE/BLOCKED/BOUNDARY） | ✅ 有·但只被 **QOS 问句** / **场景发育**触发 |
| 分析 | `data-boundary.ts` DF.9 **HARD/SOFT 分流** | ✅ 有·**核心护栏** |
| 生成 | `scaffold.ts` + A7 合成（`SyntheticJob`）+ `tensionSeries` | ✅ 有·SOFT 才自动合成 |
| 验证 | 勾稽 + R6 确定性 + `pnpm gates` | ✅ 有·散落 |
| 发布 | 物化进 SolverContext + `growth-ledger`/`growth-tickets` + 翻 dataMode/provenance | ◐ 半·未翻 UI 缺口 |
| 闭环 | `loop.ts` `runGrowthLoop`（探针→补齐→重跑→收敛·终态 CONVERGED/BOUNDARY/MAX_ROUNDS） | ✅ 有 |

**真正缺的（= 本 PRD）**：① 发现相位**只被动**（QOS 问句触发），没有**主动扫 UI 呈现的缺口**（per-factor 无 series、`unverifiedNumerics`、`dataMode=EMPTY`、灰徽章）；② 这些 UI 缺口**没接进 runGrowthLoop**；③ 闭环**不可观测**（无统一「缺口→处置」台账面）。对应本体未修断点 **G-9**（场景卡未走 R16 发育闭环·靠一次性手装播种）。

## 1. 核心诚实护栏：为什么「不能任何缺口都生成」（DF.9 · 必须先讲清）

你的直觉「缺数据就生成种子数据」**对 SOFT 缺口成立，对 HARD 缺口是红线**。`data-boundary.ts` 已编码这条铁律（CL.2「触发合成≠伪造」）：

- **HARD**：缺的数据**涉及真实业务实体**（问句/上下文命中已发布业务词表：真实基地名/应用细分）。**自动合成 = 凭空发明真实实体的产能/订单/良率 = 造业务事实** → **拒绝静默合成**，出 `DataRequest` 工单走**真人正门**（连接器导入 / Excel 上传 → Action 审批）补真实数据。
- **SOFT**：通用 / 无具体实体的缺口 → 经管线**确定性合成 PROVISIONAL**（标「未接实测」），供探索，业务真值由后续**接实测覆盖**。

> 这正是「合成种子」的本质（见用户问答）：demo 世界全是 A7 合成种子；接真数据那天 PROVISIONAL/合成 自动翻 LIVE/实测。**自愈闭环绝不跨过 HARD 红线去伪造**——否则系统就从「诚实认怂」堕成「编数据」，砸掉最大卖点。

## 2. 设计 · DataGapSelfHealingLoop

```
① 发现  DataGapDetector（新·datacore + agentcore 双侧扫描器）
     扫描信号源（均已存在·只是没被聚合）：
       dataMode==="EMPTY" · provenanceSynthetic===true · 因子无 series · unverifiedNumerics===true · 灰徽章
     → GapSignal[]{ source, entity?, field, kind, uiSurface }
        ↓
② 分析  classifyGap + data-boundary.classifyDataBoundary（复用·纯函数 R6）
     每个 GapSignal → { mode: HARD|SOFT, entities[], dataRequest? }
        ↓
③ 生成  ├─ SOFT → A7 生成器 / tensionSeries 确定性合成 PROVISIONAL（非写死·从既有真值派生）
        └─ HARD → DataRequest 工单（growth-tickets）· 绝不合成 · 真人正门
        ↓
④ 验证  勾稽(Σ子+residual=父) + R6(同seed字节一致) + 目标 gate（不破坏现有测）
        ↓
⑤ 发布  物化进 SolverContext → 翻 dataMode LIVE / provenance ⟦ref⟧ → 灰变真
        growth-ledger 记一条「缺口→处置→终态」（可观测·台账面）
        ↓
   闭环  runGrowthLoop：重跑探针 → 收敛 CONVERGED（补齐）/ BOUNDARY（剩 HARD 工单·系统尽力了）/ MAX_ROUNDS
```

**单源纪律（RL3/RL10）**：probe/fill/boundary 只此一份（growth/），新 Detector 复用之，不另起炉灶。

## 3. Level-1 已落地样例（本 PRD 的第一个真实例·正在并行开发）

**per-factor 真序列**（治 #1/#3「时序推演全灰/无梯度」）= 本闭环的③生成相位在 `risk_timeline` 的一次具体落地：
- 缺口：非瓶颈因子（物流时长/OEE…）只有当前值、无逐日 series → 灰。
- 判定：**SOFT**（从因子**既有真实 current tightness** 用 `tensionSeries` 确定性派生 · 非发明新业务事实）。
- 生成：每因子按其 current tightness 走同一 `tensionSeries` 机制 → 真逐日梯度（蓝→黄→红）。
- 验证：R6 字节一致 + day-0 与 current tightness 勾稽。
- 发布：dataMode 保持 LIVE + provenanceSynthetic（诚实标·非伪造）。

> handoff 分支 `claude/handoff-wo-risk-perfactor-series` 开发中（本 PRD 落地验证）。

## 4. 本体引用与影响（铁律0 必备）

- **对象类型（§2）**：`SyntheticJob`（A7 生成）· `GrowthTicket`/`GrowthLedger`（发布台账）· `DataRequest`（HARD 正门）· `SolverContext`（发布落点）。
- **链路（§3/§4）**：新 `sys.datagap.self_heal`（DataGapDetector→classifyGap→boundary→{scaffold|ticket}→validate→materialize→runGrowthLoop）；复用 `sys.scenario.launch` 世界态正门 R16/R4。
- **事件（§8.2）**：复用 `scenario.growth_triggered`（缺件卡 grow）；新增 `datagap.detected` / `datagap.healed`（L4·IN_SESSION·消费 growth-ledger 面）。
- **不变量**：R6（同 seed 字节一致·生成确定性）· R16（世界态经正门物化）· CL.2（触发合成≠伪造）· KILL-MOCK-RED/铁律0.4（合成标「合成·未接实测」·绝不谎报实测）· HARD 红线（真实体不静默合成）。
- **断点**：**修 G-9**（场景卡/UI 缺口纳入 R16 发育闭环·不再靠一次性手装播种）；新增 **G-DATAGAP-PASSIVE**（发现相位只被动·未主动扫 UI 缺口）作为本 PRD 目标断点。
- **回写要求**：落地后回写 §2（新对象）/§8.2（新事件）/§8（G-9 状态推进 + G-DATAGAP 关闭）。

## 5. 验收 + SEAM 门

- **SEAM-GATE（头号判据·数据半×引擎半）**：一条组合测驱动接缝——「制造一个 SOFT 缺口（某因子无 series）→ 跑 DataGapSelfHealingLoop → 断言：该因子 series 被确定性合成填入 + dataMode/provenance 正确翻转 + growth-ledger 有一条 healed」。任一半漏即红。
- **HARD 红线测**：制造一个真实体缺口（真基地某度量无实测）→ 断言**拒绝合成** + 出 DataRequest 工单（不静默造数）。
- **R6 测**：同 seed 两跑闭环产物字节一致。
- 四包全绿 + `pnpm gates`（golden 计数：新对象类型/事件同步 catalog/ontology-core）。

## 6. 分级交付

- **Level-1**（进行中）：per-factor series（risk_timeline）—— 一个 SOFT 缺口的③生成落地。
- **Level-2**：DataGapDetector 聚合全信号源 + classify + 台账（发现+分析+发布可观测）。
- **Level-3**：runGrowthLoop 主动 sweep（定时/事件触发全域缺口自愈）+ HARD 工单流。
