# ONTO-SCEN-GROWTH-LOOP · FDE 真跑证据（PRD-scenario-ontogenesis §2.5/§2.6）

> 一切以真实测试为原则（铁律0.4）：真起 datacore(4001)+agentcore(4002) 双服务（内存模式·无 LLM key=天然零 classifier）、
> 真 admin/planner API 人为挖 AUTO_DERIVE 缺口、真点卡观察自动生长升相、curl 逐值 + 真浏览器真登录截图。**未伪造任何 GOVERNED / 任何 KPI。**

补 **AUTO_DERIVE 自动生长支**（此前 launch 缺口处置只有 NEEDS_HUMAN 支）：意图/计划可确定性重建的缺口 → 点卡就地倒序发育
（`deriveScenarioCapability` 从出厂目录单源恢复 PUBLISHED → `growScenario` 重验 A10）→ 升相 GOVERNED，零工单零降相。

## 0. 服务

- datacore：`PORT=4001 JWT_SECRET=dev BLOB_DIR=… SEED_DEMO=1 CREDENTIAL_KEY=<64hex> node apps/datacore/dist/server.js`
- agentcore：`PORT=4002 DATACORE_BASE_URL=http://127.0.0.1:4001 SERVICE_TOKEN=svc node apps/agentcore/dist/main.js`
- admin：`X-Debug-User: demo:user-admin:catalog_admin|planner` · planner：`X-Debug-User: demo:user-planner:planner`

## 1. 基线：grow S01 → GOVERNED（真 KPI via 真 OBO solver）

```
POST /b/v1/scenarios/S01/grow  (admin)
→ maturity= GOVERNED | vstatus= VERIFIED
  KPI preview= 本次回答所用参数：型号=4680 三元圆柱、需求增量=0.2、周数=6。 P50 产能=5.1836GWh
```
真 KPI **P50=5.1836GWh** 由真 datacore 求解器经真 OBO HTTP 在真合成数据上算出（非占位/非兜底）。

## 2. 人为挖 AUTO_DERIVE 缺口：退发布意图（可确定性重建·别于 LAUNCH-DET 删求解器=NEEDS_HUMAN）

```
POST /api/v1/catalog/intents/int_capacity_feasibility_v1/retire  (admin)
→ {"id":"int_capacity_feasibility_v1","status":"RETIRED"}
S01 卡 maturity（意图退发布后仍 GOVERNED）= ['GOVERNED']
```
退发布意图=可由出厂目录（`seedIntentsAndPlans` 单源）确定性重建 → 判 **AUTO_DERIVE**；**区别于** LAUNCH-DET 已验的
"删求解器→SOLVER_NOT_FOUND→NEEDS_HUMAN"（缺真实能力，不可自动补·见齿 ③）。二分穷尽由 `gapDisposition` 单源钉死（齿 ①）。

## 3. 点卡（planner）→ 自动生长 → 升相 GOVERNED（正序喂倒序）

```
POST /b/v1/scenarios/S01/launch  (planner)  → taskId
GET  /api/v1/queries/<taskId>    → status= FAILED（本次点卡任务）
  gap.scenario = {"scenarioKey":"S01","name":"订单可承接性评审","maturity":"GOVERNED","ticketId":null,"grown":true}
  死答串「未能产出回答」present: False
```
点卡缺口（GOVERNED 卡意图退发布 → 编排器 INTENT_NOT_AVAILABLE → classifyGap=NO_INTENT）判 **AUTO_DERIVE** →
钩就地触发倒序发育（`deriveScenarioCapability` 从出厂目录把退发布的意图/计划**恢复 PUBLISHED** → `growScenario` 重验 A10）→
**升相 GOVERNED**，本次点卡返回诚实「已自动补齐·发育升相」卡（`grown:true`·`ticketId:null`），全程零死答、零 classifier。

验证副作用（curl 逐值）：
```
GET /b/v1/scenarios/S01/closure  → {'ready': True, 'issues': []}   # 意图/计划被确定性重建为已发布（闭包无死路）
GET /b/v1/scenarios → S01 maturity= ['GOVERNED']                   # 启动器卡升回 GOVERNED
```

## 4. 二次点卡（planner）→ 出真 KPI（发育闭环真闭合）

```
POST /b/v1/scenarios/S01/launch  (planner)  → status= COMPLETED | path= WORKFLOW
  TEXT: 本次回答所用参数：型号=4680 三元圆柱、需求增量=0.2、周数=6。
  KPI: P50 产能 = 5.1836 GWh
  KPI: P90 产能 = 4.8585 GWh
  KPI: 缺口比例 = 0 %
  TEXT: 主要瓶颈为瓶颈工序，P50/P90 与缺口见上方指标 ⟦ref:prov_…⟧
```
自动补齐后重新点卡确定性走 Path A（`deterministic:scenario-bind`），求解器真投影 KPI/table——发育闭环真闭合（非绿测试冒充）。

## 5. 双通道事件（§4 L4 · SSE ⊕ 域事件 outbox）

```
GET /b/v1/outbox  (admin)  →
  scenario.growth_triggered: 1   # launch 暴露的缺口驱动发育（source=launch·正序喂倒序）
  scenario.matured:          2   # ①基线 grow 升相 + ②launch 自动生长升相
  scenario.gap_detected:     0   # AUTO_DERIVE 全程零降相/零开票（诚实：无 NEEDS_HUMAN 缺口）
```

## 6. 二分对照：删求解器 = NEEDS_HUMAN（不自动补·开工单·降 PROVISIONAL）

`SOLVER_NOT_FOUND` 经 `gapDisposition` 判 **NEEDS_HUMAN**：不触发自动生长、开 GrowthTicket、卡降 PROVISIONAL、
不发 `scenario.matured`（齿 `scenario-growth-loop.test.ts ③` + 既有 `scenario-launch-deterministic.test.ts`）。
**二分显式无静默残缺**：`gapDisposition` 穷尽 switch（编译期 never + 运行期总函数），每个缺口码明确落 AUTO_DERIVE / NEEDS_HUMAN 一侧。

## 7. 相位呈现（§2.6 · R3 诚实分层 · 真浏览器真登录）

真浏览器（chromium·真起 vite 指向真后端 4001/4002·真 planner/demo1234 RS256 登录）渲染启动器，DOM 逐值 == 后端真下发 maturity：
```
S01: data-maturity=GOVERNED    · 徽章「已验证」(绿) · ▶启动 disabled=false（可点·无发育提示·无查看发育）
其余卡(S07/S11/S09/S10/S15/S16/S20/S04/S05/S14/S17/S18/S19/S02/S03/S06…):
     data-maturity=PROVISIONAL · 徽章「发育中·未审核」(amber) · ▶启动 disabled=true（默认不可直接跑）
     + 诚实提示「此卡尚未亲手跑通验证（发育中），默认不可直接推演；发育升相后自动可用。」+「查看发育」深链
```
截图：`docs/evidence/ONTO-SCEN-GROWTH-LOOP-launcher-phase.png`（S01 绿「已验证」可点 · 其余 amber「发育中·未审核」灰化不可点）。

## 8. 齿（每条新行为一测试 · revert→红亲验）

- `apps/agentcore/test/scenario-growth-loop.test.ts`（3）：① 二分单源穷尽（无静默残缺）② AUTO_DERIVE 全环退发布→点卡自动生长→升相 GOVERNED（matured 事件）→重点卡出真 KPI ③ NEEDS_HUMAN 删求解器→开工单+降 PROVISIONAL。
  revert 亲验：`server.ts` 去掉 AUTO_DERIVE 分支（`if (false && …)`）→ ② 红于 `gap?.scenario?.grown` 断言（line 60）。
- `apps/frontend-shell/test/scenario-launcher-phase.test.tsx`（2）：GOVERNED 绿「已验证」可点 · PROVISIONAL amber「发育中」disabled + 提示 + 查看发育。
  revert 亲验：`ScenarioLauncherPage` `developing=false` → PROVISIONAL 卡启动可点、无发育徽章 → 红。

## 9. 诚实边界

- 本单核心（launch AUTO_DERIVE 二分 + 确定性重建意图/计划 + 升相 GOVERNED + 二次点卡出 KPI + 相位呈现）**全环真 HTTP + 真浏览器真登录跑通**；真 KPI 5.1836GWh 由 grow-verify ⊕ 二次 launch 双坐实。
- `growScenario` 是留痕/重验/升相/事件/补不上开票的**单一来源**（AUTO_DERIVE 支不重造）；rebuilt 后仍未 GOVERNED（如真数据缺口 EMPTY_DATA）→ growScenario 诚实定级并留痕，或幽灵能力（无出厂来源）回落 NEEDS_HUMAN 开票支——**绝无第三种静默残缺**。
- 二分：意图/计划=可确定性派生（AUTO_DERIVE 自动补）；缺真实业务实体/求解器/规则/切片链路/领域能力=NEEDS_HUMAN（真人正门/施工工单，绝不合成冒充）。
</content>
