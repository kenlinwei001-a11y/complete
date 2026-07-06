# SKILL-LIBRARY-EVERYWHERE FDE 实证（用户亲定·独立 skill 库·全预设）

日期 2026-07-06 · 铁律 0.4：真起服务真跑真数据真看结果·逐值对照后端·不作假。

## 真起服务（内存模式·SEED_DEMO=1·非 mock）

```
PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs-fde SEED_DEMO=1 CREDENTIAL_KEY=<64hex> SERVICE_TOKEN=svc node apps/datacore/dist/server.js
PORT=4002 DATACORE_BASE_URL=http://127.0.0.1:4001 SERVICE_TOKEN=svc JWT_SECRET=dev CREDENTIAL_KEY=<64hex> node apps/agentcore/dist/main.js
```

两服务 listening（datacore:4001 / agentcore:4002）。鉴权 `X-Debug-User: demo:admin:admin|planner|catalog_admin`。

## 证据①：workflow-skill 确定性消费——结论叙事随绑定 skill 的方法论模板变化（防跑偏核心）

真跑 QOS `POST /api/v1/queries`（Path A workflow-first）→ `GET /api/v1/queries/:taskId`。

**S02 affected_orders（常州基地影响哪些订单？）** · path=WORKFLOW · blockCount=4：
```
TEXT: 本次回答所用参数：基地=常州。
TABLE
TEXT: 受影响订单共 6 张，明细见上表 ⟦ref:prov_...⟧。
TEXT: **方法论口径**（确定性组装口·非模型注入）
〔风险诊断方法论〕按风险诊断法解读：先定位风险时序越线峰值，再分层排除根因（齐套/良率/检修），最后按交期/齐套/良率归类受影响订单并量化敞口。
  判定口径：越线峰值时点；根因分层（齐套/良率/检修）；受影响订单归因分类；营收/毛利敞口量化。
```
逐值对后端：该文本**字节等于** seed `skl_risk_diagnosis.methodology.conclusionTemplate` + `criteria`（`apps/agentcore/src/mocks/seed.ts`）。

**S20 carbon_q（4680-NCM 出口欧盟碳足迹达标吗？）** · path=WORKFLOW：
```
**方法论口径**（确定性组装口·非模型注入）
〔碳合规方法论〕按碳合规法解读：全生命周期分项（材料/能耗/物流）核算碳足迹，对照出口目的地阈值判达标，超标则给绿电/能效/就近产地减碳杠杆。
  判定口径：全生命周期分项核算；出口目的地碳阈值；达标/超标判定；减碳杠杆（绿电/能效/产地）。
```
S02 与 S20 **方法论块不同**（风险诊断 vs 碳合规）→ 证明 workflow 结论叙事**随绑定 skill 模板确定性变化**，非挂名不消费、非 LLM 自由发挥。诚实边界钉死：确定性组装口（模板/口径）·`skillMethodologyBlock` 纯字符串组装（R6 字节一致）·**不调用任何模型**。

## 证据②：一等管理面引用计数——哪些 agent/workflow/plan/intent 在用此 skill

`GET /b/v1/skills/skl_risk_diagnosis/references`：
```
count= 12
by kind= {"agent":3,"workflow":1,"plan":4,"intent":4}
sample= [ agent:推演与风险助手(skills), agent:订单全链聚合助手(skills),
          agent:全域探索智能体(skills), workflow:交期风险扫描流程(skillRefs（组装口方法论绑定）) ]
```
四类在用方（agent.skills / workflow.skillRefs / plan.skillRefs / intent.bindings.skillId）全部反查到位（`resources.ts computeReferences(kind:"skill")` 扩展）。

## 证据③：牙齿·revert→红（亲手 EXIT=0）

`npx vitest run test/skill-library.test.ts` → **9 passed · EXIT=0**：
- 引用完整性门（agent/workflow/plan/intent 引用 skillId 必存在且 PUBLISHED·孤儿红）；
- 20 卡覆盖（13 workflow-first / 7 agent-first 分组齐·每卡挂对口方法论·承载体在位）；
- skillMethodologyBlock 字节稳定 + 随 skill 模板变化 + 无绑定不追加（revert methodology/skillRefs 即红）。

回归：`runtime-workflow/qos-a/b/c/d/e/g/scene-agent-runtime/refs/references-rule-solver/platform-agent-surface/evals-scenario-suite(20 场景真跑)/scenario-*` 全绿；frontend 492 passed。

## 诚实分期边界

- 前端管理面（SkillsPage 方法论编辑区 + WorkflowsPage skillRefs 多选 + 引用面板）已落地、frontend 单测全绿、build 0 err；**真浏览器逐值走查未做**（本单 FDE 走 API 级真起服务真跑，UI 真渲染走查建议后续单补）。
- 未自跑 `pnpm gates`（主控收口跑）。
