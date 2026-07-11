# WO · 平台字段/基数向用户设计对齐(三改) · 施工单

> **这是什么**:`REVIEW-field-schema-user-vs-platform.md` §5-3 判"该改平台"的三处,收成一张 dev 直接照着改的施工单——带 `battery.ts` 精确行号、改哪个 Props 数组、加哪几个字段定义、连带的合成生成落点、和 green→red 验收。
> **一句话**:平台自有电池模型有三处**不如用户设计正确/完整**——设备缺可靠性字段、`line_belongs_to_base` 基数写错、缺车间层;本单把这三处补齐,**且守住"声明了字段就必须合成填上"这道双向门**(不是改个声明就完事)。
> **范围红线**:本单只改**平台自有的 battery 合成包**(`apps/datacore/src/synthetic/battery.ts`)——这是电池域事实的合法归属地,**不是**把用户 32 表 ERP schema 塞进平台(那条走 `PRD-enterprise-dataset-import.md` 的导入侧)。两者别混。
> **状态**:待派单。锚点均已核对(`complete` 分支 · `battery.ts` 行号 · `2026-07` 复核)。

---

## §0 本体引用与影响(铁律 0)
- **对象类型**(母体 §2):`ObjectType`/`PropertyDef`/`LinkType`(§2.B 本体域)· 现有 `Equipment`/`Line`/`Base` 类型 · **拟新增 `Workshop` 对象类型**(改动三)。
- **链路**(母体 §3):`line_belongs_to_base`(基数订正)· `equip_used_in`(不动)· **拟新增 `workshop_belongs_to_base` / `line_belongs_to_workshop`**(改动三)。
- **不变量**(母体 §5):
  - **R14 应用层无业务常数**——三改**全部落 `battery.ts` 合成包**(电池业务事实的指定归属地),平台通用代码零新增业务常数;`debattery:check` 须绿。
  - **R12 字段全建模**——新增字段(mtbf/mttr/health_score、Workshop 属性)均落对象属性声明,不做游离量。
  - **R6 确定性**——合成新增取值必须走既有 `rngTopo()` 种子流,**且追加在既有 draw 之后**(不得插在中间,否则位移后续字节)。
  - **R2 租户隔离** · **R13 溯源**——新对象/边照现有 seedBattery 落 tenant + 可溯源,不破坏。
- **断点**(母体 §8):**G-8 数据接入**(字段/基数订正强化本体契约)。
- **回写**:落地后回写母体 §2(新增 Workshop 类型行 + Equipment 字段增量)、§3(新增两条链路 + `line_belongs_to_base` 基数订正),并 `pnpm ontology:slices` 重算切片(见 §6)。

---

## §1 三改总览(按杠杆/风险排序)

| 单 | 改动 | 锚点 | 工作量 | 风险 | 为什么这个序 |
|---|---|---|---|---|---|
| **WO-SA-1** | `line_belongs_to_base` 基数 **N:N → N:1** | `battery.ts:770` | 1 字符 | 极低 | 声明订正·实例本就满足(每线一 baseId)·零合成改动 |
| **WO-SA-2** | Equipment 补 **mtbf / mttr / health_score** | `battery.ts:506`(声明)+`:1675`(合成) | +3 字段 +3 draw | 低 | 设备故障推演真信号·合成门要求同步填 |
| **WO-SA-3** | 新增 **Workshop 车间层**(Factory→Workshop→Line) | 新 props + `:739` 注册 + 两条链路 + `:1654` 合成 | 新类型+生成+2边 | 中 | 最重·动合成主循环·建议独立一期 |

**建议派单**:WO-SA-1 + WO-SA-2 合一期(低风险、纯正确性补齐);WO-SA-3 独立一期(它动合成主循环,是三者里唯一"新增可实例化类型",撞双向对齐门最硬)。

---

## §2 WO-SA-1 · 修基数错误 `line_belongs_to_base` N:N → N:1

### 病灶(已核对)
`apps/datacore/src/synthetic/battery.ts:770`:
```ts
{ key: "line_belongs_to_base", fromTypeKey: "Line", toTypeKey: "Base", cardinality: "N:N" }, // factory（多线归一基地）
```
注释自己都写"多线归一基地"=多对一,基数却声明 `N:N`。一条产线只属于一个基地,**语义应为 N:1**。用户设计(`REVIEW §3`:Factory 拥有 Line = HAS·1:N)是对的。

### 改法(声明订正·一处)
```ts
{ key: "line_belongs_to_base", fromTypeKey: "Line", toTypeKey: "Base", cardinality: "N:1" }, // 一线归一基地（订正:原 N:N 与语义/实例不符）
```

### 为什么零合成改动
边实例由 `Line.baseId`(ref→Base,`lineProps:474` 已声明)自动派生,**每条 Line 恰好一个 baseId**(`:1655` `lines.push({ lineId, baseId: b.baseId, ... })`)——实例数据本就满足 N:1,只是声明写宽了。改声明不动数据。

### 影响面(须回归)
`line_belongs_to_base` 被 8 处推演路径 `mustIncludeLinkKeys` 引用(`:850/:918/:1026/:1102` 等)——它们只要求"边存在",不依赖基数宽窄,**订正 N:N→N:1 不破坏这些路径**。跑 `pnpm --filter datacore test` 全绿即证。

---

## §3 WO-SA-2 · Equipment 补 MTBF / MTTR / health_score

### 缺口(已核对)
`equipmentProps`(`battery.ts:506`)当前只有 OEE 三分解,**无可靠性字段**:
```ts
const equipmentProps: PropertyDef[] = [
  { propKey: "equipId", dataType: "string", isPrimaryKey: true },
  { propKey: "processId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Process" },
  { propKey: "lineId",    dataType: "ref", isPrimaryKey: false, refToTypeKey: "Line" },
  { propKey: "baseId",    dataType: "ref", isPrimaryKey: false, refToTypeKey: "Base" },
  { propKey: "ctSeconds",   dataType: "number", isPrimaryKey: false },
  { propKey: "availFactor", dataType: "number", isPrimaryKey: false },
  { propKey: "oeeA", dataType: "number", isPrimaryKey: false },
  { propKey: "oeeP", dataType: "number", isPrimaryKey: false },
  { propKey: "oeeQ", dataType: "number", isPrimaryKey: false },
  { propKey: "oee_current", dataType: "number", isPrimaryKey: false }, // ...
];
```
用户设计有 `mtbf/mttr/health_score`(`REVIEW §2.3`)——设备故障推演的**真驱动**;平台现在只有 OEE,无法回答"某设备平均多久坏一次、坏了多久修好、当前健康度"。

### 改法 A:补字段声明(`:506` 数组,在 `oee_current` 后、`];` 前追加)
```ts
  // 可靠性工程(设备故障推演真信号·对齐用户 equipment.mtbf/mttr/health_score)——全建模 R12
  { propKey: "mtbf",         dataType: "number", isPrimaryKey: false, unit: "h",  description: "平均无故障时间(小时)" },
  { propKey: "mttr",         dataType: "number", isPrimaryKey: false, unit: "h",  description: "平均修复时间(小时)" },
  { propKey: "health_score", dataType: "number", isPrimaryKey: false, unit: "%",  description: "设备健康度(0-100·越高越健康)" },
```

### 改法 B:合成生成同步填(**这步不做则门必红**·`:1675` `equipment.push`)
`synthetic-field-alignment.test.ts` 判据②:*每个非派生字段的对象并集必须覆盖*——声明了 `mtbf/mttr/health_score` 就**必须**在合成处填,否则 `missing` 非空→红。在 `:1683` `oeeQ` draw **之后**追加(守 R6:追加在末尾不位移既有字节):
```ts
        equipment.push({
          equipId: `${processId}-E${e}`,
          processId,
          lineId,
          baseId: b.baseId,
          ctSeconds:   round(1.1 + rngTopo() * 0.5, 2),
          availFactor: round(0.86 + rngTopo() * 0.08, 3),
          oeeA: round(0.9  + rngTopo() * 0.06, 3),
          oeeP: round(0.88 + rngTopo() * 0.08, 3),
          oeeQ: round(0.96 + rngTopo() * 0.03, 3),
          // ↓ 追加(必须在既有 draw 之后·守 R6 确定性)
          mtbf:         round(300 + rngTopo() * 500, 0),  // 300-800h
          mttr:         round(2   + rngTopo() * 6, 1),    // 2-8h
          health_score: round(78  + rngTopo() * 20, 0),   // 78-98
        });
```
> `oee_current` 是派生(注释标"时序 7d 加权物化"),不在合成处硬填——判据②对派生字段豁免,`mtbf/mttr/health_score` 是**非派生声明**故必须填。三者的取值区间仅为占位,dev 可按需调,但**必须走 `rngTopo()`**(R6)。

### 影响面
- 用户设计的 `equipment_failure` 类推演此后有真信号可用(此前只能拿 OEE 硬凑)。
- IMPORTS 映射表(`:687` `Equipment` fieldMappings)可选补 `mtbf:"MTBF"` 等——若要让导入侧也认这三列;不补也不影响本单(导入侧走 A3 反推)。

---

## §4 WO-SA-3 · 新增 Workshop 车间层(Factory→Workshop→Line→Equipment)

> **这是三改里唯一"新增可实例化对象类型"的一单**,最重——因为它同时撞两道对齐门(判据①无孤儿键 + 判据②非派生全填),声明和合成生成必须**一起**落,否则门红。建议独立一期。

### 缺口(已核对)
平台层级 `Base→Line→Process→Equipment`(3 层·`plain()` 注册块 `:739-748` 无 Workshop);用户是 `Factory→Workshop→Line→Equipment`(4 层),10 车间=制浆/涂布/辊压/分切/卷绕/装配/注液/化成/分容/PACK(`REVIEW §2.2`)。缺车间层→设备故障/瓶颈无法定位到车间粒度。

### 改法 A:新增 `workshopProps`(建在 `lineProps` 定义 `:474` 附近)
```ts
const workshopProps: PropertyDef[] = [
  { propKey: "workshopId", dataType: "string", isPrimaryKey: true },
  { propKey: "baseId",     dataType: "ref",    isPrimaryKey: false, refToTypeKey: "Base" }, // 对齐用户 workshop.factory_id
  { propKey: "name",         dataType: "string", isPrimaryKey: false, searchable: true },
  { propKey: "process_type", dataType: "enum",   isPrimaryKey: false,
    enumValues: ["制浆","涂布","辊压","分切","卷绕","装配","注液","化成","分容","PACK"] }, // 对齐用户 workshop.process_type
];
```

### 改法 B:注册对象类型(`plain()` 块 `:739`,建议插在 `Line` 之前)
```ts
    plain("Workshop", "车间", workshopProps),
    plain("Line", "产线", lineProps),
```

### 改法 C:Line 挂 Workshop 外键(`lineProps:474` 追加一 ref)
```ts
  { propKey: "workshopId", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Workshop" }, // Line 归属车间(Factory→Workshop→Line)
```

### 改法 D:新增两条链路(`links` 数组 `:770` 邻近)
```ts
{ key: "workshop_belongs_to_base", fromTypeKey: "Workshop", toTypeKey: "Base",     cardinality: "N:1" }, // 车间归一基地
{ key: "line_belongs_to_workshop", fromTypeKey: "Line",     toTypeKey: "Workshop", cardinality: "N:1" }, // 产线归一车间
```

### 改法 E:合成生成(**最硬的一步**·`:1653` `for (const b of bases)` 循环内)
当前每基地只生成 1 条线(`:1655`)。要让 Workshop 是**可实例化且全字段填满**的类型,须在 line-gen 循环里同步 emit Workshop 实例并回填 `line.workshopId`。两条落地路线,dev 二选一并在单内声明:
- **路线①(轻·推荐先行)**:每基地生成 1 个代表性车间(如按当前主瓶颈工序命名),Line.workshopId 指向它。满足门(类型有实例、非派生全填),粒度先粗后细。
- **路线②(全)**:每基地按 10 车间枚举全量生成 Workshop,并把现有 `SERIAL_STEPS`/Process 归到对应车间下。更贴用户设计,但要重排 Process↔Workshop 归属,工作量大——建议二期再上。

无论哪条:**Workshop 每个非派生字段(workshopId/baseId/name/process_type)都要填**,`process_type` 必须取自上面 enum;新增 `rngTopo()` draw(若有)一律追加在既有 draw 之后(R6)。

### 影响面(须核)
- `Line` 新增 `workshopId` 非派生字段 → **判据② 要求所有 Line 实例都填 workshopId**,否则红(改法 E 必须回填)。
- 新类型/新边不得破坏既有 `mustIncludeLinkKeys` 路径(它们没引用 Workshop,不受影响)。
- 母体回写要加 Workshop 类型行 + 两条链路(§6)。

---

## §5 R6 确定性 & 双向对齐门——三改共同的"别踩雷"

| 雷 | 后果 | 守法 |
|---|---|---|
| 新 `rngTopo()` draw 插在既有 draw **中间** | 位移后续所有字段取值·R6 字节漂移·快照类断言红 | 一律**追加在末尾** |
| 声明了非派生字段但合成处**没填** | `synthetic-field-alignment` 判据② `missing` 非空→红 | 声明与合成成对改(§3-B / §4-E) |
| 合成处填了本体**没声明**的键 | 判据① `orphans` 非空→红 | 只填已声明字段 |
| 新增 enum 值合成取了枚举外的值 | 场景包单位/枚举校验红 | `process_type` 只取 §4-A enum 内值 |

**这四条是把"字段对齐"从口号变成门的机制**——也是本单每步都成对给"声明+合成"锚点的原因。

---

## §6 母体回写(落地后·别忘)
1. `docs/SYSTEM-ONTOLOGY.md` **§2 对象类型目录**:B 本体域下 `Equipment` 增列 `mtbf/mttr/health_score`;新增 `Workshop`(车间)类型行。
2. `docs/SYSTEM-ONTOLOGY.md` **§3 关系图谱**:`line_belongs_to_base` 基数 `N:N`→`N:1`;新增 `workshop_belongs_to_base` / `line_belongs_to_workshop` 两行。
3. 重算切片:`pnpm ontology:slices`(`scripts/build-ontology-slices.mjs`),确保新类型/字段进切片。
4. 门:`node scripts/check-system-ontology.mjs` + `node scripts/check-ontology-writeback.mjs` 绿。

---

## §7 验收(每单必带 green→red 自证)

### WO-SA-1(基数)
- **绿**:`pnpm --filter datacore test` 全绿;母体 §3 该行为 `N:1`;`check-system-ontology` 绿。
- **红自证**:临时把某条 Line 造第二个 baseId 边 → 应违 N:1(证基数真被消费);复原即绿。

### WO-SA-2(Equipment 三字段)
- **绿**:`synthetic-field-alignment.test.ts` 两条判据全绿(说明三字段既被声明又被合成填、且无孤儿);查任一 Equipment 对象 `props` 含 `mtbf/mttr/health_score` 且为 `rngTopo` 派生的真值(非写死常量)。
- **红自证**:只加声明(改法 A)、**不加合成**(跳过改法 B)→ 判据② `missing` 报 `Equipment.mtbf` 等→红;补上 B 即绿。**这条红→绿正是"声明必须合成填"门在起作用的铁证。**

### WO-SA-3(Workshop 层)
- **绿**:`Workshop` 类型 ACTIVE 且有实例;每 Workshop 四字段全填、`process_type` 落 enum;每 Line 的 `workshopId` 已回填;两条链路存在;对齐门两判据全绿;母体 §2/§3 回写 + `ontology:slices` 后 `check-ontology-writeback` 绿。
- **红自证**:注册了 `Workshop` 类型但合成不 emit 实例(或 emit 但漏填 `process_type`)→ 判据② 红;补全生成即绿。

### 全局
- `pnpm --filter datacore build && pnpm --filter datacore test` 全绿;`debattery:check` 绿(R14:三改全在 battery 包内,平台通用代码零业务常数);`node scripts/check-prd-ontology.mjs` 认本单 §0。

---

## §8 关联文档(勿重复·勿推翻)
- `REVIEW-field-schema-user-vs-platform.md`(§5-3 三改的判据源·§2.2/§2.3/§3 字段级依据)
- `PRD-enterprise-dataset-import.md`(用户 32 表 ERP schema 走**导入侧**·与本单"改平台自有电池模型"互补不重叠)
- `HANDOFF-databuilder-genuine-and-import.md`(数据构建三份索引·本单为其字段侧配套)
- 母体 `docs/SYSTEM-ONTOLOGY.md` §2/§3/§5(R14/R12/R6/R2/R13)/§8(G-8)

## 附录 · 证据锚点(均已核对)
`battery.ts:506`(equipmentProps·无 mtbf)· `:1675`(equipment 合成 push)· `:770`(`line_belongs_to_base cardinality:"N:N"` 基数错)· `:474`(lineProps)· `:739`(plain 注册块)· `:1654`(line 合成)· `domain.ts:248`(PropertyDef 形状)· `test/synthetic-field-alignment.test.ts`(双向对齐门·判据①无孤儿②非派生全填)· 母体 §2/§3/§5/§8。
