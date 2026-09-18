# 统一推演控制台 E2E 实测报告（2026-09-18）

仓主令：以测试人员身份完整测试「统一推演控制台」，输入多个扰动因素，逐环节追踪是否真实推演；
卡住 / 降级 / 用 mock 未用真后端的环节**只记录，不绕行**。

## 环境（全真，零 mock）

| 件 | 出处 | 自证 |
|---|---|---|
| datacore | 本 worktree dist（合并树）内存模式 SEED_DEMO=1 @4001 | view-config `propagationCount=50`（旧 canonical 为 42）+ 会话 `sims_demo_seed_world` RUNNING@96 |
| agentcore | 本 worktree dist @4002 | 启动日志 Server listening |
| frontend | 本 worktree dist，vite preview @5173（127.0.0.1） | env.ts localhost 分支直连 :4001/:4002 |
| 驱动 | playwright-core + 系统 Chrome（`drive.mjs`） | service worker 注册=无 ⇒ MSW mock 未激活；全程 57 个请求全落 :4001（`network.log` 逐条） |

首跑（14:49）与 recheck 的 sim-seed-world vitest 撞窗口，落点候选加载 >20s、tick 客户端 30s 超时
（服务端最终完成）——定性为环境污染，非产品缺陷；本文全部结论出自 14:58 清洁窗口重跑（`findings.md`）。

## 真实推演 · 逐环节证据链（每一环都对上 API 真相）

1. **登录 → 左导航「统一推演控制台」→ 控制台渲染**：通。未登录访问被守卫送 /login（符合预期）。
2. **扰动目录**：12 类事件全部 `landable=1`（原材料涨价/批次不良/临时插单/改交期/取消/到货延迟/短缺/设备故障/产能损失/改交付地/改价/预测偏差）。
3. **施加 4 件异类扰动**（真候选列表：物料 8 / 供应商 15 / 订单 500 / 设备 500）：
   铝箔+20%、容百科技+7天、广汽集团单+30点、常州装配 E1 停机 2 天。
   API 落盘逐条对上（kind/target/magnitude/startTick=97，连种子自带 1 条共 5 条）。
4. **「开始推演」18.3s 五步走完**：施扰×4 → tick 3 拍 → 取世界 → diff → 求解器。
   - tick 披露（`tick-response-1.json`）：fromTick 97→100；切片 GLOBAL 12,499 节点/13,533 边 0 丢弃；
     规则声明 49 触发 48；trace 6,770 行；`agent.invoked=false` 如实；timings 五段
     （graph 362ms / shadow 11,085ms / engine 1,180ms / persist 263ms / total 12,955ms）。
   - 世界差：before/after 两包独立现算 = **3,580 格**，与屏上 verdict「3580 格读数发生变化」逐字一致（6,363 格世界）。
5. **单源逐跳追踪（铝箔 +20）**：落点格 priceShock 2→22 精确；→ 5 个型号 costPressure 的 trace amount
   按 BOM 成本份额拉开（0.02703844507 vs 0.031675005221，比 1.1715）——D5「9.75 不再」机制在 UI 路径上复现。
6. **结果面板全真数**：受阻环节 18（卡点5·堵点6·断点7）；「怎么办」金华分切线产线利用率 89.9153、
   96%→90%、cellsPerDayP50 +2,876.39 电芯/日；订单敞口 ~156.6 亿元（基数 454.6 亿 = 订单簿真值）。
7. **生命周期**：暂停 → API 直验 POST tick ⇒ **409 真冻结**（屏上说法与后端一致）→ 恢复 RUNNING。

## 卡住 / 降级 / 缺失登记表（逐条留证，未绕行）

| # | 级别 | 现象 | 定性 |
|---|---|---|---|
| 1 | 🔴 降级 | 专家模式卡墙取数截断：metric-series 上限 500/6,363 条（7.9%），屏上红字自承「读数没取全……标『算不出来』的卡片里，有一部分是没被取回来，不是世界里真的没有」 | 产品自报降级（SIM_METRIC_SERIES_MAX_LIMIT=500） |
| 2 | ⚠ 缺陷 | 推演助手「耗时合计 — 毫秒」：毫秒数恒缺席。API 回包 timings 五段齐全，但前端 `Console0828.tsx:164` 按 `timings?.total`（对象）取值，真回包是**数组** `[{phase,ms}]` ⇒ totalMs 恒 null | **前端契约形状漂移**（禁碰区，只记不修） |
| 3 | ⚠ 降级 | 经营看板三列缺失（最快见效/最低代价「当前无出处」等，`c0828-board-missing-cols` 屏上逐列自报） | 引擎回包无这两字段（字段不存在，屏上如实） |
| 4 | ⚠ 降级 | 「传导影响图本次不画」（`c0828-graph-absent`） | 产品自报缺席态 |
| 5 | ⚠ 降级 | KPI 卡无迷你走势线（`c0828-kpi-nospark`，屏上自报口径：第二行是同次推演对比，非较上周） | 产品自报缺席态 |
| 6 | ⚠ 口径 | 受影响订单 ~150 / 客户 ~17 / 敞口 ~156.6 亿均带「~」：集合由占位世界选出（tick0 有 2,192/6,363 格为结构派生占位，屏上长文如实） | 诚实量级参考，非实测 |
| 7 | ⚠ 占位 | 页签×3 禁用：演习结论 / 传导边册 / 本体与就绪 | pending 占位（`spec.pending`） |
| 8 | 🔵 观察 | 首次跑撞 vitest 窗口时落点候选 >20s、tick 客户端 30s 超时（服务端完成）；清洁窗口全部消失 | 环境态，非产品 |

**未发现 mock 冒充真后端**：MSW 零注册；全部读数可沿 API 复算；agent 面板如实标「本次未调用 agent」。

## 卡点 / 断点 / 堵点 分类与根因（2026-09-18 追源，全部 file:line 级）

按受阻语义重排上表 8 行：**断点**=契约/数据通路断（该到的数到不了屏）；**堵点**=量被闸住/被占位稀释（数能到但不全/不真）；**卡点**=停在那没做完或环境卡死。

### 断点 ×4 —— 只有一条是真缺陷，其余三条是「缺数据源 + 如实缺着」

**断点 ①【真缺陷】耗时合计恒「—」（登记表 #2）——前端手搓形状与契约相悖。**
- 契约真相：`packages/contracts/src/sim-disclosure.ts:302` `timings: z.array(SimDisclosureTimingSchema)`
  —— **数组** `[{phase,ms}]`，total 是其中 `phase:"total"` 那一行（`disclosure.ts` DISCLOSURE_PHASE_ORDER 末位）。
- 前端错处：`Console0828.tsx readDisclosure` 把已正确定型（`SimRunDisclosure`，就在作用域里）的回包
  重新 `as Record<string, unknown>` 手搓，取 `timings?.total ?? d.totalMs` —— 两条路都是死的：
  数组上 `.total` 为 undefined；`totalMs` 在 **datacore 全 src 零命中**（后端从没发过这个字段）。
  ⇒ totalMs 恒 null ⇒ 屏上恒「— 毫秒」。tick 回包 2.1MB 里 timings 五段（12,955ms）齐全为证。
- 根源一句话：有 zod 契约不用、手搓平行形状，TS cast 运行时不报错 ⇒ 漂移静默。修法一行
  （`timings.find(t=>t.phase==="total")?.ms`），但 frontend-shell 禁碰区 ⇒ 只记不修。

**断点 ② 经营看板「最快见效/最低代价」无出处（#3）——求解器数据模型没有这两个维。**
- `impediment-options.ts` 每条对策只产 3 个量：超阈幅度 / 严重度 / 产能 cellsPerDayP50
  （`betterWhen:` 恰 3 行，有 `@stale-fact` 门现算守着，长出第 4 维当场红）。
- 没有一个是时间、没有一个是代价 ⇒ 上屏就得自编「几天见效/代价高中低」= 构造口径。
- 根源：引擎输出模型的缺口，屏上逐列写明缺的理由不一样（防「一句给不出盖住两种缺」）。

**断点 ③ 传导影响图不画（#4）——回包缺画线的两个前提。**
- 受阻环节**不随本次扰动变化**（全流程扫描只按范围裁不按扰动裁）+ 每条记录 evidence 只有
  `{metricValue, threshold, unit, ruleKey}`，**没有订单数、没有金额** ⇒ 连线=编归因。
- 根源：求解器扫描口径（不按扰动裁）+ evidence 模型无承载量；产品选择留白不画假图。

**断点 ④ KPI 无迷你走势线（#5）——tick 回包型就是一个终态，没有逐拍序列。**
- `simTick` 回包 `{curTick, state, trace?, disclosure?}`（endpoints.ts 有 `@stale-fact` 赌钉着）：
  一次跳 N 拍只读一次终态 ⇒ 全屏只有扰动前/后**两个**观测点，两点画不出走势，补一条是编历史。
- 根源：API 响应模型缺 perTick 序列；屏上明示「这是缺数据源，不是缺实现」。

### 堵点 ×2

**堵点 ① 卡墙截断 500/6,363（#1）——契约硬上限在小世界上校准，撞上 31× 大的合并树世界。**
- `SIM_METRIC_SERIES_MAX_LIMIT=500`（`contracts/sim.ts:1286`）：定 500 的依据是 seam 世界全目录实测
  204 条 + 回包体积账（500 条≈143KB，「回包规模由请求决定，不由世界规模决定」）。
- 卡墙已显式传满 500（UnifiedSimShell `limit=MAX_LIMIT`），但合并树世界目录=6,363 条 ⇒ 只取回 7.9%。
- 根源：为「白名单下钻」设计的端点被当「全量普查馈线」用；500 对校准世界富余 2.4 倍，
  对合并树世界差 12.7 倍。屏上红字带两个真数自承（7.9%），未静默。

**堵点 ② ~150 单 / ~17 家 / ~156.6 亿带「~」（#6）——占位格稀释真值口径。**
- 合并树 tick0：4,171 格实测 + **2,192 格结构派生占位**（`seed-derivation-specs.ts:139` 一带，
  本仓 D6① 普查实测同数）。受影响集合由世界差分选出，差分含占位起算格 ⇒ 量级不可当实测。
- 根源：种子世界真值覆盖率 65.5%；屏上长文如实标注出处（usim-origin），未盖 MEASURED 章冒充。

### 卡点 ×2

**卡点 ① 三页签禁用（#7）——版面未建，禁用而非假渲染。**
- `unifiedModes.ts`：演习结论（**三个后端接口已好**，缺这档版面）/ 传导边册（版面未建；
  今天关边在传导识别/损失归因/方案寻优三档底部抽屉里，并非功能缺失）/ 本体与就绪（两张表未建）。
- 根源：后续单的 UI 面，`renderer:null + pending` 明文理由，无排期语汇（接缝门守着）。

**卡点 ② 撞 vitest 窗口的超时（#8）——我自己排窗撞车，非产品。**
- 首跑与 recheck 的 sim-seed-world vitest 同窗（4 核机 ≤1 并发纪律被我的调度打破）：
  落点候选 fetch >20s（最终 200）、tick 客户端 30s 超时但**服务端最终完成**（96→97 真推了）。
- 根源：环境态；清洁窗口重跑全部消失。登记表留档不作产品裁决。

### 汇总一句

8 行里**真缺陷只有断点 ① 一条**（前端 timings 手搓形状，禁碰区已记）；断点 ②③④ 是引擎/API
输出模型的缺口且每处都有 `@stale-fact` 门防说谎；堵点 ① 是设计上闸 + 诚实量化，堵点 ② 是种子
真值覆盖率；卡点 ① 是未建版面如实禁用，卡点 ② 是环境。**没有发现任何一处 mock 冒充真后端、
也没有发现任何一处卡住后被静默绕过。**

## 未测面（如实声明）

- 推演助手 AI 问答（`c0828-ai-ask`，需 LLM 供应商配置；agentcore 已起但未配 key）。
- 「扰动后 / 图 / 底账 / 财务影响 / 对策方案」页签内容细看（tab 挂载已验证 renderer 全注册）。
- 专家模式 PerturbRail 施加路径（默认视图已覆盖施扰主链路；rail 表单结构已渲染）。
- 导出按钮（`ExportReportButton`）未点击。

## 复现

```bash
# 服务（此刻仍在跑，可直接打开 http://127.0.0.1:5173 复验，demo/admin/demo1234）
PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/wo-console-e2e/blobs SEED_DEMO=1 CREDENTIAL_KEY=<64hex> node apps/datacore/dist/server.js
PORT=4002 JWT_SECRET=dev DATACORE_BASE_URL=http://127.0.0.1:4001 node apps/agentcore/dist/main.js
cd apps/frontend-shell && npx vite preview --port 5173 --host 127.0.0.1
# 驱动
cd driver && npm i playwright-core && node drive.mjs
```

证据：`findings.md`（逐步日志）· `network.log`（57 请求全量）· `tick-response-1.json`（2.1MB 全披露）
· `world-1/2/3.json`（before/after 世界快照）· `perturbations-latest.json` · 截图 8 张 · `drive.mjs`。
