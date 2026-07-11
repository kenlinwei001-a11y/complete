# WO-L1A-1 · RequirementGraph 契约 + QuestionAST 确定性解析器 —— FDE 证据

> 范围（钉死）：只碰 `packages/contracts/**` + `apps/agentcore/**`；纯契约 + 纯函数解析器 + 暗发开关，
> **不接线编排**（Graph Builder 归 WO-L1A-2·旁路挂载/持久化/读端点/母体回写归 WO-L1A-3）。
> 诚实边界：本单为 acceptance ①–⑤ 单测级（喂 mock 本体真值逐值对照）；真起双服务 V1/V5 端到端属 WO-L1A-3。

## 交付物

| 制品 | 路径 | 说明 |
|---|---|---|
| 契约 | `packages/contracts/src/requirement-graph.ts` | QuestionAst + RequirementGraph 全 zod schema（PRD §3 逐字段） |
| 导出 | `packages/contracts/src/index.ts` | `export * from "./requirement-graph.js"` |
| 暗发开关 | `apps/agentcore/src/config.ts` | `QOS_REQUIREMENT_GRAPH: z.string().optional()`（defaultOff·RL2·对齐 QOS_CLASSIFY_FUSE 范式） |
| 解析器 | `apps/agentcore/src/growth/requirement-graph.ts` | `parseQuestionAst`（Ch02·纯函数除本体读·R6） |
| 复用导出 | `apps/agentcore/src/router/slots.ts` | `resolveUniqueByName` 由 `async function` → `export async function`（additive·零行为变更） |
| 单测 | `apps/agentcore/test/requirement-graph-ast.test.ts` | 9 测·三阶梯逐值对照 + R6 + 边界 + round-trip |

## 契约形状 sanity（PRD §3 对齐）

- `QuestionAstSchema`：astId/taskId/tenantId/rawText/intent{problemClass,intentKey,confidence}/entities[]/actions[]/
  constraints[]/timeScope?/objectives[]/outputs[]/parserVersion/generatedAt（R6：generatedAt 调用方注入）。
- `AstEntitySchema.source`：`exact|unique_name|fuzzy|unresolved`（R13 诚实位）。
- `RequirementGraphSchema`：nodes/edges + 下游 I/O 投影 solverCandidates/dataRequirements/sliceTargets +
  coverageScore（咨询·非判决）+ builderVersion/generatedAt。节点 kind 11 类、边 kind 8 类。
- round-trip：`RequirementGraphSchema.parse(JSON.parse(JSON.stringify(x)))` 字节一致（含 operator/direction 默认值稳定）。

## 解析器真跑样例（单测·喂 mock 本体真值·逐值对照·不造假）

问句：`未来30天常州基地PACK02产线停机20%，影响哪些订单？`
classification.extractedSlots：`{ base:"常州基地", line:"PACK02", model:"4680-NCM" }`
mock 本体真值：Base{id:常州, props.baseId:"cz", name:"常州基地"} · Line{id:PACK02} · Model{id:4680-NCM} · Order.label:"订单"

解析结果（断言逐值命中 mock 真值）：
- 实体 `常州基地` → **unique_name**：ontologyType=Base·objectId=`cz`（= mock props.baseId 真值·非合成）·resolved=true
- 实体 `PACK02` → **exact**：ontologyType=Line·objectId=`PACK02`（= getObject 命中键真值）
- 实体 `4680-NCM` → **exact**：ontologyType=Model（slots 提供·问句原文外仍解析）
- 类型级提及 `订单` → Order（objectId=null·resolved=true）
- 动作：`SHUTDOWN`·value=`20%`（保留原文·不臆造）·targetType=`Line`（前置已解析实体类型）
- 时间：`FUTURE_WINDOW(window=30, granularity=DAY)`
- 意图：intentKey=`affected_orders`（消费 classification·不重造分类）·problemClass 经 problemClassForIntent

三阶梯边界样例：
- `常州基`（子串·非精确名）→ **fuzzy**·resolved=false·ontologyType=Base（仅澄清·不自动绑）
- `火星工厂`（域外）→ **unresolved**·objectId=null·confidence=0（诚实·不臆造）
- 约束/目标：`成本最低，不能延期` → OBJECTIVE(MIN) + objectives `["MIN:成本"]` + HARD

## R6 确定性（字节一致）

- 静态扫 `Date.now|Math.random|new Date()` 于 requirement-graph.ts：**NONE**（无时钟/随机/LLM）。
- 双跑测：同 (query, classification, 快照, generatedAt) 两次 `parseQuestionAst` → `JSON.stringify` **字节一致**（测通过）。
- 唯一 IO = 本体读（OBO REST·同快照 → 同结果）；本体读全失败 → 实体降级 unresolved·不崩（测通过）。

## 回退/additive 证

- `QOS_REQUIREMENT_GRAPH` 缺省 = OFF；本单未接线编排（parser 为休眠纯函数·未挂 orchestrator 热路径）→
  pipeline 与改造前**字节一致**（无行为变更面）。
- 契约新增独立文件·全字段显式声明·未改任何既有 schema → 旧消费方零感知（既有 agentcore 全测绿）。
- `resolveUniqueByName` 仅由 `async function` 改为 `export`（可见性 additive·逻辑零变更）。

## 门/测结果

- `pnpm --filter @platform/contracts build`：绿
- `pnpm --filter @platform/llm-adapters build`：绿
- `pnpm --filter agentcore build`：绿
- 新单测 `test/requirement-graph-ast.test.ts`：9/9 绿
- 既有 agentcore 全测：绿（exit 0·无回归）
- `pnpm gates`：EXIT=0（见提交报告）

## 母体回写（诚实标注·本单不触）

本单纯契约 + 纯函数解析器 + defaultOff 暗发开关，**未新增/改变运行态链路/事件/门禁**（parser 未接线）。
`RequirementGraph`/`QuestionAST` 对象类型登记 §2.H、中枢链旁路登记 §3/§10.3、门 `requirement-graph:check`
登记 §7 —— 均随**实际接线**在 WO-L1A-3 回写（PRD §8 明列于 WO-L1A-3 acceptance ⑥），故本单不改 `docs/SYSTEM-ONTOLOGY.md`
（保持 `ontology-slices:check` 绿·母体未动=切片未漂移）。
