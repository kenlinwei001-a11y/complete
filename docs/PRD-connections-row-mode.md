# PRD · Admin 管理页行模式统一改造 + createdAt/createdBy 全链路补齐

> 状态：待用户最终确认后实施  
> 变更 ID：FE-2026-0707-001（数据补齐）+ FE-2026-0707-002（行模式）合并实施  
> 关联本体：§2.A Connection / §2.H Agent·Skill·Workflow·MCP·Intent·Plan / §5 R2·R6·R13·R14

---

## 一、需求确认（用户已拍板）

1. **类型=模拟/实际**：不新增字段，由 `createdBy` 值区分——`"system"`/`"模拟"` → 模拟，真实用户名 → 实际。
2. **创建人=账号角色**：如 `admin`。用户手动创建记当前操作用户，系统自动生成记 `"system"`。
3. **全部卡片改行**：6 个 CARD 模式页面全部改为行模式。
4. **只加 `createdAt`/`createdBy`**：后端仅需新增这两个字段。
5. **历史数据回填**：系统已有信息的创建人统一填 `"admin"`，时间统一填今天（`2026-07-07T00:00:00Z`）。

---

## 二、实施范围

### 2.1 前端页面（7 个）

| 页面 | 路径 | 当前模式 | 改造内容 |
|------|------|---------|---------|
| AgentsPage | `/admin/agents` | CARD（左列表+右编辑器） | 左列表改行模式，显 createdAt/createdBy/类型 |
| SkillsPage | `/admin/skills` | CARD | 同上 |
| WorkflowsPage | `/admin/workflows` | CARD | 同上 |
| McpPage | `/admin/mcp` | CARD | 同上 |
| CatalogPage | `/admin/catalog` | CARD（意图列表） | 意图列表改行模式，显 createdAt/createdBy/类型 |
| KnowledgePage | `/admin/knowledge` | CARD（知识库名称列表） | 列表改行模式，显 createdAt/createdBy |
| ConnectionsPage | `/admin/connections` | 已是行模式 | 补 createdAt/createdBy/类型展示，修状态筛选 INACTIVE→DISABLED |

### 2.2 后端资源类型（6 个契约 + service）

| 资源 | 契约文件 | 后端 service | 存储侧 |
|------|---------|-------------|--------|
| `AgentDefinition` | `contracts/agentcore.ts` | `agentcore` 保存接口 | AgentCore B 侧（JSONB/memory） |
| `SkillDefinition` | `contracts/agentcore.ts` | `agentcore` 保存接口 | AgentCore B 侧 |
| `WorkflowDefinition` | `contracts/agentcore.ts` | `agentcore` 保存接口 | AgentCore B 侧 |
| `McpServerConfig` | `contracts/agentcore.ts` | `agentcore` 保存接口 | AgentCore B 侧 |
| `IntentDefinition` | `contracts/agentcore.ts` | `agentcore` 保存接口 | AgentCore B 侧 |
| `ConnectionInstance` | `contracts/datacore.ts` | `datacore/connectors/service.ts` | DataCore A 侧（JSONB doc） |

注：KnowledgePage 的知识库文档 `KbDocVM` 已有 `createdAt`，补 `createdBy`。

---

## 三、后端变更清单

### 3.1 契约层（`@platform/contracts`）

**AgentCore 侧**（`packages/contracts/src/agentcore.ts`）：
- `AgentDefinitionSchema` += `createdAt?: string`, `createdBy?: string`
- `SkillDefinitionSchema` += `createdAt?: string`, `createdBy?: string`
- `WorkflowDefinitionSchema` += `createdAt?: string`, `createdBy?: string`
- `McpServerConfigSchema` += `createdAt?: string`, `createdBy?: string`
- `IntentDefinitionSchema` += `createdAt?: string`, `createdBy?: string`

**DataCore 侧**（`packages/contracts/src/datacore.ts`）：
- `ConnectionInstanceSchema` += `createdAt?: string`, `createdBy?: string`
- `KbDocVMSchema` += `createdBy?: string`（`createdAt` 已有）

全部 **optional**，向后兼容（旧数据 undefined → 前端空态）。

### 3.2 后端 domain / service

**AgentCore**（`apps/agentcore/src/`）：
- 各资源的 save/create 接口填充 `createdAt=new Date().toISOString()`, `createdBy=ctx.userId`（或 auth 上下文中的用户标识）
- 已有数据不迁移（AgentCore 侧资源多为运行时创建，数量少）

**DataCore**（`apps/datacore/src/`）：
- `domain.ts` `Connection` 接口 += `createdAt?`, `createdBy?`
- `connectors/service.ts` `createConnection` 填充 `createdAt`/`createdBy`
- `connectors/service.ts` `upload` / `importPrototype` 填充 `createdAt`/`createdBy`
- `kb.ts` 知识库文档创建时填充 `createdBy`

### 3.3 前端 mock

- `apps/frontend-shell/src/mocks/db.ts`：所有相关资源初始数据补 `createdAt: "2026-07-07T00:00:00Z"`, `createdBy: "admin"`
- `apps/frontend-shell/src/mocks/handlers.ts`：POST 创建接口回写 `createdAt`/`createdBy`

---

## 四、前端变更清单

### 4.1 通用行模式组件

新增共享组件 `AdminResourceRow`（或各页独立 `*Row` 组件），统一行布局：
- 名称（主键链接）
- 状态徽章
- 类型徽章（模拟/实际，由 createdBy 派生）
- 创建时间
- 创建人
- 操作按钮（编辑/删除/发布等）

### 4.2 各页面改造

**AgentsPage**：
- 左列表从 `select dropdown / button 卡片` 改为 `AgentRow` 行列表
- 显：name + status + createdAt + createdBy + 类型徽章
- 保留：点击行 → 右编辑器展开

**SkillsPage / WorkflowsPage / McpPage**：
- 同 AgentsPage 模式，各行组件分别为 `SkillRow` / `WorkflowRow` / `McpRow`

**CatalogPage**：
- 意图列表从卡片改为 `IntentRow` 行列表
- 显：name + status + version + createdAt + createdBy + 类型徽章

**KnowledgePage**：
- 知识库名称列表改为行列表
- 显：connName + docCount / chunkCount + createdAt + createdBy

**ConnectionsPage**：
- 已行模式，修：
  - 状态筛选 `INACTIVE` → `DISABLED`
  - `ConnectionRow` 加 `createdAt` / `createdBy` / 类型徽章展示
  - 排序逻辑使用真实 `createdAt`（不再 fallback 到 `lastSyncAt`）

---

## 五、数据回填规则

### 5.1 历史数据（已有 mock / DB 数据）

| 场景 | createdAt | createdBy |
|------|-----------|-----------|
| 既有 mock 种子数据 | `2026-07-07T00:00:00Z` | `"admin"` |
| 已有 pg 数据（如有） | `1970-01-01T00:00:00Z` 或今天 | `"admin"` 或 `"system"` |

### 5.2 新增数据

| 创建方式 | createdAt | createdBy |
|----------|-----------|-----------|
| 用户在前端手动新建 | `new Date().toISOString()` | 当前用户 `userId`（如 `"admin"` / `"planner"`） |
| 数据构建发动机自动生成 | `new Date().toISOString()` | `"system"`（前端渲染为 `"模拟"`） |
| 合成数据/bootstrap | `new Date().toISOString()` | `"system"`（前端渲染为 `"模拟"`） |

---

## 六、实施顺序（依赖先后）

```
Step 1: 契约层加字段（optional，全向后兼容）
    ↓
Step 2: 后端 AgentCore domain + 各 save/create 接口填充字段
    ↓
Step 3: 后端 DataCore domain + connectors service + kb service 填充字段
    ↓
Step 4: 前端 mock 数据补字段 + handlers 回写
    ↓
Step 5: 前端通用行组件 + 7 个页面改造
    ↓
Step 6: 补测试（行模式渲染 + createdAt/createdBy 存在性 + 类型徽章 + 排序/筛选）
    ↓
Step 7: 回归既有测试（gates 全绿）
    ↓
Step 8: 真浏览器验证（FDE）
```

---

## 七、依赖与影响面（本体引用）

### 7.1 触及的对象类型
- `AgentDefinition` / `SkillDefinition` / `WorkflowDefinition` / `McpServerConfig` / `IntentDefinition`（§2.H）
- `ConnectionInstance`（§2.A）
- `KbDocVM`（§2.A S4）

### 7.2 触及的链路
- **无新增/改变链路**。本次为展示层 + 数据字段补齐，不改数据流或业务逻辑。
- 数据构建发动机 → 各管理页面的链路已在 §2.H / §3 中完整登记，本次仅在展示端消费已有字段。

### 7.3 触及的事件
- **无新增事件**。`createdAt`/`createdBy` 为静态元数据，不参与事件驱动。

### 7.4 不变量检查
- **R2 tenant_id everywhere**：新增字段按租户隔离，无跨租户泄漏。
- **R6 确定性**：`createdAt` 为事实时间戳，`createdBy` 为确定性字符串，无随机性。
- **R13 溯源**：createdBy 诚实标识来源（用户/system），前端不伪造。
- **R14 零业务常数**："模拟/实际"派生逻辑为纯函数（`createdBy === "system"`），无写死业务串。

### 7.5 是否需要回写 SYSTEM-ONTOLOGY.md
- **否**。本次为已有对象类型加可选元数据字段，不改变链路、事件、不变量。已在 §2 对应制品中提及，无需回写。

---

## 八、测试计划

### 8.1 新增测试
- 每个改造页面至少 1 个测试：行模式渲染 + createdAt/createdBy 可见 + 类型徽章正确
- ConnectionsPage：状态筛选 DISABLED 真生效 + 排序按 createdAt

### 8.2 回归测试
- `pnpm -r build && pnpm -r test`（4 包全绿底线）
- `pnpm gates`（ontology + chain + 其他门禁）
- 重点回归：f56.connection-category / f39.data-source-edit / f50.data-categories / f47.validation-policy

### 8.3 FDE 真浏览器验证
- mock 模式真渲染：逐页检查行模式布局 + createdAt/createdBy 展示 + 类型徽章

---

## 九、风险与回滚

| 风险 | 缓解 |
|------|------|
| 7 个页面并行改，回归面大 | 按 Step 5 逐页改、逐页测，不一次性全改 |
| 契约加 optional 字段导致类型漂移 | zod `.optional()` 向后兼容，旧消费端无感知 |
| 前端 mock 与真后端数据不一致 | mock handlers 和真 service 同步填充逻辑 |
| 行模式在小屏下拥挤 | 行组件用 flex-wrap + 关键信息优先，小屏隐藏次要字段 |

**回滚**：契约字段为 optional，前端展示代码独立 commit，可单独 revert。

---

*PRD 版本：v1.0 · 待用户最终确认*
