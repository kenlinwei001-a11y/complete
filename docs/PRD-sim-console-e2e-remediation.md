# PRD · 统一推演控制台 E2E 实测整改（2026-09-18）

> 仓主令（原文）：「你作为测试人员，完整测试"统一推演控制台"的功能，输入多个扰动因素，
> 追踪每个环节的推演，是否是真实推演，是否有被卡住，降级的环节。如果卡住，或使用 mock
> 数据未使用真实后端数据，则记录下来，而不是绕过去。」
>
> 本文是那次实测的**过程记录 + 根因台账 + 整改需求**。全部证据落在
> `docs/evidence/sim-console-e2e/`（本 PRD 只引用，不复制）。
> 测试分支 `claude/handoff-edge-wire`（real-cells@4bde203f + desat3@f072c8dc 合并树），
> 全部结论出自真后端 `SEED_DEMO=1` 内存模式 + 真浏览器，零 MSW。

---

## 1. 测试过程（怎么测的，含纪律与两轮根因）

### 1.1 环境（全真，逐件自证）

| 件 | 出处 | 自证 |
|---|---|---|
| datacore | 本 worktree 合并树 dist，内存模式 SEED_DEMO=1 @4001 | view-config `propagationCount=50`（旧 canonical 42）+ 会话 RUNNING@96 |
| agentcore | 本 worktree dist @4002 | 启动日志 + 访问日志 |
| frontend | 本 worktree dist，vite preview @5173（127.0.0.1） | env.ts localhost 分支直连 :4001/:4002 |
| 驱动 | playwright-core + 系统 Chrome（`drive.mjs`） | service worker 注册=**无** ⇒ MSW mock 未激活 |

纪律：卡住/mock/降级**只记录不绕行**；网络全量留证；每步 try/catch 落 findings；
证据即写即落盘；每件结论用**双服务端访问日志**交叉对账（浏览器网络层看不到
agentcore→datacore 的 OBO 服务间调用，只看浏览器会漏判）。

### 1.2 真实推演 · 七环证据链（每一环都对上 API 真相）

1. 登录守卫 → 左导航「统一推演控制台」→ 渲染 ✅
2. 扰动目录 12 类事件全部可落地（landable=1）✅
3. **施加 4 件异类扰动**（铝箔+20% / 容百科技+7天 / 广汽集团单+30点 / 常州装配 E1 停机2天），
   落点全部从真实候选列表选出（物料8/供应商15/订单500/设备500），API 落盘逐条对上（startTick=97）✅
4. 「开始推演」18.3s 五步走完（施扰×4 → tick 3拍 → 取世界 → diff → 求解器）：
   tick 披露完整（切片 12,499节点/13,533边 0丢弃 · 规则声明49触发48 · trace 6,770行 ·
   `agent.invoked=false` 如实 · timings 五段 12,955ms）；屏上 verdict「3,580 格变化」
   与独立现算的世界差**逐字一致** ✅
5. 单源逐跳追踪：铝箔落点格 priceShock 2→22 精确；5 个型号 costPressure 的 trace amount
   按 BOM 份额拉开（0.02703844507 vs 0.031675005221）——「同量不同价同压」病灶机制在 UI 路径复现 ✅
6. 结果面板全真数（受阻环节18=卡点5·堵点6·断点7；敞口基数=真订单簿454.6亿）✅
7. 生命周期：暂停 → API 直验 POST tick ⇒ **409 真冻结** → 恢复 ✅

### 1.3 模块调用矩阵（谁被调了，谁没调）

| 模块 | 调了吗 | 实测证据 |
|---|---|---|
| 本体切片 | ✅ | GLOBAL · hops=1 · 12,499节点/13,533边 · 0丢弃 |
| 规则（传导边50条） | ✅ | 声明49/触发48 · 逐条系数/权重/延迟/合并方式披露 · `withCoefficientRef=0`（全内联常数）· 对抗方关闭（1条还手 suppressed 如实列出） |
| 约束 | ✅ | stateVarBounds 33条（值域+衰减λ+decayRef出处）· saturations 40 · cadenceSkipped 4 · undeclaredStateVars 14 |
| 求解器×4种 | ✅ | datacore.log 按时间窗+reqId 逐条：清洁窗内 chain_impediments×1（runM 第⑤步，经 agentcore `/b/v1/solvers/:key/run` OBO 透传）+ bottleneck_matrix×1（传导识别页签）+ mitigation_select×1（方案寻优页签）+ chain_loss_attribution×1（损失归因页签） |
| agent | ❌ 未调 | `agent:{invoked:false,calls:0,provider:null,model:null}`，披露层与屏上均如实 |
| skill（B4） | ❌ 未调 | agentcore.log 零 skill 路由（skill 属问答编排路，控制台主链不经过） |
| LLM | ❌ 未调 | 零 provider 调用；AI 问答钮未点（未测面，需供应商 key） |

### 1.4 根因追源：两轮（第二轮是仓主追问逼出来的，照实入档）

第一轮对 8 行登记逐项追到 file:line；仓主追问「100%确认吗」后复验：
**4 条成立、2 条推翻/大改、2 条精化、1 条错数纠正**（裁决表见证据报告「根因复验记录」节）。

第一轮的系统性疾病：**对「产品自己的注释/屏上文案」照单全收当根因，没按铁律 0.5 再追一层
到真回包** —— 本仓铁律 1.5 判据四「信注释 = 信台账」的活例，审核方自犯。
**教训落法：凡引用产品自述当下游结论的根因，先对真回包/真日志验一把再引用。**

---

## 2. 发现总表（8 行登记 + 复验后裁决）

| # | 现象 | 复验后根源 | 级别 |
|---|---|---|---|
| 1 | 专家卡墙截断 500/6,363 条（7.9%），屏上红字带真数自承 | 为「白名单下钻」设计的 metric-series 端点（契约硬上限 500，回包体积闸）被当「全量普查馈线」用 | 🔴 降级（设计上闸） |
| 2 | 「耗时合计 — 毫秒」恒缺席 | **前端手搓形状与契约相悖**：契约 `timings: SimDisclosureTiming[]`（数组），前端 `as Record` 取 `timings?.total ?? d.totalMs` —— 数组无 `.total`，后端从无 `totalMs` 字段（datacore 全 src 零命中）⇒ 恒 null | ⚠ **真缺陷（唯一）** |
| 3 | 看板「最快见效/最低代价」无出处 | 引擎候选 dims 只有 3 维（超阈幅度/严重度/产能），`cost/cycleDays/timeToEffect` 全 0 处（直调回包实测）—— **引擎输出模型确无此两维**，屏上诚实 | ⚠ 引擎缺口 |
| 4 | 传导影响图「本次不画」 | **前端注释陈旧挡画**：直调回包 18/18 条带 `carriers`（orderCount/orderAmount 163.5亿/amountBasis:ORDER_LINE/path 链路/customerCount/sampleOrderIds）——画线原料引擎今天全给；真缺口只剩「扫描不按本次扰动归因」 | ⚠ **前端过期前提（复验推翻原判）** |
| 5 | KPI 卡无迷你走势线 | 单包确无 series；但 tick `n=1` 逐拍调可采中间态 —— 根因是**前端五步流一次跳 N 拍只取终态，没走采集路径**，屏上「缺数据源不是缺实现」说反一半 | ⚠ 前端流程缺口 |
| 6 | ~150单/~17家/~156.6亿 带「~」 | 数字是前端 `buildMoneyView` 用世界差分×真订单簿自算（与求解器 carriers 是两个独立真实计算，计数巧合一致、金额口径不同）；本次 3,580 变化格 **0 格**从占位初值变走 ——「~」是产品对「世界不全真」的**保守标注**，不是这组数被占位污染的证据 | ⚠ 口径标注（非污染） |
| 7 | 页签×3 禁用（演习结论/传导边册/本体与就绪） | `renderer:null + pending` 明文理由；演习结论的**三个后端接口已就绪**只缺版面 | ⚠ 未建版面（后续单） |
| 8 | 首跑落点候选>20s、tick 客户端30s超时 | 与 recheck vitest 撞窗口（4核机 ≤1 并发纪律被测试方自己排窗打破）；清洁窗口重跑全部消失 | 🔵 环境态，非产品 |

**总结论：真实推演成立，零 mock 冒充真后端，零静默绕行。真缺陷只有 #2 一条（前端）。**

---

## 3. 整改需求（每条带对照实验验收，铁律 1.5 判据一）

> 归属说明：#2/#4/#5 在 frontend-shell（测试方为禁碰区，本 PRD 只开账）；
> #3/#6 跨 datacore 与契约包；#1 涉及契约常量；#7 是后续单。**实施均另派 WO，本 PRD 不定排期。**

### R1（P0 · 唯一真缺陷）耗时合计：按契约消费 timings，不许手搓形状

- **问题**：`Console0828.tsx readDisclosure` 把 `SimRunDisclosure` 重新 `as Record<string,unknown>`，
  取 `timings?.total ?? d.totalMs` —— 两条路全死 ⇒ 「耗时合计 — 毫秒」恒缺席。
- **根源**：有 zod 契约（`packages/contracts/src/sim-disclosure.ts` `timings: z.array(SimDisclosureTimingSchema)`）
  不用，手搓平行形状；TS cast 运行时不报错 ⇒ 漂移静默。
- **需求**：消费契约类型（`timings.find(t => t.phase === "total")?.ms ?? null`），
  或干脆用 `SimRunDisclosureSchema` 解析回包。**同类手搓 `as Record` 读取全文件扫一遍一并收。**
- **对照实验验收**：真跑一次推演，屏上耗时数字必须与 tick 回包 `timings[phase="total"].ms`
  **逐字一致**；变异反证 —— 把取值改回 `timings?.total` ⇒ 接缝测试当场红。

### R2（P1）传导影响图：原料已齐，画；不画就把陈旧注释改成今天的真理由

- **问题**：屏上「不画」的两条理由中，「没有订单数、没有金额」**已死** —— 引擎 `carriers`
  今天全给（18/18 条）。剩余真理由只有「扫描不按本次扰动归因」。
- **需求（二选一，产品裁决）**：
  a. **画**：以 `carriers.path`（既有链路键序列）为线、`orderAmount`/`customerCount` 为权重，
     `sampleOrderIds/sampleCustomers` 为下钻；
  b. **不画**：把注释改写为今天仍成立的唯一理由（无扰动↔环节归属维），并挂可执行赌注
     （引擎哪天给出归因维 ⇒ 门红 ⇒ 回来画）。
- **对照实验验收**：图上/注释里的每个数必须能与直调回包逐条对上（抽 3 条 impedimentId 对
  path/orderAmount/customerCount）；选 a 时 —— 施加一件已知扰动（铝箔+20%），图上必须出现
  与该扰动可达集相交的环节，否则红。

### R3（P1）经营看板「最快见效 / 最低代价」：引擎先产维，前端再上列

- **问题**：两列今天无出处（实测定案）：候选 dims 只有超阈幅度/严重度/产能 cellsPerDayP50。
- **需求**：产品先定**口径**（例：time-to-effect 可从候选杠杆的 `lever.unit`/`fromValue→toValue`
  与既有行程延迟 `delayTicks` 推导；cost 需新建口径，不许拍脑袋高中低）→ `impediment-options`
  产维（`betterWhen:` 从 3 长到 4/5，`@stale-fact` 门同步改钉）→ 前端上列。
- **对照实验验收**：取一条真候选（如 leadTime 26→10天），屏上「最快见效」列必须显示与该候选
  杠杆口径一致的数；口径未定的列维持「无出处」诚实标注，⛔ 不许先上编造的数。

### R4（P2）KPI 迷你走势线：走逐拍采集路径

- **问题**：五步流一次跳 N 拍只取一次终态 ⇒ 全屏只有两个观测点。
- **需求**：runM 改逐拍推进（`tick n=1` ×N，每拍留中间态）或回包加 perTick 序列字段（二选一，
  前者零契约改动）；走势线只画**采集到的点**，不插值不补历史。
- **对照实验验收**：horizon=3 的推演 ⇒ 每卡恰 4 个观测点（扰动前+3拍），点数 != horizon+1 即红；
  与逐拍 world 快照对账逐字一致。

### R5（P2）专家卡墙：给普查级取数路径

- **问题**：契约硬上限 500（`SIM_METRIC_SERIES_MAX_LIMIT`，为下钻体积闸设计）对 6,363 条目录取
  只取回 7.9%；卡墙已显式传满 limit，无路可再加。
- **需求（二选一）**：a. 端点加分页/游标（保体积闸性质：回包规模由请求决定）；
  b. 卡墙改走「先普查目录（轻量键表）→ 按可视区下钻序列」两段式。
- **对照实验验收**：`shownMetrics == totalMetrics`（6,363），`usim-truncated` 警示条消失；
  单包体积不超既有闸（分段请求各自 ≤500 条）。

### R6（P2）源侧占位三变量真实化：消掉每拍 0.16% 的占位注入

- **问题**（实测）：tick97 仍有 413/6,363 格 verbatim 占位；其中 **122 个源侧占位格**
  （Order.orderChurn 110 + Equipment.equipmentFailure 10 + Order.leadDays 2）因引擎按绝对值传导
  （`propagation.ts:864`）且源侧不衰减（`:715`），**每拍以「系数×占位值」注入下游** ——
  真实 trace 对账 312/6,770 行（4.6%）、|amount| 占 0.16%。
- **需求**：给这 3 个 (类型,变量) 补真实属性源（WO-SIM-REAL-DATA 的 valueRef 同口径；
  解不到规格当场红，⛔ 不许静默回落哈希）；暂无真实源的，显式置 0 并在出处写明，不许留哈希值。
- **对照实验验收**：播种后 tick0 这 3 个 (类型,变量) 的占位格数 = 0；hash 重算扫描全世界
  verbatim 占位 413 → 291（只剩 handlingBacklog 287 + splitPressure 4，两者无出边不驱动）；
  ⚠ 世界初值会变 ⇒ D4/D5 基线需重钉（与 wo-sim-edge-wire 报告 ③ 号 backlog 系数账单联动，同批决策）。

### R7（P3）三页签版面（后续单）

- 演习结论：**三个后端接口已就绪**，缺这档版面；传导边册：整册版面（关边能力今天已在
  传导识别/损失归因/方案寻优三档底部抽屉）；本体与就绪：就绪认证+真实性标注两张表。
- 验收：三档 `renderer` 注册、`pending` 文案移除、各带一条接缝测试。

---

## 4. 本体引用与影响（铁律 0 必填）

- **对象类型**：R6 触及 Order/Equipment（补真实属性源，不改类型结构）；无新增对象类型。
- **链路**：无新增 linkType；R2 消费既有 `carriers.path`（material_has_batch / material_used_by_model /
  orderline_for_model 等既有键）。
- **事件**：无新增。
- **契约**：R1 为消费侧修复，`SimRunDisclosure` 契约**不动**；R5 若选分页方案触及
  `packages/contracts/src/sim.ts`（metric-series 端点参数），选 b 则不动契约。
- **不变量**：R6（确定性种子）—— R6 改世界初值，同种子重跑仍字节一致，但**跨版本基线变**，
  D4 稳态表与 D5 指纹四数需重钉（与 ③ 号 backlog 系数账单同批，避免两轮重钉）；
  R1/R2/R4/R5/R7 不触世界态，R6 语义保持。
- **断点台账**：本 PRD §2 即当前断点全表；修复关闭后回写 `docs/SYSTEM-ONTOLOGY.md` 对应行。

## 5. 证据索引

`docs/evidence/sim-console-e2e/`：REPORT.md（含根因复验记录）· findings.md（逐步日志）·
network.log（浏览器侧 57 请求）· tick-response-1.json（2.1MB 全披露）· world-1/2/3.json
（tick97/100 快照）· perturbations-latest.json · 截图 8 张 · drive.mjs（可复跑驱动）·
服务端双日志 `/tmp/wo-console-e2e/{datacore,agentcore}.log`（易失，关键行已摘入 REPORT）。
复跑命令见 REPORT.md「复现」节。
