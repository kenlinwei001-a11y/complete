# WO-FORECAST-SIM · FDE 真跑证据（推演接需求-产能真源 · 合并 A★ 洛阳死路）

> dev 实装 + 亲手真跑自验。判据三条全过；诚实标注 PARTIAL/MOCK 边界；距北极星留项。
> 红线：`risk.ts` 无 `Math.random`/`Date.now`/`new Date`（R6 确定性）；tenant 隔离 R2；契约只经 `@platform/contracts`。

---

## 1. 改了什么（根因解·非省事）

### ① 求解器 `apps/datacore/src/solvers/risk.ts`：紧张度从哈希 → 真需求-产能缺口
- **根因**：旧 `tensionSeries` 基线 = `mockTightness(c,base,factor)`——`(base首字符码 + factor首字符码×7) mod 9` 的字符哈希（`:28`），与真实需求/产能无关 → "红色是哈希，不随需求变"。
- **改法**（新增确定性派生，无随机/时钟）：
  - `networkWeeklyCapacityWan(c)`：Σ 基地 `weeklyWan`（复用 `capacity.ts computeRollup` 真产能曲线）。
  - `networkDemandSupplyLoad(c)`：**量纲无关负载比**——`sopLoad = SopVersionRow(最终版/最新版).demand ÷ supply`（同期同单位的真"需求÷产能"）；`fcLoad = Σ DemandSegment.p50 ÷ Σ tgt`（预测承压比）；`upside = Σ(p90−p50) ÷ Σp50`（预测离散度）。`load = max(sopLoad,fcLoad)×(1+0.5×upside)`。避免"期内总量÷周产能"量纲错配（会恒饱和 98）。
  - `demandCapacityTightness(c,baseId)`：负载比 → 张力 `62 + (load−1)×70×(0.6+0.8×share) + (util−0.8)×40`，clamp[0,98]；`share`=基地真产能份额，`util`=本体真值占用；返回 `{value,live,gap}`，`gap=真缺口(需求−产能)×基地份额`。
  - `liveTightness`：需求驱动因素（**瓶颈工序/人力工时/物料齐套**，`DEMAND_DRIVEN_FACTORS`）无逐设备实测源时，优先用 `demandCapacityTightness`（有真预测→LIVE）；其余（物流时长/换型损失）无真源 → 回落 `mockTightness`（**MOCK 诚实不冒充**）。
  - `riskTimeline`：候选筛选 + series 基线 + mitigated 基线全部改读 `liveTightness`（`baseline = lt.live ? lt.value : undefined`）；卡附 `demandGap{gapWan,source}`（R13 可溯）。`affectedOrdersAggregate` 同步。

### ② SolverContext 注入（`types.ts` + `service.ts loadContext`）
- `SolverContext += demandSegments?/sopVersions?`（forecast 域 DemandSegment + plan 域 SopVersionRow）。
- `loadContext` 在主 `Promise.all` 加载 `listByType("DemandSegment")`/`listByType("SopVersionRow")`（网络级预测对象·非基地范围 → 不套 A6·与 Segment 同范式·R2 仍按 tenantId 隔离）。

### ③ 契约 `packages/contracts/src/solvers.ts`
- `RiskCardSchema += demandGap?{gapWan,source}`（additive·向后兼容）。`dataMode` 既有（LIVE/MOCK/PARTIAL）：接真源置 LIVE、无真预测 MOCK。

### ④ 前端 A★ `apps/frontend-shell/src/views/RiskBoardView.tsx`
- `AffectedOrdersModal`：原已是根因修态（渲染 `card.affectedOrders` 真订单 / 空列表诚实解释 / 禁裸 `zh.common.none`）。本单**升级**：LIVE 需求驱动卡显**绿色"真需求-产能缺口"溯源面板**（`affected-orders-demand-gap`：基线·非哈希·缺口=预测需求−产能·gapWan 万套·来源口径），与 MOCK 卡的黄色诚实横幅对称。

### ⑤ 本体回写 `docs/SYSTEM-ONTOLOGY.md`
- §3「数据→本体→推演链」新增 `DemandSegment + SopVersionRow → risk_timeline` 边 + `capacity_rollup → risk_timeline` 供给边。
- §8 A★ 条目补 WO-FORECAST-SIM 进度（真源接入·demandGap·门 V5d）。

### 测试 `apps/datacore/test/solvers.test.ts`
- **V5**（改）：物料齐套是需求驱动因素 → 基线改读 `card.currentTightness.value`（真张力·非旧哈希公式），断言 `dataMode==="LIVE"`。
- **V5d**（新）：改 `DemandSegment.p50/p90`（翻倍）→ `currentTightness.value` 严格上升 + `series[0]` 上抬（证"非哈希恒定"）+ LIVE + R6 两调字节一致。

---

## 2. 真跑证据（内存模式 SEED_DEMO=1·datacore dist·X-Debug-User 开发链）

启动：`PORT=4016 JWT_SECRET=dev BLOB_DIR=… SEED_DEMO=1 CREDENTIAL_KEY=<64hex> node apps/datacore/dist/server.js` → `datacore listening`。

### 判据① 紧张度由真需求-产能派生（非哈希）+ dataMode 正确

`POST /a/v1/solvers/risk_timeline/invoke {"args":{"horizon":30}}` → `topDataMode=PARTIAL threshold=85 cards=8`：

```
洛阳·设备OEE   | dataMode=LIVE curTight=83(live=true) [设备OEE 读真 OEE·非需求驱动·无 gap] peak=96 cross=D+3
武汉·物料齐套  | dataMode=LIVE curTight=67(live=true) gapWan=0.0897 peak=93 cross=D+13 aff=1
洛阳·物料齐套  | dataMode=LIVE curTight=68(live=true) gapWan=0.0864 peak=90 cross=D+14 aff=1
洛阳·物流时长  | dataMode=MOCK curTight=68(live=false) [无真源·诚实 MOCK] peak=90 cross=D+14 aff=1
厦门·人力工时  | dataMode=LIVE curTight=66(live=true) gapWan=0.0851 peak=85 cross=D+18 aff=1
```
- 需求驱动因素（物料齐套/人力工时）= **LIVE + demandGap 可溯**；物流时长 = **MOCK 诚实标**（无真数据源·绝不冒充 LIVE）；设备OEE = LIVE（读真 OEE 设备数据·非需求驱动故无 gap）。

### 判据③ 缺口 = 预测需求 − 产能 可溯（demandGap）

洛阳·物料齐套：`demandGap={"gapWan":0.0864,"source":"DemandSegment(p50/p90)+SopVersionRow.demand−产能"}`。
（demo SopVersion demand≈supply 近平衡 → 绝对缺口小；张力主由预测负载比 `fcLoad=Σp50÷Σtgt≈1.034` 驱动·真可溯。）

### 判据①（强）改 DemandSegment 真值 → 曲线随之变（门 solvers.test V5d 真跑）

`vitest run test/solvers.test.ts` → **14/14 passed**，含 V5d：
- before：洛阳·物料齐套 `currentTightness.value` LIVE；改 `DemandSegment.p50/p90` 翻倍 `repos.objects.put` → after `value` **严格 > before** + `series[0]` 上抬 → 证"红色随需求变·非哈希恒定"；改前/改后各自 R6 两调字节一致。

### R6 确定性（无随机/时钟）

- `grep -nE "Math.random|Date.now|new Date" apps/datacore/src/solvers/risk.ts`（`mmdd` 用 `Date.parse`+`toISOString` 纯函数格式化·非取当前时钟）→ 紧张度派生路径无时钟/随机。
- 真跑：同 `{"horizon":30}` 两次调用 **byte-identical = YES**（`diff -q rt-all.json rt-all2.json` 一致）。

### 判据② 洛阳红点开 → 真订单非空（A★ 死路闭合）

洛阳·物料齐套 越线 D+14（WO 举例 D+13 为示意），`affectedOrders` **非空**：
```
[{"so":"SO-3470","cust":"电网公司F","model":"圆柱-LFP","qty":6,"due":"2026-07-08","dueDay":28,"delay":1,"revenueWan":8.4,"impact":0.3}]
```
- 点任一红格 → `AffectedOrdersModal` 渲染 `card.affectedOrders`（真受影响订单 SO-3470 + 营收敞口 8.4 万）+ LIVE 卡显绿色 demandGap 溯源面板；空列表给诚实解释；**绝不裸 `zh.common.none`**。
- 前端验证：`pnpm --filter frontend-shell test` → **118 文件 / 289 测试全绿**（risk-legend/risk-plan 含；f48 meta-page 一次并发 flake·隔离与重跑均绿·与本单无关）。**真浏览器 Playwright 未在本环境跑**（构建+组件级已验·留审核方真浏览器复验）。

---

## 3. 红线核验（全绿）

- `pnpm -r build`（4 包）✅ · `pnpm --filter datacore test` → **790 passed / 11 skipped / 0 failed** ✅ · `pnpm --filter frontend-shell test` → **289 passed** ✅
- `pnpm gates` → **GATES_EXIT=0·零错误**（含 `seed-demo-smoke`[真启动]/`genuine-sim`/`no-silent-mock`[46 求解器带 dataMode]/`debattery`[无新增内联业务常数]/`cockpit-widgets`/`css-vars`）✅
- 确定性 R6 ✅（risk.ts 无 Math.random/Date.now/new Date·真跑 byte-identical）；tenant 隔离 R2 ✅（loadContext 按 tenantId）；契约只经 `@platform/contracts` ✅。

---

## 4. 哪些标 PARTIAL/MOCK（诚实位）

- **物流时长 / 换型损失**：无真数据源 → `dataMode=MOCK`（mockTightness 回落·诚实标"估算·无实测"·不冒充 LIVE）。
- **顶层 dataMode=PARTIAL**：LIVE（需求驱动 + 设备OEE）与 MOCK（物流时长）混合 → 诚实标"部分估算"。
- **demandGap 绝对值偏小**：demo 种子 SopVersion demand≈supply（近供需平衡），故绝对缺口万套量级小；张力主由预测负载比（Σp50÷Σtgt）驱动——真可溯、非伪造。这是**数据特性诚实暴露**（demo 数据本就接近平衡），非接线缺陷。

---

## 5. 距北极星还差什么

- **真浏览器 Playwright 实拍**：本环境未跑（容器/Playwright 不可用）；构建 + 组件级 + curl oracle 已验，留审核方真浏览器逐红点点开复验绿色 demandGap 面板。
- **DemandSegment HTTP 可变更入口**：当前 DemandSegment 非 HTTP-mutable（demo 种子态），"改需求→曲线变"由 V5d 单测在仓储层确定性证明；若要在运行态真浏览器演示"调需求→看板曲线动"，需补 DemandSegment 编辑端点（超出本单接线范围·留工单）。
- **demo 数据近平衡**：要让 demandGap 绝对值更戏剧化，可在种子里植入需求>产能的越线情景（opt-in·不破 R6 字节基线）——留后续校准工单。
