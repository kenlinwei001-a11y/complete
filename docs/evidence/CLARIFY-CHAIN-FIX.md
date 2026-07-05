# 证据 · CLARIFY-CHAIN-FIX（审计簇⑨·澄清传输链断点·真起真跑真浏览器）

真起 datacore(4011·SEED_DEMO) + agentcore(4012) + vite(5199) 内存模式；登录 demo/admin/demo1234（真 IAM）。
红线：**服务端有的人话 = 用户看到的（逐值）**。建立在 SLOT-CLARIFY-HUMANIZE（b3bab96·服务端人话已存在）之上——本单治「存在但到不了用户」的传输断点。

## 断①（S01 类）：payload 字段错位——服务端发 `prompt`、前端读 `clarifyPrompt` → 配了中文也永远裸 key

**修**：单一契约 `contracts/qos.ts ClarificationSlotSchema / ClarificationRequiredPayloadSchema`；服务端 `router/slots.ts toClarificationSlot`（clarifyPrompt + description + enumValues + objectType 全量）；`orchestrator.ts` SLOT_FILLING payload 走该函数；前端 `taskStreamReducer.ts` 的 `ClarificationPayload` 直接 = 契约类型（删手写 fork）。

**真服务 SSE（修后·capacity_feasibility 缺 model+demandDelta）**：
```
event: clarification.required
data: {"kind":"SLOT_FILLING","slots":[
  {"name":"model","type":"objectRef","clarifyPrompt":"请指明要评估的型号（如 4680-NCM / M3P-标准；也可在页面选中型号自动带入）","description":"型号（Model 对象引用）","objectType":"Model"},
  {"name":"demandDelta","type":"number","clarifyPrompt":"请提供需求增量比例（0~1 的小数，如 0.2 表示 +20%；可为负数表示下调，只填数字不带百分号）","description":"需求增量比例（0.2 表示 +20%）"}
],"round":1}
```
**真浏览器**（`CLARIFY-CHAIN-01-human-prompt-round1.png`）：对话坞澄清卡渲染上述两条人话原文；`请提供demandDelta` 裸 key 断言不出现（playwright 逐字断言）。

## 断②（S06 类）：enum 槽不带 enumValues → 下拉零选项不可作答

**真服务 SSE（adopt_mitigation）**：`{"name":"solutionName","type":"enum","clarifyPrompt":"请选择要采纳的处置方案（可选值：三班制 / 外协 / 调拨）","enumValues":["三班制","外协","调拨"]}`
**真浏览器**（`CLARIFY-CHAIN-04-enum-options.png`）：下拉选项 `["请选择","三班制","外协","调拨"]` 与后端 enumValues 逐值一致，真选中「外协」。

## 断③（S06 实测 >92s 死屏）：第 2 轮澄清不渲染

根因：`Clarification.tsx` `submitted` 布尔常驻——第 1 轮提交后组件永远 null。**修**：按轮次记提交（`submittedRound === payload.round` 才隐藏）+ 表单 `key={round}` 轮间重置残值。
**真服务多轮**：round1 只答 demandDelta → `clarification.required round:2`（只剩 model·仍人话）；已答槽不重复反问。
**真浏览器**（`CLARIFY-CHAIN-02-round2-rendered.png`）：「第 2/2 次确认」重新渲染。

## 断④（收口·澄清可作答）：真栈下按 UI 作答仍 TOOL_ERROR

两处：a) seed objectRef 槽缺 `refType` → 前端选择器盲搜 "Base"，model 槽根本选不到型号（与断②同类「不可作答」）——seed 4 个 objectRef 槽补 refType（Base×3/Model×1·additive）；b) 选择器回填存储 id `obj_model_4680-NCM`，而真 DataCore 返回 `{id,props:{modelId…}}`（业务主键在 props）、旧代码只读 mock 扁平形顶层字段 → 存储 id 原样进槽 → 下游切片按业务主键 404。**修**：`validateSlotValue` 结构化分支归一业务主键（PK 序同 executor sliceObjects：objectId>baseId>modelId>so>signalKey；mock 扁平形命中第一优先·行为不变）。

**真浏览器端到端**（`CLARIFY-CHAIN-03-after-round2.png`）：round1 填 0.2 → round2 选择器搜「4680」选「4680 三元圆柱」→ 提交 → **✓ 已验证·工作流**答案：`本次回答所用参数：型号=4680 三元圆柱、需求增量=0.2`（= 用户所答逐值）+ KPI P50 5.1836 GWh / P90 4.8585 GWh / 缺口 0%。
**逐值对照后端**：同参数 curl 直查任务（task_01KWRBWJBDM3XZ05HHPTWDC8PA）answer blocks KPI 与前端所见完全一致（P50 5.1836/P90 4.8585/缺口 0·provId 真实）。

## 齿检（revert→red 已自证）

- `apps/agentcore/test/clarify-transport.test.ts`（5 例）：payload 过契约 schema·clarifyPrompt 人话（revert 回 `prompt:` 字段 → 实测 3 红）·enumValues 逐值·多轮 round2 仍人话·结构化引用归一业务主键（revert 归一 → objectId 留存储 id → 红）·INTENT_CHOICE null 哨兵。
- `apps/frontend-shell/test/clarify-transport-render.test.tsx`（4 例）：label 读 clarifyPrompt 裸 key 不出现·enum 下拉三值真可选·多轮重渲（revert submittedRound → 实测 1 红）·null 哨兵不重复渲染。
- 门 `clarify-humanized:check` 扩传输链段（并入 `pnpm gates`）：编译产物级 toClarificationSlot 输出过契约 schema + enumValues/objectType 携带；源码级两端字段对齐（orchestrator 用 toClarificationSlot·禁 `prompt:` 回潮·前端读 clarifyPrompt/渲 enumValues·reducer 引契约类型）——revert orchestrator → 实测门红。
- 全量：contracts 3 · datacore 940 · agentcore 466 · frontend 460 全绿；`pnpm gates` exit 0。

## 残留（诚实登记·非本单缺陷）

- adopt_mitigation 自由问句路径 `factor=null` → 真 DataCore action-drafts 400（factor required；seed 注释自认「由场景 presetSlots 填」）——澄清链本身已通（slots 全绑、工作流真跑到 s2），属 G-2 类计划↔端点契约缝，另单。
- 裸串中文名（如「常州」）getObject 解析不到（真 DataCore 只认 id/业务主键）→ 走既有 out-of-domain 感知层（A5 最近邻候选），UI 选择器路径不受影响。
