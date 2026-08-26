# 轨L 增量2 · demo 走真建模链 · 实施前去风险调查 + 计划（高 blast-radius·先surface）

> 增量2 改 `seedDemoSynthetic` 的本体产出从 runJob 直接 upsertType+objects → 经 `deriveModeling→草案→发布→materialize`。
> 这是本轨最高 blast-radius 增量（demo 种子是全测试套件 + 沙盘的地基）。本文件记实施前**亲手真跑**的去风险结论 + 实施计划，供审核方先核。

## 1. 去风险调查（live datacore 真跑，已坐实）

### 1.1 ✅ 关键可行性：deriveModeling 推断 pk == A 路显式 pk（全 34 类零 mismatch）
A 路 obj id = `obj_${type}_${row[pk]}`，pk 是 putAll 显式传的业务键（Base→baseId / Order→**so**(非标准) / …）。
deriveModeling pk 推断（`modeling.ts:91`）= 第一个 uniqueRate≥0.95 字段（否则首字段）。
**真跑 34 类逐一比对：inferred pk === 显式 pk，mismatch 0**——因 generate 函数把唯一 pk 列放在首位且 uniqueRate=1.0，
稳定排序取首个唯一列即命中显式 pk。⇒ 经链 materialize 出的 obj id 可逐字节复现 A 路基线（8277a5a7）。

### 1.2 ✅ 已修：obj id 净化 regex 对齐（CJK pk）
基线 467 obj id 中 **27 个含 CJK**（如 `obj_changeovermatrix_2170-NCM__圆柱-LFP`，ChangeoverMatrix.pairId 含中文）。
A 路用 `[^\p{L}\p{N}_-]gu`（保留 CJK），增量1 我改的 B 路 materialize 误用 `[^\w-]`（ASCII，会把 CJK→`_`）→ 27 id 将分叉。
**本提交已把 modeling.ts 两处 materialize regex 对齐为 `[^\p{L}\p{N}_-]gu`**（与 A 路一致），消除 CJK 分叉。

### 1.3 ✅ 无跨系统硬引用旧 B 路 id（增量1 已核）；但链路硬引用 obj id（须字节不变）
`instantiateBattery` 的 link fromId/toId 直接拼 `obj_${type}_${pk}`（如 `obj_model_${m.modelId}`，service.ts:590-636）——
依赖 obj id 字节不变。由 1.1 经链复现同 id → 链路仍解析。

## 2. 实施计划（待执行·按此做）
1. `instantiateBattery` 加模式参（默认 A 路不变，仅 demo 用链模式）：链模式下 putAll **只产 rawDataset+rawRows，跳过对象 put**，且跳过 `batteryObjectTypes()` 直接 upsert（类型改由链产）；`batteryLinkTypes()` + 各 link 仍种（引用同 id）。
2. `seedDemoSynthetic`：runJob(链模式) → `modeling.suggest`(确定性 derive 全字段路径，**无 LLM**) 一次性吃 34 个 demo rawDataset → 草案 → `publish`(类型带真 sourceDataset/sourceBindings) → `materialize`(增量1 统一 id + 1.2 regex → 字节同基线)。
3. 顺序：rawDataset → 链发布类型 → 链路类型(batteryLinkTypes，引用已发布类型) → materialize 对象 → seedDemoPropagationRules（type key 不变即不破）。

## 3. 验证门（增量2 完成判据·必跑）
- **字节红线**：重导出 §增量0 三件，typekeys=cc787b32 / objids=8277a5a7 / noi=a958632a **逐字节相等**。
- **零回归**：`pnpm -r test`（含 modeling/scenario-build-e2e/sim/求解器/sandbox）；沙盘真浏览器 tick 节点 Σ 仍真变。
- **provenance 真**：ModelingPage 中心显真本体、34 数据集显已建模、点数据集溯到其类型（增量3 UI 闭合）。
- 任一不达 = 自己打回，不提交。

## 4. blast-radius 说明（surface 给审核方）
本增量替换 demo 种子的类型来源（batteryObjectTypes hardcoded → 链 deriveModeling 派生）。类型 KEY 集不变（已证），
但类型**属性元数据**（dataType 推断/displayName/domain）可能与 batteryObjectTypes 有差异——靠 §3「零回归」全测试套件兜底验证；
若发现求解器/闭包读类型元数据导致回归且不可调和 → 停手报审核方（HANDOFF §2 注 + 禁止清单）。

## 5. 实施路线裁决（曾疑分叉·复读 HANDOFF 后定为路线 A·无需 surface）
> 早前我把此处记为"(A)全链 vs (B)链在上"的待裁分叉并倾向 (B)。**复读 §1.A/§2/§3.3 后更正：此分叉系误读，合同明确指向 (A)。**

- **§1.A 的"保留 A 路种法"只针对「本体链路类型」那一行**（order_for_model… 沙盘传导依赖其 key），**不针对对象类型**。
  对象类型行说的是"type key 来源=**一致**（A/B 路 key 都=Base）"+"provenance=**走 B 路（建模链）**"——KEY 恒定、provenance 经链，二者皆与路线 A 相容。
- **§2 字面**："把 seedDemoSynthetic 的**本体产出**从『runJob 直接 upsertType+objects.put』**改为** deriveModeling→草案→**发布**→materialize"——
  即**类型创建本身移入链 publish**（demo 跳过 batteryObjectTypes upsert），这就是路线 A。
- **§3.3 红线**："provenance 因果真实……**不是事后盖戳**"。我曾推荐的 (B) 让类型**先由 batteryObjectTypes 建、再被链补 provenance**——
  类型**存在性不由链导致**，仅 provenance 元数据事后挂上，存被判"事后盖戳"之实质风险。⇒ **(B) 触红线，弃。**
- **裁决 = 路线 A**：demo 的对象类型由链 deriveModeling→publish **原生产出**（存在性因果真实）；runJob 仍产 rawDataset + 链路类型（§1.A 末行 + §1.C 复用）。

### 5.1 路线 A 的 blast-radius 与"牵动面超预期"停手判据（经验测，不臆测）
- 类型 **KEY 集 / obj id 集 / 沙盘 noi** 仍守字节红线（§3.1，已证 KEY 恒定、id 经链可复现基线）。
- 字节红线**不约束类型属性元数据**（displayName/domain/属性 dataType）——链推断值与 batteryObjectTypes 手工值**会有差异**，此为路线 A 固有。
- **判据=零回归门（§3 全测试套件 + 沙盘 tick）当 oracle**：路线 A 落地后跑 `pnpm -r test` + 沙盘真 tick：
  - **全绿 + 三 SHA256 字节相等** → 路线 A 成立，提交增量2。
  - **可调和回归**（少量读类型元数据处）→ 修后复跑。
  - **不可调和 / 牵动面超预期** → **revert 路线 A（保留本 checkpoint）+ 附具体失败清单报审核方**（HANDOFF §2 注「牵动面超预期停手报审核方」之**带证据**落地）。
- 现状：安全前置（obj id 净化 regex 对齐 CJK·§1.2）已落并验（datacore 749/749 绿）；下一步落路线 A 主体并过上述 oracle。

## 6. ⛔ 决定性发现（落路线 A 主体前真读代码坐实）：**字面路线 A 不可行 → 牵动面超预期 → 停手报审核方**
> 落手前真读建模链 publish/materialize + batteryObjectTypes，发现**字面路线 A（链 CREATE 原生产类型）会摧毁 demo 类型的策展元数据**，触发驾驶舱/求解器全面功能回归。此为 HANDOFF §2 注「牵动面超预期→停手报审核方」+「有歧义先问」之**带证据**触发点。

### 6.1 阻断证据（代码行级·可复核）
1. **归域门硬阻断**：`deriveModelingSuggestion` 恒置 `domain:"unassigned"`（`modeling.ts:104`），而 `publishDraft` 对 `domain==="unassigned"` **硬阻断**（`modeling.ts:361-362`「未归域，发布前必须人工归域」）。⇒ 纯 `derive→publish` 发不出去，必须先注入 `setDomain` op（`modeling.ts:321-325`）做确定性归域。
2. **`derivedProperties` 被清空（致命）**：`batteryObjectTypes` 的 6 个类型带**非空 `derivedProperties`**（`battery.ts`：`baseDerived`（orderCount/committedQty/oeeIndex=AVG(Equipment.oee_current BY baseId)）、`modelDerived`（totalDemand/orderCount）、`orderDerived`（value=qty*unitPrice）、`demandSegmentDerived`、`metricDerived`、`sopVersionRowDerived`）——这些是 **R14 零写死 KPI 的派生图叶子**，驾驶舱/规划决策推演/求解器读它算数。而链 CREATE 路 publish 恒置 `derivedProperties:[]`（`modeling.ts:445`）。⇒ 路线 A 会**抹掉全部派生属性** → 驾驶舱 KPI/派生求解器空跑（与另一 agent ea13c40「三板块」审计正面冲突）。
3. **displayName 退英 + 属性策展丢失**：链置 `displayName=dataset.name`（英文 "Base"，`modeling.ts:104`），batteryObjectTypes 是中文（"生产基地"…）；属性 `withGovernance`（searchable 等）也丢。
4. **origin 变**：链 materialize 对象 `origin.type="MATERIALIZED"`，A 路是 `"SYNTHETIC"`（不在字节红线三件内，但行为差异需验）。

> 注：字节红线只管 type key 集 / obj id 集 / 沙盘 noi——**不管类型元数据**，故路线 A 改元数据**不破字节红线**，但**破「零回归」红线**（功能回归）。要保住 derivedProperties 唯有把它们连同 displayName/归域**经 draft API 全量重注**——那等于用草案 API 手搓重建 batteryObjectTypes，荒谬且脆。

### 6.2 内在冲突（合同 §3.3 vs 代码现实）：只有审核方能裁
- **§3.3 红线**要 provenance「**因果真实…不是事后盖戳**」——纯因果只有链 CREATE，但链 CREATE 摧毁策展元数据（§6.1）。
- **平台现实**：`derivedProperties`/中文 displayName/归域 是**策展元数据，数据里长不出来**（R14 KPI 公式不在原始行里）。⇒ §3.3 字面（纯因果 CREATE）与「保策展元数据不回归」**直接冲突**，且此冲突是**合同 §2 未预见代码现实**所致。
- **可行的真 provenance 路 = MAP_TO_EXISTING publish**（`modeling.ts:411-431`）：保 batteryObjectTypes 策展类型不动，链 publish 以 MAP_TO_EXISTING 把**真 rawDataset 算出的 sourceBindings**（`connId/dataset/fieldMappings`，`modeling.ts:408-410/430`）**追加**到既存类型。**这是真链读真数据集算出的 provenance 值，非被否的「硬编码模板 sourceBindings」**（§1.A 否的是假模板，非 MAP_TO_EXISTING）。残留哲学缺口：类型存在性先于链（§3.3 字面"事后"）——**此点只有审核方能裁**。

### 6.3 dev 建议 + 待裁项（已 surface）
- **建议路线 B（MAP_TO_EXISTING）**：低 blast、零功能回归、provenance 值由真链真算（非盖戳）。
- **待审核方裁**：(1) MAP_TO_EXISTING「类型先存在、链补真 provenance」是否满足 §3.3？还是 (2) 必须把 derivedProperties/displayName/归域 全部迁入链（大手术，且 R14 公式仍须某处声明）？(3) 或接受路线 A 抹派生属性（需同改驾驶舱口径）？
- **未动主体代码**：只落了 §1.2 安全 regex（已验绿）。主体待裁，不硬改。

## 7. ✅ 审核方裁决 + 根因方案（"按解决根本问题为原则，不走捷径"）
> 审核方明示：**按解决根本问题为原则，不走捷径** → §6.3 的路线 B（MAP_TO_EXISTING 在既存类型上补 provenance）属捷径，**否**。须走根因：让 demo 类型**经真链 CREATE**，同时**不丢策展元数据**（零回归）。

### 7.1 根因再定位：建模链表达力不足 → 这正是 demo 当初短路它的原因
§6 的"冲突"实为**伪冲突**——根因不是"§3.3 与策展元数据不可兼得"，而是**建模链契约缺表达力**：
1. `ModelingSuggestion.objectTypes[]` **无 `derivedProperties` 字段**（`contracts/datacore.ts:162-183`）→ KPI 公式无法过 derive→publish。
2. `publishDraft` 硬置 `derivedProperties:[]`（`modeling.ts:445`）。
3. `DraftOperation` 有 `setDomain` 但无 `setDisplayName`/`setDerivedProperties`（`domain.ts:495-513`）。

⇒ 链产不出生产级策展类型，**所以 demo 当初才 upsertType 直注短路它**。**根因 = 补全链表达力**，再让 demo 走链。

### 7.2 去风险真测：derive 全 34 类 vs 策展类型 逐元素 diff（live datacore 真跑）
`POST /modeling/derive`（全 34 rawDataset）→ 取 draft.suggestion，逐类比对策展类型（`scratchpad/derive-diff.mjs`）：
- **PK：34/34 全中**（pk 推断 = 唯一率最高字段，与显式 pk 一致）✓ → obj id 字节红线可守。
- **displayName**：34/34 异（链=英文 dataset.name vs 策展中文"生产基地"…）。
- **domain**：34/34 异（链=unassigned vs 策展 factory/product/…）。
- **derivedProperties**：6 类缺（Base/Model/Order/DemandSegment/Metric/SopVersionRow）。
- **属性 dataType/ref**：多类异——链 FK 自动探测**过度判 ref**（如 `Base.baseId` 误判 ref→Line，实为 Base 自身 pk string）+ enum/date/json 误推。
- **属性集**：仅少数策展独有快照属性（Line:utilization/actual_output_daily/schedule_attainment、Process:yield_baseline、Equipment:oee_current——A8 时序快照叶子，原始行无）。
全量见 `scratchpad/derive-diff-out.txt`。

**结论**：链 derive 是**带噪初稿**（FK 过判、枚举误推），策展 `batteryObjectTypes` 正是**人工修正后的真值**——这恰是 **A3 半自动建模"建议→人工 PATCH→发布"** 的标准形态。**根因方案不是"丢策展就策展"，而是"把人工策展作为确定性 PATCH 焊进链"**。

### 7.3 根因方案（非捷径·三段都真）
**A. 补全链表达力**（让链能表达生产级类型）：
- `ModelingSuggestion.objectTypes[]` += `derivedProperties: [{propKey,formula}]`（默认 []）。
- `publishDraft` CREATE 路 `derivedProperties: t.derivedProperties ?? []`（不再硬置 []）。
**B. demo 走真链 + 确定性策展 PATCH**（`instantiateBattery` chainMode，仅 demo；A 路对其它租户零变）：
- chainMode：跳过 `batteryObjectTypes()`/`extendedObjectTypes()` 直 upsert + 早 publishVersion + `objects.put`；**仍产 34 rawDataset+rawRows + 链路类型 + 链路实例**（§1.A 末行：链路 A 路种法不动，沙盘依赖）。
- 末尾跑链：`modeling.derive(34 rawDatasetIds)`（真带噪初稿+真 FK 候选）→ **确定性策展 overlay**（以 `batteryObjectTypes`/`extendedObjectTypes` 为人工修正真值，映射成 suggestion：displayName/domain/properties(含 sourceField=propKey)/derivedProperties；清 suggestion.linkTypes 以免污染策展链路）→ 持久化草案 → `publishDraft`（**真 CREATE 类型 + publish 真算 sourceBindings/sourceDataset from 真 rawDataset** → R13 provenance 因果真实）→ `materialize`（统一 id `obj_${type}_${pk}` + §1.2 regex → 字节同基线）。
- 注入：`modeling` 在 `synthetic` 之前构造（`app.ts:325-326`），按既有 `livedInRunner`"注入避免依赖环"先例 setter 注入。
**C. 为何非捷径/非盖戳**：类型由 `publishDraft` **真 CREATE**（存在性因果由链导致，满足 §3.3），sourceBindings 由 publish **真读真 rawDataset 算**（非硬编码模板）。策展 overlay 改的是**类型定义**（属性/名/域/派生——人工不可自动推导的业务语义），**不碰 provenance**；这是半自动建模的"人工 PATCH"半，确定性化。最终类型 == 策展真值（零回归）且**有真血缘**。

### 7.4 验证门（必跑·任一不达=自打回）
1. **字节红线**：重导 §增量0 三件，typekeys=cc787b32 / objids=8277a5a7 / noi=a958632a **逐字节相等**。
2. **零回归**：`pnpm -r build && pnpm -r test`（4 包）全绿；沙盘真浏览器 tick 节点 Σ 仍真变。
3. **provenance 真**：34 类 sourceBindings 指向真 rawDataset；ModelingPage 34 数据集"已建模"（增量3 UI 闭合）。
4. **R6 确定性**：同 seed 两跑三 SHA256 一致；链走确定性 derive，无 LLM/时钟/随机。
