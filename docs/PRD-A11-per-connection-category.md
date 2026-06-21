# PRD · A11 · 连接创建时打 Connection.category 标签（per-connection 归类）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-21 · 波次 Wave 1（基座，小项） |
| 取代/扩展 | 扩 `PRD-platform-foundry-aip.md`（A1 连接器）· 关联 `data-categories.ts`（数据接入分类，不同概念） |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§2.A 接入域 / §5 R2/R9） · `apps/datacore/src/domain.ts:98`（Connection 接口）· `apps/datacore/src/connectors/registry.ts`（连接器类型 category）· `apps/datacore/src/synthetic/data-categories.ts`（DataCategory 对象类型归类） |
| 索引 | `PRD-A-series-roadmap.md` |

> 一句话：`category`（ERP/CRM/EXTERNAL/KB/FILE）目前只在**连接器类型**（registry）层固定，**连接实例（Connection）创建时没有 per-instance 归类**。A11 给 `Connection` 加可覆盖的 `category` 字段（创建时默认取连接器类型、可改），让"这条连接属于哪类"在实例层可见、可筛、可治理，喂 A4 浏览器与数据接入分类。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2.A）：`Connection`/`Connector`·`DataCategory`（区分：DataCategory 是"对象类型按业务域归类"，A11 是"连接实例按来源系统类归类"，两者正交、可联动）·`RawDataset`（继承连接 category 便于溯源）。
- **触及链路**（§3）：`Connector(类型默认 category) → Connection(实例 category, 可覆盖) → RawDataset(带 category 溯源)`；喂 A4 连接器/数据浏览的归类筛选。
- **触及事件/数据流**（§4）：复用 `connection.sync_completed`；**新增** `connection.created`（带 category）→ 失效 connectors-list/data-category 视图（IN_SESSION）。
- **触及不变量**（§5）：
  - **R2** tenant_id：category 随 Connection 按租户存。
  - **R9** 仓储双实现：Connection 加列 → **四处同改**（migration + repo/pg.ts + repo/memory.ts + repo 接口）。
  - **R5** no-secrets-echo：category 是非敏感标签，正常回显（不涉凭据）。
  - **R14**：category 取值枚举来自注册表（连接器类型 category 并集 + 可扩），非前端内联。
- **关闭/影响断点**（§8）：小幅推进 **G-6**（数据接入归类完整性）；为 **A4 浏览器** 提供连接维度归类。
- **门禁**（§7）：仓储双实现一致性测试 · `ontology:check`（事件锚不漂）· 前端连接器页回归。
- **回写承诺**：回写本体 §2.A（Connection.category 字段）· §4（connection.created 事件）。

## 1. 目标 / 非目标
### 目标
1. `Connection` 加 `category` 字段（实例级），**创建时默认取该连接器类型的 registry category、允许覆盖**。
2. 连接器列表/详情可见 category；可按 category 筛选；RawDataset 溯源带 category。
3. category 枚举来自注册表（ERP/CRM/EAM/MES/WMS/SRM/FIN/IoT/QMS/EXTERNAL/KB/FILE… 连接器类型并集），**可扩、不锁死**。

### 非目标
- 不改 DataCategory（对象类型归类）机制；A11 与之正交（可在 A4 联动展示）。
- 不改连接器同步/上传逻辑；仅加标签字段 + 创建入口。

## 2. 现状与缺口（file:line）
| 维度 | 现状 | 缺口 |
|---|---|---|
| category 归属 | `registry.ts:25/40/54…`：**连接器类型**带 `category`（ERP/CRM/EXTERNAL/KB/FILE） | 连接**实例**（Connection）无 category 字段 |
| Connection 模型 | `domain.ts:98 interface Connection`（无 category） | 缺字段 + 仓储列 + 创建入口 |
| 创建入口 | `POST /a/v1/connections`（连接器创建） | 未接收/默认/存 category |
| 浏览 | 连接器页列连接 | 无 category 列/筛选 |

## 3. 设计（加字段 + 默认 + 覆盖 + 浏览）
### 3.1 数据模型（R9 四处同改）
- `domain.ts` `Connection` 加 `category?: string`。
- `migrations/0NN_connection_category.sql`：`ALTER TABLE connections ADD COLUMN category text`（幂等）。
- `repo/pg.ts` + `repo/memory.ts` + repo 接口：读写带 category。
### 3.2 创建时默认 + 覆盖
- `POST /a/v1/connections`：body 可选 `category`；缺省 → 取该 `connectorType` 在 registry 的 `category` 作默认；显式传则覆盖。
- 校验：category ∈ 注册表枚举并集（未知值 WARN 接受为自定义标签，或 400，按 §需确认——默认**接受自定义**，R14 可扩）。
### 3.3 溯源继承
- 该连接产出的 `RawDataset` 记 `sourceCategory`（= Connection.category），便于数据浏览按来源类筛。
### 3.4 浏览/筛选
- 连接器列表加 `category` 列 + 按 category 分组/筛选 chip（前端零业务常数，枚举来自 `GET /a/v1/connector-categories`）。
- 喂 A4 对象/类型浏览器的"按来源系统类"维度。

## 4. 契约 / 端点
- `contracts`：`ConnectionSchema` 加 `category`；`CreateConnectionBody` 加可选 `category`；新增 `GET /a/v1/connector-categories`（枚举并集）。
- 端点：`POST /a/v1/connections`（接收/默认/存 category）· 列表端点返回 category · `GET /a/v1/connector-categories`。
- 事件 `connection.created` 入 `event-subscriptions.ts`（D-29）。

## 5. 关键流程（端到端）
建连接（选连接器类型 mock_erp）→ category 默认 `ERP`（可在表单改为如 `MES`）→ `POST /a/v1/connections` 存 category → `connection.created` 失效连接器列表 → 列表按 category 分组显示 → 同步产出 RawDataset 带 sourceCategory → A4/数据浏览可按来源类筛。

## 6. 非功能（§5）
R2 租户隔离 · R9 双仓储一致 · R14 枚举注册表化。

## 7. 验收（DoD）
- 建连接默认带类型 category、可覆盖、持久化（pg + memory 双实现一致）。
- 列表可见/可筛 category；RawDataset 带 sourceCategory。
- `pnpm -r build && pnpm -r test` 全绿（新增 Connection.category 双仓储测试 + 创建默认/覆盖用例 + 前端筛选回归）；`ontology:check` 过。
- 回写本体 §2.A/§4。

## 8. 分期（小项，单波内完成）
- **A11.1** 数据模型四处 + 创建默认/覆盖 + 枚举端点。
- **A11.2** RawDataset 溯源继承 + 前端列/筛选。

## 9. 已确认（用户裁决 2026-06-21）
- 连接 category **允许自定义值**（注册表枚举之外）✅。设计据此定稿：创建/更新时未知值**接受为自定义标签**（不 400），并入 `GET /a/v1/connector-categories` 的"已用值"集合供后续复用/筛选；前端 category 输入为"可选既有 + 可自由输入"（R14 可扩，非锁死枚举）。

> 基线分支：实现前定准（Connection 加列涉 migration，需对准基线的迁移序号）。
