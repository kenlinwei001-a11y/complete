# PRD · discover 暴露真实对象类型名（agent 不再猜错英文名）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-22 · 后端（agent 工具/QOS）|
| 取代/扩展 | 新建 · 修"agent 凭空猜 `plan_version`/`production_target` 等不存在类型名" · 接 `PRD-agent-data-generation-tools`（discover 增强同处）+ `PRD-empty-tenant-bootstrap`（空态提示）|
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§2 对象类型 · §5 R13 · §8 G-3）· `apps/agentcore/src/tools/executor.ts:199`（`discover`）`:216`（`query_objects`）`:225`（`get_object`）· `apps/agentcore/src/tools/registry.ts:4`（`BUILTIN_TOOLS`）· `apps/datacore/src/synthetic/battery.ts:485-494`（真实类型名 PlanTarget/AnnualScenario/SopVersion…）· `GET /a/v1/object-types` |

> 一句话：截图实证——agent 查"本月计划未达成原因"时,`query_objects` 用了**猜的英文名** `plan / plan_version / production_plan / schedule / production_target`,全空集;但系统真实类型名是 **`PlanTarget`/`SopVersion`/`AnnualScenario`/`Order`**。这是 **discover 不暴露真实类型名 + query_objects 对未知类型静默返空** 的缺口:agent 无从知道该查什么,只能瞎猜,猜不中就误判"无数据"。本 PRD 让 **`discover` 返回租户真实已发布对象类型名(key+中文标签+域+实例数)**,并让 **`query_objects`/`get_object` 对未知 typeKey 返"did-you-mean"提示**(列最近有效类型),agent 从此**照真名查、不猜**;空租户则明确返"计划域为空,先引导"(接 bootstrap)。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2.D7/D2）：`Tool(discover/query_objects/get_object)`·`ObjectType(真实 key+label+domain)`·`GapReport(EMPTY_DATA 区分"类型不存在/类型存在但空")`。
- **触及链路**（§3 / §10.3 `sys.orch.query_to_answer`）：`问句 → discover(列真实类型名) → query_objects(照真名查) → 命中/明确空 → 答案/缺口`,消除"猜名→空集→误判"。
- **触及事件/数据流**（§4）：无新增;复用对象查询。
- **触及不变量**（§5）：R13（agent 决策基于真实类型清单,非猜测,可溯）· R2（只列本租户已发布类型）· R6（类型清单确定）· R3（entitlement 过滤）。
- **关闭/影响断点**（§8）：**G-3**（对话/agent 凭空猜→误判无数据）——本 PRD 让 agent 有"真实类型名 + did-you-mean",闭合"能力/数据存在却因猜错名而够不到"的接缝。
- **门禁**（§7）：`chain:check`（discover 命中真实端点）· `pnpm -r build && test`（猜名→提示真名回归）· FDE 亲手跑（问句→discover 出真名→查中）。
- **数据闭环合规**：`// 不涉数据闭环`（工具/查询语义,不新增数据/对象/字段）。
- **回写承诺**：discover 增强（暴露真实类型名）+ query_objects did-you-mean → 回写本体 §2.D7（工具语义）+ §8（G-3 对话侧）。

## 1. 目标 / 非目标
### 目标
1. **discover 暴露真实类型名**：`discover{kind:"object_types"}`（或扩现有 discover）→ 返回本租户**已发布 ObjectType** 列表 `{key, label(中文), domain, instanceCount}`（取 `GET /a/v1/object-types` + 计数）。agent 据此查,不猜。
2. **query_objects/get_object did-you-mean**：传未知 `typeKey` → 返结构化提示 `{error:"UNKNOWN_TYPE", validTypes:[...], suggestion:"PlanTarget?"}`（最近编辑距离),而非静默空集。
3. **空 vs 不存在 区分**：类型存在但 0 实例 → `EMPTY_DATA`(提示引导);类型名不存在 → `UNKNOWN_TYPE`(提示真名)。agent 据此分别处置（引导 vs 改名重查）。
4. **接空态引导**：真实类型存在但全空(空租户)→ 提示"先 bootstrap/合成"（接 `PRD-empty-tenant-bootstrap`/`in-dialog-gap-fill`）。
5. **system prompt 增强**（可选）：agent 系统提示注入"查对象前先 discover 真实类型名,勿猜英文名"。

### 非目标
- 不改对象查询引擎（只补类型清单暴露 + 未知类型提示）。
- 不做模糊语义匹配（精确类型名 + 简单 did-you-mean 编辑距离即可,R6 确定）。

## 2. 现状与缺口（带 file:line）
| 元素 | 现状 | 缺口 |
|---|---|---|
| discover | executor.ts:199（kind: slices/solvers/mcp_tools）| **无 object_types,不列真实类型名** |
| query_objects | executor.ts:216 | 未知 typeKey **静默返空**,不提示真名 |
| 真实类型名 | ✅ PlanTarget/SopVersion/AnnualScenario…（battery.ts:485-494）+ `GET /a/v1/object-types` | agent 不知道 → 猜 plan_version/production_target |
| 空 vs 不存在 | 不区分 | **agent 误把"猜错名"当"无数据"** |
| 现象（截图）| 猜 5 个英文名全空 → 误判"无计划本体" | 本 PRD 修 |

## 3. 设计
### 3.1 discover object_types（registry + executor）
- `discover{kind:"object_types", domain?}` → DataCore `GET /a/v1/object-types`(+实例计数) → `[{key,label,domain,instanceCount}]`;executor.ts 加 case,registry 更新 discover schema 允许 kind=object_types。
### 3.2 query_objects/get_object did-you-mean
- typeKey ∉ 已发布类型 → 返 `{error:"UNKNOWN_TYPE", validTypes, suggestion}`（Levenshtein 最近,确定性）;agent 据 suggestion 重查。
### 3.3 空 vs 不存在
- typeKey 存在 + count 0 → `EMPTY_DATA`(hint 引导);不存在 → `UNKNOWN_TYPE`(hint 真名)。
### 3.4 提示词（可选）
- agent system prompt: "查对象/类型前先 `discover{kind:object_types}` 拿真实类型名,严禁猜测英文名"。

## 4. 契约 / 端点
- `discover` schema 加 `kind:"object_types"`;`query_objects/get_object` 错误返 `UNKNOWN_TYPE{validTypes,suggestion}`。
- 复用 `GET /a/v1/object-types` + 对象计数(aggregate)。无新真值源。

## 5. 关键流程
问句 → discover{object_types}(真名+计数) → query_objects(真名) → 命中/EMPTY_DATA(引导)/UNKNOWN_TYPE(改名)。

## 6. 非功能（§5）
R13（基于真实清单决策）· R2（本租户已发布）· R6（清单+did-you-mean 确定）· R3。

## 7. 验收（DoD）
- agent 查计划相关 → `discover{object_types}` 返 PlanTarget/SopVersion/AnnualScenario(+计数),**不再猜 plan_version/production_target**。
- 传未知类型 → 返 UNKNOWN_TYPE + suggestion（不静默空集）。
- 类型存在但空 → EMPTY_DATA + 引导提示（接 bootstrap）。
- `chain:check`/`pnpm -r build && test` 过；FDE 亲手跑(问句→discover 真名→查中或正确引导)。
- 回写本体 §2.D7/§8。

## 8. 分期
- **DTN.1** discover object_types（列真实类型名+计数）+ query_objects/get_object did-you-mean。
- **DTN.2** 空 vs 不存在区分 + 空态引导对接 + system prompt 增强。

> 与 `PRD-agent-data-generation-tools`（同处 discover 增强）、`PRD-empty-tenant-bootstrap`（空态引导）、`PRD-attribution-routing-plan-audit`（路由）合起来:agent 既知道真实类型名、又能触发产数据、又能路由到 plan_audit——不再"猜名→空集→误判"。基线分支：agentcore 工具/查询语义,冲突小。
