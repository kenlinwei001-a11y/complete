# PRD · A4 · 对象/类型浏览器管理页（列已发布类型 + 物化计数 + 下钻实例）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-21 · 波次 Wave 2 |
| 取代/扩展 | 扩 `PRD-frontend.md`（管理台）· `PRD-ontology-browser-field-coverage.md` · 消费 `PRD-A3-*`（14 域/切片）· `PRD-A11-*`（连接归类） |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§2.B 本体域 · §5 R2/R3/R14） · `apps/datacore/src/app.ts:1171`（GET /a/v1/ontology/object-types → listTypes）· `POST /a/v1/objects/aggregate`（计数）· `GET /a/v1/objects?type=` · `apps/frontend-shell/src/pages/Object360Page.tsx` · `pages/adminRegistry.ts` |
| 索引 | `PRD-A-series-roadmap.md` |

> 一句话：用户实测**"找不到已发布对象类型在哪看"**——现有 `listTypes` 端点和 Object360 下钻都在，但**没有一个把"已发布类型 + 物化计数 + 下钻实例"列出来的管理页**。A4 补这个浏览器页：按 14 域分组列类型 → 显示物化对象数 → 下钻实例表 → 再下钻单对象（Object360/lineage）。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2.B）：`OntologyType`（listTypes）·`ObjectInstance`（objects/aggregate 计数 + 分页查）·`PropertyDef/DerivedPropertyDef`·`Domain`（A3 14 域分组）·`Connection.category`（A11 来源归类筛选）·`SliceSpec`（A3 切片，类型所属切片快链）。
- **触及链路**（§3）：`listTypes → objects/aggregate(计数) → objects?type=(实例) → Object360/lineage`（已有端点的**浏览编排**，无新后端逻辑）。
- **触及事件/数据流**（§4，D-29）：消费 `ontology.published`/`materialize.completed`/`derivation.completed` 失效本页（计数/类型实时）。
- **触及不变量**（§5）：
  - **R2** tenant_id：仅列本租户已发布类型与计数。
  - **R3** entitlement：功能关的类型/域不列（先于 authz）。
  - **R14** 应用层无业务常数：类型名/域/列全来自 API（listTypes + 14 域注册表 + 字段元数据），前端零内联。
- **关闭/影响断点**（§8）：闭合"对象/类型不可浏览"可用性缺口（用户 hand-run 命中）；为 A12 模块 hand-run 补全提供入口。
- **门禁**（§7）：`debattery:check`（页零业务常数）· 前端回归（新页用例）· `ontology:check`。
- **回写承诺**：回写本体 §2.B（浏览器页）· §3（浏览编排链）。

## 1. 目标 / 非目标
### 目标
1. **类型清单**：列所有**已发布（ACTIVE）** OntologyType，按 **14 域（A3）分组**；每行：显示名/域/属性数（源/派生/手工）/PK/**物化对象数**。
2. **物化计数**：每类型实时对象数（`objects/aggregate count BY type`），区分总数 / 本版本 / 派生占比。
3. **下钻实例**：点类型 → 分页实例表（`GET /a/v1/objects?type=`，列可选关键属性）→ 点实例 → Object360/lineage（已有）。
4. **筛选**：按域（A3）、按来源 `Connection.category`（A11）、按"有/无物化"、关键词。
5. **快链**：类型 → 所属切片（A3 域内/跨域库）、字段全建模覆盖徽章（R12）、被哪些求解器/规则引用（refs 反查）。

### 非目标
- 不重做本体图谱（OntologyGraphView 已有；A4 是**列表/表格**互补视角）。
- 不在 A4 做建模编辑（ModelingPage 负责）；A4 只读 + 下钻。

## 2. 现状与缺口（file:line）
| 维度 | 现状 | 缺口 |
|---|---|---|
| 类型列表端点 | `app.ts:1171 GET /a/v1/ontology/object-types`（listTypes，带 status） | 无前端浏览页消费它成清单 |
| 计数 | `POST /a/v1/objects/aggregate`（count BY） | 未做"每类型物化数"卡 |
| 实例下钻 | `GET /a/v1/objects?type=` + `Object360Page` | 无"类型→实例表→单对象"串联入口 |
| 管理页 | `adminRegistry.ts`：有 modeling/domains，**无 object-types 浏览页** | 用户"找不到" |
| 分组 | 域分组靠 A3 14 域 | A4 消费 A3 |

## 3. 设计（纯前端编排 + 既有端点；可选 1 个聚合端点）
### 3.1 新页 `/admin/object-types`（adminRegistry 注册，roles admin/data_admin）
- 顶部：域筛选 chips（A3 14 域）+ 来源 category 筛选（A11）+ 关键词 + "仅有物化"开关。
- 主体：按域分组的类型表——列 `类型 | 域 | 属性(源/派生/手工) | PK | 物化数 | 覆盖徽章 | 快链`。
- 数据：`listTypes` + 一次 `objects/aggregate`（count BY type，批量拿全类型计数，避免 N 次请求）。
### 3.2 类型下钻抽屉
- 点类型行 → 右侧抽屉：属性 schema（源/派生/手工标注）+ 字段全建模覆盖（R12）+ 所属切片（A3）+ 被引用（refs 反查：哪些 solver/rule/slice）+ **「看实例 →」**。
### 3.3 实例表
- 「看实例」→ 分页实例表（`GET /a/v1/objects?type=&page=&f_*=`，A6 行级过滤生效）；列 = 该类型关键属性（PK + 前几个非派生）；点行 → `Object360Page`（lineage 溯源已有）。
### 3.4 可选聚合端点（性能）
- 若 `objects/aggregate` 不便一次拿全类型计数，加 `GET /a/v1/ontology/object-types/stats`（每类型 {count, derivedCount, lastMaterializedAt}），后端一次算。

## 4. 契约 / 端点
- 复用：`GET /a/v1/ontology/object-types`、`POST /a/v1/objects/aggregate`、`GET /a/v1/objects`、refs 反查、field-coverage。
- 可选新增：`GET /a/v1/ontology/object-types/stats`（每类型计数聚合）。
- 前端类型（`api/types.ts`）：`ObjectTypeBrowserRow`（配置驱动列）。

## 5. 关键流程（端到端）
进 `/admin/object-types` → 见 14 域分组的已发布类型 + 每类型物化数 → 筛"factory 域 / 有物化" → 点 `Base` → 抽屉见属性/覆盖/切片/被引用 → 「看实例」→ 12 行 Base 实例 → 点 `常州基地` → Object360 + lineage 溯源到 RawRow。

## 6. 非功能（§5）
R2 租户隔离 · R3 entitlement 过滤 · R14 零业务常数（列/域/标签来自 API）。

## 7. 验收（DoD）
- 新页列已发布类型 + 物化数（与 aggregate 一致）+ 域分组 + 筛选；下钻实例表 → 单对象 Object360。
- 用户"找不到对象类型"问题闭合（hand-run 验收）。
- `pnpm -r build && pnpm -r test` 全绿（前端新页用例）；`debattery:check`/`ontology:check` 过。
- 回写本体 §2.B/§3。

## 8. 分期
- **A4.1** 类型清单 + 物化计数 + 域分组（消费 A3）。
- **A4.2** 下钻抽屉（覆盖/切片/被引用）+ 实例表 → Object360。
- **A4.3** 来源 category 筛选（A11）+ 可选 stats 端点。

> 依赖 A3（14 域）+ A11（category 筛选）；可先用现有 9 域上线，A3 就绪后切 14 域。基线分支：前端新页 + 可选 1 端点，冲突小。
