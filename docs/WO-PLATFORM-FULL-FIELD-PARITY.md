# WO · 平台字段全量对齐 docx 主数据(续 SCHEMA-ALIGN)

> **这是什么**:`WO-PLATFORM-SCHEMA-ALIGN.md` 只补了三处"决策真信号/结构订正"(Equipment mtbf/mttr/health、Workshop 车间层、`line_belongs_to_base` 基数)。本续单把**剩余的 docx 台账/生命周期字段**一次性补齐,让"平台自有电池模型 = 用户 docx 主数据全字段"。覆盖 Factory 6 字段 + Line 4 字段 + Equipment 5 字段。
> **一句话**:这批是**记录/台账字段**(编码、行政区划、类型、状态、日期),不是决策派生量——价值在"导入对齐/可追溯/生命周期",不是喂求解器。**默认可缓做**(若只追决策推演,SCHEMA-ALIGN 三处足够);要"全字段对齐"才上本单。
> **前置**:本单假设 `WO-PLATFORM-SCHEMA-ALIGN`(WO-SA-1/2/3)已落(Line 已加 workshopId、Equipment 已加 mtbf/mttr/health、Workshop 已建)。字段不重复补。
> **状态**:待派单。锚点已核对(`complete` 分支 · `battery.ts` · `2026-07`)。

---

## §0 本体引用与影响(铁律 0)
- **对象类型**(母体 §2):`Base`/`Line`/`Equipment`(§2.B 本体域)`PropertyDef`(domain.ts:248)。
- **链路**(母体 §3):无新增链路(纯属性补齐)。
- **不变量**(母体 §5):**R14** 全落 `battery.ts` 合成包 / 记录字段的 per-base 事实入 `BASE_REGISTRY`(contracts·既有归属)·平台通用代码零业务常数 · **R12** 每字段落对象属性声明 · **R6** 合成新增 draw 追加在既有 draw 之后、枚举取值落 enumValues 内 · **R2** 租户隔离 · **R13** 溯源(status/date 为可追溯记录字段)。
- **断点**(母体 §8):**G-8 数据接入**(记录字段补齐强化导入对齐)。
- **回写**:落地后回写母体 §2(Base/Line/Equipment 增列),`pnpm ontology:slices`。

---

## §1 三单总览(全部低杠杆·可缓做)

| 单 | 对象 | 补字段 | docx 源 | 声明落点 | 合成填充落点 | 工作量 | 风险 |
|---|---|---|---|---|---|---|---|
| **WO-SA-4** | Base(=factory) | factory_code, province, city, factory_type(enum), status(enum), start_date(date) | factory.csv | baseProps `:411` | `BASE_REGISTRY`(contracts)/`BASES` `:23` + Base 装配 | 6 字段 | 中(触 contracts) |
| **WO-SA-5** | Line | line_code, max_capacity_day, target_yield, status(enum) | production_line.csv | lineProps `:474` | `lines.push` `:1654` | 4 字段 | 低 |
| **WO-SA-6** | Equipment | equipment_code, equipment_type(enum·值域待核), manufacturer, install_date(date), status(enum·值域待核) | equipment.csv | equipmentProps `:506` | `equipment.push` `:1675` | 5 字段 | 低 |

> **docx↔平台已对齐、无需补的**:factory_id=baseId · factory_name=name · capacity_gwh=gwh;line_id=lineId · workshop_id=workshopId(SA-3) · process=Workshop.process_type(SA-3) · oee≈oeeIndex/三分解;equipment_id=equipId · line_id=lineId · mtbf/mttr/health_score(SA-2)。

---

## §2 WO-SA-4 · Base 补 6 个 Factory 台账字段

### 声明(baseProps `:411`,在既有属性后、`];` 前追加)
```ts
  // docx factory 台账/生命周期字段(记录型·R12 全建模·对齐 factory.csv)
  { propKey: "factory_code",  dataType: "string", isPrimaryKey: false, searchable: true, description: "基地编码(如 CZ/XM),对齐 factory.factory_code" },
  { propKey: "province",      dataType: "string", isPrimaryKey: false, description: "省(记录型·与既有 lon/lat 并存不替换)" },
  { propKey: "city",          dataType: "string", isPrimaryKey: false, description: "市(记录型)" },
  { propKey: "factory_type",  dataType: "enum",   isPrimaryKey: false, enumValues: ["CELL", "PACK"], description: "基地类型:电芯/PACK,对齐 factory.factory_type" },
  { propKey: "status",        dataType: "enum",   isPrimaryKey: false, enumValues: ["ACTIVE", "PLANNING", "DECOMMISSIONED"], description: "生命周期状态(docx 样本均 ACTIVE)" },
  { propKey: "start_date",    dataType: "date",   isPrimaryKey: false, description: "投产日期,对齐 factory.start_date" },
```
> **geo 说明**:平台已有 `lon/lat`(地图坐标),docx 是 `province/city`(行政区划)——**二者并存**,province/city 是记录字段,不替换 lon/lat。

### 合成填充(**必须填·否则双向门②红**)
这 6 个是 **per-base 真实事实**(常州=江苏/常州/CELL,广州=广东/广州/PACK…),不能用随机数糊。两条落地路线,dev 二选一并在单内声明:
- **路线①(推荐·数据正确)**:在 `BASE_REGISTRY`(`@platform/contracts`)每条基地补 `code/province/city/type/status/startDate`,`BASES` 映射(`:23-24`)带出,Base 对象装配处照填。`BASE_REGISTRY` 本就是 contracts 里的基地权威登记(既有归属·非新增业务常数入平台通用代码,守 R14)。
- **路线②(轻·先过门)**:battery.ts 内建一张 `baseId→{code,province,city,type}` 常量映射(电池域事实·R14 合法),status 恒 `ACTIVE`、start_date 用基地既有投产年。
> **R6**:这些是**确定性常量**(非 rng),同 seed 同值,天然满足 R6;若用 rng 补 status 抖动须追加在既有 draw 之后。

---

## §3 WO-SA-5 · Line 补 4 个产线台账字段

### 声明(lineProps `:474`,追加)
```ts
  // docx production_line 台账字段(对齐 production_line.csv)
  { propKey: "line_code",        dataType: "string", isPrimaryKey: false, searchable: true, description: "产线编码(如 COAT01),对齐 line.line_code" },
  { propKey: "max_capacity_day", dataType: "number", isPrimaryKey: false, unit: "pcs/day", description: "日最大产能,对齐 line.max_capacity_day" },
  { propKey: "target_yield",     dataType: "number", isPrimaryKey: false, unit: "ratio", description: "目标良率(0-1),对齐 line.target_yield" },
  { propKey: "status",           dataType: "enum",   isPrimaryKey: false, enumValues: ["RUNNING", "IDLE", "MAINTENANCE", "STOPPED"], description: "产线运行状态(docx 样本均 RUNNING)" },
```
> `oee` 不补:平台已有 `oeeIndex`(Base 级)+ Equipment `oeeA/P/Q` 三分解,语义更细,不与 line.oee 重复建。

### 合成填充(`lines.push` `:1654`,追加字段)
```ts
    lines.push({
      lineId, baseId: b.baseId, name: `${b.name}一号线`,
      // ↓ 追加(枚举取 enumValues 内值;数值走 rngTopo 且追加在末尾·R6)
      line_code: `L-${b.baseId}-01`,
      max_capacity_day: randInt(rngTopo, 45000, 60000),
      target_yield: round(0.982 + rngTopo() * 0.016, 3),   // 0.982-0.998
      status: "RUNNING",
    });
```

---

## §4 WO-SA-6 · Equipment 补 5 个设备台账字段

### 声明(equipmentProps `:506`,在 SA-2 的 mtbf/mttr/health 后追加)
```ts
  // docx equipment 台账字段(对齐 equipment.csv)
  { propKey: "equipment_code", dataType: "string", isPrimaryKey: false, searchable: true, description: "设备编码,对齐 equipment.equipment_code" },
  { propKey: "equipment_type", dataType: "enum",   isPrimaryKey: false, enumValues: ["COATER", "CALENDER", "SLITTER", "WINDER", "ASSEMBLER", "FILLER", "FORMATION", "AGING", "PACKER"], description: "设备类型(⚠ 值域待从 equipment.csv 实抽核准)" },
  { propKey: "manufacturer",   dataType: "string", isPrimaryKey: false, description: "制造商,对齐 equipment.manufacturer" },
  { propKey: "install_date",   dataType: "date",   isPrimaryKey: false, description: "安装日期,对齐 equipment.install_date" },
  { propKey: "status",         dataType: "enum",   isPrimaryKey: false, enumValues: ["RUNNING", "IDLE", "MAINTENANCE", "FAULT"], description: "设备状态(⚠ 值域待核)" },
```
> ⚠ **值域待核**:docx 抽取只拿到 equipment 表头,未见 `equipment_type`/`status` 的实际取值行。上面 enumValues 是按锂电工序**合理推定**——dev 落地前须打开 `equipment.csv` 核准实际码值,不符即改(否则合成取值可能落在真实值域外)。

### 合成填充(`equipment.push` `:1675`,在 SA-2 的 mtbf/mttr/health 后追加)
```ts
          // ↓ 追加(在 mtbf/mttr/health_score 之后·R6 末尾追加)
          equipment_code: `${processId}-E${e}`,
          equipment_type: pick(rngTopo, ["COATER","CALENDER","SLITTER","WINDER","ASSEMBLER","FILLER","FORMATION","AGING","PACKER"]),
          manufacturer: pick(rngTopo, ["先导智能","赢合科技","利元亨","杭可科技"]),
          install_date: "2022-06-01",
          status: "RUNNING",
```
> `equipment_type` 更严谨的做法:由 `processId` 的工序**确定性映射**(化成→FORMATION、分容→AGING…)而非随机 `pick`,与工序一致。dev 可按需改成映射。

---

## §5 R6 确定性 & 双向对齐门(与 SCHEMA-ALIGN 同纪律)

| 雷 | 后果 | 守法 |
|---|---|---|
| 新 rng draw 插既有 draw 中间 | R6 字节漂移·快照断言红 | 追加在末尾 |
| 声明了非派生字段但合成没填 | `synthetic-field-alignment` 判据② `missing` 红 | 每字段声明+合成成对(本单已成对给) |
| 合成填了未声明字段 | 判据① `orphans` 红 | 只填已声明键 |
| 枚举合成取了 enumValues 外的值 | 单位/枚举校验红 | 取值必落 enumValues(equipment_type/status 尤其:先核准值域) |
| per-base 记录字段用随机糊 | 数据不真(常州被填成随机省份) | Base 6 字段用常量映射,非 rng(§2) |

---

## §6 母体回写
1. `docs/SYSTEM-ONTOLOGY.md` §2:Base 增列 factory_code/province/city/factory_type/status/start_date;Line 增列 line_code/max_capacity_day/target_yield/status;Equipment 增列 equipment_code/equipment_type/manufacturer/install_date/status。
2. `pnpm ontology:slices` 重算切片;`node scripts/check-system-ontology.mjs` + `check-ontology-writeback.mjs` 绿。

---

## §7 验收(每单 green→red 自证)
- **WO-SA-4**:`synthetic-field-alignment` 两判据绿;查任一 Base 对象 props 含 6 新字段且 `province/city` 是真值(常州→江苏/常州,非随机);**红自证**:只加声明不加合成→判据② 报 `Base.province` 等→红,补合成即绿。
- **WO-SA-5**:查任一 Line 含 line_code/max_capacity_day/target_yield/status;`status ∈ enumValues`;**红自证**:同上跳合成→红。
- **WO-SA-6**:查任一 Equipment 含 5 新字段;`equipment_type/status ∈ enumValues`;**红自证**:把 `equipment_type` 合成成 `"FOO"`(值域外)→枚举校验红;改回即绿。
- **全局**:`pnpm --filter datacore build && test` 全绿;`debattery:check` 绿(R14);`node scripts/check-prd-ontology.mjs` 认本单 §0。

## §8 关联
`WO-PLATFORM-SCHEMA-ALIGN.md`(前置·SA-1/2/3)· `REVIEW-field-schema-user-vs-platform.md`(字段级依据)· `PRD-enterprise-dataset-import.md`(这些记录字段的另一条路=导入侧 A3 反推,与本单"平台内合成"互补)· 母体 §2/§5(R14/R12/R6)/§8(G-8)。

## 附录 · 证据锚点
`battery.ts:411`(baseProps)/`:474`(lineProps)/`:506`(equipmentProps)/`:23`(BASES↔BASE_REGISTRY)/`:1654`(lines.push)/`:1675`(equipment.push)· `domain.ts:248`(PropertyDef 形状)· `test/synthetic-field-alignment.test.ts`(双向门)· docx factory/production_line/equipment 表头 + 样例(factory_type∈{CELL,PACK}·status=ACTIVE·line.status=RUNNING;equipment_type/status 值域待抽)· 母体 §2/§5/§8。
