# 证据 · ADOPT-MITIGATION-FREEPATH（自由路径采纳缓解 400 · 真起真跑）

CLARIFY-CHAIN-FIX 诚实残留补队（G-2 计划↔端点契约缝）。真起 datacore(4021·SEED_DEMO 内存模式) +
agentcore(4022·DATACORE_BASE_URL 指真 A·无 LLM → deterministic:example-match)；X-Debug-User 开发链。

## 修向与根因取舍（二选一：必填+澄清 vs 模板容 null）

选 **factor 必填槽 + 人话澄清兜底**（弃"计划模板容 null 默认值"），根因推理：

- `factor` 是**决策必需输入**：真 DataCore `BATTERY_ACTION_TYPES.adopt_mitigation` paramsSchema
  required `["base","factor","planKey"]`；`mitigation_select` 方案库按 7 风险因子分域
  （物料齐套/设备OEE/人力工时/瓶颈工序/物流时长/换型损失/良率波动），同一方案对不同因子语义不同；
  审批链（planner→admin）审的就是"针对**哪个风险因子**采纳了什么方案"。
- **无合理域默认值**：7 因子无普适缺省；服务端兜底填一个 = 伪造决策内容进审批流（违铁律 0.4 /
  KILL-MOCK-RED 同源红线）。canonical 注入库与内置库因子名还不一致（物流时长 vs 物流），enum 化会误伤 →
  factor 保持 string 型 + clarifyPrompt 列取值域。
- 复用已落地 SLOT-CLARIFY-HUMANIZE（b3bab96）+ CLARIFY-CHAIN（传输链）机制，不重构。

改动：`apps/agentcore/src/mocks/seed.ts` factor 槽 `required:false→true` + 人话 clarifyPrompt
（含 7 因子取值域示例）。计划模板/executor/contracts 零改动。

## 复现原故障（真 DataCore·旧自由路径的确切载荷）

```
POST /a/v1/action-drafts {"actionTypeKey":"adopt_mitigation","payload":{"base":"常州","factor":null,"planKey":"三班制"}}
→ 400 {"error":{"code":"VALIDATION_ERROR","message":"payload.factor is required","requestId":"req_g2s77c3f6grrswd6"}}
对照组 factor="物料齐套" → 201 draftId=act_vc39b6xj9yhw1yp0 PENDING_APPROVAL
```

## 修后端到端（自由句采纳 → 诚实澄清 → 草稿创建成功·绝不 400）

1. **自由句提交**（无 LLM·确定性分类）：`POST /api/v1/queries` query=「采纳常州的三班制方案」
   context.selectedObjects=[常州] → task_01KWRQN2GYZRR86XFFPHSK4V51 命中 adopt_mitigation
   （model=deterministic:example-match）→ **AWAITING_CLARIFICATION**（旧行为：静默 factor=null → s2 400 FAILED）。
2. **真 SSE 澄清人话**（clarification.required round:1）：
   `{"name":"factor","type":"string","clarifyPrompt":"请指明该处置方案针对的风险因子（如 物料齐套 / 设备OEE / 人力工时 / 瓶颈工序 / 物流时长 / 换型损失 / 良率波动；风险时间线卡片上的因子名即可）"}`
   （同轮 solutionName enum 带三值·零裸内部 key）。
3. **作答** `{"slotValues":{"solutionName":"三班制","factor":"物料齐套"}}` → **COMPLETED**
   trustLevel=VERIFIED_WORKFLOW，参数回显块「基地=常州、方案=三班制、因子=物料齐套」，
   action_draft block draftId=act_m2x9ptmjpae8bzda。
4. **逐值对照真 A**：`GET /a/v1/action-drafts/act_m2x9ptmjpae8bzda` →
   `payload={"base":"常州","factor":"物料齐套","planKey":"三班制"}` status=PENDING_APPROVAL
   审批链 planner→admin —— 用户所答 == 草稿载荷逐值。
5. **场景预置路径（S06）零反问不回退**：presetSlots 带 factor+solutionName + scenarioIntentKey →
   COMPLETED clarificationRounds=0 model=deterministic:scenario-bind draftId=act_jyhm4drp6r8yfd8c。

## 齿检（revert→red 已自证）

- `apps/agentcore/test/adopt-mitigation-freepath.test.ts`（5 例）：意图定义 factor required+人话；
  自由句缺 factor → 诚实澄清（过契约 schema·人话·未澄清前零草稿）；作答 → 草稿满足真端点必填契约
  （base/factor/planKey 全非空 string·factor 逐值）；自由句自带因子 → 零澄清直达；preset 路径零反问。
  **revert（factor 改回 required:false）→ 实测 3 红**（COMPLETED 带 null 草稿被断言拦下）。
- `qos-a.test.ts` A4 更新：问句带因子（分类器抽出 factor）→ 零澄清直达草稿 + factor 逐值断言。
- 既有守护未破：clarify-transport 5 绿（断②③澄清含 factor 槽兼容）·scenarios-wiring R11 零反问 4 绿
  （S06 卡 slotPresets 本就带 factor）·clarify-humanize 6 绿。
- 全量：agentcore 515 passed/1 skipped；四包 build 绿；`pnpm gates` exit 0
  （`clarify-humanized:check` 13 必填槽全人话·含新必填 factor）。

## 本体引用与影响

链路 L(自由问句→路径A→create_action_draft→A·S2)；断点 G-2（计划↔端点契约缝·本单闭合此实例）、
G-3（澄清链·复用既有机制）；不变量 R11（场景卡零反问·preset 路径保持）。链路/事件/对象类型/门禁
均无新增或改变（factor 槽必填化属既有意图定义数据修正）→ 无本体回写。
