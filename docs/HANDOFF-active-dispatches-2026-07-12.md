# HANDOFF · 活跃派单备份（2026-07-12·审核方）

> 用途：额度不足随时停止时，供其他 LLM 接续。**唯一真相源 = `docs/work-queue.json`（owner/note/doc 字段）**；本文是可读快照 + 上下文。

## 0 · 关键上下文（先读，否则接错分支/破基线）
- **仓库**：`kenlinwei001-a11y/complete`。**canonical 分支 = `claude/vigilant-knuth-b1nmxn`**（2026-07-12 活）。⚠ `main`(冻 06-15) 和 `claude/inspiring-gates-aqczjg`(冻 06-23) 是**六月冻结快照·比 canonical 少 1757 提交·勿在其上核 diff / 部署**。
- **两系统**：DataCore A（Fastify·4001·`/a/v1`）· AgentCore B（Fastify·4002·`/api/v1`+`/b/v1`）· frontend-shell（React18/Vite·`VITE_MOCK=1` 离线 mock）。
- **起服务（内存模式·无DB）**：
  ```
  pnpm install && pnpm -r build
  PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 CREDENTIAL_KEY=$(openssl rand -hex 32) node apps/datacore/dist/server.js &
  PORT=4002 DATACORE_BASE_URL=http://127.0.0.1:4001 node apps/agentcore/dist/main.js &
  VITE_MOCK=1 pnpm --filter frontend-shell dev   # 前端 mock
  ```
  调试鉴权头：`X-Debug-User: demo:admin:admin`。**勿用端口 4045**。demo 账号 demo/admin/密码 demo1234。
- **交付底线**：`pnpm -r build && pnpm -r test` 4 包全绿（现 datacore 1278 / agentcore≥66 / frontend 609）。
- **铁律（违反即返工）**：
  - **0.4 真实测试**：断言"能用/满足"前必真起服务真跑真看；涉前端必真浏览器 + 逐值对照后端真值；只单测/gates=冒烟≠真能用；不作假。
  - **G-DM-1 / KILL-MOCK-RED**：绝不用合成/hash/写死冒充真实数据源或真值；无真源→诚实空态。
  - **backend-real（用户亲定·钉死）**：数据必须后端真实存在（本体切片/规则/约束/agent/workflow/skill）·**不写死在前端**。
  - **确定性**：seed 42 字节一致；改合成需守 `debattery:check` / `genuine-sim:check` 绿（新 draw 追加 rngTopo 末尾·勿插中间）。
  - **contracts-only-shared** / **tenant_id everywhere** / **no-secrets-echo**（凭据 AES-GCM·不回显）。
  - 母体回写：改链路/事件/类型/不变量/门 → 回写 `docs/SYSTEM-ONTOLOGY.md` + 跑 `pnpm ontology:slices`。
- **commit 尾**（每次）：
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018QehY1oPQ1wRBQ9VuFRSaW
  ```
- **push**：`git push -u origin claude/vigilant-knuth-b1nmxn`；队列高并发→push 前先 `git fetch && git reset --hard origin/... && 重放改动`（rank-max 合并·勿覆盖他人 claim）。

---

## 1 · WIP 派单（正在做·按 dev 分组·prompt=note/doc）

### dev1 → **WO-CAPSIM-FRONTEND-PARITY**（P1·WIP）· 文件 `apps/frontend-shell/src/views/RiskBoardView.tsx`
CAPSIM 1:1 前端真缺项（真代码核验过）：
1. **QA 面板改真调 agt_risk**（命门）：现 `tsx:811-814` `/客户|谁/.test(q)` 纯前端正则·零 agent·答案派生本地 card → 改真调 agent（经 QOS 或直端点）·答案来自真 agent。
2. **富逐日 hover**：现 `tsx:730` 仅原生 title → showDayTip 富弹窗（日期+T+d+当日值+事件脉冲+受影响订单明细表·参照 HTML:2547）。
3. **四增强**：多方案 topN+比较矩阵（现 MitigationCards 无对比）/ 缺失分类面板（未实现）/ 全元素悬浮溯源（`RiskHoverTrigger` `tsx:325` 现仅包 factor chip→扩全元素）/ `InferenceProcessPanel`（`tsx:452` 存在·须验内容接真 provenance 非写死）。
4. **导出最终规划 button**（疑缺·参照 HTML:3491 exportPlanTable）。
5. **配色档裁定**：现 #43B7D7/#E8B54A/#E0626C vs 参照 #62BE77/#D2B04C/#DD7E9E（原铁律颜色走 tokens·像素 1:1 需调 token·待用户定）。
- 已确认**非本单**（V2 已接）：订单聚合 tab（tsx:257-260/289）+ 经营看板 inline（tsx:516 OrderAggView）。
- 验收：真浏览器逐值——QA 答案=真 agent 输出·hover=真事件/订单·禁前端写死。

### dev2 → **WO-DATAMODE-DERIVECELLMODE-FIX**（P2·WIP）· datacore
`deriveCellMode` 未识别"合成物化态"(materialized-from-synthetic) → demo 102/102 单元格全标 LIVE = 合成冒充实测（违 0.4/G-DM-1）。修：synthetic-origin materialized → 标 SYNTHETIC/MATERIALIZED 非 LIVE。解 `WO-SANDBOX-TRUST-BADGE-BE` BLOCK。green→red 锁。

### dev4 → **WO-QOS-CLASSIFY-REBALANCE**（P1·WIP）· **完整 turnkey spec 见 `docs/WO-QOS-CLASSIFY-REBALANCE.md`**
原始 bug："未来30天每个瓶颈会影响订单的交付？"误路由→"缺乏方案比对"。根因：`apps/agentcore/src/mocks/seed.ts` `what_if_displacement_q` 3 示例·`signal_propagation_q`/`shared_bottleneck_q` 各 1 → 语义重叠误路由。**三管齐下**：① 新增 `EXAMPLES_OVERRIDE`（~line 622·各补≥3 区分性示例·代码在 doc 里）+ 改两处 examples 赋值(~605/~663)；② `multi_plan_compare` 缺 schemes 时降级单方案·不抛错；③ 核实 S30 presetContext 已预填 {rootType,rootId,layers}。验收 curl：`POST /b/v1/query {"query":"未来30天每个瓶颈会影响订单的交付？"}` → `.classification.candidates[0].intentKey` 应=`signal_propagation_q`/`shared_bottleneck_q`。

### dev（沙盘 Lane）→ **WO-SANDBOX-TRUST-BADGE-BE**（P2·WIP）· datacore/agentcore
S2 后端半：propagateTick/view-config 透传 dataMode 诚实位（真派生=LIVE·合成 origin=SYNTHETIC·滞后=STALE·未校准=UNCALIBRATED）+ SimTickState 加 dataMode。⛔透传非造·复用现成 SolverDataMode 枚举 + ObjectInstance.origin。与前端半 `WO-SANDBOX-TRUST-BADGE`(dev3 已建) co-verify。**与 DERIVECELLMODE-FIX 同根**。

### dev → **WO-SANDBOX-READINESS-UX**（P0·WIP）· 前端
就绪认证信任条+[查看完整体检]抽屉入看板。⚠**注**：参照 HTML **无**信任条（grep 0）——这是平台增强·非纯 1:1。若做 1:1 复刻则勿入 1:1 页（用户已裁：该 dev 非 1:1 任务则无妨·1:1 走独立 standalone 页）。

### reviewer-exec（审核方执行）→ **WO-CAPSIM-BACKEND-DENSITY**（P0·WIP·sub-agent 曾跑但卡死·仅改 battery.ts 4 行未验·已从主树回退）
CAPSIM 密度=**后端 seed 工程**（不写死）。参照 8 红卡是编的；真后端读真张力(56-67)只 2 卡诚实越线。计划：
- **P0-1** 种真逐基地 OEE/利用率/良率时序（`apps/datacore/src/seed.ts` / `synthetic/packs/battery-manufacturing.pack.ts` / `synthetic/tsgen.ts`）→ 设备OEE/良率波动 source→LIVE（现无真测→SYNTHETIC 被排除·只瓶颈工序 LIVE）。
- **P0-2** 抬 ≥8 base×factor 真需求缺口（提 DemandSegment p50/p90 或降 per-base 产能）→ 真张力合法≥85 → 越线卡↑·因素点→~20·订单→~14·T+11。
- **P1-3** `risk.ts:478-586` 输出逐卡 `factors[]`（全 live+越线因素·非单一代表）。
- **P2-5** 种真时延信号(staleHours>2)→confidence.stale=true→C09 触发数据健康度横幅。
- ⚠**守基线**：多测 pin demo 值（S01 P50 5.0079/驾驶舱 130/90）·raise SEG_DEMAND 会波及大量断言 → 优先 additive/隔离热场景·勿盲改默认 seed；真跑证 ≥6 越线卡 dataMode=LIVE + `pnpm -r test` 影响面报告后再提交。

---

## 2 · BUILT 待审核方真浏览器逐值复验（dev 交付≠DONE·26 单·下面列主要）
- **dev2 DB 批**（我已真跑复验 DONE-ready·1278 绿·待授权 flip）：`WO-DB-MODELING-WIRE`(道B DERIVE 真·非 G2)·`WO-DB-LINK-STABILIZE`(FK 兜底非空切片)·`WO-DB-BSTACK-DERIVE`(沙盘边界守)。
- **dev2 台账**：`WO-SA-1`(line_belongs_to_base N:N→N:1)·`WO-SA-2`(Equipment mtbf/mttr/health)·`WO-SA-3`(新 Workshop 类型)。
- **dev1 台账**：`WO-SA-4/5/6`(Base/Line/Equipment 台账字段·对齐 docx·datacore 1282 绿)。dep=SA-3 未 DONE→按链先验 SA-3。
- **dev3 沙盘/RC**：`WO-SANDBOX-TRUST-BADGE`(前端徽标)·`WO-RC-UX-KPI-CARRIER`(磁贴 post-tick 真变·治"推了没反应")·`WO-RC-UX-DOOR-TEXT`(门文案"可试跑")·`WO-CAPFORECAST-DATAMODE-HONEST`(行级 dataMode 诚实)·`WO-DB-FIVE-ACT-UX`(五幕向导)。
- **dev**：`WO-CAP-10`(敞口折算)·`WO-CAP-08`(运营一条龙)·`WO-DB-DERIVE-DECISION-FIELDS`(记录→决策字段派生·G4)·`WO-SWEEP-01/02/03`·`WO-THEME-SWITCH-U8`·`WO-SHOCK-GUARD-HARDEN`。
- **dev4-import**：`WO-IMPORT-REPLACE-SYNTHETIC`(world_source=imported 读真值)。
- **reviewer-exec**：`WO-CAPSIM-REPLICA`(P0·V2 已真浏览器复验骨架·待用户 1:1 签收·但真缺项见 §1 dev1 单)。
> 复验法（铁律 0.4）：真起三服务 + 真浏览器逐值对照后端 curl → DONE 或 BLOCK。禁绿测试翻勾。

## 3 · BLOCKED
- `WO-RC1-CLOSURE-SCOPE`(P1)：让 Dev-1（字节基线红线域）·补 Quote/Action 类型或给 ErpOrder/MesOrder/SrmOrder 建切片 root。
- `WO-CAP-09-SANDBOX-TICK-LIVE`(P3)：先定 SandboxView 存废再裁 scope（fold 入看板？）。
- `WO-RC2-DEFAULT-FEED`(P3)：前端 createSimSession 传 feedSpecs + 无源诚实空态（勿后端注入合成 feed 冒充活体）。

## 4 · 已补登 TODO（防沉没·未认领·用户亲点）
`WO-DEBT-A3-MULTIHOP-SLICE`(P1·14 域参考本体+多跳切片规划器·🔴FDE 核心)·`WO-EDS-6PHASE-EPIC`(P1·三条道总账)·`WO-DEBT-A4-OBJECT-BROWSER`(P2·对象浏览页"找不到")·`WO-DEBT-A5-FDE-NODEGRAPH`(P2)·`WO-DEBT-A15-LOADTEST`(P2·工业级压测)·`WO-U12-GRAPH-QUERY-LOWCODE`(P2)·`WO-DEBT-A16-E2E-CI`(P3·待用户拍板)。

## 5 · 全景现状（供优先级判断）
见 `docs/CHAPTER-TEST-MATRIX.md`(64 章)·`docs/req-inventory/`(2228 需求)·`docs/COMPLETION-LEDGER.md`。要点：脊柱真能用；4 引擎(DAG/RequirementGraph/CBR/L2)**建成但 feature flag 关闸**（翻闸即用）；真缺=Skill Graph(Ch15)/Learning Loop(Ch18)/角色化多 agent 团队(Ch63·P2 远期已定)/AI 原生安全(Ch65)/预测 ML/云原生 L3。
