# WO-RESOURCE-CATALOG-ONTOLOGY · 本体对象类型/字段进资源目录（让 Agent 搜得到"有什么数据"）

> 一张 WO = 一个 dev 整单 = 一条 handoff 分支。
> 基线：`origin/claude/inspiring-gates-aqczjg` · 交付分支：`claude/handoff-wo-resource-catalog-ontology`
> 关联：`DB-SCHEMA-RESOURCE-CATALOG.md`（**仅作背景，不可作为数据源——见 §1.3**）· 铁律 0 必须先读 `docs/SYSTEM-ONTOLOGY.md`

---

## 0 · 一句话

Agent 现在**不知道系统里有哪些业务对象和字段**。资源目录只投影了 8 类（solver/slice/rule/workflow/intent/skill/agent/mcp_tool），
本单补上 **`object_type`**（新增 kind）与 **`field`**（**契约早已声明、但从未投影**），全部**从本体真值源投影**，
并加门防描述腐化。**不做 `table` kind**（理由见 §5）。

---

## 1 · 现状（已核实·file:line）

### 1.1 缺口坐实

| 事实 | 证据 |
|---|---|
| 投影器只产 8 类，无 `object_type`/`field` | `apps/agentcore/src/dril/resource-projector.ts`（kind 取值仅 agent/intent/mcp_tool/rule/skill/slice/solver/workflow） |
| **`field` kind 契约里早已存在，却从未接线** | `packages/contracts/src/resource-descriptor.ts`：`RESOURCE_KINDS = ["solver","slice","workflow","intent","field","mcp_tool"]` |
| `object_type` 两个枚举都没有 | 同上 + `intelligence-resource.ts`：`RESOURCE_KINDS_EXTENDED = [...RESOURCE_KINDS, "agent","skill","rule"]` |
| 真实对象类型 **51 个**，中文名已就位 | `apps/datacore/src/synthetic/battery.ts` 的 `plain(key, displayName, properties)` 调用共 51 处（如 `plain("Process","工序")`） |
| 物理表真实数量 | datacore **93** 张 · agentcore **27** 张（`migrations/*.sql` 的 CREATE TABLE 去重计数） |

### 1.2 可复用的既有件（别重造）

- **B 经 REST 读 A**（守 R1 不跨 app import 源码）：
  - `GET /a/v1/ontology/object-types` → `ontology.listTypes()`（`apps/datacore/src/app.ts:1716`）
  - `GET /a/v1/ontology/type-semantics`（`:1742`）——**属性级语义投影，含 `PropertyDef.description` / `unit` / `dataType`**，正是 `field` kind 的天然数据源
- **描述非空已是契约硬门**：`ResourceDescriptorSchema.description` 是 `z.string().min(1)`
- **门辅助函数已存在**：`findUndescribed(candidates)`（`resource-descriptor.ts`）——逐条跑 schema、返回 violations，**直接复用，不要新写校验**
- 投影模式照抄现有：`projectSolvers` / `projectRules`（rule 是 `← /a/v1/rules` REST，最贴近本单）

### 1.3 ⛔ 关于 `DB-SCHEMA-RESOURCE-CATALOG.md`——**不可作为数据源**

那份文档是人工编写的目录，已核实存在实质偏差，**照它投影会给 Agent 一份错地图**：

- 它列的 14 个逻辑对象类型里，**9 个真实本体中不存在**：`Capacity` / `Supplier` / `Customer` / `Route` / `Bom` / `Certification` / `Forecast` / `Risk` / `Action`
- 真实存在却**全部漏掉**的核心类型 40 余个，含 `Process`(工序) / `Equipment`(设备) / `Workshop`(车间) / `OrderLine`(订单明细行) / `WorkOrder`(生产工单) / `WIPLot`(在制批次) / `EquipmentOEE` / `MaterialBalance`(物料平衡) / `Segment`(应用细分) / `Shipment`(在途批次) / `KSF` / `RootCauseChain`(根因归因链) …
- 表数量也不符（文档"约 80+/25"，实际 93/27）
- 文档自己也标注了：*"本目录列出常见制造业语义示例…需根据实际 `ontology_types.doc` 内容补全"*

**本单红线：不得手写任何对象类型/字段清单。** 一切从 `ontology_types` 投影——Agent 拿着含虚构条目的地图找路，比没有地图更糟。

---

## 2 · 交付内容

### T1 · 新增 `object_type` kind

- `packages/contracts/src/`：`RESOURCE_KINDS_EXTENDED` 加 `"object_type"`；如需 per-kind 扩展字段，加 `ObjectTypeResourceSchema`（`properties[]` / `linkKeys[]`），**沿用既有 `IntelligenceResource` 结构，不另造形状**。
- `resource-projector.ts` 新增 `projectObjectTypes()`：
  - 源：`GET /a/v1/ontology/object-types`（ACTIVE 类型）
  - 映射：`key ← typeKey` · `label ← displayName` · `description ← description`（缺则**按 §4 兜底规则**合成，不留空——否则契约 `.min(1)` 直接红）
  - `inputSpec.objectTypes = [typeKey]`、`tags.l4_object = [typeKey]`（复用五级标签既有语义）

### T2 · 接线 `field` kind（契约已有、从未投影）

- `projectFields()`：源 `GET /a/v1/ontology/type-semantics`
- `key = ${typeKey}.${propKey}`（与 `resource-descriptor.ts` 注释里既定口径一致：*"字段 typeKey.propKey"*）
- **带上 `unit`**：`PropertyDef.unit` 已登记（canonical 近期已让 `generic_inference` 逐行消费它），资源目录也要透出——Agent 才知道字段量纲
- 数量可能较大（51 类型 × N 属性）→ 只投影**已发布 ACTIVE 类型**的属性；如需限流，按 `searchable`/`isPrimaryKey` 优先，但**必须 log 出被裁掉的数量**（禁静默截断）

### T3 · 门：描述覆盖率不许腐化

- 扩 `scripts/check-ontology*.mjs`（或 `ontology:check`）：
  - 新增/存量 **ACTIVE object_type 必须有非空 `displayName` 且非空 `description`**
  - 新增 property 必须有非空 `description`
  - **存量若已有缺失 → 设基线数字**（同 `debattery:check` 的基线模式），只禁**新增**，不要求一次补全
- 资源投影侧复用 `findUndescribed()` 断言全池达标

### T4 · 本体回写（铁律·不回写即过期失效）

- §2：`IntelligenceResource` 新增 kind `object_type`；`field` 由"已声明未接线"→"已接线"
- §3：新增链路 `ontology_types --REST /a/v1/ontology/object-types--> resource-projector --> IntelligenceResource(object_type/field) --> Agent discover/list_resources`
- §8：登记断点 **`G-RESOURCE-CATALOG-NO-DATA`**（Agent 搜不到"有什么数据/字段"）并标闭

---

## 3 · SEAM 红咬（**这是验收判据·断言原文照抄，不许改成"人工检查"**）

> 教训：上一单（WO-SCENARIO-INPUT-PHASE0）的验收只断言了"参数到达"，没断言"结果因此不同"，
> 导致 PRD 全过但语义未达成。本单直接给断言，不给措辞。

**① 反虚构（头号）——投影出的类型集必须等于本体真值集，不多不少**
```ts
const typesFromOntology = await datacore.listObjectTypes(tenantId); // ACTIVE
const projected = (await registry.list(tenantId)).filter(r => r.kind === "object_type");
expect(new Set(projected.map(r => r.key)))
  .toEqual(new Set(typesFromOntology.map(t => t.key)));
// 且明确断言那 9 个虚构类型不出现（防有人照 DB-SCHEMA 文档手写）
for (const fake of ["Capacity","Supplier","Customer","Route","Bom","Certification","Forecast","Risk","Action"]) {
  expect(projected.some(r => r.key === fake), `${fake} 不在真实本体中，不得出现`).toBe(false);
}
// 且真实核心类型必须在
for (const real of ["Process","Equipment","WorkOrder","MaterialBalance","OrderLine"]) {
  expect(projected.some(r => r.key === real), `${real} 是真实类型，必须被投影`).toBe(true);
}
```

**② 活投影（改本体 → 目录跟着变·证非写死）**
```ts
// 新建一个 object_type → 缓存失效后 list_resources 能发现它
await datacore.createObjectType({ key: "__ProbeType", displayName: "探针类型", description: "SEAM 探针" });
await invalidate("ontology_types", tenantId);
const after = (await registry.list(tenantId)).filter(r => r.kind === "object_type");
expect(after.some(r => r.key === "__ProbeType")).toBe(true);
```

**③ field 带量纲（证 PropertyDef.unit 真透出）**
```ts
const fields = (await registry.list(tenantId)).filter(r => r.kind === "field");
const withUnit = fields.filter(f => (f as { unit?: string }).unit);
expect(withUnit.length, "本体已登记 unit 的属性必须带量纲透出").toBeGreaterThan(0);
expect(fields.every(f => f.key.includes(".")), "field key 口径为 typeKey.propKey").toBe(true);
```

**④ 描述门有牙（变异反证·必做）**
```ts
// 造一个 description 为空的候选 → findUndescribed 必须抓到
expect(findUndescribed([{ kind: "object_type", key: "X", label: "X", description: "" }]).length).toBe(1);
```
并在**门脚本层**自证：临时把某 ACTIVE 类型的 `description` 置空 → `pnpm ontology:check` 必须**红**且打印该类型 key；还原 → 绿。
（只写单测不算——门必须真拦得住。）

**⑤ R6 确定性**：同租户两次投影 `JSON.stringify` 字节一致。

---

## 4 · 兜底规则（诚实优先·禁臆造）

- `description` 缺失 → 合成 `非空(description, displayName, key)`，并在资源上标记 `descriptionSynthesized: true`
  （**不许编业务含义**：只能用已有 key/displayName 拼，不得凭想象写"产品/物料型号主数据"这类猜测）
- 类型/属性数量被裁 → **必须 `log()` 出裁掉多少、按什么规则裁**（静默截断会读成"就这些"）

---

## 5 · 🚦 范围边界（本单的"身份"）

**只碰**：
```
packages/contracts/src/resource-descriptor.ts      （RESOURCE_KINDS_EXTENDED 加 object_type）
packages/contracts/src/intelligence-resource.ts    （per-kind 扩展 schema·如需）
apps/agentcore/src/dril/resource-projector.ts      （projectObjectTypes / projectFields）
apps/agentcore/src/dril/resource-registry.ts       （若需注册新 kind 到 list/search）
apps/agentcore/test/…（新增投影+门测试）
scripts/check-ontology*.mjs                        （T3 门）
docs/SYSTEM-ONTOLOGY.md                            （T4 回写）
```

**禁碰**：
- `apps/datacore/src/**` —— 本单**只读** A 的既有 REST，不改 A（若发现 A 端点缺字段，写进交单说明，不要顺手改）
- `apps/frontend-shell/**` —— 本单不含前端
- `apps/agentcore/src/agent/**`（navigation-slice / prompt-builder 等）—— 消费侧改造是**另一单**
- `apps/datacore/src/solvers/capacity.ts` —— 审核方正在改（小数周），撞车必冲突

**⛔ 不做 `table` kind**（明确排除，别顺手做）：
Agent 不写 SQL（走 `query_objects`），93 张表里绝大多数是平台内部机制表（`idempotency_records` / `execution_locks` / `outbox_events` / `schema_migrations`…），
暴露给 Agent 只稀释注意力。若将来要做，必须走 `COMMENT ON TABLE` + `information_schema` **自动**投影，
**禁止写死映射文件**——人工映射必过期（现有文档已与真实表数差 15 张即为实证）。

---

## 6 · 交付底线

- `bash scripts/gate.sh` **全绿**（这是唯一门入口；**禁止** `cmd | tail; echo $?` 这类取管道末端退出码的写法——曾据此把编译失败判为通过）
- §3 红咬①③④ 必须真跑通；④ 的门层自证必须做（改坏→红→还原→绿）
- **亲手真跑**：起服务后真调 `GET /b/v1/resources?kind=object_type`，肉眼确认返回的是**真实 51 类**且含 `Process`/`Equipment`，不含 `Supplier`/`Customer`
- 本体回写三处到位
- push handoff 分支后告知，等审核方隔离复验再并线

## 7 · 交单说明里必须写清

- 若依赖本单之外的契约字段/端点（如 A 端 `type-semantics` 缺 `unit`），**在交单说明里显式写「依赖 X，需先并」**
  （上一单曾因引用未交付的 `SkillDefinition.sideEffect` 而在隔离复验时编译失败被回滚）
- 被裁掉的属性数量与裁剪规则
- 存量描述缺失的基线数字（T3）
