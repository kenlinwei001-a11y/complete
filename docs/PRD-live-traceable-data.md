# PRD · 端到端活数据 + 全链可溯（合成落原始表 · 结果溯回源头）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-15 |
| 取代/扩展 | 新建；地基性改造。先于场景启动器 P2/P3（用户裁决：先打通活数据可溯） |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§2.A/B / §3 数据→本体链 / §5 R6/R12 / §10 D1/D2/§10.3 `sys.ingest.data_to_object`） |

## 0. 本体引用与影响（强制 · 不填即未读本体）

- **触及对象类型**（§2）：`Connection/Connector` · `RawDataset/RawRow` · `SyntheticJob` · `ObjectInstance`（`origin`：SYNTHETIC/MATERIALIZED/MANUAL）· `Link` · `DerivationRun` · `Solver` 入参 · `Task`（结果与入参留痕）。
- **触及链路**（§3 "数据→本体→推演链"）：
  - 真链路**已存在**：`Connection --sync--> RawDataset --modeling/materialize--> ObjectInstance --runDerivations--> DerivedProperty`，且 `GET /a/v1/raw-datasets/:id/rows` 可见原始行。
  - **断点**：`SyntheticJob --gen--> ObjectInstance` **直接落对象、绕过 RawDataset/连接器**（`synthetic/service.ts:502-504`）→ 演示租户无连接、无原始表、对象无源头 backref → "结果有、出处无"。
  - **本 PRD 修复**：合成改为 `SyntheticJob --gen--> Connection(合成源) + RawDataset/RawRow --materialize--> ObjectInstance(origin 记 rawDatasetId/rowIdx)`，并新增 lineage 反查 `结果→求解器入参→对象→原始行→连接器`。
- **触及事件/数据流**（§4）：合成路径应补发既有 `raw_dataset.uploaded`（L1，原始表入库）+ `materialize.completed`（L1）；保持 `dataset.regenerated`。遵守 D-29。**不新增事件**（复用既有 → ontology:check 事件计数不变）。
- **触及不变量**（§5）：
  - **R6 确定性**：合成同 (industry,scale,seed) 产出的 RawDataset/RawRow/对象/origin backref 字节级一致。
  - **R12 双向闭包**：对象有了真实的"反向-data"源头（原始列 → 属性），为字段全建模门（另 PRD）提供真实可溯底座。
  - **R4 真值经 Action**：materialize 仍经 `domainExecutor`（Phase9B）。
  - **R2 tenant_id**：连接/原始表/对象/lineage 全程租户隔离。
- **关闭/影响的已知断点**（§8）：为 **G-6**（rawin 三路统一）与本体浏览器/字段全建模门 PRD 提供真实数据底座；夯实"一个事实一个出处"。
- **需走的检测门禁**（§7）：闭包门（materialize 后对象落切片）· 确定性重跑一致 · A6 行级过滤（原始行/对象/lineage 读出）· `ontology:check`（锚点/事件不漂）· 新增 lineage 往返冒烟。
- **回写承诺**：落地后回写本体 §2.A/B（合成产物含 Connection/RawDataset + origin backref）· §3（数据→本体链去掉"合成绕过"⚠、补 lineage 反查边）· §10.3（切片 `sys.ingest.data_to_object` 标注合成亦经此链）· §8（相关项更新）。

## 1. 目标 / 非目标

**目标**
1. **合成数据落为可见原始表**：合成生成同时产出一个"合成数据源"`Connection` + 每核心对象类型一张 `RawDataset`（含 `RawRow`），在数据源页可直接查看原始行。
2. **对象带源头 backref**：`ObjectInstance.origin` 记录 `{ rawDatasetId, rawRowIdx }`，使每个对象可溯回它的原始行。
3. **全链 lineage 反查**：新增端点，给定对象 → 返回 `对象 → 原始行 → RawDataset → Connection`（+ 派生链）；给定一次推演结果 → 返回其求解器入参引用的对象集 → 各自源头。
4. **结果可一键溯源**（前端，并入 P3）：推演结果块/驾驶舱 KPI 上提供"溯源"入口，点开看到入参对象与原始表行。
5. **确定性不破**：R6 不变。

**非目标**
- 不重写连接器/解析器（复用既有 sync→RawDataset→materialize）。
- 不动合成的非数据产物（规则/视图/账号/策略仍按现状直接落——它们是配置非"数据"）。
- xlsx 解析、字段全建模门归各自 PRD（本 PRD 只提供其数据底座）。

## 2. 现状与缺口（对照代码）

| # | 现状（file:line） | 缺口 |
|---|---|---|
| C-1 | 合成 `putAll("Base"/"Model"/"Order"…)` 直接写 ObjectInstance，origin `{type:SYNTHETIC, jobId}`（`apps/datacore/src/synthetic/service.ts:159,201,502-504`） | 无 RawDataset、无 Connection、对象无 rawDatasetId backref |
| C-2 | 真链路在：`connections/:id/sync` 落 RawDataset（`connectors/service.ts:166,225`）、`raw-datasets/:id/rows` 可见（`app.ts:1495-1513`）、`modeling/drafts/:id/materialize`（`app.ts:1643`） | 合成路径不走它 → 演示租户数据源页为空、对象凭空出现 |
| C-3 | 无 lineage 反查端点（grep 无 `/lineage`） | 无法从对象/结果溯回原始表与连接器 |
| C-4 | Task 留答案，但是否留"求解器入参引用的对象 refs"待确认（`router/orchestrator.ts` proceedWithIntent / toolCalls） | 结果→入参对象的反查缺锚点 |

## 3. 设计（复用优先；标清 复用 / 绿地 / 门禁）

### 3.1 合成 → 原始表 → 物化（修 C-1/C-2）【改造合成 + 复用 materialize】
- 合成生成核心**数据对象**（Base/Model/Order/Line/Material/Customer/… 现有 `g.*`/`ext.*` 数组）时：
  1. 幂等 upsert 一个 `Connection`（kind=SYNTHETIC，名"合成数据源·<industry>"）。
  2. 每对象类型产一张 `RawDataset`（origin SYNTHETIC，schema=该类型字段），`RawRow` = 各记录。复用 `repos.rawDatasets.put`。
  3. **物化**为 ObjectInstance：复用既有 materialize 语义（raw→object 映射），`origin = { type:"MATERIALIZED", source:"SYNTHETIC", jobId, rawDatasetId, rawRowIdx }`。
  4. 发 `raw_dataset.uploaded` + `materialize.completed`（D-29）。
- **确定性**：上述全部由 (industry,scale,seed) 决定，重跑字节级一致（R6）。沿用现有幂等清理（先清 origin=SYNTHETIC 的 raw+object 再重建）。
- **风险控制**：分两步落——先让数据对象走"合成→raw→物化"，配置型产物（规则/视图/账号）保持直接落，避免大爆炸式重写。

### 3.2 全链 lineage 反查（修 C-3/C-4）【绿地端点】
- `GET /a/v1/lineage/object/:type/:id` → `{ object, origin, rawDataset{id,name,connId}, rawRow, connection, derivations:[{spec,run}] }`。
- `GET /a/v1/lineage/task/:taskId`（或 AgentCore 经 OBO）→ `{ inputs:[ObjectRef], objects:[…对象 lineage 摘要] }`，数据源自 Task 的求解器入参/toolCalls 留痕；若入参留痕不足，P1 先补"记录 solver 入参引用的对象 refs"。
- A6 行级过滤贯穿（原始行/对象按 policy 过滤）。

### 3.3 结果溯源（前端，并入 P3）【绿地前端】
- 数据源页（复用 ConnectionsPage + raw-datasets/rows 端点）：展示合成 Connection 与各 RawDataset 原始行。
- 推演结果块 / 驾驶舱 KPI：加"溯源"affordance → 调 lineage 端点 → 抽屉展示入参对象 + 原始表行 + 派生链。与本体浏览器节点检视器共用 lineage 数据。

## 4. 契约 / 端点 / 数据模型（双仓储四处同改；contracts-only-shared）
- `ObjectInstance.origin` 扩展（additive）：`{ type, jobId?, source?, rawDatasetId?, rawRowIdx? }`（datacore 内部类型 + 仓储四处）。
- 新端点：`GET /a/v1/lineage/object/:type/:id` · `GET /a/v1/lineage/task/:taskId`。
- 合成产物新增 RawDataset/RawRow/Connection（复用既有仓储；无新表，除非 origin 字段需迁移列）。
- R9：若 object.origin 落 pg 需加列 → migrations + pg.ts + memory.ts + repo 接口同改。

## 5. 关键流程（端到端，沿链路）
```
SEED_DEMO / 合成生成(industry,scale,seed)
  → upsert Connection(SYNTHETIC) 
  → 每类型 RawDataset + RawRow（raw_dataset.uploaded）        ← 数据源页可见原始行
  → materialize → ObjectInstance(origin{MATERIALIZED, rawDatasetId, rawRowIdx})（materialize.completed）
  → runDerivations → DerivedProperty
求解器读对象 → 结果（Task 留入参对象 refs）
溯源：结果 → GET /a/v1/lineage/task/:id → 入参对象 → GET /a/v1/lineage/object/:type/:id
        → RawRow → RawDataset → Connection（"这个数从哪来"全链可见）
```

## 6. 非功能与约定（§5 不变量逐条）
- **R6**：合成 raw/object/origin/lineage 同 seed 字节级一致；测试不依赖网络/时钟。
- **R2/R3**：连接/原始表/对象/lineage 全程 tenantId + entitlement + A6 行级过滤。
- **R4**：物化经 Action/domainExecutor。
- **R10/D-29**：合成补发 `raw_dataset.uploaded` + `materialize.completed`，下游订阅按 §4 反映。
- **R1**：前端不重定义类型。

## 7. 验收（DoD）
- `pnpm -r build && test` 全绿；新测试净增。
- **确定性**：同 (industry,scale,seed) 重跑，RawDataset/RawRow/对象/origin lineage 字节级一致。
- **数据源可见**：SEED_DEMO 后 `GET /a/v1/raw-datasets` 非空，每核心类型有原始行；`GET /a/v1/connections` 含合成源。
- **lineage 往返冒烟**：任取一对象 → lineage 溯到 RawRow→RawDataset→Connection；任取一推演结果 → 溯到入参对象集。
- `ontology:check` 绿（事件计数不变；锚点更新）。
- 本体 §2/§3/§10.3/§8 已回写。

## 8. 分期
- **P1**：合成核心数据对象走"合成→RawDataset/RawRow→物化"，object.origin 记 rawDatasetId/rowIdx；补发事件；确定性回归。（数据源页立刻有原始数据）
- **P2**：lineage 端点（object + task）+ Task 入参对象留痕 + 往返冒烟。
- **P3**（并入场景启动器 P3 前端阶段）：数据源原始表展示 + 结果"溯源"抽屉 + 本体浏览器节点检视器共用 lineage。
