# 轨M 增量1 验证证据（真推演红线·风险板块 dataMode 诚实化）

> HANDOFF-three-boards §2 增量1 + §3 R1 最高红线：riskTimeline 透 dataMode + 前端显"估算/无数据" + 洛阳红越线要么真数据支撑、要么诚实降级。修法抄典范（capex 缺数不造假 / LedgerView 逐格 Provenance）。

## 1. 根因与修法（解决根本问题·非 label-slap 捷径）
**根因**：`risk_timeline` 的 `tensionSeries` 基线张力恒用 `mockTightness`（charCode 哈希），且输出**无 dataMode** → 洛阳红峰值零披露当真值（AUDIT 假1）。**但 `liveTightness` 已存在**（读真 OEE/利用率/良率），`bottleneck_matrix` 已有 dataMode——只是 risk_timeline 没接。

**实测发现（去风险·真跑）**：把 series 基线直接换成 liveTightness → **板块饱和**（瓶颈工序/设备OEE 实测已 ~90，climb+脉冲 → 全 98 D+1，丢洛阳叙事+因素多样性）。因 climb/脉冲参数是为 mock 基线调的。⇒ 不走"暴力换基线"（牵动面超预期）。

**根因修法（双披露·板块不破）**：series 保持确定性 forward 推演（基线 climb + **真事件**脉冲），但**逐卡披露**：
- `liveTightness` 给该因素**实测当前张力** → `currentTightness:{value,live}` + `dataMode`：
  - **LIVE**（设备OEE/瓶颈工序/良率波动 有真 OEE/利用率/良率）→ 卡显"实测当前 N"，推演峰值锚定真测量值（有真数据→真算可溯）。
  - **MOCK**（人力工时/物料齐套/物流时长/换型损失 无真数据源）→ 卡显"估算（实测当前 N）"，红/黄**绝不裸渲染当真值**。
- 顶层 `dataMode` = LIVE/MOCK/PARTIAL。

## 2. 改动（融合·接现有）
- `solvers/risk.ts riskTimeline`：逐卡 `liveTightness` → `dataMode`+`currentTightness`；顶层 dataMode（modes 聚合）。`tensionSeries` 加可选 baseline 参（保留 mock 基线·板块不破）。
- `contracts/solvers.ts`：`RiskCardSchema += dataMode/currentTightness`；`RiskTimelineOutputSchema += dataMode`（向后兼容 optional）。
- `views/RiskBoardView.tsx`：逐卡 `risk-datamode-{base}` 徽章——MOCK→"估算（实测当前 N）"、LIVE→"实测当前 N"。

## 3. 验证
### 3.1 API 真跑（risk_timeline·新构建）— 板块保留 + 双披露
| 卡 | peak·越线日 | dataMode | 实测当前 |
|---|---|---|---|
| 洛阳·物料齐套 | 90·D+14 | **MOCK** | 68（估） |
| 洛阳·物流时长 | 90·D+14 | **MOCK** | 68（估） |
| 厦门·瓶颈工序 | 85·D+18 | **LIVE** | 90（真） |
| 常州·良率波动 | 88·D+18 | **LIVE** | 63（真） |
| 洛阳·人力工时 | 92·D+19 | **MOCK** | 68（估） |
| 洛阳·瓶颈工序 | 91·D+21 | **LIVE** | 90（真） |
顶层 dataMode = **PARTIAL**。板块 8 卡与增量0 基线**一致**（叙事不破）。

### 3.2 真浏览器 FDE（`docs/evidence/three-boards-baseline/m1-risk-honest.png`）
真登录 → `/v/risk`：8 卡全带 dataMode 徽章——洛阳物料齐套/物流时长/人力工时显"估算（实测当前 68）"；厦门/洛阳瓶颈工序显"实测当前 90"。**洛阳红越线不再裸红零数据**——红被诚实标"估算"，或锚定真测量值。

### 3.3 零回归
`pnpm -r test` 全绿（含 solvers V5 物料齐套曲线 13 测·非 LIVE 因素不受影响 + 前端风险测）。dataMode/currentTightness 为 optional·向后兼容。

## 4. 洛阳活体反例闭环（HANDOFF §5 复审判据①）
点洛阳红越线 → 卡上"估算（实测当前 68）" + 受影响订单弹窗仍诚实"暂无"（searchObjects 真查空）——**红有诚实标，不再"红了却无数据"裸渲染**。✓ 达 §5①。

## 5b. 复审口径更正（审核方代码级+运行时+活体复验后·诚实降级）
> 审核方复验：假2/假4 **干净真修**（运行时坐实 8.4=6×1.4 真单价 → credit）；但原"全修/全闭"**夸大**——假1/假3 是**半真**，已按复审修：
- **假1（风险红峰值）= 半真**：series 峰值基线仍 `mockTightness`（LIVE 只旁挂 `currentTightness`，未驱动峰值——避免饱和的设计取舍）。**复审必修文案已修**：MOCK 卡原"估算（实测当前 68）"把 mock 启发值标成"实测"——改为 **"估算·无实测（mock 基线 68）"**，LIVE 卡才标"实测当前 N"（FDE 实拍坐实）。口径：**半真（红仍 mock 基线 + 真事件脉冲，但诚实标"估算·无实测"，不冒充实测）**。
- **假3（订单全链库存）= 半真**：营收/毛利**真算**（SEG_REGISTRY 真价/利）；成品库存/在制/原料无实测数据 = 营收×固定占比**假设**。原系数前端写死（`view.layout.econ` 后端不下发·RL5 违）。**复审已修**：系数 **config 化**（后端 `ORDER_CHAIN_ECON` 经 view-config 下发，换租户=换配置）+ 表头**明标假设比例** "估算·22%/30%/18%"（title 披露"营收×行业占比固定假设·无实测库存"）。口径：**半真（营收/毛利真算 + 库存诚实标固定假设·系数 config 化）**。
- **3a（反事实排除）**：后端机制真，但 demo `excludedFactors=[]` 零产出——**增量3b 扩种已解**（物料保障率 +2 候选反算达标→排除可见，加性冻结超集，FDE 坐实）。
- **门限**：`genuine-sim:check` 是**文本哨兵**（挡 schema 缺 dataMode / 前端裸渲染 / hashN 现编 / MOCK 叫实测 / 系数未 config 化），但**挡不住语义级"换写死系数+贴估算字"**——此为静态门固有限。

**最终口径（取代"全闭"）：假2/假4 真修 · 假1/假3 半真（已修文案+config化，诚实标不冒充真算）· 3a 机制真+3b 扩种使可见。台账暂不标全闭，待审核方活体复验。**

## 5. 待续（增量1 剩 + 后续）
- 假2 项目沙盘紧张度色块（`capacity.ts` 裸 import mockTightness）：同款 dataMode + 前端标（增量1b/驾驶舱增量2 前置）。
- 假4 PropagationTimeline 写死 0.6万/套（孤儿挂载 + 系数取 risk_timeline 真值）。
- bottleneck_matrix 前端传 LIVE（不永远 MOCK·AUDIT 真值判据③）。
- 门 `genuine-sim:check`（静态扫推演 schema 无 dataMode / 前端红黄未消费 dataMode / 组件内 hashN 编财务）。
