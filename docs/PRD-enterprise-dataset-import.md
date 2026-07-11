# PRD · 企业级数据集导入（对接 Stage 3.15 生成器 · 完善系统导入侧 · 真业务数据换 hash 假值）

> 状态：草案待审 · 供其他 agent 阅读并开发。
> 一句话：**不把 Stage 3.15 生成器塞进平台代码（那会违 R14 行业锁死）**，而是**补齐平台的"导入侧"**——让 Stage 3.15 产出的企业级数据集（13 张关联 CSV + objects.json/relations.json + 场景 + Neo4j + 校验）**一键真导入**，物化成前后端可见、可推演、可溯源的真世界；顺带用真业务数据从源头替换平台 synthetic 的 hash 假值。
> 定位：Stage 3.15 = 外部**世界生成器**（造数据）；平台 = 下游**决策引擎**（在数据上做本体/求解/推演）。二者经导入路连接，各守其责。
> 所有引用端点/不变量均已核对真实存在（`complete` 分支），附 `file:line`。

---

## §0 本体引用与影响（铁律 0 · 门 `prd:check` 机器解析）
- **对象类型**（§2）：`Connection`/`RawDataset`/`ObjectInstance`（§2.A·导入物化）· `ObjectType`/`LinkType`/`ModelingSuggestion`（§2.B·A3 建模·`modeling.ts`）· `SliceSpec`（§2）· `ScenarioCard`（§2.H）· 拟立 `OntologyImportBundle`（§2·客户本体直导）。
- **链路**（§3）：数据接入链 连接器→RawDataset→（A3 建模 column→PropertyDef/FK→LinkType）→物化 ObjectInstance；本 PRD 扩"多表批量 + 本体直导"两入口。
- **不变量**（§5）：**R14 应用层无业务常数（核心·Stage3.15 业务逻辑留外部·平台代码不锁电池）** · **R-PACK 换行业加一个文件（导入不写死电池）** · **R6 确定性（导入幂等·同数据同结果；Stage3.15 需加 seed）** · **R-NO-ORPHAN-SOURCE 无凭空源（导入对象必挂真 rawDatasetId·可溯回可下载）** · R2 tenant · R13 溯源。
- **断点**（§8）：**G-8 数据接入/就绪**（本 PRD 扩多表 FK + 本体直导·补强）· G-5 应用层电池锁死（守：Stage3.15 逻辑不入平台）。
- **回写**：落地后 §2 登 `OntologyImportBundle`、§3 补"多表批量导入/本体直导"链；`pnpm ontology:slices`。

---

## §1 背景：为什么做这个（现状对账）

**平台现状（实测·file:line）**：数据接入链**已通且真**——`POST /a/v1/uploads`（上传·`app.ts:3177`）→ `POST /connections/:id/sync`（物化 RawDataset·`:3153`）→ `POST /modeling/derive`（**确定性从列/FK 反推本体·无 LLM·`:3420`**，实测：factory.csv → `Factory` 类型·主键 factory_id 按唯一率≥0.95 派生）→ `publish`/`materialize`（`:3461/3485`）→ 对象经 `/a/v1/objects` 前后端真查、不写死（实测 F001 capacity_gwh=51 真值）。

**但对接 Stage 3.15 缺三块（我真跑逼出的缺口）**：
1. **多表 FK 关系批量导入**：Stage 3.15 产 13 张互相关联的表（order.customer_id / production_line.factory_id / bom.product_id…）。平台 `modeling/derive` 单次能反推 FK→LinkType，但**没有"一批表一起进、FK 一次成图"的批量入口**（单表逐个传 → FK 检测不到跨表关系）。
2. **客户本体直导**：Stage 3.15 产 `objects.json`/`relations.json`（客户自带本体 Factory/Line/…+ HAS/USES/PRODUCES）。平台**无"导入本体"端点**——只能从数据反推或逐类 `POST /ontology/object-types`（`:2002`）、逐链 `upsertLinkType`（`:2189`）手拼。
3. **场景导入**：Stage 3.15 产 order_acceptance/equipment_failure/capacity_expansion 场景 JSON。平台场景卡（`scenarios-catalog.ts`）是**手配目录，不从数据/文件导入**。

**顺带治本**：平台 synthetic 内置生成的**结构真、部分数值 hash**（审计 `AUDIT-fake-simulation-inventory`：mockTightness 哈希造红、util 稀释）。Stage 3.15 的业务规则数据（ATP/客户分级/BOM 配方）是**业务自洽真值**——导入它 = 从**数据源头**治平台假推演。

---

## §2 目标 / 非目标

**目标（全部在"导入侧"·平台代码保持行业无关）**：
1. **G1 多表批量导入**：一次上传/引用 N 张关联表 → 一次性 FK 检测 → 一张本体图（类型+链路）→ 物化。
2. **G2 客户本体直导**：接受 `objects.json`+`relations.json` → 校验/映射为 ObjectType/LinkType → 与上传数据绑定（sourceBindings）→ 发布。
3. **G3 场景导入**：接受 Stage 3.15 场景 JSON → 转平台 ScenarioCard（targetView/presetContext）→ 进场景目录，可一键推演。
4. **G4 真数据换假值**：demo/租户可选"以 Stage 3.15 导入的真业务数据"替换 synthetic hash 值，从源头修假推演。
5. **G5 导入校验对齐**：Stage 3.15 的 validation（FK 匹配/孤立节点/覆盖度）与平台 closure/field-coverage 对账，一处报告。

**非目标（守 R14/G-5）**：
- ❌ **不把 Stage 3.15 的生成逻辑（ATP/分级/配方）写进平台代码**——那是外部生成器的事，写进来即锁电池、违 R14。
- ❌ 不做 Neo4j 运行时（平台自有 pg 切片引擎·母体 §8 图库暂缓）——Stage 3.15 的 neo4j 导出仅作外部可视化，不入平台。
- ❌ 不替换平台 synthetic 引擎（保留作零配置 demo）；Stage 3.15 是"企业级真实数据"的平行来源。

---

## §3 方案（三个导入入口 · 全复用既有链）

### 3.1 G1 · 多表 FK 批量导入（`WO-IMPORT-MULTITABLE`）
- 新端点 `POST /a/v1/modeling/derive-batch`：body `{rawDatasetIds:[...]}`（N 张已上传表）→ 一次跑 `deriveModelingSuggestion(datasets, fkCandidates)`（`modeling.ts:89`·**已是确定性无 LLM**），**FK 候选跨全部表检测**（如 production_line.factory_id → factory.factory_id ⇒ `ProductionLine→Factory` LinkType）→ 一张 draft 含全类型+全链路 → publish+materialize。
- 上传侧配套：`POST /a/v1/uploads` 支持**多文件/zip**（Stage 3.15 output 目录整包），或前端"批量选文件"。
- 验收：传 factory+production_line+equipment 三表 → draft 出 3 类型 + `ProductionLine→Factory`/`Equipment→ProductionLine` 两链路（逐值对）；物化后 `/objects?type=Equipment` 真查到、origin=MATERIALIZED 挂真 rawDatasetId（R-NO-ORPHAN-SOURCE）。

### 3.2 G2 · 客户本体直导（`WO-IMPORT-ONTOLOGY`）
- 契约 `OntologyImportBundle`（`{objects:[{name,properties?}], relations:[{name,from,to,cardinality?}]}`·= Stage 3.15 的 objects.json/relations.json 形态）。
- 新端点 `POST /a/v1/ontology/import`：校验 bundle → 逐对象 `upsertType` + 逐关系 `upsertLinkType`（复用 `:2002/:2189`）→ 若同时给了数据表，按名匹配建 `sourceBindings`（字段全建模 R12）→ 发布版本。
- **诚实边界**：bundle 里的类型/关系若与已上传数据对不上（字段缺/表缺）→ 报**覆盖缺口**（不静默建空类型）。
- 验收：导入 CALB objects.json(7类)+relations.json(HAS/USES/PRODUCES) → 本体浏览器 `/admin/modeling` 真见 7 类 + 关系；绑 CSV 后物化真对象。

### 3.3 G3 · 场景导入（`WO-IMPORT-SCENARIO`）
- 新端点 `POST /a/v1/scenarios/import`（或 agentcore 侧）：Stage 3.15 场景 JSON（`{type:ORDER_ACCEPTANCE, customer, product, quantity, delivery}`）→ 映射为 `ScenarioCard`（presetContext.selectedObjects + slotPresets + targetView 按 type 定）→ 进场景目录。
- 落点：与"沙盘作时序推演意图落地渲染器"（`WO-SANDBOX-AS-RENDER-TARGET`）衔接——equipment_failure 类场景导入后可直接进沙盘推演。
- 验收：导入 order_acceptance 场景 → 场景目录出现 → 一键推演经 QOS 出 ACCEPT/风险结论（不可跑通则诚实"缺求解器/数据"）。

### 3.4 G4 · 真数据换假值（`WO-IMPORT-REPLACE-SYNTHETIC`·可选）
- demo/租户配置项：`world_source = synthetic | imported`。选 imported → 用 Stage 3.15 导入的真对象作世界态源，**求解器读真值而非 hash**（直接削弱 mockTightness/util 稀释类假值·配合 `WO-CAP-01 REALDEMAND`）。
- 守：仍 R-NO-ORPHAN-SOURCE（导入对象挂真 rawDatasetId·可下载审计）。

---

## §4 对 Stage 3.15 生成器侧的两条要求（外部·非平台开发·但接入前必须满足）
> 这两条是给写 Stage 3.15 的人的接入约束，不是平台代码改动：
1. **加 `seed` 参数（R6 可复现）**：现 `random.randint` 无 seed → 同配置两跑数据不同。必须播种（`random.seed(cfg.seed)`），使**同 (scale, seed) 字节一致**——否则导入进平台破坏确定性、无法复现推演。平台 `mulberry32` 是现成范式。
2. **FK/主键列命名规范**：外键列名含目标表 id（`factory_id`/`customer_id`），主键唯一——平台 `deriveModelingSuggestion` 据此确定性反推（唯一率≥0.95 定主键·FK 候选建链路）。Stage 3.15 已符合，保持即可。

---

## §5 逐块对账（Stage 3.15 ↔ 目前系统 · 落地依据）
| Stage 3.15 | 平台现状 | 本 PRD 动作 |
|---|---|---|
| enterprise_config.yaml 精确规模 | synthetic S/M/L/XL 粗档 | 不改（规模控制留 Stage 3.15 外部） |
| 13 实体 generator | 覆盖 ~7 类·缺 Equipment/Supplier/ProductionOrder/Inventory 独立生成 | **不在平台补生成**——导入 Stage 3.15 的 13 表（G1） |
| BOM 配方/ATP/客户分级 | 有 BOM 链/挤占/优先级·数值部分 hash | **不在平台写业务规则**（R14）——导入真值（G4） |
| Ontology Generator | A3 反推有·**无导入/导出** | **G2 本体直导** |
| Scenario Generator | 场景卡手配·不从文件导入 | **G3 场景导入** |
| Neo4j Generator | 无（pg 切片引擎·图库暂缓） | 不做（外部可视化） |
| Validation Runner | closure/field-coverage·但**洞C/D 空壳判绿** | G5 对账 + 修（挂 `WO-DB-CLOSURE-HARDEN`） |
| 确定性 | ✅ 平台 mulberry32 R6·Stage3.15 缺 | §4 要求 Stage3.15 加 seed |
| 导入→前后端可见 | ✅ 实测真通不写死 | 复用（基线） |

---

## §6 实施计划（分期 · additive · 暗发）
- **P1 · G1 多表批量导入**（最高杠杆·纯后端·复用 deriveModelingSuggestion）：`derive-batch` 端点 + 多文件上传。
- **P2 · G2 本体直导**：`OntologyImportBundle` 契约 + `/ontology/import` 端点。
- **P3 · G3 场景导入** + 与沙盘渲染器衔接。
- **P4 · G4 真数据换假值**（配合 WO-CAP-01）+ G5 校验对账。
- 每项 feature key `defaultOn:false`（暗发 RL2）·additive·迁移带 down（RL9）。

---

## §7 验收（真跑·铁律 0.4）
1. **真导入 Stage 3.15 输出**：跑 Stage 3.15（加 seed）→ 拿 output/ 13 CSV + objects.json → 经 P1/P2 导入 → `/objects?type=ProductionOrder` 前端真查到、逐值对 CSV、origin 挂真 rawDatasetId（不写死·R-NO-ORPHAN-SOURCE green→red：删源→对象应报孤儿）。
2. **多跳链路成图**：导入后本体图出现 ProductionLine→Factory→…→Order 全链（逐链路对 FK）。
3. **复杂推演在真数据上跑**：设备故障场景（G3 导入）→ 沙盘/QOS 推演出影响半径，数字来自导入真值（非 hash·配合 §2 结构洞修复单）。
4. **R14/R-PACK 守住**：平台代码全程无新增电池业务常数（`debattery:check` 绿）；Stage 3.15 逻辑不入平台。
5. **R6**：同 seed 的 Stage 3.15 数据两次导入字节一致；gates 全绿。

---

## §8 关联文档（一起读）
- `AUDIT-databuilder-genuine-construction-DELTA.md`（构建真伪 + §6 真 LLM 实测·切片/B栈/闭包洞）——本 PRD 的 G5 挂其 `WO-DB-CLOSURE-HARDEN`。
- `PRD-capacity-sim-decision-flow.md`（WO-CAP-01 REALDEMAND·真供需替代 hash）——G4 配合它。
- `TODO-fde-build-engine.md` / `HANDOFF-comprehend-engine`（H3·勿从零重写引擎）。
- 平台 `modeling.ts:85-96`（deriveModelingSuggestion 确定性反推·本 PRD 的复用核心）· `SYSTEM-ONTOLOGY.md` §5 R14/R-PACK/R-NO-ORPHAN-SOURCE · §8 G-8。

## 附录 · 证据锚点
`app.ts:3177`(uploads)·`:3153`(sync)·`:3420`(modeling/derive 确定性)·`:3461/3485`(publish/materialize)·`:2002`(POST object-types)·`:2189`(upsertLinkType)·`:3268`(raw rows·实测 F001=51)·`modeling.ts:85-96`(deriveModelingSuggestion column→PropertyDef/FK→LinkType/主键唯一率≥0.95)·`synthetic/battery.ts`(BOM链/挤占/优先级·结构真)·`AUDIT-fake-simulation-inventory.md`(hash假值根)·母体 §5 R14/R-PACK/R6/R2/R13/R-NO-ORPHAN-SOURCE · §8 G-8/G-5。
